package com.aizeek.newsnook;

import android.app.job.JobScheduler;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.PowerManager;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Restores SourceWatch schedules on boot/upgrade and triggers background polls
 * through Doze windows using AlarmManager wakeups plus Expedited/Service handoff.
 */
public class SourceWatchAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            SourceWatchPlugin.ensureChannel(context);
            SourceWatchPlugin.rescheduleFromSavedConfig(context);
            return;
        }
        if (!SourceWatchPlugin.ACTION_POLL_ALARM.equals(action)) return;

        SharedPreferences prefs = context.getSharedPreferences(SourceWatchPlugin.PREFS, Context.MODE_PRIVATE);
        JSONObject config;
        try {
            config = new JSONObject(prefs.getString(SourceWatchPlugin.CONFIG, "{}"));
        } catch (Exception ignored) {
            config = new JSONObject();
        }
        JSONArray sources = config.optJSONArray("sources");
        if (sources == null || sources.length() == 0) {
            SourceWatchPlugin.schedule(context, config);
            return;
        }

        int minutes = SourceWatchPlugin.intervalMinutes(config.optInt("intervalMinutes", 60));
        SourceWatchPlugin.scheduleAlarm(context, minutes);

        boolean wifiOnly = config.optBoolean("wifiOnly", false);
        boolean networkAllowed = SourceWatchJobService.isNetworkAllowed(context, wifiOnly);
        if (networkAllowed && canStartBackgroundCheckService(context)) {
            try {
                context.startService(new Intent(context, SourceWatchCheckService.class));
                return;
            } catch (RuntimeException error) {
                android.util.Log.w("SourceWatch", "Background check service unavailable, falling back to JobScheduler", error);
            }
        }

        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (jobs == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (jobs.schedule(SourceWatchPlugin.buildExpeditedJob(context, wifiOnly)) == JobScheduler.RESULT_SUCCESS) {
                return;
            }
        }
        jobs.schedule(SourceWatchPlugin.buildImmediateJob(context, wifiOnly));
    }

    private static boolean canStartBackgroundCheckService(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            return pm == null || !pm.isDeviceIdleMode() || SourceWatchPlugin.isIgnoringBatteryOptimizations(context);
        }
        return SourceWatchPlugin.isIgnoringBatteryOptimizations(context);
    }
}
