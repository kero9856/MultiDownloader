import 'dart:io';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/download_manager.dart';
import 'format.dart';
import 'theme.dart';

class DownloadsPage extends StatefulWidget {
  const DownloadsPage({super.key});
  @override
  State<DownloadsPage> createState() => _DownloadsPageState();
}

class _DownloadsPageState extends State<DownloadsPage> {
  int _tab = 0; // 0 = Active, 1 = Completed

  Future<void> _clearAll(DownloadManager m) async {
    if (_tab == 1) {
      m.clearFinishedJobs(); // only empties this list; files stay in History
      return;
    }
    final stopped = m.jobs.values.where((j) => !j.active && j.status != JobStatus.done).map((j) => j.id).toList();
    final unfinished = m.listUnfinished().map((u) => u['id'] as String).toList();
    if (stopped.isEmpty && unfinished.isEmpty) return;
    final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
      title: const Text('Discard unfinished downloads?'),
      content: const Text('Paused and failed downloads are removed together with their partial files. Running downloads are not touched.'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Discard')),
      ])) ?? false;
    if (!ok) return;
    for (final id in [...stopped, ...unfinished]) { m.discardUnfinished(id); }
  }

  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final m = context.watch<DownloadManager>();
    final jobs = m.jobs.values.toList().reversed.toList();
    final activeJobs = jobs.where((j) => j.status != JobStatus.done).toList();
    final doneJobs = jobs.where((j) => j.status == JobStatus.done).toList();
    final unfinished = m.listUnfinished();

    final cards = <Widget>[];
    if (_tab == 0) {
      for (final j in activeJobs) { cards.add(_ActiveCard(job: j)); }
      for (final u in unfinished) { cards.add(_UnfinishedCard(u: u)); }
    } else {
      for (final j in doneJobs) { cards.add(_DoneCard(job: j)); }
    }

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 12, 12),
        child: Row(children: [
          Expanded(child: Text('Downloads', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w500, color: p.text))),
          TextButton(onPressed: () => _clearAll(m), child: Text('Clear All', style: TextStyle(fontSize: 16, color: p.sub))),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
        child: Container(
          height: 54,
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(color: p.card, borderRadius: BorderRadius.circular(18), border: Border.all(color: p.border)),
          child: Row(children: [
            for (final (i, label) in const ['Active', 'Completed'].indexed)
              Expanded(child: GestureDetector(
                onTap: () => setState(() => _tab = i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: _tab == i ? p.cardAlt : Colors.transparent, borderRadius: BorderRadius.circular(14)),
                  child: Text(label, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: _tab == i ? p.text : p.sub)),
                ),
              )),
          ]),
        ),
      ),
      Expanded(
        child: cards.isEmpty
            ? Center(child: Text(_tab == 0 ? 'No active downloads.' : 'Nothing completed yet.', style: TextStyle(color: p.sub)))
            : ListView(padding: const EdgeInsets.fromLTRB(16, 4, 16, 16), children: cards),
      ),
    ]);
  }
}

String _statusText(DownloadJob j) {
  final pct = '${j.percent.toStringAsFixed(0)}%';
  switch (j.status) {
    case JobStatus.queued: return 'Queued';
    case JobStatus.downloading:
      final eta = fmtEta(j.etaSeconds);
      return j.percent > 0 ? '$pct${eta.isEmpty ? '' : ' • $eta'} • Downloading…' : 'Starting…';
    case JobStatus.processing: return 'Processing…';
    case JobStatus.cancelled: return '$pct • Paused';
    case JobStatus.error: return 'Failed';
    case JobStatus.done: return 'Finished';
  }
}

class _ActiveCard extends StatelessWidget {
  final DownloadJob job;
  const _ActiveCard({required this.job});
  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final m = context.read<DownloadManager>();
    final stopped = job.status == JobStatus.cancelled || job.status == JobStatus.error;
    final barColor = stopped ? p.sub : (job.isAudio ? const Color(0xFFA98BFF) : p.primary);
    final value = job.status == JobStatus.downloading && job.percent > 0
        ? job.percent / 100
        : (stopped ? job.percent / 100 : null);

    Widget? action;
    if (job.status == JobStatus.downloading || job.status == JobStatus.queued) {
      action = RoundBtn(icon: Icons.pause, tooltip: 'Pause', onTap: () => m.cancel(job.id));
    } else if (stopped) {
      action = Row(mainAxisSize: MainAxisSize.min, children: [
        RoundBtn(icon: Icons.play_arrow, tooltip: 'Resume', onTap: () => m.resumeJob(job.id)),
        const SizedBox(width: 6),
        RoundBtn(icon: Icons.close, tooltip: 'Discard', onTap: () => m.discardUnfinished(job.id)),
      ]);
    }

    return AppCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Thumb(url: job.thumbnail, size: 72, audio: job.isAudio, caption: job.ext.toUpperCase()),
      const SizedBox(width: 14),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(job.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: p.text)),
        const SizedBox(height: 2),
        Text('${job.optionLabel} • ${_statusText(job)}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.sub, fontSize: 13)),
        if (job.error != null) Text(job.error!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.danger, fontSize: 12)),
        if (job.note != null) Text(job.note!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: p.sub, fontSize: 12)),
        const SizedBox(height: 8),
        ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: value, minHeight: 5, color: barColor, backgroundColor: p.cardAlt)),
        if (value != null) Padding(padding: const EdgeInsets.only(top: 4), child: Center(child: Text('${job.percent.toStringAsFixed(0)}%', style: TextStyle(color: barColor, fontSize: 13)))),
      ])),
      if (action != null) ...[const SizedBox(width: 10), action],
    ]));
  }
}

/// A download that was interrupted in an earlier session (no job object yet).
class _UnfinishedCard extends StatelessWidget {
  final Map<String, dynamic> u;
  const _UnfinishedCard({required this.u});
  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final m = context.read<DownloadManager>();
    final audio = (u['isAudio'] as bool?) ?? '${u['optionId']}'.startsWith('a-');
    return AppCard(child: Row(children: [
      Thumb(size: 72, audio: audio),
      const SizedBox(width: 14),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${u['title']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: p.text)),
        const SizedBox(height: 2),
        Text('${u['label'] ?? u['optionId']} • Paused • ${fmtBytes(u['bytes'] as int?)} saved', style: TextStyle(color: p.sub, fontSize: 13)),
      ])),
      const SizedBox(width: 10),
      RoundBtn(icon: Icons.play_arrow, tooltip: 'Resume', onTap: () => m.resume(u)),
      const SizedBox(width: 6),
      RoundBtn(icon: Icons.close, tooltip: 'Discard', onTap: () => m.discardUnfinished(u['id'] as String)),
    ]));
  }
}

class _DoneCard extends StatelessWidget {
  final DownloadJob job;
  const _DoneCard({required this.job});

  String _size() {
    try { return fmtBytes(File(job.filePath!).lengthSync()); } catch (_) { return ''; }
  }

  @override
  Widget build(BuildContext context) {
    final p = Pal.of(context);
    final size = _size();
    final path = job.filePath;
    return AppCard(child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Thumb(url: job.thumbnail, size: 72, audio: job.isAudio, caption: size.isEmpty ? job.ext.toUpperCase() : '${job.ext.toUpperCase()} • $size'),
      const SizedBox(width: 14),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(job.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: p.text)),
        const SizedBox(height: 2),
        Text('Finished • ${job.ext.toUpperCase()}${size.isEmpty ? '' : ' • $size'}', style: TextStyle(color: p.sub, fontSize: 13)),
        if (job.publicUri != null) Text('Also saved in Download/MultiDownloader', style: TextStyle(color: p.sub, fontSize: 11)),
        const SizedBox(height: 8),
        ClipRRect(borderRadius: BorderRadius.circular(6), child: LinearProgressIndicator(value: 1, minHeight: 5, color: p.ok, backgroundColor: p.cardAlt)),
        Padding(padding: const EdgeInsets.only(top: 4), child: Align(alignment: Alignment.centerRight, child: Text('100%', style: TextStyle(color: p.sub, fontSize: 13)))),
      ])),
      const SizedBox(width: 10),
      RoundBtn(icon: Icons.play_arrow, tooltip: 'Open', onTap: path == null ? null : () => OpenFilex.open(path)),
      const SizedBox(width: 6),
      RoundBtn(icon: Icons.share, tooltip: 'Share', onTap: path == null ? null : () => shareFile(context, path)),
    ]));
  }
}
