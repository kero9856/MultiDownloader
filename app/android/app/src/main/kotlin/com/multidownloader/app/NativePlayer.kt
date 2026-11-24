package com.multidownloader.app

import android.content.Context
import android.net.Uri
import android.view.View
import android.widget.FrameLayout
import android.widget.VideoView
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory

/**
 * Native preview player. Uses the framework's VideoView/MediaPlayer, so NO extra dependency (no Media3/ExoPlayer version to guess).
 * Plays one http(s) file that contains video+audio (what the original "Watch" proxied through /api/stream).
 * Per-view MethodChannel "multidownloader/player/<viewId>": load(url, headers), play, pause, seekTo(ms), state -> {position, duration, playing}.
 * UNTESTED. Limits: MediaPlayer plays what the device codecs support (H.264/AAC mp4 is safe; VP9 webm depends on device).
 */
/** Registers the player through the supported FlutterPlugin API (no internal platformViewsController access). */
class NativePlayerPlugin : FlutterPlugin {
    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        binding.platformViewRegistry.registerViewFactory(NativePlayerFactory.VIEW_TYPE, NativePlayerFactory(binding.binaryMessenger))
    }
    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {}
}

class NativePlayerFactory(private val messenger: BinaryMessenger) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    companion object { const val VIEW_TYPE = "multidownloader/player" }
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView = NativePlayer(context, messenger, viewId)
}

class NativePlayer(ctx: Context, messenger: BinaryMessenger, id: Int) : PlatformView {
    private val channel = MethodChannel(messenger, "multidownloader/player/$id")
    private val root = FrameLayout(ctx)
    private val video = VideoView(ctx)
    private var prepared = false
    private var lastError: String? = null

    init {
        root.addView(video, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT).apply {
            gravity = android.view.Gravity.CENTER
        })
        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "load" -> {
                    prepared = false
                    @Suppress("UNCHECKED_CAST")
                    val headers = (call.argument<Map<String, String>>("headers") ?: emptyMap())
                    video.setOnPreparedListener { prepared = true; it.isLooping = false; video.start() }
                    video.setOnErrorListener { _, what, extra ->
                        lastError = "MediaPlayer error what=$what extra=$extra"; true
                    }
                    lastError = null
                    video.setVideoURI(Uri.parse(call.argument<String>("url")), headers)
                    result.success(null)
                }
                "play" -> { video.start(); result.success(null) }
                "pause" -> { video.pause(); result.success(null) }
                "seekTo" -> { video.seekTo(call.argument<Int>("ms") ?: 0); result.success(null) }
                "state" -> result.success(mapOf(
                    "position" to (if (prepared) video.currentPosition else 0),
                    "duration" to (if (prepared) video.duration else 0),
                    "playing" to video.isPlaying,
                    "prepared" to prepared,
                    "error" to lastError,
                ))
                "stop" -> { video.stopPlayback(); prepared = false; result.success(null) }
                else -> result.notImplemented()
            }
        }
    }

    override fun getView(): View = root
    override fun dispose() { channel.setMethodCallHandler(null); video.stopPlayback() }
}
