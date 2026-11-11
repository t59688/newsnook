package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.shadows.ShadowNetworkCapabilities;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class SourceWatchNotificationAndScheduleTest {
    private Application context;
    private NotificationManager notifications;
    private AlarmManager alarms;
    private JobScheduler jobs;
    private PowerManager powerManager;

    @Before
    public void setUp() {
        context = RuntimeEnvironment.getApplication();
        notifications = context.getSystemService(NotificationManager.class);
        alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        Shadows.shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        context.getSharedPreferences(SourceWatchPlugin.PREFS, Context.MODE_PRIVATE).edit().clear().commit();
        Settings.Secure.putInt(context.getContentResolver(), "lock_screen_show_notifications", 1);
        SourceWatchJobService.resetCooldown();
    }

    @Test
    public void channelMigrationCreatesHighImportancePublicLockscreenChannel() {
        NotificationChannel legacy = new NotificationChannel(
            SourceWatchPlugin.LEGACY_CHANNEL,
            "关注信源更新",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        notifications.createNotificationChannel(legacy);

        boolean posted = SourceWatchPlugin.post(
            context,
            "watch:rss-1",
            "科技日报 有更新",
            "测试文章标题",
            "https://example.com/post-1"
        );

        assertTrue(posted);
        assertNull(notifications.getNotificationChannel(SourceWatchPlugin.LEGACY_CHANNEL));
        NotificationChannel migrated = notifications.getNotificationChannel(SourceWatchPlugin.CHANNEL);
        assertNotNull(migrated);
        assertEquals(NotificationManager.IMPORTANCE_HIGH, migrated.getImportance());
        assertEquals(Notification.VISIBILITY_PUBLIC, migrated.getLockscreenVisibility());

        List<Notification> postedList = Shadows.shadowOf(notifications).getAllNotifications();
        assertEquals(1, postedList.size());
        Notification note = postedList.get(0);
        assertEquals(Notification.VISIBILITY_PUBLIC, note.visibility);
        assertNotEquals(Notification.CATEGORY_RECOMMENDATION, note.category);
        assertEquals(Notification.PRIORITY_HIGH, note.priority);
    }

    @Test
    public void channelMigrationPreservesExplicitLegacyDisablement() {
        NotificationChannel legacyDisabled = new NotificationChannel(
            SourceWatchPlugin.LEGACY_CHANNEL,
            "关注信源更新",
            NotificationManager.IMPORTANCE_NONE
        );
        notifications.createNotificationChannel(legacyDisabled);

        boolean enabled = SourceWatchPlugin.notificationsEnabled(context);

        assertFalse(enabled);
        assertNull(notifications.getNotificationChannel(SourceWatchPlugin.LEGACY_CHANNEL));
        NotificationChannel migrated = notifications.getNotificationChannel(SourceWatchPlugin.CHANNEL);
        assertNotNull(migrated);
        assertEquals(NotificationManager.IMPORTANCE_NONE, migrated.getImportance());
    }

    @Test
    public void syncRulesSchedulesAllowWhileIdleAlarmAndJobAndClearsWhenEmpty() throws Exception {
        TestSourceWatchPlugin plugin = new TestSourceWatchPlugin();
        JSObject syncOpts = buildSyncOptions(10, false, new String[] { "seen-1" });
        CapturingCall syncCall = new CapturingCall("syncRules", syncOpts);

        plugin.syncRules(syncCall);
        assertNull(syncCall.error.get());
        assertNotNull(syncCall.resolved.get());

        ShadowAlarmManager shadowAlarms = Shadows.shadowOf(alarms);
        assertEquals(1, shadowAlarms.getScheduledAlarms().size());
        ShadowAlarmManager.ScheduledAlarm scheduledAlarm = shadowAlarms.getScheduledAlarms().get(0);
        assertEquals(AlarmManager.RTC_WAKEUP, scheduledAlarm.type);
        assertTrue(scheduledAlarm.allowWhileIdle);

        JobInfo pending = jobs.getPendingJob(SourceWatchPlugin.JOB_ID);
        assertNotNull(pending);
        assertFalse(pending.isPeriodic());
        assertEquals(600_000L, pending.getMinLatencyMillis());
        assertEquals(780_000L, pending.getMaxExecutionDelayMillis());

        CapturingCall statusCall = new CapturingCall("getNotificationStatus", new JSObject());
        plugin.getNotificationStatus(statusCall);
        JSObject status = statusCall.resolved.get();
        assertNotNull(status);
        assertTrue(status.getBoolean("enabled"));
        assertTrue(status.getBoolean("lockscreenVisible"));
        assertTrue(status.getBoolean("scheduled"));

        JSObject emptyOpts = new JSObject();
        emptyOpts.put("sources", new JSArray());
        emptyOpts.put("intervalMinutes", 10);
        emptyOpts.put("wifiOnly", false);
        CapturingCall clearCall = new CapturingCall("syncRules", emptyOpts);
        plugin.syncRules(clearCall);
        assertNull(clearCall.error.get());
        assertTrue(shadowAlarms.getScheduledAlarms().isEmpty());
        assertTrue(jobs.getAllPendingJobs().isEmpty());
    }

    @Test
    public void syncRulesPreservesActiveAlarmWhenOnlySeenCursorChanges() throws Exception {
        TestSourceWatchPlugin plugin = new TestSourceWatchPlugin();
        plugin.syncRules(new CapturingCall("syncRules", buildSyncOptions(15, false, new String[] { "https://example.com/1" })));

        SharedPreferences prefs = context.getSharedPreferences(SourceWatchPlugin.PREFS, Context.MODE_PRIVATE);
        long firstNextAlarmAt = prefs.getLong(SourceWatchPlugin.KEY_NEXT_ALARM_AT, 0L);
        assertTrue(firstNextAlarmAt > 0L);

        plugin.syncRules(new CapturingCall("syncRules", buildSyncOptions(15, false, new String[] { "https://example.com/2" })));

        assertEquals(firstNextAlarmAt, prefs.getLong(SourceWatchPlugin.KEY_NEXT_ALARM_AT, 0L));
        assertNotNull(jobs.getPendingJob(SourceWatchPlugin.JOB_ID));
        assertTrue(jobs.getPendingJob(SourceWatchPlugin.JOB_ID).isPeriodic());
    }

    @Test
    public void alarmReceiverRestoresOnBootAndUsesExpeditedJobWhenBatteryOptimized() throws Exception {
        TestSourceWatchPlugin plugin = new TestSourceWatchPlugin();
        plugin.syncRules(new CapturingCall("syncRules", buildSyncOptions(15, false, new String[0])));

        jobs.cancelAll();
        Shadows.shadowOf(alarms).getScheduledAlarms().clear();

        SourceWatchAlarmReceiver receiver = new SourceWatchAlarmReceiver();
        receiver.onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));

        assertFalse(Shadows.shadowOf(alarms).getScheduledAlarms().isEmpty());
        JobInfo restored = jobs.getPendingJob(SourceWatchPlugin.JOB_ID);
        assertNotNull(restored);
        assertTrue(restored.isPeriodic());

        Shadows.shadowOf(powerManager).setIgnoringBatteryOptimizations(context.getPackageName(), false);
        jobs.cancelAll();
        receiver.onReceive(context, new Intent(SourceWatchPlugin.ACTION_POLL_ALARM));

        JobInfo expedited = jobs.getPendingJob(SourceWatchPlugin.EXPEDITED_JOB_ID);
        assertNotNull(expedited);
        assertTrue(expedited.isExpedited());
        assertFalse(Shadows.shadowOf(alarms).getScheduledAlarms().isEmpty());
    }

    @Test
    public void alarmReceiverStartsCheckServiceWhenIgnoringBatteryOptimizations() throws Exception {
        TestSourceWatchPlugin plugin = new TestSourceWatchPlugin();
        plugin.syncRules(new CapturingCall("syncRules", buildSyncOptions(5, false, new String[0])));
        Shadows.shadowOf(powerManager).setIgnoringBatteryOptimizations(context.getPackageName(), true);

        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = cm.getActiveNetwork();
        NetworkCapabilities caps = ShadowNetworkCapabilities.newInstance();
        Shadows.shadowOf(caps).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        Shadows.shadowOf(caps).addTransportType(NetworkCapabilities.TRANSPORT_WIFI);
        Shadows.shadowOf(cm).setNetworkCapabilities(active, caps);

        SourceWatchAlarmReceiver receiver = new SourceWatchAlarmReceiver();
        receiver.onReceive(context, new Intent(SourceWatchPlugin.ACTION_POLL_ALARM));

        Intent startedService = Shadows.shadowOf(context).getNextStartedService();
        assertNotNull(startedService);
        assertEquals(SourceWatchCheckService.class.getName(), startedService.getComponent().getClassName());
    }

    @Test
    public void lockscreenRestrictedReflectsGlobalSystemToggle() throws Exception {
        Settings.Secure.putInt(context.getContentResolver(), "lock_screen_show_notifications", 0);
        TestSourceWatchPlugin plugin = new TestSourceWatchPlugin();
        CapturingCall statusCall = new CapturingCall("getNotificationStatus", new JSObject());
        plugin.getNotificationStatus(statusCall);
        JSObject status = statusCall.resolved.get();
        assertNotNull(status);
        assertFalse(status.getBoolean("lockscreenVisible"));
    }

    @Test
    public void wifiOnlyRejectsMeteredCellularNetwork() {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network active = cm.getActiveNetwork();
        NetworkCapabilities cellular = ShadowNetworkCapabilities.newInstance();
        Shadows.shadowOf(cellular).addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        Shadows.shadowOf(cellular).addTransportType(NetworkCapabilities.TRANSPORT_CELLULAR);
        Shadows.shadowOf(cm).setNetworkCapabilities(active, cellular);

        assertTrue(SourceWatchJobService.isNetworkAllowed(context, false));
        assertFalse(SourceWatchJobService.isNetworkAllowed(context, true));
    }

    private JSObject buildSyncOptions(int intervalMinutes, boolean wifiOnly, String[] seen) throws Exception {
        JSObject source = new JSObject();
        source.put("id", "rss-1");
        source.put("name", "测试源");
        source.put("url", "https://example.com/feed.xml");
        source.put("mode", "instant");
        JSArray seenArray = new JSArray();
        for (String s : seen) seenArray.put(s);
        source.put("seen", seenArray);

        JSArray sources = new JSArray();
        sources.put(source);

        JSObject options = new JSObject();
        options.put("sources", sources);
        options.put("intervalMinutes", intervalMinutes);
        options.put("quietHours", false);
        options.put("wifiOnly", wifiOnly);
        return options;
    }

    private class TestSourceWatchPlugin extends SourceWatchPlugin {
        @Override
        public Context getContext() {
            return context;
        }
    }

    private static class CapturingCall extends PluginCall {
        final AtomicReference<JSObject> resolved = new AtomicReference<>();
        final AtomicReference<String> error = new AtomicReference<>();

        CapturingCall(String methodName, JSObject data) {
            super(null, "SourceWatch", "test", methodName, data);
        }

        @Override
        public void resolve() {
            resolved.set(new JSObject());
        }

        @Override
        public void resolve(JSObject data) {
            resolved.set(data);
        }

        @Override
        public void reject(String msg) {
            error.set(msg);
        }

        @Override
        public void reject(String msg, Exception ex) {
            error.set(msg + ": " + ex.getMessage());
        }
    }
}
