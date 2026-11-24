import 'package:flutter_test/flutter_test.dart';
import 'package:multidownloader/core/errors.dart';
import 'package:multidownloader/core/quality_builder.dart';

void main() {
  final info = <String, dynamic>{
    'id': 'x', 'title': 'T', 'duration': 100, 'uploader': 'U',
    'formats': [
      {'format_id': '140', 'ext': 'm4a', 'vcodec': 'none', 'acodec': 'mp4a', 'abr': 128, 'filesize': 1000, 'url': 'u'},
      {'format_id': '137', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'none', 'height': 1080, 'width': 1920, 'tbr': 800, 'filesize': 5000, 'url': 'u'},
      {'format_id': '18', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'mp4a', 'height': 360, 'width': 640, 'tbr': 300, 'url': 'u'},
      {'format_id': '160', 'ext': 'mp4', 'vcodec': 'avc1', 'acodec': 'none', 'height': 144, 'width': 256, 'tbr': 50, 'url': 'u'},
    ],
  };
  test('buildOptions: sorted desc, >=360p only, audio size added', () {
    final o = buildOptions(info);
    expect(o.video.map((v) => v.id), ['v1080', 'v360']);
    expect(o.video.first.estimatedBytes, 6000); // 5000 video + 1000 audio
    expect(o.audio.map((a) => a.id), ['a-m4a', 'a-mp3']);
  });
  test('fmtDuration', () {
    expect(fmtDuration(65), '1:05');
    expect(fmtDuration(3725), '1:02:05');
  });
  test('videoInfoFromJson', () => expect(videoInfoFromJson('https://y', info).channel, 'U'));
  test('fromYtDlp maps codes', () {
    expect(fromYtDlp('ERROR: Private video').code, 'PRIVATE');
    expect(fromYtDlp('weird').code, 'EXTRACTOR');
  });
}
