// gaps.js - finds holes / jumps in a video file's timeline WITHOUT decoding it (fast).
// Usage:  node gaps.js "<ffmpeg.exe path>" "<video file>"
const { spawn } = require('child_process');
const readline = require('readline');
const [ffmpeg, file] = process.argv.slice(2);
if (!ffmpeg || !file) { console.log('Usage: node gaps.js "<ffmpeg path>" "<video file>"'); process.exit(1); }

const fmt = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}`; };

const ff = spawn(ffmpeg, ['-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'framecrc', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
let tb = null, prev = null, first = null, count = 0, errs = '';
const gaps = [];
ff.stderr.on('data', (c) => { errs += c; });
readline.createInterface({ input: ff.stdout }).on('line', (line) => {
  const t = /^#tb 0:\s*(\d+)\/(\d+)/.exec(line);
  if (t) { tb = Number(t[1]) / Number(t[2]); return; }
  if (line[0] === '#' || !tb) return;
  const p = line.split(',').map((x) => x.trim());          // stream, dts, pts, duration, size, crc
  const dts = Number(p[1]) * tb;
  if (!Number.isFinite(dts)) return;
  if (first === null) first = dts;
  if (prev !== null) {
    const step = dts - prev;
    if (step > 0.5 || step < -0.5) gaps.push({ at: prev - first, to: dts - first, step });
  }
  prev = dts; count++;
});
ff.on('close', () => {
  const total = prev === null ? 0 : prev - first;
  console.log(`Video packets read: ${count}, timeline length: ${fmt(total)}`);
  if (errs.trim()) console.log('ffmpeg messages:\n' + errs.trim().split('\n').slice(0, 15).join('\n'));
  if (!gaps.length) { console.log('No gaps found: the timeline is continuous.'); return; }
  console.log(`\nFound ${gaps.length} problem(s):`);
  for (const g of gaps) {
    console.log(g.step > 0
      ? `  MISSING about ${g.step.toFixed(1)} s after ${fmt(g.at)}  (jumps to ${fmt(g.to)})`
      : `  Goes BACK ${(-g.step).toFixed(1)} s at ${fmt(g.at)}  (repeated part)`);
  }
});
