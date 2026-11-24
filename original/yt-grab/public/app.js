/* MultiDownloader frontend: single videos + playlists, with live progress. */
(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Opened on the computer itself => the finished file is also handed to the browser.
  // Opened from another device (e.g. a phone on the same Wi-Fi) => the file stays on the computer only.
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let toBrowser = false; // true only when the server was started with SAVE_TO_BROWSER=true
  let DONE_MSG = 'Done. Saved in the program’s downloads folder.';
  fetch('/api/mode').then((r) => r.json()).then((m) => {
    toBrowser = !!m.toBrowser;
    DONE_MSG = isLocal && toBrowser ? 'Done. Your download is starting…' : 'Done. Saved in the program’s downloads folder.';
  }).catch(() => {});

  const SITES = { youtube: ['youtube.com', 'youtu.be'], ok: ['ok.ru'], instagram: ['instagram.com'], facebook: ['facebook.com', 'fb.watch'], tiktok: ['tiktok.com'], x: ['twitter.com', 'x.com'] };
  const matches = (host, d) => host === d || host.endsWith(`.${d}`);
  const parseUrl = (v) => { try { return new URL(v); } catch { return null; } };
  const isYouTube = (host) => matches(host, 'youtube.com') || host === 'youtu.be';
  const isPlaylistPage = (u) => matches(u.hostname.toLowerCase(), 'youtube.com') && u.pathname === '/playlist' && u.searchParams.has('list');

  // ---- profile helpers ----
  let pickedSite = null; // set by the side menu (needed to understand a bare @username)
  const isProfileUrl = (u) => {
    const h = u.hostname.toLowerCase(), p = u.pathname;
    if (matches(h, 'youtube.com')) return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/(videos|featured|about|shorts|streams))?\/?$/.test(p);
    if (matches(h, 'tiktok.com')) return /^\/@[^/]+\/?$/.test(p);
    return false;
  };
  const USER_RE = /^@?[\p{L}\p{N}._-]{2,60}$/u;
  /** Turns "@name" into a profile link using the platform picked in the side menu. null = platform unknown. */
  function resolveInput(value) {
    const bare = USER_RE.test(value) && !/^https?:/i.test(value) && (value.startsWith('@') || (pickedSite && !value.includes('.')));
    if (!bare) return value;
    const name = value.replace(/^@/, '');
    if (pickedSite === 'youtube') return `https://www.youtube.com/@${name}`;
    if (pickedSite === 'tiktok') return `https://www.tiktok.com/@${name}`;
    return null;
  }
  // ---- end profile helpers ----

  /** Client-side URL validation. Returns an error string or null. */
  function validate(value) {
    if (!value) return 'Paste a video or playlist link first.';
    const u = parseUrl(value);
    if (!u) return 'That doesn’t look like a valid URL. Include https://';
    const host = u.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(u.protocol)) return 'Use a link that starts with http:// or https://';
    if (isYouTube(host) && !isPlaylistPage(u) && !isProfileUrl(u)) {
      const hasId = host === 'youtu.be' ? u.pathname.length > 1 : u.searchParams.has('v') || /^\/(shorts|embed|live)\//.test(u.pathname);
      if (!hasId) return 'This link doesn’t point to a specific video or playlist.';
    }
    return null;
  }

  function formatBytes(b, exact) {
    if (!b) return 'Size unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
    return `${exact ? '' : '~'}${(b / 1024 ** i).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  }
  const fmtTime = (s) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
  const setLoading = (btn, on) => { btn.classList.toggle('loading', on); btn.disabled = on; };
  const showError = (node, msg) => { node.textContent = msg; node.hidden = !msg; };

  async function api(path, body) {
    let res;
    try { res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
    catch { throw new Error('Can’t reach the server. Check your connection and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.error || `Request failed (${res.status}).`); err.code = data.code; throw err; }
    return data;
  }

  // ---------- Elements ----------
  const urlForm = $('url-form'), urlInput = $('url-input'), urlError = $('url-error'), fetchBtn = $('fetch-btn'), notice = $('notice');
  const single = $('single'), playlistEl = $('playlist');
  const dlBtn = $('download-btn'), dlError = $('download-error');
  const previewBtn = $('preview-btn'), previewBox = $('preview-box'), pVideo = $('preview-video'), pAudio = $('preview-audio');
  const FIRST = 15, STEP = 10; // first piece 0-15 s, then 15-25, 25-35, ... (keep equal to FIRST_SECONDS / STEP_SECONDS in src/preview.js)
  const CHUNK = STEP;
  const lenAt = (start) => (start === 0 ? FIRST : STEP);                       // length of the piece that begins at `start`
  const startOf = (t) => (t < FIRST ? 0 : FIRST + Math.floor((t - FIRST) / STEP) * STEP); // piece that contains second `t`
  const AHEAD = 1; // while a piece plays, the next one is prepared (e.g. playing 15-25 loads 25-35)
  let previewOpt = null, previewing = false;
  const pv = { token: 0, start: 0, ready: new Map(), paused: false }; // ready: 'quality:start' -> Promise of piece id // state of the piece-by-piece player
  const watchBtn = $('watch-btn'), watchBox = $('watch-box'), wFrame = $('watch-frame'), wVideo = $('watch-video'), wNote = $('watch-note');
  // "Save what I watched": joins every part that was watched (even if they are far apart, e.g. 0:00-5:00 and 10:00-11:00)
  // into ONE file inside the program's downloads folder. The browser saves nothing.
  const savedText = (d) => {
    const parts = d.ranges && d.ranges.length > 1
      ? d.ranges.map((r) => `${clock(r.from)}\u2013${clock(r.from + r.seconds)}`).join(' + ')
      : `${clock(d.from)}\u2013${clock(d.from + d.seconds)}`;
    return `Saved ${clock(d.seconds)} of video (${parts}), ${formatBytes(d.bytes, true)}, as \u201c${d.file}\u201d in the program\u2019s downloads folder (${d.dir}).`;
  };
  const watchFile = $('watch-file'); let watchSrc = null;
  watchFile.addEventListener('click', async () => {
    if (!watchSrc) return;
    watchFile.disabled = true;
    try {
      const res = await fetch('/api/hls-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: watchSrc, title: chosenName() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the video.');
      wNote.textContent = savedText(data);
    } catch (ex) { showError(dlError, ex.message); }
    finally { watchFile.disabled = false; }
  });
  let hlsPlayer = null; // hls.js instance while an .m3u8 video plays
  const WATCH_AHEAD = 5; // seconds loaded ahead of the playing position
  const noLivePlay = new Set(); // url|quality pairs that can't play live: go straight to pieces next time
  let watchOpt = null, watching = false; // watchOpt: 'youtube' (official player) or the quality id being played
  /** Stop and unload the live player (stops any data use). */
  function resetWatch() {
    wFrame.removeAttribute('src'); wFrame.hidden = true;
    if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
    watchSrc = null; watchFile.hidden = true;
    wVideo.pause(); wVideo.removeAttribute('src'); wVideo.load(); wVideo.hidden = true;
    watchBox.hidden = true; watchOpt = null;
  }
  /** Hide and unload the preview player (frees memory, and stops any data use). */
  function resetPreview() {
    pv.token++; pv.ready.clear(); pv.paused = false; // forget anything still loading
    for (const m of [pVideo, pAudio]) { m.pause(); m.removeAttribute('src'); m.load(); }
    previewBox.hidden = true; previewOpt = null;
  }
  // ---------- Playback speed (0.5x to 6x), shared by the live player and the piece-by-piece player ----------
  const SPEEDS = [0.5, 1, 1.5, 2, 3, 4, 5, 6];
  let speed = 1;
  const speedPlayers = [wVideo, pVideo, pAudio];
  function applySpeed() {
    // defaultPlaybackRate keeps the speed when the next piece (a new src) loads; playbackRate changes it right now
    for (const m of speedPlayers) { m.defaultPlaybackRate = speed; m.playbackRate = speed; }
    document.querySelectorAll('.speedbtn').forEach((b) => {
      const on = Number(b.dataset.rate) === speed;
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
    });
  }
  document.querySelectorAll('.speed').forEach((box) => {
    for (const r of SPEEDS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'speedbtn'; b.dataset.rate = r; b.textContent = r + '\u00d7';
      b.addEventListener('click', () => { speed = r; applySpeed(); });
      box.appendChild(b);
    }
  });
  // If the speed is changed from the browser player menu, keep our buttons in step.
  for (const m of speedPlayers) m.addEventListener('ratechange', () => { if (m.playbackRate !== speed) { speed = m.playbackRate; applySpeed(); } });
  applySpeed();
  const statusEl = $('status'), bar = statusEl.querySelector('.bar'), barFill = $('bar-fill');

  // ---------- State ----------
  let info = null, allOptions = [], selectedId = null;
  let rows = [], running = false, cancelled = false;
  let active = null; // { id, es, resolve } of the job currently downloading
  let failedOpt = null; // quality of the single video whose download stopped (Download button becomes "Resume")

  // ---------- Theme + side menu ----------
  const themeBtn = $('theme-btn');
  const applyTheme = (t) => { document.documentElement.dataset.theme = t; themeBtn.textContent = t === 'light' ? '☀' : '☾'; };
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  themeBtn.addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(t);
    try { localStorage.setItem('md-theme', t); } catch { /* private mode */ }
  });
  const SITE_NAMES = { youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok', x: 'X (Twitter)', instagram: 'Instagram', ok: 'OK.ru' };
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.pick;
    pickedSite = k;
    urlInput.placeholder = k === 'youtube' || k === 'tiktok' ? `Paste a ${SITE_NAMES[k]} link, or type @username…` : `Paste a ${SITE_NAMES[k]} link here…`;
    urlInput.focus();
    document.querySelectorAll('[data-site]').forEach((c) => c.classList.toggle('active', c.dataset.site === k));
  }));

  // ---------- URL box ----------
  function highlightSite(value) {
    const u = parseUrl(value);
    const host = u ? u.hostname.toLowerCase() : '';
    document.querySelectorAll('[data-site]').forEach((chip) => chip.classList.toggle('active', (SITES[chip.dataset.site] || []).some((d) => matches(host, d))));
  }
  urlInput.addEventListener('input', () => {
    urlInput.closest('.command').classList.remove('invalid');
    showError(urlError, '');
    highlightSite(urlInput.value.trim());
  });

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (running) return;
    const typed = urlInput.value.trim();
    const value = resolveInput(typed);
    const err = value === null ? `Which platform is @${typed.replace(/^@/, '')} on? Choose YouTube or TikTok in the left menu, or paste the profile link.` : validate(value);
    urlInput.closest('.command').classList.toggle('invalid', !!err);
    showError(urlError, err);
    if (err) return;

    resetViews();
    setLoading(fetchBtn, true);
    try {
      const u = parseUrl(value);
      if (isProfileUrl(u)) {
        renderProfile(await api('/api/profile', { url: value }));
      } else if (isPlaylistPage(u)) {
        renderPlaylist(await api('/api/playlist', { url: value }));
      } else {
        info = await api('/api/info', { url: value });
        renderSingle();
        const list = u.searchParams.get('list');
        if (list && matches(u.hostname.toLowerCase(), 'youtube.com')) offerPlaylist(list);
      }
    } catch (ex) {
      if (ex.code === 'MULTI_VIDEO') offerVideos(value, Number((ex.message.match(/has (\d+) videos/) || [])[1]) || 0);
      else showError(urlError, ex.message);
    } finally {
      setLoading(fetchBtn, false);
    }
  });

  /** A post with several videos: one button per video (X/Twitter links accept /video/1, /video/2 ...). */
  function offerVideos(link, n) {
    const u = parseUrl(link);
    if (!u || !n) { showError(urlError, 'This post has several videos. Add /video/1, /video/2 … to the link to choose one.'); return; }
    const base = `${u.origin}${u.pathname.replace(/\/(video|photo)\/\d+\/?$/, '')}`;
    const buttons = Array.from({ length: n }, (_, i) => {
      const b = el('button', '', `Video ${i + 1}`);
      b.type = 'button';
      b.addEventListener('click', () => { urlInput.value = `${base}/video/${i + 1}`; urlForm.requestSubmit(); });
      return b;
    });
    notice.replaceChildren(`This post has ${n} videos:`, ...buttons);
    notice.hidden = false;
  }

  function resetViews() {
    single.hidden = true; playlistEl.hidden = true; statusEl.hidden = true; notice.hidden = true; $('profile').hidden = true;
    showError(dlError, '');
  }

  function offerPlaylist(listId) {
    const btn = el('button', '', 'Load the whole playlist');
    btn.type = 'button';
    btn.addEventListener('click', async () => {
      urlInput.value = `https://www.youtube.com/playlist?list=${listId}`;
      urlForm.requestSubmit();
    });
    notice.replaceChildren('This video is part of a playlist.', btn);
    notice.hidden = false;
  }

  // ---------- Single video ----------
  function renderSingle() {
    $('thumb').src = info.thumbnail || '';
    $('title').textContent = info.title;
    $('file-name').value = info.title;
    $('channel').textContent = info.channel;
    $('duration').textContent = info.durationText;
    allOptions = [...info.options.video, ...info.options.audio];
    $('video-options').replaceChildren(...info.options.video.map(optionCard));
    $('audio-options').replaceChildren(...info.options.audio.map(optionCard));
    $('video-section').hidden = !info.options.video.length;
    failedOpt = null;
    renderSubs();
    resetPreview(); resetWatch();
    select((info.options.video[0] || info.options.audio[0]).id);
    single.hidden = false;
  }

  function optionCard(o) {
    const label = el('label', 'qcard');
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'quality', value: o.id });
    input.addEventListener('change', () => select(o.id));
    const head = el('strong', '', o.label);
    if (o.type === 'video' && o.short >= 2160) head.append(el('span', 'badge', '4K'));
    else if (o.type === 'video' && o.short >= 720) head.append(el('span', 'badge', 'HD'));
    const sub = o.type === 'video'
      ? ['MP4', o.resolution, o.fps > 30 ? `${Math.round(o.fps)} fps` : ''].filter(Boolean).join(' · ')
      : `${o.ext.toUpperCase()} · ${o.note}`;
    label.append(input, el('span', 'dot'), head, el('small', '', sub), el('small', 'sz', formatBytes(o.estimatedBytes, o.exact)));
    return label;
  }

  function select(id) {
    selectedId = id;
    document.querySelectorAll('input[name="quality"]').forEach((i) => { i.checked = i.value === id; });
    const o = allOptions.find((x) => x.id === id);
    $('sel-title').textContent = o ? `Selected: ${o.label} · ${o.ext.toUpperCase()}` : 'Selected';
    $('sel-size').textContent = o ? `Size: ${formatBytes(o.estimatedBytes, o.exact)}` : '';
    dlBtn.disabled = !o || running;
    dlBtn.querySelector('.btn-label').textContent = id === failedOpt ? 'Resume download' : 'Download';
    if (previewOpt && previewOpt !== id) resetPreview(); // the old preview shows a different quality
    if (watchOpt && watchOpt !== 'youtube' && watchOpt !== id) resetWatch(); // that file was a different quality
    watchBtn.disabled = !o || watching;
    previewBtn.disabled = !o || previewing;
    const perPiece = o && o.estimatedBytes && info && info.duration ? (o.estimatedBytes / info.duration) * CHUNK : 0;
    previewBtn.querySelector('.btn-label').textContent = perPiece ? `Preview (~${formatBytes(perPiece, false).replace(/^~/, '')} per ${CHUNK} s)` : 'Preview';
  }

  // The name typed by the user (falls back to the original title if the box is empty).
  const chosenName = () => ($('file-name').value || '').trim() || info.title;

  dlBtn.addEventListener('click', () => {
    const o = allOptions.find((x) => x.id === selectedId);
    if (!o || !info) return;
    showError(dlError, '');
    addDownload({ url: info.url, optionId: o.id, title: chosenName(), totalBytes: o.estimatedBytes || 0, exact: !!o.exact });
    const label = dlBtn.querySelector('.btn-label'); label.textContent = 'Added to Downloads ✓';
    setTimeout(() => select(selectedId), 1500);
  });

  // ---------- Subtitles ----------
  const subSection = $('subs-section'), subLang = $('sub-lang'), subFmt = $('sub-fmt'), subBtn = $('sub-btn'), subMsg = $('sub-msg');
  function renderSubs() {
    const list = (info && info.subtitles) || [];
    subSection.hidden = !list.length;
    subMsg.hidden = true;
    subLang.replaceChildren(...list.map((t, i) => { const o = el('option', '', `${t.name} (${t.lang})`); o.value = String(i); return o; }));
  }
  subBtn.addEventListener('click', async () => {
    const t = ((info && info.subtitles) || [])[Number(subLang.value)];
    if (!t) return;
    subMsg.hidden = true;
    setLoading(subBtn, true);
    try {
      const d = await api('/api/subtitles', { url: info.url, lang: t.lang, auto: t.auto, format: subFmt.value, title: chosenName() });
      if (isLocal && toBrowser) { const a = el('a'); a.href = `/api/subtitle-file?f=${encodeURIComponent(d.file)}`; a.download = d.file; a.click(); }
      subMsg.textContent = `Saved \u201c${d.file}\u201d in the program\u2019s downloads folder (${d.dir}).`;
    } catch (ex) {
      subMsg.textContent = ex.message;
    } finally {
      subMsg.hidden = false;
      setLoading(subBtn, false);
    }
  });

  // ---------- Downloads panel: several downloads at the same time ----------
  const dlPanel = $('downloads'), dlList = $('dl-list'), dlFab = $('dl-fab');
  const dlItems = new Map(); // "url\noption" -> item
  const DL_KEY = 'md-running';
  const saveRunning = () => {
    try { localStorage.setItem(DL_KEY, JSON.stringify([...dlItems.values()].filter((i) => i.running && i.id).map((i) => ({ id: i.id, ...i.p })))); } catch { /* optional */ }
  };
  function refreshPanel() {
    const n = [...dlItems.values()].filter((i) => i.running).length;
    dlPanel.hidden = dlFab.hidden = !dlItems.size;
    dlFab.textContent = n ? `⤓ Downloads (${n} running)` : `⤓ Downloads (${dlItems.size})`;
    saveRunning();
  }

  /** Adds one download to the panel and starts it (or, with `attachId`, re-attaches to a job already running on the server). */
  function addDownload(p, attachId) {
    const key = `${p.url}\n${p.optionId}`;
    const old = dlItems.get(key);
    if (old && old.running) { old.li.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; } // already downloading
    if (old) { old.li.remove(); dlItems.delete(key); }

    const li = el('li', 'dlrow'), meta = el('div', 'it'), text = el('small', '', ''), acts = el('div', 'acts');
    const fill = el('i'), track = el('div', 'dlbar'); track.append(fill);
    const cancelBtn = el('button', 'btn ghost', 'Cancel'), resumeBtn = el('button', 'btn ghost', 'Resume'), removeBtn = el('button', 'linkbtn', 'Remove');
    [cancelBtn, resumeBtn, removeBtn].forEach((b) => { b.type = 'button'; });
    meta.append(el('b', '', p.title), text); acts.append(cancelBtn, resumeBtn, removeBtn); li.append(meta, acts, track);
    dlList.prepend(li);
    const it = { li, p, running: false, id: null, es: null, pct: 0, got: false, cancelled: false };
    dlItems.set(key, it);

    const show = (msg, pct, cls = '') => {
      text.textContent = msg; fill.style.width = `${pct}%`; li.className = `dlrow ${cls}`.trim();
      cancelBtn.hidden = !it.running; resumeBtn.hidden = it.running || cls === 'ok'; removeBtn.hidden = it.running;
    };
    const end = (msg, cls) => { it.running = false; if (it.es) it.es.close(); show(msg, it.pct, cls); refreshPanel(); };
    const paused = () => end(`Paused at ${it.pct}%. Press Resume to continue.`, '');

    function follow(id, quiet) {
      it.id = id; it.running = true; refreshPanel();
      const es = new EventSource(`/api/progress/${id}`); it.es = es;
      es.onmessage = (ev) => {
        const s = JSON.parse(ev.data); it.got = true; it.pct = s.percent;
        if (s.status === 'done') { it.pct = 100; triggerFile(id); end(DONE_MSG, 'ok'); }
        else if (s.status === 'error') { if (it.cancelled) paused(); else end(s.error?.message || 'Download failed.', 'err'); }
        else show(jobLabel(s, !!p.exact), s.percent);
      };
      es.onerror = () => {
        if (!it.running) return;
        if (quiet && !it.got) { es.close(); it.running = false; li.remove(); dlItems.delete(key); refreshPanel(); return; } // that job no longer exists
        end('Lost connection to the server. Press Resume to continue.', 'err');
      };
    }
    async function start() {
      it.running = true; it.cancelled = false; show(it.pct ? 'Resuming…' : 'Starting…', it.pct); refreshPanel();
      try {
        const { id } = await api('/api/download', { url: p.url, optionId: p.optionId, title: p.title, totalBytes: p.totalBytes });
        if (it.cancelled) { fetch(`/api/cancel/${id}`, { method: 'POST' }).catch(() => {}); paused(); return; }
        follow(id, false);
      } catch (ex) { end(ex.message, 'err'); }
    }

    cancelBtn.addEventListener('click', () => {
      it.cancelled = true;
      if (it.id) { fetch(`/api/cancel/${it.id}`, { method: 'POST' }).catch(() => {}); paused(); }
    });
    resumeBtn.addEventListener('click', start);
    removeBtn.addEventListener('click', () => { if (it.id) fetch(`/api/history/${it.id}`, { method: 'DELETE' }).catch(() => {}); li.remove(); dlItems.delete(key); refreshPanel(); });
    if (attachId) { it.running = true; show('Reconnecting…', 0); follow(attachId, true); } else start();
  }
  $('dl-clear').addEventListener('click', () => {
    for (const [k, i] of dlItems) if (!i.running) { i.li.remove(); dlItems.delete(k); }
    fetch('/api/history', { method: 'DELETE' }).catch(() => {});
    refreshPanel();
  });
  /** Finished files from earlier visits (kept on the server), shown again in the Downloads panel. */
  const TYPE_LABEL = { video: 'Video', audio: 'Audio', subtitle: 'Subtitles', watched: 'Watched part' };
  async function restoreHistory() {
    let items = [];
    try { items = (await (await fetch('/api/history')).json()).items || []; } catch { return; }
    for (const h of items) {
      if ([...dlItems.values()].some((i) => i.id === h.id)) continue; // already shown as a live download
      const key = `hist:${h.id}`;
      const li = el('li', `dlrow${h.missing ? '' : ' ok'}`), meta = el('div', 'it'), acts = el('div', 'acts');
      const track = el('div', 'dlbar'), fill = el('i'); fill.style.width = h.missing ? '0%' : '100%'; track.append(fill);
      const text = h.missing
        ? 'This file is no longer in the downloads folder.'
        : [TYPE_LABEL[h.type] || 'File', formatBytes(h.bytes, true), new Date(h.at).toLocaleString(), h.file].filter(Boolean).join(' · ');
      const removeBtn = el('button', 'linkbtn', 'Remove'); removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => { fetch(`/api/history/${h.id}`, { method: 'DELETE' }).catch(() => {}); li.remove(); dlItems.delete(key); refreshPanel(); });
      meta.append(el('b', '', h.title), el('small', '', text)); acts.append(removeBtn); li.append(meta, acts, track);
      dlList.append(li);
      dlItems.set(key, { li, running: false, id: h.id, hist: true });
    }
    refreshPanel();
  }
  dlFab.addEventListener('click', () => dlPanel.scrollIntoView({ behavior: 'smooth' }));
  function restoreDownloads() { // downloads that were running when the page was closed keep running on the server: show them again
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem(DL_KEY)) || []; } catch { /* none */ }
    for (const r of saved) if (r && r.id && r.url && r.optionId) addDownload({ url: r.url, optionId: r.optionId, title: r.title || 'video', totalBytes: r.totalBytes || 0, exact: !!r.exact }, r.id);
  }

  // ---------- Download jobs (shared by single + playlist) ----------
  /** Starts one server job, follows its progress, triggers the browser download when done. */
  async function startJob({ url, optionId, title, totalBytes = 0, onUpdate }) {
    const { id } = await api('/api/download', { url, optionId, title, totalBytes });
    return new Promise((resolve) => {
      const es = new EventSource(`/api/progress/${id}`);
      active = { id, es, resolve };
      es.onmessage = (ev) => {
        const s = JSON.parse(ev.data);
        onUpdate?.(s);
        if (s.status === 'done') { es.close(); active = null; triggerFile(id); resolve({ ok: true }); }
        else if (s.status === 'error') { es.close(); active = null; resolve({ ok: false, error: s.error?.message || 'Download failed.' }); setTimeout(loadUnfinished, 2000); } // a stopped download shows up under "Unfinished downloads" without reloading the page
      };
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) return;
        es.close(); active = null;
        resolve({ ok: false, error: 'Lost connection to the server while downloading.' });
        setTimeout(loadUnfinished, 2000);
      };
    });
  }

  function triggerFile(id) {
    if (!isLocal || !toBrowser) return; // the file stays in the program's downloads folder unless the browser should save it
    const a = Object.assign(document.createElement('a'), { href: `/api/file/${id}`, download: '' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /** ["42%", "27.0 MB of 64.2 MB", "3.1 MB/s", "12s left"] */
  function progressParts(s, totalExact) {
    const mb = (b) => formatBytes(b, true);
    const parts = [`${s.percent}%`];
    if (s.downloadedBytes) parts.push(s.totalBytes ? `${mb(s.downloadedBytes)} of ${totalExact ? '' : '~'}${mb(s.totalBytes)}` : mb(s.downloadedBytes));
    if (s.speed) parts.push(`${mb(s.speed)}/s`);
    else if (s.status === 'downloading' && s.downloadedBytes) parts.push('waiting for data…'); // no new data is arriving right now
    if (s.eta != null) parts.push(`${fmtTime(s.eta)} left`);
    return parts;
  }
  const jobLabel = (s, exact) => (s.status === 'processing' ? 'Merging audio and video…' : `Downloading… ${progressParts(s, exact).join(' · ')}`);

  function showStatus(title, text, pct, cancellable) {
    statusEl.hidden = false;
    $('status-title').textContent = title;
    $('status-text').textContent = text;
    $('status-pct').textContent = `${Math.round(pct)}%`;
    barFill.style.width = `${pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    $('cancel-btn').hidden = !cancellable;
  }

  $('cancel-btn').addEventListener('click', () => {
    cancelled = true;
    if (active) {
      fetch(`/api/cancel/${active.id}`, { method: 'POST' }).catch(() => {});
      active.es.close();
      active.resolve({ ok: false, error: 'Cancelled.' });
      active = null;
    }
  });

  // ---------- Playlist ----------
  const QUALITIES = [['vbest', 'Best available'], ['v1080', '1080p'], ['v720', '720p'], ['v480', '480p'], ['v360', '360p'], ['a-mp3', 'MP3 audio'], ['a-m4a', 'M4A audio']];
  const qualitySelect = (cls, value) => {
    const s = el('select', cls);
    QUALITIES.forEach(([v, t]) => s.append(Object.assign(document.createElement('option'), { value: v, textContent: t })));
    s.value = value;
    return s;
  };
  const gq = $('pl-quality');
  QUALITIES.forEach(([v, t]) => gq.append(Object.assign(document.createElement('option'), { value: v, textContent: t })));
  gq.value = 'v720';

  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  /** Account card (public info) followed by the account's latest videos, ready to pick and download. */
  function renderProfile(p) {
    const avatar = $('pf-avatar');
    avatar.src = p.avatar || ''; avatar.hidden = !p.avatar;
    $('pf-name').textContent = p.name;
    $('pf-handle').textContent = [p.handle, p.platform === 'youtube' ? 'YouTube' : 'TikTok'].filter(Boolean).join(' · ');
    const stats = [];
    if (p.followers != null) stats.push(`${compact.format(p.followers)} ${p.platform === 'youtube' ? 'subscribers' : 'followers'}`);
    if (p.videoCount) stats.push(`${compact.format(p.videoCount)} videos`);
    $('pf-stats').replaceChildren(...stats.map((t) => el('li', '', t)));
    const desc = $('pf-desc'); desc.textContent = p.description; desc.hidden = !p.description;
    $('pf-link').href = p.url;
    $('profile').hidden = false;
    if (p.entries.length) {
      renderPlaylist({ title: 'Latest videos', channel: p.name, count: p.entries.length, total: p.videoCount > p.entries.length ? p.videoCount : p.entries.length, entries: p.entries });
    }
  }

  function renderPlaylist(pl) {
    $('pl-title').textContent = pl.title;
    $('pl-meta').textContent = `${[pl.channel, `${pl.count} videos`].filter(Boolean).join(' · ')}${pl.total > pl.count ? ` (showing first ${pl.count} of ${pl.total})` : ''}`;
    rows = pl.entries.map((entry) => {
      const li = el('li', 'item');
      const check = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
      check.addEventListener('change', updateCount);
      const img = Object.assign(document.createElement('img'), { src: entry.thumbnail, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
      const it = el('div', 'it');
      it.append(el('b', '', entry.title), el('small', '', entry.durationText));
      const rt = el('div', 'rt');
      const sel = qualitySelect('q', gq.value);
      const sizeBtn = el('button', 'linkbtn', 'Show sizes'); sizeBtn.type = 'button';
      const st = el('span', 'st', '');
      const mini = el('div', 'mini'); const fill = document.createElement('i'); mini.append(fill);
      const retryBtn = el('button', 'linkbtn', 'Resume'); retryBtn.type = 'button'; retryBtn.hidden = true;
      rt.append(sel, sizeBtn, st, retryBtn, mini);
      li.append(check, img, it, rt);
      const row = { entry, li, check, sel, sizeBtn, st, fill, retryBtn, list: null, loading: false, done: false, doneOpt: null, lastPct: 0 };
      sel.addEventListener('change', () => { row.lastPct = 0; row.retryBtn.hidden = true; updateTotal(); });
      retryBtn.addEventListener('click', () => resumeRow(row));
      sizeBtn.addEventListener('click', () => loadSizes(row));
      return row;
    });
    $('pl-list').replaceChildren(...rows.map((r) => r.li));
    $('pl-all').checked = true;
    updateCount();
    playlistEl.hidden = false;
    // Sizes are NOT fetched automatically: each one is a request to the site, which uses internet data.
    // Downloading works without them (the quality list below is generic); press "Show all sizes" if you want them.
    ++sizeRun; // stop any size-loading run left over from a previous playlist
    const allBtn = $('pl-sizes');
    allBtn.hidden = false; allBtn.disabled = false; allBtn.textContent = 'Show all sizes';
    allBtn.title = 'Looks up the real qualities and sizes of every video. This uses more internet data.';
  }

  function updateCount() {
    const n = rows.filter((r) => r.check.checked).length;
    $('pl-all').checked = n === rows.length;
    $('pl-download').querySelector('.btn-label').textContent = `Download selected (${n})`;
    $('pl-download').disabled = n === 0 || running;
    updateTotal();
  }
  $('pl-all').addEventListener('change', (e) => { rows.forEach((r) => { r.check.checked = e.target.checked; }); updateCount(); });
  $('pl-apply').addEventListener('click', () => { rows.forEach((r) => { r.sel.value = r.list ? pickClosest(r.list, gq.value) : gq.value; }); updateTotal(); });

  /** Choose the wanted quality, or the best one at/below it when this video doesn't have it. */
  function pickClosest(list, wanted) {
    if (list.some((o) => o.id === wanted)) return wanted;
    const h = (o) => Number(o.id.slice(1));
    const vids = list.filter((o) => /^v\d+$/.test(o.id)).sort((a, b) => h(b) - h(a));
    if (/^v\d+$/.test(wanted) && vids.length) return (vids.find((o) => h(o) <= Number(wanted.slice(1))) || vids[vids.length - 1]).id;
    return list[0].id;
  }

  /** Fetch this video's real qualities + sizes and put them in its dropdown. */
  async function loadSizes(r) {
    if (r.list || r.loading) return;
    r.loading = true; r.sizeBtn.disabled = true; r.sizeBtn.textContent = 'Loading sizes…';
    try {
      const data = await api('/api/info', { url: r.entry.url });
      const best = data.options.video[0];
      r.list = [
        ...(best ? [{ id: 'vbest', label: 'Best available', estimatedBytes: best.estimatedBytes, exact: best.exact }] : []),
        ...data.options.video, ...data.options.audio,
      ];
      const prev = r.sel.value;
      r.sel.replaceChildren(...r.list.map((o) => Object.assign(document.createElement('option'), { value: o.id, textContent: `${o.label} · ${formatBytes(o.estimatedBytes, o.exact)}` })));
      r.sel.value = pickClosest(r.list, prev);
      r.sizeBtn.hidden = true;
    } catch (ex) {
      r.sizeBtn.disabled = false; r.sizeBtn.textContent = 'Retry sizes';
      setRow(r, ex.message, 'error');
    } finally {
      r.loading = false; updateTotal();
    }
  }

  /** Load sizes for every ticked video, 3 at a time. */
  let sizeRun = 0; // bumped on every new playlist so an old run stops
  async function loadAllSizes(run = ++sizeRun) {
    const todo = rows.filter((r) => !r.list && !r.loading);
    if (!todo.length) { $('pl-sizes').hidden = true; return; }
    const btn = $('pl-sizes'), total = todo.length; let done = 0;
    btn.disabled = true;
    const worker = async () => { while (todo.length && run === sizeRun) { const r = todo.shift(); await loadSizes(r); btn.textContent = `Loading sizes… ${++done}/${total}`; } };
    btn.textContent = `Loading sizes… 0/${total}`;
    await Promise.all([worker(), worker(), worker()]);
    btn.textContent = 'Show all sizes'; btn.disabled = false; btn.hidden = rows.every((r) => r.list);
  }
  $('pl-sizes').addEventListener('click', () => loadAllSizes());

  function updateTotal() {
    const chosen = rows.filter((r) => r.check.checked);
    let sum = 0, known = 0;
    chosen.forEach((r) => { const o = r.list && r.list.find((x) => x.id === r.sel.value); if (o && o.estimatedBytes) { sum += o.estimatedBytes; known++; } });
    $('pl-total').textContent = !chosen.length ? '' : known ? `Total: ~${formatBytes(sum, true)} (${known} of ${chosen.length} sizes known)` : rows.some((r) => r.loading) ? 'Loading sizes…' : 'Sizes not loaded (saves data)';
  }

  function setRow(r, text, cls = '', pct = null) {
    r.st.textContent = text; r.st.className = `st ${cls}`;
    if (pct != null) r.fill.style.width = `${pct}%`;
  }

  /** Run one playlist row through the server. frac(pct) maps this row's percent onto the overall bar. */
  async function downloadRow(r, head, frac) {
    r.retryBtn.hidden = true;
    setRow(r, r.lastPct ? 'Resuming…' : 'Starting…', 'busy', r.lastPct || 0);
    try {
      const opt = r.list && r.list.find((o) => o.id === r.sel.value);
      const res = await startJob({
        url: r.entry.url, optionId: r.sel.value, title: r.entry.title, totalBytes: (opt && opt.estimatedBytes) || 0,
        onUpdate: (s) => {
          r.lastPct = s.percent;
          setRow(r, s.status === 'processing' ? 'Merging…' : progressParts(s, !!(opt && opt.exact)).join(' · '), 'busy', s.percent);
          showStatus(head, jobLabel(s, !!(opt && opt.exact)).replace('Downloading… ', `${r.entry.title} · `), frac(s.percent), true);
        },
      });
      if (res.ok) { r.done = true; r.doneOpt = r.sel.value; r.lastPct = 0; setRow(r, 'Done ✓', 'done', 100); return true; }
      const paused = res.error === 'Cancelled.';
      setRow(r, paused ? `Paused at ${r.lastPct}%` : res.error, paused ? '' : 'error', r.lastPct);
      r.retryBtn.hidden = false; // continues from the same point
      return false;
    } catch (ex) {
      setRow(r, ex.message, 'error', r.lastPct); r.retryBtn.hidden = false;
      return false;
    }
  }

  function setBusy(on) {
    running = on;
    setLoading($('pl-download'), on); $('pl-sizes').disabled = on;
    rows.forEach((r) => { r.check.disabled = r.sel.disabled = on; });
    if (!on) updateCount();
  }

  /** The "Resume" link next to a stopped video: same link, same quality, continues from where it stopped. */
  async function resumeRow(r) {
    if (running) return;
    cancelled = false;
    setBusy(true);
    const head = 'Resuming download';
    showStatus(head, r.entry.title, r.lastPct || 0, true);
    const good = await downloadRow(r, head, (p) => p);
    showStatus(good ? 'Finished' : 'Stopped', good ? '1 downloaded' : 'Press “Resume” to try again.', good ? 100 : r.lastPct || 0, false);
    setBusy(false);
  }

  $('pl-download').addEventListener('click', async () => {
    const chosen = rows.filter((r) => r.check.checked);
    if (!chosen.length || running) return;
    cancelled = false;
    setBusy(true);
    const skip = (r) => r.done && r.doneOpt === r.sel.value; // already saved: don't download it twice
    rows.forEach((r) => { r.retryBtn.hidden = true; if (!skip(r)) setRow(r, r.check.checked ? 'Queued' : '', '', r.lastPct || 0); });
    let ok = 0, failed = 0;

    for (let i = 0; i < chosen.length; i++) {
      const r = chosen[i];
      if (skip(r)) { ok++; continue; }
      if (cancelled) { setRow(r, 'Cancelled'); continue; }
      const head = `Downloading ${i + 1} of ${chosen.length}`;
      showStatus(head, r.entry.title, (i / chosen.length) * 100, true);
      if (await downloadRow(r, head, (p) => ((i + p / 100) / chosen.length) * 100)) { ok++; await sleep(800); } else failed++;
    }

    showStatus(cancelled ? 'Paused' : 'Finished', `${ok} downloaded${failed ? `, ${failed} stopped (use “Resume” next to each)` : ''}`, cancelled ? 0 : 100, false);
    setBusy(false);
  });

  // ---------- Watch: play the whole video to scrub through it (nothing loads until you press the button) ----------
  watchBtn.addEventListener('click', async () => {
    const o = allOptions.find((x) => x.id === selectedId);
    if (!o || watching) return;
    showError(dlError, '');
    const parsed = parseUrl(info.url);
    if (parsed && isYouTube(parsed.hostname.toLowerCase()) && info.id) {
      // YouTube: use its own embedded player (free scrubbing; pick the quality from its ⚙ menu).
      resetWatch(); resetPreview();
      wFrame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(info.id)}?rel=0&playsinline=1`;
      wFrame.hidden = false; watchBox.hidden = false; watchOpt = 'youtube';
      wNote.textContent = 'YouTube’s own player: scrub freely and choose its quality from the ⚙ menu. This does not change the download quality selected above.';
      return;
    }
    const liveKey = `${info.url}|${o.id}`;
    if (noLivePlay.has(liveKey)) { await openPieces(o, 'This video can’t be played live, so it plays in short pieces. Drag the bar to choose where to watch from.'); return; }
    watching = true; setLoading(watchBtn, true);
    try {
      const res = await fetch('/api/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: info.url, optionId: o.id }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'NO_LIVE_PLAY') { noLivePlay.add(liveKey); await openPieces(o, 'This video can’t be played live, so it plays in short pieces. Drag the bar to choose where to watch from.'); return; }
        throw new Error(data.error || 'Could not start playback.');
      }
      if (selectedId !== o.id) return; // the user picked another quality meanwhile
      resetWatch(); resetPreview();
      wVideo.hidden = false; watchBox.hidden = false; watchOpt = o.id;
      if (data.hls) {
        // .m3u8 video: full-length bar, but only ~WATCH_AHEAD seconds are loaded ahead of the playing position.
        if (window.Hls && window.Hls.isSupported()) {
          hlsPlayer = new window.Hls({ maxBufferLength: WATCH_AHEAD, maxMaxBufferLength: WATCH_AHEAD * 2, maxBufferSize: 30e6, backBufferLength: 15 });
          hlsPlayer.on(window.Hls.Events.MANIFEST_PARSED, (_e, m) => {
            if (!data.height) return;
            const lv = m.levels.map((l, i) => ({ i, h: Math.min(l.height || 0, l.width || l.height || 0) || l.height || 0 }));
            const fit = lv.filter((x) => x.h && x.h <= data.height).sort((a, b) => b.h - a.h)[0];
            if (fit) hlsPlayer.currentLevel = fit.i;
          });
          hlsPlayer.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) showError(dlError, 'The video stopped loading. Press Watch again.'); });
          hlsPlayer.loadSource(data.src); hlsPlayer.attachMedia(wVideo);
        } else if (wVideo.canPlayType('application/vnd.apple.mpegurl')) {
          wVideo.src = data.src;
        } else {
          throw new Error('This browser can’t play this kind of video. Download it instead.');
        }
        wNote.textContent = (data.height ? `Playing up to ${data.height}p. ` : '') + `Only about ${WATCH_AHEAD} seconds ahead of where you are is loaded, so you can jump anywhere.`;
        watchSrc = data.src; watchFile.hidden = false;
        wVideo.play().catch(() => {});
        return;
      }
      wVideo.src = data.src;
      wNote.textContent = (data.height ? `Playing ${data.height}p. ` : '') + 'Only the part you watch is loaded, so you can jump around freely.';
      wVideo.play().catch(() => {}); // the browser may block autoplay; the controls are right there
    } catch (ex) {
      showError(dlError, ex.message);
    } finally {
      watching = false; setLoading(watchBtn, false); select(selectedId);
    }
  });
  wVideo.addEventListener('error', () => {
    if (hlsPlayer || !wVideo.getAttribute('src')) return; // .m3u8 errors are handled by the HLS player
    const o = allOptions.find((x) => x.id === selectedId);
    resetWatch();
    if (o) openPieces(o, 'The live player couldn’t play this one, so it plays in short pieces instead. Drag the bar to choose where to watch from.');
  });

  // ---------- Preview in pieces: pick any point on the bar; pieces then keep playing one after another ----------
  const seek = $('pv-seek'), pvTime = $('pv-time'), pvKeep = $('pv-keep'), pvNote = $('pv-note');
  let dragging = false;
  const playBtn = $('pv-play');
  const activePlayer = () => (pAudio.hidden ? pVideo : pAudio);
  function syncPlayBtn() {
    const m = activePlayer();
    const playing = !pv.paused && !m.paused;
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }
  playBtn.addEventListener('click', () => {
    const m = activePlayer();
    if (m.paused || pv.paused) { pv.paused = false; m.play().catch(() => {}); }
    else { pv.paused = true; m.pause(); }
    syncPlayBtn();
  });
  const clock = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
  };
  const curOpt = () => allOptions.find((x) => x.id === selectedId);
  const totalSeconds = () => (info && info.duration) || 0;
  const showTime = (pos) => { pvTime.textContent = totalSeconds() ? `${clock(pos)} / ${clock(totalSeconds())}` : clock(pos); };

  async function requestPiece(o, start) {
    const res = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: info.url, optionId: o.id, start, length: lenAt(start) }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not prepare this piece.');
    return data.id;
  }

  /** Load and play the piece that starts at `start` seconds (optionally jumping `offset` seconds into it). */
  async function playPiece(start, note, offset = 0) {
    const o = curOpt();
    if (!o) return;
    const token = ++pv.token;
    previewing = true; setLoading(previewBtn, true); showError(dlError, '');
    pvNote.textContent = `Loading ${clock(start)}–${clock(start + lenAt(start))}…`;
    try {
      const key = `${o.id}:${start}`;
      if (!pv.ready.has(key)) pv.ready.set(key, requestPiece(o, start));
      let id;
      try { id = await pv.ready.get(key); } catch (e) { pv.ready.delete(key); throw e; }
      if (token !== pv.token) return; // the user moved elsewhere meanwhile
      pv.start = start;
      for (const k of [...pv.ready.keys()]) { if (Number(k.split(':').pop()) < start) pv.ready.delete(k); } // drop pieces already behind us
      const audioOnly = o.type === 'audio', player = audioOnly ? pAudio : pVideo;
      pVideo.hidden = audioOnly; pAudio.hidden = !audioOnly;
      fullBtn.hidden = audioOnly;
      player.src = `/api/preview/${id}`;
      if (offset > 0) player.addEventListener('loadedmetadata', () => { player.currentTime = Math.min(offset, Math.max(0, (player.duration || offset) - 0.5)); }, { once: true });
      previewBox.hidden = false; previewOpt = o.id;
      seek.value = start + offset; showTime(start + offset);
      pvNote.textContent = note || `Playing ${clock(start)}–${clock(totalSeconds() ? Math.min(start + lenAt(start), totalSeconds()) : start + lenAt(start))}.`;
      if (!pv.paused) player.play().catch(() => {}); // the browser may block autoplay; the controls are right there
      syncPlayBtn();
      prefetchAhead(); // start preparing the next pieces right now
    } catch (ex) {
      if (token === pv.token) showError(dlError, ex.message);
    } finally {
      if (token === pv.token) { previewing = false; setLoading(previewBtn, false); select(selectedId); }
    }
  }

  /** Keep the next AHEAD pieces prepared in the background so each piece is ready before the last one ends. */
  function prefetchAhead() {
    const o = curOpt();
    if (!o || !pvKeep.checked) return;
    let start = pv.start;
    for (let i = 1; i <= AHEAD; i++) {
      start += lenAt(start);
      if (totalSeconds() && start >= totalSeconds()) break;
      const key = `${o.id}:${start}`;
      if (pv.ready.has(key)) continue;
      const p = requestPiece(o, start);
      pv.ready.set(key, p);
      p.catch(() => { if (pv.ready.get(key) === p) pv.ready.delete(key); }); // retried on the next timeupdate
    }
  }

  /** Show the bar, then play from its start. Used by the Preview button and as the fallback for Watch. */
  async function openPieces(o, note) {
    resetWatch();
    seek.max = totalSeconds(); seek.hidden = !totalSeconds();
    seek.value = 0; showTime(0);
    await playPiece(0, note);
  }

  previewBtn.addEventListener('click', () => { const o = curOpt(); if (o && !previewing) openPieces(o); });

  seek.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  // The piece players have no browser bar of their own (it would only show the 5-second piece), so the
  // full-length bar above is the only one. Mute, full screen and click-to-pause live here.
  const muteBtn = $('pv-mute'), fullBtn = $('pv-full');
  muteBtn.addEventListener('click', () => {
    const mute = !pVideo.muted;
    for (const x of [pVideo, pAudio]) x.muted = mute;
    muteBtn.textContent = mute ? '\u{1F507}' : '\u{1F50A}';
    muteBtn.setAttribute('aria-label', mute ? 'Unmute' : 'Mute');
  });
  fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (previewBox.requestFullscreen) previewBox.requestFullscreen().catch(() => {});
  });
  pVideo.addEventListener('click', () => playBtn.click());
  seek.addEventListener('input', () => showTime(Number(seek.value)));
  seek.addEventListener('change', () => {
    dragging = false;
    const v = Number(seek.value), start = startOf(v);
    playPiece(start, undefined, v - start);
  });

  for (const m of [pVideo, pAudio]) {
    m.addEventListener('timeupdate', () => {
      if (previewBox.hidden || m.hidden) return;
      if (!dragging) { const pos = pv.start + m.currentTime; seek.value = pos; showTime(pos); }
      if (m.currentTime > 0) prefetchAhead(); // keep the buffer topped up
    });
    m.addEventListener('play', () => { if (!previewBox.hidden && !m.hidden) { pv.paused = false; syncPlayBtn(); } });
    m.addEventListener('pause', () => { if (!previewBox.hidden && !m.hidden && !m.ended) { pv.paused = true; syncPlayBtn(); } });
    m.addEventListener('waiting', () => { if (!previewBox.hidden && !m.hidden) pvNote.textContent = 'Buffering…'; });
    m.addEventListener('playing', () => { if (!previewBox.hidden && !m.hidden) pvNote.textContent = `Playing ${clock(pv.start)}–${clock(totalSeconds() ? Math.min(pv.start + lenAt(pv.start), totalSeconds()) : pv.start + lenAt(pv.start))}.`; });
    m.addEventListener('ended', () => {
      if (previewBox.hidden || m.hidden) return;
      const next = pv.start + lenAt(pv.start);
      if (pvKeep.checked && (!totalSeconds() || next < totalSeconds())) playPiece(next);
    });
    m.addEventListener('error', () => {
      if (m.getAttribute('src') && !m.hidden) showError(dlError, `This piece could not be played (${pv.start}s, media error ${m.error ? m.error.code : '?'}). Try another point on the bar, or another quality.`);
    });
  }

  // Join everything watched so far into one file in the program's downloads folder: no new data is fetched.
  const pvJoin = $('pv-join');
  pvJoin.addEventListener('click', async () => {
    const o = curOpt();
    if (!o || !info) return;
    pvJoin.disabled = true;
    try {
      const res = await fetch('/api/assemble', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: info.url, optionId: o.id, duration: totalSeconds(), title: chosenName() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not join the pieces.');
      pvNote.textContent = savedText(data);
    } catch (ex) { showError(dlError, ex.message); }
    finally { pvJoin.disabled = false; }
  });

  // ---------- Unfinished downloads (resume after a restart or a crash) ----------
  const unfSection = $('unfinished'), unfList = $('unf-list');
  const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const toggleUnfinished = () => { unfSection.hidden = !unfList.children.length; };

  async function loadUnfinished() {
    try {
      const res = await fetch('/api/unfinished');
      const { items = [] } = await res.json();
      unfList.replaceChildren(...items.map(unfinishedRow));
    } catch { /* the list is optional */ }
    toggleUnfinished();
  }

  function unfinishedRow(it) {
    const li = el('li', 'item unf');
    const meta = el('div', 'it');
    meta.append(el('b', '', it.title), el('small', '', `${formatBytes(it.partialBytes, true)} saved · ${ago(it.updatedAt)}`));
    const rt = el('div', 'rt');
    const st = el('span', 'st', '');
    const acts = el('div', 'acts');
    const resume = el('button', 'btn ghost', 'Resume'); resume.type = 'button';
    const discard = el('button', 'linkbtn', 'Discard'); discard.type = 'button';
    acts.append(resume, discard);
    rt.append(st, acts);
    li.append(meta, rt);

    resume.addEventListener('click', () => { // goes to the Downloads panel, so several can resume together and Fetch Info stays free
      addDownload({ url: it.url, optionId: it.optionId, title: it.title, totalBytes: it.totalBytes || 0, exact: false });
      li.remove(); toggleUnfinished();
    });

    discard.addEventListener('click', async () => {
      if (!confirm(`Delete the partly downloaded “${it.title}”? This can’t be undone.`)) return;
      try {
        const r = await fetch(`/api/unfinished/${it.id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error();
        li.remove(); toggleUnfinished();
      } catch { st.textContent = 'Couldn’t remove it right now.'; st.className = 'st error'; }
    });
    return li;
  }

  loadUnfinished();
  restoreDownloads();
  restoreHistory();
})();
