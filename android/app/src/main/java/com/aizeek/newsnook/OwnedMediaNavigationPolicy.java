package com.aizeek.newsnook;

import java.net.URI;
import okhttp3.HttpUrl;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Navigation policy used only by MediaSnifferPlugin-owned WebViews. */
final class OwnedMediaNavigationPolicy {
    private static final Set<String> AD_HOSTS = new HashSet<>(Arrays.asList(
        "doubleclick.net",
        "googlesyndication.com",
        "adservice.google.com",
        "adnxs.com",
        "adsrvr.org",
        "taboola.com",
        "outbrain.com"
    ));
    private static final Pattern AD_TOKEN = Pattern.compile(
        "(?:^|[/._?&=])(?:adserver|advertising|adservice|adsbygoogle|doubleclick|vast|preroll|midroll|postroll)(?:[/._?&=]|$)",
        Pattern.CASE_INSENSITIVE
    );

    private OwnedMediaNavigationPolicy() {}

    static boolean shouldBlock(String value, boolean mainFrame, String method) {
        if (value == null || value.trim().isEmpty()) return true;
        URI uri;
        try {
            uri = URI.create(value.trim());
        } catch (IllegalArgumentException ignored) {
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("about".equals(scheme) && "about:blank".equalsIgnoreCase(value.trim())) return false;
        if (("blob".equals(scheme) || "data".equals(scheme)) && !mainFrame) return false;
        if (!"http".equals(scheme) && !"https".equals(scheme)) return true;
        if (mainFrame && method != null && !"GET".equalsIgnoreCase(method)) return true;
        return isAdvertising(value, uri);
    }

    /** Owned reader surfaces may follow player pages, but unrelated sites cannot replace the player. */
    static boolean shouldBlock(String value, boolean mainFrame, String method, String currentUrl) {
        if (shouldBlock(value, mainFrame, method)) return true;
        if (!mainFrame || currentUrl == null || "about:blank".equalsIgnoreCase(value)) return false;
        try {
            URI target = URI.create(value);
            URI current = URI.create(currentUrl);
            if (target.getHost() == null) return true;
            if (target.getHost().equalsIgnoreCase(current.getHost())) return false;
            HttpUrl targetHttp = HttpUrl.parse(value);
            HttpUrl currentHttp = HttpUrl.parse(currentUrl);
            String targetSite = targetHttp == null ? null : targetHttp.topPrivateDomain();
            String currentSite = currentHttp == null ? null : currentHttp.topPrivateDomain();
            if (targetSite != null && targetSite.equals(currentSite)) return false;
            String path = target.getPath() == null ? "" : target.getPath();
            return !Pattern.compile("/(?:player|embed|play|watch|v|videos?|vodplay)(?:[/._-]|$)", Pattern.CASE_INSENSITIVE)
                .matcher(path).find();
        } catch (IllegalArgumentException ignored) { return true; }
    }

    static boolean isAdvertising(String value) {
        if (value == null || value.isEmpty()) return false;
        try {
            return isAdvertising(value, URI.create(value));
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static boolean isAdvertising(String value, URI uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        for (String suffix : AD_HOSTS) {
            if (host.equals(suffix) || host.endsWith("." + suffix)) return true;
        }
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();
        String query = uri.getRawQuery() == null ? "" : uri.getRawQuery();
        return AD_TOKEN.matcher(host + path + "?" + query).find();
    }
}
