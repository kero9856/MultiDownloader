import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:multidownloader/core/errors.dart';
import 'package:multidownloader/core/format_selectors.dart';
import 'package:multidownloader/core/progress.dart';
import 'package:multidownloader/core/url_validator.dart';
import 'package:multidownloader/models/models.dart';
import 'package:multidownloader/services/history_store.dart';
import 'package:multidownloader/services/share_intake.dart';

void main() {
  test('safeName keeps Arabic and other scripts', () {
    expect(safeName('مرحبا بالعالم: الجزء 1؟'), 'مرحبا بالعالم الجزء 1');
    expect(safeName('日本語 title/x'), '日本語 titlex');
    expect(safeName('???'), 'video');
    expect(safeName('${'ب' * 150}').runes.length, 100);
  });

  test('bot check is not mistaken for login/sensitive', () {
    final e = fromYtDlp("ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.");
    expect(e.code, 'BOT_CHECK');
    expect(fromYtDlp('ERROR: log in for access').code, 'LOGIN_REQUIRED');
    expect(fromYtDlp('ERROR: geometry parse failed, unavailable thing').code, isNot('GEO_BLOCKED'));
    expect(fromYtDlp('ERROR: not available in your country').code, 'GEO_BLOCKED');
  });

  test('private IP literals are rejected', () {
    for (final u in ['http://127.0.0.1/a', 'http://192.168.1.5/a', 'http://10.0.0.1/a', 'http://172.20.1.1/a', 'http://169.254.169.254/a', 'http://[::1]/a', 'http://[fd00::1]/a']) {
      expect(() => validateUrl(u), throwsA(isA<BadUrlException>()), reason: u);
    }
    expect(validateUrl('https://93.184.216.34/v'), contains('93.184.216.34'));
    expect(validateUrl('https://youtube.com/watch?v=1'), contains('youtube.com'));
  });

  test('advanceProgress: two streams give one monotonic bar', () {
    var stage = 0; double last = 0, best = 0;
    for (final raw in [0.0, 50, 100, 5, 50, 100]) {
      final r = advanceProgress(stage: stage, streams: 2, lastRaw: last, raw: raw.toDouble());
      stage = r.stage; last = raw.toDouble();
      expect(r.overall, greaterThanOrEqualTo(best));
      best = r.overall;
    }
    expect(stage, 1);
    expect(best, 100);
    expect(advanceProgress(stage: 0, streams: 1, lastRaw: 90, raw: 10).stage, 0); // single stream never advances
  });

  test('ShareIntake.extractUrl', () {
    expect(ShareIntake.extractUrl('Cool video https://youtu.be/abc?si=1 check it'), 'https://youtu.be/abc?si=1');
    expect(ShareIntake.extractUrl('no link'), isNull);
  });

  test('HistoryStore: find/remove/clear and cheap list()', () {
    final d = Directory.systemTemp.createTempSync('hist');
    addTearDown(() => d.deleteSync(recursive: true));
    final h = HistoryStore(d);
    HistoryEntry e(String id) => HistoryEntry(id: id, type: 'video', title: id, file: '$id.mp4', path: '${d.path}/$id.mp4', url: 'u', optionId: 'v720', bytes: 1, at: 1);
    h.add(e('a')); h.add(e('b'));
    expect(h.find('a')?.title, 'a');
    h.refreshMissing();
    expect(h.find('a')!.missing, true);
    h.remove('a');
    expect(h.list().map((x) => x.id), ['b']);
    h.clear();
    expect(HistoryStore(d).list(), isEmpty);
  });
}
