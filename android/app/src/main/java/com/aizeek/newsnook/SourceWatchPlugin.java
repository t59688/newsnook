package com.aizeek.newsnook;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONObject;

/** Native periodic RSS monitoring. All source selection is explicit and local. */
@CapacitorPlugin(name = "SourceWatch", permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class SourceWatchPlugin extends Plugin {
    static final String PREFS = "source-watch";
    static final String CONFIG = "config";
    static final String LEGACY_CHANNEL = "newsnook-source-watch";
    static final String CHANNEL = "newsnook-source-watch-alerts";
    static final String ACTION_POLL_ALARM = "com.aizeek.newsnook.action.SOURCE_WATCH_POLL";
    static final String KEY_NEXT_ALARM_AT = "nextAlarmAt";
    static final String KEY_ALARM_BOOT_COUNT = "alarmBootCount";
    static final int JOB_ID = 0x39753;
    static final int SHORT_JOB_ID = JOB_ID + 1;
    static final int EXPEDITED_JOB_ID = JOB_ID + 2;
    static final int IMMEDIATE_JOB_ID = JOB_ID + 3;
    static final int ALARM_REQUEST_CODE = 0x39759;
    private static final long ALARM_STALE_GRACE_MS = 120_000L;

    static int intervalMinutes(int requested) {
        switch (requested) {
            case 5: case 10: case 15: case 30: case 60: return requested;
            default: return 60;
        }
    }

    static boolean usesShortJobs(int minutes) { return minutes < 15; }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager system = context.getSystemService(NotificationManager.class);
        if (system == null) return;
        NotificationChannel legacy = system.getNotificationChannel(LEGACY_CHANNEL);
        boolean legacyDisabled = legacy != null && legacy.getImportance() == NotificationManager.IMPORTANCE_NONE;
        if (system.getNotificationChannel(CHANNEL) == null) {
            int importance = legacyDisabled ? NotificationManager.IMPORTANCE_NONE : NotificationManager.IMPORTANCE_HIGH;
            NotificationChannel channel = new NotificationChannel(CHANNEL, "关注信源更新", importance);
            channel.setDescription("主动关注的信源出现新内容时立即提醒");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setShowBadge(true);
            channel.enableVibration(true);
            system.createNotificationChannel(channel);
        }
        if (legacy != null) {
            system.deleteNotificationChannel(LEGACY_CHANNEL);
        }
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        ensureChannel(getContext());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
        } else { notificationPermissionCallback(call); }
    }
    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        ensureChannel(getContext());
        JSObject result = new JSObject();
        result.put("granted", notificationsEnabled(getContext()));
        call.resolve(result);
    }

    /** Notification permission and channel are independent Android controls. */
    static boolean notificationsEnabled(Context context) {
        ensureChannel(context);
        NotificationManagerCompat notifications = NotificationManagerCompat.from(context);
        if (!notifications.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager system = context.getSystemService(NotificationManager.class);
            if (system != null) {
                NotificationChannel channel = system.getNotificationChannel(CHANNEL);
                if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
            }
        }
        return true;
    }

    static boolean isLockscreenNotificationEnabled(Context context) {
        ensureChannel(context);
        try {
            if (Settings.Secure.getInt(context.getContentResolver(), "lock_screen_show_notifications", 1) == 0) {
                return false;
            }
        } catch (Exception ignored) { }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager system = context.getSystemService(NotificationManager.class);
            if (system != null) {
                NotificationChannel channel = system.getNotificationChannel(CHANNEL);
                if (channel != null && channel.getLockscreenVisibility() == Notification.VISIBILITY_SECRET) {
                    return false;
                }
            }
        }
        return true;
    }

    static boolean isIgnoringBatteryOptimizations(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm == null || pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }

    @PluginMethod
    public void getNotificationStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", notificationsEnabled(getContext()));
        result.put("lockscreenVisible", isLockscreenNotificationEnabled(getContext()));
        result.put("ignoringBatteryOptimizations", isIgnoringBatteryOptimizations(getContext()));
        JobScheduler jobs = (JobScheduler) getContext().getSystemService(Context.JOB_SCHEDULER_SERVICE);
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int interval = 60;
        try {
            interval = intervalMinutes(new JSONObject(prefs.getString(CONFIG, "{}")).optInt("intervalMinutes", 60));
        } catch (Exception ignored) { }
        boolean hasPendingJob = jobs != null && (
            jobs.getPendingJob(JOB_ID) != null ||
            jobs.getPendingJob(SHORT_JOB_ID) != null ||
            jobs.getPendingJob(EXPEDITED_JOB_ID) != null ||
            jobs.getPendingJob(IMMEDIATE_JOB_ID) != null
        );
        result.put("scheduled", hasPendingJob || hasActiveAlarm(getContext(), interval) || SourceWatchJobService.isRunning());
        result.put("lastJobAt", prefs.getLong("lastJobAt", 0));
        result.put("lastJobChecked", prefs.getInt("lastJobChecked", 0));
        result.put("lastJobNew", prefs.getInt("lastJobNew", 0));
        result.put("lastJobNotified", prefs.getInt("lastJobNotified", 0));
        result.put("lastJobErrors", prefs.getInt("lastJobErrors", 0));
        call.resolve(result);
    }

    /** A real Android notification that never inserts a fake article in the inbox. */
    @PluginMethod
    public void sendTestNotification(PluginCall call) {
        boolean delivered = post(getContext(), "watch:test", "关注动态 · 测试通知",
            "通知已交给 Android 系统。点击返回关注动态。", "newsnook://watch/inbox");
        JSObject result = new JSObject();
        result.put("delivered", delivered);
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            ensureChannel(getContext());
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) { call.reject("Could not open Android notification settings", error); }
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            Intent intent = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                if (intent.resolveActivity(getContext().getPackageManager()) == null) {
                    intent = null;
                }
            }
            if (intent == null) {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) { call.reject("Could not open Android battery optimization settings", error); }
    }

    @PluginMethod
    public void syncRules(PluginCall call) {
        JSONArray sources = call.getArray("sources");
        if (sources == null) { call.reject("sources required"); return; }
        JSONObject config = new JSONObject();
        try {
            config.put("sources", sources);
            config.put("intervalMinutes", intervalMinutes(call.getInt("intervalMinutes", 60)));
            config.put("quietHours", Boolean.TRUE.equals(call.getBoolean("quietHours", true)));
            config.put("wifiOnly", Boolean.TRUE.equals(call.getBoolean("wifiOnly", false)));
            synchronized (SourceWatchJobService.LOCK) {
                android.content.SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                java.util.HashSet<String> activeIds = new java.util.HashSet<>();
                for (int i = 0; i < sources.length(); i++) {
                    JSONObject source = sources.optJSONObject(i);
                    if (source != null) activeIds.add(source.optString("id"));
                }
                android.content.SharedPreferences.Editor cleanup = prefs.edit();
                for (String key : prefs.getAll().keySet()) {
                    if (key.startsWith("seen:") && !activeIds.contains(key.substring(5))) cleanup.remove(key);
                    if (key.startsWith("etag:") && !activeIds.contains(key.substring(5))) cleanup.remove(key);
                    if (key.startsWith("modified:") && !activeIds.contains(key.substring(9))) cleanup.remove(key);
                    if (key.startsWith("notified:") && !activeIds.contains(key.substring(9))) cleanup.remove(key);
                }
                cleanup.apply();
                // Fold the JS cursor into the native cursor: a feed already seen in the
                // foreground must not notify again when JobScheduler wakes up.
                for (int i = 0; i < sources.length(); i++) {
                    JSONObject source = sources.optJSONObject(i);
                    if (source == null) continue;
                    JSONArray cursor = source.optJSONArray("seen");
                    if (cursor == null || cursor.length() == 0) continue;
                    String key = "seen:" + source.optString("id");
                    JSONArray merged = new JSONArray();
                    java.util.LinkedHashSet<String> dedup = new java.util.LinkedHashSet<>();
                    for (int j = 0; j < cursor.length(); j++) dedup.add(cursor.optString(j));
                    try {
                        JSONArray existing = new JSONArray(prefs.getString(key, "[]"));
                        for (int j = 0; j < existing.length(); j++) dedup.add(existing.optString(j));
                    } catch (Exception ignored) { }
                    for (String url : dedup) { if (merged.length() >= 150) break; merged.put(url); }
                    prefs.edit().putString(key, merged.toString()).apply();
                }
            }
            android.content.SharedPreferences preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            // Cursor sync should not reset the OS's periodic timer on each foreground poll.
            JSONObject scheduleOnly = new JSONObject();
            JSONArray scheduledSources = new JSONArray();
            for (int i = 0; i < sources.length(); i++) {
                JSONObject source = sources.optJSONObject(i);
                if (source == null) continue;
                scheduledSources.put(new JSONObject().put("id", source.optString("id"))
                    .put("url", source.optString("url")).put("mode", source.optString("mode")));
            }
            scheduleOnly.put("sources", scheduledSources)
                .put("intervalMinutes", config.optInt("intervalMinutes"))
                .put("wifiOnly", config.optBoolean("wifiOnly"));
            ensureChannel(getContext());
            int requestedInterval = config.optInt("intervalMinutes");
            String signature = scheduleOnly.toString();
            boolean changed = !signature.equals(preferences.getString("scheduleSignature", null));
            JobScheduler jobs = (JobScheduler) getContext().getSystemService(Context.JOB_SCHEDULER_SERVICE);
            boolean shouldBeScheduled = scheduledSources.length() > 0;
            // Keep short one-off jobs alive even when the other ID is running.
            // Distinguish persisted 15+ minute periodic jobs from 5/10-minute
            // one-shot chains. Rebuild after a crash/update/reboot if either
            // JobScheduler or AlarmManager state is missing.
            JobInfo a = jobs != null ? jobs.getPendingJob(JOB_ID) : null;
            JobInfo b = jobs != null ? jobs.getPendingJob(SHORT_JOB_ID) : null;
            boolean present = a != null || b != null || SourceWatchJobService.isRunning();
            boolean correctMode = usesShortJobs(requestedInterval)
                ? (a != null && !a.isPeriodic()) || (b != null && !b.isPeriodic()) || SourceWatchJobService.isRunning()
                : a != null && a.isPeriodic() && b == null;
            boolean alarmPresent = hasActiveAlarm(getContext(), requestedInterval);
            boolean anyAlarmIntent = buildAlarmPendingIntent(getContext(), PendingIntent.FLAG_NO_CREATE) != null;
            boolean missing = jobs == null || (shouldBeScheduled ? !present || !correctMode || !alarmPresent : present || anyAlarmIntent);
            preferences.edit().putString(CONFIG, config.toString()).apply();
            if (changed) {
                SourceWatchJobService.resetCooldown();
            }
            if (changed || missing) {
                if (!schedule(getContext(), config)) {
                    preferences.edit().remove("scheduleSignature").apply();
                    call.reject("Android did not schedule source monitoring");
                    return;
                }
            }
            preferences.edit().putString("scheduleSignature", signature).apply();
            call.resolve();
        } catch (Exception error) { call.reject("Unable to configure source monitoring", error); }
    }

    static PendingIntent buildAlarmPendingIntent(Context context, int flags) {
        Intent intent = new Intent(context, SourceWatchAlarmReceiver.class)
            .setAction(ACTION_POLL_ALARM);
        int baseFlags = flags;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            baseFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, intent, baseFlags);
    }

    static int currentBootCount(Context context) {
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, 0);
        } catch (Exception ignored) {
            return 0;
        }
    }

    static boolean hasActiveAlarm(Context context, int minutes) {
        if (buildAlarmPendingIntent(context, PendingIntent.FLAG_NO_CREATE) == null) return false;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long nextAt = prefs.getLong(KEY_NEXT_ALARM_AT, 0L);
        if (nextAt <= 0L) return false;
        if (prefs.getInt(KEY_ALARM_BOOT_COUNT, -1) != currentBootCount(context)) return false;
        long now = System.currentTimeMillis();
        long maxFuture = intervalMinutes(minutes) * 60_000L + 60_000L;
        return now - nextAt < ALARM_STALE_GRACE_MS && nextAt - now <= maxFuture;
    }

    static boolean scheduleAlarm(Context context, int minutes) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) return false;
        long delayMs = intervalMinutes(minutes) * 60_000L;
        long triggerAt = System.currentTimeMillis() + delayMs;
        PendingIntent pending = buildAlarmPendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (alarms.canScheduleExactAlarms()) {
                    alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                } else {
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            } else {
                alarms.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putLong(KEY_NEXT_ALARM_AT, triggerAt)
                .putInt(KEY_ALARM_BOOT_COUNT, currentBootCount(context))
                .apply();
            return true;
        } catch (SecurityException error) {
            android.util.Log.w("SourceWatch", "Exact alarm unavailable, falling back to allow-while-idle alarm", error);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                } else {
                    alarms.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
                }
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putLong(KEY_NEXT_ALARM_AT, triggerAt)
                    .putInt(KEY_ALARM_BOOT_COUNT, currentBootCount(context))
                    .apply();
                return true;
            } catch (Exception fallbackError) {
                android.util.Log.w("SourceWatch", "Failed to schedule SourceWatch alarm", fallbackError);
                return false;
            }
        } catch (Exception error) {
            android.util.Log.w("SourceWatch", "Failed to schedule SourceWatch alarm", error);
            return false;
        }
    }

    static void cancelAlarm(Context context) {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent existing = buildAlarmPendingIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (alarms != null && existing != null) {
            alarms.cancel(existing);
            existing.cancel();
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove(KEY_NEXT_ALARM_AT)
            .remove(KEY_ALARM_BOOT_COUNT)
            .apply();
    }

    static JobInfo buildScheduledJob(Context context, JSONObject config, int jobId) {
        int minutes = intervalMinutes(config.optInt("intervalMinutes", 60));
        boolean wifiOnly = config.optBoolean("wifiOnly");
        JobInfo.Builder builder = new JobInfo.Builder(jobId, new ComponentName(context, SourceWatchJobService.class))
            .setPersisted(true)
            .setRequiredNetworkType(wifiOnly ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY);
        if (usesShortJobs(minutes)) {
            // setPeriodic() is capped at 15 minutes by Android. Chain one-off backup jobs,
            // bounded slightly past the interval when cellular/unmetered is unrestricted.
            builder.setMinimumLatency(minutes * 60_000L);
            if (!wifiOnly) {
                builder.setOverrideDeadline((minutes + 3) * 60_000L);
            }
        } else {
            builder.setPeriodic(minutes * 60_000L);
        }
        return builder.build();
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    static JobInfo buildExpeditedJob(Context context, boolean wifiOnly) {
        return new JobInfo.Builder(EXPEDITED_JOB_ID, new ComponentName(context, SourceWatchJobService.class))
            .setRequiredNetworkType(wifiOnly ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY)
            .setExpedited(true)
            .build();
    }

    static JobInfo buildImmediateJob(Context context, boolean wifiOnly) {
        JobInfo.Builder builder = new JobInfo.Builder(IMMEDIATE_JOB_ID, new ComponentName(context, SourceWatchJobService.class))
            .setRequiredNetworkType(wifiOnly ? JobInfo.NETWORK_TYPE_UNMETERED : JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(0L);
        if (!wifiOnly) {
            builder.setOverrideDeadline(15_000L);
        }
        return builder.build();
    }

    static boolean schedule(Context context, JSONObject config) {
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        JSONArray sources = config.optJSONArray("sources");
        if (sources == null || sources.length() == 0) {
            if (jobs != null) {
                jobs.cancel(JOB_ID);
                jobs.cancel(SHORT_JOB_ID);
                jobs.cancel(EXPEDITED_JOB_ID);
                jobs.cancel(IMMEDIATE_JOB_ID);
            }
            cancelAlarm(context);
            return true;
        }
        ensureChannel(context);
        int minutes = intervalMinutes(config.optInt("intervalMinutes", 60));
        boolean alarmOk = scheduleAlarm(context, minutes);
        boolean jobOk = false;
        if (jobs != null) {
            // Schedule the new chain before removing the other ID. A failed
            // schedule must never erase the last successfully persisted job.
            jobOk = jobs.schedule(buildScheduledJob(context, config, JOB_ID)) == JobScheduler.RESULT_SUCCESS;
            if (jobOk) {
                jobs.cancel(SHORT_JOB_ID);
            }
        }
        return alarmOk || jobOk;
    }

    static void rescheduleFromSavedConfig(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject config;
        try {
            config = new JSONObject(prefs.getString(CONFIG, "{}"));
        } catch (Exception ignored) {
            config = new JSONObject();
        }
        schedule(context, config);
    }

    /** Alternate IDs so rescheduling cannot stop the currently running job. */
    static boolean scheduleShortFollowUp(Context context, int finishedId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONObject config;
        try { config = new JSONObject(prefs.getString(CONFIG, "{}")); }
        catch (Exception error) { return false; }
        JSONArray sources = config.optJSONArray("sources");
        int minutes = intervalMinutes(config.optInt("intervalMinutes", 60));
        if (sources == null || sources.length() == 0) return true;
        if (!hasActiveAlarm(context, minutes)) {
            scheduleAlarm(context, minutes);
        }
        if (!usesShortJobs(minutes)) return true;
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (jobs == null) return false;
        int nextId = finishedId == JOB_ID ? SHORT_JOB_ID : JOB_ID;
        return jobs.schedule(buildScheduledJob(context, config, nextId)) == JobScheduler.RESULT_SUCCESS;
    }

    /** Called only for genuinely new, explicitly watched foreground articles. */
    @PluginMethod
    public void notifyNewArticles(PluginCall call) {
        JSONArray groups = call.getArray("sources");
        if (groups == null) { call.reject("sources required"); return; }
        int hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
        JSObject result = new JSObject();
        if (Boolean.TRUE.equals(call.getBoolean("quietHours", false)) && (hour >= 23 || hour < 8)) {
            result.put("delivered", 0);
            call.resolve(result);
            return;
        }
        int delivered = 0;
        for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.optJSONObject(i);
            if (group == null) continue;
            String id = group.optString("id");
            if (id.isEmpty()) continue;
            JSONArray articles = group.optJSONArray("articles");
            if (articles != null && postWatchedUpdates(getContext(), id, group.optString("name", id), articles)) delivered++;
        }
        result.put("delivered", delivered);
        call.resolve(result);
    }

    /** Deduplicate article notifications across foreground scans and JobScheduler. */
    static boolean postWatchedUpdates(Context context, String sourceId, String sourceName, JSONArray articles) {
        if (!notificationsEnabled(context) || articles.length() == 0) return false;
        synchronized (SourceWatchJobService.LOCK) {
            android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String storageKey = "notified:" + sourceId;
            java.util.LinkedHashSet<String> notified = new java.util.LinkedHashSet<>();
            try {
                JSONArray previous = new JSONArray(prefs.getString(storageKey, "[]"));
                for (int i = 0; i < previous.length(); i++) notified.add(previous.optString(i));
            } catch (Exception ignored) { }
            java.util.LinkedHashSet<String> fresh = new java.util.LinkedHashSet<>();
            JSONObject newest = null;
            for (int i = 0; i < articles.length(); i++) {
                JSONObject article = articles.optJSONObject(i);
                if (article == null) continue;
                String key = article.optString("key");
                String link = article.optString("url");
                if (!key.startsWith(sourceId + ":") || key.length() > 2048 ||
                    !(link.startsWith("https://") || link.startsWith("http://")) || notified.contains(key)) continue;
                fresh.add(key);
                newest = article;
            }
            if (newest == null || fresh.isEmpty()) return false;
            String heading = sourceName + (fresh.size() > 1 ? " · " + fresh.size() + " 篇新内容" : " 有更新");
            boolean delivered = post(context, "watch:" + sourceId, heading, newest.optString("title"), newest.optString("url"));
            if (delivered) {
                java.util.LinkedHashSet<String> merged = new java.util.LinkedHashSet<>(fresh);
                merged.addAll(notified);
                JSONArray bounded = new JSONArray();
                for (String key : merged) { if (bounded.length() >= 180) break; bounded.put(key); }
                prefs.edit().putString(storageKey, bounded.toString()).apply();
            }
            return delivered;
        }
    }

    @PluginMethod
    public void drainEvents(PluginCall call) {
        // Events are acknowledged only after JS explicitly consumes them.
        String pending = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("events", "[]");
        try {
            com.getcapacitor.JSObject response = new com.getcapacitor.JSObject();
            response.put("events", new JSONArray(pending));
            call.resolve(response);
        } catch (Exception e) { call.reject("Unable to read updates", e); }
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        JSONArray keys = call.getArray("keys");
        if (keys == null) { call.reject("keys required"); return; }
        synchronized (SourceWatchJobService.LOCK) {
            android.content.SharedPreferences preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray pending;
            try { pending = new JSONArray(preferences.getString("events", "[]")); }
            catch (Exception e) { pending = new JSONArray(); }
            java.util.HashSet<String> taken = new java.util.HashSet<>();
            for (int i = 0; i < keys.length(); i++) taken.add(keys.optString(i));
            JSONArray remainder = new JSONArray();
            for (int i = 0; i < pending.length(); i++) {
                JSONObject item = pending.optJSONObject(i);
                if (item != null && !taken.contains(item.optString("key"))) remainder.put(item);
            }
            preferences.edit().putString("events", remainder.toString()).apply();
        }
        call.resolve();
    }

    static boolean post(Context context, String id, String title, String body, String url) {
        ensureChannel(context);
        NotificationManagerCompat notifications = NotificationManagerCompat.from(context);
        if (!notificationsEnabled(context)) return false;
        // Route directly to the NewsNook article reader instead of opening a browser tab.
        Uri deepLink = "newsnook://watch/inbox".equals(url)
            ? Uri.parse(url)
            : new Uri.Builder().scheme("newsnook").authority("watch")
                .appendQueryParameter("url", url)
                .appendQueryParameter("title", body)
                .appendQueryParameter("source", id.startsWith("watch:") ? id.substring(6) : id)
                .build();
        Intent open = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(deepLink)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(context, id.hashCode(), open, flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_source_watch_notification)
            .setContentTitle(title).setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending).setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL);
        try {
            notifications.notify(0x36000000 | (id.hashCode() & 0x00FFFFFF), builder.build());
            return true;
        } catch (SecurityException ignored) { return false; }
    }
}
