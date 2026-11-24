// Dart side of the native bridge (android/.../YtDlpBridge.kt). yt-dlp + ffmpeg run ON the phone.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/services.dart';

class DownloadProgress {
  final String processId;
  final double percent;
  final int etaSeconds;
  final String line;
  DownloadProgress(this.processId, this.percent, this.etaSeconds, this.line);
}

class YtDlpBridge {
  static const _method = MethodChannel('multidownloader/ytdlp');
  static const _events = EventChannel('multidownloader/ytdlp/progress');

  Stream<DownloadProgress>? _stream;

  /// Mirrors AppSettings.insecureTls; sent with every yt-dlp call.
  bool insecureTls = false;

  Future<void> init() => _method.invokeMethod('init');

  /// POST /api/info, /api/playlist, /api/profile: yt-dlp `--dump-single-json`.
  Future<Map<String, dynamic>> getInfo(String url, {bool playlist = false, int playlistEnd = 200}) async {
    final s = await _method.invokeMethod<String>('getInfo', {'url': url, 'playlist': playlist, 'playlistEnd': playlistEnd, 'insecure': insecureTls});
    return jsonDecode(s!) as Map<String, dynamic>;
  }

  /// Generic yt-dlp run (used for subtitles). Returns stdout.
  Future<String> exec({required String url, required List<String> args}) async =>
      (await _method.invokeMethod<String>('exec', {'url': url, 'args': args, 'insecure': insecureTls})) ?? '';

  Future<String> download({
    required String processId,
    required String url,
    required String outputDir,
    required List<String> args,
  }) async {
    final p = await _method.invokeMethod<String>('download',
        {'processId': processId, 'url': url, 'outputDir': outputDir, 'args': args, 'insecure': insecureTls});
    return p!;
  }

  Future<bool> cancel(String processId) async =>
      (await _method.invokeMethod<bool>('cancel', {'processId': processId})) ?? false;

  /// Engine status: yt-dlp version, ABI, js runtime, aria2c.
  Future<Map<String, String>> diagnose() async =>
      Map<String, String>.from(await _method.invokeMethod<Map>('diagnose') ?? {});

  Future<String> updateYtDlp({String channel = 'stable'}) async =>
      (await _method.invokeMethod<String>('update', {'channel': channel})) ?? '';

  // ---- foreground service (keeps downloads alive in background) ----
  Future<void> serviceUpdate(String text, int percent) =>
      _method.invokeMethod('serviceUpdate', {'text': text, 'percent': percent});
  Future<void> serviceStop() => _method.invokeMethod('serviceStop');

  /// Asks POST_NOTIFICATIONS (API 33+) and WRITE_EXTERNAL_STORAGE (API <= 28). Fire-and-forget.
  Future<void> requestPermissions() => _method.invokeMethod('requestPermissions');

  // ---- Scoped storage ----
  /// Copies [path] into Download/MultiDownloader (MediaStore on API 29+). Returns the content uri / path.
  Future<String> exportToDownloads(String path, String displayName, String mime) async =>
      (await _method.invokeMethod<String>('exportToDownloads', {'path': path, 'displayName': displayName, 'mime': mime}))!;

  /// Deletes the public copy (MediaStore uri on API 29+, plain path before).
  Future<bool> deletePublic(String uri) async => (await _method.invokeMethod<bool>('deletePublic', {'uri': uri})) ?? false;

  Stream<DownloadProgress> get progress => _stream ??= _events.receiveBroadcastStream().map((e) {
        final m = Map<String, dynamic>.from(e as Map);
        return DownloadProgress(m['processId'] as String, (m['percent'] as num).toDouble(),
            (m['eta'] as num).toInt(), (m['line'] as String?) ?? '');
      });
}
