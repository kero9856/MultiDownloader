// Download history: a small JSON file next to the downloaded files, so the list survives closing the page / restarting the server.
const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.DOWNLOAD_DIR, 'history.json');
const MAX_ITEMS = 500;
let items = null;

/** Finished downloads already sitting in the downloads folder (made before the history file existed). */
function scanDisk(known) {
  const found = [];
  let dirs = [];
  try { dirs = fs.readdirSync(config.DOWNLOAD_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[0-9a-f]{16}$/.test(d.name)); } catch { return found; }
  for (const d of dirs) {
    if (known.has(d.name)) continue;
    try {
      const dir = path.join(config.DOWNLOAD_DIR, d.name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      const file = path.join(dir, path.basename(meta.file));
      const st = fs.statSync(file);
      let job = {};
      try { job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')); } catch { /* optional */ }
      found.push({ id: d.name, type: ['mp3', 'm4a'].includes(meta.ext) ? 'audio' : 'video', title: meta.title || path.basename(file), file: path.basename(file), path: file, bytes: st.size, url: job.url, optionId: job.optionId, at: Math.round(st.mtimeMs) });
    } catch { /* not a finished download */ }
  }
  return found;
}

function load() {
  if (items) return items;
  try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); items = Array.isArray(d) ? d : []; } catch { items = []; }
  const extra = scanDisk(new Set(items.map((x) => x.id)));
  if (extra.length) { items = [...items, ...extra].sort((a, b) => b.at - a.at); save(); }
  return items;
}
function save() {
  try {
    fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items));
    fs.renameSync(tmp, FILE);
  } catch (e) { console.error('[history] could not save:', e.message); }
}

/** Record a finished file (same id again = replace the old entry). */
function add(entry) {
  load();
  items = items.filter((x) => x.id !== entry.id);
  items.unshift({ ...entry, at: Date.now() });
  if (items.length > MAX_ITEMS) items.length = MAX_ITEMS;
  save();
}
const has = (id) => load().some((x) => x.id === id);
function list() { return load().map((e) => ({ ...e, missing: !fs.existsSync(e.path) })); }
function remove(id) { load(); const n = items.length; items = items.filter((x) => x.id !== id); if (items.length !== n) save(); }
function clear() { items = []; save(); }

module.exports = { add, has, list, remove, clear };
