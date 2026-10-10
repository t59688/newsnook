package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewLocalServer;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.net.ServerSocket;
import java.net.Socket;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.OkHttpClient;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MediaPlaybackRequestTest {
    private ServerSocket upstream;
    private String url;
    private MediaPlaybackWebViewClient webClient;
    private final AtomicReference<Map<String, String>> received = new AtomicReference<>();

    @Before public void setUp() throws Exception {
        OriginHeaderStore.clear(); MediaSnifferPlugin.clearPlaybackContexts();
        upstream = new ServerSocket(0);
        Thread server = new Thread(() -> {
            try (Socket socket = upstream.accept()) {
                socket.setSoTimeout(3000);
                BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                reader.readLine();
                Map<String, String> headers = new HashMap<>();
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    int colon = line.indexOf(':');
                    if (colon > 0) headers.put(line.substring(0, colon).toLowerCase(), line.substring(colon + 1).trim());
                }
                received.set(headers);
                socket.getOutputStream().write("HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 2-4/8\r\nAccept-Ranges: bytes\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                socket.getOutputStream().write(new byte[] { 2, 3, 4 });
                socket.getOutputStream().flush();
            } catch (java.io.IOException error) {
                if (!upstream.isClosed()) throw new AssertionError(error);
            }
        });
        server.setDaemon(true); server.start();
        url = "http://127.0.0.1:" + upstream.getLocalPort() + "/segment.ts";
        // Use Capacitor's real empty local-server routing table. No bridge/browser startup is needed.
        Class<?> unsafeClass = Class.forName("sun.misc.Unsafe");
        Field unsafeField = unsafeClass.getDeclaredField("theUnsafe"); unsafeField.setAccessible(true);
        Bridge bridge = (Bridge) unsafeClass.getMethod("allocateInstance", Class.class).invoke(unsafeField.get(null), Bridge.class);
        Constructor<?> constructor = WebViewLocalServer.class.getDeclaredConstructors()[0];
        constructor.setAccessible(true);
        Object local = constructor.newInstance(RuntimeEnvironment.getApplication(), bridge, null, new ArrayList<String>(), false);
        Field field = Bridge.class.getDeclaredField("localServer"); field.setAccessible(true); field.set(bridge, local);
        webClient = new MediaPlaybackWebViewClient(bridge);
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-session"));
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false, Collections.emptyMap(), null, new OkHttpClient(), "active");
    }

    @After public void tearDown() throws Exception { upstream.close(); MediaSnifferPlugin.clearPlaybackContexts(); OriginHeaderStore.clear(); }

    @Test public void authenticatedRangeResponseIsReadableWithoutUpstreamCors() throws Exception {
        WebResourceResponse response = webClient.shouldInterceptRequest(null, request("active"));
        assertNotNull(response);
        assertEquals(206, response.getStatusCode());
        assertArrayEquals(new byte[] { 2, 3, 4 }, response.getData().readAllBytes());
        assertEquals("https://localhost", header(response.getResponseHeaders(), "access-control-allow-origin"));
        assertTrue(header(response.getResponseHeaders(), "access-control-expose-headers").toLowerCase().contains("content-range"));
        assertEquals("synthetic-session", received.get().get("authorization"));
        assertEquals("bytes=2-4", received.get().get("range"));
        assertNull(received.get().get("x-newsnook-playback-session"));
    }

    @Test public void wrongSessionMarkerIsBlockedInsteadOfFallingThrough() {
        WebResourceResponse response = webClient.shouldInterceptRequest(null, request("wrong"));
        assertNotNull("invalid internal marker must never escape to a CDN", response);
        assertEquals(403, response.getStatusCode());
        assertNull(received.get());
    }

    @Test public void releasedSessionMarkerIsBlocked() {
        MediaSnifferPlugin.releasePlaybackSession("active");
        WebResourceResponse response = webClient.shouldInterceptRequest(null, request("active"));
        assertNotNull(response);
        assertEquals(403, response.getStatusCode());
        assertNull(received.get());
    }

    @Test public void unscopedProgressiveSessionCanPreflightItsExactUrl() {
        MediaSnifferPlugin.releasePlaybackSession("active");
        String progressive = url.replace("segment.ts", "video.mp4");
        MediaSnifferPlugin.registerPlaybackContext(progressive, "progressive", true, false, Collections.emptyMap(), null, new OkHttpClient(), "progressive");
        Map<String, String> headers = new HashMap<>();
        headers.put("Origin", "https://localhost");
        headers.put("Access-Control-Request-Method", "GET");
        headers.put("Access-Control-Request-Headers", "x-newsnook-playback-session, range");
        assertNotNull(MediaPlaybackWebViewClient.playbackPreflight(progressive, headers));
    }

    @Test public void unknownMarkerPreflightIsRejectedLocally() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Origin", "https://localhost");
        headers.put("Access-Control-Request-Method", "GET");
        headers.put("Access-Control-Request-Headers", "x-newsnook-playback-session");
        WebResourceResponse response = MediaPlaybackWebViewClient.playbackPreflight("https://unknown.example/segment.ts", headers);
        assertNotNull("an internal marker preflight must never reach an unregistered origin", response);
        assertEquals(403, response.getStatusCode());
        headers.put("Access-Control-Request-Headers", "x-newsnook-playback-session, authorization");
        assertEquals(403, MediaPlaybackWebViewClient.playbackPreflight(url, headers).getStatusCode());
    }

    private WebResourceRequest request(String session) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Origin", "https://localhost"); headers.put("Range", "bytes=2-4"); headers.put("X-NewsNook-Playback-Session", session);
        return new WebResourceRequest() {
            public Uri getUrl() { return Uri.parse(url); }
            public boolean isForMainFrame() { return false; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return false; }
            public String getMethod() { return "GET"; }
            public Map<String, String> getRequestHeaders() { return headers; }
        };
    }

    private String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> entry : headers.entrySet()) if (name.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        return null;
    }
}
