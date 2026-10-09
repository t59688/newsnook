package com.aizeek.newsnook;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Streams progressive media through localhost so Android's media stack keeps Range support
 * while upstream requests still include the captured Referer/Cookie headers. */
final class LocalStreamProxy implements Closeable {

    private static final LocalStreamProxy INSTANCE = new LocalStreamProxy();
    private static final int BUFFER_SIZE = 16 * 1024;

    private final Object lock = new Object();
    private ServerSocket serverSocket;
    private ExecutorService acceptExecutor;
    private ExecutorService requestExecutor;
    private int port = -1;

    static LocalStreamProxy getInstance() {
        return INSTANCE;
    }

    int ensureStarted() throws IOException {
        synchronized (lock) {
            if (serverSocket != null && !serverSocket.isClosed() && port > 0) return port;
            serverSocket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
            serverSocket.setReuseAddress(true);
            port = serverSocket.getLocalPort();
            acceptExecutor = Executors.newSingleThreadExecutor(named("newsnook-stream-proxy"));
            requestExecutor = Executors.newCachedThreadPool(named("newsnook-stream-proxy-worker"));
            acceptExecutor.execute(this::acceptLoop);
            return port;
        }
    }

    int getPort() throws IOException {
        return ensureStarted();
    }

    String buildUrl(String targetUrl, String session) throws IOException {
        int localPort = ensureStarted();
        StringBuilder url = new StringBuilder("http://127.0.0.1:")
            .append(localPort)
            .append("/stream?url=")
            .append(encodeComponent(targetUrl));
        if (session != null && !session.isEmpty()) {
            url.append("&session=").append(encodeComponent(session));
        }
        return url.toString();
    }

    private void acceptLoop() {
        while (true) {
            ServerSocket current;
            synchronized (lock) {
                current = serverSocket;
            }
            if (current == null || current.isClosed()) return;
            try {
                Socket socket = current.accept();
                socket.setSoTimeout(30000);
                ExecutorService workers;
                synchronized (lock) {
                    workers = requestExecutor;
                }
                if (workers == null || workers.isShutdown()) {
                    closeQuietly(socket);
                    continue;
                }
                workers.execute(() -> {
                    try {
                        handle(socket);
                    } catch (Throwable ignored) {
                        // Errors (e.g. NoSuchMethodError on old API) must not kill the process.
                        closeQuietly(socket);
                    }
                });
            } catch (SocketException closed) {
                return;
            } catch (IOException ignored) {
                // Keep serving later requests; one socket failure must not kill the proxy.
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
            if (!"GET".equalsIgnoreCase(request.method)) {
                writeError(output, 405, "Method Not Allowed");
                return;
            }
            if (!"/stream".equals(request.path)) {
                writeError(output, 404, "Not Found");
                return;
            }
            String targetUrl = request.query.get("url");
            if (targetUrl == null || targetUrl.isEmpty()) {
                writeError(output, 400, "Missing url");
                return;
            }

            MediaSnifferPlugin.PlaybackContext context = MediaSnifferPlugin.findPlaybackContext(targetUrl);
            if (context == null) {
                writeError(output, 404, "Playback Context Missing");
                return;
            }

            Request.Builder upstream = new Request.Builder().url(targetUrl);
            for (Map.Entry<String, String> entry : context.headers.entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null || entry.getValue().isEmpty()) continue;
                upstream.header(entry.getKey(), entry.getValue());
            }
            String range = header(request.headers, "range");
            if (range != null && !range.isEmpty()) upstream.header("Range", range);

            try (Response response = context.client.newCall(upstream.build()).execute()) {
                ResponseBody body = response.body();
                if (body == null) {
                    writeError(output, 502, "Empty Upstream Response");
                    return;
                }
                writeSuccess(output, response, body);
            }
        } catch (IOException ignored) {
            // Client disconnected or upstream failed; nothing else to do here.
        }
    }

    private static void writeSuccess(OutputStream output, Response response, ResponseBody body) throws IOException {
        String reason = response.message();
        if (reason == null || reason.isEmpty()) reason = "OK";
        writeLine(output, "HTTP/1.1 " + response.code() + " " + reason);
        writeLine(output, "Connection: close");
        for (String name : response.headers().names()) {
            if (shouldSkipResponseHeader(name)) continue;
            for (String value : response.headers(name)) {
                if (value != null) writeLine(output, name + ": " + value);
            }
        }
        if (response.header("Accept-Ranges") == null) writeLine(output, "Accept-Ranges: bytes");
        writeLine(output, "");
        output.flush();

        try (InputStream upstream = body.byteStream()) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = upstream.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.flush();
        }
    }

    private static boolean shouldSkipResponseHeader(String name) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        return "connection".equals(lower)
            || "keep-alive".equals(lower)
            || "transfer-encoding".equals(lower)
            || "content-encoding".equals(lower)
            || "host".equals(lower);
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

    private static HttpRequest readRequest(InputStream input) throws IOException {
        String requestLine = readLine(input);
        if (requestLine == null || requestLine.isEmpty()) return null;
        String[] parts = requestLine.split(" ");
        if (parts.length < 2) return null;
        String method = parts[0];
        String target = parts[1];
        String path = target;
        String queryText = "";
        int queryIndex = target.indexOf('?');
        if (queryIndex >= 0) {
            path = target.substring(0, queryIndex);
            queryText = target.substring(queryIndex + 1);
        }
        Map<String, String> headers = new LinkedHashMap<>();
        while (true) {
            String line = readLine(input);
            if (line == null || line.isEmpty()) break;
            int separator = line.indexOf(':');
            if (separator <= 0) continue;
            String name = line.substring(0, separator).trim();
            String value = line.substring(separator + 1).trim();
            if (!name.isEmpty() && !value.isEmpty()) headers.put(name, value);
        }
        return new HttpRequest(method, path, parseQuery(queryText), headers);
    }

    private static String readLine(InputStream input) throws IOException {
        StringBuilder builder = new StringBuilder();
        int previous = -1;
        while (true) {
            int current = input.read();
            if (current == -1) {
                if (builder.length() == 0 && previous == -1) return null;
                break;
            }
            if (current == '\n') {
                if (previous == '\r' && builder.length() > 0) {
                    builder.setLength(builder.length() - 1);
                }
                break;
            }
            builder.append((char) current);
            previous = current;
        }
        return builder.toString();
    }

    private static Map<String, String> parseQuery(String queryText) {
        Map<String, String> query = new LinkedHashMap<>();
        if (queryText == null || queryText.isEmpty()) return query;
        for (String part : queryText.split("&")) {
            if (part.isEmpty()) continue;
            int index = part.indexOf('=');
            String name = index >= 0 ? part.substring(0, index) : part;
            String value = index >= 0 ? part.substring(index + 1) : "";
            query.put(decodeComponent(name), decodeComponent(value));
        }
        return query;
    }

    private static String header(Map<String, String> headers, String target) {
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (target.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    private static String decodeComponent(String value) {
        try {
            // decode(String, Charset) is API 33+; Pixel / Android 12 still needs the String overload.
            return URLDecoder.decode(value, "UTF-8");
        } catch (UnsupportedEncodingException impossible) {
            return value;
        }
    }

    private static String encodeComponent(String value) {
        StringBuilder encoded = new StringBuilder();
        for (byte b : value.getBytes(StandardCharsets.UTF_8)) {
            int current = b & 0xff;
            if ((current >= 'a' && current <= 'z')
                || (current >= 'A' && current <= 'Z')
                || (current >= '0' && current <= '9')
                || current == '-'
                || current == '_'
                || current == '.'
                || current == '~') {
                encoded.append((char) current);
            } else {
                encoded.append('%');
                char high = Character.toUpperCase(Character.forDigit((current >> 4) & 0xf, 16));
                char low = Character.toUpperCase(Character.forDigit(current & 0xf, 16));
                encoded.append(high).append(low);
            }
        }
        return encoded.toString();
    }

    private static ThreadFactory named(String prefix) {
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + "-" + System.nanoTime());
            thread.setDaemon(true);
            return thread;
        };
    }

    private static void closeQuietly(Closeable closeable) {
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Ignore close failures during shutdown.
        }
    }

    @Override
    public void close() {
        synchronized (lock) {
            closeQuietly(serverSocket);
            serverSocket = null;
            port = -1;
            if (acceptExecutor != null) acceptExecutor.shutdownNow();
            if (requestExecutor != null) requestExecutor.shutdownNow();
            acceptExecutor = null;
            requestExecutor = null;
        }
    }

    private static final class HttpRequest {
        final String method;
        final String path;
        final Map<String, String> query;
        final Map<String, String> headers;

        HttpRequest(String method, String path, Map<String, String> query, Map<String, String> headers) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.headers = headers;
        }
    }
}
