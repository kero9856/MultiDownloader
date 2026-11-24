// probe.js - READ-ONLY check. Downloads nothing except playlists + a few size probes. Touches no files.
// Run from the project folder:  node probe.js
const fs = require('fs');
const path = require('path');

const DIR = 'downloads/a827db505e3b8434';
const URL0 = 'https://nebula.bright67.online/hls/a4f371b5-3a4c-4824-b469-e46a0a8e5b45/master.m3u8';
const WANT_HEIGHT = 1080;
// [start second, missing seconds] taken from the gaps.js report of master.mp4
const GAPS = [[1572, 336], [4308, 400], [4840, 268], [5120, 728], [5892, 220]];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const clock = (s) => { s = Math.round(s); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const nq = (u) => u.split('?')[0]; // hide tokens when printing
const get = (u, o = {}) => fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) } });
async function text(u) { const r = await get(u); if (!r.ok) throw new Error(`HTTP ${r.status} for ${nq(u)}`); return r.text(); }

async function remoteSize(u) {
  try {
    const h = await get(u, { method: 'HEAD' });
    const n = Number(h.headers.get('content-length'));
    if (h.ok && n > 1) return n;
  } catch { /* try GET */ }
  try {
    const g = await get(u, { headers: { Range: 'bytes=0-0' } });
    const m = /\/(\d+)\s*$/.exec(g.headers.get('content-range') || '');
    g.body?.cancel().catch(() => {});
    if (m) return Number(m[1]);
  } catch { /* unknown */ }
  return 0;
}

(async () => {
  // 1) master -> chosen variant -> media playlist
  let url = URL0, body = await text(url);
  if (body.includes('#EXT-X-STREAM-INF')) {
    const L = body.split(/\r?\n/), vars = [];
    for (let i = 0; i < L.length; i++) {
      if (!L[i].startsWith('#EXT-X-STREAM-INF')) continue;
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(L[i]);
      const bw = Number((/BANDWIDTH=(\d+)/.exec(L[i]) || [])[1]) || 0;
      const uri = L[i + 1].trim();
      vars.push({ uri: new URL(uri, url).toString(), w: res ? +res[1] : 0, h: res ? +res[2] : 0, bw });
    }
    console.log('Variants:'); vars.forEach((v) => console.log(`  ${v.w}x${v.h}  ${Math.round(v.bw / 1000)} kbps  ${nq(v.uri)}`));
    const ok = vars.filter((v) => Math.min(v.w, v.h) <= WANT_HEIGHT || v.h <= WANT_HEIGHT);
    const pick = (ok.length ? ok : vars).sort((a, b) => (b.h - a.h) || (b.bw - a.bw))[0];
    console.log(`Chosen: ${pick.w}x${pick.h}\n`);
    url = pick.uri; body = await text(url);
  }
  const lines = body.split(/\r?\n/);
  const segs = []; let dur = 0, map = null, key = null, seq = 0;
  for (const ln of lines) {
    let m;
    if ((m = /^#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(ln))) seq = +m[1];
    else if (ln.startsWith('#EXT-X-MAP')) map = new URL(/URI="([^"]+)"/.exec(ln)[1], url).toString();
    else if (ln.startsWith('#EXT-X-KEY') && !/METHOD=NONE/.test(ln)) key = ln;
    else if ((m = /^#EXTINF:([\d.]+)/.exec(ln))) dur = parseFloat(m[1]);
    else if (ln.trim() && !ln.startsWith('#')) segs.push({ uri: new URL(ln.trim(), url).toString(), dur });
  }
  let t = 0; segs.forEach((s) => { s.start = t; t += s.dur; s.end = t; });
  console.log(`Segments: ${segs.length}   total: ${clock(t)}   media-sequence: ${seq}`);
  console.log(`Init (EXT-X-MAP): ${map ? nq(map) : 'NONE (segments are self-contained, e.g. .ts)'}`);
  console.log(`Encryption: ${key ? key.slice(0, 80) : 'none'}`);
  console.log(`First segment: ${nq(segs[0].uri)}   last: ${nq(segs[segs.length - 1].uri)}\n`);

  // 2) what is on disk
  const disk = new Map();
  for (const f of fs.readdirSync(DIR)) {
    const m = /-Frag(\d+)(\.part)?$/.exec(f);
    if (m) disk.set(+m[1], { size: fs.statSync(path.join(DIR, f)).size, part: !!m[2] });
  }
  console.log(`Fragment files on disk: ${disk.size} (${[...disk.values()].filter((d) => d.part).length} incomplete .part)`);

  // 3) numbering: is FragN = segment N (1-based) or segment N+1 (0-based)? compare sizes with the server
  const votes = { one: 0, zero: 0 };
  for (const n of [1100, 1200, 1300, 1400, 1500]) {
    const d = disk.get(n);
    if (!d || d.part || !segs[n - 1]) continue;
    const a = await remoteSize(segs[n - 1].uri), b = segs[n] ? await remoteSize(segs[n].uri) : 0;
    const hitOne = a && Math.abs(a - d.size) <= 16, hitZero = b && Math.abs(b - d.size) <= 16;
    console.log(`  Frag${n}: disk ${d.size} | segment#${n - 1}(0-based) ${a} | segment#${n}(0-based) ${b}`);
    if (hitOne && !hitZero) votes.one++; else if (hitZero && !hitOne) votes.zero++;
  }
  const base = votes.one > votes.zero ? 1 : votes.zero > votes.one ? 0 : null;
  console.log(base === null ? '  Numbering: could not decide (server did not give sizes). Send me this output.' : `  Numbering: FragN is segment index ${base === 1 ? 'N-1 (frags are 1-based)' : 'N (frags are 0-based)'}`);
  const fragOf = (i) => i + (base === 1 ? 1 : 0); // segment index (0-based) -> Frag number

  // 4) gaps -> segments -> on disk or missing
  console.log('\nGaps in master.mp4:');
  let needTotal = 0, haveTotal = 0;
  for (const [at, miss] of GAPS) {
    const a = at - 2, b = at + miss + 2;
    const idx = segs.map((s, i) => i).filter((i) => segs[i].start >= a && segs[i].end <= b);
    if (!idx.length) { console.log(`  ${clock(at)} +${miss}s: no segments matched`); continue; }
    const have = idx.filter((i) => { const d = disk.get(fragOf(i)); return d && !d.part; });
    const need = idx.filter((i) => !have.includes(i));
    const runs = []; let s = null, p = null;
    for (const i of need) { if (s === null) s = p = i; else if (i === p + 1) p = i; else { runs.push(s === p ? `${s}` : `${s}-${p}`); s = p = i; } }
    if (s !== null) runs.push(s === p ? `${s}` : `${s}-${p}`);
    needTotal += need.length; haveTotal += have.length;
    console.log(`  ${clock(at)} -> ${clock(at + miss)}  segments ${idx[0]}-${idx[idx.length - 1]} (${idx.length}, ${clock(segs[idx[0]].start)}..${clock(segs[idx[idx.length - 1]].end)})  on disk: ${have.length}  to download: ${need.length}${runs.length ? '  [' + runs.join(', ') + ']' : ''}`);
  }
  const avg = 2.9e6;
  console.log(`\nSummary: ${haveTotal} segments already on disk, ${needTotal} to download (about ${(needTotal * avg / 1e6).toFixed(0)} MB).`);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
