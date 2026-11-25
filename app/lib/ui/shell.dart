import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/download_manager.dart';
import '../services/share_intake.dart';
import 'downloads_page.dart';
import 'history_page.dart';
import 'home_page.dart';
import 'settings_page.dart';

class Shell extends StatefulWidget {
  final bool dark;
  final VoidCallback onToggleTheme;
  const Shell({super.key, required this.dark, required this.onToggleTheme});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    ShareIntake.pending.addListener(_onShared);
    WidgetsBinding.instance.addPostFrameCallback((_) => _onShared());
  }

  @override
  void dispose() { ShareIntake.pending.removeListener(_onShared); super.dispose(); }

  void _onShared() { if (ShareIntake.pending.value != null && _tab != 0 && mounted) setState(() => _tab = 0); }

  void _selectTab(int i) {
    setState(() => _tab = i);
    if (i == 2) context.read<DownloadManager>().refreshHistory();
  }

  /// The gear icon: Settings + the tools that used to sit in the app bar.
  void _openMenu() {
    final m = context.read<DownloadManager>();
    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(
          leading: const Icon(Icons.settings_outlined), title: const Text('Settings'),
          onTap: () { Navigator.pop(sheet); Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsPage())); },
        ),
        ListTile(
          leading: const Icon(Icons.system_update_alt), title: const Text('Update yt-dlp'), enabled: m.ready,
          onTap: () async {
            Navigator.pop(sheet);
            final msg = ScaffoldMessenger.of(context);
            msg.showSnackBar(const SnackBar(content: Text('Updating yt-dlp…')));
            try {
              final r = await m.updateYtDlp();
              msg.showSnackBar(SnackBar(content: Text(r.contains('ALREADY') ? 'yt-dlp is already up to date' : 'yt-dlp updated ($r)')));
            } catch (e) { msg.showSnackBar(SnackBar(content: Text('Update failed: $e'))); }
          },
        ),
        ListTile(
          leading: const Icon(Icons.info_outline), title: const Text('Engine status'), enabled: m.ready,
          onTap: () async {
            Navigator.pop(sheet);
            final d = await m.bridge.diagnose();
            if (!mounted) return;
            showDialog(context: context, builder: (_) => AlertDialog(
              title: const Text('Engine status'),
              content: Text(d.entries.map((e) => '${e.key}: ${e.value}').join('\n')),
              actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))]));
          },
        ),
        ListTile(
          leading: Icon(widget.dark ? Icons.light_mode_outlined : Icons.dark_mode_outlined),
          title: Text(widget.dark ? 'Switch to light mode' : 'Switch to dark mode'),
          onTap: () { Navigator.pop(sheet); widget.onToggleTheme(); },
        ),
      ])),
    );
  }

  @override
  Widget build(BuildContext context) {
    final m = context.watch<DownloadManager>();
    final activeCount = m.jobs.values.where((j) => j.active).length;
    final pages = [
      HomePage(onStarted: () => _selectTab(1), onMenu: _openMenu),
      const DownloadsPage(),
      const HistoryPage(),
    ];
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: m.initError != null
            ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('Native engine failed to start:\n${m.initError}', textAlign: TextAlign.center)))
            : !m.ready ? const Center(child: CircularProgressIndicator()) : IndexedStack(index: _tab, children: pages), // keeps Home state (fetched info) when switching tabs
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: _selectTab,
        destinations: [
          const NavigationDestination(icon: Icon(Icons.link), label: 'Home'),
          NavigationDestination(
            icon: Badge(isLabelVisible: activeCount > 0, label: Text('$activeCount'), child: const Icon(Icons.download_outlined)),
            selectedIcon: Badge(isLabelVisible: activeCount > 0, label: Text('$activeCount'), child: const Icon(Icons.download)),
            label: 'Downloads'),
          const NavigationDestination(icon: Icon(Icons.history), label: 'History'),
        ],
      ),
    );
  }
}
