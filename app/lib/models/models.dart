class QualityOption {
  final String id; // v720 | vbest | f-<id> | a-m4a | a-mp3
  final bool isAudio;
  final String label;
  final String? resolution, note;
  final int height, short;
  final double? fps;
  final int? estimatedBytes;
  final bool exact;
  const QualityOption({
    required this.id, required this.isAudio, required this.label, this.resolution, this.note,
    this.height = 0, this.short = 0, this.fps, this.estimatedBytes, this.exact = false,
  });
}

class SubtitleTrack {
  final String lang, name;
  final bool auto;
  const SubtitleTrack(this.lang, this.name, this.auto);
}

/// A directly playable (video+audio in one file, http) format - port of findPlayable() candidates.
class PlayableFormat {
  final String url, ext, formatId;
  final Map<String, String> headers;
  final int height;
  final double tbr;
  const PlayableFormat({required this.url, required this.ext, required this.formatId, required this.headers, required this.height, required this.tbr});
}

class VideoInfo {
  final String url, id, title, channel, durationText;
  final List<PlayableFormat> playable;
  final int duration;
  final String? thumbnail;
  final List<QualityOption> video, audio;
  final List<SubtitleTrack> subtitles;
  const VideoInfo({
    required this.url, required this.id, required this.title, required this.channel, required this.duration,
    required this.durationText, required this.thumbnail, required this.video, required this.audio, required this.subtitles, this.playable = const [],
  });
}

enum JobStatus { queued, downloading, processing, done, error, cancelled }

class DownloadJob {
  final String id, url, title, optionId, optionLabel, dirPath;
  final bool isAudio;
  final String ext;
  JobStatus status = JobStatus.queued;
  double percent = 0;
  int etaSeconds = 0;
  String? error, filePath, publicUri, note;
  List<String> extra = const [];
  bool restartRequested = false;
  int streams = 1, stage = 0; // streams: video+audio = 2; stage: which stream yt-dlp is on (progress restarts at 0 for each)
  double lastRaw = 0;
  String idSuffix = '';
  DateTime lastProgressAt = DateTime.fromMillisecondsSinceEpoch(0);
  DownloadJob({
    required this.id, required this.url, required this.title, required this.optionId, required this.optionLabel,
    required this.dirPath, required this.isAudio, required this.ext,
  });
  bool get active => status == JobStatus.queued || status == JobStatus.downloading || status == JobStatus.processing;
}

class HistoryEntry {
  final String id, type, title, file, path, url, optionId;
  final String? publicUri; // MediaStore uri / public path of the copy in Download/MultiDownloader
  final int bytes, at;
  bool missing;
  HistoryEntry({required this.id, required this.type, required this.title, required this.file, required this.path,
      required this.url, required this.optionId, required this.bytes, required this.at, this.publicUri, this.missing = false});
  Map<String, dynamic> toJson() => {'id': id, 'type': type, 'title': title, 'file': file, 'path': path, 'bytes': bytes,
        'url': url, 'optionId': optionId, 'at': at, 'publicUri': publicUri};
  factory HistoryEntry.fromJson(Map<String, dynamic> j) => HistoryEntry(
      id: j['id'] as String, type: (j['type'] ?? 'video') as String, title: (j['title'] ?? '') as String,
      file: (j['file'] ?? '') as String, path: (j['path'] ?? '') as String, url: (j['url'] ?? '') as String,
      optionId: (j['optionId'] ?? '') as String, bytes: ((j['bytes'] ?? 0) as num).toInt(), at: ((j['at'] ?? 0) as num).toInt(), publicUri: j['publicUri'] as String?);
}

class PlaylistEntry {
  final String id, title, durationText, channel, thumbnail, url;
  final int duration;
  const PlaylistEntry({required this.id, required this.title, required this.duration, required this.durationText,
      required this.channel, required this.thumbnail, required this.url});
}

class PlaylistInfo {
  final String title, channel;
  final int count, total;
  final List<PlaylistEntry> entries;
  const PlaylistInfo({required this.title, required this.channel, required this.count, required this.total, required this.entries});
}

class ProfileInfo {
  final String platform, name, handle, url, description;
  final int? followers, videoCount;
  final String? avatar;
  final List<PlaylistEntry> entries;
  const ProfileInfo({required this.platform, required this.name, required this.handle, required this.url, required this.description,
      required this.followers, required this.videoCount, required this.avatar, required this.entries});
}

/// Download speed + storage settings (original: /api/speed; storage is new for Android).
class AppSettings {
  String speedMode; // normal | fast | max
  double limitMBps; // 0 = no limit
  bool saveToPublicDownloads;
  bool insecureTls; // --no-check-certificates (off by default; only for devices with broken CA stores)
  AppSettings({this.speedMode = 'fast', this.limitMBps = 0, this.saveToPublicDownloads = true, this.insecureTls = false});
  Map<String, dynamic> toJson() => {'speedMode': speedMode, 'limitMBps': limitMBps, 'saveToPublicDownloads': saveToPublicDownloads, 'insecureTls': insecureTls};
  factory AppSettings.fromJson(Map<String, dynamic> j) => AppSettings(
      speedMode: (j['speedMode'] as String?) ?? 'fast', limitMBps: ((j['limitMBps'] ?? 0) as num).toDouble(),
      saveToPublicDownloads: (j['saveToPublicDownloads'] as bool?) ?? true, insecureTls: (j['insecureTls'] as bool?) ?? false);
}
