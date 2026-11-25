// Download logic (no UI code). Ports original src/jobs.js, playlist/profile/subtitle/speed features.
// One folder per (url + quality [+ section]) => asking again resumes the same download (yt-dlp --continue).
// UNTESTED: written without a Dart compiler or a device. See PROJECT_PROGRESS.md.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import '../core/collections.dart';
import '../core/config.dart';
import '../core/errors.dart';
import '../core/format_selectors.dart';
import '../core/progress.dart';
import '../core/quality_builder.dart';
import '../core/speed.dart';
import '../core/url_validator.dart';
import '../core/watched_ranges.dart';
import '../models/models.dart';
import 'history_store.dart';
import 'settings_store.dart';
import 'ytdlp_bridge.dart';

/// Generic quality list for playlists (original shows a generic list until "Show all sizes" is pressed).
const playlistQualities = <(String, String)>[
  ('v1080', '1080p'), ('v720', '720p'), ('v480', '480p'), ('v360', '360p'),
  ('vbest', 'Best available'), ('a-m4a', 'Audio M4A'), ('a-mp3', 'Audio MP3'),
];

String _mime(String ext) => switch (ext) {
      'mp4' => 'video/mp4', 'm4a' => 'audio/mp4', 'mp3' => 'audio/mpeg', 'webm' => 'video/webm',
      'srt' => 'application/x-subrip', 'vtt' => 'text/vtt', _ => 'application/octet-stream',
    };

class DownloadManager extends ChangeNotifier {
  final YtDlpBridge bridge;
  DownloadManager(this.bridge);

  late Directory baseDir;
  late HistoryStore history;
  late SettingsStore _settingsStore;
  AppSettings settings = AppSettings();
  Map<String, String> engine = {};
  bool ready = false;
  String? initError;
  final Map<String, DownloadJob> jobs = {};
  final Map<String, (DateTime, VideoInfo)> _infoCache = {}; // TTL: AppConfig.infoCacheMinutes (stream URLs expire)
  bool _ufDirty = true;
  List<Map<String, dynamic>> _uf = [];
  final List<String> _queue = [];
  final Map<String, Timer> _watchdogs = {};
  StreamSubscription<DownloadProgress>? _sub;
  bool _svcOn = false;
  DateTime _lastSvc = DateTime.fromMillisecondsSinceEpoch(0);

  bool get aria2Available => engine['aria2c'] == 'available';

  Future<void> init() async {
    try {
      // Private working dir (resumable partial files live here). Finished files are copied to public Download/ (see settings).
      final ext = await getExternalStorageDirectory();
      baseDir = Directory('${(ext ?? await getApplicationDocumentsDirectory()).path}/downloads')..createSync(recursive: true);
      history = HistoryStore(baseDir);
      _settingsStore = SettingsStore(baseDir);
      settings = _settingsStore.load();
      bridge.insecureTls = settings.insecureTls;
      await bridge.init();
      try { engine = await bridge.diagnose(); } catch (_) {}
      _sub = bridge.progress.listen(_onProgress);
      bridge.requestPermissions().catchError((_) {});
      _ufDirty = true;
      ready = true;
    } catch (e) {
      initError = e.toString();
    }
    notifyListeners();
  }

  @override
  void dispose() { _sub?.cancel(); for (final t in _watchdogs.values) { t.cancel(); } super.dispose(); }

  void updateSettings(AppSettings s) {
    settings = s;
    bridge.insecureTls = s.insecureTls;
    _settingsStore.save(s);
    notifyListeners();
  }

  void _changed() { notifyListeners(); _syncService(); }

  // ================= info / playlist / profile =================
  Future<VideoInfo> getInfo(String raw) async {
    final url = validateUrl(raw);
    final hit = _infoCache[url];
    if (hit != null && DateTime.now().difference(hit.$1).inMinutes < AppConfig.infoCacheMinutes) return hit.$2;
    _infoCache.remove(url);
    try {
      var json = await bridge.getInfo(url);
      if (json['formats'] == null && json['entries'] is List) {
        final withFormats = (json['entries'] as List).whereType<Map>().where((e) => e['formats'] is List && (e['formats'] as List).isNotEmpty).toList();
        if (withFormats.length == 1) {
          json = Map<String, dynamic>.from(withFormats.first);
        } else if (withFormats.length > 1) {
          throw AppError('This post has ${withFormats.length} videos. Pick one.', 'MULTI_VIDEO');
        } else {
          throw AppError('This link is a list of videos. Paste the link of one single video.', 'IS_PLAYLIST');
        }
      }
      final info = videoInfoFromJson(url, json);
      _infoCache[url] = (DateTime.now(), info);
      return info;
    } on AppError {
      rethrow;
    } catch (e) {
      throw fromYtDlp(e);
    }
  }

  Future<PlaylistInfo> getPlaylist(String raw) async {
    final url = validateUrl(raw);
    if (!isYouTubeHost(Uri.parse(url))) throw AppError('Playlists are supported for YouTube only.', 'BAD_URL');
    try {
      return playlistFromJson(await bridge.getInfo(url, playlist: true, playlistEnd: 200));
    } on AppError {
      rethrow;
    } catch (e) {
      throw fromYtDlp(e);
    }
  }

  Future<ProfileInfo> getProfile(String raw) async {
    final url = validateUrl(raw);
    final u = Uri.parse(url);
    if (!isYouTubeHost(u) && !isTikTokHost(u)) throw AppError('Account lookup works for YouTube and TikTok accounts.', 'BAD_URL');
    final fetchUrl = profileFetchUrl(u);
    try {
      return profileFromJson(u, fetchUrl, await bridge.getInfo(fetchUrl, playlist: true, playlistEnd: 50));
    } catch (e) {
      final err = e is AppError ? e : fromYtDlp(e);
      if (isTikTokHost(u) && e is! AppError) {
        throw AppError('TikTok usually blocks reading account pages. Paste the link of one video instead. (${err.message})', 'PROFILE_FAILED');
      }
      throw err;
    }
  }

  // ================= download =================
  String jobId(String url, String optionId) {
    final u = Uri.parse(url);
    final stable = RegExp(r'\.(m3u8|mpd|mp4|webm|mkv|mp3|m4a)$', caseSensitive: false).hasMatch(u.path)
        ? '${u.scheme}://${u.authority}${u.path}' : url;
    return sha256.convert(utf8.encode('$stable\n$optionId')).toString().substring(0, 16);
  }

  DownloadJob start(VideoInfo info, QualityOption opt, {String? fileName}) =>
      _enqueue(url: info.url, optionId: opt.id, label: opt.label, isAudio: opt.isAudio,
          title: safeName((fileName?.trim().isNotEmpty ?? false) ? fileName : info.title), thumbnail: info.thumbnail);

  /// Playlist: queue the ticked entries at one generic quality (they run [maxConcurrentJobs] at a time).
  List<DownloadJob> startPlaylist(List<PlaylistEntry> entries, String optionId) {
    final label = playlistQualities.firstWhere((q) => q.$1 == optionId, orElse: () => (optionId, optionId)).$2;
    return [
      for (final e in entries)
        _enqueue(url: e.url, optionId: optionId, label: label, isAudio: optionId.startsWith('a-'), title: safeName(e.title), thumbnail: e.thumbnail),
    ];
  }

  /// "Save what I watched": yt-dlp --download-sections on the bounding range of the watched parts.
  /// (The original joined separate pieces with ffmpeg concat; a standalone ffmpeg binary isn't available here.)
  DownloadJob saveWatched(VideoInfo info, QualityOption opt, List<WatchedRange> ranges) {
    if (ranges.isEmpty) throw AppError('Nothing has been watched yet at this quality.', 'NOTHING_WATCHED');
    final a = ranges.first.start, b = ranges.last.end;
    String f(double v) => v.toStringAsFixed(1);
    return _enqueue(
      url: info.url, optionId: opt.id, label: '${opt.label} (watched part)', isAudio: false,
      title: '${safeName(info.title)} (watched part)', extra: ['--download-sections', '*${f(a)}-${f(b)}'], idSuffix: ':w${f(a)}-${f(b)}', thumbnail: info.thumbnail);
  }

  DownloadJob _enqueue({
    required String url, required String optionId, required String label, required bool isAudio, required String title,
    List<String> extra = const [], String idSuffix = '', String? thumbnail,
  }) {
    final id = jobId(url, '$optionId$idSuffix');
    final existing = jobs[id];
    if (existing != null && (existing.active || existing.status == JobStatus.done)) return existing;
    final o = flagsForOption(optionId); // throws on unknown option
    _ufDirty = true;
    final dir = Directory('${baseDir.path}/$id')..createSync(recursive: true);
    final job = DownloadJob(id: id, url: url, title: title, optionId: optionId, optionLabel: label,
        dirPath: dir.path, isAudio: isAudio, ext: o.ext)
      ..extra = extra
      ..thumbnail = thumbnail
      ..streams = o.streams
      ..idSuffix = idSuffix;
    File('${dir.path}/job.json').writeAsStringSync(jsonEncode({
      'url': url, 'title': title, 'optionId': optionId, 'label': label, 'isAudio': isAudio,
      'extra': extra, 'idSuffix': idSuffix, 'at': DateTime.now().millisecondsSinceEpoch,
    }));
    final finished = _readFinished(dir);
    jobs[id] = job;
    if (finished != null) {
      job..status = JobStatus.done..percent = 100..filePath = finished.path;
      _changed();
      return job;
    }
    _queue.add(id);
    _pump();
    _changed();
    return job;
  }

  File? _readFinished(Directory dir) {
    try {
      final meta = jsonDecode(File('${dir.path}/meta.json').readAsStringSync()) as Map;
      final f = File('${dir.path}/${meta['file']}');
      return f.existsSync() ? f : null;
    } catch (_) {
      return null;
    }
  }

  int get _running => jobs.values.where((j) => j.status == JobStatus.downloading || j.status == JobStatus.processing).length;

  void _pump() {
    while (_queue.isNotEmpty && _running < AppConfig.maxConcurrentJobs) {
      final job = jobs[_queue.removeAt(0)];
      if (job != null && job.status == JobStatus.queued) _run(job);
    }
  }

  int _sizeOnDisk(String dir) {
    var total = 0;
    try {
      for (final f in Directory(dir).listSync().whereType<File>()) {
        final n = f.path.split('/').last;
        if (n == 'job.json' || n == 'meta.json' || n.endsWith('.ytdl') || n.endsWith('.temp')) continue;
        total += f.lengthSync();
      }
    } catch (_) {}
    return total;
  }

  /// Port of the stall watchdog: no new data for STALL_SECONDS => stop yt-dlp, the loop in _run restarts it and it resumes.
  void _startWatchdog(DownloadJob job) {
    var lastSize = _sizeOnDisk(job.dirPath);
    var lastAt = DateTime.now();
    _watchdogs[job.id]?.cancel();
    _watchdogs[job.id] = Timer.periodic(const Duration(seconds: 5), (t) {
      if (job.status != JobStatus.downloading) { t.cancel(); return; }
      final size = _sizeOnDisk(job.dirPath);
      if (size != lastSize || job.lastProgressAt.isAfter(lastAt)) { lastSize = size; lastAt = DateTime.now(); return; }
      if (AppConfig.stallSeconds > 0 && DateTime.now().difference(lastAt).inSeconds >= AppConfig.stallSeconds) {
        lastAt = DateTime.now();
        job.restartRequested = true;
        bridge.cancel(job.id);
      }
    });
  }

  Future<void> _run(DownloadJob job) async {
    job.status = JobStatus.downloading;
    job.lastProgressAt = DateTime.now();
    _changed();
    _startWatchdog(job);
    try {
      String out;
      while (true) {
        try {
          out = await bridge.download(
            processId: job.id, url: job.url, outputDir: job.dirPath,
            args: [...flagsForOption(job.optionId).args, ...speedArgs(settings, aria2Available: aria2Available), ...job.extra]);
          break;
        } catch (e) {
          if (job.restartRequested && job.status == JobStatus.downloading) { job.restartRequested = false; job.lastRaw = 0; continue; }
          rethrow;
        }
      }
      job.status = JobStatus.processing;
      _changed();
      final dest = await File(out).rename('${job.dirPath}/${job.title}.${job.ext}');
      final finalName = dest.path.split('/').last;
      final bytes = await dest.length();
      File('${job.dirPath}/meta.json').writeAsStringSync(jsonEncode({'file': finalName, 'title': job.title, 'ext': job.ext}));
      String? publicUri;
      if (settings.saveToPublicDownloads) {
        try {
          publicUri = await bridge.exportToDownloads(dest.path, finalName, _mime(job.ext));
        } catch (e) {
          job.note = 'Saved in app folder only (could not copy to Download: $e)';
        }
      }
      job..filePath = dest.path..publicUri = publicUri..status = JobStatus.done..percent = 100;
      history.add(HistoryEntry(id: job.id, type: job.isAudio ? 'audio' : 'video', title: job.title, file: finalName,
          path: dest.path, url: job.url, optionId: job.optionId, bytes: bytes, at: DateTime.now().millisecondsSinceEpoch, publicUri: publicUri, thumbnail: job.thumbnail));
    } catch (e) {
      if (job.status != JobStatus.cancelled) {
        job..status = JobStatus.error..error = fromYtDlp(e).message;
      }
    }
    _watchdogs.remove(job.id)?.cancel();
    _ufDirty = true;
    _changed();
    _pump();
  }

  void _onProgress(DownloadProgress p) {
    final j = jobs[p.processId];
    if (j == null || j.status != JobStatus.downloading) return;
    if (p.percent >= 0) {
      // yt-dlp reports 0..100 per stream (video, then audio): map to one overall bar that never goes backwards.
      final r = advanceProgress(stage: j.stage, streams: j.streams, lastRaw: j.lastRaw, raw: p.percent);
      j.stage = r.stage;
      j.lastRaw = p.percent;
      if (r.overall > j.percent) j.percent = r.overall;
    }
    j.etaSeconds = p.etaSeconds;
    j.lastProgressAt = DateTime.now();
    _changed();
  }

  /// Partial files stay on disk, so the same request resumes later (Unfinished list).
  Future<void> cancel(String id) async {
    final j = jobs[id];
    if (j == null || j.status == JobStatus.processing || !j.active) return; // processing = finishing/copying, can't be interrupted
    j.status = JobStatus.cancelled;
    _ufDirty = true;
    _queue.remove(id);
    await bridge.cancel(id);
    _changed();
  }

  // ================= unfinished: list / resume / discard =================
  /// Cached: scanning the disk on every progress tick made the UI janky. Rescanned only after real changes.
  List<Map<String, dynamic>> listUnfinished() {
    if (_ufDirty) { _uf = _scanUnfinished(); _ufDirty = false; }
    return _uf;
  }

  List<Map<String, dynamic>> _scanUnfinished() {
    final out = <Map<String, dynamic>>[];
    try {
      for (final d in baseDir.listSync().whereType<Directory>()) {
        final name = d.path.split('/').last;
        // Jobs known in this session (running, cancelled, failed) are shown as job tiles (with a resume button) instead.
        if (!RegExp(r'^[0-9a-f]{16}$').hasMatch(name) || jobs.containsKey(name)) continue;
        if (File('${d.path}/meta.json').existsSync() || !File('${d.path}/job.json').existsSync()) continue;
        try {
          out.add({'id': name, 'bytes': _sizeOnDisk(d.path), ...jsonDecode(File('${d.path}/job.json').readAsStringSync()) as Map<String, dynamic>});
        } catch (_) {}
      }
    } catch (_) {}
    return out;
  }

  /// Resume a cancelled / failed job of this session (same folder, yt-dlp --continue).
  DownloadJob resumeJob(String id) {
    final j = jobs[id];
    if (j == null || j.active) return j ?? (throw AppError('Unknown download.', 'NO_JOB'));
    jobs.remove(id);
    return _enqueue(url: j.url, optionId: j.optionId, label: j.optionLabel, isAudio: j.isAudio, title: j.title, extra: j.extra, idSuffix: j.idSuffix, thumbnail: j.thumbnail);
  }

  DownloadJob resume(Map<String, dynamic> u) {
    jobs.remove(u['id']); // forget an old cancelled/errored job object with the same id
    _ufDirty = true;
    return _enqueue(
      url: u['url'] as String, optionId: u['optionId'] as String, label: (u['label'] ?? u['optionId']) as String,
      isAudio: (u['isAudio'] as bool?) ?? (u['optionId'] as String).startsWith('a-'), title: (u['title'] ?? 'video') as String,
      extra: [for (final x in (u['extra'] as List? ?? const [])) x.toString()], idSuffix: (u['idSuffix'] ?? '') as String);
  }

  /// Removes finished jobs from the Downloads list only (files stay in History).
  void clearFinishedJobs() {
    jobs.removeWhere((_, j) => j.status == JobStatus.done);
    _changed();
  }

  void discardUnfinished(String id) {
    if (!RegExp(r'^[0-9a-f]{16}$').hasMatch(id) || jobs[id]?.active == true) return;
    try { Directory('${baseDir.path}/$id').deleteSync(recursive: true); } catch (_) {}
    jobs.remove(id);
    _ufDirty = true;
    _changed();
  }

  // ================= history: delete files together with the entry =================
  Future<void> _deleteEntryFiles(HistoryEntry e) async {
    try {
      final file = File(e.path);
      final parent = file.parent;
      final isJobDir = RegExp(r'^[0-9a-f]{16}$').hasMatch(parent.path.split('/').last) && parent.parent.path == baseDir.path;
      if (e.type != 'subtitle' && isJobDir) {
        if (jobs[e.id]?.active != true) parent.deleteSync(recursive: true); // video/audio + job.json/meta.json
      } else if (file.existsSync()) {
        file.deleteSync();
      }
    } catch (_) {}
    final pub = e.publicUri;
    if (pub != null && pub.isNotEmpty) {
      try { await bridge.deletePublic(pub); } catch (_) {}
    }
    if (jobs[e.id]?.active != true) jobs.remove(e.id);
  }

  /// Removes the entry AND the app's copy AND the copy in Download/MultiDownloader.
  Future<void> deleteHistoryEntry(String id) async {
    final e = history.find(id);
    if (e != null) await _deleteEntryFiles(e);
    history.remove(id);
    _ufDirty = true;
    _changed();
  }

  Future<void> clearHistory() async {
    for (final e in List.of(history.list())) { await _deleteEntryFiles(e); }
    history.clear();
    _ufDirty = true;
    _changed();
  }

  /// History tab opened: refresh the "file missing" flags once.
  void refreshHistory() { history.refreshMissing(); notifyListeners(); }

  // ================= subtitles =================
  /// Port of downloadSubtitles(): downloads only the subtitle file, saves it in the downloads folder (+ public copy).
  Future<HistoryEntry> downloadSubtitles(VideoInfo info, SubtitleTrack track, {String format = 'srt'}) async {
    if (!RegExp(r'^[A-Za-z0-9_-]{2,30}$').hasMatch(track.lang)) throw AppError('Unknown subtitle language.', 'BAD_LANG');
    final fmt = const ['srt', 'vtt'].contains(format) ? format : 'srt';
    final tmp = Directory('${baseDir.path}/.sub-${Random().nextInt(1 << 32).toRadixString(16)}')..createSync(recursive: true);
    try {
      try {
        await bridge.exec(url: info.url, args: [
          '--skip-download', track.auto ? '--write-auto-subs' : '--write-subs', '--sub-langs', track.lang,
          '--sub-format', 'vtt/best', '--convert-subs', fmt, '-o', '${tmp.path}/sub.%(ext)s', '--retries', '3',
        ]);
      } catch (e) {
        throw fromYtDlp(e);
      }
      final made = tmp.listSync().whereType<File>().where((f) => f.path.toLowerCase().endsWith('.$fmt')).firstOrNull;
      if (made == null) throw AppError('This subtitle could not be downloaded. Try another language, or try again in a minute.', 'NO_SUBTITLE');
      final dir = Directory('${baseDir.path}/subtitles')..createSync(recursive: true);
      final base = safeName(info.title).length > 80 ? safeName(info.title).substring(0, 80) : safeName(info.title);
      var name = '$base (${track.lang}).$fmt';
      for (var n = 2; File('${dir.path}/$name').existsSync(); n++) { name = '$base (${track.lang} $n).$fmt'; }
      final dest = await made.copy('${dir.path}/$name');
      String? publicUri;
      if (settings.saveToPublicDownloads) {
        try { publicUri = await bridge.exportToDownloads(dest.path, name, _mime(fmt)); } catch (_) {}
      }
      final e = HistoryEntry(id: 's${Random().nextInt(1 << 32).toRadixString(16)}', type: 'subtitle', title: name, file: name, path: dest.path,
          url: info.url, optionId: track.lang, bytes: await dest.length(), at: DateTime.now().millisecondsSinceEpoch, publicUri: publicUri);
      history.add(e);
      notifyListeners();
      return e;
    } finally {
      try { tmp.deleteSync(recursive: true); } catch (_) {}
    }
  }

  // ================= native preview helpers =================
  /// Port of findPlayable(). null => this quality can't be played live (original message in the UI).
  PlayableFormat? playableFor(VideoInfo info, String optionId) => pickPlayable(info.playable, optionId);

  // ================= foreground service =================
  void _syncService() {
    final active = jobs.values.where((j) => j.active).toList();
    if (active.isEmpty) {
      if (_svcOn) { _svcOn = false; bridge.serviceStop().catchError((_) {}); }
      return;
    }
    final now = DateTime.now();
    if (_svcOn && now.difference(_lastSvc).inMilliseconds < 1000) return;
    _lastSvc = now;
    _svcOn = true;
    final dl = active.where((j) => j.status == JobStatus.downloading).toList();
    final avg = dl.isEmpty ? 0 : dl.map((j) => j.percent).reduce((a, b) => a + b) / dl.length;
    bridge.serviceUpdate('${active.length} download${active.length == 1 ? '' : 's'} in progress', avg.round()).catchError((_) {});
  }

  /// Returns the status text of the update (e.g. ALREADY_UP_TO_DATE).
  Future<String> updateYtDlp() => bridge.updateYtDlp(channel: 'stable');
}
