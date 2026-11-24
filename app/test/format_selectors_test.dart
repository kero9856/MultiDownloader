import 'package:flutter_test/flutter_test.dart';
import 'package:multidownloader/core/format_selectors.dart';
import 'package:multidownloader/core/url_validator.dart';

void main() {
  test('v720 selector matches original JS', () {
    final o = flagsForOption('v720');
    expect(o.args[1], startsWith('bv*[height<=720][ext=mp4][protocol!*=m3u8]+ba[ext=m4a]/'));
    expect(o.ext, 'mp4');
  });
  test('audio options', () {
    expect(flagsForOption('a-mp3').args, contains('192K'));
    expect(flagsForOption('a-m4a').ext, 'm4a');
  });
  test('bad option throws', () => expect(() => flagsForOption('zzz'), throwsArgumentError));
  test('safeName', () => expect(safeName('a/b:c?'), 'abc'));
  test('url validation', () {
    expect(() => validateUrl('ftp://x.com/a'), throwsA(isA<BadUrlException>()));
    expect(() => validateUrl('http://localhost/a'), throwsA(isA<BadUrlException>()));
    expect(validateUrl('https://fxtwitter.com/u/status/1'), contains('x.com'));
    expect(validateUrl('https://ok.ru/videoembed/123'), endsWith('/video/123'));
  });
}
