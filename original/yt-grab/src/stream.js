// Live playback so the user can scrub through a video BEFORE downloading it.
// The browser plays a single ready-made file (video + audio together) through this proxy, which passes
// Range requests along: only the parts actually watched are fetched, and seeking works like on YouTube.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { Readable } = require('stream');
const { AppError } = require('./errors');
const config = require('./config');
const { findPlayable, safeFetch, validateUrl } = require('./youtube');

const streams = new Map(); // token -> { url, headers, at }
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_TOKENS = 50;

/** Pick a playable file for the chosen quality and hand back a short-lived local URL for it. */
async function createPlayback(rawUrl, optionId) {
  const hls = await createHls(rawUrl, optionId);
  if (hls) return hls;
  const p = await findPlayable(rawUrl, optionId);
  if (!p) {
    throw new AppError('This quality can’t be played live (this site delivers it in separate pieces). Use the 5-second preview, or download it.', 422, 'NO_LIVE_PLAY');
  }
  const now = Date.now();
  for (const [t, s] of streams) if (now - s.at > TTL_MS) streams.delete(t);
  if (streams.size >= MAX_TOKENS) streams.delete(streams.keys().next().value);
  const token = crypto.randomBytes(8).toString('hex');
  streams.set(token, { url: p.url, headers: p.headers, at: now });
  return { src: `/api/stream/${token}`, height: p.height || null, ext: p.ext };
}

/** GET /api/stream/:token: relays the remote file, honouring the browser's Range header. */
async function streamProxy(req, res) {
  const s = streams.get(req.params.token);
  if (!s || Date.now() - s.at > TTL_MS) throw new AppError('This playback link expired. Press Watch again.', 404, 'NOT_FOUND');

  const ac = new AbortController();
  res.on('close', () => ac.abort()); // the tab closed or seeked elsewhere: stop fetching

  const headers = { ...s.headers };
  if (req.headers.range) headers.Range = req.headers.range;

  let upstream;
  try {
    upstream = await safeFetch(s.url, { headers, signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) return;
    throw new AppError('Could not reach the video server.', 502, 'UPSTREAM');
  }
  if (upstream.status >= 400) {
    upstream.body?.cancel().catch(() => {});
    throw new AppError(`The video server refused playback (HTTP ${upstream.status}).`, 502, 'UPSTREAM');
  }

  res.status(upstream.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) res.set(h, v);
  }
  if (!res.getHeader('content-type')) res.set('Content-Type', 'video/mp4');
  res.set('Cache-Control', 'no-store');

  if (!upstream.body) return res.end();
  const body = Readable.fromWeb(upstream.body);
  body.on('error', () => res.destroy());
  body.pipe(res);
}

// ---------- HLS (.m3u8) playback: the player loads only a few seconds ahead of where you are ----------
const pendingWrites = new Set(); // parts still being written to the cache (so "Save" never misses the last one)
const hlsTokens = new Map(); // token -> { url, host, at }
const b64 = (v) => Buffer.from(v).toString('base64url');
const unb64 = (v) => Buffer.from(v, 'base64url').toString();
// Copy of what is watched, kept in the system's temp folder so it can be joined into one file by "Save what I watched".
const HLS_CACHE = path.join(os.tmpdir(), 'ytgrab-hls');
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
fs.rmSync(HLS_CACHE, { recursive: true, force: true }); // start clean: nothing is kept between runs
/** Remove cached parts that were fetched a long time ago. */
function pruneCache() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(HLS_CACHE)) { const full = path.join(HLS_CACHE, f); if (now - fs.statSync(full).mtimeMs > CACHE_MAX_AGE_MS) fs.rmSync(full, { force: true }); }
  } catch { /* best effort */ }
}
const cacheFile = (t) => path.join(HLS_CACHE, crypto.createHash('sha256').update(t.origin + t.pathname).digest('hex').slice(0, 32)); // query (tokens) ignored
const mimeFor = (p) => (/\.(m4s|mp4|m4v)$/i.test(p) ? 'video/mp4' : /\.ts$/i.test(p) ? 'video/mp2t' : /\.(aac|m4a)$/i.test(p) ? 'audio/aac' : 'application/octet-stream');
const baseDomain = (h) => h.split('.').slice(-2).join('.');

/** For a direct .m3u8 link: a local URL the browser's HLS player can load. Returns null for other links. */
async function createHls(rawUrl, optionId) {
  pruneCache();
  const url = await validateUrl(rawUrl);
  const u = new URL(url);
  if (!/\.m3u8$/i.test(u.pathname)) return null;
  const now = Date.now();
  for (const [t, v] of hlsTokens) if (now - v.at > TTL_MS) hlsTokens.delete(t);
  if (hlsTokens.size >= MAX_TOKENS) hlsTokens.delete(hlsTokens.keys().next().value);
  const token = crypto.randomBytes(8).toString('hex');
  hlsTokens.set(token, { url, host: u.hostname.toLowerCase(), at: now, save: true, medias: new Map(), audio: new Set() });
  const h = /^v(\d{3,4})$/.exec(optionId || '');
  return { hls: true, src: `/api/hls/${token}`, height: h ? Number(h[1]) : null, ext: 'm3u8' };
}

/** GET /api/hls/:token[?u=...]: relays playlists (rewriting their links to come back here) and segments. */
async function hlsProxy(req, res) {
  const s = hlsTokens.get(req.params.token);
  if (!s || Date.now() - s.at > TTL_MS) throw new AppError('This playback link expired. Press Watch again.', 404, 'NOT_FOUND');
  let t;
  try { t = new URL(req.query.u ? unb64(String(req.query.u)) : s.url); } catch { throw new AppError('Bad link.', 400, 'BAD_URL'); }
  if (!['http:', 'https:'].includes(t.protocol) || baseDomain(t.hostname.toLowerCase()) !== baseDomain(s.host)) {
    throw new AppError('Blocked link.', 400, 'BAD_URL');
  }

  const proxied = (ref) => `/api/hls/${req.params.token}?u=${b64(new URL(ref, t).toString())}`;
  const sendPlaylist = (text) => {
    noteMedia(s, t, text);
    const out = text.split(/\r?\n/).map((line) => {
      if (!line.trim()) return line;
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, ref) => `URI="${proxied(ref)}"`);
      return proxied(line.trim());
    }).join('\n');
    res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
    res.send(out);
  };

  // Saving is on and this part was watched before: serve it from disk, no internet used.
  const file = s.save && !req.headers.range ? cacheFile(t) : null;
  if (file && fs.existsSync(file)) {
    if (/\.m3u8$/i.test(t.pathname)) return sendPlaylist(fs.readFileSync(file, 'utf8'));
    res.set({ 'Content-Type': mimeFor(t.pathname), 'Cache-Control': 'no-store' });
    return res.sendFile(file, { dotfiles: 'allow' });
  }

  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const headers = { 'User-Agent': config.USER_AGENTS[0] };
  if (req.headers.range) headers.Range = req.headers.range;

  let up;
  try { up = await safeFetch(t.toString(), { headers, signal: ac.signal }); }
  catch { if (ac.signal.aborted) return; throw new AppError('Could not reach the video server.', 502, 'UPSTREAM'); }
  if (up.status >= 400) {
    up.body?.cancel().catch(() => {});
    throw new AppError(`The video server refused playback (HTTP ${up.status}).`, 502, 'UPSTREAM');
  }

  const type = up.headers.get('content-type') || '';
  if (/mpegurl/i.test(type) || /\.m3u8$/i.test(t.pathname)) {
    const text = await up.text();
    if (file && up.status === 200) { try { fs.mkdirSync(HLS_CACHE, { recursive: true }); fs.writeFileSync(file, text); } catch { /* optional */ } }
    return sendPlaylist(text);
  }

  res.status(up.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = up.headers.get(h);
    if (v) res.set(h, v);
  }
  res.set('Cache-Control', 'no-store');
  if (!up.body) return res.end();
  const body = Readable.fromWeb(up.body);

  // While it plays, also keep a copy on disk (only a part that arrived completely is kept).
  let ws = null, tmp = null;
  if (file && up.status === 200) {
    try {
      fs.mkdirSync(HLS_CACHE, { recursive: true });
      tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      ws = fs.createWriteStream(tmp);
      ws.on('error', () => { ws = null; });
    } catch { ws = null; }
  }
  const dropCopy = () => { if (ws) { ws.destroy(); fs.rm(tmp, { force: true }, () => {}); ws = null; } };
  body.on('data', (c) => { if (ws) ws.write(c); });
  body.on('end', () => {
    if (!ws) return;
    const w = ws, f = tmp; ws = null;
    const done = new Promise((resolve) => w.end(() => fs.rename(f, file, () => resolve())));
    pendingWrites.add(done); done.then(() => pendingWrites.delete(done));
  });
  body.on('error', () => { dropCopy(); res.destroy(); });
  res.on('close', () => { if (!body.readableEnded) dropCopy(); });
  body.pipe(res);
}

/** Remember what each playlist lists (so the watched parts can later be joined into one file). */
function noteMedia(s, t, text) {
  if (/#EXT-X-STREAM-INF/.test(text) || /^#EXT-X-MEDIA:/m.test(text)) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^#EXT-X-MEDIA:/.test(line) && /TYPE=AUDIO/.test(line) && /URI="([^"]+)"/.exec(line);
      if (m) { const a = new URL(m[1], t); s.audio.add(a.origin + a.pathname); }
    }
    return;
  }
  if (!text.includes('#EXTINF')) return;
  const segs = [], durs = [];
  let d = 0, map = null;
  for (const line of text.split(/\r?\n/)) {
    const mm = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(line);
    if (mm) map = new URL(mm[1], t).toString();
    const e = /^#EXTINF:([\d.]+)/.exec(line);
    if (e) d = parseFloat(e[1]);
    else if (line.trim() && !line.startsWith('#')) { segs.push(new URL(line.trim(), t).toString()); durs.push(d); }
  }
  s.medias.set(t.origin + t.pathname, { segs, durs, map });
}

/** Every unbroken stretch of `true` flags, in order: [{ from, len }, ...]. */
const allRuns = (flags) => {
  const runs = [];
  let st = -1;
  flags.forEach((f, i) => { if (f && st < 0) st = i; if (!f && st >= 0) { runs.push({ from: st, len: i - st }); st = -1; } });
  if (st >= 0) runs.push({ from: st, len: flags.length - st });
  return runs;
};
const isCached = (u) => { try { return fs.existsSync(cacheFile(new URL(u))); } catch { return false; } };
const startTimes = (durs) => { let t = 0; return durs.map((d) => { const s = t; t += d; return s; }); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const ff = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (c) => (err = (err + c).slice(-2000)));
  ff.on('error', reject);
  ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited with ${code}`))));
});

/**
 * Join EVERYTHING that was watched (video + audio) into one mp4 in the program's downloads folder. No internet is used.
 * Stretches that are not next to each other (e.g. 0:00-5:00 and 10:00-11:00) are placed one after another in time order.
 */
async function assembleHls(token, title = '') {
  const s = hlsTokens.get(token);
  if (!s) throw new AppError('This playback expired. Press Watch again.', 404, 'NOT_FOUND');
  await Promise.all([...pendingWrites]);

  const cached = [...s.medias.entries()].map(([key, m]) => ({ key, m, count: m.segs.filter(isCached).length })).filter((x) => x.count > 0);
  const mostSaved = (list) => list.sort((a, b) => b.count - a.count)[0];
  const video = mostSaved(cached.filter((x) => !s.audio.has(x.key)));
  const audio = mostSaved(cached.filter((x) => s.audio.has(x.key)));
  if (!video) throw new AppError('Nothing from this video has been saved yet. Watch a few seconds first.', 404, 'NOTHING_WATCHED');

  const vStart = startTimes(video.m.durs);
  const aStart = audio ? startTimes(audio.m.durs) : [];
  /** The audio segments that cover the time span [t0, t1). */
  const audioSpan = (t0, t1) => {
    let a = -1, b = -1;
    for (let j = 0; j < aStart.length; j++) {
      if (aStart[j] < t1 && aStart[j] + audio.m.durs[j] > t0) { if (a < 0) a = j; b = j; }
    }
    return a < 0 ? null : { from: a, len: b - a + 1 };
  };
  // A video segment can be used when it is saved AND all the audio for the same moment is saved too.
  const usable = video.m.segs.map((u, i) => {
    if (!isCached(u)) return false;
    if (!audio) return true;
    const sp = audioSpan(vStart[i], vStart[i] + video.m.durs[i]);
    return !!sp && audio.m.segs.slice(sp.from, sp.from + sp.len).every(isCached);
  });
  const runs = allRuns(usable);
  if (!runs.length) throw new AppError('Nothing from this video has been saved yet. Watch a few seconds first.', 404, 'NOTHING_WATCHED');

  // The finished video goes into the program's downloads folder (the browser saves nothing); work files use the temp folder.
  const outDir = config.DOWNLOAD_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const id = crypto.randomBytes(8).toString('hex');
  const base = String(title || '').replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'video';
  let outFile = path.join(outDir, `${base} (watched part).mp4`);
  for (let n = 2; fs.existsSync(outFile); n++) outFile = path.join(outDir, `${base} (watched part ${n}).mp4`);

  /** Glue the saved init + segments of one stretch into a single raw file. */
  const build = (m, from, len, name) => {
    const out = path.join(os.tmpdir(), `ytgrab-${id}.${name}`);
    const parts = [];
    if (m.map && isCached(m.map)) parts.push(m.map);
    parts.push(...m.segs.slice(from, from + len));
    fs.writeFileSync(out, '');
    for (const u of parts) fs.appendFileSync(out, fs.readFileSync(cacheFile(new URL(u))));
    return out;
  };
  const adts = !!audio && /\.(ts|aac)(\?|$)/i.test(audio.m.segs[0]);
  const temp = [];
  const single = runs.length === 1;
  try {
    const pieces = [];
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      const t0 = vStart[r.from], t1 = vStart[r.from + r.len - 1] + video.m.durs[r.from + r.len - 1];
      const sp = audio ? audioSpan(t0, t1) : null;
      const vFile = build(video.m, r.from, r.len, `${k}.v.part`); temp.push(vFile);
      let aFile = null;
      if (sp) { aFile = build(audio.m, sp.from, sp.len, `${k}.a.part`); temp.push(aFile); }
      const target = single ? outFile : path.join(os.tmpdir(), `ytgrab-${id}.${k}.mp4`);
      if (!single) temp.push(target);
      await runFfmpeg(['-y', '-i', vFile, ...(aFile ? ['-i', aFile] : []), '-c', 'copy', ...(adts ? ['-bsf:a', 'aac_adtstoasc'] : []),
        ...(single ? [] : ['-avoid_negative_ts', 'make_zero']), '-movflags', '+faststart', '-f', 'mp4', target]);
      pieces.push(target);
    }
    if (!single) {
      // Put the stretches one after another (time order) into the final file.
      const list = path.join(os.tmpdir(), `ytgrab-${id}.list.txt`); temp.push(list);
      fs.writeFileSync(list, pieces.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', outFile]);
    }
  } catch (e) {
    fs.rm(outFile, { force: true }, () => {});
    console.error('[hls join error]', e.message);
    throw new AppError('Could not join the saved parts into a video.', 500, 'JOIN_FAILED');
  } finally {
    for (const f of temp) fs.rm(f, { force: true }, () => {});
  }
  const ranges = runs.map((r) => ({ from: Math.round(vStart[r.from]), seconds: Math.round(sum(video.m.durs.slice(r.from, r.from + r.len))) }));
  return { file: path.basename(outFile), dir: outDir, from: ranges[0].from, seconds: sum(ranges.map((r) => r.seconds)), ranges, bytes: fs.statSync(outFile).size };
}

module.exports = { createPlayback, streamProxy, hlsProxy, assembleHls };
