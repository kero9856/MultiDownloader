import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/download_manager.dart';
import 'format.dart';

class DownloadsPage extends StatelessWidget {
  const DownloadsPage({super.key});
  @override
  Widget build(BuildContext context) {
    final m = context.watch<DownloadManager>();
    final jobs = m.jobs.values.toList().reversed.toList();
    final unfinished = m.listUnfinished();
    if (jobs.isEmpty && unfinished.isEmpty) return const Center(child: Text('No downloads yet.'));
    return ListView(padding: const EdgeInsets.all(12), children: [
      for (final j in jobs) _JobTile(job: j),
      if (unfinished.isNotEmpty) ...[
        const Padding(padding: EdgeInsets.fromLTRB(4, 16, 4, 8), child: Text('Unfinished downloads')),
        for (final u in unfinished)
          ListTile(
            leading: const Icon(Icons.pause_circle),
            title: Text('${u['title']}', maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text('${u['label'] ?? u['optionId']} · ${fmtBytes(u['bytes'] as int?)} saved so far'),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(icon: const Icon(Icons.play_arrow), tooltip: 'Resume', onPressed: () => m.resume(u)),
              IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Discard', onPressed: () => m.discardUnfinished(u['id'] as String)),
            ]),
          ),
      ],
    ]);
  }
}

class _JobTile extends StatelessWidget {
  final DownloadJob job;
  const _JobTile({required this.job});
  @override
  Widget build(BuildContext context) {
    final m = context.read<DownloadManager>();
    final done = job.status == JobStatus.done;
    return Card(child: ListTile(
      leading: Icon(job.isAudio ? Icons.audiotrack : Icons.movie),
      title: Text(job.title, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${job.optionLabel} · ${job.status.name}${job.status == JobStatus.downloading ? ' · ${job.percent.toStringAsFixed(0)}%' : ''}'
            '${job.error != null ? '\n${job.error}' : ''}${job.note != null ? '\n${job.note}' : ''}${job.publicUri != null ? '\nAlso saved in Download/MultiDownloader' : ''}'),
        if (job.active) Padding(padding: const EdgeInsets.only(top: 6),
            child: LinearProgressIndicator(value: job.status == JobStatus.downloading && job.percent > 0 ? job.percent / 100 : null)),
      ]),
      trailing: job.active
          ? (job.status == JobStatus.processing ? null : IconButton(icon: const Icon(Icons.close), tooltip: 'Cancel', onPressed: () => m.cancel(job.id)))
          : (job.status == JobStatus.cancelled || job.status == JobStatus.error)
              ? Row(mainAxisSize: MainAxisSize.min, children: [
                  IconButton(icon: const Icon(Icons.play_arrow), tooltip: 'Resume', onPressed: () => m.resumeJob(job.id)),
                  IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Discard', onPressed: () => m.discardUnfinished(job.id)),
                ])
          : done ? IconButton(icon: const Icon(Icons.play_arrow), tooltip: 'Open', onPressed: () => OpenFilex.open(job.filePath!)) : null,
    ));
  }
}
