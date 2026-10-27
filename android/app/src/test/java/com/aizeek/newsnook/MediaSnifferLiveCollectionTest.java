package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.os.Looper;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Map;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class MediaSnifferLiveCollectionTest {
    static class TestPlugin extends MediaSnifferPlugin {
        final AppCompatActivity activity;
        final List<JSObject> messages = new ArrayList<>();
        TestPlugin(AppCompatActivity activity) { this.activity = activity; }
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override protected void notifyListeners(String name, JSObject value) { messages.add(value); }
        void pauseActivity() { handleOnPause(); }
        void resumeActivity() { handleOnResume(); }
    }
    static class Call extends PluginCall {
        int resolutions;
        Call(String method, JSObject data) { super(null,"MediaSniffer","test",method,data); }
        @Override public void resolve() { resolutions++; }
        @Override public void resolve(JSObject data) { resolutions++; }
        @Override public void reject(String message) { fail(message); }
    }
    static class ObservedView extends WebView {
        int collections;
        ValueCallback<String> pending;
        ObservedView(AppCompatActivity activity) { super(activity); }
        @Override public void evaluateJavascript(String script, ValueCallback<String> callback) {
            if (script.contains("__newsnookCollectMedia")) { collections++; pending = callback; }
            else if (callback != null) callback.onReceiveValue("null");
        }
    }
    static class Fixture {
        final TestPlugin plugin;
        final ObservedView view;
        final AtomicLong pageEpoch = new AtomicLong(1);
        Fixture() throws Exception {
            var controller = Robolectric.buildActivity(AppCompatActivity.class);
            controller.get().setTheme(androidx.appcompat.R.style.Theme_AppCompat);
            AppCompatActivity activity = controller.setup().get();
            plugin = new TestPlugin(activity);
            view = new ObservedView(activity);
            FrameLayout host = new FrameLayout(activity);
            activity.setContentView(host); host.addView(view);
            ((AtomicBoolean) field(plugin,"liveActive")).set(true);
            set(plugin,"liveSessionEpoch",1L); set(plugin,"liveSessionId","test-session");
            set(plugin,"liveWebView",view); set(plugin,"liveHost",host);
            set(plugin,"liveNetworkEvents",new JSONArray()); set(plugin,"livePageEpoch",pageEpoch);
            set(plugin,"liveObservationGate",new LiveMediaObservationGate(20));
            invoke(plugin,"startLivePolling",new Class<?>[]{WebView.class,long.class,String.class,String.class,AtomicLong.class},view,1L,"test-session","test-nonce",pageEpoch);
        }
        void drain(int height) throws Exception {
            JSONObject event = new JSONObject().put("source","dom").put("url","https://cdn.example/main.mp4")
                .put("pageUrl","https://video.example/watch/1").put("height",height);
            ValueCallback<String> callback = view.pending; view.pending=null;
            assertNotNull(callback);
            callback.onReceiveValue(JSONObject.quote(new JSONArray().put(event).toString()));
        }
        void close() throws Exception { invoke(plugin,"stopLiveSessionOnUi",new Class<?>[]{String.class},(Object)null); }
    }
    private static Object field(Object target,String name) throws Exception { Field field=MediaSnifferPlugin.class.getDeclaredField(name);field.setAccessible(true);return field.get(target); }
    private static void set(Object target,String name,Object value) throws Exception { Field field=MediaSnifferPlugin.class.getDeclaredField(name);field.setAccessible(true);field.set(target,value); }
    private static Object invoke(Object target,String name,Class<?>[] types,Object... args) throws Exception { Method method=MediaSnifferPlugin.class.getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(target,args); }
    private static void tick() { Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1)); }

    @Test public void collectionIsSingleFlightAndEmitsEnrichedDomObservations() throws Exception {
        Fixture f=new Fixture();
        try {
            tick(); tick(); assertEquals(1,f.view.collections);
            f.drain(720); assertEquals(1,f.plugin.messages.size());
            tick(); f.drain(720); assertEquals(1,f.plugin.messages.size());
            tick(); f.drain(1080); assertEquals(2,f.plugin.messages.size());
        } finally { f.close(); }
    }
    @Test public void stoppedOrReplacedPageCannotPublishPendingJavascriptResults() throws Exception {
        Fixture f=new Fixture();
        tick(); f.pageEpoch.incrementAndGet(); f.drain(720); assertEquals(0,f.plugin.messages.size());
        tick(); ValueCallback<String> late=f.view.pending;f.close();
        late.onReceiveValue(JSONObject.quote("[{\"source\":\"dom\",\"url\":\"https://cdn.example/old.mp4\",\"pageUrl\":\"https://video.example/watch/1\"}]"));
        assertEquals(0,f.plugin.messages.size());
    }
    @Test public void pausedActivityDoesNotExecuteJavascriptCollections() throws Exception {
        Fixture f=new Fixture();
        try {
            tick();f.drain(720);f.plugin.pauseActivity();int count=f.view.collections;
            tick();tick();assertEquals(count,f.view.collections);
            f.plugin.resumeActivity();tick();assertEquals(count+1,f.view.collections);
        }finally{f.close();}
    }
    @Test public void returningFromCustomPlaybackRestartsTheExistingCollector() throws Exception {
        Fixture f=new Fixture();
        try {
            tick();f.drain(720);
            invoke(f.plugin,"setLiveSessionVisibleOnUi",new Class<?>[]{boolean.class},false);
            int count=f.view.collections;tick();assertEquals(count,f.view.collections);
            invoke(f.plugin,"setLiveSessionVisibleOnUi",new Class<?>[]{boolean.class},true);
            tick();assertEquals(count+1,f.view.collections);
        }finally{f.close();}
    }
    @Test public void cancellationReleasesTheFiniteOwnedViewWithoutWaitingForTheDeadline() throws Exception {
        Fixture f=new Fixture();
        try {
            JSObject options=new JSObject();options.put("url","https://video.example/watch/1");options.put("sessionId","finite-test");options.put("timeoutMs",6000);
            Call sniff=new Call("sniff",options);
            FrameLayout root=f.plugin.activity.findViewById(android.R.id.content);
            int initial=root.getChildCount();
            f.plugin.sniff(sniff);
            assertEquals(initial+1,root.getChildCount());
            assertEquals(1,((Map<?,?>)field(f.plugin,"finiteSniffCancellations")).size());
            JSObject cancelOptions=new JSObject();cancelOptions.put("sessionId","finite-test");
            f.plugin.cancelSniff(new Call("cancelSniff",cancelOptions));
            assertEquals(1,sniff.resolutions);
            assertEquals(initial,root.getChildCount());
            assertEquals(0,((Map<?,?>)field(f.plugin,"finiteSniffCancellations")).size());
        }finally{f.close();}
    }
}
