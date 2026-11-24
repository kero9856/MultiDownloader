import 'package:flutter_test/flutter_test.dart';
import 'package:multidownloader/core/collections.dart';
import 'package:multidownloader/core/errors.dart';
import 'package:multidownloader/core/quality_builder.dart';
import 'package:multidownloader/core/speed.dart';
import 'package:multidownloader/core/watched_ranges.dart';
import 'package:multidownloader/models/models.dart';

void main() {
  test('url helpers', () {
    expect(isPlaylistPage(Uri.parse('https://www.youtube.com/playlist?list=PL1')), true);
    expect(isPlaylistPage(Uri.parse('https://www.youtube.com/watch?v=a&list=PL1')), false);
    expect(isProfileUrl(Uri.parse('https://www.youtube.com/@abc')), true);
    expect(isProfileUrl(Uri.parse('https://www.tiktok.com/@abc')), true);
    expect(isProfileUrl(Uri.parse('https://www.tiktok.com/@abc/video/1')), false);
    expect(playlistUrlFromVideo(Uri.parse('https://www.youtube.com/watch?v=a&list=PL1')), 'https://www.youtube.com/playlist?list=PL1');
    expect(profileFetchUrl(Uri.parse('https://www.youtube.com/@abc')), 'https://www.youtube.com/@abc/videos');
  });

  test('playlistFromJson', () {
    final p = playlistFromJson({'title': 'P', 'channel': 'C', 'playlist_count': 5, 'entries': [
      {'id': 'a1', 'title': 'One', 'duration': 65}, {'title': 'no id'},
    ]});
    expect(p.count, 1);
    expect(p.total, 5);
    expect(p.entries.first.url, 'https://www.youtube.com/watch?v=a1');
    expect(p.entries.first.durationText, '1:05');
    expect(() => playlistFromJson({'entries': []}), throwsA(isA<AppError>()));
  });

  test('profileFromJson tiktok', () {
    final u = Uri.parse('https://www.tiktok.com/@bob');
    final p = profileFromJson(u, u.toString(), {'uploader': 'Bob', 'entries': [{'id': '9', 'title': 'x'}]});
    expect(p.platform, 'tiktok');
    expect(p.handle, '@bob');
    expect(p.entries.first.url, 'https://www.tiktok.com/@bob/video/9');
  });

  test('speedArgs', () {
    expect(speedArgs(AppSettings(speedMode: 'normal'), aria2Available: true), ['--concurrent-fragments', '4']);
    expect(speedArgs(AppSettings(speedMode: 'max'), aria2Available: true), contains('libaria2c.so'));
    expect(speedArgs(AppSettings(speedMode: 'max'), aria2Available: false), ['--concurrent-fragments', '32']);
    expect(speedArgs(AppSettings(speedMode: 'max', limitMBps: 2), aria2Available: true), ['--concurrent-fragments', '32', '--limit-rate', '2.0M']);
  });

  test('WatchedRanges: continuous play merges, seek makes a new run', () {
    final w = WatchedRanges();
    for (var t = 0.0; t <= 5; t += 0.5) { w.tick(t); }
    w.breakRun();
    for (var t = 20.0; t <= 25; t += 0.5) { w.tick(t); }
    final m = w.merged();
    expect(m.length, 2);
    expect(m.first.start, 0);
    expect(m.first.end, 5);
    expect(m.last.start, 20);
    expect(w.totalSeconds, 10);
  });

  test('pickPlayable', () {
    PlayableFormat f(String id, int h, double tbr) => PlayableFormat(url: 'u$id', ext: 'mp4', formatId: id, headers: const {}, height: h, tbr: tbr);
    final list = [f('18', 360, 300), f('22', 720, 900)];
    expect(pickPlayable(list, 'v720')!.formatId, '22');
    expect(pickPlayable(list, 'v1080')!.formatId, '22'); // best at/below
    expect(pickPlayable(list, 'v240'), isNull);
    expect(pickPlayable(list, 'vbest')!.formatId, '22');
    expect(pickPlayable(list, 'f-18')!.formatId, '18');
    expect(pickPlayable(const [], 'v720'), isNull);
  });

  test('buildPlayable only keeps muxed http formats', () {
    final l = buildPlayable({'formats': [
      {'format_id': '18', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'mp4a', 'protocol': 'https', 'url': 'u', 'height': 360},
      {'format_id': '137', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'none', 'protocol': 'https', 'url': 'u', 'height': 1080},
      {'format_id': 'h', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'mp4a', 'protocol': 'm3u8_native', 'url': 'u', 'height': 720},
    ]});
    expect(l.map((e) => e.formatId), ['18']);
  });
}
