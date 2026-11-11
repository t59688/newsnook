package com.aizeek.newsnook;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Executes a single SourceWatch check outside JobScheduler when the app is
 * exempt from battery optimizations (or pre-API 26) so OEM job throttling does
 * not delay locked-screen alerts. Never shows a persistent foreground notification.
 */
public class SourceWatchCheckService extends Service {
    private static final long SERVICE_WAKE_LOCK_MS = 190_000L;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (powerManager != null) {
            try {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NewsNook:SourceWatchAlarm");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(SERVICE_WAKE_LOCK_MS);
            } catch (Exception ignored) {
                wakeLock = null;
            }
        }
        final PowerManager.WakeLock heldLock = wakeLock;
        SourceWatchJobService.markRunStart();
        SourceWatchJobService.EXECUTOR.execute(() -> {
            try {
                SourceWatchJobService.performChecks(this, () -> false, true);
            } catch (Exception error) {
                android.util.Log.w("SourceWatch", "Alarm watch check failed", error);
            } finally {
                if (heldLock != null) {
                    try {
                        if (heldLock.isHeld()) heldLock.release();
                    } catch (Exception ignored) {}
                }
                SourceWatchJobService.markRunEnd();
                stopSelf(startId);
            }
        });
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
