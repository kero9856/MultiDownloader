// Port of original src/history.js: JSON file of finished downloads (max 500).
import 'dart:convert';
import 'dart:io';
import '../models/models.dart';

class HistoryStore {
  final Directory dir;
  HistoryStore(this.dir);
  static const _max = 500;
  List<HistoryEntry>? _items;
  File get _file => File('${dir.path}/history.json');

  List<HistoryEntry> _load() {
    if (_items != null) return _items!;
    try {
      final d = jsonDecode(_file.readAsStringSync());
      _items = [for (final e in (d as List)) HistoryEntry.fromJson(Map<String, dynamic>.from(e as Map))];
    } catch (_) {
      _items = [];
    }
    return _items!;
  }

  void _save() {
    try {
      dir.createSync(recursive: true);
      final tmp = File('${_file.path}.tmp')..writeAsStringSync(jsonEncode(_items!.map((e) => e.toJson()).toList()));
      tmp.renameSync(_file.path);
    } catch (_) {/* ignore, like the original */}
  }

  void add(HistoryEntry e) {
    final l = _load()..removeWhere((x) => x.id == e.id);
    l.insert(0, e);
    if (l.length > _max) l.removeRange(_max, l.length);
    _save();
  }

  /// Cheap: no file-system access (the `missing` flag is refreshed by [refreshMissing]).
  List<HistoryEntry> list() => List.unmodifiable(_load());

  /// Re-checks which files still exist. Called when the History tab is opened, not on every rebuild.
  void refreshMissing() {
    for (final e in _load()) {
      e.missing = !File(e.path).existsSync();
    }
  }

  HistoryEntry? find(String id) {
    for (final e in _load()) { if (e.id == id) return e; }
    return null;
  }

  /// Removes only the entry; the manager deletes the files (see DownloadManager.deleteHistoryEntry).
  void remove(String id) { _load().removeWhere((x) => x.id == id); _save(); }
  void clear() { _load().clear(); _save(); }
}
