package com.aizeek.newsnook;

import android.net.Uri;
import android.webkit.CookieManager;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Per-origin request headers captured during sniff. Playback reads by exact origin
 * (scheme+host+port, default ports omitted) and never copies Range.
 */
final class OriginHeaderStore {

    private static final long TTL_MS = 10 * 60 * 1000L;
    private static final Set<String> STORED_HEADERS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "accept",
            "accept-language",
            "authorization",
            "cookie",
            "origin",
            "referer",
            "user-agent"
        ))
    );
    private static final ConcurrentHashMap<String, OriginHeaders> STORE = new ConcurrentHashMap<>();

    interface CookieSource {
        String cookieFor(String url);
    }

    private static final class OriginHeaders {
        final Map<String, String> headers;
        final long expiresAt;

        OriginHeaders(Map<String, String> headers, long expiresAt) {
            this.headers = Collections.unmodifiableMap(new HashMap<>(headers));
            this.expiresAt = expiresAt;
        }
    }

    static void note(String url, Map<String, String> requestHeaders) {
        String origin = originOf(url);
        if (origin == null || requestHeaders == null || requestHeaders.isEmpty()) return;
        Map<String, String> captured = filterStored(requestHeaders);
        if (captured.isEmpty()) return;
        long expiresAt = System.currentTimeMillis() + TTL_MS;
        STORE.merge(origin, new OriginHeaders(captured, expiresAt), (existing, incoming) -> {
            Map<String, String> merged = new HashMap<>(existing.headers);
            merged.putAll(incoming.headers);
            return new OriginHeaders(merged, incoming.expiresAt);
        });
    }

    static Map<String, String> headersFor(String targetUrl, String pageUrl) {
        return headersFor(targetUrl, pageUrl, OriginHeaderStore::webviewCookie);
    }

    static Map<String, String> headersFor(String targetUrl, String pageUrl, CookieSource cookies) {
        purge();
        String targetOrigin = originOf(targetUrl);
        String pageOrigin = originOf(pageUrl);
        if (targetOrigin == null) return Collections.emptyMap();
        Map<String, String> captured = capturedFor(targetOrigin);
        Map<String, String> result = new LinkedHashMap<>();
        copy(captured, result, "user-agent");
        copy(captured, result, "accept");
        copy(captured, result, "accept-language");
        // Replay credentials only to the exact origin where they were
        // captured. A media CDN commonly differs from the page origin, but
        // that does not make its own observed Authorization unsafe to reuse.
        copy(captured, result, "authorization");
        if (targetOrigin.equals(pageOrigin)) {
            String referer = header(captured, "referer");
            if (referer == null) referer = pageUrl;
            if (referer != null && !referer.isEmpty()) result.put("referer", referer);
            String origin = header(captured, "origin");
            if (origin == null) origin = pageOrigin;
            if (origin != null && !origin.isEmpty()) result.put("origin", origin);
        } else if (pageOrigin != null) {
            // Cross-origin playback must never replay a full captured page URL as Referer.
            // Keep only the page origin so article paths/query strings are not leaked to a CDN.
            result.put("referer", pageOrigin.endsWith("/") ? pageOrigin : pageOrigin + "/");
        }
        String cookie = cookies == null ? null : cookies.cookieFor(targetUrl);
        if (cookie != null && !cookie.isEmpty()) {
            result.put("cookie", cookie);
        } else {
            // CookieManager is queried for the exact target URL above. Fall
            // back to an observed cookie only for that same exact origin.
            copy(captured, result, "cookie");
        }
        return result;
    }

    static String originOf(String url) {
        if (url == null || url.isEmpty()) return null;
        try {
            Uri uri = Uri.parse(url);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            int port = uri.getPort();
            if (host == null || host.isEmpty()) {
                host = hostFromAuthority(firstNonEmpty(uri.getEncodedAuthority(), uri.getAuthority()));
                if (port == -1) {
                    port = portFromAuthority(firstNonEmpty(uri.getEncodedAuthority(), uri.getAuthority()));
                }
            }
            if (scheme == null || host == null || host.isEmpty()) return null;
            String lowerScheme = scheme.toLowerCase(Locale.ROOT);
            String originHost = formatOriginHost(host);
            if (port == -1
                || ("https".equals(lowerScheme) && port == 443)
                || ("http".equals(lowerScheme) && port == 80)) {
                return lowerScheme + "://" + originHost;
            }
            return lowerScheme + "://" + originHost + ":" + port;
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static String formatOriginHost(String host) {
        String lower = host.toLowerCase(Locale.ROOT);
        if (lower.indexOf(':') >= 0 && lower.charAt(0) != '[') {
            return "[" + lower + "]";
        }
        return lower;
    }

    private static String firstNonEmpty(String first, String second) {
        if (first != null && !first.isEmpty()) return first;
        return second;
    }

    private static String hostFromAuthority(String authority) {
        if (authority == null || authority.isEmpty()) return null;
        int at = authority.lastIndexOf('@');
        String hostPort = at >= 0 ? authority.substring(at + 1) : authority;
        if (hostPort.startsWith("[")) {
            int end = hostPort.indexOf(']');
            return end > 1 ? hostPort.substring(1, end) : null;
        }
        int colon = hostPort.lastIndexOf(':');
        return colon >= 0 ? hostPort.substring(0, colon) : hostPort;
    }

    private static int portFromAuthority(String authority) {
        if (authority == null || authority.isEmpty()) return -1;
        int at = authority.lastIndexOf('@');
        String hostPort = at >= 0 ? authority.substring(at + 1) : authority;
        int colon = hostPort.startsWith("[") ? hostPort.indexOf("]:") : hostPort.lastIndexOf(':');
        if (colon < 0) return -1;
        String portText = hostPort.startsWith("[")
            ? hostPort.substring(colon + 2)
            : hostPort.substring(colon + 1);
        if (portText.isEmpty()) return -1;
        try {
            return Integer.parseInt(portText);
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    static void clear() {
        STORE.clear();
    }

    static Set<String> notedOrigins() {
        purge();
        return new HashSet<>(STORE.keySet());
    }

    private static Map<String, String> capturedFor(String origin) {
        OriginHeaders record = STORE.get(origin);
        if (record == null || record.expiresAt < System.currentTimeMillis()) return Collections.emptyMap();
        return record.headers;
    }

    private static Map<String, String> filterStored(Map<String, String> requestHeaders) {
        Map<String, String> captured = new HashMap<>();
        for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            if (name == null || value == null || value.isEmpty()) continue;
            String lower = name.toLowerCase(Locale.ROOT);
            if ("range".equals(lower) || !STORED_HEADERS.contains(lower)) continue;
            captured.put(lower, value);
        }
        return captured;
    }

    private static void copy(Map<String, String> from, Map<String, String> to, String name) {
        String value = header(from, name);
        if (value != null) to.put(name, value);
    }

    private static String header(Map<String, String> map, String name) {
        if (map == null || map.isEmpty()) return null;
        for (Map.Entry<String, String> entry : map.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey()) && entry.getValue() != null && !entry.getValue().isEmpty()) {
                return entry.getValue();
            }
        }
        return null;
    }

    private static void purge() {
        long now = System.currentTimeMillis();
        STORE.entrySet().removeIf(entry -> entry.getValue().expiresAt < now);
    }

    private static String webviewCookie(String url) {
        try {
            return CookieManager.getInstance().getCookie(url);
        } catch (RuntimeException ignored) {
            return null;
        }
    }
}
