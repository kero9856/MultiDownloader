import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/download_manager.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  late final _limit = TextEditingController(text: context.read<DownloadManager>().settings.limitMBps.toString().replaceFirst(RegExp(r'\.0$'), ''));

  @override
  Widget build(BuildContext context) {
    final m = context.watch<DownloadManager>();
    final s = m.settings;
    void save(AppSettings n) => m.updateSettings(n);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('Download speed', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'normal', label: Text('Normal')), ButtonSegment(value: 'fast', label: Text('Fast')), ButtonSegment(value: 'max', label: Text('Max'))],
          selected: {s.speedMode},
          onSelectionChanged: (v) => save(AppSettings(speedMode: v.first, limitMBps: s.limitMBps, saveToPublicDownloads: s.saveToPublicDownloads, insecureTls: s.insecureTls)),
        ),
        Padding(padding: const EdgeInsets.only(top: 6), child: Text(
            s.speedMode == 'max'
                ? (m.aria2Available ? 'Max uses aria2c (16 connections per file).' : 'aria2c not available: Max uses 32 parallel pieces.')
                : s.speedMode == 'fast' ? '16 pieces in parallel.' : '4 pieces in parallel.',
            style: Theme.of(context).textTheme.bodySmall)),
        const SizedBox(height: 12),
        TextField(
          controller: _limit, keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'Speed limit (MB/s, 0 = no limit)'),
          onChanged: (v) => save(AppSettings(speedMode: s.speedMode, limitMBps: double.tryParse(v.replaceAll(',', '.')) ?? 0, saveToPublicDownloads: s.saveToPublicDownloads, insecureTls: s.insecureTls)),
        ),
        const Divider(height: 32),
        SwitchListTile(
          title: const Text('Copy finished files to Download/MultiDownloader'),
          subtitle: const Text('Uses Android scoped storage. The app keeps its own copy for resuming and history.'),
          value: s.saveToPublicDownloads,
          onChanged: (v) => save(AppSettings(speedMode: s.speedMode, limitMBps: s.limitMBps, saveToPublicDownloads: v, insecureTls: s.insecureTls)),
        ),
        SwitchListTile(
          title: const Text('Ignore certificate errors (not recommended)'),
          subtitle: const Text('Only turn on if downloads fail with SSL/certificate errors. Makes connections open to tampering on untrusted networks.'),
          value: s.insecureTls,
          onChanged: (v) => save(AppSettings(speedMode: s.speedMode, limitMBps: s.limitMBps, saveToPublicDownloads: s.saveToPublicDownloads, insecureTls: v)),
        ),
        const Divider(height: 32),
        Text('Engine', style: Theme.of(context).textTheme.titleMedium),
        for (final e in m.engine.entries) ListTile(dense: true, title: Text(e.key), trailing: Text(e.value)),
        Text('Folder: ${m.baseDir.path}', style: Theme.of(context).textTheme.bodySmall),
      ]),
    );
  }
}
