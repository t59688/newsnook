package com.aizeek.newsnook;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 同步的通知栏出口：只负责投递，什么值得通知由 JS 侧 `features/sync/notifier` 决定。
 *
 * 三条硬规矩：
 * 1. 一个 `newsnook-sync` 低优先级渠道，用户可以在系统设置里单独关掉；
 * 2. 通知 id 由调用方给的字符串稳定映射，反复失败只会覆盖同一条而不是堆一列；
 * 3. 不在这里申请 POST_NOTIFICATIONS——没授权就静默跳过，同步照常进行。
 */
@CapacitorPlugin(name = "SyncNotification")
public class SyncNotificationPlugin extends Plugin {

    private static final String CHANNEL_ID = "newsnook-sync";
    /** 点开通知走与分享深链同一条路：Capacitor 的 appUrlOpen / launchUrl，JS 侧决定落地页 */
    private static final String ROUTE_SCHEME = "newsnook://sync/";

    @PluginMethod
    public void notify(PluginCall call) {
        String id = call.getString("id");
        String title = call.getString("title");
        String body = call.getString("body");
        String route = call.getString("route", "account-sync");
        if (id == null || id.isEmpty() || title == null || body == null) {
            call.reject("id, title and body are required");
            return;
        }

        Context context = getContext();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) {
            // 用户关掉了通知：这是明确表态，不追问、不报错
            call.resolve();
            return;
        }

        ensureChannel(context);

        Intent open = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(ROUTE_SCHEME + route))
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId(id),
            open,
            pendingFlags
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_sync_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_LOW);

        try {
            manager.notify(notificationId(id), builder.build());
        } catch (SecurityException ignored) {
            // 运行时权限在两次调用之间被收回：同步本身不受影响
        }
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("id is required");
            return;
        }
        NotificationManagerCompat.from(getContext()).cancel(notificationId(id));
        call.resolve();
    }

    /** 字符串 id → 稳定的整型通知 id，保证同类通知覆盖而不是堆叠 */
    private static int notificationId(String id) {
        return 0x5C000000 | (id.hashCode() & 0x00FFFFFF);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "云同步",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("首次同步完成、同步反复失败、需要你决定的冲突");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
