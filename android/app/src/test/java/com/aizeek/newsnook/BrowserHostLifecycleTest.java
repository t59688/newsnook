package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.Looper;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.PopupWindow;
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
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowDialog;
import org.robolectric.shadows.ShadowWebView;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserHostLifecycleTest {
    private AppCompatActivity activity;
    private Host host;
    private static final RenderProcessGoneDetail CRASH = new RenderProcessGoneDetail() {
        @Override public boolean didCrash() { return true; }
        @Override public int rendererPriorityAtExit() { return WebView.RENDERER_PRIORITY_IMPORTANT; }
    };

    private static final class Call extends PluginCall {
        boolean resolved;
        String error;
        JSObject result;
        Call(String method, JSObject data) { super(null, "NewsNookBrowser", method, method, data); }
        @Override public void resolve() { resolved = true; }
        @Override public void resolve(JSObject data) { result = data; resolved = true; }
        @Override public void reject(String message) { error = message; }
        @Override public void reject(String message, Exception exception) { error = message; }
    }

    private final class Host extends BrowserHostPlugin {
        final List<String> events = new ArrayList<>();
        final List<JSObject> payloads = new ArrayList<>();
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Context getContext() { return activity; }
        @Override protected void notifyListeners(String name, JSObject data) {
            events.add(name);
            payloads.add(data);
        }
    }

    @Before public void setUp() {
        activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        host = new Host();
        host.takeRecoverySession(new Call("takeRecoverySession", new JSObject()));
    }

    @After public void tearDown() {
        host.close(new Call("close", new JSObject()));
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        activity.finish();
    }

    private Call open(String url) throws Exception {
        Call call = new Call("open", new JSObject().put("url", url).put("embedded", true));
        host.open(call);
        await(call);
        return call;
    }

    private void await(Call call) throws Exception {
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!call.resolved && call.error == null && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(5);
        }
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue("the native operation must settle", call.resolved || call.error != null);
    }

    private JSObject state() {
        Call call = new Call("state", new JSObject());
        host.state(call);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertTrue(call.resolved);
        return call.result;
    }

    private WebView currentView() throws Exception {
        Field current = BrowserHostPlugin.class.getDeclaredField("current");
        current.setAccessible(true);
        Object tab = current.get(host);
        if (tab == null) return null;
        Field webView = tab.getClass().getDeclaredField("webView");
        webView.setAccessible(true);
        return (WebView) webView.get(tab);
    }

    @org.robolectric.annotation.Implements(android.webkit.CookieManager.class)
    public static class CookiesWithPerViewPolicy extends org.robolectric.shadows.ShadowCookieManager {
        private static android.webkit.CookieManager instance;
        static int failOnPolicyCall;
        @org.robolectric.annotation.Implementation
        protected static android.webkit.CookieManager getInstance() {
            if (instance == null) instance = new android.webkit.RoboCookieManager() {
                private final java.util.Map<WebView, Boolean> policy = new java.util.IdentityHashMap<>();
                @Override public void setAcceptThirdPartyCookies(WebView view, boolean accept) {
                    if (failOnPolicyCall > 0 && --failOnPolicyCall == 0) throw new IllegalStateException("provider policy failure");
                    policy.put(view, accept);
                }
                @Override public boolean acceptThirdPartyCookies(WebView view) { return Boolean.TRUE.equals(policy.get(view)); }
            };
            return instance;
        }
        @org.robolectric.annotation.Resetter public static void resetPolicy() { instance = null; failOnPolicyCall = 0; }
    }

    @Test
    @Config(shadows = CookiesWithPerViewPolicy.class)
    public void browserSettingsApplyBeforeFirstDocumentLoads() throws Exception {
        JSObject settings = new JSObject().put("userAgentMode", "custom")
            .put("customUserAgent", "NewsNook-Test/1.0").put("textZoom", 150)
            .put("javaScriptEnabled", false).put("loadsImagesAutomatically", false)
            .put("thirdPartyCookiesEnabled", true).put("mediaPlaybackRequiresUserGesture", false);
        Call opening = new Call("open", new JSObject().put("url", "about:blank")
            .put("embedded", true).put("settings", settings));
        host.open(opening);
        await(opening);
        WebView view = currentView();
        assertFalse("site JavaScript follows browser preference before loading", view.getSettings().getJavaScriptEnabled());
        assertFalse(view.getSettings().getLoadsImagesAutomatically());
        assertEquals(150, view.getSettings().getTextZoom());
        assertEquals("NewsNook-Test/1.0", view.getSettings().getUserAgentString());
        assertFalse(view.getSettings().getMediaPlaybackRequiresUserGesture());
        assertTrue(android.webkit.CookieManager.getInstance().acceptThirdPartyCookies(view));
    }

    @Test public void privacySettingKeepsThePageAndNeverBackfillsPrivateVisits() throws Exception {
        assertNull(open("https://example.com/ordinary").error);
        WebView view = currentView();
        view.getWebViewClient().onPageStarted(view, "https://example.com/ordinary", null);
        int id = state().getInt("tabId");
        Call enabled = new Call("updateSettings", new JSObject().put("settings", new JSObject().put("privateMode", true)));
        host.updateSettings(enabled);
        await(enabled);
        assertNull(enabled.error);
        assertSame("privacy is a recording policy for the current WebView", view, currentView());
        assertEquals(id, state().getInt("tabId"));
        assertTrue("privacy persists without creating another Activity", state().getBoolean("privateMode", false));
        assertTrue(activity.getSharedPreferences("newsnook-native-browser", Context.MODE_PRIVATE).getBoolean("privacy-enabled", false));
        view.getWebViewClient().onPageStarted(view, "https://example.com/private", null);
        Call disabled = new Call("updateSettings", new JSObject().put("settings", new JSObject().put("privateMode", false)));
        host.updateSettings(disabled);
        await(disabled);
        view.getWebViewClient().onPageFinished(view, "https://example.com/private");
        assertFalse("a late private page completion cannot become public history", state().getBoolean("recordHistory", true));
        host.captureRecoverySession();
        Call privateRecovery = new Call("takeRecoverySession", new JSObject());
        host.takeRecoverySession(privateRecovery);
        assertTrue("private document metadata cannot enter recovery after the switch is off", privateRecovery.result.isNull("session"));
        view.getWebViewClient().onPageStarted(view, "https://example.com/next-public", null);
        view.getWebViewClient().onPageFinished(view, "https://example.com/next-public");
        assertTrue("a new public navigation can be recorded", state().getBoolean("recordHistory", false));
    }

    @Test public void mobileAgentChoicesAreAcceptedAndHaveConsistentPageSettings() throws Exception {
        for (String mode : new String[] {"android", "ios", "desktop", "system"}) {
            Call opening = new Call("open", new JSObject().put("url", "https://example.com/profile")
                .put("embedded", true).put("settings", new JSObject().put("userAgentMode", mode)));
            host.open(opening);
            await(opening);
            assertNull("the selected browser identity must be supported: " + mode, opening.error);
            String agent = currentView().getSettings().getUserAgentString();
            if ("android".equals(mode)) {
                assertTrue(agent.contains("Android"));
                assertFalse(agent.contains("; wv"));
            } else if ("ios".equals(mode)) assertTrue(agent.contains("iPhone"));
            else if ("desktop".equals(mode)) {
                assertFalse(agent.contains("Android"));
                assertFalse(agent.contains(" Mobile "));
                assertTrue(currentView().getSettings().getUseWideViewPort());
                assertTrue(currentView().getSettings().getLoadWithOverviewMode());
            }
        }
    }

    @Test public void invalidCustomAgentCannotReplaceOrMutateTheCurrentSession() throws Exception {
        assertNull(open("https://example.com/ordinary").error);
        WebView ordinary = currentView();
        String agent = ordinary.getSettings().getUserAgentString();
        JSObject invalid = new JSObject().put("userAgentMode", "custom")
            .put("customUserAgent", "Browser/1.0\r\nInjected: header");
        Call update = new Call("updateSettings", new JSObject().put("settings", invalid));
        host.updateSettings(update);
        await(update);
        assertNotNull("HTTP header separators must be rejected", update.error);
        assertSame(ordinary, currentView());
        assertEquals(agent, ordinary.getSettings().getUserAgentString());
        Call replacing = new Call("open", new JSObject().put("url", "https://example.com/new")
            .put("embedded", true).put("settings", invalid));
        host.open(replacing);
        await(replacing);
        assertNotNull(replacing.error);
        assertSame("validate settings before closing a valid ordinary tab", ordinary, currentView());
    }

    @Test
    @Config(shadows = BrowserMediaCaptureLifecycleTest.NoDocumentStart.class, instrumentedPackages = "androidx.webkit")
    public void unsupportedSiteCleanupLeavesTheDocumentAndCookiesUntouched() throws Exception {
        assertNull(open("https://example.com/ordinary").error);
        WebView ordinary = currentView();
        android.webkit.CookieManager cookies = android.webkit.CookieManager.getInstance();
        cookies.setCookie("https://example.com", "ordinary_session=preserve; Path=/");
        Call clear = new Call("clearSiteData", new JSObject().put("url", "https://example.com"));
        host.clearSiteData(clear);
        await(clear);
        assertNotNull("unsupported precise cleanup must fail closed", clear.error);
        assertSame(ordinary, currentView());
        assertTrue(cookies.getCookie("https://example.com").contains("ordinary_session=preserve"));
    }

    @Test public void embeddedProgressAndTitleDoNotRequireDialogChrome() throws Exception {
        assertNull(open("https://example.com/").error);
        WebView view = currentView();
        view.getWebViewClient().onPageStarted(view, "https://example.com/", null);
        view.getWebChromeClient().onProgressChanged(view, 45);
        view.getWebChromeClient().onReceivedTitle(view, "Example title");
        assertEquals("https://example.com/", state().getString("url"));
        assertEquals("Example title", state().getString("title"));
        assertEquals(45, state().getInt("progress"));
        JSObject navigation = host.payloads.get(host.payloads.size() - 1);
        assertEquals("Example title", navigation.getString("title"));
        assertEquals(state().getInt("tabId"), navigation.getInt("tabId"));
        assertTrue(navigation.getBoolean("loading", false));
    }

    @Test public void lastRendererExitKeepsAddressAndAllowsManualReload() throws Exception {
        assertNull(open("https://example.com/article").error);
        WebView dead = currentView();
        WebViewClient callback = dead.getWebViewClient();
        int id = state().getInt("tabId");
        host.events.clear();
        assertTrue(callback.onRenderProcessGone(dead, CRASH));
        assertEquals("https://example.com/article", state().getString("url"));
        assertEquals(id, state().getInt("tabId"));
        assertNull("the invalid WebView must be detached", dead.getParent());
        assertNull("the invalid WebView must not remain on the tab", currentView());
        assertFalse("a renderer failure must not close the browser", host.events.contains("closed"));
        assertTrue(host.events.contains("browserError"));

        Call reload = new Call("navigate", new JSObject().put("action", "reload"));
        host.navigate(reload);
        await(reload);
        assertNull(reload.error);
        assertNotNull(currentView());
        assertNotSame(dead, currentView());
        assertEquals(id, state().getInt("tabId"));

        callback.onPageStarted(dead, "https://stale.example/", null);
        callback.onPageFinished(dead, "https://stale.example/");
        assertEquals("https://example.com/article", state().getString("url"));
    }

    @Test public void backgroundRendererExitDoesNotDismissAnotherTabsFullscreen() throws Exception {
        assertNull(open("https://example.com/one").error);
        WebView background = currentView();
        WebViewClient backgroundClient = background.getWebViewClient();
        Call create = new Call("navigate", new JSObject().put("action", "new"));
        host.navigate(create);
        await(create);
        WebView foreground = currentView();
        final int[] hidden = { 0 };
        foreground.getWebChromeClient().onShowCustomView(new FrameLayout(activity), () -> hidden[0]++);
        assertTrue(backgroundClient.onRenderProcessGone(background, CRASH));
        assertEquals(0, hidden[0]);
        assertSame(foreground, currentView());
        assertEquals(2, tabs().getJSONArray("tabs").length());
        foreground.getWebChromeClient().onHideCustomView();
        assertEquals(1, hidden[0]);
    }

    @Test public void consecutiveRendererCallbacksKeepEveryTabRecoverable() throws Exception {
        assertNull(open("https://example.com/one").error);
        WebView first = currentView();
        WebViewClient firstClient = first.getWebViewClient();
        Call create = new Call("navigate", new JSObject().put("action", "new"));
        host.navigate(create);
        await(create);
        WebView second = currentView();
        WebViewClient secondClient = second.getWebViewClient();
        int activeId = state().getInt("tabId");
        assertTrue(secondClient.onRenderProcessGone(second, CRASH));
        assertTrue(firstClient.onRenderProcessGone(first, CRASH));
        assertEquals(2, tabs().getJSONArray("tabs").length());
        assertEquals(activeId, state().getInt("tabId"));
        assertFalse(state().getBoolean("loading", true));
    }

    private JSObject tabs() {
        Call call = new Call("tabs", new JSObject());
        host.tabs(call);
        return call.result;
    }

    private PopupWindow linkContextPopup() throws Exception {
        Field popup = BrowserHostPlugin.class.getDeclaredField("linkContextPopup");
        popup.setAccessible(true);
        return (PopupWindow) popup.get(host);
    }

    @Test public void longPressedWebLinkUsesCustomChromeAndOpensInANewBackgroundTab() throws Exception {
        assertNull(open("https://example.com/article").error);
        WebView article = currentView();
        int articleTabId = state().getInt("tabId");
        ShadowDialog.reset();
        Shadows.shadowOf(article).setHitTestResult(ShadowWebView.createHitTestResult(
            WebView.HitTestResult.SRC_ANCHOR_TYPE, "https://developer.android.com/guide"));

        assertTrue("a web link long-press must be handled by browser chrome", article.performLongClick());
        assertNull("link actions must never use a platform AlertDialog", ShadowDialog.getLatestDialog());
        PopupWindow menu = linkContextPopup();
        assertNotNull("the browser must show its custom link action surface", menu);
        View background = menu.getContentView().findViewWithTag("link-open-background");
        View foreground = menu.getContentView().findViewWithTag("link-open-foreground");
        View copyAddress = menu.getContentView().findViewWithTag("link-copy-address");
        View shareLink = menu.getContentView().findViewWithTag("link-share");
        assertNotNull(background);
        assertNotNull(foreground);
        assertNotNull(copyAddress);
        assertNotNull(shareLink);
        background.performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();

        org.json.JSONArray opened = tabs().getJSONArray("tabs");
        assertEquals(2, opened.length());
        assertEquals("https://developer.android.com/guide", opened.getJSONObject(1).getString("url"));
        assertFalse("the long-press action must preserve the reading context",
            opened.getJSONObject(1).getBoolean("active"));
        assertEquals(articleTabId, state().getInt("tabId"));
        assertSame(article, currentView());
    }

    @Test public void longPressedWebLinkCanOpenAndActivateANewTab() throws Exception {
        assertNull(open("https://example.com/article").error);
        WebView article = currentView();
        int articleTabId = state().getInt("tabId");
        Shadows.shadowOf(article).setHitTestResult(ShadowWebView.createHitTestResult(
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE, "https://developer.android.com/reference"));

        assertTrue(article.performLongClick());
        PopupWindow menu = linkContextPopup();
        assertNotNull(menu);
        menu.getContentView().findViewWithTag("link-open-foreground").performClick();
        Shadows.shadowOf(Looper.getMainLooper()).idle();

        assertEquals(2, tabs().getJSONArray("tabs").length());
        assertNotEquals(articleTabId, state().getInt("tabId"));
        assertEquals("https://developer.android.com/reference", state().getString("url"));
        assertNotSame(article, currentView());
    }

    @Test public void initiallyHiddenBrowserStaysHiddenThroughAsynchronousPreparation() throws Exception {
        Call opening = new Call("open", new JSObject().put("url", "https://example.com/")
            .put("embedded", true).put("visible", false));
        host.open(opening);
        assertFalse("script preparation must still be pending for this check", opening.resolved);
        Field frameField = BrowserHostPlugin.class.getDeclaredField("pageFrame");
        frameField.setAccessible(true);
        FrameLayout frame = (FrameLayout) frameField.get(host);
        assertEquals(View.GONE, frame.getVisibility());
        await(opening);
        assertNull(opening.error);
        assertEquals("selecting the prepared tab must preserve the overlay", View.GONE, frame.getVisibility());
        Call bounds = new Call("setBounds", new JSObject().put("visible", true));
        host.setBounds(bounds);
        assertTrue(bounds.resolved);
        assertEquals(View.VISIBLE, frame.getVisibility());
    }

    @Test public void internalBlankPageCanInitializeTheEmbeddedBrowser() throws Exception {
        Call call = open("about:blank");
        assertNull(call.error);
        assertTrue(call.resolved);
        assertEquals("about:blank", state().getString("url"));
    }

    @Test public void stoppingALoadPublishesItsFinalLoadingState() throws Exception {
        assertNull(open("https://example.com/slow").error);
        WebView view = currentView();
        view.getWebViewClient().onPageStarted(view, "https://example.com/slow", null);
        view.getWebChromeClient().onProgressChanged(view, 40);
        Call stop = new Call("navigate", new JSObject().put("action", "stop"));
        host.navigate(stop);
        assertNull(stop.error);
        assertTrue(stop.resolved);
        assertFalse(state().getBoolean("loading", true));
        assertEquals("state", host.payloads.get(host.payloads.size() - 1).getString("phase"));
    }

    private int completedNavigations() {
        int count = 0;
        for (JSObject payload : host.payloads) if ("end".equals(payload.getString("phase"))) count++;
        return count;
    }

    @Test public void onlyFinishedPagesPublishCompletedNavigation() throws Exception {
        Call opening = new Call("open", new JSObject().put("url", "https://example.com/one").put("embedded", true));
        host.open(opening);
        assertEquals("creating and selecting an unprepared tab must not record a visit", 0, completedNavigations());
        await(opening);
        assertEquals("preparing scripts is not a completed page load", 0, completedNavigations());
        WebView first = currentView();
        first.getWebChromeClient().onReceivedTitle(first, "Preparing example");
        first.getWebChromeClient().onProgressChanged(first, 30);
        host.navigate(new Call("navigate", new JSObject().put("action", "stop")));
        host.navigate(new Call("navigate", new JSObject().put("action", "new")));
        WebView background = currentView();
        host.activateTab(new Call("activateTab", new JSObject().put("index", 0)));
        assertSame(first, currentView());
        background.getWebViewClient().onPageFinished(background, "about:blank");
        assertEquals("title, progress, stop, selection and background pages are state updates", 0, completedNavigations());

        first.getWebViewClient().onPageStarted(first, "https://example.com/one", null);
        first.getWebViewClient().onPageFinished(first, "https://example.com/one");
        assertEquals(1, completedNavigations());
        first.getWebChromeClient().onReceivedTitle(first, "Finished example");
        first.getWebChromeClient().onProgressChanged(first, 100);
        assertEquals("late title or progress callbacks must not record the visit again", 1, completedNavigations());
    }

    @Test public void stoppingInitialPreparationKeepsTheAddressForReload() throws Exception {
        String url = "https://example.com/slow-scripts";
        Call opening = new Call("open", new JSObject().put("url", url).put("embedded", true));
        host.open(opening);
        WebView view = currentView();
        assertFalse(opening.resolved);
        assertNull("no document is loaded until script preparation finishes", view.getUrl());
        Call stop = new Call("navigate", new JSObject().put("action", "stop"));
        host.navigate(stop);
        assertTrue(stop.resolved);
        assertTrue("stop must release the pending open call", opening.resolved);
        assertFalse(state().getBoolean("loading", true));
        assertEquals(url, state().getString("url"));

        host.navigate(new Call("navigate", new JSObject().put("action", "reload")));
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!url.equals(view.getUrl()) && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(5);
        }
        assertSame(view, currentView());
        assertEquals("reload must load the retained address when the first document was cancelled", url, view.getUrl());
    }

    @Test public void closingDuringPreparationSettlesOpenAndDropsLateCallbacks() throws Exception {
        Call opening = new Call("open", new JSObject().put("url", "https://example.com/").put("embedded", true));
        host.open(opening);
        WebView view = currentView();
        WebViewClient callbacks = view.getWebViewClient();
        WebChromeClient chrome = view.getWebChromeClient();
        host.close(new Call("close", new JSObject()));
        assertEquals("浏览器已关闭", opening.error);
        int events = host.events.size();
        callbacks.onPageStarted(view, "https://stale.example/", null);
        callbacks.onPageFinished(view, "https://stale.example/");
        chrome.onProgressChanged(view, 100);
        chrome.onReceivedTitle(view, "Stale");
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertNull(currentView());
        assertEquals(events, host.events.size());
    }

    @Test
    @Config(shadows = CookiesWithPerViewPolicy.class)
    public void failedPrivacyChangeRestoresAllTabsAndThePersistedPreference() throws Exception {
        assertNull(open("https://example.com/one").error);
        WebView first = currentView();
        Call add = new Call("navigate", new JSObject().put("action", "new"));
        host.navigate(add);
        await(add);
        WebView second = currentView();
        Call enable = new Call("updateSettings", new JSObject().put("settings", new JSObject().put("privateMode", true)));
        host.updateSettings(enable);
        await(enable);
        assertNull(enable.error);
        CookiesWithPerViewPolicy.failOnPolicyCall = 2;
        Call disable = new Call("updateSettings", new JSObject().put("settings", new JSObject().put("privateMode", false)));
        host.updateSettings(disable);
        await(disable);
        assertNotNull("a partial provider failure is reported", disable.error);
        assertTrue(BrowserHostPlugin.isPrivacyModeEnabled(activity));
        assertTrue(state().getBoolean("privateMode"));
        assertFalse(state().getBoolean("recordHistory"));
        assertSame(second, currentView());
        assertEquals(android.webkit.WebSettings.LOAD_NO_CACHE, first.getSettings().getCacheMode());
        assertEquals(android.webkit.WebSettings.LOAD_NO_CACHE, second.getSettings().getCacheMode());
        Field settings = BrowserHostPlugin.class.getDeclaredField("browserSettings");
        settings.setAccessible(true);
        assertTrue(((BrowserHostPlugin.BrowserSettings) settings.get(host)).privateMode);
        Field allTabs = BrowserHostPlugin.class.getDeclaredField("tabs");
        allTabs.setAccessible(true);
        for (Object tab : (List<?>) allTabs.get(host)) {
            Field runtime = tab.getClass().getDeclaredField("runtime");
            runtime.setAccessible(true);
            UserscriptRuntime value = (UserscriptRuntime) runtime.get(tab);
            if (value == null) continue;
            Field mode = UserscriptRuntime.class.getDeclaredField("privateMode");
            mode.setAccessible(true);
            assertTrue("every existing runtime returns to temporary storage", mode.getBoolean(value));
        }
    }

    @org.robolectric.annotation.Implements(value = androidx.webkit.WebViewFeature.class, isInAndroidSdk = false)
    public static class DocumentStartFeatures {
        @org.robolectric.annotation.Implementation public static boolean isFeatureSupported(String feature) {
            return androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT.equals(feature)
                || androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER.equals(feature);
        }
    }

    @org.robolectric.annotation.Implements(value = androidx.webkit.WebViewCompat.class, isInAndroidSdk = false)
    public static class DocumentStartBindings {
        static final List<String> sources = new ArrayList<>();
        @org.robolectric.annotation.Implementation public static void addWebMessageListener(WebView view, String name,
                java.util.Set<String> origins, androidx.webkit.WebViewCompat.WebMessageListener listener) { }
        @org.robolectric.annotation.Implementation public static androidx.webkit.ScriptHandler addDocumentStartJavaScript(
                WebView view, String source, java.util.Set<String> origins) {
            sources.add(source);
            return () -> {};
        }
        @org.robolectric.annotation.Implementation public static void removeWebMessageListener(WebView view, String name) { }
        @org.robolectric.annotation.Resetter public static void resetBindings() { sources.clear(); }
    }

    @Test
    @Config(instrumentedPackages = {"androidx.webkit"}, shadows = {DocumentStartFeatures.class, DocumentStartBindings.class})
    public void updatingScriptsKeepsTheWebViewAndClosesThePreviousRuntime() throws Exception {
        assertNull(open("https://example.com/").error);
        WebView view = currentView();
        Field currentField = BrowserHostPlugin.class.getDeclaredField("current");
        currentField.setAccessible(true);
        Object tab = currentField.get(host);
        Field runtimeField = tab.getClass().getDeclaredField("runtime");
        runtimeField.setAccessible(true);
        UserscriptRuntime previous = (UserscriptRuntime) runtimeField.get(tab);
        Call unchanged = new Call("updateScripts", new JSObject().put("scripts", new com.getcapacitor.JSArray()));
        host.updateScripts(unchanged);
        assertTrue(unchanged.resolved);
        assertSame("unchanged snapshots keep the existing page runtime alive", previous, runtimeField.get(tab));
        com.getcapacitor.JSArray changed = new com.getcapacitor.JSArray();
        changed.put(new JSObject().put("id", "us-reload-script").put("name", "Reload script").put("enabled", true)
            .put("source", "void 0").put("matches", new com.getcapacitor.JSArray().put("https://example.com/*"))
            .put("grants", new com.getcapacitor.JSArray().put("none")));
        Call update = new Call("updateScripts", new JSObject().put("scripts", changed));
        host.updateScripts(update);
        assertTrue(update.resolved);
        assertSame("saving a changed script preserves the current document runtime until navigation", previous, runtimeField.get(tab));
        Call navigate = new Call("navigate", new JSObject().put("action", "url").put("url", "https://example.com/updated"));
        host.navigate(navigate);
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!"https://example.com/updated".equals(view.getUrl()) && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(5);
        }
        assertEquals("https://example.com/updated", view.getUrl());
        assertSame("script updates must preserve the WebView's navigation history", view, currentView());
        assertFalse("the previous runtime must not retain privileged callbacks", previous.install());
        assertNotSame(previous, runtimeField.get(tab));
    }

    @Test
    @Config(instrumentedPackages = {"androidx.webkit"}, shadows = {DocumentStartFeatures.class, DocumentStartBindings.class})
    public void newerScriptsDuringPreparationAreInstalledBeforeThePendingDocument() throws Exception {
        Call opening = new Call("open", new JSObject().put("url", "https://example.com/pending").put("embedded", true));
        host.open(opening);
        WebView view = currentView();
        com.getcapacitor.JSArray latest = new com.getcapacitor.JSArray();
        latest.put(new JSObject().put("id", "us-latest-script").put("name", "Latest script").put("enabled", true)
            .put("source", "void 0").put("matches", new com.getcapacitor.JSArray().put("https://example.com/*"))
            .put("grants", new com.getcapacitor.JSArray().put("none")));
        Call update = new Call("updateScripts", new JSObject().put("scripts", latest));
        host.updateScripts(update);
        await(opening);
        assertNull(opening.error);
        assertSame(view, currentView());
        assertEquals("https://example.com/pending", view.getUrl());
        assertEquals(1, state().getInt("matchedScriptCount"));
        assertTrue("the latest body is registered for the pending document", DocumentStartBindings.sources.stream().anyMatch(source -> source.contains("us-latest-script")));
        Field current = BrowserHostPlugin.class.getDeclaredField("current");
        current.setAccessible(true);
        Object tab = current.get(host);
        Field installed = tab.getClass().getDeclaredField("scriptVersion");
        installed.setAccessible(true);
        Field version = BrowserHostPlugin.class.getDeclaredField("scriptVersion");
        version.setAccessible(true);
        assertEquals("a stale prepare completion cannot execute a pending load", version.getInt(host), installed.getInt(tab));
    }

    @Test public void throwingFullscreenCallbackCannotInterruptBrowserCleanup() throws Exception {
        assertNull(open("https://example.com/").error);
        WebView view = currentView();
        view.getWebChromeClient().onShowCustomView(new FrameLayout(activity), () -> {
            throw new IllegalStateException("renderer callback no longer available");
        });
        Call close = new Call("close", new JSObject());
        host.close(close);
        assertNull("cleanup must complete even when Chromium's fullscreen callback is unavailable", close.error);
        assertTrue(close.resolved);
        assertNull(currentView());
        assertNull(view.getParent());
    }

    @Test public void recoverySnapshotSurvivesHostDestructionAndIsConsumedOnce() throws Exception {
        assertNull(open("https://example.com/one").error);
        host.navigate(new Call("navigate", new JSObject().put("action", "new")));
        WebView second = currentView();
        second.getWebViewClient().onPageStarted(second, "https://example.com/two", null);
        second.getWebChromeClient().onReceivedTitle(second, "Second article");
        host.navigate(new Call("navigate", new JSObject().put("action", "desktop")));
        host.captureRecoverySession();
        host.close(new Call("close", new JSObject()));
        host = new Host();
        Call take = new Call("takeRecoverySession", new JSObject());
        host.takeRecoverySession(take);
        assertTrue(take.resolved);
        org.json.JSONObject snapshot = take.result.getJSONObject("session");
        assertEquals(1, snapshot.getInt("activeIndex"));
        org.json.JSONArray entries = snapshot.getJSONArray("tabs");
        assertEquals(2, entries.length());
        assertEquals("https://example.com/one", entries.getJSONObject(0).getString("url"));
        assertEquals("https://example.com/two", entries.getJSONObject(1).getString("url"));
        assertEquals("Second article", entries.getJSONObject(1).getString("title"));
        assertTrue(entries.getJSONObject(1).getBoolean("desktop"));
        Call again = new Call("takeRecoverySession", new JSObject());
        host.takeRecoverySession(again);
        assertTrue("only the first new Bridge may consume the recovery snapshot", again.result.isNull("session"));
    }

    private JSObject recoverySession(int count, int activeIndex) {
        com.getcapacitor.JSArray entries = new com.getcapacitor.JSArray();
        for (int i = 0; i < count; i++) {
            entries.put(new JSObject().put("url", "https://example.com/restored/" + i)
                .put("title", "Restored " + i).put("desktop", i == 1));
        }
        return new JSObject().put("tabs", entries).put("activeIndex", activeIndex);
    }

    private Call restore(JSObject session) {
        Call call = new Call("open", new JSObject().put("url", "about:blank").put("embedded", true)
            .put("visible", false).put("recoverySession", session));
        host.open(call);
        return call;
    }

    @Test public void restoringTabsDoesNotCreateWebViewsUntilManualReload() throws Exception {
        Call opening = restore(recoverySession(2, 1));
        assertTrue("metadata restoration must settle without script preparation", opening.resolved);
        assertNull(opening.error);
        assertEquals(2, tabs().getJSONArray("tabs").length());
        assertEquals("https://example.com/restored/1", state().getString("url"));
        assertEquals("Restored 1", state().getString("title"));
        assertTrue(state().getBoolean("desktop", false));
        assertEquals("网页进程已恢复，请重新加载此页", state().getString("error"));
        assertFalse(state().getBoolean("loading", true));
        assertNull("restoration must not replay the previous page request", currentView());
        assertEquals(0, completedNavigations());
        int restoredId = state().getInt("tabId");
        host.activateTab(new Call("activateTab", new JSObject().put("index", 0)));
        assertNull("selecting another recovered tab must not trigger a request", currentView());
        host.activateTab(new Call("activateTab", new JSObject().put("index", 1)));
        host.navigate(new Call("navigate", new JSObject().put("action", "reload")));
        WebView reloaded = currentView();
        assertNotNull(reloaded);
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!"https://example.com/restored/1".equals(reloaded.getUrl()) && System.nanoTime() < deadline) {
            Shadows.shadowOf(Looper.getMainLooper()).idle();
            Thread.sleep(5);
        }
        assertEquals("https://example.com/restored/1", reloaded.getUrl());
        assertEquals(restoredId, state().getInt("tabId"));
        host.activateTab(new Call("activateTab", new JSObject().put("index", 0)));
        assertNull("retrying one tab must not load its siblings", currentView());
    }

    @Test public void recoveryLimitsTabCountAndClampsTheActiveIndex() throws Exception {
        assertTrue(restore(recoverySession(8, 99)).resolved);
        assertEquals(6, tabs().getJSONArray("tabs").length());
        assertEquals("https://example.com/restored/5", state().getString("url"));
        assertNull(currentView());
        assertTrue(restore(recoverySession(2, -12)).resolved);
        assertEquals("https://example.com/restored/0", state().getString("url"));
        assertNull(currentView());
    }

    @Test public void invalidRecoveryUrlsCannotReplaceTheCurrentSession() throws Exception {
        assertNull(open("https://example.com/existing").error);
        WebView existing = currentView();
        com.getcapacitor.JSArray invalid = new com.getcapacitor.JSArray();
        for (String url : new String[] {"javascript:alert(1)", "file:///tmp/private", "data:text/html,hello", "https://user:secret@example.com/"}) {
            invalid.put(new JSObject().put("url", url));
        }
        Call call = restore(new JSObject().put("tabs", invalid).put("activeIndex", 0));
        assertNotNull("recovery only accepts HTTP(S) without credentials or internal about:blank", call.error);
        assertSame("reject invalid recovery before closing the current browser", existing, currentView());
        assertEquals("https://example.com/existing", state().getString("url"));
    }

    @Test
    @Config(shadows = BrowserMediaCaptureLifecycleTest.NoDocumentStart.class, instrumentedPackages = "androidx.webkit")
    public void explicitMediaScanWorksWhileThePanelCoversTheWebView() throws Exception {
        String pageUrl = "https://example.com/watch";
        assertNull(open(pageUrl).error);
        WebView view = currentView();
        host.setBounds(new Call("setBounds", new JSObject().put("visible", false)));
        Field frameField = BrowserHostPlugin.class.getDeclaredField("pageFrame");
        frameField.setAccessible(true);
        FrameLayout frame = (FrameLayout) frameField.get(host);
        assertEquals(View.GONE, frame.getVisibility());
        view.evaluateJavascript("/* before explicit scan */", null);
        Call scan = new Call("navigate", new JSObject().put("action", "scanMedia"));
        host.navigate(scan);
        assertNull(scan.error);
        assertTrue(scan.resolved);
        android.webkit.ValueCallback<String> result = Shadows.shadowOf(view).getLastEvaluatedJavascriptCallback();
        assertNotNull("a user-requested scan must run while the media sheet covers the page", result);
        result.onReceiveValue(org.json.JSONObject.quote("{\"url\":\"https://example.com/watch\",\"events\":[{\"source\":\"dom\",\"url\":\"https://media.example.com/manual.mp4\",\"pageUrl\":\"https://example.com/watch\",\"mimeType\":\"video/mp4\",\"mediaKind\":\"video\"}]}"));
        JSObject observation = host.payloads.stream().filter(item -> "observation".equals(item.getString("type")))
            .reduce((first, last) -> last).orElse(null);
        assertNotNull("the hidden current tab must publish the explicit scan result", observation);
        assertEquals("https://media.example.com/manual.mp4", observation.getJSONObject("observation").getString("url"));
        assertEquals(View.GONE, frame.getVisibility());
    }

    @Test
    @Config(shadows = BrowserMediaCaptureLifecycleTest.NoDocumentStart.class, instrumentedPackages = "androidx.webkit")
    public void sameUrlDocumentReloadResetsMediaButVisibilityAndScanDoNot() throws Exception {
        String url = "https://example.com/watch";
        assertNull(open(url).error);
        WebView view = currentView();
        host.events.clear();
        host.payloads.clear();
        view.getWebViewClient().onPageStarted(view, url, null);
        long firstReset = host.payloads.stream().filter(item -> "reset".equals(item.getString("type"))).count();
        assertEquals("every new document clears candidates, even when its URL is unchanged", 1, firstReset);
        view.getWebViewClient().onPageFinished(view, url);
        host.setBounds(new Call("setBounds", new JSObject().put("visible", false)));
        host.setBounds(new Call("setBounds", new JSObject().put("visible", true)));
        host.navigate(new Call("navigate", new JSObject().put("action", "scanMedia")));
        assertEquals("resuming visibility and explicit scanning must preserve discoveries", 1,
            host.payloads.stream().filter(item -> "reset".equals(item.getString("type"))).count());
        assertTrue(host.payloads.stream().anyMatch(item -> "page".equals(item.getString("type"))));
        view.getWebViewClient().onPageStarted(view, url, null);
        assertEquals(2, host.payloads.stream().filter(item -> "reset".equals(item.getString("type"))).count());
    }

    @Test public void externalAppIntentsOnlyKeepTheBrowsableAddressAndPackage() throws Exception {
        android.content.Intent intent = BrowserHostPlugin.externalAppIntent(
            "intent://example/path#Intent;scheme=reader;package=com.example.reader;"
                + "component=com.example.reader/.Internal;action=android.intent.action.SEND;"
                + "launchFlags=0x10000001;S.injected=ignored;end");
        assertEquals(android.content.Intent.ACTION_VIEW, intent.getAction());
        assertEquals("reader://example/path", intent.getDataString());
        assertEquals("com.example.reader", intent.getPackage());
        assertNull(intent.getComponent());
        assertNull(intent.getSelector());
        assertNull(intent.getExtras());
        assertEquals(0, intent.getFlags());
        assertEquals(java.util.Collections.singleton(android.content.Intent.CATEGORY_BROWSABLE), intent.getCategories());
        try {
            BrowserHostPlugin.externalAppIntent("intent://example/path#Intent;scheme=content;end");
            fail("intent wrappers must not bypass the blocked local/content schemes");
        } catch (IllegalArgumentException expected) { }
    }

    @Test public void downloadsCanBeOpenedBeforeAnyWebTabExists() {
        Call call = new Call("navigate", new JSObject().put("action", "downloads"));
        host.navigate(call);
        Shadows.shadowOf(Looper.getMainLooper()).idle();
        assertNull(call.error);
        assertTrue(call.resolved);
    }
}
