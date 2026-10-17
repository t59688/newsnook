package com.aizeek.newsnook;

import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import androidx.webkit.WebStorageCompat;
import androidx.webkit.WebViewFeature;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import okhttp3.HttpUrl;

/** Independent Android System WebView browser; no Capacitor bridge is installed in websites. */
@CapacitorPlugin(name = "NewsNookBrowser")
public class BrowserHostPlugin extends Plugin {
    private static final String HOME = "https://www.bing.com/";
    private static final int MAX_TABS = 6;
    private static final int MAX_HISTORY = 240;
    private static final int MAX_BOOKMARKS = 120;
    private static final String HISTORY = "history-v1";
    private static final String BOOKMARKS = "bookmarks-v1";
    private static final String RESTORED_PAGE_ERROR = "网页进程已恢复，请重新加载此页";
    private static final String SITE_DATA_CLEARING = "正在清理该站点数据…";
    // A one-time, memory-only handoff between the retired and recreated Bridges.
    private static final AtomicReference<JSObject> pendingRecoverySession = new AtomicReference<>();

    static final class BrowserSettings {
        final String userAgentMode;
        final String customUserAgent;
        final int textZoom;
        final boolean javaScriptEnabled;
        final boolean loadsImagesAutomatically;
        final boolean thirdPartyCookiesEnabled;
        final boolean mediaPlaybackRequiresUserGesture;
        final boolean confirmExternalApps;

        BrowserSettings(JSObject requested) {
            JSObject values = requested == null ? new JSObject() : requested;
            String mode = values.optString("userAgentMode", "system");
            if (!"system".equals(mode) && !"desktop".equals(mode) && !"custom".equals(mode))
                throw new IllegalArgumentException("无效的浏览器标识模式");
            userAgentMode = mode;
            customUserAgent = values.optString("customUserAgent", "").trim();
            if ("custom".equals(mode) && (customUserAgent.isEmpty() || customUserAgent.length() > 512
                    || !customUserAgent.matches("[\\x20-\\x7e]+")))
                throw new IllegalArgumentException("自定义浏览器标识须为 1–512 个可见英文字符，不能换行");
            textZoom = Math.max(75, Math.min(200, values.optInt("textZoom", 100)));
            javaScriptEnabled = values.optBoolean("javaScriptEnabled", true);
            loadsImagesAutomatically = values.optBoolean("loadsImagesAutomatically", true);
            thirdPartyCookiesEnabled = values.optBoolean("thirdPartyCookiesEnabled", false);
            mediaPlaybackRequiresUserGesture = values.optBoolean("mediaPlaybackRequiresUserGesture", true);
            confirmExternalApps = values.optBoolean("confirmExternalApps", true);
        }

        JSObject toJson() {
            return new JSObject().put("userAgentMode", userAgentMode).put("customUserAgent", customUserAgent)
                .put("textZoom", textZoom).put("javaScriptEnabled", javaScriptEnabled)
                .put("loadsImagesAutomatically", loadsImagesAutomatically)
                .put("thirdPartyCookiesEnabled", thirdPartyCookiesEnabled)
                .put("mediaPlaybackRequiresUserGesture", mediaPlaybackRequiresUserGesture)
                .put("confirmExternalApps", confirmExternalApps);
        }

        boolean needsReload(BrowserSettings other) {
            return !userAgentMode.equals(other.userAgentMode) || !customUserAgent.equals(other.customUserAgent)
                || javaScriptEnabled != other.javaScriptEnabled
                || loadsImagesAutomatically != other.loadsImagesAutomatically;
        }
    }

    private static final class Tab {
        // A tab outlives its renderer. Clear this reference before releasing callbacks.
        volatile WebView webView;
        final int id;
        String mobileUserAgent;
        String userAgentMode = "system";
        String findQuery = "";
        int findMatch = -1;
        int findCount;
        UserscriptRuntime runtime;
        UserscriptRuntime preparingRuntime;
        volatile BrowserMediaCapture media;
        volatile BrowserImageCapture images;
        PluginCall pendingOpen;
        Runnable pendingNavigation;
        String title = "网页";
        String url;
        String error;
        boolean desktop;
        boolean loading;
        boolean preparing;
        boolean hasLoaded;
        boolean siteDataClearing;
        boolean recreateAfterSiteClear;
        int progress;
        int scriptVersion = -1;
        Tab(String url, int id) {
            this.id = id;
            this.url = url;
        }
    }

    private static final class SiteDataClear {
        final PluginCall call;
        String providerSite;
        String host;
        boolean includeSubdomains;
        int retirementGeneration;
        SiteDataClear(PluginCall call, String host) { this.call = call; this.host = host; }
    }

    private SiteDataClear siteDataClear;
    private Dialog dialog;
    private boolean embeddedMode;
    private FrameLayout pageFrame;
    private LinearLayout root;
    private EditText address;
    private TextView titleView;
    private TextView tabCounter;
    private TextView progress;
    private TextView backButton;
    private TextView forwardButton;
    private TextView desktopButton;
    private TextView menuButton;
    private final List<Tab> tabs = new ArrayList<>();
    private int nextTabId = 1;
    private Tab current;
    private JSArray scriptSnapshot;
    private SharedPreferences preferences;
    private BrowserSettings browserSettings = new BrowserSettings(null);
    private int ink = Color.rgb(14, 15, 18);
    private int surface = Color.rgb(22, 24, 29);
    private int paper = Color.rgb(234, 228, 216);
    private int muted = Color.rgb(168, 161, 148);
    private int accent = Color.rgb(196, 92, 74);
    private int outline = Color.rgb(60, 60, 63);
    private volatile boolean closing;
    private boolean destroyed;
    private boolean activityPaused;
    private boolean embeddedVisible = true;
    private int scriptVersion;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Tab fullscreenTab;
    private View customFullscreen;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private FrameLayout fullscreenContainer;

    private boolean activityAvailable() {
        return !destroyed && getActivity() != null && !getActivity().isFinishing() && !getActivity().isDestroyed();
    }

    private void onUi(PluginCall call, Runnable action) {
        Runnable guarded = () -> {
            if (!activityAvailable()) { call.reject("浏览器所在页面已关闭"); return; }
            try { action.run(); }
            catch (RuntimeException error) {
                if (privateMode()) call.reject("浏览器操作失败，请重试");
                else {
                    android.util.Log.e("NewsNookBrowser", "Browser operation failed", error);
                    call.reject("浏览器操作失败，请重试", error);
                }
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) guarded.run();
        else mainHandler.post(guarded);
    }

    private boolean privateMode() {
        // Privacy remains true through teardown; ending a session must never re-enable
        // history/recovery writes or console forwarding for late renderer callbacks.
        return getActivity() instanceof PrivateBrowserActivity;
    }

    private JSObject privacyCapabilities() {
        boolean clear = false;
        try { clear = WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA); }
        catch (RuntimeException ignored) {}
        JSObject result = new JSObject().put("privateMode", PrivateBrowserSession.supported(getContext()))
            .put("clearSiteData", clear).put("sharedSiteData", !privateMode());
        String reason = PrivateBrowserSession.unavailableReason(getContext());
        if (reason != null) result.put("reason", reason);
        return result;
    }

    @PluginMethod public void getBrowserContext(PluginCall call) {
        onUi(call, () -> {
            if (getActivity() instanceof PrivateBrowserActivity) {
                ((PrivateBrowserActivity) getActivity()).browserContext(configuration -> {
                    configuration.put("privateMode", true).put("privacyCapabilities", privacyCapabilities());
                    call.resolve(configuration);
                }, call::reject);
            } else {
                call.resolve(new JSObject().put("privateMode", false)
                    .put("privacyCapabilities", privacyCapabilities()));
            }
        });
    }

    @PluginMethod public void openPrivate(PluginCall call) {
        if (privateMode()) { call.reject("已在隐私会话中"); return; }
        JSObject configuration = new JSObject();
        try {
            configuration.put("settings", new BrowserSettings(call.getObject("settings")).toJson());
            for (String key : new String[] {"palette", "appearance", "ui"}) {
                JSObject value = call.getObject(key);
                if (value != null) configuration.put(key, value);
            }
            JSArray scripts = call.getArray("scripts");
            if (scripts != null) configuration.put("scripts", scripts);
            String url = normalizeUrl(call.getString("url", "about:blank"));
            if (url == null) { call.reject("仅支持 HTTP/HTTPS 网站"); return; }
            configuration.put("url", url);
        } catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        onUi(call, () -> {
            try {
                PrivateBrowserSession.launch(getActivity(), configuration);
                call.resolve(new JSObject().put("opened", true));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }

    @PluginMethod public void closePrivate(PluginCall call) {
        onUi(call, () -> {
            if (!(getActivity() instanceof PrivateBrowserActivity)) {
                call.reject("当前不是隐私会话"); return;
            }
            closeNative();
            call.resolve();
            ((PrivateBrowserActivity) getActivity()).finishPrivate();
        });
    }

    @PluginMethod public void updateSettings(PluginCall call) {
        final BrowserSettings requested;
        try { requested = new BrowserSettings(call.getObject("settings")); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        onUi(call, () -> {
            boolean reload = browserSettings.needsReload(requested);
            browserSettings = requested;
            for (Tab tab : tabs) {
                tab.userAgentMode = requested.userAgentMode;
                tab.desktop = "desktop".equals(requested.userAgentMode);
                applySettings(tab);
            }
            if (reload && current != null && current.webView != null && current.hasLoaded) reloadTab(current);
            if (current != null) sendNavigation(current.url, "state");
            call.resolve(new JSObject().put("settings", requested.toJson()));
        });
    }

    @PluginMethod public void findInPage(PluginCall call) {
        String query = call.getString("query", "");
        if (query.length() > 1000) { call.reject("查找文字过长"); return; }
        onUi(call, () -> {
            if (current == null || current.webView == null) { call.reject("请先打开网页"); return; }
            current.findQuery = query;
            current.findMatch = -1;
            current.findCount = 0;
            if (query.isEmpty()) { current.webView.clearMatches(); sendFindResult(current, true); }
            else current.webView.findAllAsync(query);
            call.resolve();
        });
    }

    @PluginMethod public void findNext(PluginCall call) {
        boolean forward = Boolean.TRUE.equals(call.getBoolean("forward", true));
        onUi(call, () -> {
            if (current == null || current.webView == null) { call.reject("请先打开网页"); return; }
            current.webView.findNext(forward);
            call.resolve();
        });
    }

    @PluginMethod public void clearFind(PluginCall call) {
        onUi(call, () -> {
            if (current != null) {
                current.findQuery = "";
                current.findMatch = -1;
                current.findCount = 0;
                if (current.webView != null) current.webView.clearMatches();
                sendFindResult(current, true);
            }
            call.resolve();
        });
    }

    private void sendFindResult(Tab tab, boolean done) {
        if (closing || current != tab) return;
        notifyListeners("findResult", new JSObject().put("tabId", tab.id)
            .put("activeMatch", tab.findMatch).put("count", tab.findCount).put("done", done));
    }

    @PluginMethod public void clearSiteData(PluginCall call) {
        onUi(call, () -> {
            if (siteDataClear != null) { call.reject("正在清理网站数据，请稍候"); return; }
            if (current == null || !isHttpUrl(current.url)) { call.reject("请先打开要清理的网站"); return; }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)) {
                call.reject("当前系统 WebView 不支持完整的单站点数据清理，请更新系统 WebView"); return;
            }
            String url = call.getString("url", current.url);
            String requestedHost = httpHost(url);
            if (!isHttpUrl(url) || requestedHost == null || !requestedHost.equals(httpHost(current.url))) {
                call.reject("网站已变化，请重新打开清理操作"); return;
            }
            String appDataReason = appStorageProtectionReason(url);
            if (appDataReason != null) { call.reject(appDataReason); return; }
            SiteDataClear operation = new SiteDataClear(call, requestedHost);
            siteDataClear = operation;
            try {
                deferForSiteClear(current, current.url);
                // The provider is the authority for its PSL/site boundary. This API returns
                // that exact site only after starting deletion; there is no public getSite.
                // Retire every matching document, then run a final deletion after this pass.
                operation.providerSite = WebStorageCompat.deleteBrowsingDataForSite(WebStorage.getInstance(), url,
                    () -> mainHandler.post(() -> deleteRetiredSiteData(operation)));
                operation.host = siteHost(operation.providerSite);
                if (operation.host == null) throw new IllegalStateException("WebView returned an invalid site");
                operation.includeSubdomains = requestedHost.endsWith("." + operation.host)
                    || siteHasSubdomains(operation.host);
                for (Tab tab : tabs) deferForSiteClear(tab, tab.url);
                notifyListeners("siteDataClearing", new JSObject().put("site", operation.providerSite)
                    .put("sharedSiteData", !privateMode()));
            } catch (RuntimeException failure) {
                failSiteClear(operation);
            }
        });
    }

    protected List<String> appStorageUrls() {
        com.getcapacitor.Bridge appBridge = getBridge();
        if (appBridge == null) return java.util.Collections.emptyList();
        // These are configured Bridge origins, never the untrusted website tab's address.
        return java.util.Arrays.asList(appBridge.getLocalUrl(), appBridge.getServerUrl(), appBridge.getAppUrl(),
            appBridge.getScheme() + "://" + appBridge.getHost());
    }

    private String appStorageProtectionReason(String url) {
        HttpUrl requested = HttpUrl.parse(url);
        String requestedSite = storageSite(requested);
        boolean knownAppOrigin = false;
        for (String appUrl : appStorageUrls()) {
            HttpUrl app = appUrl == null ? null : HttpUrl.parse(appUrl);
            if (app == null) continue;
            knownAppOrigin = true;
            // Browsing-data deletion crosses scheme and port, and may include sibling
            // subdomains. Check before the first provider call: discovering the exact
            // site by deleting first would already destroy application-owned storage.
            if (requested.host().equals(app.host()) || requestedSite.equals(storageSite(app))) {
                return "此网站与应用界面共用存储，清理可能删除应用设置或登录信息，已取消操作";
            }
        }
        return knownAppOrigin ? null : "无法确认应用数据的隔离范围，暂不能清理网站数据";
    }

    private static String storageSite(HttpUrl url) {
        String domain = url.topPrivateDomain();
        return domain == null ? url.host() : domain;
    }

    private static String httpHost(String url) {
        HttpUrl parsed = url == null ? null : HttpUrl.parse(url);
        return parsed == null ? null : parsed.host();
    }

    private static String siteHost(String site) {
        if (site == null || site.isEmpty()) return null;
        // The provider returns a domain or IP, without a scheme. IPv6 may be unbracketed.
        String authority = site.indexOf(':') >= 0 && !site.startsWith("[") ? "[" + site + "]" : site;
        return httpHost("https://" + authority + "/");
    }

    private static boolean siteHasSubdomains(String host) {
        // WebView falls back to an exact host for IPs and internal names such as localhost.
        // In particular, a.localhost is a different site from localhost.
        int dot = host.indexOf('.');
        if (dot <= 0 || dot == host.length() - 1 || host.indexOf(':') >= 0 || host.matches("[0-9.]+")) return false;
        // Visiting a public/private suffix itself (e.g. github.io) must not retire its
        // independent tenants. Use the bundled PSL only to exclude known suffixes;
        // deletion still uses the provider-returned site. PSL version drift remains a
        // boundary when the provider returns an unchanged, newly listed suffix host.
        HttpUrl parsed = HttpUrl.parse("https://" + host + "/");
        return parsed != null && parsed.topPrivateDomain() != null;
    }

    private boolean deferForSiteClear(Tab tab, String url) {
        SiteDataClear operation = siteDataClear;
        String host = httpHost(url);
        if (operation == null || host == null || !(host.equals(operation.host)
                || (operation.includeSubdomains && host.endsWith("." + operation.host)))) return false;
        tab.url = url;
        if (!tab.siteDataClearing) {
            if (fullscreenTab == tab) exitFullscreen();
            releaseTabView(tab, false);
            operation.retirementGeneration++;
        }
        tab.siteDataClearing = true;
        tab.recreateAfterSiteClear = false;
        tab.error = SITE_DATA_CLEARING;
        if (current == tab) {
            showTabContent(tab);
            updateChrome();
            sendNavigation(tab.url, "state");
        }
        return true;
    }

    private void deleteRetiredSiteData(SiteDataClear operation) {
        if (siteDataClear != operation) return;
        if (closing || !activityAvailable()) { failSiteClear(operation); return; }
        final int generation = operation.retirementGeneration;
        try {
            WebStorageCompat.deleteBrowsingDataForSite(WebStorage.getInstance(), operation.providerSite,
                () -> mainHandler.post(() -> {
                    if (siteDataClear != operation) return;
                    // A redirect or new navigation may have joined this site during deletion.
                    // The last deletion must begin after the last old document was retired.
                    if (generation != operation.retirementGeneration) deleteRetiredSiteData(operation);
                    else finishSiteClear(operation);
                }));
        } catch (RuntimeException failure) {
            failSiteClear(operation);
        }
    }

    private void finishSiteClear(SiteDataClear operation) {
        if (siteDataClear != operation) return;
        if (closing || !activityAvailable()) { failSiteClear(operation); return; }
        siteDataClear = null;
        for (Tab tab : tabs) if (tab.siteDataClearing) {
            tab.siteDataClearing = false;
            tab.recreateAfterSiteClear = true;
            tab.error = null;
        }
        if (current != null && current.recreateAfterSiteClear) {
            try { initializeTab(current); }
            catch (RuntimeException failure) {
                current.recreateAfterSiteClear = false;
                releaseTabView(current, false);
                current.error = "网站数据已清理，请重新加载网页";
                showTabContent(current);
                updateChrome();
                sendNavigation(current.url, "state");
            }
        }
        operation.call.resolve(new JSObject().put("site", operation.providerSite)
            .put("sharedSiteData", !privateMode()));
    }

    private void failSiteClear(SiteDataClear operation) {
        if (siteDataClear != operation) return;
        siteDataClear = null;
        for (Tab tab : tabs) if (tab.siteDataClearing) {
            tab.siteDataClearing = false;
            tab.recreateAfterSiteClear = false;
            tab.error = "清理未完成，请重试";
        }
        if (current != null && current.webView == null) {
            showTabContent(current);
            updateChrome();
            sendNavigation(current.url, "state");
        }
        operation.call.reject("清理未完成，请重试");
    }

    @PluginMethod public void scanImages(PluginCall call) {
        int tabId = call.getInt("tabId", -1);
        String requestId = call.getString("requestId", "");
        onUi(call, () -> {
            Tab tab = imageTab(tabId);
            if (tab == null) { call.reject("网页图片会话已关闭"); return; }
            tab.images.scan(requestId, result -> resolveImage(call, tab, result), call::reject);
        });
    }

    @PluginMethod public void loadImage(PluginCall call) {
        int tabId = call.getInt("tabId", -1);
        onUi(call, () -> {
            Tab tab = imageTab(tabId);
            if (tab == null) { call.reject("网页图片会话已关闭"); return; }
            tab.images.load(call.getString("documentId", ""), call.getString("requestId", ""),
                call.getString("imageId", ""), Boolean.TRUE.equals(call.getBoolean("thumbnail", false)),
                Boolean.TRUE.equals(call.getBoolean("original", false)),
                result -> resolveImage(call, tab, result), call::reject);
        });
    }

    @PluginMethod public void cancelImageRequests(PluginCall call) {
        int tabId = call.getInt("tabId", -1);
        onUi(call, () -> {
            Tab tab = imageTab(tabId);
            if (tab != null) tab.images.cancel(call.getString("documentId"), call.getString("requestId"));
            call.resolve();
        });
    }

    private Tab imageTab(int id) {
        for (Tab tab : tabs) if (tab.id == id && isLive(tab, tab.webView) && tab.images != null) return tab;
        return null;
    }

    private void resolveImage(PluginCall call, Tab tab, JSONObject result) {
        if (!isLive(tab, tab.webView) || tab.images == null) { call.reject("网页图片会话已关闭"); return; }
        try { call.resolve(new JSObject(result.toString())); }
        catch (Exception error) { call.reject("无法读取网页图片"); }
    }

    @PluginMethod public void open(PluginCall call) {
        if (Boolean.TRUE.equals(call.getBoolean("privateMode", false)) && !privateMode()) {
            call.reject("隐私模式必须在独立会话中打开"); return;
        }
        final BrowserSettings requestedSettings;
        try { requestedSettings = new BrowserSettings(call.getObject("settings")); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        JSObject requestedRecovery = call.getObject("recoverySession");
        if (privateMode() && requestedRecovery != null) { call.reject("隐私会话不恢复之前的标签页"); return; }
        JSObject recovery = requestedRecovery == null ? null : normalizeRecoverySession(requestedRecovery);
        if (requestedRecovery != null && recovery == null) { call.reject("没有可恢复的有效标签页"); return; }
        String url = normalizeUrl(call.getString("url", HOME));
        if (url == null) { call.reject("仅支持 HTTP/HTTPS 网站"); return; }
        JSArray scripts = call.getArray("scripts");
        JSObject palette = call.getObject("palette");
        boolean embed = Boolean.TRUE.equals(call.getBoolean("embedded", false));
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        float top = call.getFloat("top", 0f);
        float bottom = call.getFloat("bottom", 0f);
        onUi(call, () -> {
            closeNative();
            try {
                closing = false;
                embeddedMode = embed;
                embeddedVisible = visible;
                scriptSnapshot = scripts;
                scriptVersion++;
                preferences = privateMode() ? PrivateBrowserSession.preferences("newsnook-native-browser")
                    : getContext().getSharedPreferences("newsnook-native-browser", Context.MODE_PRIVATE);
                browserSettings = requestedSettings;
                updatePalette(palette);
                if (embed) createEmbedded(top, bottom);
                else createDialog();
                if (recovery != null) {
                    restoreTabs(recovery);
                    call.resolve();
                } else createTab(url, call);
            } catch (Exception error) {
                closeNative();
                call.reject("浏览器启动失败", error);
            }
        });
    }

    void captureRecoverySession() {
        if (privateMode() || tabs.isEmpty()) return;
        JSArray entries = new JSArray();
        for (Tab tab : tabs) {
            entries.put(new JSObject().put("url", tab.url).put("title", tab.title).put("desktop", tab.desktop));
        }
        JSObject session = normalizeRecoverySession(new JSObject().put("tabs", entries)
            .put("activeIndex", Math.max(0, tabs.indexOf(current))));
        if (session != null) pendingRecoverySession.set(session);
    }

    @PluginMethod public void takeRecoverySession(PluginCall call) {
        onUi(call, () -> {
            JSObject session = privateMode() ? null : pendingRecoverySession.getAndSet(null);
            call.resolve(new JSObject().put("session", session == null ? JSONObject.NULL : session));
        });
    }

    private static JSObject normalizeRecoverySession(JSObject requested) {
        JSONArray entries = requested.optJSONArray("tabs");
        if (entries == null || entries.length() == 0) return null;
        int requestedIndex = Math.max(0, Math.min(requested.optInt("activeIndex", 0), entries.length() - 1));
        int activeIndex = 0;
        JSArray valid = new JSArray();
        for (int index = 0; index < Math.min(entries.length(), MAX_TABS); index++) {
            JSONObject entry = entries.optJSONObject(index);
            if (entry == null) continue;
            String url = entry.optString("url", "").trim();
            if (!"about:blank".equals(url) && !isHttpUrl(url)) continue;
            String title = entry.optString("title", "网页").trim();
            if (title.isEmpty()) title = "网页";
            if (title.length() > 256) title = title.substring(0, 256);
            if (index <= requestedIndex) activeIndex = valid.length();
            valid.put(new JSObject().put("url", url).put("title", title)
                .put("desktop", entry.optBoolean("desktop", false)));
        }
        if (valid.length() == 0) return null;
        return new JSObject().put("tabs", valid).put("activeIndex", Math.min(activeIndex, valid.length() - 1));
    }

    private void restoreTabs(JSObject session) {
        JSONArray entries = session.optJSONArray("tabs");
        for (int index = 0; index < entries.length(); index++) {
            JSONObject entry = entries.optJSONObject(index);
            Tab tab = new Tab(entry.optString("url"), nextTabId++);
            tab.title = entry.optString("title", "网页");
            tab.desktop = entry.optBoolean("desktop", false);
            tab.userAgentMode = tab.desktop ? "desktop" : browserSettings.userAgentMode;
            tab.error = RESTORED_PAGE_ERROR;
            tabs.add(tab);
        }
        // Keep only metadata until an explicit reload creates a fresh WebView.
        selectTab(tabs.get(session.optInt("activeIndex", 0)));
    }

    @PluginMethod public void state(PluginCall call) {
        onUi(call, () -> call.resolve(tabState(current)));
    }

    @PluginMethod public void updateScripts(PluginCall call) {
        JSArray scripts = call.getArray("scripts");
        onUi(call, () -> {
            scriptSnapshot = scripts;
            scriptVersion++;
            for (Tab tab : tabs) if (tab.webView != null) prepareRuntime(tab);
            call.resolve();
        });
    }

    private JSObject tabState(Tab tab) {
        JSObject state = new JSObject();
        state.put("url", tab == null ? JSONObject.NULL : tab.url);
        state.put("tabId", tab == null ? JSONObject.NULL : tab.id);
        state.put("title", tab == null ? "" : tab.title);
        state.put("back", tab != null && tab.webView != null && tab.webView.canGoBack());
        state.put("forward", tab != null && tab.webView != null && tab.webView.canGoForward());
        state.put("desktop", tab != null && tab.desktop);
        state.put("privateMode", privateMode());
        state.put("userAgentMode", tab == null ? browserSettings.userAgentMode : tab.userAgentMode);
        state.put("userAgent", tab == null || tab.webView == null ? "" : tab.webView.getSettings().getUserAgentString());
        state.put("textZoom", browserSettings.textZoom);
        state.put("loading", tab != null && (tab.loading || tab.preparing));
        state.put("progress", tab == null ? 0 : tab.progress);
        state.put("error", tab == null || tab.error == null ? JSONObject.NULL : tab.error);
        return state;
    }

    @PluginMethod public void setBounds(PluginCall call) {
        float top = call.getFloat("top", 0f);
        float bottom = call.getFloat("bottom", 0f);
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        onUi(call, () -> {
            if (!embeddedMode || pageFrame == null) { call.resolve(); return; }
            setEmbeddedBounds(top, bottom);
            embeddedVisible = visible;
            pageFrame.setVisibility(visible ? View.VISIBLE : View.GONE);
            syncTabActivity();
            call.resolve();
        });
    }

    @PluginMethod public void tabs(PluginCall call) {
        onUi(call, () -> {
            JSArray list = new JSArray();
            for (int i=0; i<tabs.size(); i++) {
                Tab tab=tabs.get(i);
                JSObject entry=new JSObject();
                entry.put("index",i);
                entry.put("id",tab.id);
                entry.put("title",tab.title);
                entry.put("url",tab.url);
                entry.put("active",tab == current);
                entry.put("loading",tab.loading || tab.preparing);
                entry.put("error",tab.error == null ? JSONObject.NULL : tab.error);
                list.put(entry);
            }
            JSObject result=new JSObject();result.put("tabs",list);call.resolve(result);
        });
    }

    @PluginMethod public void activateTab(PluginCall call) {
        int index=call.getInt("index",-1);
        onUi(call, () -> {
            if(index<0 || index>=tabs.size()) {call.reject("标签页不存在");return;}
            selectTab(tabs.get(index));
            call.resolve();
        });
    }

    @PluginMethod public void removeTab(PluginCall call) {
        int index=call.getInt("index",-1);
        onUi(call, () -> {
            if(index<0 || index>=tabs.size()) {call.reject("标签页不存在");return;}
            closeTab(tabs.get(index));
            call.resolve();
        });
    }

    @PluginMethod public void close(PluginCall call) {
        onUi(call, () -> { closeNative(); call.resolve(); });
    }

    @PluginMethod public void navigate(PluginCall call) {
        String action = call.getString("action", "");
        String url = call.getString("url", "");
        onUi(call, () -> {
            if ("downloads".equals(action)) { openDownloads(); call.resolve(); return; }
            if (current == null) { call.reject("浏览器未打开"); return; }
            final Tab tab = current;
            switch (action) {
                case "back": goBack(); break;
                case "forward": runNavigation(tab, () -> {
                    if (tab.webView != null && tab.webView.canGoForward()) tab.webView.goForward();
                }); break;
                case "reload": reloadTab(tab); break;
                case "stop": stopTab(tab); break;
                case "desktop": toggleDesktop(); break;
                case "url": {
                    String target = normalizeUrl(url);
                    if (target == null) { call.reject("仅支持 HTTP/HTTPS 网站"); return; }
                    loadTabUrl(tab, target); break;
                }
                case "new": createTab("about:blank", null); break;
                case "home": loadTabUrl(tab, "about:blank"); break;
                case "scanMedia":
                    if (!activityPaused && isLive(tab, tab.webView) && tab.media != null) tab.media.scanNow();
                    break;
                case "tabs": showTabs(); break;
                case "scriptMenu": if (tab.runtime != null) tab.runtime.showMenus(); break;
                case "history": showPlaces(HISTORY); break;
                case "bookmarks": showPlaces(BOOKMARKS); break;
                default: call.reject("未知浏览器操作"); return;
            }
            call.resolve();
        });
    }

    private int dp(float value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }
    private int color(JSObject palette, String name, int fallback) {
        if (palette == null) return fallback;
        try { return Color.parseColor(palette.getString(name, "")); }
        catch (Exception e) { return fallback; }
    }
    private void updatePalette(JSObject colors) {
        ink = color(colors, "ink", ink);
        surface = color(colors, "surface", surface);
        paper = color(colors, "paper", paper);
        muted = color(colors, "muted", muted);
        accent = color(colors, "accent", accent);
        outline = color(colors, "outline", outline);
    }
    private GradientDrawable background(int fill, float radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(dp(radius));
        if (stroke != Color.TRANSPARENT) drawable.setStroke(dp(1), stroke);
        return drawable;
    }
    private TextView text(String content, float size, int color) {
        TextView view = new TextView(getActivity());
        view.setText(content); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.CENTER_VERTICAL);
        return view;
    }
    private TextView action(String content, String description, Runnable handler) {
        TextView view = text(content, 18, paper);
        view.setGravity(Gravity.CENTER);
        view.setContentDescription(description);
        view.setOnClickListener(ignored -> handler.run());
        view.setBackground(background(surface, 11, Color.TRANSPARENT));
        return view;
    }
    private FrameLayout embeddedRoot() {
        return (FrameLayout) getActivity().findViewById(android.R.id.content);
    }
    private void setEmbeddedBounds(float top, float bottom) {
        if (pageFrame == null) return;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1, -1, Gravity.TOP);
        params.topMargin = dp(Math.max(0, top));
        params.bottomMargin = dp(Math.max(0, bottom));
        pageFrame.setLayoutParams(params);
    }
    private void createEmbedded(float top, float bottom) {
        pageFrame = new FrameLayout(getActivity());
        pageFrame.setBackgroundColor(Color.WHITE);
        pageFrame.setVisibility(embeddedVisible ? View.VISIBLE : View.GONE);
        embeddedRoot().addView(pageFrame, new FrameLayout.LayoutParams(-1, -1, Gravity.TOP));
        setEmbeddedBounds(top, bottom);
    }

    private void createDialog() {
        root = new LinearLayout(getActivity()); root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(ink);
        LinearLayout titleRow = new LinearLayout(getActivity()); titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        titleRow.setPadding(dp(16), dp(8), dp(16), dp(4));
        titleView = text("有所闻  /  网页浏览", 16, paper);
        titleView.setTypeface(Typeface.create("serif", Typeface.BOLD));
        titleRow.addView(titleView, new LinearLayout.LayoutParams(0, dp(36), 1));
        desktopButton = action("电脑", "切换电脑版网站", this::toggleDesktop);
        desktopButton.setTextSize(12);
        titleRow.addView(desktopButton, new LinearLayout.LayoutParams(dp(54), dp(36)));
        root.addView(titleRow, new LinearLayout.LayoutParams(-1, dp(49)));

        LinearLayout searchRow = new LinearLayout(getActivity()); searchRow.setOrientation(LinearLayout.HORIZONTAL);
        searchRow.setGravity(Gravity.CENTER_VERTICAL); searchRow.setPadding(dp(14), dp(0), dp(14), dp(10));
        address = new EditText(getActivity()); address.setSingleLine(true);
        address.setTextColor(paper); address.setHintTextColor(muted); address.setTextSize(13);
        address.setSelectAllOnFocus(true); address.setHint("搜索或输入网址");
        address.setBackground(background(surface, 12, outline));
        address.setPadding(dp(13), dp(3), dp(13), dp(3));
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setOnEditorActionListener((view, id, event) -> {
            if (id != EditorInfo.IME_ACTION_GO && (event == null || event.getKeyCode() != KeyEvent.KEYCODE_ENTER)) return false;
            String url = normalizeUrl(view.getText().toString().trim());
            if (url != null && current != null) loadTabUrl(current, url);
            view.clearFocus();
            ((android.view.inputmethod.InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE))
                .hideSoftInputFromWindow(view.getWindowToken(), 0);
            return true;
        });
        searchRow.addView(address, new LinearLayout.LayoutParams(0, dp(44), 1));
        root.addView(searchRow, new LinearLayout.LayoutParams(-1, dp(54)));

        progress = text("", 11, accent); progress.setPadding(dp(16), dp(1), dp(16), dp(1));
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(17)));
        pageFrame = new FrameLayout(getActivity());
        pageFrame.setBackgroundColor(Color.WHITE);
        root.addView(pageFrame, new LinearLayout.LayoutParams(-1, 0, 1));
        LinearLayout footer = new LinearLayout(getActivity()); footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setGravity(Gravity.CENTER_VERTICAL); footer.setPadding(dp(12), dp(7), dp(12), dp(7));
        backButton = action("‹", "上一页", this::goBack);
        forwardButton = action("›", "下一页", () -> { if (current != null && current.webView != null && current.webView.canGoForward()) { final Tab tab = current; runNavigation(tab, () -> tab.webView.goForward()); } });
        TextView reload = action("⟳", "刷新", () -> { if (current != null) reloadTab(current); });
        TextView home = action("⌂", "首页", () -> { if (current != null) loadTabUrl(current, HOME); });
        tabCounter = action("1", "查看所有标签页", this::showTabs);
        menuButton = action("⋯", "浏览器菜单", this::showMore);
        for (TextView b : new TextView[] {backButton, forwardButton, reload, home, tabCounter, menuButton}) {
            LinearLayout.LayoutParams cell = new LinearLayout.LayoutParams(0, dp(45), 1);
            cell.leftMargin = dp(3); cell.rightMargin = dp(3);
            footer.addView(b, cell);
        }
        root.addView(footer, new LinearLayout.LayoutParams(-1, dp(62)));
        dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
        dialog.setContentView(root);
        dialog.setOnDismissListener(ignored -> closeNative());
        dialog.setOnKeyListener((dlg, code, event) -> {
            if (code != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_UP) return false;
            if (customFullscreen != null) { exitFullscreen(); return true; }
            if (current != null && current.webView != null && current.webView.canGoBack()) { goBack(); return true; }
            return false;
        });
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(-1, -1);
            window.setStatusBarColor(ink);
            window.setNavigationBarColor(ink);
        }
    }

    private static boolean isHttpUrl(String raw) {
        try {
            URI uri = new URI(raw);
            String scheme = uri.getScheme();
            return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
    private String normalizeUrl(String input) {
        if (input == null) return null;
        String candidate = input.trim();
        if (candidate.isEmpty()) return HOME;
        if ("about:blank".equals(candidate)) return candidate;
        if (!candidate.contains("://")) {
            if (candidate.matches("^[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?(/.*)?$") && candidate.contains(".")) {
                candidate = "https://" + candidate;
            } else {
                candidate = "https://www.bing.com/search?q=" + Uri.encode(candidate);
            }
        }
        return isHttpUrl(candidate) ? candidate : null;
    }

    private void createTab(String url, PluginCall call) {
        if (tabs.size() >= MAX_TABS) {
            if (call != null) call.reject("最多同时打开 6 个标签页");
            Toast.makeText(getContext(), "最多同时打开 6 个标签页", Toast.LENGTH_SHORT).show();
            return;
        }
        Tab tab = new Tab(url, nextTabId++);
        tab.userAgentMode = browserSettings.userAgentMode;
        tab.desktop = "desktop".equals(tab.userAgentMode);
        if (!embeddedMode && preferences.getBoolean("desktop-default", false)) {
            tab.desktop = true;
            tab.userAgentMode = "desktop";
        }
        tab.pendingOpen = call;
        tabs.add(tab);
        initializeTab(tab);
    }

    private boolean isLive(Tab tab, WebView view) {
        return !closing && !destroyed && view != null && tab.webView == view;
    }

    private void initializeTab(Tab tab) {
        if (deferForSiteClear(tab, tab.url)) { selectTab(tab); return; }
        tab.siteDataClearing = false;
        tab.recreateAfterSiteClear = false;
        WebView view = new WebView(getActivity()) {
            @Override public android.view.inputmethod.InputConnection onCreateInputConnection(EditorInfo info) {
                android.view.inputmethod.InputConnection connection = super.onCreateInputConnection(info);
                if (privateMode() && Build.VERSION.SDK_INT >= 26)
                    info.imeOptions |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
                return connection;
            }
        };
        if (privateMode()) {
            view.setSaveEnabled(false);
            view.setSaveFromParentEnabled(false);
            if (Build.VERSION.SDK_INT >= 26)
                view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
            if (Build.VERSION.SDK_INT >= 29)
                view.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        }
        tab.webView = view;
        tab.mobileUserAgent = view.getSettings().getUserAgentString();
        tab.error = null;
        tab.loading = false;
        tab.progress = 0;
        tab.hasLoaded = false;
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        if (privateMode()) {
            settings.setSaveFormData(false);
            settings.setDatabaseEnabled(false);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
        applySettings(tab);
        view.setFindListener((activeMatchOrdinal, numberOfMatches, isDoneCounting) -> {
            if (!isLive(tab, view) || tab.findQuery.isEmpty()) return;
            tab.findMatch = numberOfMatches == 0 ? -1 : activeMatchOrdinal;
            tab.findCount = numberOfMatches;
            sendFindResult(tab, isDoneCounting);
        });
        view.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView web, String address, Bitmap icon) {
                if (!isLive(tab, web) || deferForSiteClear(tab, address)) return;
                tab.url = address; tab.loading = true; tab.progress = 0; tab.error = null;
                if (current == tab) updateChrome();
                if (current == tab) sendNavigation(address, "start");
                if (tab.runtime != null) tab.runtime.onNavigation(address);
                if (tab.media != null) tab.media.onPageStarted(address);
                if (tab.images != null) tab.images.onPageStarted(address);
                tab.findQuery = ""; tab.findMatch = -1; tab.findCount = 0;
                sendFindResult(tab, true);
            }
            @Override public void onPageFinished(WebView web, String address) {
                if (!isLive(tab, web) || (tab.loading && !address.equals(tab.url))) return;
                tab.url = address; tab.title = web.getTitle() == null ? address : web.getTitle();
                tab.loading = false; tab.progress = 100;
                if (current == tab) updateChrome();
                if (!embeddedMode && !privateMode() && isHttpUrl(address)) recordVisit(tab.title, address);
                if (current == tab) sendNavigation(address, "end");
                if (tab.media != null) tab.media.onPageFinished();
            }
            @Override public boolean onRenderProcessGone(WebView web, RenderProcessGoneDetail detail) {
                if (!privateMode()) android.util.Log.e("NewsNookBrowser", "Renderer terminated: crashed=" + detail.didCrash()
                    + " priority=" + detail.rendererPriorityAtExit());
                if (!isLive(tab, web)) return true;
                // Android dispatches this separately for every affected WebView. Never select
                // a sibling here: it may be awaiting the same callback from this renderer.
                if (fullscreenTab == tab) exitFullscreen(false);
                releaseTabView(tab, true);
                tab.error = "网页渲染进程已退出，请刷新重试";
                if (current == tab && !closing) {
                    showTabContent(tab);
                    updateChrome();
                    sendNavigation(tab.url, "state");
                }
                JSObject state = new JSObject();
                state.put("type", "renderExit");
                state.put("tabId", tab.id);
                state.put("url", tab.url);
                state.put("crashed", detail.didCrash());
                state.put("recoverable", true);
                state.put("message", tab.error);
                notifyListeners("browserError", state);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                if (!isLive(tab, web)) return null;
                BrowserImageCapture images = tab.images;
                if (images != null) images.onRequest(request);
                BrowserMediaCapture media = tab.media;
                return media == null ? null : media.onRequest(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                if (!isLive(tab, web)) return true;
                if (!request.isForMainFrame()) return false;
                String target = request.getUrl().toString();
                if (!isHttpUrl(target) && !"about:blank".equals(target)) {
                    if (request.hasGesture()) openExternalApp(target);
                    return true;
                }
                if (deferForSiteClear(tab, target)) return true;
                if (tab.preparing || tab.scriptVersion != scriptVersion) {
                    runNavigation(tab, () -> web.loadUrl(target));
                    return true;
                }
                return false;
            }
            @Override public void onReceivedError(WebView web, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (!isLive(tab, web) || !request.isForMainFrame()) return;
                tab.loading = false;
                tab.error = "页面加载失败";
                if (current == tab) {
                    updateChrome();
                    sendNavigation(tab.url, "state");
                    if (progress != null) progress.setText("页面加载失败 · " + error.getDescription());
                }
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                return privateMode() || super.onConsoleMessage(message);
            }
            @Override public void onProgressChanged(WebView web, int percent) {
                if (!isLive(tab, web)) return;
                tab.progress = Math.max(0, Math.min(100, percent));
                if (current == tab) {
                    if (tab.loading && progress != null) progress.setText(percent < 100 ? "正在加载 · " + percent + "%" : "");
                    sendNavigation(tab.url, "state");
                }
            }
            @Override public void onReceivedTitle(WebView web, String title) {
                if (!isLive(tab, web)) return;
                tab.title = title == null ? "网页" : title;
                if (current == tab) {
                    updateChrome();
                    sendNavigation(tab.url, "state");
                }
            }
            @Override public void onShowCustomView(View content, CustomViewCallback callback) {
                if (!isLive(tab, view) || current != tab || customFullscreen != null || pageFrame == null) {
                    callback.onCustomViewHidden(); return;
                }
                fullscreenTab = tab;
                customFullscreen = content; customViewCallback = callback;
                fullscreenContainer = new FrameLayout(getActivity());
                fullscreenContainer.setBackgroundColor(Color.BLACK);
                fullscreenContainer.addView(content, new FrameLayout.LayoutParams(-1, -1));
                if (root != null) {
                    root.addView(fullscreenContainer, new LinearLayout.LayoutParams(-1, 0, 1));
                    pageFrame.setVisibility(View.GONE);
                } else {
                    pageFrame.addView(fullscreenContainer, new FrameLayout.LayoutParams(-1, -1));
                }
            }
            @Override public void onHideCustomView() {
                if (fullscreenTab == tab && isLive(tab, view)) exitFullscreen();
            }
        });
        view.setDownloadListener((link, agent, disposition, mime, size) -> {
            if (isLive(tab, view)) enqueueDownload(link, disposition, mime);
        });
        tab.images = new BrowserImageCapture(view, tab.id, tab.url);
        // Attach the same passive probe before any user script starts executing.
        try {
            tab.media = new BrowserMediaCapture(view, tab.url,
                observation -> sendMediaObservation(tab, observation),
                (pageUrl, reset) -> sendMediaPage(tab, pageUrl, reset));
        } catch (Exception error) {
            if (!privateMode()) android.util.Log.w("NewsNookBrowser", "Media observation unavailable", error);
        }
        selectTab(tab);
        prepareRuntime(tab);
    }

    private void prepareRuntime(Tab tab) {
        final WebView view = tab.webView;
        if (!isLive(tab, view)) return;
        if (tab.preparingRuntime != null) tab.preparingRuntime.close();
        final UserscriptRuntime runtime = new UserscriptRuntime(getContext(), view, privateMode());
        final JSArray snapshot = scriptSnapshot;
        final int version = scriptVersion;
        tab.preparingRuntime = runtime;
        tab.preparing = true;
        if (current == tab) { updateChrome(); sendNavigation(tab.url, "state"); }
        new Thread(() -> {
            String warning = null;
            try { runtime.prepare(snapshot); }
            catch (Exception error) { warning = "部分脚本准备失败"; }
            final String resultWarning = warning;
            mainHandler.post(() -> {
                if (!isLive(tab, view) || tab.preparingRuntime != runtime || !activityAvailable()) {
                    runtime.close(false);
                    return;
                }
                tab.preparingRuntime = null;
                if (tab.runtime != null) tab.runtime.close();
                tab.runtime = runtime;
                try { runtime.install(); }
                catch (Exception error) {
                    runtime.close();
                    tab.runtime = null;
                    if (!privateMode()) android.util.Log.w("NewsNookBrowser", "Userscript installation failed", error);
                    Toast.makeText(getContext(), "脚本功能不可用，请检查脚本或更新系统 WebView", Toast.LENGTH_LONG).show();
                }
                tab.scriptVersion = version;
                tab.preparing = false;
                Runnable pending = tab.pendingNavigation;
                tab.pendingNavigation = null;
                if (pending != null) {
                    tab.hasLoaded = true;
                    pending.run();
                } else if (!tab.hasLoaded) {
                    tab.hasLoaded = true;
                    view.loadUrl(tab.url);
                }
                if (resultWarning != null) Toast.makeText(getContext(), resultWarning, Toast.LENGTH_LONG).show();
                resolvePendingOpen(tab);
                if (current == tab) { updateChrome(); sendNavigation(tab.url, "state"); }
            });
        }, "NewsNookScriptPrepare").start();
    }

    private void resolvePendingOpen(Tab tab) {
        PluginCall call = tab.pendingOpen;
        tab.pendingOpen = null;
        if (call != null) call.resolve();
    }

    private void runNavigation(Tab tab, Runnable navigation) {
        if (tab.webView == null) return;
        if (!tab.preparing && tab.scriptVersion != scriptVersion) prepareRuntime(tab);
        if (tab.preparing) tab.pendingNavigation = navigation;
        else navigation.run();
    }

    private void loadTabUrl(Tab tab, String url) {
        if (deferForSiteClear(tab, url)) return;
        tab.siteDataClearing = false;
        tab.recreateAfterSiteClear = false;
        tab.url = url;
        tab.error = null;
        if (tab.webView == null) initializeTab(tab);
        else runNavigation(tab, () -> tab.webView.loadUrl(url));
    }

    private void reloadTab(Tab tab) {
        if (deferForSiteClear(tab, tab.url)) return;
        tab.error = null;
        if (tab.webView == null) initializeTab(tab);
        else if (tab.webView.getUrl() == null) loadTabUrl(tab, tab.url);
        else runNavigation(tab, () -> tab.webView.reload());
    }

    private void stopTab(Tab tab) {
        if (tab.preparingRuntime != null) tab.preparingRuntime.close();
        tab.preparingRuntime = null;
        tab.pendingNavigation = null;
        tab.preparing = false;
        tab.loading = false;
        tab.hasLoaded = true;
        if (tab.webView != null) tab.webView.stopLoading();
        resolvePendingOpen(tab);
        updateChrome();
        sendNavigation(tab.url, "state");
    }

    private void selectTab(Tab tab) {
        if (!tabs.contains(tab) || pageFrame == null || closing) return;
        if (current != tab && fullscreenTab != null) exitFullscreen();
        if (current != null) {
            if (current.webView != null) current.webView.onPause();
            if (current.media != null) current.media.setActive(false);
        }
        current = tab;
        if (tab.recreateAfterSiteClear && !tab.siteDataClearing && tab.webView == null) {
            initializeTab(tab);
            return;
        }
        showTabContent(tab);
        syncTabActivity();
        updateChrome();
        sendNavigation(tab.url, "state");
    }

    private void showTabContent(Tab tab) {
        if (pageFrame == null) return;
        pageFrame.removeAllViews();
        if (tab.webView != null) {
            ViewGroup parent = (ViewGroup) tab.webView.getParent();
            if (parent != null) parent.removeView(tab.webView);
            pageFrame.addView(tab.webView, new FrameLayout.LayoutParams(-1, -1));
            return;
        }
        LinearLayout errorPage = new LinearLayout(getActivity());
        errorPage.setOrientation(LinearLayout.VERTICAL);
        errorPage.setGravity(Gravity.CENTER);
        errorPage.setPadding(dp(24), dp(24), dp(24), dp(24));
        errorPage.setBackgroundColor(ink);
        TextView message = text(tab.siteDataClearing ? SITE_DATA_CLEARING
            : "网页暂时无法显示\n已保留网址，可刷新重试", 16, paper);
        message.setGravity(Gravity.CENTER);
        errorPage.addView(message, new LinearLayout.LayoutParams(-1, -2));
        TextView retry = action("刷新重试", "重新加载网页", () -> {
            if (current == tab && activityAvailable()) reloadTab(tab);
        });
        retry.setTextSize(14);
        retry.setEnabled(!tab.siteDataClearing);
        retry.setVisibility(tab.siteDataClearing ? View.GONE : View.VISIBLE);
        LinearLayout.LayoutParams retrySize = new LinearLayout.LayoutParams(dp(132), dp(44));
        retrySize.topMargin = dp(20);
        errorPage.addView(retry, retrySize);
        pageFrame.addView(errorPage, new FrameLayout.LayoutParams(-1, -1));
    }

    private void syncTabActivity() {
        if (current == null || current.webView == null) return;
        boolean active = !closing && !activityPaused && (!embeddedMode || embeddedVisible);
        if (active) current.webView.onResume();
        else current.webView.onPause();
        if (current.media != null) current.media.setActive(active);
    }
    private void updateChrome() {
        if (current == null) return;
        if (address == null) return;
        if (!address.hasFocus()) address.setText(current.url);
        titleView.setText("有所闻  /  " + abbreviated(current.title));
        tabCounter.setText(Integer.toString(tabs.size()));
        desktopButton.setTextColor(current.desktop ? accent : muted);
        progress.setText(current.error != null ? current.error : current.preparing ? "正在准备用户脚本…" : current.loading ? "正在加载…" : "");
        backButton.setAlpha(current.webView != null && current.webView.canGoBack() ? 1 : .4f);
        forwardButton.setAlpha(current.webView != null && current.webView.canGoForward() ? 1 : .4f);
    }
    private String abbreviated(String text) {
        if (text == null) return "网页浏览";
        return text.length() > 16 ? text.substring(0, 16) + "…" : text;
    }
    private void sendMediaObservation(Tab tab, JSONObject observation) {
        if (closing || !tabs.contains(tab)) return;
        JSObject payload = new JSObject();
        payload.put("tabId", tab.id);
        payload.put("type", "observation");
        payload.put("observation", observation);
        notifyListeners("mediaEvent", payload);
    }

    private void sendMediaPage(Tab tab, String url, boolean reset) {
        if (closing || !tabs.contains(tab)) return;
        if (url != null && !url.equals(tab.url)) {
            tab.url = url;
            if (tab == current) sendNavigation(url, "state");
        }
        JSObject payload = new JSObject();
        payload.put("tabId", tab.id);
        payload.put("type", reset ? "reset" : "page");
        payload.put("pageUrl", url);
        notifyListeners("mediaEvent", payload);
    }

    private void sendNavigation(String url, String phase) {
        if (closing || current == null) return;
        JSObject state = tabState(current);
        state.put("url", url);
        state.put("phase", phase);
        notifyListeners("navigation", state);
    }
    private void applySettings(Tab tab) {
        if (tab.webView == null) return;
        WebSettings settings = tab.webView.getSettings();
        settings.setJavaScriptEnabled(browserSettings.javaScriptEnabled);
        settings.setLoadsImagesAutomatically(browserSettings.loadsImagesAutomatically);
        settings.setTextZoom(browserSettings.textZoom);
        settings.setMediaPlaybackRequiresUserGesture(browserSettings.mediaPlaybackRequiresUserGesture);
        CookieManager.getInstance().setAcceptThirdPartyCookies(tab.webView, browserSettings.thirdPartyCookiesEnabled);
        applyAgent(tab);
    }

    private void applyAgent(Tab tab) {
        if (tab.webView == null) return;
        WebSettings settings = tab.webView.getSettings();
        if ("custom".equals(tab.userAgentMode)) {
            settings.setUserAgentString(browserSettings.customUserAgent);
            settings.setUseWideViewPort(false); settings.setLoadWithOverviewMode(false);
        } else if (tab.desktop) {
            settings.setUserAgentString(tab.mobileUserAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
                .replace("Version/4.0 ", "").replace(" Mobile ", " "));
            settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
        } else {
            settings.setUserAgentString(tab.mobileUserAgent);
            settings.setUseWideViewPort(false); settings.setLoadWithOverviewMode(false);
        }
    }
    private void toggleDesktop() {
        if (current == null) return;
        current.desktop = !current.desktop;
        current.userAgentMode = current.desktop ? "desktop" : "system";
        applyAgent(current);
        updateChrome();
        reloadTab(current);
    }
    private void goBack() {
        if (current != null && current.webView != null && current.webView.canGoBack()) {
            final Tab tab = current;
            runNavigation(tab, () -> tab.webView.goBack());
        } else closeNative();
    }
    private void showTabs() {
        if (current == null) return;
        final CharSequence[] choices = new CharSequence[tabs.size() + 2];
        for (int i = 0; i < tabs.size(); i++) choices[i] = (tabs.get(i) == current ? "● " : "   ") + abbreviated(tabs.get(i).title);
        choices[tabs.size()] = "+  新建标签页";
        choices[tabs.size() + 1] = "×  关闭当前标签页";
        new AlertDialog.Builder(getActivity()).setTitle("网页标签 · " + tabs.size())
            .setItems(choices, (dlg, index) -> {
                if (index < tabs.size()) selectTab(tabs.get(index));
                else if (index == tabs.size()) createTab(HOME, null);
                else closeTab(current);
            }).setNegativeButton("取消", null).show();
    }
    private void closeTab(Tab tab) {
        if (tab == null) return;
        int index = tabs.indexOf(tab);
        if (index < 0) return;
        boolean wasCurrent = current == tab;
        if (fullscreenTab == tab) exitFullscreen();
        if (wasCurrent) current = null;
        tabs.remove(tab);
        releaseTab(tab);
        if (tabs.isEmpty()) { closeNative(); return; }
        if (wasCurrent) selectTab(tabs.get(Math.min(index, tabs.size() - 1)));
        updateChrome();
    }
    private void showMore() {
        if (menuButton == null || current == null) return;
        PopupMenu popup = new PopupMenu(getActivity(), menuButton);
        String[] options = {
            "新建标签页", "切换标签页", "加入书签", "书签", "浏览历史", "电脑版网站",
            "用户脚本菜单", "管理用户脚本", "清除浏览历史", "设置", "关闭浏览器"
        };
        for (int i = 0; i < options.length; i++) popup.getMenu().add(0, i, i, options[i]);
        popup.setOnMenuItemClickListener(item -> {
            switch (item.getItemId()) {
                case 0: createTab(HOME, null); break;
                case 1: showTabs(); break;
                case 2: bookmarkCurrent(); break;
                case 3: showPlaces(BOOKMARKS); break;
                case 4: showPlaces(HISTORY); break;
                case 5: toggleDesktop(); break;
                case 6: if (current.runtime != null) current.runtime.showMenus(); break;
                case 7: notifyListeners("openScriptManager", new JSObject()); closeNative(); break;
                case 8: clearHistory(); break;
                case 9: showSettings(); break;
                case 10: closeNative(); break;
                default: return false;
            }
            return true;
        });
        popup.show();
    }
    private JSONArray readPlaces(String key) {
        try { return new JSONArray(preferences.getString(key, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }
    private void recordVisit(String title, String url) {
        if (privateMode()) return;
        JSONArray old = readPlaces(HISTORY), next = new JSONArray();
        JSONObject entry = new JSONObject();
        try {
            entry.put("title", title); entry.put("url", url); entry.put("time", System.currentTimeMillis());
            next.put(entry);
            for (int i=0; i<old.length() && next.length() < MAX_HISTORY; i++) {
                JSONObject candidate = old.optJSONObject(i);
                if (candidate != null && !url.equals(candidate.optString("url"))) next.put(candidate);
            }
            preferences.edit().putString(HISTORY, next.toString()).apply();
        } catch (Exception ignored) { }
    }
    private void bookmarkCurrent() {
        if (privateMode()) {
            Toast.makeText(getContext(), "隐私会话不保存书签", Toast.LENGTH_SHORT).show(); return;
        }
        if (current == null || !isHttpUrl(current.url)) return;
        JSONArray old = readPlaces(BOOKMARKS), next = new JSONArray();
        JSONObject entry = new JSONObject();
        try {
            entry.put("title", current.title); entry.put("url", current.url);
            entry.put("time", System.currentTimeMillis());
            next.put(entry);
            for (int i=0; i<old.length() && next.length() < MAX_BOOKMARKS; i++) {
                JSONObject candidate=old.optJSONObject(i);
                if (candidate != null && !current.url.equals(candidate.optString("url"))) next.put(candidate);
            }
            preferences.edit().putString(BOOKMARKS, next.toString()).apply();
            Toast.makeText(getContext(), "已加入书签", Toast.LENGTH_SHORT).show();
        } catch (Exception error) { Toast.makeText(getContext(), "无法保存书签", Toast.LENGTH_SHORT).show(); }
    }
    private void showPlaces(String key) {
        JSONArray list = readPlaces(key);
        if (list.length() == 0) {
            new AlertDialog.Builder(getActivity()).setMessage(HISTORY.equals(key) ? "暂无浏览历史" : "暂无书签")
                .setPositiveButton("知道了", null).show();
            return;
        }
        String[] labels = new String[list.length()];
        String[] urls = new String[list.length()];
        for (int i=0; i<list.length(); i++) {
            JSONObject item=list.optJSONObject(i);
            String link=item==null?"":item.optString("url");
            urls[i]=link;
            labels[i]=abbreviated(item==null?link:item.optString("title",link))+"\n"+link;
        }
        new AlertDialog.Builder(getActivity()).setTitle(HISTORY.equals(key)?"浏览历史":"书签")
            .setItems(labels, (dlg,index) -> {
                if (current != null && isHttpUrl(urls[index])) loadTabUrl(current, urls[index]);
            }).setNegativeButton("关闭",null).show();
    }
    private void clearHistory() {
        new AlertDialog.Builder(getActivity()).setTitle("清除浏览历史")
            .setMessage("只删除内置浏览器的访问记录，不影响最近阅读或网站登录状态。")
            .setPositiveButton("清除", (dlg, which) -> preferences.edit().remove(HISTORY).apply())
            .setNegativeButton("取消", null).show();
    }
    private void showSettings() {
        String[] options={"新标签页默认电脑模式："+(preferences.getBoolean("desktop-default",false)?"开":"关"),
                "清除浏览历史", "网站 Cookie", "网页脚本"};
        new AlertDialog.Builder(getActivity()).setTitle("浏览器设置")
            .setItems(options,(dlg,index)->{
                switch(index){
                    case 0:
                        preferences.edit().putBoolean("desktop-default",!preferences.getBoolean("desktop-default",false)).apply();
                        showSettings();break;
                    case 1: clearHistory();break;
                    case 2: new AlertDialog.Builder(getActivity()).setMessage("网页 Cookie 与应用内其他 WebView 可能共享。清除 Cookie 也可能退出登录；此版本不执行全局 Cookie 清除。")
                        .setPositiveButton("知道了",null).show(); break;
                    case 3: notifyListeners("openScriptManager",new JSObject());closeNative();break;
                }
            }).setNegativeButton("关闭",null).show();
    }
    static android.content.Intent externalAppIntent(String target) throws java.net.URISyntaxException {
        Uri requested = Uri.parse(target);
        android.content.Intent parsed = "intent".equalsIgnoreCase(requested.getScheme())
            ? android.content.Intent.parseUri(target, android.content.Intent.URI_INTENT_SCHEME)
            : new android.content.Intent(android.content.Intent.ACTION_VIEW, requested);
        Uri address = parsed.getData();
        String scheme = address == null ? null : address.getScheme();
        if (scheme == null || java.util.Arrays.asList("javascript", "data", "file", "content", "about", "intent")
                .contains(scheme.toLowerCase(java.util.Locale.ROOT)))
            throw new IllegalArgumentException("unsupported external address");
        // A page may supply an address/package, never an explicit component, arbitrary action,
        // URI grants, selector or extras. Check the unwrapped scheme as well as the outer intent.
        return new android.content.Intent(android.content.Intent.ACTION_VIEW, address)
            .addCategory(android.content.Intent.CATEGORY_BROWSABLE).setPackage(parsed.getPackage());
    }

    private void openExternalApp(String target) {
        final android.content.Intent intent;
        try { intent = externalAppIntent(target); }
        catch (Exception invalid) { return; }
        Runnable launch = () -> {
            try {
                getActivity().startActivity(intent);
            } catch (Exception error) {
                Toast.makeText(getContext(), "没有可打开此链接的应用", Toast.LENGTH_SHORT).show();
            }
        };
        if (browserSettings.confirmExternalApps || privateMode()) {
            new AlertDialog.Builder(getActivity()).setTitle("打开外部应用")
                .setMessage(privateMode() ? "此链接将离开隐私会话，外部应用可能保留访问记录。" : "网站请求打开另一个应用。")
                .setPositiveButton("继续", (dialog, which) -> launch.run())
                .setNegativeButton("取消", null).show();
        } else launch.run();
    }

    private void openDownloads() {
        try {
            android.content.Intent intent = new android.content.Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS);
            getActivity().startActivity(intent);
        } catch (android.content.ActivityNotFoundException error) {
            Toast.makeText(getContext(), "当前设备没有下载管理器", Toast.LENGTH_SHORT).show();
        }
    }

    private void enqueueDownload(String url, String disposition, String mime) {
        if (!isHttpUrl(url)) return;
        if (privateMode()) {
            new AlertDialog.Builder(getActivity()).setTitle("保存文件")
                .setMessage("下载文件和系统下载记录会保留在设备上，退出隐私会话不会删除它们。")
                .setPositiveButton("保存", (dialog, which) -> enqueueConfirmedDownload(url, disposition, mime))
                .setNegativeButton("取消", null).show();
            return;
        }
        enqueueConfirmedDownload(url, disposition, mime);
    }

    private void enqueueConfirmedDownload(String url, String disposition, String mime) {
        try {
            android.app.DownloadManager manager=(android.app.DownloadManager)getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            android.app.DownloadManager.Request request=new android.app.DownloadManager.Request(Uri.parse(url));
            request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS,
                URLUtil.guessFileName(url,disposition,mime));
            String cookie=CookieManager.getInstance().getCookie(url);
            if(cookie!=null)request.addRequestHeader("Cookie",cookie);
            manager.enqueue(request);
            Toast.makeText(getContext(),"已添加到下载任务",Toast.LENGTH_SHORT).show();
        } catch(Exception e){ Toast.makeText(getContext(),"下载失败",Toast.LENGTH_SHORT).show(); }
    }
    private void exitFullscreen() { exitFullscreen(true); }

    private void exitFullscreen(boolean notifyWebView) {
        View content = customFullscreen;
        WebChromeClient.CustomViewCallback callback=customViewCallback;
        customFullscreen=null; customViewCallback=null; fullscreenTab=null;
        if (content != null && content.getParent() instanceof ViewGroup)
            ((ViewGroup)content.getParent()).removeView(content);
        if (fullscreenContainer != null) {
            if (fullscreenContainer.getParent() instanceof ViewGroup)
                ((ViewGroup) fullscreenContainer.getParent()).removeView(fullscreenContainer);
            fullscreenContainer=null;
        }
        if (pageFrame != null) pageFrame.setVisibility(!embeddedMode || embeddedVisible ? View.VISIBLE : View.GONE);
        if (notifyWebView && callback != null) {
            try { callback.onCustomViewHidden(); }
            catch (RuntimeException error) {
                if (!privateMode()) android.util.Log.w("NewsNookBrowser", "Fullscreen callback already unavailable", error);
            }
        }
    }
    private void releaseTab(Tab tab) { releaseTabView(tab, false); }

    private void releaseTabView(Tab tab, boolean rendererGone) {
        WebView view = tab.webView;
        tab.webView = null;
        tab.loading = false;
        tab.preparing = false;
        tab.pendingNavigation = null;
        PluginCall opening = tab.pendingOpen;
        tab.pendingOpen = null;
        if (tab.preparingRuntime != null) tab.preparingRuntime.close(false);
        tab.preparingRuntime = null;
        if (tab.runtime != null) tab.runtime.close(!rendererGone);
        tab.runtime = null;
        if (tab.media != null) tab.media.close(!rendererGone);
        tab.media = null;
        if (tab.images != null) tab.images.close(!rendererGone);
        tab.images = null;
        if (view != null) {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            // Destruction stops loading and removes clients. Do not make extra renderer
            // calls: another WebView may already have reported this process as gone.
            try { view.destroy(); }
            catch (RuntimeException error) {
                if (!privateMode()) android.util.Log.e("NewsNookBrowser", "WebView destruction failed", error);
            }
        }
        if (opening != null) {
            try { opening.reject(rendererGone ? "网页渲染进程已退出" : "浏览器已关闭"); }
            catch (RuntimeException error) {
                if (!privateMode()) android.util.Log.w("NewsNookBrowser", "Opening callback already unavailable", error);
            }
        }
    }
    private void closeNative() {
        if (closing) return;
        boolean wasOpen = pageFrame != null || dialog != null || !tabs.isEmpty();
        closing=true;
        SiteDataClear clearing = siteDataClear;
        siteDataClear = null;
        if (clearing != null) clearing.call.reject("浏览器已关闭");
        exitFullscreen();
        Dialog previous=dialog; dialog=null;
        if (embeddedMode && pageFrame != null && pageFrame.getParent() instanceof ViewGroup)
            ((ViewGroup) pageFrame.getParent()).removeView(pageFrame);
        embeddedMode=false;
        if (previous!=null && previous.isShowing()) previous.dismiss();
        List<Tab> released = new ArrayList<>(tabs);
        tabs.clear(); current=null;
        for (Tab tab : released) releaseTab(tab);
        nextTabId = 1;
        scriptSnapshot=null; address=null; titleView=null; tabCounter=null; menuButton=null;
        progress=null; backButton=null; forwardButton=null; desktopButton=null;
        pageFrame=null; root=null;
        if (wasOpen) notifyListeners("closed",new JSObject());
    }
    @Override protected void handleOnPause() {
        activityPaused = true;
        syncTabActivity();
    }

    @Override protected void handleOnResume() {
        activityPaused = false;
        syncTabActivity();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (Looper.myLooper() == Looper.getMainLooper()) closeNative();
        else mainHandler.post(this::closeNative);
    }
}
