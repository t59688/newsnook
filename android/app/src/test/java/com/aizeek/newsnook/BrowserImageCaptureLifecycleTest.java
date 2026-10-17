package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserImageCaptureLifecycleTest {
    private static final String PAGE = "https://news.example/article?session=page";
    private static final class DeferredWebView extends WebView {
        ValueCallback<String> pending;
        String script = "";
        int reads;
        DeferredWebView(Context context) { super(context); }
        @Override public void evaluateJavascript(String source, ValueCallback<String> callback) {
            script = source;
            if (callback != null) { pending = callback; reads++; }
        }
    }

    private static String scanResult(String script, String pageUrl, String imageUrl) throws Exception {
        Matcher match = Pattern.compile("var scanId = \"([^\"]+)\"").matcher(script);
        assertTrue("scanner injects a fresh opaque scan generation", match.find());
        JSONArray images = new JSONArray();
        if (imageUrl != null) images.put(new JSONObject()
            .put("id", match.group(1) + "-0").put("sourceUrl", imageUrl).put("pageUrl", pageUrl)
            .put("alt", "fixture").put("width", 800).put("height", 600).put("content", true)
            .put("transport", "http").put("kinds", new JSONArray().put("img")));
        return JSONObject.quote(new JSONObject().put("pageUrl", pageUrl).put("items", images)
            .put("truncated", false).put("inaccessibleFrames", 0).toString());
    }

    @Test public void manualScanDoesNotInstallPageClickHooksOrStartAutomaticPolling() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 7, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            assertEquals(0, view.reads);
            capture.scan("first", results::add, errors::add);
            assertEquals(1, view.reads);
            assertFalse(view.script.contains("addEventListener"));
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/image.jpg?signature=kept"));
            assertEquals(1, results.size());
            JSONObject payload = results.get(0);
            assertEquals(7, payload.getInt("tabId"));
            assertFalse(payload.getString("documentId").isEmpty());
            assertEquals("first", payload.getString("requestId"));
            JSONObject image = payload.getJSONArray("items").getJSONObject(0);
            assertEquals("https://cdn.example/image.jpg?signature=kept", image.getString("sourceUrl"));
            assertEquals("https://news.example/", image.getJSONObject("requestHeaders").getString("Referer"));
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(10, TimeUnit.SECONDS);
            assertEquals("one user action causes exactly one metadata scan", 1, view.reads);
            assertTrue(errors.isEmpty());
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void sameUrlReloadRejectsRetiredScanAndCreatesANewDocumentGeneration() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 7, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            capture.scan("before", results::add, errors::add);
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/one.jpg"));
            String originalDocument = results.get(0).getString("documentId");
            capture.scan("pending-old", results::add, errors::add);
            ValueCallback<String> retired = view.pending;
            String retiredScript = view.script;
            capture.onPageStarted(PAGE);
            retired.onReceiveValue(scanResult(retiredScript, PAGE, "https://cdn.example/stale.jpg"));
            assertEquals(1, results.size());
            assertEquals("图片读取已取消", errors.get(0));
            capture.scan("after", results::add, errors::add);
            view.pending.onReceiveValue(scanResult(view.script, PAGE, "https://cdn.example/new.jpg"));
            assertEquals(2, results.size());
            assertNotEquals(originalDocument, results.get(1).getString("documentId"));
            List<String> imageErrors = new ArrayList<>();
            capture.load(originalDocument, "stale-load", "old-image", false, false, results::add, imageErrors::add);
            assertEquals("网页已变化，请重新扫描", imageErrors.get(0));
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void timeoutAndRendererGoneAlwaysSettleAndIgnoreLateScanCallbacks() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 2, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        capture.scan("slow", results::add, errors::add);
        ValueCallback<String> slow = view.pending;
        String slowScript = view.script;
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(7, TimeUnit.SECONDS);
        assertEquals(1, errors.size());
        assertTrue(errors.get(0).contains("超时"));
        slow.onReceiveValue(scanResult(slowScript, PAGE, "https://cdn.example/late.jpg"));
        assertTrue(results.isEmpty());
        capture.scan("closing", results::add, errors::add);
        ValueCallback<String> closing = view.pending;
        String closingScript = view.script;
        int reads = view.reads;
        capture.close(false);
        closing.onReceiveValue(scanResult(closingScript, PAGE, "https://cdn.example/closed.jpg"));
        capture.scan("after-close", results::add, errors::add);
        assertEquals(reads, view.reads);
        assertTrue(results.isEmpty());
        assertTrue(errors.contains("图片读取已取消"));
        assertTrue(errors.contains("网页已关闭"));
        view.destroy();
    }

    @Test public void explicitCancellationMatchesRequestAndDocumentIdentity() throws Exception {
        DeferredWebView view = new DeferredWebView(RuntimeEnvironment.getApplication());
        BrowserImageCapture capture = new BrowserImageCapture(view, 2, PAGE);
        List<JSONObject> results = new ArrayList<>();
        List<String> errors = new ArrayList<>();
        try {
            capture.scan("keep", results::add, errors::add);
            capture.cancel("other-document", null);
            capture.cancel(null, "other-request");
            assertTrue(errors.isEmpty());
            view.pending.onReceiveValue(scanResult(view.script, PAGE, null));
            assertEquals(1, results.size());
            capture.scan("cancel", results::add, errors::add);
            ValueCallback<String> retired = view.pending;
            String retiredScript = view.script;
            capture.cancel(results.get(0).getString("documentId"), "cancel");
            retired.onReceiveValue(scanResult(retiredScript, PAGE, "https://cdn.example/late.jpg"));
            assertEquals(1, results.size());
            assertEquals(1, errors.size());
        } finally { capture.close(); view.destroy(); }
    }

    @Test public void redirectHeadersKeepObservedContextButNeverLeakAuthorizationAcrossOrigins() {
        Map<String, String> captured = new LinkedHashMap<>();
        captured.put("referer", PAGE);
        captured.put("user-agent", "Original Tab UA");
        captured.put("authorization", "Bearer fixture");
        Map<String, String> initial = BrowserImageCapture.headersFor("https://cdn.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, captured, "Fallback UA", "cdnCookie=one");
        assertEquals(PAGE, initial.get("referer"));
        assertEquals("Original Tab UA", initial.get("user-agent"));
        assertEquals("Bearer fixture", initial.get("authorization"));
        assertEquals("cdnCookie=one", initial.get("Cookie"));
        Map<String, String> redirected = BrowserImageCapture.headersFor("https://other.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, captured, "Fallback UA", "targetCookie=two");
        assertFalse(redirected.containsKey("authorization"));
        assertEquals("targetCookie=two", redirected.get("Cookie"));
        assertEquals("https://news.example/", redirected.get("Referer"));
        assertFalse(redirected.values().contains(PAGE));
        Map<String, String> noReferrer = BrowserImageCapture.headersFor("https://cdn.example/image.jpg",
            "https://cdn.example/image.jpg", PAGE, new LinkedHashMap<>(), "Tab UA", null);
        assertFalse("an observed no-referrer image remains no-referrer", noReferrer.containsKey("Referer"));
    }

    @Test public void boundedReaderRejectsAnOversizedStreamBeforeReturningBytes() throws Exception {
        assertArrayEquals(new byte[] {1, 2, 3}, BrowserImageCapture.readBounded(new ByteArrayInputStream(new byte[] {1, 2, 3}), 3));
        try {
            BrowserImageCapture.readBounded(new ByteArrayInputStream(new byte[4]), 3);
            fail("overflow must reject");
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("超过")); }
    }
}
