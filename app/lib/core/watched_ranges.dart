// Tracks which parts of a video were actually played (replaces the browser-proxy cache of the original "Watch" feature).
class WatchedRange {
  double start, end;
  WatchedRange(this.start, this.end);
  double get length => end - start;
}

class WatchedRanges {
  final List<WatchedRange> runs = [];
  double? _last;

  /// Call periodically (e.g. every 500 ms) with the player position while it is PLAYING.
  void tick(double position, {double maxStep = 2.0}) {
    final last = _last;
    if (last != null && position >= last - 0.01 && position - last <= maxStep && runs.isNotEmpty) {
      runs.last.end = position;
    } else {
      runs.add(WatchedRange(position, position)); // first tick or the user sought
    }
    _last = position;
  }

  /// Call when the player pauses/stops so the next tick starts a new run if the position jumped.
  void breakRun() => _last = null;

  /// Merged, non-overlapping, only runs with real length.
  List<WatchedRange> merged({double minLength = 1.0}) {
    final r = runs.where((x) => x.length >= minLength).toList()..sort((a, b) => a.start.compareTo(b.start));
    final out = <WatchedRange>[];
    for (final x in r) {
      if (out.isNotEmpty && x.start <= out.last.end + 0.5) {
        if (x.end > out.last.end) out.last.end = x.end;
      } else {
        out.add(WatchedRange(x.start, x.end));
      }
    }
    return out;
  }

  double get totalSeconds => merged().fold(0.0, (a, r) => a + r.length);
}
