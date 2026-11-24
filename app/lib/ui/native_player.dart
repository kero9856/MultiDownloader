// Flutter wrapper for the native Android VideoView platform view (android/.../NativePlayer.kt). No WebView.
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class PlayerState {
  final int positionMs, durationMs;
  final bool playing, prepared;
  final String? error;
  const PlayerState(this.positionMs, this.durationMs, this.playing, this.prepared, this.error);
}

class NativePlayerController {
  final MethodChannel _ch;
  NativePlayerController(int viewId) : _ch = MethodChannel('multidownloader/player/$viewId');
  Future<void> load(String url, Map<String, String> headers) => _ch.invokeMethod('load', {'url': url, 'headers': headers});
  Future<void> play() => _ch.invokeMethod('play');
  Future<void> pause() => _ch.invokeMethod('pause');
  Future<void> seekToMs(int ms) => _ch.invokeMethod('seekTo', {'ms': ms});
  Future<void> stop() => _ch.invokeMethod('stop');
  Future<PlayerState> state() async {
    final m = Map<String, dynamic>.from(await _ch.invokeMethod<Map>('state') ?? {});
    return PlayerState((m['position'] as num?)?.toInt() ?? 0, (m['duration'] as num?)?.toInt() ?? 0,
        m['playing'] == true, m['prepared'] == true, m['error'] as String?);
  }
}

class NativePlayerView extends StatelessWidget {
  final void Function(NativePlayerController) onCreated;
  const NativePlayerView({super.key, required this.onCreated});
  static const _type = 'multidownloader/player';

  @override
  Widget build(BuildContext context) => PlatformViewLink(
        viewType: _type,
        surfaceFactory: (context, controller) => AndroidViewSurface(
          controller: controller as AndroidViewController,
          gestureRecognizers: const <Factory<OneSequenceGestureRecognizer>>{},
          hitTestBehavior: PlatformViewHitTestBehavior.opaque,
        ),
        onCreatePlatformView: (params) {
          final c = PlatformViewsService.initExpensiveAndroidView(
            id: params.id, viewType: _type, layoutDirection: TextDirection.ltr,
            creationParamsCodec: const StandardMessageCodec(), onFocus: () => params.onFocusChanged(true));
          c.addOnPlatformViewCreatedListener(params.onPlatformViewCreated);
          c.addOnPlatformViewCreatedListener((id) => onCreated(NativePlayerController(id)));
          c.create();
          return c;
        },
      );
}
