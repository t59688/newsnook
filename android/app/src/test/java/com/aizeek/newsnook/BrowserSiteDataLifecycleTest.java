package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.Looper;
import android.webkit.WebStorage;
import android.webkit.WebView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebStorageCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
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
import org.robolectric.annotation.LooperMode;
import org.robolectric.annotation.Resetter;

/** Provider deletion is deferred so real tab retirement and recreation can be inspected. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, shadows = { BrowserSiteDataLifecycleTest.SiteDeletionSupport.class,
    BrowserSiteDataLifecycleTest.DeferredSiteDeletion.class }, instrumentedPackages = "androidx.webkit")
@LooperMode(LooperMode.Mode.PAUSED)
public class BrowserSiteDataLifecycleTest {
    private AppCompatActivity activity;
    private Host host;
    private List<String> appUrls;

    @Implements(value = WebViewFeature.class, isInAndroidSdk = false)
    public static class SiteDeletionSupport {
        @Implementation public static boolean isFeatureSupported(String feature) {
            return WebViewFeature.DELETE_BROWSING_DATA.equals(feature);
        }
    }

    @Implements(value = WebStorageCompat.class, isInAndroidSdk = false)
    public static class DeferredSiteDeletion {
        static String returnedSite = "example.co.uk";
        static final List<String> requestedSites = new ArrayList<>();
        static final List<Runnable> completions = new ArrayList<>();
        static boolean synchronousFirstCallback;
        static int throwOnCall = -1;
        @Implementation public static String deleteBrowsingDataForSite(WebStorage storage, String site, Runnable done) {
            requestedSites.add(site);
            if (requestedSites.size() == throwOnCall) throw new IllegalStateException("provider unavailable");
            completions.add(done);
            if (synchronousFirstCallback && requestedSites.size() == 1) done.run();
            return returnedSite;
        }
        @Resetter public static void reset() {
            returnedSite = "example.co.uk";
            requestedSites.clear();
            completions.clear();
            synchronousFirstCallback = false;
            throwOnCall = -1;
        }
    }

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
        @Override public AppCompatActivity getActivity() { return activity; }
        @Override public Context getContext() { return activity; }
        @Override protected List<String> appStorageUrls() { return appUrls; }
        @Override protected void notifyListeners(String name, JSObject data) {}
    }

    @Before public void setUp() {
        DeferredSiteDeletion.reset();
        appUrls = java.util.Arrays.asList("https://shell.newsnook.test/");
        activity = Robolectric.buildActivity(AppCompatActivity.class).setup().get();
        host = new Host();
    }

    @After public void tearDown() {
        host.close(new Call("close", new JSObject()));
        idle();
        activity.finish();
    }

    private void idle() { Shadows.shadowOf(Looper.getMainLooper()).idle(); }

    private WebView open(String url) throws Exception {
        Call call = new Call("open", new JSObject().put("embedded", true).put("url", url));
        host.open(call);
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!call.resolved && call.error == null && System.nanoTime() < deadline) {
            idle();
            Thread.sleep(5);
        }
        assertNull(call.error);
        assertTrue(call.resolved);
        return loadedView(url);
    }

    private WebView add(String url) throws Exception {
        navigate("new", null);
        navigate("url", url);
        return loadedView(url);
    }

    private WebView loadedView(String url) throws Exception {
        WebView view = view(activeIndex());
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (!url.equals(view.getUrl()) && System.nanoTime() < deadline) {
            idle();
            Thread.sleep(5);
        }
        assertEquals("the fixture must finish script preparation before simulating a document", url, view.getUrl());
        // Robolectric does not run Chromium or emit navigation callbacks. Keep the real
        // media/page lifecycle in sync instead of leaving a new tab at about:blank.
        view.getWebViewClient().onPageStarted(view, url, null);
        view.getWebViewClient().onPageFinished(view, url);
        return view;
    }

    private void navigate(String action, String url) {
        Call call = new Call("navigate", new JSObject().put("action", action).put("url", url));
        host.navigate(call);
        assertNull(call.error);
        assertTrue(call.resolved);
    }

    private void select(int index) {
        Call call = new Call("activateTab", new JSObject().put("index", index));
        host.activateTab(call);
        assertNull(call.error);
        assertTrue(call.resolved);
    }

    private Call clear(String url) {
        Call call = new Call("clearSiteData", new JSObject().put("url", url));
        host.clearSiteData(call);
        return call;
    }

    private JSONArray tabs() {
        Call call = new Call("tabs", new JSObject());
        host.tabs(call);
        return call.result.optJSONArray("tabs");
    }

    private int activeIndex() throws Exception {
        JSONArray values = tabs();
        for (int i = 0; i < values.length(); i++) if (values.getJSONObject(i).optBoolean("active")) return i;
        throw new AssertionError("there must be an active tab");
    }

    private WebView view(int index) throws Exception {
        Field field = BrowserHostPlugin.class.getDeclaredField("tabs");
        field.setAccessible(true);
        Object tab = ((List<?>) field.get(host)).get(index);
        Field view = tab.getClass().getDeclaredField("webView");
        view.setAccessible(true);
        return (WebView) view.get(tab);
    }

    private void finish(int index) {
        DeferredSiteDeletion.completions.get(index).run();
        idle();
    }

    @Test public void appShellHostIsProtectedBeforeDeletionAcrossSchemesAndPorts() throws Exception {
        appUrls = java.util.Arrays.asList("https://localhost/", null, "https://localhost/#private-browser");
        WebView page = open("http://localhost:8137/unsafe");
        android.webkit.CookieManager cookies = android.webkit.CookieManager.getInstance();
        cookies.setCookie("https://localhost/", "app_session=preserve; Path=/");
        Call clearing = clear("http://localhost:8137/unsafe");
        assertNotNull(clearing.error);
        assertTrue("the rejection explains why app data is protected", clearing.error.contains("应用"));
        assertTrue("protection must happen before even the first provider deletion",
            DeferredSiteDeletion.requestedSites.isEmpty());
        assertSame("rejecting cleanup must not retire the existing page", page, view(0));
        assertTrue(cookies.getCookie("https://localhost/").contains("app_session=preserve"));
    }

    @Test public void configuredAppServerProtectsItsSiteIncludingSiblingSubdomains() throws Exception {
        appUrls = java.util.Arrays.asList("https://localhost", "https://app.example.co.uk:8443/start");
        WebView page = open("http://cdn.example.co.uk:8137/unsafe");
        Call clearing = clear("http://cdn.example.co.uk:8137/unsafe");
        assertNotNull(clearing.error);
        assertTrue(clearing.error.contains("应用"));
        assertTrue(DeferredSiteDeletion.requestedSites.isEmpty());
        assertSame(page, view(0));
    }

    @Test public void separateIpSiteCanBeClearedWhileLocalhostAppStorageIsProtected() throws Exception {
        appUrls = java.util.Arrays.asList("https://localhost/", "https://localhost/#private-browser");
        DeferredSiteDeletion.returnedSite = "127.0.0.1";
        WebView page = open("http://127.0.0.1:8137/clear");
        Call clearing = clear("http://127.0.0.1:8137/clear");
        assertNull(clearing.error);
        assertEquals(1, DeferredSiteDeletion.requestedSites.size());
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(page, view(0));
    }

    @Test public void independentPrivateSuffixTenantDoesNotShareTheAppShellSite() throws Exception {
        appUrls = java.util.Arrays.asList("https://shell.github.io/app", "https://localhost/");
        DeferredSiteDeletion.returnedSite = "other.github.io";
        WebView page = open("https://other.github.io/clear");
        Call clearing = clear("https://other.github.io/clear");
        assertNull(clearing.error);
        assertEquals(1, DeferredSiteDeletion.requestedSites.size());
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(page, view(0));
    }

    @Test public void missingAppOriginMetadataCannotPermitPotentiallyDestructiveCleanup() throws Exception {
        appUrls = java.util.Collections.emptyList();
        WebView page = open("https://example.co.uk/clear");
        Call clearing = clear("https://example.co.uk/clear");
        assertNotNull(clearing.error);
        assertTrue(clearing.error.contains("无法确认"));
        assertTrue(DeferredSiteDeletion.requestedSites.isEmpty());
        assertSame(page, view(0));
    }

    @Test public void sameSiteTabsAreRetiredBeforeFinalDeletionAndRestoredOnlyWhenSelected() throws Exception {
        WebView first = open("https://a.example.co.uk/remember");
        WebView target = add("https://b.example.co.uk/clear");
        WebView other = add("https://other.co.uk/keep");
        WebView suffixTrap = add("https://example.co.uk.evil.test/keep");
        WebView plainHttp = add("http://example.co.uk:8080/remember");
        JSONArray before = tabs();
        select(1);
        Call clearing = clear("https://b.example.co.uk/clear");

        assertNull(clearing.error);
        assertFalse("do not report completion before the final provider callback", clearing.resolved);
        assertNull("a sibling document must not retain its old JavaScript session", view(0));
        assertNull(view(1));
        assertNull(view(4));
        assertNull(first.getParent());
        assertNull(target.getParent());
        assertNull(plainHttp.getParent());
        assertSame(other, view(2));
        assertSame(suffixTrap, view(3));
        for (int i = 0; i < before.length(); i++) {
            assertEquals(before.getJSONObject(i).getInt("id"), tabs().getJSONObject(i).getInt("id"));
            assertEquals(before.getJSONObject(i).getString("url"), tabs().getJSONObject(i).getString("url"));
        }

        select(0);
        navigate("reload", null);
        assertNull("selection and refresh cannot recreate a document while deletion is pending", view(0));
        Call duplicate = clear("https://a.example.co.uk/remember");
        assertNotNull("overlapping deletion requests must not race", duplicate.error);
        assertEquals(1, DeferredSiteDeletion.requestedSites.size());

        finish(0);
        assertEquals("the final deletion must use the provider's exact site", "example.co.uk",
            DeferredSiteDeletion.requestedSites.get(1));
        assertNull(view(0));
        assertNull(view(1));
        assertFalse(clearing.resolved);
        finish(1);

        assertTrue(clearing.resolved);
        assertNull(clearing.error);
        assertNotNull(view(0));
        assertNotSame(first, view(0));
        assertNull("a background tab must remain dormant until selected", view(1));
        assertNull(view(4));
        assertSame(other, view(2));
        assertSame(suffixTrap, view(3));
        select(1);
        assertNotNull(view(1));
        assertNotSame(target, view(1));
        assertEquals("https://b.example.co.uk/clear", tabs().getJSONObject(1).getString("url"));
    }

    @Test public void providerPrivateSuffixBoundaryKeepsOtherTenantsAlive() throws Exception {
        DeferredSiteDeletion.returnedSite = "alice.github.io";
        WebView target = open("https://alice.github.io/clear");
        WebView sameTenant = add("https://media.alice.github.io/remember");
        WebView otherTenant = add("https://bob.github.io/keep");
        select(0);
        Call clearing = clear("https://alice.github.io/clear");
        assertNull(view(0));
        assertNull(view(1));
        assertSame("do not derive a site by taking the last two host segments", otherTenant, view(2));
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(target, view(0));
        assertNull(view(1));
        assertNull(sameTenant.getParent());
        assertSame(otherTenant, view(2));
    }

    @Test public void visitingAPrivateSuffixItselfCannotRetireIndependentTenants() throws Exception {
        DeferredSiteDeletion.returnedSite = "github.io";
        WebView target = open("https://github.io/clear");
        WebView tenant = add("https://alice.github.io/keep");
        select(0);
        Call clearing = clear("https://github.io/clear");
        assertNull(view(0));
        assertSame("a suffix host fallback is not the registrable site of its tenants", tenant, view(1));
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(target, view(0));
        assertSame(tenant, view(1));
    }

    @Test public void localhostCleanupDoesNotRetireSubdomainLikeHosts() throws Exception {
        DeferredSiteDeletion.returnedSite = "localhost";
        WebView target = open("http://localhost:8080/clear");
        WebView sibling = add("http://a.localhost:8080/keep");
        WebView sameHost = add("https://localhost:8443/remember");
        select(0);
        Call clearing = clear("http://localhost:8080/clear");
        assertNull(view(0));
        assertNull(view(2));
        assertSame("internal hostnames are exact sites, not registrable domain suffixes", sibling, view(1));
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(target, view(0));
        assertSame(sibling, view(1));
        assertNull(view(2));
        assertNull(sameHost.getParent());
    }

    @Test public void ipAddressCleanupRetiresOnlyTheSameAddressAcrossPortsAndSchemes() throws Exception {
        DeferredSiteDeletion.returnedSite = "127.0.0.1";
        WebView target = open("http://127.0.0.1:8080/clear");
        WebView otherAddress = add("http://127.0.0.2:8080/keep");
        WebView sameAddress = add("https://127.0.0.1:8443/remember");
        select(0);
        Call clearing = clear("http://127.0.0.1:8080/clear");
        assertNull(view(0));
        assertNull(view(2));
        assertSame("a different IP address is a separate site", otherAddress, view(1));
        finish(0);
        finish(1);
        assertTrue(clearing.resolved);
        assertNotSame(target, view(0));
        assertSame(otherAddress, view(1));
        assertNull(view(2));
        assertNull(sameAddress.getParent());
    }

    @Test public void newNavigationIntoTheClearingSiteStaysDormant() throws Exception {
        open("https://example.co.uk/clear");
        WebView other = add("https://other.test/keep");
        select(0);
        Call clearing = clear("https://example.co.uk/clear");
        finish(0);
        select(1);
        navigate("url", "https://new.example.co.uk/after");
        assertNull(view(1));
        assertNull(other.getParent());
        finish(1);
        assertFalse("a document retired during deletion requires a final pass after that retirement", clearing.resolved);
        assertEquals(3, DeferredSiteDeletion.requestedSites.size());
        finish(2);
        assertTrue(clearing.resolved);
        assertNotNull(view(1));
        assertNotSame(other, view(1));
        assertEquals("https://new.example.co.uk/after", tabs().getJSONObject(1).getString("url"));
        assertNull(view(0));
    }

    @Test public void synchronousProviderCallbackCannotSkipRetiringSiblingDocuments() throws Exception {
        DeferredSiteDeletion.synchronousFirstCallback = true;
        open("https://example.co.uk/clear");
        add("https://a.example.co.uk/remember");
        select(0);
        Call clearing = clear("https://example.co.uk/clear");
        assertNull(view(0));
        assertNull(view(1));
        idle();
        assertEquals(2, DeferredSiteDeletion.requestedSites.size());
        assertFalse(clearing.resolved);
        finish(1);
        assertTrue(clearing.resolved);
        assertNull(view(1));
    }

    @Test public void closeRejectsPendingCleanupAndLateCallbacksCannotMutateANewSession() throws Exception {
        open("https://example.co.uk/clear");
        Call clearing = clear("https://example.co.uk/clear");
        host.close(new Call("close", new JSObject()));
        assertNotNull(clearing.error);
        WebView reopened = open("https://other.test/new");
        finish(0);
        assertFalse(clearing.resolved);
        assertEquals(1, DeferredSiteDeletion.requestedSites.size());
        assertSame(reopened, view(0));
        assertEquals("https://other.test/new", tabs().getJSONObject(0).getString("url"));
    }

    @Test public void failedFinalDeletionLeavesTabsDormantUntilExplicitRetry() throws Exception {
        open("https://example.co.uk/clear");
        add("https://a.example.co.uk/remember");
        select(0);
        Call clearing = clear("https://example.co.uk/clear");
        DeferredSiteDeletion.throwOnCall = 2;
        finish(0);
        assertNotNull(clearing.error);
        assertFalse(clearing.resolved);
        assertNull(view(0));
        assertNull(view(1));
        select(1);
        assertNull("failure cannot silently resume a stale or partially cleared page", view(1));
        navigate("reload", null);
        assertNotNull(view(1));
    }
}
