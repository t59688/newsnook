package com.aizeek.newsnook;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.provider.Settings;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 全屏视频手势需要的两项系统能力：窗口亮度与媒体音量。
 *
 * 亮度只改当前窗口（WindowManager.LayoutParams.screenBrightness），不写系统设置，
 * 因此不需要 WRITE_SETTINGS 权限，退出全屏时恢复跟随系统即可。
 */
@CapacitorPlugin(name = "DeviceMediaControls")
public class DeviceMediaControlsPlugin extends Plugin {

    private static final float BRIGHTNESS_FOLLOW_SYSTEM = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
    /** Settings.System.SCREEN_BRIGHTNESS 的常规量程，仅用于给出初始基准值。 */
    private static final float SYSTEM_BRIGHTNESS_SCALE = 255f;
    private Integer orientationBeforeVideo;

    @PluginMethod
    public void getBrightness(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 不可用");
            return;
        }

        float current = activity.getWindow().getAttributes().screenBrightness;
        call.resolve(level(current >= 0 ? current : systemBrightness()));
    }

    @PluginMethod
    public void setBrightness(PluginCall call) {
        Double requested = call.getDouble("value");
        if (requested == null) {
            call.reject("缺少亮度值");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity 不可用");
            return;
        }

        final float target = clamp01(requested.floatValue());
        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            params.screenBrightness = target;
            window.setAttributes(params);
            call.resolve(level(target));
        });
    }

    @PluginMethod
    public void clearBrightness(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }

        activity.runOnUiThread(() -> {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            params.screenBrightness = BRIGHTNESS_FOLLOW_SYSTEM;
            window.setAttributes(params);
            call.resolve();
        });
    }

    /**
     * Sticky ACTION_BATTERY_CHANGED — no runtime permission required.
     * level is 0–1 to match the Web Battery Status API.
     */
    @PluginMethod
    public void getBattery(PluginCall call) {
        Context context = getContext();
        if (context == null) {
            call.reject("Context 不可用");
            return;
        }

        Intent status = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (status == null) {
            call.reject("无法读取电池状态");
            return;
        }

        int rawLevel = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int batteryStatus = status.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN);
        boolean charging =
            batteryStatus == BatteryManager.BATTERY_STATUS_CHARGING
                || batteryStatus == BatteryManager.BATTERY_STATUS_FULL;

        float ratio = (rawLevel >= 0 && scale > 0) ? clamp01(rawLevel / (float) scale) : 0f;
        JSObject result = new JSObject();
        result.put("level", ratio);
        result.put("charging", charging);
        call.resolve(result);
    }

    @PluginMethod
    public void getVolume(PluginCall call) {
        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("音频服务不可用");
            return;
        }

        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (max <= 0) {
            call.resolve(level(0f));
            return;
        }
        call.resolve(level((float) audio.getStreamVolume(AudioManager.STREAM_MUSIC) / max));
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double requested = call.getDouble("value");
        if (requested == null) {
            call.reject("缺少音量值");
            return;
        }

        AudioManager audio = audioManager();
        if (audio == null) {
            call.reject("音频服务不可用");
            return;
        }

        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        if (max <= 0) {
            call.resolve(level(0f));
            return;
        }

        int steps = Math.round(clamp01(requested.floatValue()) * max);
        try {
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, steps, 0);
        } catch (SecurityException error) {
            // 勿扰模式下系统会拒绝改音量，返回当前真实值让 UI 保持诚实
            call.resolve(level((float) audio.getStreamVolume(AudioManager.STREAM_MUSIC) / max));
            return;
        }
        call.resolve(level((float) audio.getStreamVolume(AudioManager.STREAM_MUSIC) / max));
    }

    /**
     * Authoritative fullscreen bridge for the custom video player.
     *
     * This intentionally lives on a Capacitor plugin instead of relying on a raw
     * addJavascriptInterface object. The same plugin already owns video orientation,
     * brightness and volume, so a successful call proves that the request reached
     * the native Activity before the Web layer promotes the player to fullscreen.
     */
    @PluginMethod
    public void setVideoFullscreen(PluginCall call) {
        Boolean active = call.getBoolean("active");
        if (active == null) {
            call.reject("Missing active state");
            return;
        }

        Activity activity = getActivity();
        if (!(activity instanceof MainActivity)) {
            call.reject("MainActivity unavailable");
            return;
        }

        activity.runOnUiThread(() -> {
            ((MainActivity) activity).setVideoFullscreen(active);
            call.resolve();
        });
    }

    @PluginMethod
    public void lockOrientation(PluginCall call) {
        String orientation = call.getString("orientation");
        final int requestedOrientation;
        if ("landscape".equals(orientation)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else if ("portrait".equals(orientation)) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else if ("sensor".equals(orientation)) {
            // 跟随设备：横竖屏都放开，由传感器决定（覆盖系统自动旋转开关）
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR;
        } else {
            call.reject("Unsupported orientation");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity unavailable");
            return;
        }

        activity.runOnUiThread(() -> {
            if (orientationBeforeVideo == null) {
                orientationBeforeVideo = activity.getRequestedOrientation();
            }
            activity.setRequestedOrientation(requestedOrientation);
            call.resolve();
        });
    }

    @PluginMethod
    public void unlockOrientation(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            orientationBeforeVideo = null;
            call.resolve();
            return;
        }

        activity.runOnUiThread(() -> {
            int restore = orientationBeforeVideo == null
                ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                : orientationBeforeVideo;
            orientationBeforeVideo = null;
            activity.setRequestedOrientation(restore);
            call.resolve();
        });
    }

    private AudioManager audioManager() {
        Context context = getContext();
        return context == null ? null : (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
    }

    private float systemBrightness() {
        Context context = getContext();
        if (context == null) return 1f;
        try {
            int raw = Settings.System.getInt(
                context.getContentResolver(),
                Settings.System.SCREEN_BRIGHTNESS
            );
            return clamp01(raw / SYSTEM_BRIGHTNESS_SCALE);
        } catch (Settings.SettingNotFoundException error) {
            return 1f;
        }
    }

    private static JSObject level(float value) {
        JSObject result = new JSObject();
        result.put("value", clamp01(value));
        return result;
    }

    private static float clamp01(float value) {
        if (Float.isNaN(value)) return 0f;
        return Math.max(0f, Math.min(1f, value));
    }
}
