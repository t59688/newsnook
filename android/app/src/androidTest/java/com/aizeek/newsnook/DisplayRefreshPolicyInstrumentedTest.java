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
                if (supported > 0f) {
                    assertEquals("The window must request the highest same-resolution mode",
                            supported, windowRate, 0.2f);
                } else {
                    assertEquals("60Hz-only screens keep the automatic window policy",
                            0f, windowRate, 0.2f);
                }

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

                assertTrue("The policy must not pin a display mode ID",
                        activity.getWindow().getAttributes().preferredDisplayModeId == 0);
            });
        } finally {
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
