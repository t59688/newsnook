package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.os.SystemClock;
import java.time.Duration;
import java.util.Collections;
import okhttp3.OkHttpClient;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowSystemClock;

@RunWith(RobolectricTestRunner.class)
// Instrument application wall-clock calls; the test itself reads the paused clock directly.
@Config(sdk = 34, instrumentedPackages = {"com.aizeek.newsnook"})
@LooperMode(LooperMode.Mode.PAUSED)
public class PlaybackContextOrderingTest {
    private static final long FIXED_TIME = 1000L;
    private static final String FIRST = "https://cdn.example/a.m3u8";
    private static final String SECOND = "https://cdn.example/b.m3u8";
    private static final String SEGMENT = "https://cdn.example/segment.ts";
    private static final String SESSION = "ordered-session";

    @Before
    public void reset() {
        MediaSnifferPlugin.clearPlaybackContexts();
        OriginHeaderStore.clear();
        assertTrue(SystemClock.setCurrentTimeMillis(FIXED_TIME));
    }

    @After
    public void clear() {
        MediaSnifferPlugin.clearPlaybackContexts();
        OriginHeaderStore.clear();
    }

    @Test
    public void sameMillisecondRegistrationsChooseLatestInEitherUrlOrder() {
        for (String session : new String[] {null, SESSION}) {
            for (String[] order : new String[][] {{FIRST, SECOND}, {SECOND, FIRST}}) {
                MediaSnifferPlugin.clearPlaybackContexts();
                register(order[0], session);
                register(order[1], session);
                assertSelected(order[1], SEGMENT, session);
                assertEquals("registration must not advance the fixed test clock", FIXED_TIME, SystemClock.uptimeMillis());
            }
        }
    }

    @Test
    public void exactRequestWinsOverLaterSameOriginFallback() {
        for (String[] order : new String[][] {{FIRST, SECOND}, {SECOND, FIRST}}) {
            MediaSnifferPlugin.clearPlaybackContexts();
            register(order[0], SESSION);
            ShadowSystemClock.advanceBy(Duration.ofSeconds(1));
            register(order[1], SESSION);
            assertSelected(order[0], order[0], SESSION);
            assertSelected(order[1], SEGMENT, SESSION);
        }
    }

    @Test
    public void readingAndRenewingOlderContextDoesNotChangeRegistrationOrder() {
        register(FIRST, SESSION);
        register(SECOND, SESSION);
        ShadowSystemClock.advanceBy(Duration.ofSeconds(1));

        // An exact request renews the older context's lease, not its selection priority.
        MediaSnifferPlugin.PlaybackContext older = MediaSnifferPlugin.findPlaybackContext(FIRST, SESSION);
        assertNotNull(older);
        assertEquals(FIRST, older.originalUrl);
        assertSelected(SECOND, SEGMENT, SESSION);

        // Session renewal gives every context the same expiry, preserving the latest registration.
        ShadowSystemClock.advanceBy(Duration.ofSeconds(1));
        assertTrue(MediaSnifferPlugin.renewPlaybackSession(SESSION));
        assertSelected(SECOND, SEGMENT, SESSION);
    }

    @Test
    public void explicitReregistrationBecomesLatestWithinSameMillisecond() {
        register(FIRST, SESSION);
        register(SECOND, SESSION);
        register(FIRST, SESSION);
        assertSelected(FIRST, SEGMENT, SESSION);
        register(SECOND, SESSION);
        assertSelected(SECOND, SEGMENT, SESSION);
        assertEquals("replacement must not depend on elapsed wall time", FIXED_TIME, SystemClock.uptimeMillis());
    }

    private static void register(String url, String session) {
        MediaSnifferPlugin.registerPlaybackContext(
            url, "hls", true, false, Collections.emptyMap(), null, new OkHttpClient(), session
        );
    }

    private static void assertSelected(String expected, String request, String session) {
        MediaSnifferPlugin.PlaybackContext selected = MediaSnifferPlugin.findPlaybackContext(request, session);
        assertNotNull(selected);
        assertEquals(expected, selected.originalUrl);
    }
}
