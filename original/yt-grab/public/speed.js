// "Download speed" box: sends the chosen mode and limit to the server (used by the next download).
(() => {
  const mode = document.getElementById('sp-mode'), limit = document.getElementById('sp-limit'), note = document.getElementById('sp-note');
  if (!mode || !limit) return;
  const KEY = 'md-speed';
  const post = (body) => fetch('/api/speed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  function show(s) {
    mode.querySelector('option[value="max"]').textContent = s.aria2 ? 'Maximum (aria2c)' : 'Maximum (32 pieces)';
    mode.value = s.mode; limit.value = String(s.limitMBps);
    if (![...limit.options].some((o) => o.value === limit.value)) limit.add(new Option(`${s.limitMBps} MB/s`, limit.value), 1);
    note.textContent = s.limitMBps > 0
      ? 'A speed limit uses the normal downloader. Applies to the next download.'
      : s.mode === 'max' && !s.aria2 ? 'aria2c is not installed, so Maximum uses 32 pieces. Applies to the next download.'
      : 'Applies to the next download. A download in progress keeps its speed.';
  }
  async function save() {
    const body = { mode: mode.value, limitMBps: Number(limit.value) };
    try { localStorage.setItem(KEY, JSON.stringify(body)); } catch { /* optional */ }
    try { show(await post(body)); } catch { /* server not reachable */ }
  }
  (async () => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* none */ }
    try { show(saved ? await post(saved) : await (await fetch('/api/speed')).json()); } catch { /* optional */ }
  })();
  mode.addEventListener('change', save); limit.addEventListener('change', save);
})();
