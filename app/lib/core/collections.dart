// Ports of getPlaylist() / getProfile() parsing and the URL helpers of public/app.js (isPlaylistPage, isProfileUrl).
// The yt-dlp call itself is done by the DownloadManager (bridge.getInfo(playlist: true)).
import '../models/models.dart';
import 'errors.dart';
import 'quality_builder.dart';

bool _isHost(String host, String d) => host == d || host.endsWith('.$d');

bool isYouTubeHost(Uri u) => _isHost(u.host.toLowerCase(), 'youtube.com');
bool isTikTokHost(Uri u) => _isHost(u.host.toLowerCase(), 'tiktok.com');

bool isPlaylistPage(Uri u) => isYouTubeHost(u) && u.path == '/playlist' && u.queryParameters.containsKey('list');

bool isProfileUrl(Uri u) {
  if (isYouTubeHost(u)) {
    return RegExp(r'^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)(/(videos|featured|about|shorts|streams))?/?$').hasMatch(u.path);
  }
  if (isTikTokHost(u)) return RegExp(r'^/@[^/]+/?$').hasMatch(u.path);
  return false;
}

/// "This video is part of a playlist": watch?v=..&list=.. -> playlist page url (original notice button).
String? playlistUrlFromVideo(Uri u) {
  final list = u.queryParameters['list'];
  if (list == null || !isYouTubeHost(u) || u.path == '/playlist') return null;
  return 'https://www.youtube.com/playlist?list=$list';
}

List<PlaylistEntry> _entries(Json data, {required bool yt, String ttUser = '', bool profile = false}) {
  final out = <PlaylistEntry>[];
  for (final e in ((data['entries'] as List?) ?? const []).whereType<Map>()) {
    if (e['id'] == null) continue;
    final id = e['id'].toString();
    final dur = (e['duration'] is num) ? (e['duration'] as num).toInt() : 0;
    final channelData = (data['channel'] ?? data['uploader'] ?? '').toString();
    String thumb;
    if (yt) {
      thumb = 'https://i.ytimg.com/vi/$id/mqdefault.jpg';
    } else {
      final th = (e['thumbnails'] as List?) ?? const [];
      thumb = (th.isNotEmpty && th.last is Map ? (th.last as Map)['url'] : e['thumbnail'])?.toString() ?? '';
    }
    String url;
    if (yt) {
      url = 'https://www.youtube.com/watch?v=$id';
    } else {
      final eu = (e['url'] ?? '').toString();
      url = RegExp(r'^https?:').hasMatch(eu) ? eu : 'https://www.tiktok.com/@$ttUser/video/$id';
    }
    final rawTitle = (e['title'] ?? (profile ? e['description'] : null) ?? (profile ? 'Untitled video' : 'Untitled video')).toString();
    out.add(PlaylistEntry(
      id: id, title: profile && rawTitle.length > 200 ? rawTitle.substring(0, 200) : rawTitle, duration: dur,
      durationText: dur > 0 ? fmtDuration(dur) : '',
      channel: profile ? channelData : (e['channel'] ?? e['uploader'] ?? channelData).toString(),
      thumbnail: thumb, url: url,
    ));
  }
  return out;
}

PlaylistInfo playlistFromJson(Json data) {
  final entries = _entries(data, yt: true);
  if (entries.isEmpty) throw AppError('No videos found. The playlist may be empty or private.', 'EMPTY_PLAYLIST');
  return PlaylistInfo(
    title: (data['title'] ?? 'Playlist').toString(), channel: (data['channel'] ?? data['uploader'] ?? '').toString(),
    count: entries.length, total: (data['playlist_count'] is num) ? (data['playlist_count'] as num).toInt() : entries.length, entries: entries);
}

/// Channel pages are a list of tabs: ask for the Videos tab (same as original).
String profileFetchUrl(Uri u) {
  if (isYouTubeHost(u) && RegExp(r'^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)/?$').hasMatch(u.path)) {
    return u.replace(path: '${u.path.replaceFirst(RegExp(r'/$'), '')}/videos').toString();
  }
  return u.toString();
}

ProfileInfo profileFromJson(Uri original, String fetchedUrl, Json data) {
  final yt = isYouTubeHost(original);
  final ttUser = Uri.decodeComponent(RegExp(r'^/@([^/]+)').firstMatch(original.path)?.group(1) ?? '');
  final entries = _entries(data, yt: yt, ttUser: ttUser, profile: true);
  final thumbs = ((data['thumbnails'] as List?) ?? const []).whereType<Map>().toList();
  String? avatar;
  for (final t in thumbs) { if (t['id'] == 'avatar_uncropped') { avatar = t['url']?.toString(); break; } }
  if (avatar == null) {
    for (final t in thumbs) { if (t['width'] != null && t['width'] == t['height']) { avatar = t['url']?.toString(); break; } }
  }
  final desc = (data['description'] ?? '').toString();
  final handleYt = (data['uploader_id'] ?? RegExp(r'^/(@[^/]+)').firstMatch(original.path)?.group(1) ?? '').toString();
  return ProfileInfo(
    platform: yt ? 'youtube' : 'tiktok',
    name: (data['channel'] ?? data['uploader'] ?? data['title'] ?? ttUser).toString(),
    handle: yt ? handleYt : (ttUser.isNotEmpty ? '@$ttUser' : ''),
    url: yt ? (data['channel_url'] ?? data['uploader_url'] ?? fetchedUrl).toString() : 'https://www.tiktok.com/@$ttUser',
    description: desc.length > 700 ? desc.substring(0, 700) : desc,
    followers: (data['channel_follower_count'] is num) ? (data['channel_follower_count'] as num).toInt() : null,
    videoCount: (data['playlist_count'] is num) ? (data['playlist_count'] as num).toInt() : null,
    avatar: avatar, entries: entries);
}
