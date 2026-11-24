import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/download_manager.dart';

/// Playlist panel: select entries, pick one quality, download selected (original "Playlist" section).
class PlaylistView extends StatefulWidget {
  final PlaylistInfo playlist;
  final VoidCallback onStarted;
  const PlaylistView({super.key, required this.playlist, required this.onStarted});
  @override
  State<PlaylistView> createState() => _PlaylistViewState();
}

class _PlaylistViewState extends State<PlaylistView> {
  late final Set<String> _picked = widget.playlist.entries.map((e) => e.id).toSet();
  String _quality = 'v720';

  @override
  Widget build(BuildContext context) {
    final p = widget.playlist;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(p.title, style: Theme.of(context).textTheme.titleLarge),
      Text('${p.channel} · ${p.count} videos${p.total > p.count ? ' of ${p.total}' : ''}'),
      Row(children: [
        Checkbox(value: _picked.length == p.entries.length, onChanged: (v) => setState(() {
          _picked..clear()..addAll(v == true ? p.entries.map((e) => e.id) : const <String>[]);
        })),
        const Text('Select all'),
        const Spacer(),
        DropdownButton<String>(value: _quality, items: [for (final q in playlistQualities) DropdownMenuItem(value: q.$1, child: Text(q.$2))],
            onChanged: (v) => setState(() => _quality = v ?? _quality)),
      ]),
      for (final e in p.entries)
        CheckboxListTile(
          dense: true, value: _picked.contains(e.id), controlAffinity: ListTileControlAffinity.leading,
          onChanged: (v) => setState(() { v == true ? _picked.add(e.id) : _picked.remove(e.id); }),
          secondary: Image.network(e.thumbnail, width: 72, errorBuilder: (_, __, ___) => const SizedBox(width: 72)),
          title: Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis),
          subtitle: Text('${e.channel}${e.durationText.isEmpty ? '' : ' · ${e.durationText}'}'),
        ),
      const SizedBox(height: 8),
      FilledButton.icon(
        icon: const Icon(Icons.download),
        label: Text('Download selected (${_picked.length})'),
        onPressed: _picked.isEmpty ? null : () {
          context.read<DownloadManager>().startPlaylist(p.entries.where((e) => _picked.contains(e.id)).toList(), _quality);
          widget.onStarted();
        },
      ),
    ]);
  }
}

/// Channel / TikTok account panel + latest videos (original "Account" section). Tapping a video opens it in the single-video flow.
class ProfileView extends StatelessWidget {
  final ProfileInfo profile;
  final void Function(String url) onOpenVideo;
  const ProfileView({super.key, required this.profile, required this.onOpenVideo});

  String _n(int? v) => v == null ? '' : v >= 1000000 ? '${(v / 1000000).toStringAsFixed(1)}M' : v >= 1000 ? '${(v / 1000).toStringAsFixed(1)}K' : '$v';

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          CircleAvatar(radius: 32, backgroundImage: profile.avatar != null ? NetworkImage(profile.avatar!) : null,
              child: profile.avatar == null ? const Icon(Icons.person) : null),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(profile.name, style: Theme.of(context).textTheme.titleLarge),
            Text(profile.handle),
            Text([if (profile.followers != null) '${_n(profile.followers)} followers', if (profile.videoCount != null) '${profile.videoCount} videos'].join(' · ')),
          ])),
        ]),
        if (profile.description.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(profile.description, maxLines: 5, overflow: TextOverflow.ellipsis)),
        const Divider(),
        for (final e in profile.entries)
          ListTile(
            dense: true,
            leading: e.thumbnail.isEmpty ? const Icon(Icons.movie) : Image.network(e.thumbnail, width: 72, errorBuilder: (_, __, ___) => const Icon(Icons.movie)),
            title: Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(e.durationText),
            onTap: () => onOpenVideo(e.url),
          ),
      ]);
}
