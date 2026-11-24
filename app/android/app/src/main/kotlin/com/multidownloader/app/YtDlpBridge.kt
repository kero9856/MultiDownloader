package com.multidownloader.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.yausername.aria2c.Aria2c
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * Replaces the Node backend: runs yt-dlp (+ffmpeg, aria2c) locally on the device.
 * UNTESTED - written without an Android SDK. First job of session 2: compile and fix.
 */
class YtDlpBridge(private val activity: android.app.Activity) {
    private val ctx: Context = activity.applicationContext
    private var aria2Ok = false
    private val scope = CoroutineScope(Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())
    private var sink: EventChannel.EventSink? = null

    fun register(m: BinaryMessenger) {
        EventChannel(m, "multidownloader/ytdlp/progress").setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(args: Any?, events: EventChannel.EventSink?) { sink = events }
            override fun onCancel(args: Any?) { sink = null }
        })
        MethodChannel(m, "multidownloader/ytdlp").setMethodCallHandler { call, result ->
            when (call.method) {
                "init" -> run(result) {
                    YoutubeDL.getInstance().init(ctx)
                    FFmpeg.getInstance().init(ctx)
                    try { Aria2c.getInstance().init(ctx); aria2Ok = true } catch (e: Throwable) { aria2Ok = false }
                    null
                }
                "getInfo" -> run(result) {
                    val req = YoutubeDLRequest(call.argument<String>("url")!!)
                    req.addOption("--dump-single-json")
                    req.withCommon(call.argument<Boolean>("insecure") == true)
                    if (call.argument<Boolean>("playlist") == true) {
                        req.addOption("--flat-playlist")
                        req.addOption("--playlist-end", (call.argument<Int>("playlistEnd") ?: 200).toString())
                    } else req.addOption("--no-playlist")
                    YoutubeDL.getInstance().execute(req).out
                }
                "download" -> run(result) {
                    val id = call.argument<String>("processId")!!
                    val dir = File(call.argument<String>("outputDir")!!).apply { mkdirs() }
                    val req = YoutubeDLRequest(call.argument<String>("url")!!)
                    req.withCommon(call.argument<Boolean>("insecure") == true)
                    addArgs(req, call.argument<List<String>>("args")!!)
                    req.addOption("-o", File(dir, "download.%(ext)s").absolutePath)
                    req.addOption("--continue")                       // resume like the Node version
                    req.addOption("--retries", "infinite")
                    req.addOption("--fragment-retries", "infinite")
                    req.addOption("--socket-timeout", "15")
                    YoutubeDL.getInstance().execute(req, id) { progress, eta, line ->
                        main.post { sink?.success(mapOf("processId" to id, "percent" to progress.toDouble(), "eta" to eta, "line" to line)) }
                    }
                    pickOutput(dir)?.absolutePath ?: throw IllegalStateException("No output file produced")
                }
                "exec" -> run(result) {
                    val req = YoutubeDLRequest(call.argument<String>("url")!!).withCommon(call.argument<Boolean>("insecure") == true)
                    req.addOption("--no-playlist")
                    addArgs(req, call.argument<List<String>>("args")!!)
                    YoutubeDL.getInstance().execute(req).out
                }
                "serviceUpdate" -> { DownloadService.update(ctx, call.argument<String>("text") ?: "", call.argument<Int>("percent") ?: 0); result.success(null) }
                "serviceStop" -> { DownloadService.stop(ctx); result.success(null) }
                "requestPermissions" -> {
                    val p = mutableListOf<String>()
                    if (Build.VERSION.SDK_INT >= 33) p.add("android.permission.POST_NOTIFICATIONS")
                    if (Build.VERSION.SDK_INT <= 28) p.add("android.permission.WRITE_EXTERNAL_STORAGE")
                    if (p.isNotEmpty()) activity.requestPermissions(p.toTypedArray(), 1001)
                    result.success(null)
                }
                "exportToDownloads" -> run(result) {
                    export(call.argument<String>("path")!!, call.argument<String>("displayName")!!, call.argument<String>("mime") ?: "application/octet-stream")
                }
                "deletePublic" -> run(result) { deletePublic(call.argument<String>("uri")!!) }
                "diagnose" -> run(result) {
                    mapOf(
                        "ytdlpVersion" to (YoutubeDL.getInstance().version(ctx) ?: "unknown"),
                        "abi" to android.os.Build.SUPPORTED_ABIS.joinToString(),
                        "aria2c" to (if (aria2Ok) "available" else "unavailable"),
                        "jsRuntime" to if (jsRuntimeArgs().isEmpty()) "none (YouTube may fail)" else "quickjs",
                    )
                }
                "cancel" -> result.success(YoutubeDL.getInstance().destroyProcessById(call.argument<String>("processId")!!))
                "update" -> run(result) {
                    val ch = if (call.argument<String>("channel") == "nightly") YoutubeDL.UpdateChannel.NIGHTLY else YoutubeDL.UpdateChannel.STABLE
                    YoutubeDL.getInstance().updateYoutubeDL(ctx, ch)?.toString() ?: "ALREADY_UP_TO_DATE"
                }
                else -> result.notImplemented()
            }
        }
    }

    /**
     * YouTube needs a JavaScript runtime for yt-dlp's EJS challenge solver (the Node original used `jsRuntimes:'node'`).
     * Neither Node nor Deno exists on Android and youtubedl-android does not bundle one (confirmed in its README and
     * Seal issue #2543: "No supported JavaScript runtime could be found"). yt-dlp supports `quickjs`, so if a QuickJS
     * executable is packaged as jniLibs/<abi>/libqjs.so we point yt-dlp at it. Without it, YouTube may fail.
     */
    private fun jsRuntimeArgs(): List<String> {
        val f = File(ctx.applicationInfo.nativeLibraryDir, "libqjs.so")
        return if (f.exists()) listOf("--js-runtimes", "quickjs:${f.absolutePath}") else emptyList()
    }

    /** Adds a flat CLI list as (option, value) pairs so duplicated values can never collide inside the request's option map. */
    private fun addArgs(req: YoutubeDLRequest, args: List<String>) {
        var i = 0
        while (i < args.size) {
            val a = args[i]
            val next = args.getOrNull(i + 1)
            if (a.startsWith("-") && next != null && !next.startsWith("-")) { req.addOption(a, next); i += 2 }
            else { req.addOption(a); i += 1 }
        }
    }

    /** The finished file is the biggest plain `download.<ext>`; intermediates (.f137.mp4, .part, .ytdl, .temp, -Frag) are ignored. */
    private fun pickOutput(dir: File): File? {
        val all = dir.listFiles()?.filter { it.isFile && it.name.startsWith("download") } ?: return null
        val bad = Regex("""\.(part|ytdl|temp|aria2)(-.*)?$|-Frag\d+""")
        val ok = all.filter { !bad.containsMatchIn(it.name) }
        val plain = ok.filter { Regex("""^download\.[A-Za-z0-9]{2,5}$""").matches(it.name) }
        return (plain.ifEmpty { ok }).maxByOrNull { it.length() }
    }

    private fun deletePublic(uri: String): Boolean =
        if (uri.startsWith("content://")) ctx.contentResolver.delete(android.net.Uri.parse(uri), null, null) > 0
        else File(uri).delete()

    private fun YoutubeDLRequest.withCommon(insecure: Boolean = false): YoutubeDLRequest {
        addOption("--no-warnings"); addOption("--socket-timeout", "20")
        if (insecure) addOption("--no-check-certificates")
        jsRuntimeArgs().chunked(2).forEach { addOption(it[0], it[1]) }
        return this
    }

    /** Scoped storage: MediaStore.Downloads on API 29+ (no permission needed); direct public-dir copy on API 24-28. */
    private fun export(path: String, name: String, mime: String): String {
        val src = File(path)
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/MultiDownloader")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = ctx.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: throw IllegalStateException("MediaStore insert failed")
            ctx.contentResolver.openOutputStream(uri)!!.use { out -> src.inputStream().use { it.copyTo(out) } }
            v.clear(); v.put(MediaStore.MediaColumns.IS_PENDING, 0)
            ctx.contentResolver.update(uri, v, null, null)
            return uri.toString()
        }
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "MultiDownloader").apply { mkdirs() }
        var dest = File(dir, name); var n = 2
        val base = if (name.contains('.')) name.substringBeforeLast('.') else name
        val ext = if (name.contains('.')) "." + name.substringAfterLast('.') else ""
        while (dest.exists()) { dest = File(dir, "$base ($n)$ext"); n++ }
        src.copyTo(dest)
        return dest.absolutePath
    }

    private fun run(result: MethodChannel.Result, block: () -> Any?) {
        scope.launch {
            try { val v = block(); main.post { result.success(v) } }
            catch (e: Throwable) { main.post { result.error("YTDLP_ERROR", e.message, null) } }
        }
    }
}
