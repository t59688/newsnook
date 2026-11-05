package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.pm.ActivityInfo;
import android.os.Message;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.activity.ComponentActivity;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class OriginVideoFullscreenTest {
    @Test public void fullscreenFillsHostAndBackRestoresInlinePlayer() {
        ComponentActivity activity = Robolectric.buildActivity(ComponentActivity.class).setup().get();
        FrameLayout host = new FrameLayout(activity);
        activity.setContentView(host);
        View inlinePlayer = new View(activity);
        host.addView(inlinePlayer, new FrameLayout.LayoutParams(320, 180));
        List<Boolean> immersive = new ArrayList<>();
        OriginVideoFullscreen client = new OriginVideoFullscreen(activity, host, immersive::add);
        AtomicInteger hidden = new AtomicInteger();
        View video = new View(activity);
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        int orientation = activity.getRequestedOrientation();
        client.onShowCustomView(video, hidden::incrementAndGet);
        assertEquals(2, host.getChildCount());
        ViewGroup fullscreen = (ViewGroup) video.getParent();
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, fullscreen.getLayoutParams().width);
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, fullscreen.getLayoutParams().height);
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, activity.getRequestedOrientation());
        assertTrue(fullscreen.getKeepScreenOn());
        activity.getOnBackPressedDispatcher().onBackPressed();
        assertEquals(orientation, activity.getRequestedOrientation());
        assertEquals(1, host.getChildCount());
        assertNull(video.getParent());
        assertEquals(1, hidden.get());
        assertEquals(java.util.Arrays.asList(true, false), immersive);
        client.onHideCustomView();
        assertEquals(1, hidden.get());
    }

    @Test public void duplicateRequestIsRejectedAndCleanupReleasesFirstCallback() {
        ComponentActivity activity = Robolectric.buildActivity(ComponentActivity.class).setup().get();
        FrameLayout host = new FrameLayout(activity);
        activity.setContentView(host);
        OriginVideoFullscreen client = new OriginVideoFullscreen(activity, host, active -> {});
        AtomicInteger first = new AtomicInteger(), duplicate = new AtomicInteger();
        client.onShowCustomView(new View(activity), first::incrementAndGet);
        client.onShowCustomView(new View(activity), duplicate::incrementAndGet);
        assertEquals(1, duplicate.get());
        assertEquals(1, host.getChildCount());
        client.onHideCustomView();
        assertEquals(1, first.get());
        assertEquals(0, host.getChildCount());
    }

    @Test public void exitRestoresAutomaticAndReverseLandscapeOrientationPolicies() {
        for (int original : new int[] {ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED,
                ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE}) {
            ComponentActivity activity = Robolectric.buildActivity(ComponentActivity.class).setup().get();
            activity.setRequestedOrientation(original);
            FrameLayout host = new FrameLayout(activity);
            activity.setContentView(host);
            OriginVideoFullscreen client = new OriginVideoFullscreen(activity, host, active -> {});
            client.onShowCustomView(new View(activity), () -> {});
            assertEquals(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE, activity.getRequestedOrientation());
            client.onHideCustomView();
            assertEquals(original, activity.getRequestedOrientation());
        }
    }

    @Test public void ownedOriginSurfaceRejectsPopupWindows() {
        ComponentActivity activity = Robolectric.buildActivity(ComponentActivity.class).setup().get();
        FrameLayout host = new FrameLayout(activity);
        activity.setContentView(host);
        OriginVideoFullscreen client = new OriginVideoFullscreen(activity, host, active -> {});
        assertFalse(client.onCreateWindow(null, false, true, Message.obtain()));
    }

    @Test public void playbackLinksOpenInOwnedWebViewWithoutGrantingPopupWindows() {
        ComponentActivity activity = Robolectric.buildActivity(ComponentActivity.class).setup().get();
        WebView origin = new WebView(activity);
        // CMS playback links frequently use target=_blank. With multiple windows
        // enabled and onCreateWindow() rejecting popups, their taps become no-ops.
        origin.getSettings().setSupportMultipleWindows(true);
        OriginVideoFullscreen.configureSameWindowPlaybackLinks(origin.getSettings());
        assertFalse(origin.getSettings().supportMultipleWindows());
        assertFalse(origin.getSettings().getJavaScriptCanOpenWindowsAutomatically());
        FrameLayout host = new FrameLayout(activity);
        OriginVideoFullscreen client = new OriginVideoFullscreen(activity, host, active -> {});
        assertFalse(client.onCreateWindow(origin, false, true, Message.obtain()));
    }
}
