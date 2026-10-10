package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.OkHttpClient;
import java.net.HttpURLConnection;
import java.net.URL;
import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 31)
public class LocalStreamProxyTest {

    @After
    public void tearDown() {
        cleanup(LocalStreamProxy.getInstance());
        MediaSnifferPlugin.clearPlaybackContexts();
    }

    @Test
    public void percentEncodedProgressiveUrlParsesWithoutCrashing() throws Exception {
        String target = "https://cdn.example/mp43/1233789.mp4?st=T8v7DkccQC79eH78ziu0qw&e=1787065100";
        String proxyUrl = LocalStreamProxy.getInstance().buildUrl(target, null);
        assertTrue(proxyUrl.startsWith("http://127.0.0.1:"));
        assertTrue(proxyUrl.contains("/stream?url="));

        HttpURLConnection connection = (HttpURLConnection) new URL(proxyUrl).openConnection();
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(3000);
        try {
            assertEquals(404, connection.getResponseCode());
        } finally {
            connection.disconnect();
        }
    }

    @Test public void closeIsIdempotentBeforeAndAfterStart() throws Exception {
        LocalStreamProxy proxy = new LocalStreamProxy();
        try { proxy.close(); }
        catch (NullPointerException failure) { org.junit.Assert.fail("closing a stopped proxy must be safe"); }
        proxy.ensureStarted();
        proxy.close();
        proxy.close();
    }

    @Test public void closeDisconnectsIncompleteRequestsAndRestartHasFreshCapacity() throws Exception {
        LocalStreamProxy proxy = new LocalStreamProxy();
        List<Socket> sockets = new ArrayList<>();
        try {
            int port = proxy.ensureStarted();
            for (int i = 0; i < 8; i++) {
                Socket socket = new Socket("127.0.0.1", port);
                socket.setSoTimeout(2000);
                sockets.add(socket);
                socket.getOutputStream().write("GET /stream HTTP/1.1\r\n".getBytes(StandardCharsets.US_ASCII));
            }
            // This request is admitted only after the eight sockets above, and must be rejected.
            try (Socket overflow = new Socket("127.0.0.1", port)) {
                overflow.setSoTimeout(2000);
                assertEquals(-1, overflow.getInputStream().read());
            }
            proxy.close();
            for (Socket socket : sockets) {
                try { assertEquals("shutdown must disconnect active clients", -1, socket.getInputStream().read()); }
                catch (java.net.SocketTimeoutException timeout) { org.junit.Assert.fail("shutdown left an active socket blocked"); }
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(proxy.buildUrl("https://cdn.example/video.mp4", null)).openConnection();
            connection.setReadTimeout(2000);
            try { assertEquals(404, connection.getResponseCode()); } finally { connection.disconnect(); }
        } finally {
            for (Socket socket : sockets) socket.close();
            cleanup(proxy);
        }
    }

    @Test public void closeCancelsAnUpstreamStreamWhileItsBodyIsBlocked() throws Exception {
        LocalStreamProxy proxy = new LocalStreamProxy();
        CountDownLatch upstreamClosed = new CountDownLatch(1);
        AtomicReference<Throwable> upstreamError = new AtomicReference<>();
        try (ServerSocket upstream = new ServerSocket(0)) {
            Thread server = new Thread(() -> {
                try (Socket socket = upstream.accept()) {
                    socket.setSoTimeout(4000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    while (!reader.readLine().isEmpty()) {}
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\na".getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().flush();
                    if (socket.getInputStream().read() == -1) upstreamClosed.countDown();
                } catch (Throwable failure) { upstreamError.set(failure); }
            });
            server.setDaemon(true); server.start();
            String url = "http://127.0.0.1:" + upstream.getLocalPort() + "/video.mp4";
            MediaSnifferPlugin.registerPlaybackContext(url, "progressive", true, false, Collections.emptyMap(), null, new OkHttpClient(), "stream");
            try (Socket downstream = new Socket("127.0.0.1", proxy.ensureStarted())) {
                downstream.setSoTimeout(2000);
                String path = new URL(proxy.buildUrl(url, "stream")).getFile();
                downstream.getOutputStream().write(("GET " + path + " HTTP/1.1\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                BufferedReader response = new BufferedReader(new InputStreamReader(downstream.getInputStream(), StandardCharsets.US_ASCII));
                assertTrue(response.readLine().contains("200"));
                proxy.close();
                assertTrue("closing proxy must cancel the streaming OkHttp call", upstreamClosed.await(2, TimeUnit.SECONDS));
            }
            server.join(4500);
            assertNull(upstreamError.get());
        } finally { cleanup(proxy); }
    }

    @Test public void malformedAndOversizedRequestsDoNotBlockLaterRequests() throws Exception {
        LocalStreamProxy proxy = new LocalStreamProxy();
        try {
            int port = proxy.ensureStarted();
            String[] invalid = {
                "GET /stream?url=%ZZ HTTP/1.1\r\n\r\n",
                "GET /" + "a".repeat(8200) + " HTTP/1.1\r\n\r\n",
                "GET /stream HTTP/1.1\r\n" + "X-Test: a\r\n".repeat(65) + "\r\n",
                "GET /stream HTTP/1.1\r\nX-Test: " + "a".repeat(8200) + "\r\n\r\n",
                "GET /stream HTTP/1.1\r\nX-Test: a\r\n"
            };
            for (String text : invalid) {
                try (Socket socket = new Socket("127.0.0.1", port)) {
                    socket.setSoTimeout(2000);
                    socket.getOutputStream().write(text.getBytes(StandardCharsets.US_ASCII));
                    socket.shutdownOutput();
                    BufferedReader response = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                    String status = response.readLine();
                    assertTrue("malformed request should have a 400 response", status != null && status.contains("400"));
                }
            }
        } finally { cleanup(proxy); }
    }

    private static void cleanup(LocalStreamProxy proxy) {
        try { proxy.close(); } catch (NullPointerException stoppedProxy) {
            // The idempotent-close regression asserts this failure separately.
        }
    }
}
