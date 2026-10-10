package com.aizeek.newsnook;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import okhttp3.MediaType;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** 为已登记的媒体会话流式补齐 Referer/Cookie/代理，不缓存或改写媒体字节。 */
final class MediaPlaybackWebViewClient extends BridgeWebViewClient {

    MediaPlaybackWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse local = super.shouldInterceptRequest(view, request);
        if (local != null) return local;
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) return playbackPreflight(request.getUrl().toString(), request.getRequestHeaders());
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

        String url = request.getUrl().toString();
        String sessionId = null;
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            if ("x-newsnook-playback-session".equalsIgnoreCase(header.getKey())) sessionId = header.getValue();
        }
        MediaSnifferPlugin.PlaybackContext context = MediaSnifferPlugin.findPlaybackContext(url, sessionId);
        if (context == null) return null;

        Request.Builder builder = new Request.Builder().url(url);
        for (Map.Entry<String, String> header : context.headers.entrySet()) {
            builder.header(header.getKey(), header.getValue());
        }
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            String name = header.getKey();
            if ("range".equalsIgnoreCase(name) || "accept".equalsIgnoreCase(name)) {
                builder.header(name, header.getValue());
            }
        }
        Response response = null;
        try {
            response = context.client.newCall(builder.build()).execute();
            ResponseBody body = response.body();
            if (body == null) {
                response.close();
                return null;
            }
            MediaType contentType = body.contentType();
            String mimeType = contentType == null
                ? "application/octet-stream"
                : contentType.type() + "/" + contentType.subtype();
            String inferredMime = inferredMediaMimeType(url);
            if (isGenericBinaryMime(mimeType) && inferredMime != null) mimeType = inferredMime;
            String encoding = contentType == null || contentType.charset() == null
                ? null
                : contentType.charset().name();
            Map<String, String> headers = new HashMap<>();
            for (String name : response.headers().names()) {
                headers.put(name, response.header(name, ""));
            }
            String contentTypeHeader = findHeaderName(headers, "content-type");
            if (inferredMime != null && isGenericBinaryMime(contentTypeHeader == null ? null : headers.get(contentTypeHeader))) {
                headers.put(contentTypeHeader == null ? "Content-Type" : contentTypeHeader, inferredMime);
            }
            String reason = response.message();
            if (reason == null || reason.isEmpty()) reason = "HTTP " + response.code();
            return new WebResourceResponse(
                mimeType,
                encoding,
                response.code(),
                reason,
                headers,
                body.byteStream()
            );
        } catch (IOException | IllegalArgumentException error) {
            if (response != null) response.close();
            return null;
        }
    }

    /** The internal marker must not require permission from the upstream CDN. */
    static WebResourceResponse playbackPreflight(String url, Map<String, String> requestHeaders) {
        String origin = headerValue(requestHeaders, "origin");
        String method = headerValue(requestHeaders, "access-control-request-method");
        String requested = headerValue(requestHeaders, "access-control-request-headers");
        if (origin == null || !"GET".equalsIgnoreCase(method) || requested == null
            || !MediaSnifferPlugin.hasSessionPlaybackOrigin(url)) return null;
        boolean marker = false;
        for (String header : requested.split(",")) {
            String name = header.trim();
            if ("x-newsnook-playback-session".equalsIgnoreCase(name)) marker = true;
            else if (!"range".equalsIgnoreCase(name) && !"accept".equalsIgnoreCase(name)) return null;
        }
        if (!marker) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", origin);
        headers.put("Access-Control-Allow-Methods", "GET");
        headers.put("Access-Control-Allow-Headers", requested);
        headers.put("Access-Control-Allow-Credentials", "true");
        headers.put("Vary", "Origin");
        return new WebResourceResponse("text/plain", "UTF-8", 204, "No Content", headers, new ByteArrayInputStream(new byte[0]));
    }

    private static String headerValue(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> header : headers.entrySet()) if (name.equalsIgnoreCase(header.getKey())) return header.getValue();
        return null;
    }

    private static boolean isGenericBinaryMime(String value) {
        if (value == null || value.isEmpty()) return true;
        String normalized = value.toLowerCase(Locale.ROOT);
        return normalized.startsWith("application/octet-stream")
            || normalized.startsWith("binary/octet-stream")
            || normalized.startsWith("application/download")
            || normalized.startsWith("application/force-download");
    }

    private static String findHeaderName(Map<String, String> headers, String target) {
        for (String name : headers.keySet()) {
            if (target.equalsIgnoreCase(name)) return name;
        }
        return null;
    }

    private static String inferredMediaMimeType(String value) {
        try {
            String path = android.net.Uri.parse(value).getPath();
            if (path == null) return null;
            String lower = path.toLowerCase(Locale.ROOT);
            if (lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".mov")) return "video/mp4";
            if (lower.endsWith(".webm")) return "video/webm";
            if (lower.endsWith(".m4a")) return "audio/mp4";
            if (lower.endsWith(".mp3")) return "audio/mpeg";
            if (lower.endsWith(".aac")) return "audio/aac";
            if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
            if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
            if (lower.endsWith(".mpd")) return "application/dash+xml";
        } catch (RuntimeException ignored) {
            // Keep the upstream MIME when the URL is malformed.
        }
        return null;
    }
}
