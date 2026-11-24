// Everything that touches yt-dlp lives here: URL validation, metadata, and format selection.
const ytdlp = require('yt-dlp-exec');
const ffmpegPath = require('ffmpeg-static');
const config = require('./config');
const { AppError, fromYtDlp } = require('./errors');

const randomUA = () => config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)];

/** Flags shared by every yt-dlp call. */
function baseFlags({ playlist = false } = {}) {
  const flags = {
    noWarnings: true,
    noCheckCertificates: true,
    userAgent: randomUA(),
    socketTimeout: 20,
    retries: 5,
    ffmpegLocation: ffmpegPath,
    jsRuntimes: 'node', // lets yt-dlp solve YouTube's JS challenge with the Node you already have
  };
  if (!playlist) flags.noPlaylist = true;
  if (config.COOKIES_FILE) flags.cookies = config.COOKIES_FILE;
  else if (config.COOKIES_FROM_BROWSER) flags.cookiesFromBrowser = config.COOKIES_FROM_BROWSER;
  return flags;
}

const dns = require('dns').promises;
const net = require('net');

/** True for loopback / private / link-local addresses: never fetched on the user's behalf. */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

/** True when the host resolves only to public addresses (safe for the server to contact). */
async function isPublicHost(host) {
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    return addrs.length > 0 && !addrs.some((a) => isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Accept any public http(s) link. Local/private network addresses are blocked so the
 * server can't be tricked into fetching internal pages. With RESTRICT_SITES=true only
 * the built-in domain list is allowed.
 */
async function validateUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    throw new AppError('That doesn’t look like a valid URL.', 400, 'BAD_URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('Use a link that starts with http:// or https://', 400, 'BAD_URL');
  url.username = ''; url.password = '';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (config.RESTRICT_SITES && !config.ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new AppError('This site isn’t enabled on this server.', 400, 'BAD_URL');
  }
  const blocked = new AppError('Links to local or private network addresses aren’t allowed.', 400, 'BAD_URL');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw blocked;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) throw blocked;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Could not find that website. Check the link and your connection.', 400, 'BAD_URL');
  }
  const okEmbed = /^(?:www\.|m\.)?ok\.ru$/.test(host) && /^\/videoembed\/(\d+)/.exec(url.pathname);
  if (okEmbed) url.pathname = `/video/${okEmbed[1]}`;
  // Preview-mirror links (often shared in chats) point to the same post on x.com.
  if (['fxtwitter.com', 'vxtwitter.com', 'fixupx.com', 'fixvx.com', 'twittpr.com'].includes(host.replace(/^www\./, ''))) url.hostname = 'x.com';
  return url.toString();
}

const fmtDuration = (s) => {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const size = (f) => f.filesize || f.filesize_approx || 0;

/** fetch() that re-checks every redirect hop, so the server never reaches a private address. */
async function safeFetch(url, opts = {}, hops = 3) {
  for (let i = 0; i <= hops; i++) {
    const host = new URL(url).hostname.toLowerCase();
    if (!host.endsWith('.googlevideo.com') && !(await isPublicHost(host))) throw new Error('blocked host');
    const res = await fetch(url, { ...opts, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      res.body?.cancel().catch(() => {});
      url = new URL(loc, url).toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

/** Total byte size of a remote file: 1-byte ranged GET first, HEAD as fallback. 0 when unknown. */
async function probeSize(url, headers, tag = '') {
  for (const method of ['GET', 'HEAD']) {
    try {
      const res = await safeFetch(url, {
        method,
        headers: { ...(headers || {}), ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) },
        signal: AbortSignal.timeout(7000),
      });
      const range = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '');
      const len = Number(res.headers.get('content-length'));
      res.body?.cancel().catch(() => {});
      const total = range ? Number(range[1]) : (res.status === 200 && len > 1 ? len : 0);
      if (total > 1) return total;
      console.log(`[size] ${tag} ${method} gave status ${res.status}, no total`);
    } catch (e) {
      console.log(`[size] ${tag} ${method} failed: ${e.message}`);
    }
  }
  return 0;
}

/** Approximate size of an HLS stream: sample a few segments, then extrapolate over the full duration. */
async function hlsEstimate(f, duration, tag) {
  try {
    const res = await safeFetch(f.url, { headers: f.http_headers || {}, signal: AbortSignal.timeout(7000) });
    if (!res.ok) return 0;
    const text = await res.text();
    if (text.includes('#EXT-X-STREAM-INF')) return 0; // master playlist, not a media playlist
    const segs = [];
    let pending = 0, total = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = /^#EXTINF:([\d.]+)/.exec(line);
      if (m) { pending = parseFloat(m[1]); continue; }
      if (line && !line.startsWith('#')) {
        segs.push({ url: new URL(line, f.url).toString(), dur: pending });
        total += pending; pending = 0;
      }
    }
    if (!segs.length || !total) return 0;
    const n = Math.min(4, segs.length);
    const picks = Array.from({ length: n }, (_, i) => segs[Math.floor((i * (segs.length - 1)) / Math.max(n - 1, 1))]);
    let bytes = 0, secs = 0;
    for (const sg of picks) {
      const b = await probeSize(sg.url, f.http_headers, `${tag}/seg`);
      if (b) { bytes += b; secs += sg.dur; }
    }
    return secs ? Math.round((bytes / secs) * (duration || total)) : 0;
  } catch (e) {
    console.log(`[size] ${tag} hls sampling failed: ${e.message}`);
    return 0;
  }
}

/**
 * Size in bytes of one stream, most reliable source first:
 *  1) filesize reported by yt-dlp,
 *  2) `clen` in the media URL (YouTube writes the exact byte length there),
 *  3) a 1-byte ranged request to the media server (Content-Range total),
 *  4) bitrate × duration (inaccurate, flagged as an estimate).
 * Returns { bytes, exact }. Logs which source was used so problems are easy to spot.
 */
async function streamSize(f, duration) {
  const tag = `${f.format_id}/${f.ext}/${f.height ? f.height + 'p' : 'audio'}`;
  const done = (bytes, exact, via) => {
    console.log(`[size] ${tag} via=${via} bytes=${bytes}`);
    return { bytes, exact };
  };

  if (f.filesize) return done(f.filesize, true, 'filesize');

  let u = null;
  try { u = new URL(f.url); } catch { /* no usable url */ }

  if (u) {
    const clen = Number(u.searchParams.get('clen'));
    if (clen > 1) return done(clen, true, 'clen');

    const isMedia = (u.protocol === 'https:' || u.protocol === 'http:') && !String(f.protocol || '').includes('m3u8');
    if (isMedia) {
      const total = await probeSize(f.url, f.http_headers, tag);
      if (total > 1) return done(total, true, 'range-request');
    }
  }

  if (u && String(f.protocol || '').includes('m3u8') && !u.hostname.endsWith('googlevideo.com')) {
    const est = await hlsEstimate(f, duration, tag);
    if (est > 1) return done(est, false, 'hls-sampled');
  }

  // YouTube's HLS bitrates are peak values (estimates come out ~3x too big), so don't guess for those.
  // Other sites declare average bitrates, so bitrate × duration is a fair estimate there.
  if (String(f.protocol || '').includes('m3u8') && (!u || u.hostname.endsWith('googlevideo.com'))) return done(0, false, 'hls-size-unknown');
  if (f.filesize_approx) return done(f.filesize_approx, false, 'filesize_approx');
  const est = Math.round(((f.tbr || 0) * 1000 / 8) * duration);
  return done(est, false, 'bitrate-estimate');
}

// Some sites (OK.ru, ...) name formats instead of giving a height.
const NAMED_HEIGHTS = { mobile: 144, lowest: 240, low: 360, sd: 480, hd: 720, full: 1080, quad: 1440, ultra: 2160 };

/** Height from the real field, or guessed from names like "hd", "720p", or "1280x720". */
const guessHeight = (f) => {
  if (f.height) return f.height;
  const id = String(f.format_id || '').toLowerCase();
  if (NAMED_HEIGHTS[id]) return NAMED_HEIGHTS[id];
  const m = /(\d{3,4})p/.exec(`${id} ${f.format_note || ''}`) || /\d+x(\d{3,4})/.exec(f.resolution || '');
  return m ? Number(m[1]) : 0;
};
const hasVideo = (f) => f.url && f.vcodec !== 'none' && f.resolution !== 'audio only' && f.ext !== 'mhtml';

/**
 * Build the quality list. Each option is sized from the SAME streams the download
 * will pick (mp4/avc1 video + m4a audio).
 */
async function buildOptions(info) {
  const formats = info.formats || [];
  const duration = info.duration || 0;

  // Audio stream the download will merge in: prefer m4a, highest bitrate.
  const audioStreams = formats.filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none');
  const byAbr = (a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0);
  const bestAudio = audioStreams.filter((f) => f.ext === 'm4a').sort(byAbr)[0] || [...audioStreams].sort(byAbr)[0];
  const audio = bestAudio ? await streamSize(bestAudio, duration) : { bytes: 0, exact: false };

  // Candidate video stream per height, preferring mp4 (what the download selector prefers).
  const byHeight = new Map();
  for (const f of formats) {
    const h = guessHeight(f);
    if (!h || !hasVideo(f)) continue;
    (byHeight.get(h) || byHeight.set(h, []).get(h)).push(f);
  }
  const isHls = (f) => String(f.protocol || '').includes('m3u8');
  const pickVideo = (list) => {
    const best = (arr) => [...arr].sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
    const direct = list.filter((f) => !isHls(f));
    const pool = direct.length ? direct : list;
    const mp4 = pool.filter((f) => f.ext === 'mp4');
    return best(mp4.length ? mp4 : pool);
  };

  const labelFor = (h) => (h >= 2160 ? `${h}p · 4K` : h >= 1440 ? `${h}p · 2K` : `${h}p`);
  const heights = [...byHeight.keys()].sort((a, b) => b - a);
  const video = await Promise.all(heights.map(async (height) => {
    const f = pickVideo(byHeight.get(height));
    const hasAudio = f.acodec && f.acodec !== 'none';
    const v = await streamSize(f, duration);
    const bytes = v.bytes ? v.bytes + (hasAudio ? 0 : audio.bytes) : null;
    const exact = v.exact && (hasAudio || audio.exact);
    const shortSide = f.width ? Math.min(f.width, height) : height; // vertical videos: use the narrower side
    return {
      id: f.height ? `v${height}` : `f-${f.format_id}`, // no real height => download by exact format id
      type: 'video', height, label: labelFor(shortSide),
      short: shortSide, resolution: f.width ? `${f.width}×${height}` : null,
      ext: 'mp4', fps: f.fps || null, estimatedBytes: bytes, exact,
    };
  }));

  const hd = video.filter((v) => v.short >= 360); // user wants 360p and up
  let videoList = hd.length ? hd : video;
  if (!videoList.length && formats.some((f) => f.vcodec !== 'none')) {
    // Sites that don't report resolutions (direct files, simple players): one "Best available" choice.
    // Measure the real file size (direct file links answer a ranged request with their exact length).
    const cand = formats.filter(hasVideo).sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
    const probed = cand ? await streamSize(cand, duration) : { bytes: 0, exact: false };
    const bytes = info.filesize || probed.bytes || info.filesize_approx || null;
    videoList = [{ id: 'vbest', type: 'video', height: 0, short: 0, label: 'Best available', resolution: null, ext: 'mp4', fps: null, estimatedBytes: bytes, exact: !!info.filesize || (probed.exact && !!probed.bytes) }];
  }
  return {
    video: videoList,
    audio: [
      { id: 'a-m4a', type: 'audio', label: 'M4A', ext: 'm4a', note: 'Original quality', estimatedBytes: audio.bytes || null, exact: audio.exact },
      { id: 'a-mp3', type: 'audio', label: 'MP3', ext: 'mp3', note: '192 kbps', estimatedBytes: Math.round((192 * 1000 / 8) * duration) || null, exact: false },
    ],
  };
}

/**
 * Fallback for X/Twitter posts: when yt-dlp can't read the post, ask X's public embed endpoint for the
 * post's own media file (the video.twimg.com .m3u8 or .mp4 link) so it can be downloaded directly.
 */
async function findXMediaUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (!/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/i.test(u.hostname)) return null;
  const id = /\/status(?:es)?\/(\d+)/.exec(u.pathname)?.[1];
  if (!id) return null;
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  // Several public sources, tried in order: X's own embed data first, then two link-preview services.
  const sources = [
    ['x-embed', `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`],
    ['x-embed (no token)', `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=0&lang=en`],
    ['fxtwitter', `https://api.fxtwitter.com/status/${id}`],
    ['vxtwitter', `https://api.vxtwitter.com/Twitter/status/${id}`],
  ];
  for (const [name, api] of sources) {
    try {
      const res = await safeFetch(api, { headers: { 'User-Agent': config.USER_AGENTS[0], Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) { console.log(`[x fallback] ${name}: HTTP ${res.status}`); continue; }
      // Search the raw reply for video.twimg.com links: works whatever the reply's layout is.
      const text = (await res.text()).replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      const links = [...new Set(text.match(/https:\/\/video\.twimg\.com\/[^"'\s\\<>]+/g) || [])];
      const hls = links.find((l) => /\.m3u8/i.test(l));
      if (hls) return hls;
      const mp4 = links.filter((l) => /\.mp4/i.test(l))
        .sort((a, b) => (Number((/\/(\d+)x(\d+)\//.exec(b) || [])[1]) || 0) - (Number((/\/(\d+)x(\d+)\//.exec(a) || [])[1]) || 0))[0];
      if (mp4) return mp4;
      console.log(`[x fallback] ${name}: reply had no video link`);
    } catch (e) {
      console.log(`[x fallback] ${name}: ${e.message}`);
    }
  }
  return null;
}

const { spawn } = require('child_process');

/** Duration in seconds: from yt-dlp if it has it, else from other fields, else by asking ffmpeg to read the file header. */
async function resolveDuration(info) {
  if (info.duration > 0) return info.duration;

  // Other places yt-dlp sometimes puts it.
  if (info.duration_string) {
    const p = String(info.duration_string).split(':').map(Number);
    if (p.every(Number.isFinite)) return p.reduce((a, n) => a * 60 + n, 0);
  }
  const fmts = info.formats || [];
  const fromFmt = Math.max(0, ...fmts.map((f) => Number(f.duration) || 0));
  if (fromFmt > 0) return fromFmt;
  const fromFrags = Math.max(0, ...fmts.map((f) => (f.fragments || []).reduce((a, x) => a + (Number(x.duration) || 0), 0)));
  if (fromFrags > 0) return Math.round(fromFrags);

  // Last resort: ffmpeg prints "Duration: HH:MM:SS.xx" when it opens the file (only the header is read).
  const cand = fmts.filter((f) => f.url && f.vcodec !== 'none').sort((a, b) => (a.height || 0) - (b.height || 0))[0]
    || fmts.find((f) => f.url);
  if (!cand) return 0;
  return new Promise((resolve) => {
    const headers = Object.entries(cand.http_headers || {}).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
    const ff = spawn(ffmpegPath, ['-hide_banner', '-headers', headers, '-i', cand.url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const timer = setTimeout(() => { try { ff.kill(); } catch { /* done */ } }, 15000);
    ff.stderr.on('data', (c) => { err += c; if (err.length > 20000) err = err.slice(0, 20000); });
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
      resolve(m ? Math.round(+m[1] * 3600 + +m[2] * 60 + parseFloat(m[3])) : 0);
    };
    ff.on('error', done);
    ff.on('close', done);
  });
}

/** Subtitle tracks the video offers: every uploaded one, plus automatic captions (original language, English, Arabic). */
function buildSubtitles(info) {
  const out = [];
  const nameOf = (v, fb) => (Array.isArray(v) && v[0] && v[0].name) || fb;
  for (const [lang, v] of Object.entries(info.subtitles || {})) {
    if (lang === 'live_chat') continue;
    out.push({ lang, name: nameOf(v, lang), auto: false });
  }
  const auto = info.automatic_captions || {};
  const orig = Object.keys(auto).find((k) => k.endsWith('-orig'));
  const vidLang = String(info.language || '').toLowerCase();
  for (const k of new Set([orig, 'en', 'ar'].filter(Boolean))) {
    if (!auto[k] || out.some((o) => o.lang === k && !o.auto)) continue;
    const same = k === orig || (vidLang && k.toLowerCase().startsWith(vidLang));
    out.push({ lang: k, name: `${nameOf(auto[k], k).replace(/\s*\(Original\)/i, '')} (${same ? 'auto-generated' : 'auto-translated'})`, auto: true });
  }
  return out;
}

/** Fetch metadata + available qualities. */
async function getInfoUncached(rawUrl, viaFallback = false) {
  const url = await validateUrl(rawUrl);
  if (!viaFallback) {
    // X/Twitter posts: go straight to the post's own video file (fast); only use the post link if that isn't found.
    const direct = await findXMediaUrl(url);
    if (direct) {
      try { return await getInfoUncached(direct, true); } catch (e) { console.log('[x direct] failed, using the post link:', e.message); }
    }
  }
  try {
    let info = await ytdlp(url, { ...baseFlags(), dumpSingleJson: true });
    if (!info.formats && info.entries?.length) {
      // A post can hold several videos (X/Twitter): one video -> use it, several -> let the user pick.
      const withFormats = info.entries.filter((e) => e && e.formats && e.formats.length);
      if (withFormats.length === 1) info = withFormats[0];
      else if (withFormats.length > 1) throw new AppError(`This post has ${withFormats.length} videos. Pick one below.`, 400, 'MULTI_VIDEO');
      else throw new AppError('This link is a list of videos. Paste the link of one single video.', 400, 'IS_PLAYLIST');
    }
    if (info.is_live) throw new AppError('Live streams can’t be downloaded until they finish.', 400, 'LIVE');
    rememberFormats(url, info.formats);
    info.duration = await resolveDuration(info); // so every later step (sizes, seek bar) sees it
    return {
      url,
      id: info.id,
      title: info.title,
      channel: info.uploader || info.channel || 'Unknown channel',
      duration: info.duration || 0,
      durationText: fmtDuration(info.duration),
      thumbnail: info.thumbnail || (info.thumbnails || []).slice(-1)[0]?.url || null,
      options: await buildOptions(info),
      subtitles: buildSubtitles(info),
    };
  } catch (err) {
    throw err instanceof AppError ? err : fromYtDlp(err);
  }
}

const infoCache = new Map(); // url -> { at, data }
async function getInfo(rawUrl) {
  const key = String(rawUrl || '').trim();
  const hit = infoCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;
  const data = await getInfoUncached(rawUrl);
  infoCache.set(key, { at: Date.now(), data });
  if (infoCache.size > 300) infoCache.delete(infoCache.keys().next().value);
  return data;
}

/** List the videos inside a YouTube playlist (flat listing = fast, max 200). */
async function getPlaylist(rawUrl) {
  const url = await validateUrl(rawUrl);
  const host = new URL(url).hostname.toLowerCase();
  if (!(host === 'youtube.com' || host.endsWith('.youtube.com'))) {
    throw new AppError('Playlists are supported for YouTube only.', 400, 'BAD_URL');
  }
  try {
    const data = await ytdlp(url, { ...baseFlags({ playlist: true }), flatPlaylist: true, dumpSingleJson: true, playlistEnd: 200 });
    const entries = (data.entries || []).filter((e) => e && e.id).map((e) => ({
      id: e.id,
      title: e.title || 'Untitled video',
      duration: e.duration || 0,
      durationText: e.duration ? fmtDuration(e.duration) : '',
      channel: e.channel || e.uploader || data.channel || data.uploader || '',
      thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${e.id}`,
    }));
    if (!entries.length) throw new AppError('No videos found. The playlist may be empty or private.', 404, 'EMPTY_PLAYLIST');
    return { title: data.title || 'Playlist', channel: data.channel || data.uploader || '', count: entries.length, total: data.playlist_count || entries.length, entries };
  } catch (err) {
    throw err instanceof AppError ? err : fromYtDlp(err);
  }
}

// Raw format list per link, kept so "Watch" can pick a directly playable file for the chosen quality.
const playCache = new Map(); // clean url -> { at, formats }
function rememberFormats(url, formats = []) {
  const slim = formats.filter((f) => f.url).map((f) => ({
    format_id: f.format_id, url: f.url, ext: f.ext, height: f.height, width: f.width, tbr: f.tbr,
    vcodec: f.vcodec, acodec: f.acodec, protocol: f.protocol, resolution: f.resolution,
    format_note: f.format_note, http_headers: f.http_headers,
  }));
  playCache.set(url, { at: Date.now(), formats: slim });
  if (playCache.size > 30) playCache.delete(playCache.keys().next().value);
}

/**
 * One file that already has video AND audio and can be fetched with plain HTTP (no m3u8/DASH pieces),
 * closest to the chosen quality. Returns { url, headers, ext, height } or null when the site has none.
 */
async function findPlayable(rawUrl, optionId) {
  await getInfo(rawUrl); // makes sure playCache is filled (info itself is cached for 10 minutes)
  const url = await validateUrl(rawUrl);
  const entry = playCache.get(url);
  if (!entry || Date.now() - entry.at > 5 * 60 * 60 * 1000) return null; // stream links expire after some hours

  const whole = entry.formats.filter((f) => f.vcodec !== 'none' && f.acodec && f.acodec !== 'none'
    && ['https', 'http'].includes(f.protocol) && ['mp4', 'webm', 'm4v', 'mov'].includes(f.ext));
  if (!whole.length) return null;

  const byBitrate = (a, b) => (b.tbr || 0) - (a.tbr || 0);
  let pick = null;
  const fm = /^f-([\w.\-]+)$/.exec(optionId || '');
  const vm = /^v(\d{3,4})$/.exec(optionId || '');
  if (fm) {
    pick = whole.find((f) => String(f.format_id) === fm[1]);
  } else if (vm) {
    const h = Number(vm[1]);
    const atOrBelow = whole.filter((f) => guessHeight(f) && guessHeight(f) <= h);
    const exact = atOrBelow.filter((f) => guessHeight(f) === h);
    pick = [...(exact.length ? exact : atOrBelow)].sort(byBitrate)[0];
  } else if (optionId === 'vbest') {
    pick = [...whole].sort(byBitrate)[0];
  }
  if (!pick) return null;
  return { url: pick.url, headers: pick.http_headers || {}, ext: pick.ext, height: guessHeight(pick) || null };
}

/** Translate a chosen option id into yt-dlp download flags. */
function flagsForOption(optionId) {
  if (optionId === 'a-m4a') {
    return { format: 'bestaudio[ext=m4a]/bestaudio/best', extractAudio: true, audioFormat: 'm4a', ext: 'm4a', streams: 1 };
  }
  if (optionId === 'a-mp3') {
    return { format: 'bestaudio/best', extractAudio: true, audioFormat: 'mp3', audioQuality: '192K', ext: 'mp3', streams: 1 };
  }
  if (optionId === 'vbest') {
    return { format: 'bv*[ext=mp4][protocol!*=m3u8]+ba[ext=m4a]/bv*+ba/b', mergeOutputFormat: 'mp4', ext: 'mp4', streams: 2 };
  }
  // Sites with named formats (e.g. OK.ru "hd"): download that exact format id.
  const fm = /^f-([\w.\-]+)$/.exec(optionId || '');
  if (fm) {
    const fid = fm[1];
    return { format: `${fid}+ba/${fid}/b`, mergeOutputFormat: 'mp4', ext: 'mp4', streams: 2 };
  }
  const m = /^v(\d{3,4})$/.exec(optionId || '');
  if (!m) throw new AppError('Unknown quality option.', 400, 'BAD_OPTION');
  const h = Number(m[1]);
  // Prefer mp4/m4a (no re-encode); otherwise ffmpeg muxes whatever is best into mp4.
  const format = `bv*[height<=${h}][ext=mp4][protocol!*=m3u8]+ba[ext=m4a]/bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  return { format, mergeOutputFormat: 'mp4', ext: 'mp4', streams: 2 };
}

/**
 * Public profile information of a YouTube channel or TikTok account (what the profile page itself shows),
 * plus their latest videos. Nothing private is read, and accounts are never linked to each other.
 */
async function getProfile(rawUrl) {
  let url = await validateUrl(rawUrl);
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const isYT = host === 'youtube.com' || host.endsWith('.youtube.com');
  const isTT = host === 'tiktok.com' || host.endsWith('.tiktok.com');
  if (!isYT && !isTT) throw new AppError('Account lookup works for YouTube and TikTok accounts.', 400, 'BAD_URL');
  if (isYT && /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(u.pathname)) {
    // A channel page is a list of tabs: ask for the Videos tab to get the channel details and latest uploads.
    u.pathname = `${u.pathname.replace(/\/$/, '')}/videos`;
    url = u.toString();
  }
  const ttUser = decodeURIComponent((u.pathname.match(/^\/@([^/]+)/) || [])[1] || '');
  try {
    const data = await ytdlp(url, { ...baseFlags({ playlist: true }), flatPlaylist: true, dumpSingleJson: true, playlistEnd: 50 });
    const entries = (data.entries || []).filter((e) => e && e.id).map((e) => ({
      id: String(e.id),
      title: String(e.title || e.description || 'Untitled video').slice(0, 200),
      duration: e.duration || 0,
      durationText: e.duration ? fmtDuration(e.duration) : '',
      channel: data.channel || data.uploader || '',
      thumbnail: isYT ? `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg` : ((e.thumbnails || []).slice(-1)[0]?.url || e.thumbnail || ''),
      url: isYT ? `https://www.youtube.com/watch?v=${e.id}` : (/^https?:/.test(e.url || '') ? e.url : `https://www.tiktok.com/@${ttUser}/video/${e.id}`),
    }));
    const thumbs = data.thumbnails || [];
    const avatar = (thumbs.find((t) => t.id === 'avatar_uncropped') || thumbs.find((t) => t.width && t.width === t.height) || {}).url || null;
    return {
      platform: isYT ? 'youtube' : 'tiktok',
      name: data.channel || data.uploader || data.title || ttUser,
      handle: isYT ? (data.uploader_id || (u.pathname.match(/^\/(@[^/]+)/) || [])[1] || '') : (ttUser ? `@${ttUser}` : ''),
      url: isYT ? (data.channel_url || data.uploader_url || url) : `https://www.tiktok.com/@${ttUser}`,
      description: String(data.description || '').slice(0, 700),
      followers: Number.isFinite(data.channel_follower_count) ? data.channel_follower_count : null,
      videoCount: data.playlist_count || null,
      avatar,
      entries,
    };
  } catch (err) {
    const e = err instanceof AppError ? err : fromYtDlp(err);
    if (isTT && !(err instanceof AppError)) {
      throw new AppError(`TikTok usually blocks reading account pages. Paste the link of one video instead. (${e.message})`, e.status, 'PROFILE_FAILED');
    }
    throw e;
  }
}

module.exports = { baseFlags, validateUrl, getInfo, getPlaylist, getProfile, flagsForOption, ytdlp, findPlayable, safeFetch, isPublicHost };
