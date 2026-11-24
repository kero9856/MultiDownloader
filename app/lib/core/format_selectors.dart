// Port of flagsForOption() from original/yt-grab/src/youtube.js.
// Produces yt-dlp CLI arguments (the Node version used yt-dlp-exec option objects).
class DownloadOption {
  final List<String> args; // yt-dlp CLI args for this quality
  final String ext;
  final int streams;
  const DownloadOption(this.args, this.ext, this.streams);
}

DownloadOption flagsForOption(String optionId) {
  if (optionId == 'a-m4a') {
    return const DownloadOption(
        ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a'], 'm4a', 1);
  }
  if (optionId == 'a-mp3') {
    return const DownloadOption(
        ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K'], 'mp3', 1);
  }
  if (optionId == 'vbest') {
    return const DownloadOption([
      '-f', 'bv*[ext=mp4][protocol!*=m3u8]+ba[ext=m4a]/bv*+ba/b',
      '--merge-output-format', 'mp4'
    ], 'mp4', 2);
  }
  final fm = RegExp(r'^f-([\w.\-]+)$').firstMatch(optionId);
  if (fm != null) {
    final fid = fm.group(1)!;
    return DownloadOption(['-f', '$fid+ba/$fid/b', '--merge-output-format', 'mp4'], 'mp4', 2);
  }
  final m = RegExp(r'^v(\d{3,4})$').firstMatch(optionId);
  if (m == null) throw ArgumentError('Unknown quality option: $optionId');
  final h = int.parse(m.group(1)!);
  final format = 'bv*[height<=$h][ext=mp4][protocol!*=m3u8]+ba[ext=m4a]/'
      'bv*[height<=$h][ext=mp4]+ba[ext=m4a]/bv*[height<=$h]+ba/b[height<=$h]/b';
  return DownloadOption(['-f', format, '--merge-output-format', 'mp4'], 'mp4', 2);
}

/// Port of safeName() from jobs.js.
/// Unicode-aware (Arabic and other scripts are kept); truncates by code points so no character is split.
String safeName(String? title) {
  final s = (title ?? '').replaceAll(RegExp(r'[^\p{L}\p{M}\p{N}\s._\-]', unicode: true), '').replaceAll(RegExp(r'\s+'), ' ').trim();
  final runes = s.runes.toList();
  final cut = (runes.length > 100 ? String.fromCharCodes(runes.sublist(0, 100)) : s).trim();
  return cut.isEmpty || cut.replaceAll('.', '').isEmpty ? 'video' : cut;
}
