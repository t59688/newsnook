package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.PluginCall;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlaybackCookieIsolationTest {
    private ServerSocket upstream;
    private String url;
    private final LocalStreamProxy proxy = new LocalStreamProxy();
    private final BlockingQueue<Map<String, String>> received = new LinkedBlockingQueue<>();
    private final AtomicInteger requests = new AtomicInteger();
    private volatile boolean rotateCookie;
    private volatile boolean redirect;
    private volatile CountDownLatch unblockResponse;

    @Before public void setUp() throws Exception {
        MediaSnifferPlugin.clearPlaybackContexts(); OriginHeaderStore.clear();
        CookieManager.getInstance().removeAllCookies(null);
        upstream = new ServerSocket(0);
        url = "http://127.0.0.1:" + upstream.getLocalPort() + "/segment.ts";
        Thread server = new Thread(() -> {
            while (!upstream.isClosed()) {
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
                    received.add(headers);
                    int number = requests.incrementAndGet();
                    if (number == 1 && unblockResponse != null) {
                        try { unblockResponse.await(4, TimeUnit.SECONDS); }
                        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); return; }
                    }
                    String status = redirect && number == 1 ? "302 Found" : "200 OK";
                    String extra = rotateCookie && number == 1 ? "Set-Cookie: identity=session-a-rotated; Path=/\r\n" : "";
                    if (redirect && number == 1) extra += "Location: http://localhost:" + upstream.getLocalPort() + "/final.ts\r\n";
                    socket.getOutputStream().write(("HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Length: 1\r\n" + extra + "\r\nx").getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().flush();
                } catch (java.io.IOException error) {
                    if (!upstream.isClosed()) throw new AssertionError(error);
                }
            }
        });
        server.setDaemon(true); server.start();
    }

    @After public void tearDown() throws Exception {
        proxy.close(); upstream.close(); MediaSnifferPlugin.clearPlaybackContexts();
        OriginHeaderStore.clear(); CookieManager.getInstance().removeAllCookies(null);
    }

    @Test public void anotherPageCannotReplaceAnOwnedSessionCookieOnTheWire() throws Exception {
        cookie("session-a"); prepare("first");
        cookie("session-b"); prepare("second");
        assertEquals("identity=session-a", request("first").get("cookie"));
        assertEquals("identity=session-b", request("second").get("cookie"));
    }

    @Test public void aSessionWithoutCookiesCannotBorrowALaterPagesCookie() throws Exception {
        prepare("first");
        cookie("session-b"); prepare("second");
        assertNull(request("first").get("cookie"));
        assertEquals("identity=session-b", request("second").get("cookie"));
    }

    @Test public void responseCookiesRotateOnlyWithinTheirPlaybackSession() throws Exception {
        rotateCookie = true;
        cookie("session-a"); prepare("first");
        cookie("session-b"); prepare("second");
        assertEquals("identity=session-a", request("first").get("cookie"));
        assertEquals("identity=session-a-rotated", request("first").get("cookie"));
        assertEquals("identity=session-b", request("second").get("cookie"));
        assertEquals("identity=session-b", CookieManager.getInstance().getCookie(url));
    }

    @Test public void aRedirectCannotCopyTheOriginalOriginsSessionCookie() throws Exception {
        redirect = true;
        cookie("session-a"); prepare("first");
        assertEquals("identity=session-a", request("first").get("cookie"));
        Map<String, String> redirected = received.poll(3, TimeUnit.SECONDS);
        assertNotNull(redirected);
        assertNull(redirected.get("cookie"));
    }

    @Test public void legacyPlaybackKeepsUsingTheCurrentWebViewCookie() throws Exception {
        cookie("legacy-old"); prepare(null);
        cookie("legacy-current");
        assertEquals("identity=legacy-current", request(null).get("cookie"));
    }

    @Test public void originSeedCannotEraseCookiesCapturedAtTheMediaPath() throws Exception {
        url = "http://127.0.0.1:" + upstream.getLocalPort() + "/media/segment.ts";
        cookie("session-a");
        CookieManager.getInstance().setCookie(url, "media_identity=media-a; Path=/media");
        prepare("first");
        String sent = request("first").get("cookie");
        assertTrue("media path snapshot must survive registration of the origin root", sent.contains("media_identity=media-a"));
        assertTrue(sent.contains("identity=session-a"));
    }

    @Test public void addingAnOriginRetainsTheSessionsRotatedResponseCookie() throws Exception {
        rotateCookie = true;
        cookie("session-a"); prepare("first");
        assertEquals("identity=session-a", request("first").get("cookie"));
        prepare("first", true);
        assertEquals("identity=session-a-rotated", request("first").get("cookie"));
    }

    @Test public void addingAnOriginCannotCancelAnActiveMediaRequest() throws Exception {
        cookie("session-a"); prepare("first");
        unblockResponse = new CountDownLatch(1);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<Integer> response = executor.submit(() -> {
                HttpURLConnection connection = (HttpURLConnection) new URL(proxy.buildUrl(url, "first")).openConnection();
                connection.setReadTimeout(3000);
                try { return connection.getResponseCode(); } finally { connection.disconnect(); }
            });
            assertNotNull("initial media request must reach the upstream before origin expansion", received.poll(3, TimeUnit.SECONDS));
            prepare("first", true);
            unblockResponse.countDown();
            assertEquals("origin expansion must preserve the in-flight request", Integer.valueOf(200), response.get(3, TimeUnit.SECONDS));
        } finally { unblockResponse.countDown(); executor.shutdownNow(); }
    }

    private void cookie(String identity) { CookieManager.getInstance().setCookie(url, "identity=" + identity + "; Path=/"); }

    private void prepare(String session) {
        prepare(session, false);
    }

    private void prepare(String session, boolean addOrigin) {
        JSObject options = new JSObject();
        options.put("url", url); options.put("format", "hls"); options.put("intercept", true);
        JSArray origins = new JSArray(); origins.put("http://127.0.0.1:" + upstream.getLocalPort());
        if (addOrigin) origins.put("https://additional.example");
        options.put("origins", origins);
        if (session != null) options.put("sessionId", session);
        PluginCall call = new PluginCall(null, "MediaSniffer", "test", "preparePlayback", options) {
            @Override public void resolve() {}
            @Override public void reject(String message) { throw new AssertionError(message); }
        };
        new MediaSnifferPlugin().preparePlayback(call);
    }

    private Map<String, String> request(String session) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(proxy.buildUrl(url, session)).openConnection();
        connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
        try { assertEquals(200, connection.getResponseCode()); connection.getInputStream().readAllBytes(); }
        finally { connection.disconnect(); }
        Map<String, String> headers = received.poll(3, TimeUnit.SECONDS);
        assertNotNull("upstream must receive the real playback request", headers);
        return headers;
    }
}
