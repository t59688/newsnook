package com.aizeek.newsnook;

import android.net.Network;
import android.util.Base64;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Temporary LAN HTTP relay used only while a DLNA cast session is active.
 *
 * The renderer cannot reuse WebView cookies / Referer headers, so handing the
 * upstream URL to the TV directly breaks many CMS video sources. This relay
 * reuses MediaSniffer's playback context and gives the TV a short-lived,
 * unguessable URL on the phone. HLS playlists are rewritten so nested
 * manifests, segments, keys and subtitle resources keep using the same relay.
 */
final class CastMediaProxy implements Closeable {

    private static final CastMediaProxy INSTANCE = new CastMediaProxy();
    private static final int BUFFER_SIZE = 32 * 1024;
    private static final int MAX_REQUEST_LINE = 16 * 1024;
    private static final int MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
    private static final Pattern HLS_URI_ATTRIBUTE =
        Pattern.compile("URI\\s*=\\s*\"([^\"]+)\"");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final Object lock = new Object();
    private final Map<String, ProxySession> sessions = new ConcurrentHashMap<>();
    private final OkHttpClient fallbackClient = new OkHttpClient();

    private ServerSocket serverSocket;
    private ExecutorService acceptExecutor;
    private ExecutorService requestExecutor;
    private int port = -1;

    static CastMediaProxy getInstance() {
        return INSTANCE;
    }

    SessionHandle openSession(
        String targetUrl,
        String rendererHost,
        Network lanNetwork
    ) throws IOException {
        if (!isHttpUrl(targetUrl)) {
            throw new IOException("Only HTTP(S) media can be cast");
        }

        int localPort = ensureStarted();
        String publicHost = resolveReachableLocalHost(rendererHost, lanNetwork);
        String token = newToken();
        String publicBase = "http://" + hostForUrl(publicHost) + ":" + localPort + "/cast/" + token;
        MediaSnifferPlugin.PlaybackContext playbackContext =
            MediaSnifferPlugin.findPlaybackContext(targetUrl);
        ProxySession session = new ProxySession(token, targetUrl, publicBase, playbackContext);
        sessions.put(token, session);

        return new SessionHandle(token, proxyUrl(session, targetUrl));
    }

    void closeSession(String token) {
        if (token == null || token.isEmpty()) return;
        sessions.remove(token);
        if (!sessions.isEmpty()) return;

        synchronized (lock) {
            if (!sessions.isEmpty()) return;
            stopServerLocked();
        }
    }

    private int ensureStarted() throws IOException {
        synchronized (lock) {
            if (serverSocket != null && !serverSocket.isClosed() && port > 0) {
                return port;
            }

            ServerSocket socket = new ServerSocket();
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(0));
            serverSocket = socket;
            port = socket.getLocalPort();
            acceptExecutor = Executors.newSingleThreadExecutor(named("newsnook-cast-proxy"));
            requestExecutor = Executors.newCachedThreadPool(named("newsnook-cast-proxy-worker"));
            acceptExecutor.execute(this::acceptLoop);
            return port;
        }
    }

    private void acceptLoop() {
        while (true) {
            ServerSocket current;
            ExecutorService workers;
            synchronized (lock) {
                current = serverSocket;
                workers = requestExecutor;
            }
            if (current == null || current.isClosed() || workers == null || workers.isShutdown()) return;

            try {
                Socket socket = current.accept();
                socket.setSoTimeout(30000);
                workers.execute(() -> handle(socket));
            } catch (SocketException closed) {
                return;
            } catch (IOException ignored) {
                // A single renderer disconnect must not terminate the relay.
            }
        }
    }

    private void handle(Socket socket) {
        try (
            Socket ignored = socket;
            BufferedInputStream input = new BufferedInputStream(socket.getInputStream());
            BufferedOutputStream output = new BufferedOutputStream(socket.getOutputStream())
        ) {
            HttpRequest request = readRequest(input);
            if (request == null) {
                writeError(output, 400, "Bad Request");
                return;
            }
            if (!"GET".equalsIgnoreCase(request.method) && !"HEAD".equalsIgnoreCase(request.method)) {
                writeError(output, 405, "Method Not Allowed");
                return;
            }

            String token = tokenFromPath(request.path);
            ProxySession session = token == null ? null : sessions.get(token);
            if (session == null) {
                writeError(output, 404, "Cast Session Missing");
                return;
            }

            String target = request.queryUrl;
            if (!isHttpUrl(target) || !session.allowedUrls.contains(target)) {
                writeError(output, 403, "Cast Resource Not Allowed");
                return;
            }

            proxyRequest(session, target, request, output);
        } catch (IOException ignored) {
            // Renderer disconnected or upstream failed. The next polling/request can retry.
        } catch (Throwable ignored) {
            // Keep the process alive on vendor-specific malformed requests.
        }
    }

    private void proxyRequest(
        ProxySession session,
        String target,
        HttpRequest incoming,
        OutputStream output
    ) throws IOException {
        MediaSnifferPlugin.PlaybackContext context = MediaSnifferPlugin.findPlaybackContext(target);
        if (context == null) {
            context = session.playbackContext;
        }
        if (context != null) {
            context = context.forRequest(target);
        }

        OkHttpClient client = context == null ? fallbackClient : context.client;
        Request.Builder upstream = new Request.Builder().url(target);
        if (context != null) {
            for (Map.Entry<String, String> entry : context.headers.entrySet()) {
                String name = entry.getKey();
                String value = entry.getValue();
                if (name == null || value == null || value.isEmpty()) continue;
                upstream.header(name, value);
            }
        }

        String range = incoming.headers.get("range");
        if (range != null && !range.isEmpty()) upstream.header("Range", range);
        if ("HEAD".equalsIgnoreCase(incoming.method)) upstream.head();

        try (Response response = client.newCall(upstream.build()).execute()) {
            ResponseBody body = response.body();
            if (body == null) {
                writeError(output, 502, "Empty Upstream Response");
                return;
            }

            boolean playlist = "GET".equalsIgnoreCase(incoming.method)
                && isHlsPlaylist(target, response.header("Content-Type"));
            if (playlist) {
                String text = readPlaylist(body);
                String effectiveUrl = response.request().url().toString();
                String rewritten = rewritePlaylist(session, effectiveUrl, text);
                byte[] bytes = rewritten.getBytes(StandardCharsets.UTF_8);
                writeResponseHeaders(
                    output,
                    response.code(),
                    response.message(),
                    response,
                    "application/vnd.apple.mpegurl; charset=utf-8",
                    bytes.length,
                    true
                );
                output.write(bytes);
                output.flush();
                return;
            }

            long contentLength = body.contentLength();
            writeResponseHeaders(
                output,
                response.code(),
                response.message(),
                response,
                null,
                contentLength,
                false
            );
            if ("HEAD".equalsIgnoreCase(incoming.method)) {
                output.flush();
                return;
            }

            try (InputStream upstreamBody = body.byteStream()) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = upstreamBody.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                output.flush();
            }
        }
    }

    private String rewritePlaylist(ProxySession session, String baseUrl, String playlist) {
        String[] lines = playlist.split("\\r?\\n", -1);
        StringBuilder rewritten = new StringBuilder(playlist.length() + 512);
        for (int index = 0; index < lines.length; index++) {
            String line = lines[index];
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) {
                if (trimmed.startsWith("#")) {
                    line = rewriteUriAttributes(session, baseUrl, line);
                } else {
                    String resolved = resolveHttpUrl(baseUrl, trimmed);
                    if (resolved != null) {
                        session.allowedUrls.add(resolved);
                        line = proxyUrl(session, resolved);
                    }
                }
            }
            rewritten.append(line);
            if (index < lines.length - 1) rewritten.append('\n');
        }
        return rewritten.toString();
    }

    private String rewriteUriAttributes(ProxySession session, String baseUrl, String line) {
        Matcher matcher = HLS_URI_ATTRIBUTE.matcher(line);
        StringBuffer rewritten = new StringBuffer();
        while (matcher.find()) {
            String resolved = resolveHttpUrl(baseUrl, matcher.group(1));
            if (resolved == null) continue;
            session.allowedUrls.add(resolved);
            String replacement = "URI=\"" + proxyUrl(session, resolved) + "\"";
            matcher.appendReplacement(rewritten, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(rewritten);
        return rewritten.toString();
    }

    private static String readPlaylist(ResponseBody body) throws IOException {
        long declared = body.contentLength();
        if (declared > MAX_PLAYLIST_BYTES) {
            throw new IOException("HLS playlist is unexpectedly large");
        }

        try (InputStream input = body.byteStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PLAYLIST_BYTES) {
                    throw new IOException("HLS playlist is unexpectedly large");
                }
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static boolean isHlsPlaylist(String url, String contentType) {
        String lowerUrl = url == null ? "" : url.toLowerCase(Locale.ROOT);
        String lowerType = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        return lowerUrl.matches(".*\\.m3u8(?:[?#].*)?$")
            || lowerType.contains("mpegurl")
            || lowerType.contains("vnd.apple.mpegurl");
    }

    private static String resolveHttpUrl(String baseUrl, String child) {
        try {
            URL resolved = new URL(new URL(baseUrl), child);
            String value = resolved.toString();
            return isHttpUrl(value) ? value : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String proxyUrl(ProxySession session, String target) {
        return session.publicBase + resourceSuffix(target) + "?url=" + encodeComponent(target);
    }

    /**
     * Keep a useful extension in the renderer-facing path. A number of older
     * televisions infer the decoder/playlist type from the URI before they look
     * at Content-Type.
     */
    private static String resourceSuffix(String target) {
        try {
            String path = new URL(target).getPath();
            int slash = path.lastIndexOf('/');
            String name = slash >= 0 ? path.substring(slash + 1) : path;
            int dot = name.lastIndexOf('.');
            if (dot >= 0 && dot < name.length() - 1) {
                String ext = name.substring(dot + 1);
                if (ext.matches("[A-Za-z0-9]{1,8}")) return "/media." + ext.toLowerCase(Locale.ROOT);
            }
        } catch (Exception ignored) {
            // Fall through to an extensionless resource.
        }
        return "/media";
    }

    private static void writeResponseHeaders(
        OutputStream output,
        int code,
        String message,
        Response response,
        String overrideContentType,
        long contentLength,
        boolean rewritten
    ) throws IOException {
        String reason = message == null || message.isEmpty() ? "OK" : message;
        writeLine(output, "HTTP/1.1 " + code + " " + reason);
        writeLine(output, "Connection: close");

        for (String name : response.headers().names()) {
            if (shouldSkipResponseHeader(name, rewritten)) continue;
            if ("content-type".equalsIgnoreCase(name) && overrideContentType != null) continue;
            if ("content-length".equalsIgnoreCase(name)) continue;
            for (String value : response.headers(name)) {
                if (value != null) writeLine(output, name + ": " + value);
            }
        }

        if (overrideContentType != null) {
            writeLine(output, "Content-Type: " + overrideContentType);
        }
        if (contentLength >= 0) {
            writeLine(output, "Content-Length: " + contentLength);
        }
        if (!rewritten && response.header("Accept-Ranges") == null) {
            writeLine(output, "Accept-Ranges: bytes");
        }
        writeLine(output, "");
        output.flush();
    }

    private static boolean shouldSkipResponseHeader(String name, boolean rewritten) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return "connection".equals(lower)
            || "keep-alive".equals(lower)
            || "transfer-encoding".equals(lower)
            || "content-encoding".equals(lower)
            || "content-length".equals(lower)
            || "host".equals(lower)
            || (rewritten && (
                "content-range".equals(lower)
                    || "accept-ranges".equals(lower)
                    || "etag".equals(lower)
            ));
    }

    private static HttpRequest readRequest(InputStream input) throws IOException {
        String requestLine = readLine(input);
        if (requestLine == null || requestLine.isEmpty() || requestLine.length() > MAX_REQUEST_LINE) {
            return null;
        }
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return null;

        String method = parts[0];
        String target = parts[1];
        String path = target;
        String query = "";
        int queryIndex = target.indexOf('?');
        if (queryIndex >= 0) {
            path = target.substring(0, queryIndex);
            query = target.substring(queryIndex + 1);
        }

        Map<String, String> headers = new ConcurrentHashMap<>();
        while (true) {
            String line = readLine(input);
            if (line == null || line.isEmpty()) break;
            if (line.length() > MAX_REQUEST_LINE) return null;
            int separator = line.indexOf(':');
            if (separator <= 0) continue;
            String name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if (!name.isEmpty() && !value.isEmpty()) headers.put(name, value);
        }

        return new HttpRequest(method, path, queryValue(query, "url"), headers);
    }

    private static String tokenFromPath(String path) {
        if (path == null || !path.startsWith("/cast/")) return null;
        String remainder = path.substring("/cast/".length());
        int slash = remainder.indexOf('/');
        return slash >= 0 ? remainder.substring(0, slash) : remainder;
    }

    private static String queryValue(String query, String targetName) {
        if (query == null || query.isEmpty()) return null;
        for (String part : query.split("&")) {
            if (part.isEmpty()) continue;
            int separator = part.indexOf('=');
            String rawName = separator >= 0 ? part.substring(0, separator) : part;
            if (!targetName.equals(decodeComponent(rawName))) continue;
            String rawValue = separator >= 0 ? part.substring(separator + 1) : "";
            return decodeComponent(rawValue);
        }
        return null;
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder builder = new StringBuilder();
        int previous = -1;
        while (builder.length() <= MAX_REQUEST_LINE) {
            int current = input.read();
            if (current == -1) {
                return builder.length() == 0 ? null : builder.toString();
            }
            if (current == '\n') {
                if (previous == '\r' && builder.length() > 0) {
                    builder.setLength(builder.length() - 1);
                }
                return builder.toString();
            }
            builder.append((char) current);
            previous = current;
        }
        return null;
    }

    private static void writeError(OutputStream output, int code, String reason) throws IOException {
        byte[] body = reason.getBytes(StandardCharsets.UTF_8);
        writeLine(output, "HTTP/1.1 " + code + " " + reason);
        writeLine(output, "Content-Type: text/plain; charset=utf-8");
        writeLine(output, "Content-Length: " + body.length);
        writeLine(output, "Connection: close");
        writeLine(output, "");
        output.write(body);
        output.flush();
    }

    private static void writeLine(OutputStream output, String value) throws IOException {
        output.write((value + "\r\n").getBytes(StandardCharsets.ISO_8859_1));
    }

    private static String resolveReachableLocalHost(String rendererHost, Network lanNetwork)
        throws IOException {
        InetAddress[] rendererAddresses = lanNetwork.getAllByName(rendererHost);
        if (rendererAddresses.length == 0) throw new IOException("无法解析投屏设备地址");
        InetAddress renderer = rendererAddresses[0];
        try (DatagramSocket routeProbe = new DatagramSocket()) {
            lanNetwork.bindSocket(routeProbe);
            routeProbe.connect(renderer, 9);
            InetAddress local = routeProbe.getLocalAddress();
            if (isUsableLocalAddress(local)) return local.getHostAddress();
        } catch (IOException ignored) {
            // Fall through to interface enumeration.
        }

        boolean rendererIsV6 = renderer instanceof Inet6Address;
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        if (interfaces != null) {
            for (NetworkInterface network : Collections.list(interfaces)) {
                try {
                    if (!network.isUp() || network.isLoopback()) continue;
                } catch (SocketException ignored) {
                    continue;
                }
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!isUsableLocalAddress(address)) continue;
                    if (rendererIsV6 == (address instanceof Inet6Address)) {
                        return address.getHostAddress();
                    }
                }
            }
        }

        // DLNA renderers are overwhelmingly IPv4. If the route probe was IPv6
        // but no matching address was found, allow an IPv4 LAN address as a last resort.
        Enumeration<NetworkInterface> fallbackInterfaces = NetworkInterface.getNetworkInterfaces();
        if (fallbackInterfaces != null) {
            for (NetworkInterface network : Collections.list(fallbackInterfaces)) {
                try {
                    if (!network.isUp() || network.isLoopback()) continue;
                } catch (SocketException ignored) {
                    continue;
                }
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (address instanceof Inet4Address && isUsableLocalAddress(address)) {
                        return address.getHostAddress();
                    }
                }
            }
        }
        throw new IOException("No LAN address is available for casting");
    }

    private static boolean isUsableLocalAddress(InetAddress address) {
        return address != null
            && !address.isAnyLocalAddress()
            && !address.isLoopbackAddress()
            && !address.isMulticastAddress();
    }

    private static String hostForUrl(String host) {
        if (host == null) return "";
        String escaped = host.replace("%", "%25");
        return escaped.contains(":") ? "[" + escaped + "]" : escaped;
    }

    private static boolean isHttpUrl(String value) {
        if (value == null) return false;
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static String newToken() {
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String encodeComponent(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException impossible) {
            return value;
        }
    }

    private static String decodeComponent(String value) {
        try {
            return URLDecoder.decode(value, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            return value;
        } catch (IllegalArgumentException malformed) {
            return "";
        }
    }

    private static ThreadFactory named(String prefix) {
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + "-" + System.nanoTime());
            thread.setDaemon(true);
            return thread;
        };
    }

    private void stopServerLocked() {
        closeQuietly(serverSocket);
        serverSocket = null;
        port = -1;
        if (acceptExecutor != null) acceptExecutor.shutdownNow();
        if (requestExecutor != null) requestExecutor.shutdownNow();
        acceptExecutor = null;
        requestExecutor = null;
    }

    private static void closeQuietly(Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Ignore shutdown races.
        }
    }

    @Override
    public void close() {
        sessions.clear();
        synchronized (lock) {
            stopServerLocked();
        }
    }

    static final class SessionHandle {
        final String token;
        final String url;

        SessionHandle(String token, String url) {
            this.token = token;
            this.url = url;
        }
    }

    private static final class ProxySession {
        final String token;
        final String rootUrl;
        final String publicBase;
        final MediaSnifferPlugin.PlaybackContext playbackContext;
        final Set<String> allowedUrls = ConcurrentHashMap.newKeySet();

        ProxySession(
            String token,
            String rootUrl,
            String publicBase,
            MediaSnifferPlugin.PlaybackContext playbackContext
        ) {
            this.token = token;
            this.rootUrl = rootUrl;
            this.publicBase = publicBase;
            this.playbackContext = playbackContext;
            this.allowedUrls.add(rootUrl);
        }
    }

    private static final class HttpRequest {
        final String method;
        final String path;
        final String queryUrl;
        final Map<String, String> headers;

        HttpRequest(String method, String path, String queryUrl, Map<String, String> headers) {
            this.method = method;
            this.path = path;
            this.queryUrl = queryUrl;
            this.headers = headers;
        }
    }
}
