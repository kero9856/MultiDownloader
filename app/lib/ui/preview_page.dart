import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../core/watched_ranges.dart';
import '../models/models.dart';
import '../services/download_manager.dart';
import 'native_player.dart';

/// Native preview ("Watch"): plays the file directly with the Android player, tracks what was actually played,
/// and can save the watched part with yt-dlp --download-sections.
class PreviewPage extends StatefulWidget {
  final VideoInfo info;
  final QualityOption option;
  const PreviewPage({super.key, required this.info, required this.option});
  @override
  State<PreviewPage> createState() => _PreviewPageState();
}

class _PreviewPageState extends State<PreviewPage> {
  NativePlayerController? _c;
  Timer? _timer;
  PlayerState? _st;
  PlayableFormat? _fmt;
  final _watched = WatchedRanges();
  String? _msg;

  @override
  void initState() {
    super.initState();
    _fmt = context.read<DownloadManager>().playableFor(widget.info, widget.option.id);
    if (_fmt == null) {
      // Same message as the original (NO_LIVE_PLAY).
      _msg = 'This quality can’t be played live (this site delivers it in separate pieces). Download it instead.';
    }
  }

  void _created(NativePlayerController c) {
    _c = c;
    c.load(_fmt!.url, _fmt!.headers);
    _timer = Timer.periodic(const Duration(milliseconds: 500), (_) async {
      try {
        final s = await c.state();
        if (!mounted) return;
        if (s.playing && s.prepared) { _watched.tick(s.positionMs / 1000); } else { _watched.breakRun(); }
        setState(() => _st = s);
      } catch (_) {}
    });
  }

  @override
  void dispose() { _timer?.cancel(); _c?.stop().catchError((_) {}); super.dispose(); }

  String _t(int ms) { final s = ms ~/ 1000; return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}'; }

  void _save() {
    final r = _watched.merged();
    try {
      final job = context.read<DownloadManager>().saveWatched(widget.info, widget.option, r);
      final gaps = r.length > 1;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
          'Saving ${job.title}${gaps ? ' (parts you skipped are included: joining separate pieces needs ffmpeg)' : ''}')));
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = _st;
    final dur = st?.durationMs ?? 0;
    return Scaffold(
      appBar: AppBar(title: Text(widget.info.title, maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: _msg != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_msg!, textAlign: TextAlign.center)))
          : Column(children: [
              AspectRatio(aspectRatio: 16 / 9, child: ColoredBox(color: Colors.black, child: NativePlayerView(onCreated: _created))),
              if (st?.error != null) Padding(padding: const EdgeInsets.all(8), child: Text(st!.error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
              Row(children: [
                IconButton(icon: Icon(st?.playing == true ? Icons.pause : Icons.play_arrow),
                    onPressed: () => st?.playing == true ? _c?.pause() : _c?.play()),
                Text(_t(st?.positionMs ?? 0)),
                Expanded(child: Slider(
                  value: dur > 0 ? (st!.positionMs.clamp(0, dur)).toDouble() : 0, max: dur > 0 ? dur.toDouble() : 1,
                  onChanged: dur > 0 ? (v) => _c?.seekToMs(v.round()) : null)),
                Text(_t(dur)),
              ]),
              Padding(padding: const EdgeInsets.all(12), child: Text(
                  'Watched: ${_watched.totalSeconds.toStringAsFixed(0)} s in ${_watched.merged().length} part(s). '
                  'Playing ${_fmt!.height > 0 ? '${_fmt!.height}p' : 'this file'} directly (nothing is saved until you press the button).')),
              FilledButton.icon(
                icon: const Icon(Icons.save_alt), label: const Text('Save what I watched'),
                onPressed: _watched.merged().isEmpty ? null : _save),
            ]),
    );
  }
}
