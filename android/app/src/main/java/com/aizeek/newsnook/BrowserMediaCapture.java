package com.aizeek.newsnook;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * A passive, bounded observer attached to the actual browser tab WebView.
 * No duplicated page, no automatic click, no media playback, no WebView bridge.
 * Media classification and JS probe are shared with MediaSnifferPlugin.
 */
final class BrowserMediaCapture {
    private static final int MAX_OBSERVATIONS = 320;
    private static final long POLL_INTERVAL_MS = 1400L;
    private static final String READ_PROBE =
        "(function(){try{return JSON.stringify({url:location.href,events:" +
        "(window.__newsnookCollectMedia?window.__newsnookCollectMedia():[])});" +
        "}catch(e){return ''}})()";

    private static final class Page {
        final JSONArray networkEvents = new JSONArray();
        final Set<String> seen = new HashSet<>();
        final MediaSnifferPlugin.LiveProbeQueue probes;
        String url;
        int emitted;
        Page(String url, MediaSnifferPlugin.LiveProbeQueue probes) {
            this.url = url;
            this.probes = probes;
        }
    }

    private final WebView webView;
    private final Consumer<JSONObject> onObservation;
    private final Consumer<String> onPage;
    private final String nonce = UUID.randomUUID().toString();
    private final String script = MediaSnifferPlugin.buildProbeScript(nonce, true);
    private final ScriptHandler scriptHandler;
    private volatile Page page;
    private boolean closed;
    private boolean active;
    private boolean pollScheduled;

    BrowserMediaCapture(WebView view, String initialUrl, Consumer<JSONObject> observation, Consumer<String> reset) {
        webView = view;
        onObservation = observation;
        onPage = reset;
        page = makePage(initialUrl);
        scriptHandler = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            ? WebViewCompat.addDocumentStartJavaScript(view, script, Collections.singleton("*"))
            : null;
    }

    private Page makePage(String url) {
        final Page[] holder = new Page[1];
        MediaSnifferPlugin.LiveProbeQueue queue = new MediaSnifferPlugin.LiveProbeQueue(
            MediaSnifferPlugin.createProbeClient(webView.getSettings().getUserAgentString()),
            new java.util.concurrent.atomic.AtomicLong(0),
            observation -> {
                Page current = holder[0];
                if (current != null) dispatch(current, observation);
            }
        );
        Page next = new Page(url, queue);
        holder[0] = next;
        return next;
    }

    void onPageStarted(String url) {
        if (closed) return;
        Page previous = page;
        page = makePage(url);
        onPage.accept(url);
        closeProbes(previous);
        if (scriptHandler == null && url.startsWith("http")) webView.evaluateJavascript(script, null);
        schedulePoll(500);
    }

    void onPageFinished() {
        if (closed) return;
        if (scriptHandler == null) webView.evaluateJavascript(script, null);
        pollNow();
    }

    WebResourceResponse onRequest(WebResourceRequest request) {
        Page current = page;
        if (closed || current == null) return null;
        String url = current.url;
        if (url == null || (!url.startsWith("http:") && !url.startsWith("https:"))) return null;
        JSONObject observation = MediaSnifferPlugin.browserNetworkObservation(current.networkEvents, url, request);
        if (observation != null) {
            if (MediaSnifferPlugin.isImmediatelyPlayable(observation)) dispatch(current, observation);
            else current.probes.offer(observation);
        }
        // Always allow the WebView to fetch the original resource itself.
        return null;
    }

    void setActive(boolean value) {
        if (closed) return;
        active = value;
        if (active) {
            Page current = page;
            if (current != null) onPage.accept(current.url);
            schedulePoll(150);
        }
    }

    void pollNow() {
        Page current = page;
        if (closed || !active || current == null) return;
        webView.evaluateJavascript(READ_PROBE, result -> {
            if (closed || page != current || result == null) return;
            try {
                Object decoded = new JSONTokener(result).nextValue();
                if (!(decoded instanceof String)) return;
                JSONObject payload = new JSONObject((String) decoded);
                String liveUrl = payload.optString("url", current.url);
                if (!liveUrl.equals(current.url) && liveUrl.startsWith("http")) {
                    current.url = liveUrl;
                    current.seen.clear();
                    current.emitted = 0;
                    onPage.accept(liveUrl);
                }
                JSONArray jsEvents = payload.optJSONArray("events");
                JSONArray trusted = MediaSnifferPlugin.browserPageObservations(
                    current.networkEvents, JSONObject.quote(jsEvents == null ? "[]" : jsEvents.toString()), nonce);
                for (int i = 0; i < trusted.length() && current.emitted < MAX_OBSERVATIONS; i++) {
                    JSONObject observation = trusted.optJSONObject(i);
                    if (observation == null) continue;
                    if ("network".equals(observation.optString("source"))
                        && !MediaSnifferPlugin.isImmediatelyPlayable(observation)) continue;
                    String originPage = observation.optString("pageUrl", "");
                    if (!originPage.equals(liveUrl) && !observation.optBoolean("fromIframe", false)) continue;
                    publish(current, observation);
                }
            } catch (Exception ignored) {
                // Content sites can override JS objects; network discovery still works.
            }
        });
    }

    private void dispatch(Page window, JSONObject observation) {
        if (closed) return;
        webView.post(() -> {
            if (closed || page != window) return;
            publish(window, observation);
        });
    }

    private void publish(Page window, JSONObject observation) {
        if (closed || window != page || window.emitted >= MAX_OBSERVATIONS) return;
        String key = observation.optString("source") + "\u0001" + observation.optString("url")
            + "\u0001" + observation.optString("mimeType") + "\u0001"
            + observation.optString("mseMimeType") + "\u0001"
            + observation.optString("pageUrl") + "\u0001" + observation.optString("drmKeySystem");
        if (!window.seen.add(key)) return;
        window.emitted++;
        onObservation.accept(observation);
    }

    private void schedulePoll(long delay) {
        if (pollScheduled || !active || closed) return;
        pollScheduled = true;
        webView.postDelayed(() -> {
            pollScheduled = false;
            if (!active || closed) return;
            pollNow();
            schedulePoll(POLL_INTERVAL_MS);
        }, delay);
    }

    private static void closeProbes(Page previous) {
        if (previous == null) return;
        new Thread(previous.probes::closeAndAwait, "NewsNookBrowserProbeClose").start();
    }

    void close() {
        if (closed) return;
        closed = true;
        active = false;
        if (scriptHandler != null) scriptHandler.remove();
        closeProbes(page);
        page = null;
    }
}
