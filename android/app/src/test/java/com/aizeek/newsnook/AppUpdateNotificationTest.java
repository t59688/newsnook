package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.Manifest;
import android.app.Application;
import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class AppUpdateNotificationTest {
    private Application context;
    private NotificationManager manager;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        manager = context.getSystemService(NotificationManager.class);
        Shadows.shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
    }

    @Test
    public void downloadWaitsForNotificationPermissionBeforeEnqueueing() {
        TestPlugin plugin = new TestPlugin();
        JSObject options = new JSObject();
        options.put("url", "https://news-update.aizeek.com/test.apk");
        options.put("fileName", "test.apk");
        PluginCall call = new PluginCall(null, "AppUpdate", "test", "startDownload", options) {
            @Override
            public void resolve(JSObject result) {
                throw new AssertionError("Download must wait for the notification permission result");
            }
        };

        plugin.startDownload(call);

        assertEquals("notifications", plugin.requestedAlias);
        assertNull(Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID));
    }

    @Test
    public void progressNotificationContainsDownloadedBytesAndPercentage() {
        AppUpdateDownloadNotifier notifier = new AppUpdateDownloadNotifier(context);
        notifier.start("test.apk");
        SystemClock.sleep(500);
        notifier.updateBytes(1024 * 1024, 4 * 1024 * 1024);

        Notification notification = Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID);
        assertNotNull(notification);
        assertEquals("1.00 MB / 4.00 MB · 25%", notification.extras.getString(Notification.EXTRA_TEXT));
        assertEquals(250, notification.extras.getInt(Notification.EXTRA_PROGRESS));
        assertEquals(1000, notification.extras.getInt(Notification.EXTRA_PROGRESS_MAX));
    }

    @Test
    public void disabledAppNotificationsDoNotPostCustomProgress() {
        Shadows.shadowOf(manager).setNotificationsEnabled(false);

        new AppUpdateDownloadNotifier(context).start("test.apk");

        assertNull(Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID));
    }

    @Test
    public void deniedPermissionStillDownloadsWithSystemProgress() throws Exception {
        Shadows.shadowOf(context).denyPermissions(Manifest.permission.POST_NOTIFICATIONS);
        TestPlugin plugin = new TestPlugin();
        DownloadCall call = new DownloadCall();
        plugin.startDownload(call);
        assertEquals("notifications", plugin.requestedAlias);
        Method callback = AppUpdatePlugin.class.getDeclaredMethod("downloadPermissionsCallback", PluginCall.class);
        callback.setAccessible(true);
        callback.invoke(plugin, call);

        assertEquals(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED, visibility(call));
        assertNull(Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID));
        plugin.handleOnDestroy();
    }

    @Test
    public void grantedPermissionUsesCustomProgressWithoutDuplicateSystemNotification() {
        TestPlugin plugin = new TestPlugin();
        plugin.permission = PermissionState.GRANTED;
        DownloadCall call = new DownloadCall();

        plugin.startDownload(call);

        assertNull(plugin.requestedAlias);
        assertEquals(DownloadManager.Request.VISIBILITY_HIDDEN, visibility(call));
        assertNotNull(Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID));
        plugin.handleOnDestroy();
    }

    @Test
    public void blockedUpdateChannelKeepsSystemProgress() {
        manager.createNotificationChannel(new NotificationChannel(
            AppUpdateDownloadNotifier.CHANNEL_ID, "应用更新", NotificationManager.IMPORTANCE_NONE
        ));
        TestPlugin plugin = new TestPlugin();
        plugin.permission = PermissionState.GRANTED;
        DownloadCall call = new DownloadCall();

        plugin.startDownload(call);

        assertEquals(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED, visibility(call));
        assertNull(Shadows.shadowOf(manager).getNotification(AppUpdateDownloadNotifier.NOTIFICATION_ID));
        plugin.handleOnDestroy();
    }

    private int visibility(DownloadCall call) {
        call.awaitCompletion();
        DownloadManager downloadManager = context.getSystemService(DownloadManager.class);
        return Shadows.shadowOf(Shadows.shadowOf(downloadManager).getRequest(call.downloadId)).getNotificationVisibility();
    }

    private static class DownloadCall extends PluginCall {
        long downloadId;
        private final CountDownLatch completed = new CountDownLatch(1);
        private String rejection;

        DownloadCall() {
            super(null, "AppUpdate", "test", "startDownload", options());
        }

        private static JSObject options() {
            JSObject options = new JSObject();
            options.put("url", "https://news-update.aizeek.com/test.apk");
            options.put("fileName", "test.apk");
            return options;
        }

        @Override
        public void resolve(JSObject result) {
            downloadId = result.optLong("downloadId");
            completed.countDown();
        }

        @Override
        public void reject(String message) {
            rejection = message;
            completed.countDown();
        }

        void awaitCompletion() {
            try {
                org.junit.Assert.assertTrue("Download callback timed out", completed.await(5, TimeUnit.SECONDS));
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new AssertionError(error);
            }
            assertNull("Download was rejected", rejection);
        }
    }

    private class TestPlugin extends AppUpdatePlugin {
        String requestedAlias;
        PermissionState permission = PermissionState.PROMPT;

        @Override
        public Context getContext() {
            return context;
        }

        @Override
        public PermissionState getPermissionState(String alias) {
            return permission;
        }

        @Override
        protected void requestPermissionForAlias(String alias, PluginCall call, String callbackName) {
            requestedAlias = alias;
        }
    }
}
