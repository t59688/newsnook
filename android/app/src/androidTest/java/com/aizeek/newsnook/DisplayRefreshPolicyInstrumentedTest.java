package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.os.Build;
import android.view.Display;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Real-device regression for the native display vote and the uninitialized
 * WebView frame-rate preference (Float.NaN on API 35+).
 *
 * The explicit per-WebView call avoids asserting during asynchronous Chromium
 * navigation; the App's lifecycle vote is separately checked through on-device
 * logs and measured requestAnimationFrame cadence.
 */
@RunWith(AndroidJUnit4.class)
public class DisplayRefreshPolicyInstrumentedTest {
    @Test public void activityAndBrowserRequestHighestSupportedRate() {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launch);
        try {
            instrumentation.waitForIdleSync();
            WebView capacitor = activity.getBridge().getWebView();
            assertNotNull("Capacitor WebView exists", capacitor);

            instrumentation.runOnMainSync(() -> {
                Display display = Build.VERSION.SDK_INT >= 30
                        ? activity.getDisplay() : activity.getWindowManager().getDefaultDisplay();
                assertNotNull(display);
                float supported = DisplayRefreshPolicy.preferredRate(display);
                float windowRate = activity.getWindow().getAttributes().preferredRefreshRate;
                boolean allowWindowVote = DisplayRefreshPolicy.useWindowPreference(Build.MANUFACTURER, Build.BRAND);
                if (allowWindowVote && supported > 0f) {
                    assertEquals("Standard Android must retain its window + WebView vote",
                            supported, windowRate, 0.2f);
                } else {
                    assertEquals("Xiaomi and 60Hz-only displays retain system-managed modes",
                            0f, windowRate, 0.2f);
                }
                assertTrue("Android 15+ standard Android must keep its window vote",
                        DisplayRefreshPolicy.useWindowPreference("Google", "Pixel"));
                assertTrue("Xiaomi must never emit a Window preference",
                        !DisplayRefreshPolicy.useWindowPreference("Xiaomi", "Xiaomi"));
                assertTrue("Redmi and Poco follow the same OEM policy",
                        !DisplayRefreshPolicy.useWindowPreference("Xiaomi", "POCO"));
                assertTrue("Older non-Xiaomi Android retains compatibility",
                        DisplayRefreshPolicy.useWindowPreference("Google", "Pixel"));

                if (Build.VERSION.SDK_INT >= 35 && supported > 0f) {
                    // The first vote must work for a WebView that still reports
                    // NaN or an unset category. This caught the original bug.
                    DisplayRefreshPolicy.configureWebView(capacitor);
                    assertEquals("Main WebView exact-rate vote", supported,
                            capacitor.getRequestedFrameRate(), 0.2f);
                }

                WebView browser = new WebView(activity);
                try {
                    DisplayRefreshPolicy.configureWebView(browser);
                    if (Build.VERSION.SDK_INT >= 35 && supported > 0f) {
                        assertEquals("Independent browser WebView exact-rate vote",
                                supported, browser.getRequestedFrameRate(), 0.2f);
                    }
                } finally {
                    browser.destroy();
                }

                // Exercise the actual Window policy (not only its predicate)
                // on the same 120Hz AOSP device: a Xiaomi vote must clear an
                // existing beta.8 preference, then standard Android restores it.
                DisplayRefreshPolicy.configureWindow(activity, "Xiaomi", "Xiaomi");
                assertEquals("OEM policy must remove the offending window vote",
                        0f, activity.getWindow().getAttributes().preferredRefreshRate, 0.2f);
                DisplayRefreshPolicy.configureWindow(activity, "Google", "Pixel");
                assertEquals("AOSP must retain the high-rate window preference",
                        supported, activity.getWindow().getAttributes().preferredRefreshRate, 0.2f);
                assertTrue("The policy must not pin a display mode ID",
                        activity.getWindow().getAttributes().preferredDisplayModeId == 0);
            });
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
