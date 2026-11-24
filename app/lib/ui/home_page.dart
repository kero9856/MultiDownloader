import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../core/collections.dart';
import '../core/config.dart';
import '../models/models.dart';
import '../services/download_manager.dart';
import '../services/share_intake.dart';
import 'collections_views.dart';
import 'format.dart';
import 'preview_page.dart';

class HomePage extends StatefulWidget {
  final VoidCallback onStarted;
  const HomePage({super.key, required this.onStarted});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _url = TextEditingController();
  final _name = TextEditingController();
  VideoInfo? _info;
  PlaylistInfo? _playlist;
  ProfileInfo? _profile;
  QualityOption? _sel;
  SubtitleTrack? _subSel;
  String _subFmt = 'srt';
  String? _error, _subMsg, _playlistHint, _picked; // _picked = site chosen in the chips (needed for a bare @username)
  bool _busy = false, _subBusy = false;

  @override
  void initState() {
    super.initState();
    ShareIntake.pending.addListener(_takeShared);
    WidgetsBinding.instance.addPostFrameCallback((_) => _takeShared());
  }

  @override
  void dispose() {
    ShareIntake.pending.removeListener(_takeShared);
    _url.dispose();
    _name.dispose();
    super.dispose();
  }

  /// Link shared from another app: fill the field and fetch it.
  void _takeShared() {
    final u = ShareIntake.pending.value;
    if (u == null || !mounted) return;
    ShareIntake.pending.value = null;
    if (context.read<DownloadManager>().ready) { _fetch(u); } else { setState(() => _url.text = u); }
  }

  static final _userRe = RegExp(r'^@?[\p{L}\p{N}._-]{2,60}$', unicode: true);

  /// Port of resolveInput(): "@name" + chosen platform -> profile link. null = platform unknown.
  String? _resolve(String v) {
    final bare = _userRe.hasMatch(v) && !RegExp(r'^https?:', caseSensitive: false).hasMatch(v) && (v.startsWith('@') || (_picked != null && !v.contains('.')));
    if (!bare) return v;
    final name = v.replaceFirst('@', '');
    if (_picked == 'YouTube') return 'https://www.youtube.com/@$name';
    if (_picked == 'TikTok') return 'https://www.tiktok.com/@$name';
    return null;
  }

  Future<void> _fetch([String? override]) async {
    final m = context.read<DownloadManager>();
    final typed = (override ?? _url.text).trim();
    if (override != null) _url.text = override;
    if (typed.isEmpty) { setState(() => _error = 'Paste a video or playlist link first.'); return; }
    final value = _resolve(typed);
    if (value == null) {
      setState(() => _error = 'Which platform is @${typed.replaceFirst('@', '')} on? Choose YouTube or TikTok above, or paste the profile link.');
      return;
    }
    setState(() { _busy = true; _error = null; _info = null; _playlist = null; _profile = null; _sel = null; _subSel = null; _subMsg = null; _playlistHint = null; });
    try {
      final u = Uri.tryParse(value);
      if (u != null && isProfileUrl(u)) {
        final p = await m.getProfile(value);
        if (!mounted) return;
        setState(() => _profile = p);
      } else if (u != null && isPlaylistPage(u)) {
        final p = await m.getPlaylist(value);
        if (!mounted) return;
        setState(() => _playlist = p);
      } else {
        final info = await m.getInfo(value);
        if (!mounted) return;
        setState(() {
          _info = info;
          _name.text = info.title;
          _sel = info.video.isNotEmpty ? info.video.first : info.audio.first;
          _subSel = info.subtitles.isNotEmpty ? info.subtitles.first : null;
          _playlistHint = u == null ? null : playlistUrlFromVideo(u); // "This video is part of a playlist."
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _paste() async {
    final d = await Clipboard.getData('text/plain');
    if (mounted && d?.text != null) setState(() => _url.text = d!.text!.trim());
  }

  Future<void> _downloadSub() async {
    setState(() { _subBusy = true; _subMsg = null; });
    try {
      final e = await context.read<DownloadManager>().downloadSubtitles(_info!, _subSel!, format: _subFmt);
      if (!mounted) return;
      setState(() => _subMsg = 'Saved: ${e.file}${e.publicUri != null ? ' (also in Download/MultiDownloader)' : ''}');
    } catch (e) {
      if (mounted) setState(() => _subMsg = e.toString());
    } finally {
      if (mounted) setState(() => _subBusy = false);
    }
  }

  Widget _qualityChips(String title, List<QualityOption> list) => list.isEmpty ? const SizedBox() : Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 16, bottom: 8), child: Text(title, style: Theme.of(context).textTheme.titleSmall)),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final o in list)
              ChoiceChip(
                selected: _sel?.id == o.id,
                onSelected: (_) => setState(() => _sel = o),
                label: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(o.label + (o.fps != null && o.fps! > 30 ? ' ${o.fps!.round()}fps' : '')),
                  Text('${o.exact ? '' : '~'}${fmtBytes(o.estimatedBytes)}', style: Theme.of(context).textTheme.labelSmall),
                ]),
              ),
          ]),
        ],
      );

  Widget _subtitles(VideoInfo info) => info.subtitles.isEmpty ? const SizedBox() : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(padding: const EdgeInsets.only(top: 16, bottom: 8), child: Text('Subtitles', style: Theme.of(context).textTheme.titleSmall)),
        Row(children: [
          Expanded(child: DropdownButton<SubtitleTrack>(
            isExpanded: true, value: _subSel,
            items: [for (final t in info.subtitles) DropdownMenuItem(value: t, child: Text(t.name, overflow: TextOverflow.ellipsis))],
            onChanged: (v) => setState(() => _subSel = v))),
          const SizedBox(width: 8),
          DropdownButton<String>(value: _subFmt, items: const [DropdownMenuItem(value: 'srt', child: Text('SRT')), DropdownMenuItem(value: 'vtt', child: Text('VTT'))],
              onChanged: (v) => setState(() => _subFmt = v ?? 'srt')),
        ]),
        OutlinedButton(onPressed: _subBusy || _subSel == null ? null : _downloadSub,
            child: _subBusy ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Download subtitles')),
        if (_subMsg != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(_subMsg!, style: Theme.of(context).textTheme.bodySmall)),
      ]);

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Wrap(spacing: 8, children: [
        for (final s in AppConfig.sidebarSites)
          ChoiceChip(label: Text(s), selected: _picked == s, onSelected: (v) => setState(() => _picked = v ? s : null)),
      ]),
      const SizedBox(height: 16),
      TextField(
        controller: _url, keyboardType: TextInputType.url, autocorrect: false,
        decoration: InputDecoration(
          border: const OutlineInputBorder(), labelText: 'Paste a video, playlist or account link',
          suffixIcon: IconButton(icon: const Icon(Icons.content_paste), onPressed: _paste)),
        onSubmitted: (_) => _fetch(),
      ),
      const SizedBox(height: 12),
      FilledButton(onPressed: _busy ? null : () => _fetch(),
          child: _busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Fetch Info')),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
      if (_playlist != null) Padding(padding: const EdgeInsets.only(top: 16), child: PlaylistView(playlist: _playlist!, onStarted: widget.onStarted)),
      if (_profile != null) Padding(padding: const EdgeInsets.only(top: 16), child: ProfileView(profile: _profile!, onOpenVideo: (u) => _fetch(u))),
      if (info != null) ...[
        if (_playlistHint != null)
          Padding(padding: const EdgeInsets.only(top: 12), child: Row(children: [
            const Expanded(child: Text('This video is part of a playlist.')),
            TextButton(onPressed: () => _fetch(_playlistHint), child: const Text('Load the whole playlist')),
          ])),
        const SizedBox(height: 16),
        Card(child: Padding(padding: const EdgeInsets.all(12), child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (info.thumbnail != null)
            ClipRRect(borderRadius: BorderRadius.circular(8),
                child: Image.network(info.thumbnail!, width: 120, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox(width: 120, height: 68))),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(info.title, maxLines: 3, overflow: TextOverflow.ellipsis, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('${info.channel} · ${info.durationText}', style: Theme.of(context).textTheme.bodySmall),
          ])),
        ]))),
        const SizedBox(height: 12),
        TextField(controller: _name, maxLength: 100,
            decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Name of the saved file')),
        _qualityChips('Video Quality', info.video),
        _qualityChips('Audio Only', info.audio),
        _subtitles(info),
        const SizedBox(height: 20),
        Row(children: [
          Expanded(child: OutlinedButton.icon(
            icon: const Icon(Icons.play_circle_outline), label: const Text('Watch'),
            onPressed: _sel == null || _sel!.isAudio ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => PreviewPage(info: info, option: _sel!))),
          )),
          const SizedBox(width: 12),
          Expanded(flex: 2, child: FilledButton.icon(
            icon: const Icon(Icons.download), label: Text('Download ${_sel?.label ?? ''}'),
            onPressed: _sel == null ? null : () {
              try {
                context.read<DownloadManager>().start(info, _sel!, fileName: _name.text);
                widget.onStarted();
              } catch (e) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
              }
            },
          )),
        ]),
      ],
    ]);
  }
}
