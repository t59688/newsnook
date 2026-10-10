package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.view.View;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LiveSurfaceSessionTest {
    private static PluginCall call(JSObject data) {
        return new PluginCall(null, "MediaSniffer", "test", "test", data) {
            @Override public void resolve() {}
        };
    }
    private static void field(MediaSnifferPlugin plugin, String name, Object value) throws Exception {
        Field field = MediaSnifferPlugin.class.getDeclaredField(name);
        field.setAccessible(true);
        field.set(plugin, value);
    }
    @Test public void suppressionOverridesRequestsAndStaleSessionsCannotHideReplacement() throws Exception {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).get();
        MediaSnifferPlugin plugin = new MediaSnifferPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
        };
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        field(plugin, "liveWebView", view);
        field(plugin, "liveSessionId", "current");
        plugin.setLiveSurfaceSuppressed(call(new JSObject().put("suppressed", true)));
        plugin.setLiveSessionVisible(call(new JSObject().put("visible", true).put("sessionId", "current")));
        assertEquals(View.GONE, view.getVisibility());
        plugin.setLiveSurfaceSuppressed(call(new JSObject().put("suppressed", false)));
        assertEquals(View.VISIBLE, view.getVisibility());
        plugin.setLiveSessionVisible(call(new JSObject().put("visible", false).put("sessionId", "old")));
        assertEquals(View.VISIBLE, view.getVisibility());
        plugin.setLiveSessionVisible(call(new JSObject().put("visible", false).put("sessionId", "current")));
        plugin.setLiveSurfaceSuppressed(call(new JSObject().put("suppressed", true)));
        plugin.setLiveSurfaceSuppressed(call(new JSObject().put("suppressed", false)));
        assertEquals(View.GONE, view.getVisibility());
        view.destroy();
    }
}
