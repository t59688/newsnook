package com.aizeek.newsnook;

import java.util.LinkedHashMap;
import java.util.Map;
import org.json.JSONException;
import org.json.JSONObject;

/** Bounded live-event deduplication that still publishes richer metadata. */
final class LiveMediaObservationGate {
    private final int capacity;
    private final Map<String, String> signatures = new LinkedHashMap<>();

    LiveMediaObservationGate(int capacity) {
        this.capacity = Math.max(1, capacity);
    }

    synchronized JSONObject accept(JSONObject event) {
        if (event == null) return null;
        String identity = identity(event);
        String signature = signature(event);
        String previous = signatures.get(identity);
        if (signature.equals(previous)) return null;
        if (previous == null && signatures.size() >= capacity) return null;
        signatures.put(identity, signature);
        try {
            return new JSONObject(event.toString());
        } catch (JSONException ignored) {
            return null;
        }
    }

    synchronized void clear() {
        signatures.clear();
    }

    synchronized int size() {
        return signatures.size();
    }

    private static String identity(JSONObject event) {
        return join(event,
            "source", "url", "pageUrl", "drmKeySystem", "mediaSessionId", "fromIframe");
    }

    private static String signature(JSONObject event) {
        return join(event,
            "mimeType", "mseMimeType", "mediaKind", "codecs", "width", "height",
            "bitrate", "hasAudio", "hasVideo", "statusCode", "sourceLabel", "quality", "requestHeaders", "bodyText");
    }

    private static String join(JSONObject event, String... names) {
        StringBuilder value = new StringBuilder();
        for (String name : names) {
            value.append(name).append('=').append(event.opt(name)).append('\u0001');
        }
        return value.toString();
    }
}
