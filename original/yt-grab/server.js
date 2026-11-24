// YT Grab: Express API + static frontend.
const path = require('path');
const fs = require('fs');
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const { AppError } = require('./src/errors');
const { getInfo, getPlaylist, getProfile, ytdlp } = require('./src/youtube');
const { jobs, createJob, publicState, cancelJob, listUnfinished, discardUnfinished } = require('./src/jobs');
const { createPreview, getPreviewFile, assembleWatched } = require('./src/preview');
const history = require('./src/history');
const { downloadSubtitles } = require('./src/subtitles');
const { createPlayback, streamProxy, hlsProxy, assembleHls } = require('./src/stream');

const app = express();
require('child_process').execFile('aria2c', ['--version'], { timeout: 5000, windowsHide: true }, (err) => { config.aria2Available = !err; });
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor', express.static(path.join(__dirname, 'node_modules', 'hls.js', 'dist'))); // local copy of the HLS player (npm i hls.js)

// Basic abuse protection for the API.
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 150, standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path.startsWith('/stream/') || req.path.startsWith('/hls/') || req.path.startsWith('/preview/'), // video players send many small Range requests
  message: { error: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' } }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 1) Metadata + qualities
app.post('/api/info', wrap(async (req, res) => {
  res.json(await getInfo(req.body.url));
}));

// 1b) Playlist contents (YouTube)
app.post('/api/playlist', wrap(async (req, res) => {
  res.json(await getPlaylist(req.body.url));
}));

// 1c) Public account info (YouTube channel / TikTok profile) + latest videos
app.post('/api/profile', wrap(async (req, res) => {
  res.json(await getProfile(req.body.url));
}));

// 2) Start a download job (or resume / re-attach to the same link + quality)
app.post('/api/download', wrap(async (req, res) => {
  const { url, optionId, title, totalBytes } = req.body;
  const job = await createJob({ url, optionId, title, totalBytes: Number(totalBytes) });
  res.status(202).json({ id: job.id });
}));

// 3) Live progress via Server-Sent Events
app.get('/api/progress/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Download not found or expired.', code: 'NOT_FOUND' });
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (state) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  send(publicState(job));
  const onUpdate = (state) => { send(state); if (['done', 'error'].includes(state.status)) res.end(); };
  job.events.on('update', onUpdate);
  req.on('close', () => job.events.off('update', onUpdate));
  if (['done', 'error'].includes(job.status)) res.end();
});

// 3b) Stop a running job (partial files are kept so it can be resumed)
app.post('/api/cancel/:id', (req, res) => {
  cancelJob(req.params.id);
  res.json({ ok: true });
});

// 4) Send the finished file to the browser as an attachment. The file stays on disk.
app.get('/api/file/:id', (req, res, next) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done' || !job.file || !fs.existsSync(job.file)) {
    return next(new AppError('File not ready or expired.', 404, 'NOT_FOUND'));
  }
  const safe = job.title.replace(/[^\w\s.-]/g, '').trim().slice(0, 100) || 'video';
  const filename = `${safe}.${job.ext}`;
  const stat = fs.statSync(job.file);
  res.set({
    'Content-Type': job.ext === 'mp4' ? 'video/mp4' : job.ext === 'mp3' ? 'audio/mpeg' : job.ext === 'm4a' ? 'audio/mp4' : 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${safe.replace(/[^\x20-\x7E]/g, '_') || 'video'}.${job.ext}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  // Sent completely: drop the server's copy so the video exists in one place only (the browser's Downloads folder).
  res.on('finish', () => {
    if (!config.SAVE_TO_BROWSER) return;
    jobs.delete(job.id);
    fs.rm(job.dir, { recursive: true, force: true }, () => {});
  });
  fs.createReadStream(job.file).on('error', (e) => (res.headersSent ? res.destroy() : next(e))).pipe(res);
});

// 4b) Preview in pieces: a short piece starting wherever the user chooses, at the chosen quality.
// Pieces are kept in the system's temp folder only while you watch (not in the downloads folder).
app.post('/api/preview', wrap(async (req, res) => {
  const { id } = await createPreview(req.body.url, req.body.optionId, req.body.start, req.body.length);
  res.json({ id });
}));
// Join everything watched so far into ONE file inside the program's downloads folder (no new data used).
app.post('/api/assemble', wrap(async (req, res) => {
  const r = await assembleWatched(req.body.url, req.body.optionId, Number(req.body.duration) || 0, req.body.title);
  history.add({ id: `w${require('crypto').randomBytes(6).toString('hex')}`, type: 'watched', title: r.file, file: r.file, path: path.join(r.dir, r.file), bytes: r.bytes, url: req.body.url });
  res.json(r);
}));
app.get('/api/preview/:id', (req, res, next) => {
  const file = getPreviewFile(req.params.id);
  if (!file) return next(new AppError('This piece is no longer saved. Press Preview again.', 404, 'NOT_FOUND'));
  res.set('Cache-Control', 'no-store');
  res.sendFile(file, { dotfiles: 'allow' }); // sendFile supports Range requests, so the player can seek
});

// 4c) Live playback (scrub through the whole video before downloading; only what you watch is fetched)
app.post('/api/play', wrap(async (req, res) => {
  res.json(await createPlayback(req.body.url, req.body.optionId));
}));
// Same for an .m3u8 video watched in the live player.
app.post('/api/hls-save', wrap(async (req, res) => {
  const m = /^\/api\/hls\/([0-9a-f]+)/.exec(String(req.body.src || ''));
  const r = await assembleHls(m ? m[1] : '', req.body.title);
  history.add({ id: `w${require('crypto').randomBytes(6).toString('hex')}`, type: 'watched', title: r.file, file: r.file, path: path.join(r.dir, r.file), bytes: r.bytes });
  res.json(r);
}));
// Tells the page where finished videos go (the program's downloads folder, or the browser's Downloads folder).
app.get('/api/mode', (req, res) => res.json({ toBrowser: config.SAVE_TO_BROWSER, dir: config.DOWNLOAD_DIR }));
app.get('/api/hls/:token', (req, res, next) => hlsProxy(req, res).catch(next));
app.get('/api/stream/:token', (req, res, next) => streamProxy(req, res).catch(next));

// 4d) Subtitles (saved in the program's downloads folder; nothing of the video is downloaded)
app.post('/api/subtitles', wrap(async (req, res) => {
  const { url, lang, auto, format, title } = req.body;
  res.json(await downloadSubtitles(url, lang, !!auto, format, title));
}));
app.get('/api/subtitle-file', (req, res, next) => {
  const name = path.basename(String(req.query.f || ''));
  const full = path.join(config.DOWNLOAD_DIR, name);
  if (!/\.(srt|vtt)$/i.test(name) || !fs.existsSync(full)) return next(new AppError('File not found.', 404, 'NOT_FOUND'));
  res.download(full, name);
});

// 4e) History of finished files (kept in a JSON file in the downloads folder)
app.get('/api/history', (req, res) => res.json({ items: history.list() }));
app.delete('/api/history/:id', (req, res) => {
  if (/^[\w-]{1,40}$/.test(req.params.id)) history.remove(req.params.id);
  res.json({ ok: true });
});
app.delete('/api/history', (req, res) => { history.clear(); res.json({ ok: true }); });

// 5) Downloads that stopped before finishing (offered for resuming after a restart)
app.get('/api/unfinished', (req, res) => res.json({ items: listUnfinished() }));
app.delete('/api/unfinished/:id', (req, res) => {
  if (discardUnfinished(req.params.id)) return res.json({ ok: true });
  res.status(409).json({ error: 'This download can’t be removed right now.', code: 'BUSY' });
});

// Download speed chosen on the page (applies to the next download).
const speedState = () => ({ ...config.speed, aria2: config.aria2Available });
app.get('/api/speed', (req, res) => res.json(speedState()));
app.post('/api/speed', (req, res) => {
  const { mode, limitMBps } = req.body || {};
  if (['normal', 'fast', 'max'].includes(mode)) config.speed.mode = mode;
  const l = Number(limitMBps);
  if (Number.isFinite(l) && l >= 0 && l <= 1000) config.speed.limitMBps = l;
  res.json(speedState());
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' }));

// Central error handler
app.use((err, req, res, _next) => {
  if (!(err instanceof AppError)) console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err instanceof AppError ? err.message : 'Something went wrong on the server.', code: err.code || 'INTERNAL' });
});

/** Self-update the yt-dlp binary (YouTube changes its protection often; an old yt-dlp gets HTTP 403). */
async function updateYtDlp() {
  try {
    const out = await ytdlp.exec(undefined, { updateTo: config.YTDLP_CHANNEL });
    const last = String(out.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
    console.log(`[yt-dlp update] ${last || 'done'}`);
  } catch (e) {
    const last = String(e.stderr || e.message || '').trim().split(/\r?\n/).filter(Boolean).pop();
    console.log(`[yt-dlp update] skipped: ${last || 'unknown reason'}`);
  }
}
const isBusy = () => [...jobs.values()].some((j) => ['queued', 'downloading', 'processing'].includes(j.status));

(async () => {
  if (config.AUTO_UPDATE_YTDLP) {
    console.log('Checking for a newer yt-dlp (up to 30 seconds)…');
    await Promise.race([updateYtDlp(), new Promise((r) => setTimeout(r, 30_000))]);
    setInterval(() => { if (!isBusy()) updateYtDlp(); }, 24 * 60 * 60 * 1000).unref(); // once a day, never during a download
  }
  app.listen(config.PORT, () => console.log(`YT Grab running at http://localhost:${config.PORT} (downloads: ${config.DOWNLOAD_DIR})`));
})();
