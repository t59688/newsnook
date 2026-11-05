package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import androidx.webkit.WebViewFeature;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.LooperMode;

/** Keep Chromium injection out of the JVM while exercising the real observer lifecycle. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, shadows = BrowserMediaCaptureLifecycleTest.NoDocumentStart.class,
    instrumentedPackages = "androidx.webkit")
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserMediaCaptureLifecycleTest {
    @Implements(value = WebViewFeature.class, isInAndroidSdk = false)
    public static class NoDocumentStart {
        @Implementation public static boolean isFeatureSupported(String feature) { return false; }
    }

    private static final class DeferredWebView extends WebView {
        ValueCallback<String> pending;
        int reads;
        DeferredWebView(Context context) { super(context); }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (callback != null) { pending = callback; reads++; }
        }
    }

    private static String probeResult(String pageUrl, String... mediaUrls) throws Exception {
        JSONArray events = new JSONArray();
        for (String url : mediaUrls) {
            events.put(new JSONObject().put("source", "dom").put("url", url)
                .put("pageUrl", pageUrl).put("mimeType", "video/mp4").put("mediaKind", "video"));
        }
        return JSONObject.quote(new JSONObject().put("url", pageUrl).put("events", events).toString());
    }

    @Test public void mediaProbeResultArrivingAfterHideCannotPublishAPageChange() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<String> pages = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, "https://example.com/", ignored -> {},
            (url, reset) -> pages.add(url));
        try {
            capture.setActive(true);
            pages.clear();
            capture.pollNow();
            assertNotNull(view.pending);
            capture.setActive(false);
            view.pending.onReceiveValue(probeResult("https://example.com/late"));
            assertTrue("an in-flight automatic observation must not mutate the hidden browser session", pages.isEmpty());
        } finally {
            capture.close();
            view.destroy();
        }
    }

    @Test public void mediaProbeResultArrivingAfterCloseCannotPublishAnything() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<String> pages = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, "https://example.com/", ignored -> {},
            (url, reset) -> pages.add(url));
        capture.setActive(true);
        pages.clear();
        capture.pollNow();
        capture.close();
        view.pending.onReceiveValue(probeResult("https://example.com/late"));
        assertTrue(pages.isEmpty());
        view.destroy();
    }

    @Test public void explicitHiddenScansKeepDiscoveriesWithoutResumingAutomaticPolling() throws Exception {
        String pageUrl = "https://example.com/watch";
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<JSONObject> observations = new ArrayList<>();
        List<Boolean> resets = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, pageUrl, observations::add,
            (url, reset) -> resets.add(reset));
        try {
            capture.setActive(true);
            capture.setActive(false);
            resets.clear();
            capture.scanNow();
            assertEquals(1, view.reads);
            view.pending.onReceiveValue(probeResult(pageUrl, "https://media.example.com/a.mp4"));
            assertEquals(1, observations.size());
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(5, TimeUnit.SECONDS);
            capture.pollNow();
            assertEquals("an explicit scan must not resume the hidden tab's automatic loop", 1, view.reads);
            capture.scanNow();
            assertEquals(2, view.reads);
            view.pending.onReceiveValue(probeResult(pageUrl, "https://media.example.com/a.mp4", "https://media.example.com/b.mp4"));
            assertEquals("later scans add discoveries without clearing or repeating existing resources", 2, observations.size());
            assertTrue("scanning an unchanged page must not reset its media state", resets.isEmpty());
        } finally {
            capture.close();
            view.destroy();
        }
    }

    @Test public void explicitScanCannotPublishIntoANewDocumentAtTheSameUrl() throws Exception {
        String pageUrl = "https://example.com/watch";
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<JSONObject> observations = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, pageUrl, observations::add, (url, reset) -> {});
        try {
            capture.scanNow();
            ValueCallback<String> retired = view.pending;
            capture.onPageStarted(pageUrl);
            retired.onReceiveValue(probeResult(pageUrl, "https://media.example.com/clip.mp4?signature=old"));
            assertTrue("the page identity guard must also reject same-URL reload races", observations.isEmpty());
            capture.scanNow();
            view.pending.onReceiveValue(probeResult(pageUrl, "https://media.example.com/clip.mp4?signature=new"));
            assertEquals(1, observations.size());
            assertEquals("https://media.example.com/clip.mp4?signature=new", observations.get(0).getString("url"));
        } finally {
            capture.close();
            view.destroy();
        }
    }

    @Test public void explicitScanCannotPublishAfterCloseOrStartAgain() throws Exception {
        String pageUrl = "https://example.com/watch";
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<JSONObject> observations = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, pageUrl, observations::add, (url, reset) -> {});
        try {
            capture.scanNow();
            ValueCallback<String> retired = view.pending;
            capture.close();
            retired.onReceiveValue(probeResult(pageUrl, "https://media.example.com/late.mp4"));
            capture.scanNow();
            assertEquals(1, view.reads);
            assertTrue(observations.isEmpty());
        } finally {
            capture.close();
            view.destroy();
        }
    }
    @Test public void lateMetadataUpdatesPublishWithoutRepeatingUnchangedSnapshots() throws Exception {
        String pageUrl = "https://example.com/watch";
        String url = "https://media.example.com/clip.mp4?signature=keep";
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        List<JSONObject> observations = new ArrayList<>();
        BrowserMediaCapture capture = new BrowserMediaCapture(view, pageUrl, observations::add, (page, reset) -> {});
        try {
            capture.scanNow();
            view.pending.onReceiveValue(probeResult(pageUrl, url));
            JSONObject rich = new JSONObject().put("source", "dom").put("url", url).put("pageUrl", pageUrl)
                .put("mimeType", "video/mp4").put("title", "Actual video").put("titleSource", "player").put("height", 1080);
            String response = JSONObject.quote(new JSONObject().put("url", pageUrl).put("events", new JSONArray().put(rich)).toString());
            capture.scanNow(); view.pending.onReceiveValue(response);
            assertEquals(2, observations.size());
            assertEquals("Actual video", observations.get(1).getString("title"));
            assertEquals(url, observations.get(1).getString("url"));
            capture.scanNow(); view.pending.onReceiveValue(response);
            assertEquals(2, observations.size());
        } finally { capture.close(); view.destroy(); }
    }

}
