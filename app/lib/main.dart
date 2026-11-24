import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'services/download_manager.dart';
import 'services/share_intake.dart';
import 'services/ytdlp_bridge.dart';
import 'ui/shell.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  ShareIntake.init();
  runApp(ChangeNotifierProvider(
    create: (_) => DownloadManager(YtDlpBridge())..init(),
    child: const MultiDownloaderApp(),
  ));
}

class MultiDownloaderApp extends StatefulWidget {
  const MultiDownloaderApp({super.key});
  @override
  State<MultiDownloaderApp> createState() => _State();
}

class _State extends State<MultiDownloaderApp> {
  ThemeMode _mode = ThemeMode.dark; // original default: dark, with light toggle
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'MultiDownloader',
        debugShowCheckedModeBanner: false,
        themeMode: _mode,
        theme: ThemeData(colorSchemeSeed: Colors.red, useMaterial3: true),
        darkTheme: ThemeData(colorSchemeSeed: Colors.red, useMaterial3: true, brightness: Brightness.dark),
        home: Shell(
          dark: _mode == ThemeMode.dark,
          onToggleTheme: () => setState(() => _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark),
        ),
      );
}
