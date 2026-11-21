package com.aizeek.newsnook;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Build;
import android.util.Log;
import android.view.Display;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import java.util.Locale;

/**
 * App-wide frame rate preference for both the Capacitor UI and native browser WebViews.
 *
 * Android 15+ defaults many animated Views to the NORMAL (~60Hz) category.
 * A HIGH category vote can still be mapped to only 90Hz on a 120Hz display,
 * so prefer the exact device-supported maximum instead of a category hint.
 *
 * A window vote and a WebView vote complement each other on standard Android;
 * a WebView-only vote does NOT reliably change SurfaceFlinger's render rate.
 * HyperOS has a separate OEM per-app policy: setting preferredRefreshRate on
 * Xiaomi-family devices can mark the app as controlling its own rate and leave
 * the OEM policy at 60Hz. On those devices, delegate the Window mode to the
 * OS instead of reinforcing its 60Hz classification.
 *
 * Never change global display settings. Battery and per-app display policy
 * are ultimately controlled by the OS.
 */
final class DisplayRefreshPolicy {
    private static final String TAG = "NewsNookRefresh";
    private static final float HIGH_REFRESH_THRESHOLD_HZ = 60.5f;
    private static final float RATE_TOLERANCE_HZ = 0.1f;

    private DisplayRefreshPolicy() {}

    static float preferredRate(Display display) {
        if (display == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return 0f;
        Display.Mode currentMode = display.getMode();
        if (currentMode == null) return 0f;
        float highest = 0f;
        for (Display.Mode mode : display.getSupportedModes()) {
            if (mode.getPhysicalWidth() == currentMode.getPhysicalWidth()
                    && mode.getPhysicalHeight() == currentMode.getPhysicalHeight()) {
                highest = Math.max(highest, mode.getRefreshRate());
            }
        }
        // A 60Hz-only screen should keep Android's automatic policy.
        return highest > HIGH_REFRESH_THRESHOLD_HZ ? highest : 0f;
    }

    static boolean useWindowPreference(String manufacturer, String brand) {
        // Preserve the window vote on AOSP/Pixel and other standard devices:
        // a 120Hz Android 37 emulator stays at 60Hz with WebView votes alone.
        // HyperOS is known to impose its own max=60 vote when the app declares
        // preferredRefreshRate, so omit the window vote on that OEM family.
        return !isXiaomiFamily(manufacturer, brand);
    }

    private static boolean isXiaomiFamily(String manufacturer, String brand) {
        String maker = manufacturer == null ? "" : manufacturer.toLowerCase(Locale.ROOT);
        String name = brand == null ? "" : brand.toLowerCase(Locale.ROOT);
        return maker.contains("xiaomi") || name.contains("xiaomi")
                || name.contains("redmi") || name.contains("poco");
    }

    static void configureWindow(Activity activity) {
        configureWindow(activity, Build.MANUFACTURER, Build.BRAND);
    }

    // Package-private parameterized entrypoint permits a Xiaomi policy regression
    // test on an AOSP emulator without spoofing any global device properties.
    static void configureWindow(Activity activity, String manufacturer, String brand) {
        if (activity == null) return;
        Window window = activity.getWindow();
        if (window == null) return;
        WindowManager.LayoutParams params = window.getAttributes();
        if (!useWindowPreference(manufacturer, brand)) {
            // Undo beta.8's window-level vote on Xiaomi/HyperOS (including
            // after a retained Activity resumes). The OEM owns its mode.
            if (params.preferredRefreshRate != 0f) {
                params.preferredRefreshRate = 0f;
                window.setAttributes(params);
            }
            return;
        }
        Display display = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? activity.getDisplay() : activity.getWindowManager().getDefaultDisplay();
        float requested = preferredRate(display);
        if (requested <= 0f || params.preferredDisplayModeId != 0) return;
        if (Math.abs(params.preferredRefreshRate - requested) < RATE_TOLERANCE_HZ) return;
        params.preferredRefreshRate = requested;
        window.setAttributes(params);
        if (BuildConfig.DEBUG) Log.i(TAG, "window preference=" + requested + "Hz");
    }

    static void configureWebView(WebView view) {
        if (view == null || Build.VERSION.SDK_INT < 35) return;
        Context context = view.getContext();
        while (!(context instanceof Activity) && context instanceof ContextWrapper) {
            context = ((ContextWrapper) context).getBaseContext();
        }
        if (!(context instanceof Activity)) return;
        Activity activity = (Activity) context;
        // An individual ViewGroup's vote does not automatically reach its
        // children. Apply this to each visible WebView, not only the decor.
        Display display = activity.getDisplay();
        float requested = preferredRate(display);
        if (requested <= 0f) return;
        // An unattached View often reports Float.NaN, not a numeric default.
        // NaN makes an ordinary difference comparison false and silently skips
        // the very first frame-rate vote, leaving scrolling at ~60Hz.
        float current = view.getRequestedFrameRate();
        if (Float.isNaN(current) || Math.abs(current - requested) > RATE_TOLERANCE_HZ) {
            view.setRequestedFrameRate(requested);
            if (BuildConfig.DEBUG) Log.i(TAG, "WebView preference=" + requested + "Hz");
        }
    }
}
