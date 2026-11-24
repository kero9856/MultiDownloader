// Settings persisted as settings.json (no shared_preferences dependency).
import 'dart:convert';
import 'dart:io';
import '../models/models.dart';

class SettingsStore {
  final File file;
  SettingsStore(Directory dir) : file = File('${dir.path}/settings.json');

  AppSettings load() {
    try {
      return AppSettings.fromJson(jsonDecode(file.readAsStringSync()) as Map<String, dynamic>);
    } catch (_) {
      return AppSettings();
    }
  }

  void save(AppSettings s) {
    try { file.writeAsStringSync(jsonEncode(s.toJson())); } catch (_) {}
  }
}
