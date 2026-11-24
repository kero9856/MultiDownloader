// Preview in pieces: fetches only a short piece starting wherever the user chooses, at the quality they picked,
// so they can check a video (or jump to the part they want) before downloading.
// "Save what I watched" joins every piece that was fetched into ONE file inside the program's downloads folder.
// Pieces live in the system's temp folder (NOT in the downloads folder): they are cleared every time the program
// starts, and old ones are removed while it runs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const config = require('./config');
const { AppError, fromYtDlp } = require('./errors');
const { baseFlags, flagsForOption, validateUrl, ytdlp } = require('./youtube');

const PREVIEW_DIR = path.join(os.tmpdir(), 'ytgrab-pieces');
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // a piece older than this is deleted
// Piece grid (keep equal to FIRST / STEP in public/app.js): the first piece is 0-15 s, then 15-25, 25-35, ...
const FIRST_SECONDS = 15;
const STEP_SECONDS = 10;
const CHUNK_SECONDS = STEP_SECONDS;
const DEFAULT_SECONDS = FIRST_SECONDS;  // used when a request doesn't say how long a piece should be
const MAX_SECONDS = 60;
const TIMEOUT_MS = 120 * 1000;
const MAX_PARALLEL = 4;
const ID_RE = /^[0-9a-f]{16}$/;
const MEDIA_RE = /\.(mp4|m4a|mp3|webm|mkv|opus|ogg|aac)$/i;

fs.rmSync(PREVIEW_DIR, { recursive: true, force: true }); // start clean
fs.mkdirSync(PREVIEW_DIR, { recursive: true });

const pieceId = (url, optionId, start, length) => crypto.createHash('sha256').update(`${url}\n${optionId}\n${start}\n${length}`).digest('hex').slice(0, 16);

let running = 0;

/** Delete pieces that were made a long time ago (nothing is kept for later). */
function prune() {
  try {
    const now = Date.now();
    for (const d of fs.readdirSync(PREVIEW_DIR)) {
      const full = path.join(PREVIEW_DIR, d);
      if (!pending.has(d) && now - fs.statSync(full).mtimeMs > MAX_AGE_MS) fs.rmSync(full, { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}
const pending = new Map(); // id -> promise: the same piece asked twice is fetched once

/** The finished clip inside a piece folder (the biggest media file; yt-dlp may add a suffix to the name). */
function findFile(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => MEDIA_RE.test(f))
      .map((f) => ({ f: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
      .sort((a, b) => b.size - a.size)[0]?.f || null;
  } catch {
    return null;
  }
}

/** Re-wrap a cut mp4 with clean timestamps (no re-encoding). If anything goes wrong the original is kept. */
function cleanMp4(file) {
  if (!/\.mp4$/i.test(file)) return Promise.resolve();
  const tmp = `${file}.tmp`;
  return new Promise((resolve) => {
    const ff = spawn(ffmpegPath, ['-y', '-fflags', '+genpts', '-i', file, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-f', 'mp4', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (c) => (err = (err + c).slice(-1500)));
    const fail = (why) => { console.error('[piece clean-up skipped]', why); fs.rm(tmp, { force: true }, () => resolve()); };
    ff.on('error', (e) => fail(e.message));
    ff.on('close', (code) => {
      if (code !== 0) return fail(err);
      try { fs.renameSync(tmp, file); } catch (e) { return fail(e.message); }
      resolve();
    });
  });
}

/** Fetch (or reuse) the piece of `lengthRaw` seconds that starts at `startRaw` seconds. */
async function createPreview(rawUrl, optionId, startRaw = 0, lengthRaw = DEFAULT_SECONDS) {
  const url = await validateUrl(rawUrl);
  const opt = flagsForOption(optionId);
  const start = Math.min(Math.max(Math.floor(Number(startRaw)) || 0, 0), 48 * 3600);
  const length = Math.min(Math.max(Math.floor(Number(lengthRaw)) || DEFAULT_SECONDS, 1), MAX_SECONDS);
  const id = pieceId(url, optionId, start, length);
  const dir = path.join(PREVIEW_DIR, id);

  prune();
  if (findFile(dir)) return { id }; // already fetched while watching: no new data used
  if (pending.has(id)) return pending.get(id);
  if (running >= MAX_PARALLEL) throw new AppError('Other pieces are being prepared. Try again in a moment.', 503, 'BUSY');

  const work = (async () => {
    running++;
    fs.mkdirSync(dir, { recursive: true });
    const { ext, streams, ...dl } = opt;
    let timedOut = false;
    let timer;
    try {
      // Each piece is a fresh yt-dlp run that re-reads the site's page. Sites such as Facebook sometimes answer with a
      // different page ("Cannot parse data") for one request and fine for the next, so try again a couple of times.
      for (let attempt = 0; ; attempt++) {
        const proc = ytdlp.exec(url, {
          ...baseFlags(), // new random User-Agent on every attempt
          ...dl,
          output: path.join(dir, 'preview.%(ext)s'),
          downloadSections: `*${start}-${start + length}`, // only this part is fetched
          forceKeyframesAtCuts: true, // exact cut: video and audio both start at `start` (no earlier keyframe, no silent replay)
          retries: 3,
          fragmentRetries: 3,
        });
        timer = setTimeout(() => { timedOut = true; try { proc.kill(); } catch { /* done */ } }, TIMEOUT_MS);
        try {
          await proc;
          break;
        } catch (e) {
          clearTimeout(timer);
          const text = String(e.stderr || e.message || '');
          if (timedOut || attempt >= 2 || !/Cannot parse data|Unable to download webpage|HTTP Error 5\d\d/i.test(text)) throw e;
          console.log(`[piece] temporary site error, retrying (${attempt + 1}/2)`);
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      const made = findFile(dir);
      if (!made) throw new AppError('Could not prepare this piece of the video.', 502, 'PREVIEW_FAILED');
      await cleanMp4(made); // cut pieces can have odd timestamps that browsers refuse to play: rewrite them cleanly
      return { id };
    } catch (err) {
      fs.rm(dir, { recursive: true, force: true }, () => {});
      if (timedOut) throw new AppError('This piece took too long. Try again, or pick a lower quality.', 504, 'PREVIEW_TIMEOUT');
      throw err instanceof AppError ? err : fromYtDlp(err);
    } finally {
      clearTimeout(timer);
      running--;
    }
  })();

  pending.set(id, work);
  work.then(() => pending.delete(id), () => pending.delete(id));
  return work;
}

/** Path of a saved piece, or null (unknown id). */
function getPreviewFile(id) {
  if (!ID_RE.test(String(id))) return null;
  return findFile(path.join(PREVIEW_DIR, id));
}

/**
 * Join EVERYTHING that was watched into ONE file in the program's downloads folder, with no new data used.
 * Pieces are on a fixed grid (0-15 s, then 10 s each). Watched stretches that are not next to each other
 * (e.g. 0:00-5:00 and 10:00-11:00) are placed one after another in time order; the part skipped in between is left out.
 */
async function assembleWatched(rawUrl, optionId, duration = 0, title = '') {
  const url = await validateUrl(rawUrl);
  flagsForOption(optionId); // validates the quality id
  const limit = duration > 0 ? Math.ceil(duration) : 48 * 3600;
  const files = [], runs = [];
  for (let start = 0, n = 0; start < limit && n < 5000; n++) {
    const length = start === 0 ? FIRST_SECONDS : STEP_SECONDS;
    const f = findFile(path.join(PREVIEW_DIR, pieceId(url, optionId, start, length)));
    if (f) {
      files.push(f);
      const end = duration > 0 ? Math.min(start + length, limit) : start + length;
      const last = runs[runs.length - 1];
      if (last && last.end === start) last.end = end; else runs.push({ start, end });
    }
    start += length;
  }
  if (!files.length) throw new AppError('Nothing has been watched yet at this quality.', 404, 'NOTHING_WATCHED');

  // Neighbouring pieces form stretches, e.g. [{from: 0, seconds: 25}, {from: 55, seconds: 10}].
  const ranges = runs.map((r) => ({ from: r.start, seconds: Math.max(r.end - r.start, 0) }));

  const ext = path.extname(files[0]).slice(1) || 'mp4';
  fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
  const base = String(title || '').replace(/[^\w\s.-]/g, '').trim().slice(0, 80) || 'video';
  let out = path.join(config.DOWNLOAD_DIR, `${base} (watched part).${ext}`);
  for (let n = 2; fs.existsSync(out); n++) out = path.join(config.DOWNLOAD_DIR, `${base} (watched part ${n}).${ext}`);

  const list = path.join(os.tmpdir(), `ytgrab-join-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      ff.stderr.on('data', (c) => (err = (err + c).slice(-2000)));
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err || `ffmpeg exited with ${code}`))));
    });
  } catch (e) {
    fs.rm(out, { force: true }, () => {});
    console.error('[join error]', e.message);
    throw new AppError('Could not join the watched pieces.', 500, 'JOIN_FAILED');
  } finally {
    fs.rm(list, { force: true }, () => {});
  }
  return { file: path.basename(out), dir: config.DOWNLOAD_DIR, from: ranges[0].from, seconds: ranges.reduce((a, r) => a + r.seconds, 0), ranges, bytes: fs.statSync(out).size };
}

module.exports = { assembleWatched, createPreview, getPreviewFile, CHUNK_SECONDS };
