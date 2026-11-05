package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.view.ViewGroup;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class CatalogSnapshotLifecycleTest {
    private static final class Call extends PluginCall {
        int resolves;
        int rejects;
        String error;

        Call(String method, String sessionId) {
            super(null, "CatalogSnapshot", sessionId, method, options(method, sessionId));
        }

        private static JSObject options(String method, String sessionId) {
            JSObject options = new JSObject().put("sessionId", sessionId);
            if ("render".equals(method)) options.put("url", "https://catalog.example/items");
            return options;
        }

        @Override public void resolve() { resolves++; }
        @Override public void resolve(JSObject data) { resolves++; }
        @Override public void reject(String message) { rejects++; error = message; }
    }

    private static CatalogSnapshotPlugin plugin(AppCompatActivity activity) {
        return new CatalogSnapshotPlugin() {
            @Override public AppCompatActivity getActivity() { return activity; }
            @Override public Context getContext() { return activity; }
        };
    }

    @Test public void supersedeAndCancelSettleEachRenderExactlyOnceAndRemoveTheirViews() {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        CatalogSnapshotPlugin plugin = plugin(activity);
        ViewGroup content = activity.findViewById(android.R.id.content);
        int initialChildren = content.getChildCount();

        Call first = new Call("render", "first");
        plugin.render(first);
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        assertEquals(initialChildren + 1, content.getChildCount());

        Call second = new Call("render", "second");
        plugin.render(second);
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        assertEquals(1, first.rejects);
        assertEquals(0, first.resolves);
        assertEquals(initialChildren + 1, content.getChildCount());

        Call cancel = new Call("cancel", "second");
        plugin.cancel(cancel);
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        assertEquals(1, second.rejects);
        assertEquals(0, second.resolves);
        assertEquals(1, cancel.resolves);
        assertEquals(initialChildren, content.getChildCount());

        plugin.handleOnDestroy();
        activity.finish();
    }

    @Test public void pauseCancelsTheActiveSnapshotAndLateCleanupDoesNotSettleItAgain() {
        AppCompatActivity activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        CatalogSnapshotPlugin plugin = plugin(activity);
        Call render = new Call("render", "pause-me");
        plugin.render(render);
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();

        plugin.handleOnPause();
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        plugin.handleOnDestroy();
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();

        assertEquals(1, render.rejects);
        assertEquals(0, render.resolves);
        activity.finish();
    }
}
