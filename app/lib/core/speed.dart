// Port of speedFlags() from original src/jobs.js, as yt-dlp CLI args.
import '../models/models.dart';
import 'config.dart';

List<String> speedArgs(AppSettings s, {required bool aria2Available}) {
  final frag = s.speedMode == 'normal' ? 4 : s.speedMode == 'max' ? 32 : AppConfig.concurrentFragments;
  final args = <String>['--concurrent-fragments', '$frag'];
  if (s.limitMBps > 0) {
    // A speed limit always uses the normal downloader (aria2c would ignore it) - same rule as the original.
    args.addAll(['--limit-rate', '${s.limitMBps}M']);
  } else if (s.speedMode == 'max' && aria2Available) {
    args.addAll(['--downloader', 'libaria2c.so', '--downloader-args', 'aria2c:-x 16 -s 16 -k 1M']);
  }
  return args;
}
