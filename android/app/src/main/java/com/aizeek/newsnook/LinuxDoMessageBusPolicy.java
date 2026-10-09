package com.aizeek.newsnook;

import java.net.URI;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The offloaded MessageBus is not a general-purpose upstream API origin. */
final class LinuxDoMessageBusPolicy {
    static boolean allows(String value, String method) {
        try {
            URI uri = new URI(value);
            return "POST".equals(method) && "https".equalsIgnoreCase(uri.getScheme())
                && "ping.ldstatic.com".equalsIgnoreCase(uri.getHost())
                && uri.getPort() == -1 && uri.getRawUserInfo() == null && uri.getRawFragment() == null
                && uri.getRawPath().matches("/message-bus/[a-fA-F0-9]{32}/poll")
                && "dlp=t".equals(uri.getRawQuery());
        } catch (Exception ignored) {
            return false;
        }
    }

    static String sharedSessionKey(String html) {
        Matcher tags = Pattern.compile("<meta\\s+[^>]*>", Pattern.CASE_INSENSITIVE).matcher(html);
        while (tags.find()) {
            String tag = tags.group();
            if (!"shared_session_key".equals(attribute(tag, "name"))) continue;
            String key = attribute(tag, "content");
            return key.matches("[a-zA-Z0-9_-]{16,256}") ? key : "";
        }
        return "";
    }

    static String sessionIdentity(String cookies) {
        for (String cookie : cookies.split(";")) {
            String value = cookie.trim();
            if (value.startsWith("_t=")) return value.substring(3);
        }
        return "";
    }

    private static String attribute(String tag, String name) {
        Matcher match = Pattern.compile("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE).matcher(tag);
        return match.find() ? match.group(2) : "";
    }
}
