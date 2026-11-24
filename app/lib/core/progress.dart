// yt-dlp reports 0..100 for EACH stream (video, then audio). Maps that to one overall percentage (port of the stage logic of jobs.js).
({int stage, double overall}) advanceProgress({required int stage, required int streams, required double lastRaw, required double raw}) {
  var st = stage;
  if (st < streams - 1 && raw + 30 < lastRaw) st++; // percentage dropped: yt-dlp moved to the next stream
  final overall = ((st * 100 + raw) / streams).clamp(0.0, 100.0).toDouble();
  return (stage: st, overall: overall);
}
