package com.aizeek.newsnook;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps phone-relayed DLNA sessions alive when the Activity/WebView goes away.
 *
 * Direct casts never enter this service: once a renderer can fetch the upstream
 * media itself, the phone is only an optional controller and can disappear.
 */
public final class DlnaCastForegroundService extends Service {

    private static final String CHANNEL_ID = "newsnook_cast";
    private static final int NOTIFICATION_ID = 0x4e4e43;
    private static final String ACTION_REFRESH =
        "com.aizeek.newsnook.action.REFRESH_CAST_NOTIFICATION";
    private static final Map<String, RelayLease> RELAYS = new ConcurrentHashMap<>();

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    static void registerRelay(
        Context context,
        String rendererId,
        String rendererName,
        CastMediaProxy.SessionHandle relay
    ) {
        Context app = context.getApplicationContext();
        RelayLease replacement = new RelayLease(rendererId, rendererName, relay);
        RelayLease previous = RELAYS.put(rendererId, replacement);
        if (previous != null && !previous.relay.token.equals(relay.token)) {
            CastMediaProxy.getInstance().closeSession(previous.relay.token);
        }

        Intent intent = new Intent(app, DlnaCastForegroundService.class)
            .setAction(ACTION_REFRESH);
        try {
            ContextCompat.startForegroundService(app, intent);
        } catch (RuntimeException error) {
            RELAYS.remove(rendererId, replacement);
            CastMediaProxy.getInstance().closeSession(relay.token);
            throw error;
        }
    }

    static CastMediaProxy.SessionHandle findRelay(String rendererId, String transportUrl) {
        RelayLease lease = RELAYS.get(rendererId);
        if (lease == null) return null;
        return lease.relay.url.equals(transportUrl) ? lease.relay : null;
    }

    static void releaseRelay(Context context, String rendererId) {
        RelayLease lease = RELAYS.remove(rendererId);
        if (lease != null) {
            CastMediaProxy.getInstance().closeSession(lease.relay.token);
        }

        Context app = context.getApplicationContext();
        if (RELAYS.isEmpty()) {
            app.stopService(new Intent(app, DlnaCastForegroundService.class));
            return;
        }
        try {
            ContextCompat.startForegroundService(
                app,
                new Intent(app, DlnaCastForegroundService.class).setAction(ACTION_REFRESH)
            );
        } catch (RuntimeException ignored) {
            // An already-running foreground service keeps its current notification.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (RELAYS.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        promoteToForeground();
        acquireLocks();
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        for (RelayLease lease : RELAYS.values()) {
            CastMediaProxy.getInstance().closeSession(lease.relay.token);
        }
        RELAYS.clear();
        releaseLocks();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    private void promoteToForeground() {
        int serviceType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            : 0;
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            buildNotification(),
            serviceType
        );
    }

    private Notification buildNotification() {
        RelayLease latest = null;
        for (RelayLease lease : RELAYS.values()) latest = lease;
        String deviceName = latest == null ? "电视" : latest.rendererName;
        String title = RELAYS.size() > 1
            ? "正在向 " + RELAYS.size() + " 台设备投屏"
            : "正在投屏到 " + deviceName;

        Intent openApp = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            openApp,
            pendingFlags
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_cast_notification)
            .setContentTitle(title)
            .setContentText("兼容模式：可熄屏或退出应用，请保持手机开机并连接当前 Wi-Fi")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "投屏",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("保持需要手机中转的视频在熄屏和退出应用后继续投屏");
        manager.createNotificationChannel(channel);
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                wakeLock = power.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "NewsNook:DlnaRelay"
                );
                wakeLock.setReferenceCounted(false);
            }
        }
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();

        if (wifiLock == null) {
            WifiManager wifi = (WifiManager) getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                wifiLock = wifi.createWifiLock(
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                    "NewsNook:DlnaRelay"
                );
                wifiLock.setReferenceCounted(false);
            }
        }
        if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
    }

    private void releaseLocks() {
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private static final class RelayLease {
        final String rendererId;
        final String rendererName;
        final CastMediaProxy.SessionHandle relay;

        RelayLease(
            String rendererId,
            String rendererName,
            CastMediaProxy.SessionHandle relay
        ) {
            this.rendererId = rendererId;
            this.rendererName = rendererName;
            this.relay = relay;
        }
    }
}
