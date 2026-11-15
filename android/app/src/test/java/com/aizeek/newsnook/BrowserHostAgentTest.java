package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.graphics.Rect;
import android.app.AlertDialog;
import android.os.Looper;
import android.os.Handler;
import android.os.Message;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.JsResult;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.annotation.RealObject;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.shadow.api.Shadow;
import org.robolectric.util.ReflectionHelpers.ClassParameter;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, shadows = {BrowserHostAgentTest.ResponsiveWebView.class, BrowserHostAgentTest.RecordingJsResult.class})
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserHostAgentTest {
    @Implements(androidx.webkit.WebViewFeature.class)
    public static class VisualStateFeature {
        @Implementation protected static boolean isFeatureSupported(String feature) {
            return androidx.webkit.WebViewFeature.VISUAL_STATE_CALLBACK.equals(feature);
        }
    }
    @Implements(JsResult.class)
    public static class RecordingJsResult {
        boolean confirmed, cancelled;
        @Implementation protected void confirm() { confirmed = true; }
        @Implementation protected void cancel() { cancelled = true; }
    }
    @Implements(WebView.class)
    public static class ResponsiveWebView extends ShadowWebView {
        @RealObject private WebView realWebView;
        final List<Integer> touchActions = new ArrayList<>();
        boolean deferVisual;
        WebView.VisualStateCallback visualCallback;
        @Implementation protected boolean onTouchEvent(MotionEvent event) { touchActions.add(event.getActionMasked()); return true; }
        @Implementation protected boolean setFrame(int left, int top, int right, int bottom) {
            // The default WebView provider stub skips View.setFrame; use real View geometry.
            return Shadow.directlyOn(realWebView, View.class, "setFrame", ClassParameter.from(int.class, left),
                ClassParameter.from(int.class, top), ClassParameter.from(int.class, right), ClassParameter.from(int.class, bottom));
        }
        @Implementation protected void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (callback != null && "void 0".equals(script)) callback.onReceiveValue("null");
            else if (callback != null && script.startsWith("{\"action\":\"validate\"")) callback.onReceiveValue("{\"ok\":true}");
        }
        @Implementation protected void postVisualStateCallback(long id, WebView.VisualStateCallback callback) {
            if (deferVisual) visualCallback = callback; else callback.onComplete(id);
        }
    }
    private AppCompatActivity activity;
    private Host host;
    private static final class Call extends PluginCall {
        boolean resolved; String error; JSObject result;
        Call(String method, JSObject data) { super(null, "NewsNookBrowser", method, method, data); }
        @Override public void resolve() { resolved = true; }
        @Override public void resolve(JSObject data) { result = data; resolved = true; }
        @Override public void reject(String message) { error = message; }
        @Override public void reject(String message, Exception error) { this.error = message; }
    }
    private final class Host extends BrowserHostPlugin {
        final List<JSObject> sessionEvents = new ArrayList<>();
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Context getContext() { return activity; }
        @Override protected void notifyListeners(String name, JSObject data) {
            if ("agentSessionState".equals(name)) sessionEvents.add(data);
        }
    }
    @Before public void setUp() throws Exception {
        activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        host = new Host();
        Call open = new Call("open", new JSObject().put("url", "https://example.com/").put("embedded", true));
        host.open(open); await(open);
        WebView view = view();
        view.getWebViewClient().onPageStarted(view, "https://example.com/", null);
        view.getWebViewClient().onPageFinished(view, "https://example.com/");
    }
    @After public void tearDown() {
        host.close(new Call("close", new JSObject()));
        Shadows.shadowOf(Looper.getMainLooper()).idle(); activity.finish();
    }
    private void await(Call call) throws Exception {
        long end = System.nanoTime() + 5_000_000_000L;
        while (!call.resolved && call.error == null && System.nanoTime() < end) {
            Shadows.shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(5);
        }
        assertTrue("operation must settle", call.resolved || call.error != null);
    }
    private Object field(Object target, String key) throws Exception {
        Field field = target.getClass() == Host.class ? BrowserHostPlugin.class.getDeclaredField(key) : target.getClass().getDeclaredField(key);
        field.setAccessible(true); return field.get(target);
    }
    private void set(Object target, String key, Object value) throws Exception {
        Field field = target.getClass().getDeclaredField(key); field.setAccessible(true); field.set(target, value);
    }
    private Object tab() throws Exception { return field(host, "current"); }
    private WebView view() throws Exception { return (WebView) field(tab(), "webView"); }
    private Call session(String action, String runId) throws Exception {
        Call call = new Call("agentSession", new JSObject().put("action", action).put("runId", runId));
        host.agentSession(call); await(call); return call;
    }
    private JSObject args(Call start, String action, String run, String request) {
        return new JSObject().put("action", action).put("runId", run).put("requestId", request)
            .put("tabId", start.result.optInt("tabId", -1)).put("documentId", start.result.getString("documentId", ""));
    }

    private org.json.JSONObject viewport() throws Exception {
        Call state = new Call("state", new JSObject()); host.state(state);
        return state.result.getJSONObject("agentViewport");
    }

    private Rect visibleRect() throws Exception {
        org.json.JSONObject bounds = viewport().getJSONObject("visibleRect");
        return new Rect(bounds.getInt("left"), bounds.getInt("top"), bounds.getInt("right"), bounds.getInt("bottom"));
    }

    @Test @Config(shadows = {ResponsiveWebView.class, RecordingJsResult.class, VisualStateFeature.class},
        instrumentedPackages = {"androidx.webkit"})
    public void screenOffAfterScreenshotRegistrationDoesNotWaitForACompositorFrame() throws Exception {
        int[] visibility = {View.VISIBLE};
        WebView view = new WebView(activity) {
            @Override public int getWindowVisibility() { return visibility[0]; }
        };
        view.layout(0, 0, 360, 640);
        ResponsiveWebView shadow = Shadow.extract(view);
        shadow.deferVisual = true;
        BrowserAgentRuntime runtime = new BrowserAgentRuntime(view, "__ARGS__", () -> true, false);
        List<org.json.JSONObject> captures = new ArrayList<>();
        try {
            assertEquals("window visibility", View.VISIBLE, view.getWindowVisibility());
            assertTrue("visual callback feature", androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.VISUAL_STATE_CALLBACK));
            runtime.capture("run", "shot", 1, "snapshot", new Rect(0, 0, 360, 640), () -> true, captures::add, error -> fail(error));
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            assertNotNull(shadow.visualCallback); assertTrue(captures.isEmpty());
            visibility[0] = View.GONE;
            Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(250));
            assertEquals(1, captures.size());
            visibility[0] = View.VISIBLE;
            shadow.visualCallback.onComplete(0);
            assertEquals("a late compositor callback cannot complete twice", 1, captures.size());
        } finally { runtime.close(false); view.destroy(); }
    }

    @Test public void temporarySheetOcclusionRejectsTheShotButRestoringBoundsPreservesIt() throws Exception {
        WebView view = view(); FrameLayout frame = (FrameLayout) field(host, "pageFrame");
        frame.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY));
        frame.layout(0, 0, 360, 640); view.layout(0, 0, 360, 640);
        assertEquals("the WebView fixture must have a real width", 360, view.getWidth());
        assertEquals("the WebView fixture must have a real height", 640, view.getHeight());
        BrowserAgentRuntime runtime = new BrowserAgentRuntime(view, "__ARGS__", () -> true, false);
        ((BrowserAgentRuntime) field(tab(), "agent")).close(false); set(tab(), "agent", runtime);
        List<org.json.JSONObject> captures = new ArrayList<>();
        runtime.capture("run", "shot", 1, "snapshot", new Rect(0, 0, 360, 640), () -> true, captures::add, error -> fail(error));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertEquals(1, captures.size()); String shotId = captures.get(0).getString("shotId");
        assertTrue(runtime.validateShot(shotId, visibleRect()));
        host.setBounds(new Call("setBounds", new JSObject().put("occludedBottom", 200)));
        assertTrue(viewport().getBoolean("visible")); assertTrue(viewport().getBoolean("occluded"));
        assertFalse("the current sheet blocks coordinates from the full-page screenshot", runtime.validateShot(shotId, visibleRect()));
        host.setBounds(new Call("setBounds", new JSObject().put("occludedBottom", 0)));
        assertFalse(viewport().getBoolean("occluded"));
        assertTrue("restoring only the overlay must preserve the unchanged webpage shot", runtime.validateShot(shotId, visibleRect()));
        view.layout(0, 0, 361, 640); view.layout(0, 0, 360, 640);
        assertFalse("a real layout change invalidates the shot even when dimensions later match", runtime.validateShot(shotId, visibleRect()));
    }

    @Test public void coveringThePageDuringALongPressCancelsBeforeAnotherTouchCanBeDelivered() throws Exception {
        WebView view = view(); FrameLayout frame = (FrameLayout) field(host, "pageFrame");
        frame.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY));
        frame.layout(0, 0, 360, 640); view.layout(0, 0, 360, 640);
        BrowserAgentRuntime runtime = new BrowserAgentRuntime(view, "__ARGS__", () -> true, false);
        ((BrowserAgentRuntime) field(tab(), "agent")).close(false); set(tab(), "agent", runtime);
        Call start = session("start", "run");
        List<org.json.JSONObject> captures = new ArrayList<>();
        runtime.capture("run", "shot", 1, "snapshot", visibleRect(), () -> true, captures::add, error -> fail(error));
        Shadows.shadowOf(Looper.getMainLooper()).idle(); assertEquals(1, captures.size());
        org.json.JSONObject gesture = new org.json.JSONObject().put("kind", "long_press").put("durationMs", 1_000)
            .put("points", new org.json.JSONArray().put(new org.json.JSONObject().put("x", 100).put("y", 500)));
        Call press = new Call("agentAction", args(start, "gesture", "run", "press")
            .put("shotId", captures.get(0).getString("shotId")).put("gesture", gesture));
        host.agentAction(press); assertFalse(press.resolved); assertNull(press.error);
        ResponsiveWebView received = Shadow.extract(view);
        assertEquals(java.util.Collections.singletonList(MotionEvent.ACTION_DOWN), received.touchActions);
        host.setBounds(new Call("setBounds", new JSObject().put("occludedBottom", 200)));
        assertTrue("occlusion must immediately settle the in-flight native gesture", press.resolved);
        assertTrue(press.result.getJSONObject("result").getBoolean("dispatched"));
        assertEquals("OUTCOME_UNKNOWN", press.result.getJSONObject("result").getString("code"));
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(2));
        assertEquals(java.util.Arrays.asList(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_CANCEL), received.touchActions);
    }

    @Test public void stopAcknowledgesOnlyAfterCancellingPreparedNavigation() throws Exception {
        Call start = session("start", "run"); assertNull(start.error);
        Object tab = tab(); WebView view = view();
        set(tab, "preparing", true);
        Call navigate = new Call("agentAction", args(start, "navigate", "run", "navigate").put("url", "https://example.com/later"));
        host.agentAction(navigate);
        assertFalse(navigate.resolved);
        Runnable queued = (Runnable) field(tab, "pendingNavigation"); assertNotNull(queued);
        Call stopped = session("stop", "run");
        assertNull(stopped.error); assertNotNull(navigate.error);
        queued.run();
        assertNotEquals("https://example.com/later", Shadows.shadowOf(view).getLastLoadedUrl());
    }

    @Test public void runningAgentSurvivesActivityPauseAndCanStillNavigate() throws Exception {
        FrameLayout frame = (FrameLayout) field(host, "pageFrame");
        frame.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY));
        frame.layout(0, 0, 360, 640); view().layout(0, 0, 360, 640);
        Call start = session("start", "run");
        assertNull(start.error);
        Rect bounds = visibleRect(); assertFalse(bounds.isEmpty());
        host.handleOnPause();
        assertEquals("running", ((BrowserAgentSession) field(host, "agentOwner")).state());
        assertFalse(visibleRect().isEmpty());
        assertEquals(view().getWidth(), visibleRect().width());
        assertEquals(view().getHeight(), visibleRect().height());
        assertTrue((boolean) field(host, "agentBackgroundHeld"));
        Call navigate = new Call("agentAction", args(start, "navigate", "run", "background-nav")
            .put("url", "https://example.com/background"));
        host.agentAction(navigate); await(navigate);
        assertNull(navigate.error);
        assertTrue(host.sessionEvents.isEmpty());
        host.handleOnResume();
        assertEquals("running", ((BrowserAgentSession) field(host, "agentOwner")).state());
        session("stop", "run");
        assertFalse((boolean) field(host, "agentBackgroundHeld"));
    }

    @Test public void pausedAgentCannotBeResumedFromBackground() throws Exception {
        session("start", "run"); session("pause", "run");
        host.handleOnPause();
        assertNotNull(session("resume", "run").error);
        assertEquals("paused", ((BrowserAgentSession) field(host, "agentOwner")).state());
    }

    @Test public void backgroundNewTabKeepsAUsableViewport() throws Exception {
        FrameLayout frame = (FrameLayout) field(host, "pageFrame");
        frame.measure(View.MeasureSpec.makeMeasureSpec(360, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(640, View.MeasureSpec.EXACTLY));
        frame.layout(0, 0, 360, 640); view().layout(0, 0, 360, 640);
        Call start = session("start", "run");
        host.handleOnPause();
        Call open = new Call("agentAction", args(start, "new_tab", "run", "background-tab")
            .put("url", "https://example.com/new"));
        host.agentAction(open); await(open);
        assertNull(open.error);
        assertTrue(view().getWidth() > 0); assertTrue(view().getHeight() > 0);
        assertFalse(visibleRect().isEmpty());
        assertTrue((boolean) field(host, "agentBackgroundHeld"));
    }

    @Test public void previousRunCannotStopOrNavigateAfterNewOwnerStarts() throws Exception {
        Call first = session("start", "first"); session("stop", "first");
        Call second = session("start", "second"); assertNull(second.error);
        assertNotNull(session("stop", "first").error);
        Call stale = new Call("agentAction", args(first, "navigate", "first", "old").put("url", "https://example.com/old"));
        host.agentAction(stale); assertNotNull(stale.error);
        assertEquals("running", ((BrowserAgentSession) field(host, "agentOwner")).state());
    }

    @Test public void sameUrlReloadInvalidatesNativeDocumentIdentity() throws Exception {
        Call start = session("start", "run");
        view().getWebViewClient().onPageStarted(view(), "https://example.com/", null);
        view().getWebViewClient().onPageFinished(view(), "https://example.com/");
        Call stale = new Call("agentAction", args(start, "click", "run", "old").put("snapshot", "snapshot").put("id", 0));
        host.agentAction(stale);
        assertNotNull(stale.error);
        assertNotEquals(start.result.getString("documentId"), ((BrowserAgentRuntime) field(tab(), "agent")).documentId());
    }

    @Test public void realUserTouchPausesOwnershipBeforePageReceivesTheTouch() throws Exception {
        session("start", "run");
        MotionEvent event = MotionEvent.obtain(1, 1, MotionEvent.ACTION_DOWN, 20, 20, 0);
        try { view().dispatchTouchEvent(event); } finally { event.recycle(); }
        assertEquals("paused", ((BrowserAgentSession) field(host, "agentOwner")).state());
        assertFalse(host.sessionEvents.isEmpty());
    }

    @Test public void newTabTransfersTheSameRunWithoutAllowingLateQueuedNavigation() throws Exception {
        Call start = session("start", "run");
        Call navigate = new Call("agentAction", args(start, "new_tab", "run", "new-tab").put("url", "https://example.com/new"));
        host.agentAction(navigate); await(navigate);
        assertNull(navigate.error);
        BrowserAgentSession owner = (BrowserAgentSession) field(host, "agentOwner");
        assertEquals("run", owner.runId()); assertTrue(owner.isRunning());
        assertNotEquals(start.result.optInt("tabId", -1), owner.tabId());
        assertEquals((int) field(tab(), "id"), owner.tabId());
    }

    @Test public void navigationAfterAMutatingFrameCommandReportsAnUnknownOutcome() throws Exception {
        Call start = session("start", "run");
        BrowserAgentRuntime runtime = (BrowserAgentRuntime) field(tab(), "agent");
        List<String> sent = new ArrayList<>();
        runtime.receive(new org.json.JSONObject().put("type", "ready").put("frameId", "frame")
            .put("documentId", "frame-document").put("url", "https://frame.example/").toString(),
            "https://frame.example", false, new Object(), sent::add);
        Call action = new Call("agentAction", args(start, "type", "run", "write")
            .put("frameId", "frame").put("frameDocumentId", "frame-document").put("id", 0)
            .put("snapshot", "snapshot").put("text", "example"));
        host.agentAction(action);
        assertEquals(1, sent.size()); assertFalse(action.resolved);
        view().getWebViewClient().onPageStarted(view(), "https://example.com/next", null);
        assertTrue(action.resolved); assertNull(action.error);
        org.json.JSONObject result = action.result.getJSONObject("result");
        assertTrue(result.getBoolean("dispatched")); assertEquals("OUTCOME_UNKNOWN", result.getString("code"));
    }

    @Test public void nativeConfirmationWaitsForTheUserAndPausesAgentOwnership() throws Exception {
        session("start", "run");
        JsResult result = Shadow.newInstanceOf(JsResult.class);
        RecordingJsResult observed = Shadow.extract(result);
        assertTrue(view().getWebChromeClient().onJsConfirm(view(), "https://example.com/", "是否继续？", result));
        assertEquals("paused", ((BrowserAgentSession) field(host, "agentOwner")).state());
        assertFalse(observed.confirmed); assertFalse(observed.cancelled);
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        assertTrue(dialog.isShowing()); dialog.getButton(AlertDialog.BUTTON_POSITIVE).performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue(observed.confirmed); assertFalse(observed.cancelled);
    }

    @Test public void browserCloseCancelsAnOutstandingJavaScriptDialog() throws Exception {
        JsResult result = Shadow.newInstanceOf(JsResult.class);
        RecordingJsResult observed = Shadow.extract(result);
        assertTrue(view().getWebChromeClient().onJsAlert(view(), "https://example.com/", "请确认", result));
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        host.close(new Call("close", new JSObject()));
        assertFalse(dialog.isShowing()); assertTrue(observed.cancelled); assertFalse(observed.confirmed);
    }

    @Test public void aModalDialogCanWaitAndAnExplicitStopCancelsItBeforeAcknowledging() throws Exception {
        session("start", "run");
        JsResult result = Shadow.newInstanceOf(JsResult.class);
        RecordingJsResult observed = Shadow.extract(result);
        view().getWebChromeClient().onJsConfirm(view(), "https://example.com/", "请确认", result);
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(30));
        assertTrue(dialog.isShowing()); assertFalse(observed.cancelled);
        assertNotNull(session("resume", "run").error);
        Call stopped = session("stop", "run");
        assertNull(stopped.error); assertTrue(stopped.resolved);
        assertTrue(observed.cancelled); assertFalse(observed.confirmed); assertFalse(dialog.isShowing());
        assertEquals("stopped", ((BrowserAgentSession) field(host, "agentOwner")).state());
    }

    @Test public void aDialogOpeningDuringAPendingRendererDrainSuspendsItsDeadline() throws Exception {
        session("start", "run");
        BrowserAgentRuntime runtime = (BrowserAgentRuntime) field(tab(), "agent");
        List<String> sent = new ArrayList<>(); Object port = new Object();
        runtime.receive(new org.json.JSONObject().put("type", "ready").put("frameId", "frame")
            .put("documentId", "frame-document").toString(), "https://frame.example", false, port, sent::add);
        runtime.executeFrame("run", "pending", "frame", "frame-document", new org.json.JSONObject().put("action", "observe"),
            result -> {}, error -> {});
        Call paused = new Call("agentSession", new JSObject().put("action", "pause").put("runId", "run"));
        host.agentSession(paused); assertFalse(paused.resolved);
        view().getWebChromeClient().onJsConfirm(view(), "https://example.com/", "请确认", Shadow.newInstanceOf(JsResult.class));
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(30));
        assertNull("a visible modal must not time out an already-issued barrier", paused.error);
        assertFalse(paused.resolved);
        ShadowAlertDialog.getLatestAlertDialog().getButton(AlertDialog.BUTTON_NEGATIVE).performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        org.json.JSONObject cancel = new org.json.JSONObject(sent.get(1));
        runtime.receive(new org.json.JSONObject().put("type", "cancel_ack").put("frameId", "frame")
            .put("documentId", "frame-document").put("runId", "run").put("requestId", cancel.getString("requestId")).toString(),
            "https://frame.example", false, port, sent::add);
        assertTrue(paused.resolved); assertNull(paused.error);
    }

    @Test public void aGesturePopupUsesANewManagedTabAndPausesTheAgent() throws Exception {
        Call start = session("start", "run");
        WebView opener = view();
        WebView.WebViewTransport transport = opener.new WebViewTransport();
        int[] delivered = {0};
        Message response = Message.obtain(new Handler(Looper.getMainLooper(), message -> { delivered[0]++; return true; }));
        response.obj = transport;
        assertTrue(opener.getWebChromeClient().onCreateWindow(opener, false, true, response));
        assertNotSame(opener, view()); assertSame(view(), transport.getWebView());
        assertTrue(view().getSettings().supportMultipleWindows());
        assertTrue((boolean) field(tab(), "hasLoaded"));
        assertEquals("paused", ((BrowserAgentSession) field(host, "agentOwner")).state());
        assertNotEquals(start.result.optInt("tabId", -1), (int) field(tab(), "id"));
        Shadows.shadowOf(Looper.getMainLooper()).idle(); assertEquals(1, delivered[0]);
    }

    @Test @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    public void sheetBackdropDimsOnlyExposedPageAndAddsElevationAtTheBoundary() throws Exception {
        Class<?> frameClass = field(host, "pageFrame").getClass();
        java.lang.reflect.Constructor<?> constructor = frameClass.getDeclaredConstructor(Context.class);
        constructor.setAccessible(true);
        View frame = (View) constructor.newInstance(activity);
        frame.setBackgroundColor(android.graphics.Color.WHITE);
        frame.layout(0, 0, 200, 400);
        java.lang.reflect.Method occlude = frameClass.getDeclaredMethod("setOccludedBottom", int.class);
        occlude.setAccessible(true);
        occlude.invoke(frame, 100);
        android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(200, 400, android.graphics.Bitmap.Config.ARGB_8888);
        frame.draw(new android.graphics.Canvas(bitmap));
        int page = android.graphics.Color.red(bitmap.getPixel(100, 20));
        int shadow = android.graphics.Color.red(bitmap.getPixel(100, 299));
        assertTrue("the exposed page recedes behind the drawer", page < 255 && page > 200);
        assertTrue("elevation is strongest at the drawer boundary", shadow < page);
        assertEquals("the native layer must not paint over the HTML drawer", 0, bitmap.getPixel(100, 350));
        occlude.invoke(frame, 0);
        bitmap.eraseColor(android.graphics.Color.TRANSPARENT);
        frame.draw(new android.graphics.Canvas(bitmap));
        assertEquals("minimizing the drawer removes its backdrop", android.graphics.Color.WHITE, bitmap.getPixel(100, 299));
        bitmap.recycle();
    }

    @Test public void operationIndicatorFollowsBoundsAndStopsAnimatingWhenHidden() throws Exception {
        View frame = (View) field(host, "pageFrame");
        WebView page = view();
        Call operating = new Call("setBounds", new JSObject().put("visible", true)
            .put("agentOperating", true).put("occludedBottom", 180));
        host.setBounds(operating); await(operating);
        assertEquals(true, field(frame, "agentOperating"));
        assertTrue((int) field(frame, "occludedBottomPx") > 0);
        assertSame("the indicator must not replace or resize the page", page, view());

        Call hidden = new Call("setBounds", new JSObject().put("visible", false).put("agentOperating", true));
        host.setBounds(hidden); await(hidden);
        assertEquals(View.GONE, frame.getVisibility());
        assertNull("hidden web content must not keep a breathing animator", field(frame, "agentBreathing"));

        Call stopped = new Call("setBounds", new JSObject().put("visible", true).put("agentOperating", false));
        host.setBounds(stopped); await(stopped);
        assertEquals(false, field(frame, "agentOperating"));
        assertNull(field(frame, "agentBreathing"));
        assertEquals(View.VISIBLE, frame.getVisibility());
    }

    @Test public void nestedGesturePopupsReturnToTheirOpenerAfterEachHome() throws Exception {
        WebView first = view();
        int aId = (int) field(tab(), "id");
        WebView.WebViewTransport bTransport = first.new WebViewTransport();
        Message bMessage = Message.obtain(new Handler(Looper.getMainLooper())); bMessage.obj = bTransport;
        assertTrue(first.getWebChromeClient().onCreateWindow(first, false, true, bMessage));
        WebView second = view();
        assertEquals("new popup must remember its opener", aId, (int) field(tab(), "openerTabId"));
        second.getWebViewClient().onPageStarted(second, "https://example.com/b", null);
        second.getWebViewClient().onPageFinished(second, "https://example.com/b");
        int bId = (int) field(tab(), "id");

        WebView.WebViewTransport cTransport = second.new WebViewTransport();
        Message cMessage = Message.obtain(new Handler(Looper.getMainLooper())); cMessage.obj = cTransport;
        assertTrue(second.getWebChromeClient().onCreateWindow(second, false, true, cMessage));
        WebView third = view();
        assertEquals(bId, (int) field(tab(), "openerTabId"));
        third.getWebViewClient().onPageStarted(third, "https://example.com/c", null);
        third.getWebViewClient().onPageFinished(third, "https://example.com/c");

        host.navigate(new Call("navigate", new JSObject().put("action", "back")));
        assertEquals("about:blank", field(tab(), "url"));
        assertSame("first back in C must not switch away from C", third, view());
        host.navigate(new Call("navigate", new JSObject().put("action", "back")));
        assertEquals(bId, (int) field(tab(), "id"));
        assertEquals(2, ((List<?>) field(host, "tabs")).size());
        host.navigate(new Call("navigate", new JSObject().put("action", "back")));
        assertEquals("about:blank", field(tab(), "url"));
        host.navigate(new Call("navigate", new JSObject().put("action", "back")));
        assertEquals(aId, (int) field(tab(), "id"));
        assertEquals(1, ((List<?>) field(host, "tabs")).size());
    }

    @Test public void aPopupWithoutAUserGestureDoesNotCreateOrRedirectATab() throws Exception {
        WebView opener = view();
        WebView.WebViewTransport transport = opener.new WebViewTransport();
        Message response = Message.obtain(new Handler(Looper.getMainLooper())); response.obj = transport;
        assertFalse(opener.getWebChromeClient().onCreateWindow(opener, false, false, response));
        assertSame(opener, view()); assertNull(transport.getWebView());
        assertEquals(1, ((List<?>) field(host, "tabs")).size());
    }
}
