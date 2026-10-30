package com.aizeek.newsnook;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;
import okhttp3.HttpUrl;

final class CatalogSnapshotPolicy {
    static final int DEFAULT_TIMEOUT_MS = 8_000;
    static final int MAX_TIMEOUT_MS = 10_000;
    static final int DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
    static final int MAX_MAX_BYTES = 2 * 1024 * 1024;

    private static final Pattern SESSION_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}");
    private static final Set<String> AD_HOSTS = new HashSet<>(Arrays.asList(
        "doubleclick.net",
        "googlesyndication.com",
        "adservice.google.com",
        "adnxs.com",
        "adsrvr.org",
        "taboola.com",
        "outbrain.com"
    ));

    private CatalogSnapshotPolicy() {}

    static boolean isInitialUrlAllowed(String raw) {
        URI uri = parseHttp(raw);
        return uri != null && uri.getRawUserInfo() == null;
    }

    static boolean isSessionIdAllowed(String value) {
        return value != null && SESSION_ID.matcher(value).matches();
    }

    static int timeoutMs(Integer value) {
        if (value == null || value <= 0) return DEFAULT_TIMEOUT_MS;
        return Math.min(value, MAX_TIMEOUT_MS);
    }

    static int maxBytes(Integer value) {
        if (value == null || value <= 0) return DEFAULT_MAX_BYTES;
        return Math.min(value, MAX_MAX_BYTES);
    }

    static boolean shouldBlockNavigation(
        String initialUrl,
        String targetUrl,
        boolean mainFrame,
        String method
    ) {
        URI target = parseHttp(targetUrl);
        if (target == null || target.getRawUserInfo() != null || isAdHost(target.getHost())) return true;
        if (!mainFrame) return false;
        if (!"GET".equalsIgnoreCase(method)) return true;

        URI initial = parseHttp(initialUrl);
        if (initial == null) return true;
        if (initial.getHost().equalsIgnoreCase(target.getHost())) return false;
        HttpUrl initialHttp = HttpUrl.parse(initialUrl);
        HttpUrl targetHttp = HttpUrl.parse(targetUrl);
        String initialSite = initialHttp == null ? null : initialHttp.topPrivateDomain();
        String targetSite = targetHttp == null ? null : targetHttp.topPrivateDomain();
        return initialSite == null || !initialSite.equalsIgnoreCase(targetSite);
    }

    static String normalizeUserAgent(String value) {
        if (value == null) return null;
        return value.replaceAll("(?i)\\s+Version/[^\\s]+", "")
            .replaceAll("(?i);?\\s*wv(?=[;)])", "")
            .replaceAll("\\s{2,}", " ")
            .trim();
    }

    static boolean isUserAgentAllowed(String value) {
        return value == null || (value.length() <= 512 && value.indexOf('\r') < 0 && value.indexOf('\n') < 0);
    }

    private static URI parseHttp(String raw) {
        if (raw == null || raw.trim().isEmpty()) return null;
        try {
            URI uri = new URI(raw.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!("http".equals(scheme) || "https".equals(scheme))) return null;
            return uri.getHost() == null || uri.getHost().isEmpty() ? null : uri;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static boolean isAdHost(String value) {
        if (value == null) return false;
        String host = value.toLowerCase(Locale.ROOT);
        for (String suffix : AD_HOSTS) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        return false;
    }
}
