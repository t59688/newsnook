package com.aizeek.newsnook;

import static org.junit.Assert.*;
import java.util.Collections;
import okhttp3.OkHttpClient;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlaybackSessionTest {
    @Before public void reset() { OriginHeaderStore.clear(); MediaSnifferPlugin.clearPlaybackContexts(); }

    @Test public void sameCdnSessionsKeepTheirOwnReferer() {
        String url = "https://cdn.example/play.m3u8";
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false,
            Collections.singletonMap("Referer", "https://first.example/"), null, new OkHttpClient(), "first");
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false,
            Collections.singletonMap("Referer", "https://second.example/"), null, new OkHttpClient(), "second");
        assertEquals("https://first.example/", MediaSnifferPlugin.findPlaybackContext("https://cdn.example/seg.ts", "first").headers.get("Referer"));
        assertEquals("https://second.example/", MediaSnifferPlugin.findPlaybackContext(url, "second").headers.get("Referer"));
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "missing"));
        assertNull(MediaSnifferPlugin.findPlaybackContext(url));
        MediaSnifferPlugin.releasePlaybackSession("second");
        assertNotNull(MediaSnifferPlugin.findPlaybackContext(url, "first"));
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "second"));
    }

    @Test public void activeSegmentRenewsPlaybackLeaseWithoutChangingOtherSession() {
        String url = "https://cdn.example/playlist.m3u8";
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false,
            Collections.singletonMap("Referer", "https://first.example/"), null, new OkHttpClient(), "first");
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false,
            Collections.singletonMap("Referer", "https://second.example/"), null, new OkHttpClient(), "second");
        MediaSnifferPlugin.PlaybackContext first = MediaSnifferPlugin.findPlaybackContext(url, "first");
        MediaSnifferPlugin.PlaybackContext second = MediaSnifferPlugin.findPlaybackContext(url, "second");
        assertNotNull(first);
        assertNotNull(second);
        assertNotNull(MediaSnifferPlugin.findPlaybackContext("https://cdn.example/segment.ts", "first"));
        assertNotNull(MediaSnifferPlugin.findPlaybackContext(url, "second"));
        MediaSnifferPlugin.releasePlaybackSession("first");
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "first"));
        assertNotNull(MediaSnifferPlugin.findPlaybackContext(url, "second"));
    }

    @Test public void nonInterceptingSessionCannotClearAnotherSession() {
        String url = "https://cdn.example/play.m3u8";
        MediaSnifferPlugin.registerPlaybackContext(url, "hls", true, false, Collections.emptyMap(), null, new OkHttpClient(), "first");
        MediaSnifferPlugin.registerPlaybackContext("https://cdn.example/video.mp4", "progressive", false, false,
            Collections.emptyMap(), null, null, "second");
        assertNotNull(MediaSnifferPlugin.findPlaybackContext(url, "first"));
    }

    @Test public void sessionMarkerPreflightIsLocalAndDoesNotExposeAuthentication() {
        String url = "https://cdn.example/play.mpd";
        MediaSnifferPlugin.registerPlaybackContext(url, "dash", true, false,
            Collections.singletonMap("Cookie", "test-cookie"), null, new OkHttpClient(), "first");
        java.util.Map<String, String> request = new java.util.HashMap<>();
        request.put("Origin", "https://localhost");
        request.put("Access-Control-Request-Method", "GET");
        request.put("Access-Control-Request-Headers", "x-newsnook-playback-session");
        android.webkit.WebResourceResponse response = MediaPlaybackWebViewClient.playbackPreflight(url, request);
        assertNotNull(response);
        assertEquals(204, response.getStatusCode());
        assertEquals("https://localhost", response.getResponseHeaders().get("Access-Control-Allow-Origin"));
        assertFalse(response.getResponseHeaders().containsKey("Cookie"));
        assertEquals(403, MediaPlaybackWebViewClient.playbackPreflight("https://unknown.example/play.mpd", request).getStatusCode());
        request.put("Access-Control-Request-Headers", "authorization");
        assertNull(MediaPlaybackWebViewClient.playbackPreflight(url, request));
        MediaSnifferPlugin.releasePlaybackSession("first");
        request.put("Access-Control-Request-Headers", "x-newsnook-playback-session");
        assertEquals(403, MediaPlaybackWebViewClient.playbackPreflight(url, request).getStatusCode());
    }
}
