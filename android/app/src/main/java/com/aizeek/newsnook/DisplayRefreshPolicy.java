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

/**
 * App-wide frame rate preference for both the Capacitor UI and native browser WebViews.
 *
 * Android 15+ defaults many animated Views to the NORMAL (~60Hz) category.
 * A HIGH category vote can still be mapped to only 90Hz on a 120Hz display,
 * so prefer the exact device-supported maximum instead of a category hint.
 *
 * A window vote and a WebView vote complement each other. A WebView-only
 * vote cannot reliably change the display's actual render rate, so never
 * suppress the window vote solely because of the device manufacturer.
 *
 * Both requests are preferences, not fixed-mode locks. The system and OEM
 * scheduler retain the final decision; never modify global display settings.
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

    static void configureWindow(Activity activity) {
        if (activity == null) return;
        Window window = activity.getWindow();
        if (window == null) return;
        WindowManager.LayoutParams params = window.getAttributes();
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
