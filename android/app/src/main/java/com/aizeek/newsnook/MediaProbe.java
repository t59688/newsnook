package com.aizeek.newsnook;

import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

final class MediaProbe {
    static final int MAX_BYTES = 65536;
    static final int MAX_PER_SESSION = 24;

    static final class Result {
        final String mimeType;
        Result(String mimeType) { this.mimeType = mimeType; }
    }

    static Result classify(OkHttpClient client, String url) {
        return classify(client, url, java.util.Collections.emptyMap());
    }

    static Result classify(OkHttpClient client, String url, Map<String, String> headers) {
        if (!isSafeExternalUrl(url)) return null;
        try {
            Request.Builder headBuilder = new Request.Builder().url(url).head();
            addHeaders(headBuilder, headers);
            Request head = headBuilder.build();
            try {
                try (Response response = client.newCall(head).execute()) {
                    String mime = contentType(response);
                    if (isMediaMime(mime) || isManifestMime(mime)) return new Result(mime);
                }
            } catch (IOException ignored) {
                // HEAD 失败或非媒体 MIME 时仍尝试 Range GET。
            }
            Request.Builder getBuilder = new Request.Builder()
                .url(url)
                .header("Range", "bytes=0-" + (MAX_BYTES - 1))
                .get();
            addHeaders(getBuilder, headers);
            Request get = getBuilder.build();
            try (Response response = client.newCall(get).execute()) {
                String mime = contentType(response);
                byte[] prefix = readPrefix(response.body(), MAX_BYTES);
                String text = new String(prefix, java.nio.charset.StandardCharsets.UTF_8);
                if (text.startsWith("#EXTM3U") || text.contains("#EXTM3U")) {
                    return new Result("application/vnd.apple.mpegurl");
                }
                if (text.contains("<MPD") || text.contains("application/dash+xml")) {
                    return new Result("application/dash+xml");
                }
                String containerMime = classifyIsoBmff(prefix);
                if (containerMime != null) return new Result(containerMime);
                if (isMediaMime(mime)) return new Result(mime);
            }
        } catch (IOException | IllegalArgumentException ignored) {
            return null;
        }
        return null;
    }

    private static void addHeaders(Request.Builder builder, Map<String, String> headers) {
        if (headers == null) return;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            if (name == null || value == null || value.isEmpty()) continue;
            if ("range".equalsIgnoreCase(name)) continue;
            if ("cookie".equalsIgnoreCase(name) || "authorization".equalsIgnoreCase(name)
                || "referer".equalsIgnoreCase(name) || "origin".equalsIgnoreCase(name)
                || "user-agent".equalsIgnoreCase(name) || "accept".equalsIgnoreCase(name)
                || "accept-language".equalsIgnoreCase(name)) {
                builder.header(name, value);
            }
        }
    }

    /** ISO-BMFF identification: ftyp alone is not enough to claim video. */
    private static String classifyIsoBmff(byte[] bytes) {
        if (indexOf(bytes, "ftyp") < 0) return null;
        boolean video = indexOf(bytes, "vide") >= 0;
        boolean audio = indexOf(bytes, "soun") >= 0;
        if (video) return "video/mp4";
        if (audio) return "audio/mp4";
        return null;
    }

    static boolean isSafeExternalUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || host == null) return false;
            String lower = host.toLowerCase(Locale.ROOT);
            if (lower.equals("localhost") || lower.endsWith(".localhost") || lower.equals("metadata.google.internal")) return false;
            for (InetAddress address : InetAddress.getAllByName(host)) {
                if (isPrivateAddress(address)) return false;
            }
            return true;
        } catch (URISyntaxException | IOException | RuntimeException ignored) {
            return false;
        }
    }

    private static boolean isPrivateAddress(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
            || address.isSiteLocalAddress() || address.isMulticastAddress()) return true;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int first = bytes[0] & 0xff;
            int second = bytes[1] & 0xff;
            if (first == 100 && second >= 64 && second <= 127) return true; // CGNAT
            if (first == 169 && second == 254) return true;
        } else if (bytes.length == 16) {
            int first = bytes[0] & 0xff;
            if ((first & 0xfe) == 0xfc) return true; // IPv6 ULA
        }
        return false;
    }

    /** Reads at most {@code maxBytes} from the body. Closing the response aborts any remainder. */
    private static byte[] readPrefix(ResponseBody body, int maxBytes) throws IOException {
        if (body == null || maxBytes <= 0) return new byte[0];
        InputStream stream = body.byteStream();
        byte[] buffer = new byte[maxBytes];
        int total = 0;
        while (total < maxBytes) {
            int n = stream.read(buffer, total, maxBytes - total);
            if (n < 0) break;
            total += n;
        }
        if (total == maxBytes) return buffer;
        return Arrays.copyOf(buffer, total);
    }

    private static int indexOf(byte[] haystack, String ascii) {
        byte[] needle = ascii.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        outer:
        for (int i = 0; i + needle.length <= haystack.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    private static String contentType(Response response) {
        String header = response.header("Content-Type");
        if (header == null) return "";
        int semi = header.indexOf(';');
        return (semi < 0 ? header : header.substring(0, semi)).trim().toLowerCase(Locale.ROOT);
    }

    private static boolean isMediaMime(String mime) {
        return mime.startsWith("video/") || mime.startsWith("audio/");
    }

    private static boolean isManifestMime(String mime) {
        return mime.contains("mpegurl") || mime.equals("application/dash+xml");
    }
}
