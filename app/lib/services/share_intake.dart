// Links shared into the app from other apps (Android ACTION_SEND). Bridge: MainActivity.kt channel "multidownloader/share".
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class ShareIntake {
  static const _ch = MethodChannel('multidownloader/share');

  /// Last shared URL not yet handled by the UI. HomePage clears it after using it.
  static final ValueNotifier<String?> pending = ValueNotifier(null);

  static final _urlRe = RegExp(r'https?://[^\s<>"]+', caseSensitive: false);

  /// First http(s) link inside the shared text (YouTube/TikTok share "title + link").
  static String? extractUrl(String text) => _urlRe.firstMatch(text)?.group(0);

  static Future<void> init() async {
    _ch.setMethodCallHandler((call) async {
      if (call.method == 'shared' && call.arguments is String) _set(call.arguments as String);
    });
    try {
      final t = await _ch.invokeMethod<String>('initial');
      if (t != null) _set(t);
    } catch (_) {}
  }

  static void _set(String text) {
    final u = extractUrl(text);
    if (u != null) pending.value = u;
  }
}
