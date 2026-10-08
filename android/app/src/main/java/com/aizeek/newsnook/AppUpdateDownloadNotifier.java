package com.aizeek.newsnook;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Locale;

/**
 * 应用更新下载通知：自管进度与完成态标题。
 * 系统 DownloadManager 的通知标题在完成后不会变；通知可用时由此类展示。
 */
final class AppUpdateDownloadNotifier {
    static final String CHANNEL_ID = "app_update_download";
    static final int NOTIFICATION_ID = 41001;

    private static final long MIN_UPDATE_INTERVAL_MS = 400L;
    private static final int PROGRESS_MAX = 1000;
    private static final String TITLE_DOWNLOADING = "有所闻 · 正在下载更新";
    private static final String TITLE_READY = "有所闻 · 更新已就绪";
    private static final String TITLE_FAILED = "有所闻 · 更新下载失败";

    private final Context appContext;
    private long lastUpdateElapsedMs = 0L;
    private boolean active = false;

    AppUpdateDownloadNotifier(Context context) {
        this.appContext = context.getApplicationContext();
        ensureChannel();
    }

    void start(String fileName) {
        active = true;
        lastUpdateElapsedMs = 0L;
        String hint = (fileName == null || fileName.isEmpty()) ? "准备下载…" : fileName;
        post(TITLE_DOWNLOADING, hint, 0, 0, true, true, android.R.drawable.stat_sys_download);
    }

    void updateBytes(long received, long total) {
        if (!active) start(null);
        long now = SystemClock.elapsedRealtime();
        boolean finished = total > 0 && received >= total;
        if (!finished && now - lastUpdateElapsedMs < MIN_UPDATE_INTERVAL_MS) return;
        lastUpdateElapsedMs = now;

        if (total <= 0) {
            post(
                TITLE_DOWNLOADING,
                formatBytes(received) + " 已下载",
                0,
                0,
                true,
                true,
                android.R.drawable.stat_sys_download
            );
            return;
        }
        int progress = (int) Math.min(PROGRESS_MAX, (received * (long) PROGRESS_MAX) / total);
        int percent = (int) Math.min(100L, (received * 100L) / total);
        String content = formatBytes(received) + " / " + formatBytes(total) + " · " + percent + "%";
        post(
            TITLE_DOWNLOADING,
            content,
            PROGRESS_MAX,
            progress,
            false,
            true,
            android.R.drawable.stat_sys_download
        );
    }

    void assembling() {
        if (!active) return;
        lastUpdateElapsedMs = 0L;
        post(
            "有所闻 · 正在准备更新",
            "正在校验并合成安装包…",
            0,
            0,
            true,
            true,
            android.R.drawable.stat_sys_download
        );
    }

    void complete(String content) {
        active = false;
        lastUpdateElapsedMs = 0L;
        post(
            TITLE_READY,
            content != null ? content : "下载完成，正在打开安装界面",
            0,
            0,
            false,
            false,
            android.R.drawable.stat_sys_download_done
        );
    }

    void fail(String message) {
        active = false;
        lastUpdateElapsedMs = 0L;
        post(
            TITLE_FAILED,
            message != null ? message : "下载失败",
            0,
            0,
            false,
            false,
            android.R.drawable.stat_notify_error
        );
    }

    void clear() {
        active = false;
        NotificationManagerCompat.from(appContext).cancel(NOTIFICATION_ID);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = appContext.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "应用更新",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("应用更新下载进度");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void post(
        String title,
        String content,
        int max,
        int progress,
        boolean indeterminate,
        boolean ongoing,
        int smallIcon
    ) {
        if (!canPost()) return;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(smallIcon)
            .setContentTitle(title)
            .setContentText(content)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(content))
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(launchPendingIntent())
            .setSilent(true);
        if (ongoing || indeterminate || max > 0) {
            builder.setProgress(max, progress, indeterminate);
        } else {
            builder.setProgress(0, 0, false);
        }
        if (!ongoing) {
            builder.setAutoCancel(true);
        }
        try {
            NotificationManagerCompat.from(appContext).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // 权限在 notify 瞬间被撤销时忽略
        }
    }

    boolean canPost() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.POST_NOTIFICATIONS
            ) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(appContext).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = appContext.getSystemService(NotificationManager.class);
            if (manager == null) return false;
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
            return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        return true;
    }

    private PendingIntent launchPendingIntent() {
        Intent intent = appContext
            .getPackageManager()
            .getLaunchIntentForPackage(appContext.getPackageName());
        if (intent == null) {
            intent = new Intent(appContext, MainActivity.class);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getActivity(appContext, NOTIFICATION_ID, intent, flags);
    }

    static String formatBytes(long bytes) {
        if (bytes < 0L) bytes = 0L;
        double mb = bytes / (1024.0 * 1024.0);
        if (mb >= 100.0) return String.format(Locale.ROOT, "%.0f MB", mb);
        if (mb >= 10.0) return String.format(Locale.ROOT, "%.1f MB", mb);
        if (mb >= 1.0) return String.format(Locale.ROOT, "%.2f MB", mb);
        return String.format(Locale.ROOT, "%.0f KB", bytes / 1024.0);
    }
}
