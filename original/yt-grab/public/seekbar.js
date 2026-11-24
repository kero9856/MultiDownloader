/* Seek-bar timeline helpers: watched (red) / buffered (blue) / neither (grey).
   Pure interval maths so it can be tested without a browser. Intervals are [start, end] in seconds. */
(function (root) {
  'use strict';
  const EPS = 0.05; // ranges closer than this are treated as touching

  /** Sorted, non-overlapping copy of `list` (overlapping or touching intervals merged). */
  function normalize(list) {
    const a = list.filter((r) => r && isFinite(r[0]) && isFinite(r[1]) && r[1] > r[0]).map((r) => [r[0], r[1]]).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const r of a) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + EPS) last[1] = Math.max(last[1], r[1]);
      else out.push(r);
    }
    return out;
  }
  /** Add [start, end] to an already-normalised list, merging as needed. */
  function addInterval(list, start, end) { return normalize(list.concat([[start, end]])); }
  /** Parts of `a` not covered by `b` (both normalised). */
  function subtract(a, b) {
    const out = [];
    for (let [s, e] of a) {
      for (const [bs, be] of b) {
        if (be <= s || bs >= e) continue;
        if (bs > s) out.push([s, bs]);
        s = Math.max(s, be);
        if (s >= e) break;
      }
      if (s < e) out.push([s, e]);
    }
    return out;
  }
  /** Convert a TimeRanges object to an array of [start, end] shifted by `offset` seconds. */
  function fromTimeRanges(tr, offset) {
    const out = [];
    if (tr) for (let i = 0; i < tr.length; i++) out.push([tr.start(i) + offset, tr.end(i) + offset]);
    return out;
  }
  /** Segments to paint: grey is the background; blue = buffered minus watched; red = watched. Clipped to [0, total]. */
  function segments(watched, buffered, total) {
    const clip = (l) => normalize(l.map(([s, e]) => [Math.max(0, s), Math.min(total, e)]));
    const w = clip(watched), b = clip(buffered);
    return { red: w, blue: subtract(b, w) };
  }

  /**
   * Tracks what has really been played. Feed it `tick(pos, playing)` from timeupdate and call `jump()` on
   * any seek / source change. Only continuous forward playback (small step) counts; jumps start a new interval.
   */
  function createTracker(maxStep) {
    let watched = [], last = null;
    return {
      tick(pos, playing, rate) {
        if (!playing || !isFinite(pos)) { last = null; return false; }
        const step = pos - (last == null ? pos : last);
        const limit = (maxStep || 1.5) * Math.max(1, rate || 1);
        let changed = false;
        if (last != null && step > 0 && step <= limit) { watched = addInterval(watched, last, pos); changed = true; }
        last = pos;
        return changed;
      },
      /** Close the interval at `pos` (e.g. the piece ended) without counting any jump. */
      finish(pos) { if (last != null && pos > last && pos - last <= (maxStep || 1.5) * 2) { watched = addInterval(watched, last, pos); } last = null; },
      jump() { last = null; },
      reset() { watched = []; last = null; },
      get watched() { return watched; },
    };
  }

  const api = { normalize, addInterval, subtract, fromTimeRanges, segments, createTracker };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeekMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
