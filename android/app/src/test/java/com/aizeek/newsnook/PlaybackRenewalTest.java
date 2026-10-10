package com.aizeek.newsnook;

import static org.junit.Assert.*;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.Map;
import okhttp3.OkHttpClient;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PlaybackRenewalTest {
    private final String url = "https://cdn.example/manifest.mpd";
    private final OkHttpClient client = new OkHttpClient();

    @Before public void reset() { OriginHeaderStore.clear(); MediaSnifferPlugin.clearPlaybackContexts(); }
    @After public void clear() { MediaSnifferPlugin.clearPlaybackContexts(); OriginHeaderStore.clear(); }

    @Test public void repeatedRegistrationRetainsCredentialsAfterSnifferCacheExpires() throws Exception {
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-first"));
        register("first");
        expire("STORE", OriginHeaderStore.class);
        register("first");
        assertEquals("synthetic-first", MediaSnifferPlugin.findPlaybackContext(url, "first").headers.get("authorization"));
        register("second");
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "second").headers.get("authorization"));
    }

    @Test public void freshCaptureUpdatesOnlyTheExplicitlyRegisteredSession() {
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-first"));
        register("first");
        register("second");
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-new"));
        register("first");
        assertEquals("synthetic-new", MediaSnifferPlugin.findPlaybackContext(url, "first").headers.get("authorization"));
        assertEquals("synthetic-first", MediaSnifferPlugin.findPlaybackContext(url, "second").headers.get("authorization"));
    }

    @Test public void pausedSessionRetainsCredentialsBeyondLegacyTtl() throws Exception {
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-paused"));
        register("paused");
        expire("STORE", OriginHeaderStore.class);
        expire("PLAYBACK_CONTEXTS", MediaSnifferPlugin.class);
        assertNotNull("an owned session must survive a long pause", MediaSnifferPlugin.findPlaybackContext(url, "paused"));
        assertEquals("synthetic-paused", MediaSnifferPlugin.findPlaybackContext(url, "paused").headers.get("authorization"));
    }

    @Test public void renewDoesNotRebuildCredentialsOrReviveReleasedSessions() throws Exception {
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-owned"));
        register("owned");
        OriginHeaderStore.note(url, Collections.singletonMap("Authorization", "synthetic-other"));
        Method renew;
        try { renew = MediaSnifferPlugin.class.getDeclaredMethod("renewPlaybackSession", String.class); }
        catch (NoSuchMethodException missing) { fail("native playback needs an existing-session renewal operation"); return; }
        renew.setAccessible(true);
        assertEquals(true, renew.invoke(null, "owned"));
        assertEquals("synthetic-owned", MediaSnifferPlugin.findPlaybackContext(url, "owned").headers.get("authorization"));
        MediaSnifferPlugin.releasePlaybackSession("owned");
        assertEquals(false, renew.invoke(null, "owned"));
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "owned"));
    }

    @Test public void legacyContextStillExpires() throws Exception {
        register(null);
        expire("PLAYBACK_CONTEXTS", MediaSnifferPlugin.class);
        assertNull(MediaSnifferPlugin.findPlaybackContext(url));
    }

    @Test public void activityDestructionClearsOwnedContexts() throws Exception {
        register("owned");
        Method destroy;
        try { destroy = MediaSnifferPlugin.class.getDeclaredMethod("handleOnDestroy"); }
        catch (NoSuchMethodException missing) { fail("owned playback contexts need an Activity destruction boundary"); return; }
        destroy.setAccessible(true);
        destroy.invoke(new MediaSnifferPlugin());
        assertNull(MediaSnifferPlugin.findPlaybackContext(url, "owned"));
    }

    private void register(String session) {
        MediaSnifferPlugin.registerPlaybackContext(url, "dash", true, false, Collections.emptyMap(), null, client, session);
    }

    private static void expire(String name, Class<?> owner) throws Exception {
        Field field = owner.getDeclaredField(name);
        field.setAccessible(true);
        for (Object record : ((Map<?, ?>) field.get(null)).values()) {
            Field expiry = record.getClass().getDeclaredField("expiresAt");
            expiry.setAccessible(true);
            expiry.setLong(record, System.currentTimeMillis() - 1);
        }
    }
}
