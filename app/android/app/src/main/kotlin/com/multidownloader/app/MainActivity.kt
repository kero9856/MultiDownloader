package com.multidownloader.app

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var shareChannel: MethodChannel? = null
    private var pendingShare: String? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        YtDlpBridge(this).register(messenger)
        // Native Android player (android.widget.VideoView) as a Flutter platform view - replaces the browser/HLS proxy.
        flutterEngine.plugins.add(NativePlayerPlugin())
        // Links shared from other apps (ACTION_SEND text/plain).
        pendingShare = sharedText(intent)
        shareChannel = MethodChannel(messenger, "multidownloader/share").also { ch ->
            ch.setMethodCallHandler { call, result ->
                if (call.method == "initial") { val t = pendingShare; pendingShare = null; result.success(t) } else result.notImplemented()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val t = sharedText(intent) ?: return
        val ch = shareChannel
        if (ch != null) ch.invokeMethod("shared", t) else pendingShare = t
    }

    private fun sharedText(i: Intent?): String? =
        if (i?.action == Intent.ACTION_SEND && i.type?.startsWith("text/") == true) i.getStringExtra(Intent.EXTRA_TEXT) else null
}
