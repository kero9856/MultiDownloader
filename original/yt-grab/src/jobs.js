// Download jobs. yt-dlp writes into a permanent folder (one per link + quality), so:
//  - an interrupted download (internet loss, server restart, Cancel) resumes where it stopped,
//  - finished files are never deleted,
//  - asking for the same link + quality again attaches to the running job or returns the finished file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const config = require('./config');
const { AppError, fromYtDlp } = require('./errors');
const history = require('./history');
const { baseFlags, flagsForOption, validateUrl, ytdlp } = require('./youtube');

const jobs = new Map(); // in memory only; the files on disk are what matters
const PREFIX = 'YTG_PROGRESS';
const PROGRESS_RE = new RegExp(`${PREFIX}\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)`);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }; // "NA"/"None" -> 0

const activeCount = () => [...jobs.values()].filter((j) => ['queued', 'downloading', 'processing'].includes(j.status)).length;
const safeName = (title) => String(title || '').replace(/[^\w\s.-]/g, '').trim().slice(0, 100) || 'video';

/** Stop yt-dlp AND everything it started. On Windows yt-dlp.exe runs a hidden child process, and a plain kill()
 *  leaves that child downloading in the background (a second download then fights it for the same file). */
function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else proc.kill();
  } catch { try { proc.kill(); } catch { /* already finished */ } }
}

/** Bytes already saved in a download folder (finished streams + .part files): what a resume continues from. */
function sizeOnDisk(dir) {
  let total = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f === 'job.json' || f === 'meta.json' || /\.(ytdl|temp)$/i.test(f)) continue;
      try { const st = fs.statSync(path.join(dir, f)); if (st.isFile()) total += st.size; } catch { /* vanished */ }
    }
  } catch { /* no folder yet */ }
  return total;
}

/**
 * Same link + same quality => same id => same folder => resume.
 * For direct media links (.m3u8, .mp4, ...) the query string is ignored, because that is where
 * expiring tokens live: a fresh link to the same stream continues the same download.
 */
const MEDIA_FILE_RE = /\.(m3u8|mpd|mp4|webm|mkv|mp3|m4a)$/i;
function jobId(cleanUrl, optionId) {
  const u = new URL(cleanUrl);
  const stable = MEDIA_FILE_RE.test(u.pathname) ? `${u.origin}${u.pathname}` : cleanUrl;
  return crypto.createHash('sha256').update(`${stable}\n${optionId}`).digest('hex').slice(0, 16);
}

/** A finished download is recorded in meta.json inside its folder. */
function readFinished(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const file = path.join(dir, path.basename(meta.file));
    return fs.existsSync(file) ? { file, ext: meta.ext } : null;
  } catch {
    return null;
  }
}

/** Remember a finished download in the history file. */
function recordHistory(job, url, optionId) {
  let bytes = 0;
  try { bytes = fs.statSync(job.file).size; } catch { /* file vanished */ }
  history.add({ id: job.id, type: ['mp3', 'm4a'].includes(job.ext) ? 'audio' : 'video', title: job.title, file: path.basename(job.file), path: job.file, bytes, url, optionId });
}

async function createJob({ url, optionId, title, totalBytes }) {
  const cleanUrl = await validateUrl(url);
  const opt = flagsForOption(optionId);
  const id = jobId(cleanUrl, optionId);
  const dir = path.join(config.DOWNLOAD_DIR, id);

  // Already running or finished in this session: just attach to it.
  let existing = jobs.get(id);
  // Cancel was just pressed: wait until the old yt-dlp has really stopped, so two of them never write the same file.
  if (existing && existing.cancelled && existing.exited) { await existing.exited; existing = jobs.get(id); }
  if (existing && existing.status !== 'error') return existing;

  fs.mkdirSync(dir, { recursive: true });

  const job = {
    id, dir, optionId, ext: opt.ext, title: String(title || 'video'),
    status: 'queued', percent: 0, stage: 0, streams: opt.streams,
    expectedTotal: Number.isFinite(totalBytes) && totalBytes > 0 && totalBytes < 5e10 ? totalBytes : 0, // size shown to the user before download
    doneBytes: 0, curBytes: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, eta: null,
    file: null, error: null, events: new EventEmitter(), lastProgress: Date.now(),
  };

  // Finished earlier (even before a server restart): no download needed.
  const finished = readFinished(dir);
  if (finished) {
    Object.assign(job, { file: finished.file, ext: finished.ext, status: 'done', percent: 100 });
    if (!history.has(id)) recordHistory(job, cleanUrl, optionId);
    jobs.set(id, job);
    forgetLater(job);
    return job;
  }

  if (activeCount() >= config.MAX_CONCURRENT_JOBS) {
    throw new AppError('The server is busy. Please try again in a moment.', 503, 'BUSY');
  }
  // Resuming: show the progress that is already on disk right away (instead of starting the bar from 0%).
  const already = sizeOnDisk(dir);
  if (already > 0) {
    job.disk = already; job.lastDisk = Date.now(); job.downloadedBytes = already;
    if (job.expectedTotal) { job.totalBytes = job.expectedTotal; job.percent = Math.min(95, (already / job.expectedTotal) * 95); }
  }
  // Remember what this download is, so it can be offered for resuming after a restart.
  try {
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ url: cleanUrl, optionId, title: job.title, totalBytes: job.expectedTotal, createdAt: Date.now() }));
  } catch { /* not critical */ }
  jobs.set(id, job);
  run(job, cleanUrl, opt).catch(() => {});
  return job;
}

/** Speed options chosen on the page. A speed limit always uses the normal downloader (aria2c would ignore it). */
function speedFlags() {
  const { mode, limitMBps } = config.speed;
  const flags = { concurrentFragments: mode === 'normal' ? 4 : mode === 'max' ? 32 : config.CONCURRENT_FRAGMENTS };
  if (limitMBps > 0) flags.limitRate = `${limitMBps}M`;
  else if (mode === 'max' && config.aria2Available) { flags.downloader = 'aria2c'; flags.downloaderArgs = 'aria2c:-x 16 -s 16 -k 1M'; }
  return flags;
}

async function run(job, url, opt) {
  const { ext, streams, ...dlFlags } = opt;
  const flags = {
    ...baseFlags(),
    ...dlFlags,
    output: path.join(job.dir, 'download.%(ext)s'),
    newline: true,
    progressTemplate: `download:${PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
    ...speedFlags(),
    continue: true, // resume from the .part file left by an earlier attempt
    // Never give up because of a network drop: wait (up to 10 s between tries) and carry on.
    socketTimeout: 15, // a stuck connection is dropped after 15 s and re-opened
    retries: 'infinite',
    fragmentRetries: 'infinite',
    retrySleep: ['http:exp=1:10', 'fragment:exp=1:10'],
  };
  job.status = 'downloading';
  emit(job);

  let stderr = '', proc, restarts = 0;

  // While yt-dlp is waiting for the internet there are no progress lines: show 0 speed instead of a stale one.
  // Also used when yt-dlp prints no progress lines (aria2c downloads, or the internet dropped): read the folder size instead.
  let lastDisk = sizeOnDisk(job.dir), lastDiskAt = Date.now();
  let stallSize = lastDisk, stallAt = Date.now();
  const watchdog = setInterval(() => {
    // Stalled (no new data for a while): stop yt-dlp; the loop below starts it again and it resumes from the saved part.
    const nowSize = sizeOnDisk(job.dir);
    if (nowSize > stallSize) { stallSize = nowSize; stallAt = Date.now(); }
    else if (config.STALL_SECONDS > 0 && job.status === 'downloading' && !job.cancelled && Date.now() - stallAt > config.STALL_SECONDS * 1000) {
      job.stalled = true; stallAt = Date.now(); killTree(job.proc);
    }
    if (job.status !== 'downloading' || Date.now() - job.lastProgress < 3000) { lastDisk = sizeOnDisk(job.dir); lastDiskAt = Date.now(); return; }
    const disk = sizeOnDisk(job.dir), now = Date.now();
    const sp = Math.max(0, (disk - lastDisk) / ((now - lastDiskAt) / 1000));
    const grand = Math.max(job.expectedTotal, job.totalBytes, disk);
    lastDisk = disk; lastDiskAt = now; job.disk = disk;
    job.downloadedBytes = disk; job.totalBytes = grand; job.speed = sp;
    job.eta = sp > 0 && grand > disk ? Math.round((grand - disk) / sp) : null;
    job.percent = grand ? Math.min(95, (disk / grand) * 95) : job.percent;
    emit(job);
  }, 1000);

  const attach = (proc) => {
  proc.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const m = PROGRESS_RE.exec(line);
      if (m) {
        job.lastProgress = Date.now();
        const [downloaded, total, estimate, speed, eta] = m.slice(1).map(num);
        const curTotal = total || estimate;
        // Bytes went backwards => yt-dlp moved on to the next stream (e.g. audio after video).
        if (job.stage < job.streams - 1 && downloaded + 1024 < job.curBytes) { // each stream switch counts at most once
          job.doneBytes += job.curBytes;
          job.stage = Math.min(job.stage + 1, job.streams - 1);
        }
        job.curBytes = downloaded;
        // What is really saved on disk (checked once a second) also counts, so a resumed download never shows less than it has.
        if (Date.now() - (job.lastDisk || 0) > 1000) { job.lastDisk = Date.now(); job.disk = sizeOnDisk(job.dir); }
        const done = job.disk > 0 ? job.disk : job.doneBytes + downloaded; // the real size of the folder is the truth
        const grand = job.expectedTotal > 0
          ? Math.max(job.expectedTotal, done)
          : Math.max(job.doneBytes + curTotal, done);
        job.downloadedBytes = done;
        job.totalBytes = grand;
        job.speed = speed;
        job.eta = speed > 0 && grand > done ? Math.round((grand - done) / speed) : (eta || null);
        job.percent = grand ? Math.min(95, (done / grand) * 95) : job.percent;
        emit(job);
      } else if (/\[(Merger|ExtractAudio|VideoConvertor|Fixup)/.test(line)) {
        job.status = 'processing';
        job.percent = 96;
        emit(job);
      }
    }
  });
  proc.stderr.on('data', (c) => (stderr += c.toString()));
  };
  const launch = () => { proc = ytdlp.exec(url, flags); job.proc = proc; attach(proc); return proc; };

  try {
    for (;;) {
      try { await launch(); break; }
      catch (e) {
        if (job.cancelled || !job.stalled || restarts >= 200) throw e;
        job.stalled = false; restarts++;
        job.curBytes = 0; // after a restart the counter starts over: that is NOT a new stream
        console.log(`[download] stalled, resuming (${restarts})`);
        job.speed = 0; job.eta = null; emit(job);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    // The finished file is "download.<ext>"; intermediates (download.f137.mp4, *.part, *.ytdl) don't match.
    const found = fs.readdirSync(job.dir).find((f) => /^download\.[a-z0-9]+$/i.test(f) && !/\.(part|ytdl|temp)$/i.test(f));
    if (!found) throw new Error('Output file missing');
    const finalExt = path.extname(found).slice(1) || ext;
    const finalName = `${safeName(job.title)}.${finalExt}`;
    fs.renameSync(path.join(job.dir, found), path.join(job.dir, finalName));
    fs.writeFileSync(path.join(job.dir, 'meta.json'), JSON.stringify({ file: finalName, ext: finalExt, title: job.title }));
    job.file = path.join(job.dir, finalName);
    job.ext = finalExt;
    job.status = 'done';
    job.percent = 100;
    recordHistory(job, url, job.optionId);
  } catch (err) {
    if (job.cancelled) return; // user pressed Cancel: cancelJob() already handled it, partial files are kept
    err.stderr = err.stderr || stderr;
    const appErr = fromYtDlp(err);
    job.status = 'error';
    job.error = { message: appErr.message, code: appErr.code };
  } finally {
    clearInterval(watchdog);
  }
  emit(job);
  forgetLater(job);
}

const emit = (job) => job.events.emit('update', publicState(job));
const publicState = (job) => ({
  id: job.id, status: job.status, percent: Math.round(job.percent), error: job.error,
  downloadedBytes: Math.round(job.downloadedBytes), totalBytes: Math.round(job.totalBytes), speed: Math.round(job.speed), eta: job.eta,
});

/** Drop a finished/failed job from MEMORY after a while. Files on disk are never touched. */
function forgetLater(job) {
  setTimeout(() => { if (jobs.get(job.id) === job) jobs.delete(job.id); }, config.JOB_TTL_MS).unref();
}

/** Stop a running download. Partial files stay on disk, so downloading the same link again resumes it. */
function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancelled = true;
  killTree(job.proc);
  // Resolves when the process is gone (max 5 s), so the next Download can safely continue the same files.
  job.exited = Promise.race([
    job.proc ? Promise.resolve(job.proc).then(() => {}, () => {}) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  job.status = 'error';
  job.error = { message: 'Cancelled.', code: 'CANCELLED' };
  emit(job);
  setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, 1500);
  return true;
}

const ID_RE = /^[0-9a-f]{16}$/;

/** Downloads that stopped before finishing (kept on disk), so the page can offer "Resume". */
function listUnfinished() {
  let names = [];
  try { names = fs.readdirSync(config.DOWNLOAD_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const out = [];
  for (const id of names) {
    if (!ID_RE.test(id)) continue;
    const dir = path.join(config.DOWNLOAD_DIR, id);
    if (readFinished(dir)) continue;
    const live = jobs.get(id);
    if (live && live.status !== 'error') continue; // running right now
    let req;
    try { req = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch { continue; }
    let bytes = 0, updatedAt = 0;
    for (const f of fs.readdirSync(dir)) {
      if (f === 'job.json') continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        if (st.isFile()) { bytes += st.size; updatedAt = Math.max(updatedAt, st.mtimeMs); }
      } catch { /* file vanished */ }
    }
    if (bytes < 1024) continue; // nothing downloaded yet: not worth listing
    out.push({ id, title: req.title, url: req.url, optionId: req.optionId, totalBytes: req.totalBytes || 0, partialBytes: bytes, updatedAt });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Delete one unfinished download's partial files (only when the user asks). Finished files are never touched. */
function discardUnfinished(id) {
  if (!ID_RE.test(String(id))) return false;
  const live = jobs.get(id);
  if (live && ['queued', 'downloading', 'processing'].includes(live.status)) return false;
  const dir = path.join(config.DOWNLOAD_DIR, id);
  if (readFinished(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  jobs.delete(id);
  return true;
}

module.exports = { jobs, createJob, publicState, cancelJob, listUnfinished, discardUnfinished };
