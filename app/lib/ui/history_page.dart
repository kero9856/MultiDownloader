import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import '../services/download_manager.dart';
import 'format.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  Future<bool> _ask(BuildContext context, String title, String body) async =>
      await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(title), content: Text(body), actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
      ])) ?? false;

  Future<void> _confirmDelete(BuildContext context, DownloadManager m, String id) async {
    if (await _ask(context, 'Delete this download?', 'The file is deleted from the app and from Download/MultiDownloader.')) await m.deleteHistoryEntry(id);
  }

  Future<void> _confirmClear(BuildContext context, DownloadManager m) async {
    if (await _ask(context, 'Clear history?', 'All listed files are deleted from the app and from Download/MultiDownloader.')) await m.clearHistory();
  }

  @override
  Widget build(BuildContext context) {
    final m = context.watch<DownloadManager>();
    final items = m.history.list();
    if (items.isEmpty) return const Center(child: Text('History is empty.'));
    return Column(children: [
      Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _confirmClear(context, m), child: const Text('Clear history'))),
      Expanded(child: ListView(children: [
        for (final e in items)
          ListTile(
            leading: Icon(e.type == 'audio' ? Icons.audiotrack : e.type == 'subtitle' ? Icons.subtitles : Icons.movie),
            title: Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text('${fmtBytes(e.bytes)}${e.missing ? ' · file missing' : ''}'),
            onTap: e.missing ? null : () => OpenFilex.open(e.path),
            trailing: IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Delete (also removes the file)', onPressed: () => _confirmDelete(context, m, e.id)),
          ),
      ])),
    ]);
  }
}
