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
import 'theme.dart';

class HomePage extends StatefulWidget {
  final VoidCallback onStarted, onMenu;
  const HomePage({super.key, required this.onStarted, required this.onMenu});
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

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.only(top: 22, bottom: 10),
        child: Text(title, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Pal.of(context).text)),
      );

  Widget _qualityChips(String title, List<QualityOption> list) {
    if (list.isEmpty) return const SizedBox();
    final p = Pal.of(context);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _section(title),
      Wrap(spacing: 10, runSpacing: 10, children: [
        for (final o in list)
          InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => setState(() => _sel = o),
            child: Container(
              constraints: const BoxConstraints(minWidth: 96),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: _sel?.id == o.id ? p.chipSel : Colors.transparent,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _sel?.id == o.id ? p.chipSel : p.border),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                if (_sel?.id == o.id) Padding(padding: const EdgeInsets.only(right: 8), child: Icon(Icons.check, size: 20, color: p.chipSelText)),
                Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(o.label + (o.fps != null && o.fps! > 30 ? ' ${o.fps!.round()}fps' : ''),
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: _sel?.id == o.id ? p.chipSelText : p.text)),
                  Text('${o.exact ? '' : '~'}${fmtBytes(o.estimatedBytes)}',
                      style: TextStyle(fontSize: 12, color: _sel?.id == o.id ? p.chipSelText : p.sub)),
                ]),
              ]),
            ),
          ),
      ]),
    ]);
  }

  Widget _subtitles(VideoInfo info) => info.subtitles.isEmpty ? const SizedBox() : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        _section('Subtitles'),
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

  /// Row of round site icons (scrolls sideways). Tapping one picks the site (needed for a bare @username).
  Widget _sites() {
    final p = Pal.of(context);
    return SizedBox(
      height: 60,
      child: ListView(scrollDirection: Axis.horizontal, children: [
        for (final name in AppConfig.sidebarSites)
          if (siteByName(name) != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Tooltip(
                message: name,
                child: GestureDetector(
                  onTap: () => setState(() => _picked = _picked == name ? null : name),
                  child: Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: _picked == name ? p.primary : Colors.transparent, width: 2)),
                    child: SiteIcon(siteByName(name)!, size: 50),
                  ),
                ),
              ),
            ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final info = _info;
    return ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), children: [
      Row(children: [
        Expanded(child: Text('MultiDownloader', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w500, color: p.text))),
        IconButton(tooltip: 'Menu', icon: Icon(Icons.settings, color: p.text), onPressed: widget.onMenu),
      ]),
      const SizedBox(height: 12),
      _sites(),
      const SizedBox(height: 16),
      TextField(
        controller: _url, keyboardType: TextInputType.url, autocorrect: false,
        style: TextStyle(color: p.text),
        decoration: InputDecoration(
          hintText: 'Paste link here...',
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.border)),
          enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.border)),
          focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.primary, width: 1.5)),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          suffixIcon: TextButton.icon(onPressed: _paste, icon: Icon(Icons.content_paste, size: 20, color: p.sub), label: Text('Paste', style: TextStyle(color: p.sub, fontSize: 16))),
        ),
        onSubmitted: (_) => _fetch(),
      ),
      const SizedBox(height: 14),
      SizedBox(
        height: 54,
        child: FilledButton(
          style: FilledButton.styleFrom(backgroundColor: p.primary, foregroundColor: Colors.white, shape: const StadiumBorder()),
          onPressed: _busy ? null : () => _fetch(),
          child: _busy
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Analyze Link', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
        ),
      ),
      if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: TextStyle(color: p.danger))),
      if (_playlist != null) Padding(padding: const EdgeInsets.only(top: 16), child: PlaylistView(playlist: _playlist!, onStarted: widget.onStarted)),
      if (_profile != null) Padding(padding: const EdgeInsets.only(top: 16), child: ProfileView(profile: _profile!, onOpenVideo: (u) => _fetch(u))),
      if (info != null) ...[
        if (_playlistHint != null)
          Padding(padding: const EdgeInsets.only(top: 12), child: Row(children: [
            const Expanded(child: Text('This video is part of a playlist.')),
            TextButton(onPressed: () => _fetch(_playlistHint), child: const Text('Load the whole playlist')),
          ])),
        const SizedBox(height: 18),
        AppCard(
          padding: const EdgeInsets.all(14),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Stack(children: [
              MediaThumb(url: info.thumbnail, size: 96, height: 112),
              Positioned(left: 6, bottom: 6, child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(color: const Color(0x99000000), borderRadius: BorderRadius.circular(8)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.play_arrow_rounded, size: 14, color: Colors.white),
                  if (info.durationText.isNotEmpty)
                    Text(info.durationText, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
                ]),
              )),
            ]),
            const SizedBox(width: 14),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(info.title, maxLines: 3, overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: p.text)),
              const SizedBox(height: 4),
              Text(info.channel, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: p.sub)),
            ])),
          ]),
        ),
        _section('File name'),
        TextField(
          controller: _name,
          style: TextStyle(color: p.text),
          decoration: InputDecoration(
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.border)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.border)),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.primary, width: 1.5)),
            contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          ),
        ),
        _qualityChips('Video', info.video),
        _qualityChips('Audio', info.audio),
        _subtitles(info),
        const SizedBox(height: 22),
        Row(children: [
          Expanded(child: SizedBox(
            height: 52,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: p.primary, foregroundColor: Colors.white, shape: const StadiumBorder()),
              icon: const Icon(Icons.download_rounded),
              label: const Text('Download', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              onPressed: _sel == null ? null : () => _download(info),
            ),
          )),
          if (!_sel!.isAudio) ...[
            const SizedBox(width: 12),
            SizedBox(
              height: 52,
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(shape: const StadiumBorder(), side: BorderSide(color: p.border), foregroundColor: p.text),
                icon: const Icon(Icons.play_circle_outline),
                label: const Text('Watch'),
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => PreviewPage(info: info, option: _sel!))),
              ),
            ),
          ],
        ]),
      ],
    ]);
  }

  void _download(VideoInfo info) {
    final sel = _sel;
    if (sel == null) return;
    try {
      final name = _name.text.trim();
      context.read<DownloadManager>().start(info, sel, fileName: name.isEmpty ? null : name);
      widget.onStarted();
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }
}
