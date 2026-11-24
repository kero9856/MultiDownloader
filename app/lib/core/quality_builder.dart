// Port of buildOptions / buildSubtitles / guessHeight / fmtDuration from original src/youtube.js and the info
// assembly of getInfoUncached(). Differences vs. the Node version (documented in PROJECT_PROGRESS.md):
//  - sizes are NOT probed over HTTP (no streamSize HEAD/Range requests yet): only filesize, filesize_approx, bitrate*duration.
import '../models/models.dart';
import 'errors.dart';

typedef Json = Map<String, dynamic>;

num _n(Json f, String k) => (f[k] is num) ? f[k] as num : 0;
String _s(Json f, String k) => (f[k] ?? '').toString();

String fmtDuration(num? s) {
  if (s == null || s == 0) return '0:00';
  final t = s.floor();
  final h = t ~/ 3600, m = (t % 3600) ~/ 60, sec = t % 60;
  final ss = sec.toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$ss' : '$m:$ss';
}

const _named = {'mobile': 144, 'lowest': 240, 'low': 360, 'sd': 480, 'hd': 720, 'full': 1080, 'quad': 1440, 'ultra': 2160};

int guessHeight(Json f) {
  final h = _n(f, 'height').toInt();
  if (h > 0) return h;
  final id = _s(f, 'format_id').toLowerCase();
  if (_named.containsKey(id)) return _named[id]!;
  final m = RegExp(r'(\d{3,4})p').firstMatch('$id ${_s(f, 'format_note')}') ?? RegExp(r'\d+x(\d{3,4})').firstMatch(_s(f, 'resolution'));
  return m != null ? int.parse(m.group(1)!) : 0;
}

bool hasVideo(Json f) =>
    f['url'] != null && _s(f, 'vcodec') != 'none' && _s(f, 'resolution') != 'audio only' && _s(f, 'ext') != 'mhtml';

class _Size {
  final int bytes;
  final bool exact;
  const _Size(this.bytes, this.exact);
}

_Size _streamSize(Json f, num duration) {
  final fs = _n(f, 'filesize');
  if (fs > 0) return _Size(fs.toInt(), true);
  if (_s(f, 'protocol').contains('m3u8') && _s(f, 'url').contains('googlevideo.com')) return const _Size(0, false);
  final fa = _n(f, 'filesize_approx');
  if (fa > 0) return _Size(fa.toInt(), false);
  return _Size((_n(f, 'tbr') * 1000 / 8 * duration).round(), false);
}

String _labelFor(int h) => h >= 2160 ? '${h}p · 4K' : h >= 1440 ? '${h}p · 2K' : '${h}p';

({List<QualityOption> video, List<QualityOption> audio}) buildOptions(Json info) {
  final formats = ((info['formats'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  final duration = _n(info, 'duration');

  int byAbr(Json a, Json b) => ((_n(b, 'abr') != 0 ? _n(b, 'abr') : _n(b, 'tbr')).compareTo(_n(a, 'abr') != 0 ? _n(a, 'abr') : _n(a, 'tbr')));
  final audioStreams = formats.where((f) => _s(f, 'vcodec') == 'none' && f['acodec'] != null && _s(f, 'acodec') != 'none').toList();
  final m4a = audioStreams.where((f) => _s(f, 'ext') == 'm4a').toList()..sort(byAbr);
  final all = [...audioStreams]..sort(byAbr);
  final bestAudio = m4a.isNotEmpty ? m4a.first : (all.isNotEmpty ? all.first : null);
  final audio = bestAudio != null ? _streamSize(bestAudio, duration) : const _Size(0, false);

  final byHeight = <int, List<Json>>{};
  for (final f in formats) {
    final h = guessHeight(f);
    if (h == 0 || !hasVideo(f)) continue;
    byHeight.putIfAbsent(h, () => []).add(f);
  }
  bool isHls(Json f) => _s(f, 'protocol').contains('m3u8');
  Json pickVideo(List<Json> list) {
    Json best(List<Json> arr) => ([...arr]..sort((a, b) => _n(b, 'tbr').compareTo(_n(a, 'tbr')))).first;
    final direct = list.where((f) => !isHls(f)).toList();
    final pool = direct.isNotEmpty ? direct : list;
    final mp4 = pool.where((f) => _s(f, 'ext') == 'mp4').toList();
    return best(mp4.isNotEmpty ? mp4 : pool);
  }

  final heights = byHeight.keys.toList()..sort((a, b) => b.compareTo(a));
  final video = <QualityOption>[];
  for (final height in heights) {
    final f = pickVideo(byHeight[height]!);
    final hasAudio = f['acodec'] != null && _s(f, 'acodec') != 'none';
    final v = _streamSize(f, duration);
    final bytes = v.bytes > 0 ? v.bytes + (hasAudio ? 0 : audio.bytes) : null;
    final exact = v.exact && (hasAudio || audio.exact);
    final w = _n(f, 'width').toInt();
    final short = w > 0 ? (w < height ? w : height) : height;
    video.add(QualityOption(
      id: _n(f, 'height') > 0 ? 'v$height' : 'f-${_s(f, 'format_id')}',
      isAudio: false, height: height, short: short, label: _labelFor(short),
      resolution: w > 0 ? '$w×$height' : null, fps: _n(f, 'fps') > 0 ? _n(f, 'fps').toDouble() : null,
      estimatedBytes: bytes, exact: exact,
    ));
  }
  final hd = video.where((v) => v.short >= 360).toList(); // original: 360p and up
  var videoList = hd.isNotEmpty ? hd : video;
  if (videoList.isEmpty && formats.any((f) => _s(f, 'vcodec') != 'none')) {
    final cand = formats.where(hasVideo).toList()..sort((a, b) => _n(b, 'tbr').compareTo(_n(a, 'tbr')));
    final probed = cand.isNotEmpty ? _streamSize(cand.first, duration) : const _Size(0, false);
    final fsz = _n(info, 'filesize').toInt();
    final bytes = fsz > 0 ? fsz : (probed.bytes > 0 ? probed.bytes : _n(info, 'filesize_approx').toInt());
    videoList = [QualityOption(id: 'vbest', isAudio: false, label: 'Best available', estimatedBytes: bytes > 0 ? bytes : null, exact: fsz > 0)];
  }
  return (
    video: videoList,
    audio: [
      QualityOption(id: 'a-m4a', isAudio: true, label: 'M4A', note: 'Original quality', estimatedBytes: audio.bytes > 0 ? audio.bytes : null, exact: audio.exact),
      QualityOption(id: 'a-mp3', isAudio: true, label: 'MP3', note: '192 kbps',
          estimatedBytes: (192 * 1000 / 8 * duration).round() > 0 ? (192 * 1000 / 8 * duration).round() : null),
    ],
  );
}

List<SubtitleTrack> buildSubtitles(Json info) {
  final out = <SubtitleTrack>[];
  String nameOf(dynamic v, String fb) =>
      (v is List && v.isNotEmpty && v[0] is Map && (v[0] as Map)['name'] != null) ? (v[0] as Map)['name'].toString() : fb;
  final subs = (info['subtitles'] as Map?) ?? const {};
  subs.forEach((lang, v) {
    if (lang == 'live_chat') return;
    out.add(SubtitleTrack(lang.toString(), nameOf(v, lang.toString()), false));
  });
  final auto = (info['automatic_captions'] as Map?) ?? const {};
  final orig = auto.keys.map((e) => e.toString()).where((k) => k.endsWith('-orig')).firstOrNull;
  final vidLang = _s(info, 'language').toLowerCase();
  for (final k in <String>{if (orig != null) orig, 'en', 'ar'}) {
    if (auto[k] == null || out.any((o) => o.lang == k && !o.auto)) continue;
    final same = k == orig || (vidLang.isNotEmpty && k.toLowerCase().startsWith(vidLang));
    final base = nameOf(auto[k], k).replaceAll(RegExp(r'\s*\(Original\)', caseSensitive: false), '');
    out.add(SubtitleTrack(k, '$base (${same ? 'auto-generated' : 'auto-translated'})', true));
  }
  return out;
}

/// Port of the object returned by getInfoUncached(). [info] is yt-dlp's `--dump-single-json` (already single video).
VideoInfo videoInfoFromJson(String url, Json info) {
  if (info['is_live'] == true) throw AppError('Live streams can’t be downloaded until they finish.');
  final thumbs = (info['thumbnails'] as List?) ?? const [];
  final opts = buildOptions(info);
  final dur = _n(info, 'duration');
  return VideoInfo(
    url: url, id: _s(info, 'id'), title: _s(info, 'title'),
    channel: (info['uploader'] ?? info['channel'] ?? 'Unknown channel').toString(),
    duration: dur.toInt(), durationText: fmtDuration(dur),
    thumbnail: (info['thumbnail'] ?? (thumbs.isNotEmpty && thumbs.last is Map ? (thumbs.last as Map)['url'] : null))?.toString(),
    video: opts.video, audio: opts.audio, subtitles: buildSubtitles(info), playable: buildPlayable(info),
  );
}

/// Candidates for native playback: one file with video+audio over http(s). Port of the filter in findPlayable().
List<PlayableFormat> buildPlayable(Json info) {
  final formats = ((info['formats'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e));
  return [
    for (final f in formats)
      if (f['url'] != null && _s(f, 'vcodec') != 'none' && f['acodec'] != null && _s(f, 'acodec') != 'none' &&
          const ['https', 'http'].contains(_s(f, 'protocol')) && const ['mp4', 'webm', 'm4v', 'mov'].contains(_s(f, 'ext')))
        PlayableFormat(
          url: _s(f, 'url'), ext: _s(f, 'ext'), formatId: _s(f, 'format_id'), height: guessHeight(f), tbr: _n(f, 'tbr').toDouble(),
          headers: {for (final e in ((f['http_headers'] as Map?) ?? const {}).entries) e.key.toString(): e.value.toString()},
        ),
  ];
}

/// Port of the selection logic of findPlayable(). null = this quality can't be played live.
PlayableFormat? pickPlayable(List<PlayableFormat> whole, String optionId) {
  if (whole.isEmpty) return null;
  int byBitrate(PlayableFormat a, PlayableFormat b) => b.tbr.compareTo(a.tbr);
  final fm = RegExp(r'^f-([\w.\-]+)$').firstMatch(optionId);
  final vm = RegExp(r'^v(\d{3,4})$').firstMatch(optionId);
  if (fm != null) {
    for (final f in whole) { if (f.formatId == fm.group(1)) return f; }
    return null;
  }
  if (vm != null) {
    final h = int.parse(vm.group(1)!);
    final atOrBelow = whole.where((f) => f.height > 0 && f.height <= h).toList();
    final exact = atOrBelow.where((f) => f.height == h).toList();
    final pool = exact.isNotEmpty ? exact : atOrBelow;
    if (pool.isEmpty) return null;
    return ([...pool]..sort(byBitrate)).first;
  }
  if (optionId == 'vbest') return ([...whole]..sort(byBitrate)).first;
  return null;
}
