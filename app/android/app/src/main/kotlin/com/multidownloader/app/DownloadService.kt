package com.multidownloader.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Foreground service that keeps the process (and the yt-dlp child processes) alive while downloads run in the background.
 * It does not download anything itself: the Dart DownloadManager sends it text + percent for the notification.
 * Needs: FOREGROUND_SERVICE + FOREGROUND_SERVICE_DATA_SYNC permissions and android:foregroundServiceType="dataSync" (manifest).
 * UNTESTED (notably Android 14 foreground-service rules and POST_NOTIFICATIONS denial behaviour).
 */
class DownloadService : Service() {
    companion object {
        private const val CHANNEL = "downloads"
        private const val ID = 1001
        const val EXTRA_TEXT = "text"
        const val EXTRA_PERCENT = "percent"
        const val ACTION_STOP = "com.multidownloader.app.STOP"

        /** Whether the app currently WANTS the service. A stale start/stop intent that arrives later is resolved against this flag. */
        @Volatile private var wanted = false
        @Volatile private var sent = false

        fun update(ctx: Context, text: String, percent: Int) {
            wanted = true; sent = true
            val i = Intent(ctx, DownloadService::class.java).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_PERCENT, percent)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Throwable) { sent = false } // e.g. ForegroundServiceStartNotAllowedException: downloads keep running, just without the notification
        }

        /** Never uses stopService(): every start must be answered by startForeground(), so stopping is a start with ACTION_STOP. */
        fun stop(ctx: Context) {
            wanted = false
            if (!sent) return
            val i = Intent(ctx, DownloadService::class.java).setAction(ACTION_STOP)
            try {
                if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
            } catch (e: Throwable) { try { ctx.stopService(Intent(ctx, DownloadService::class.java)) } catch (_: Throwable) {} }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Downloading"
        val pct = intent?.getIntExtra(EXTRA_PERCENT, 0) ?: 0
        val n = build(text, pct)
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(ID, n)
        } catch (e: Throwable) { sent = false; stopSelf(); return START_NOT_STICKY }
        // Decided by the app's CURRENT intent, so a late STOP can't kill a service that was asked to start again meanwhile.
        if (!wanted) {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
            sent = false
            stopSelf()
        }
        return START_NOT_STICKY // downloads resume from the Unfinished list if the system kills us
    }

    override fun onDestroy() { sent = false; super.onDestroy() }

    private fun build(text: String, pct: Int): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Downloads", NotificationManager.IMPORTANCE_LOW))
        }
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val open = if (launch != null) PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) else null
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
        return b.setContentTitle("MultiDownloader").setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download).setOngoing(true).setOnlyAlertOnce(true)
            .setProgress(100, pct.coerceIn(0, 100), pct <= 0).setContentIntent(open).build()
    }
}
