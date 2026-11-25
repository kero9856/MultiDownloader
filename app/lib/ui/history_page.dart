import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/download_manager.dart';
import 'format.dart';
import 'theme.dart';

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});
  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  bool _searching = false;
  final _q = TextEditingController();

  @override
  void dispose() { _q.dispose(); super.dispose(); }

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

  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  String _dayLabel(int ms) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(d.year, d.month, d.day);
    final diff = today.difference(day).inDays;
    if (diff <= 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    return '${_months[d.month - 1]} ${d.day}, ${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final m = context.watch<DownloadManager>();
    final all = m.history.list();
    final q = _q.text.trim().toLowerCase();
    final items = q.isEmpty ? all : all.where((e) => e.title.toLowerCase().contains(q)).toList();

    final children = <Widget>[];
    String? last;
    for (final e in items) {
      final label = _dayLabel(e.at);
      if (label != last) {
        children.add(Padding(
          padding: EdgeInsets.fromLTRB(4, last == null ? 4 : 14, 4, 10),
          child: Text(label, style: TextStyle(fontSize: 17, color: p.sub)),
        ));
        last = label;
      }
      children.add(_HistoryCard(entry: e, onDelete: () => _confirmDelete(context, m, e.id)));
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 8, 8),
        child: Row(children: [
          Expanded(child: Text('History', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w500, color: p.text))),
          IconButton(tooltip: 'Search', icon: Icon(_searching ? Icons.close : Icons.search, color: p.sub),
              onPressed: () => setState(() { _searching = !_searching; if (!_searching) _q.clear(); })),
          IconButton(tooltip: 'Clear history', icon: Icon(Icons.delete_outline, color: p.sub),
              onPressed: all.isEmpty ? null : () => _confirmClear(context, m)),
        ]),
      ),
      if (_searching)
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
          child: TextField(
            controller: _q, autofocus: true, onChanged: (_) => setState(() {}), style: TextStyle(color: p.text),
            decoration: InputDecoration(
              hintText: 'Search history', isDense: true, prefixIcon: Icon(Icons.search, color: p.sub),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.border)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: p.border)),
            ),
          ),
        ),
      Expanded(
        child: items.isEmpty
            ? Center(child: Text(all.isEmpty ? 'History is empty.' : 'No matches.', style: TextStyle(color: p.sub)))
            : ListView(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), children: children),
      ),
    ]);
  }
}

class _HistoryCard extends StatelessWidget {
  final HistoryEntry entry;
  final VoidCallback onDelete;
  const _HistoryCard({required this.entry, required this.onDelete});
  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final e = entry;
    final audio = e.type == 'audio';
    final sub = e.type == 'subtitle';
    final ext = fileExt(e.file);
    final parts = ['Finished', fmtBytes(e.bytes), if (ext.isNotEmpty && (audio || !sub)) ext];
    return AppCard(
      onLongPress: onDelete, // long-press = delete (also removes the file)
      child: Row(children: [
        Thumb(url: e.thumbnail, size: 78, audio: audio, subtitle: sub, badge: audio ? null : siteOfUrl(e.url)),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(e.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w500, color: p.text)),
          const SizedBox(height: 4),
          Text(e.missing ? 'File missing' : parts.join(' • '), style: TextStyle(color: e.missing ? p.danger : p.sub, fontSize: 14)),
        ])),
        const SizedBox(width: 8),
        Column(mainAxisSize: MainAxisSize.min, children: [
          RoundBtn(icon: Icons.play_arrow, tooltip: 'Open', onTap: e.missing ? null : () => OpenFilex.open(e.path)),
          const SizedBox(height: 8),
          RoundBtn(icon: Icons.share, tooltip: 'Share', onTap: e.missing ? null : () => shareFile(context, e.path)),
        ]),
      ]),
    );
  }
}
