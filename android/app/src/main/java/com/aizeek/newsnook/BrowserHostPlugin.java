package com.aizeek.newsnook;

import android.animation.ValueAnimator;
import android.app.AlertDialog;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.text.InputType;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
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
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.TextView;
import android.widget.Toast;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
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
    private static final String HOME = "https://www.google.com/";
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
        final String lastNonDesktopUserAgentMode;
        final boolean privateMode;
        final int textZoom;
        final boolean javaScriptEnabled;
        final boolean loadsImagesAutomatically;
        final boolean thirdPartyCookiesEnabled;
        final boolean mediaPlaybackRequiresUserGesture;
        final boolean confirmExternalApps;

        BrowserSettings(JSObject requested) {
            JSObject values = requested == null ? new JSObject() : requested;
            String mode = values.optString("userAgentMode", "system");
            if (!java.util.Arrays.asList("system", "android", "ios", "desktop", "custom").contains(mode))
                throw new IllegalArgumentException("无效的浏览器标识模式");
            userAgentMode = mode;
            customUserAgent = values.optString("customUserAgent", "").trim();
            if ("custom".equals(mode) && (customUserAgent.isEmpty() || customUserAgent.length() > 512
                    || !customUserAgent.matches("[\\x20-\\x7e]+")))
                throw new IllegalArgumentException("自定义浏览器标识须为 1–512 个可见英文字符，不能换行");
            String previous = values.optString("lastNonDesktopUserAgentMode", "system");
            if (!java.util.Arrays.asList("system", "android", "ios", "custom").contains(previous)
                    || ("custom".equals(previous) && customUserAgent.isEmpty())) previous = "system";
            lastNonDesktopUserAgentMode = "desktop".equals(mode) ? previous : mode;
            privateMode = values.optBoolean("privateMode", false);
            textZoom = Math.max(75, Math.min(200, values.optInt("textZoom", 100)));
            javaScriptEnabled = values.optBoolean("javaScriptEnabled", true);
            loadsImagesAutomatically = values.optBoolean("loadsImagesAutomatically", true);
            thirdPartyCookiesEnabled = values.optBoolean("thirdPartyCookiesEnabled", false);
            mediaPlaybackRequiresUserGesture = values.optBoolean("mediaPlaybackRequiresUserGesture", true);
            confirmExternalApps = values.optBoolean("confirmExternalApps", true);
        }

        JSObject toJson() {
            return new JSObject().put("userAgentMode", userAgentMode).put("customUserAgent", customUserAgent)
                .put("lastNonDesktopUserAgentMode", lastNonDesktopUserAgentMode).put("privateMode", privateMode)
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
        String preview;
        boolean desktop;
        boolean loading;
        boolean preparing;
        boolean hasLoaded;
        boolean recordHistory = true;
        int documentScriptVersion = -1;
        boolean freshDocumentRequired;
        BrowserPageProfile pageProfile;
        BrowserAgentRuntime agent;
        BrowserAgentInput agentInput;
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

    /**
     * A native WebView is layered ABOVE Capacitor's HTML UI. Rather than shrink the
     * WebView when an AI sheet opens (which changes CSS viewport and DOM positions),
     * clip only the rendered/touchable portion. Web content keeps its real layout.
     */
    private static final class ClippedBrowserFrame extends FrameLayout {
        private int occludedBottomPx;
        private boolean agentOperating;
        private final Paint agentPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF agentBorder = new RectF();
        private ValueAnimator agentBreathing;
        private float agentIntensity = 1f;
        private final Paint sheetShadowPaint = new Paint();
        private int sheetShadowBottom = -1;

        ClippedBrowserFrame(Context context) { super(context); }

        void setAgentOperating(boolean operating, int color) {
            agentPaint.setColor(color);
            if (agentOperating == operating) return;
            agentOperating = operating;
            syncAgentBreathing();
            invalidate();
        }

        private void syncAgentBreathing() {
            boolean animate = agentOperating && isAttachedToWindow() && isShown() && getWindowVisibility() == VISIBLE
                && (Build.VERSION.SDK_INT < 26 || ValueAnimator.areAnimatorsEnabled());
            if (animate && agentBreathing == null) {
                agentBreathing = ValueAnimator.ofFloat(.45f, 1f);
                agentBreathing.setDuration(1400);
                agentBreathing.setRepeatMode(ValueAnimator.REVERSE);
                agentBreathing.setRepeatCount(ValueAnimator.INFINITE);
                agentBreathing.addUpdateListener(value -> {
                    agentIntensity = (float) value.getAnimatedValue();
                    invalidate();
                });
                agentBreathing.start();
            } else if (!animate && agentBreathing != null) {
                agentBreathing.cancel();
                agentBreathing = null;
                agentIntensity = 1f;
            }
        }

        @Override protected void onAttachedToWindow() {
            super.onAttachedToWindow();
            syncAgentBreathing();
        }

        @Override protected void onDetachedFromWindow() {
            if (agentBreathing != null) {
                agentBreathing.cancel();
                agentBreathing = null;
            }
            super.onDetachedFromWindow();
        }

        @Override protected void onVisibilityChanged(View changedView, int visibility) {
            super.onVisibilityChanged(changedView, visibility);
            syncAgentBreathing();
        }

        @Override protected void onWindowVisibilityChanged(int visibility) {
            super.onWindowVisibilityChanged(visibility);
            if (visibility != VISIBLE && agentBreathing != null) {
                agentBreathing.cancel();
                agentBreathing = null;
            } else if (visibility == VISIBLE) syncAgentBreathing();
        }

        void setOccludedBottom(int pixels) {
            int next = Math.max(0, pixels);
            if (occludedBottomPx == next) return;
            occludedBottomPx = next;
            invalidate();
        }

        @Override public void draw(Canvas canvas) {
            int visibleHeight = Math.max(0, getHeight() - occludedBottomPx);
            int save = canvas.save();
            canvas.clipRect(0, 0, getWidth(), visibleHeight);
            super.draw(canvas);
            if (occludedBottomPx > 0 && visibleHeight > 0) {
                // HTML shadows sit UNDER this native WebView, so paint the sheet's
                // backdrop and elevation here. Keep page input and screenshots intact.
                canvas.drawColor(Color.argb(30, 0, 0, 0));
                float shadowHeight = 32 * getResources().getDisplayMetrics().density;
                if (sheetShadowBottom != visibleHeight) {
                    sheetShadowBottom = visibleHeight;
                    sheetShadowPaint.setShader(new LinearGradient(0, visibleHeight - shadowHeight,
                        0, visibleHeight, Color.TRANSPARENT, Color.argb(75, 0, 0, 0), Shader.TileMode.CLAMP));
                }
                canvas.drawRect(0, Math.max(0, visibleHeight - shadowHeight), getWidth(), visibleHeight, sheetShadowPaint);
            }
            // Draw above the native website, within the exposed viewport. This never
            // enters page DOM/screenshots or consumes touches intended for the page.
            if (agentOperating && visibleHeight > 0 && getWidth() > 0) {
                float density = getResources().getDisplayMetrics().density;
                agentPaint.setStyle(Paint.Style.STROKE);
                for (int band = 14; band >= 2; band--) {
                    float width = band * density;
                    agentPaint.setStrokeWidth(width * 2);
                    agentPaint.setAlpha(Math.round((band == 2 ? 155 : 5) * agentIntensity));
                    agentBorder.set(0, 0, getWidth(), visibleHeight);
                    canvas.drawRoundRect(agentBorder, 10 * density, 10 * density, agentPaint);
                }
            }
            canvas.restoreToCount(save);
        }

        @Override public boolean dispatchTouchEvent(MotionEvent event) {
            // Let the Capacitor HTML layer underneath handle dragging and clicking
            // inside the assistant sheet. Native web content remains interactive above.
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN
                    && event.getY() >= Math.max(0, getHeight() - occludedBottomPx)) return false;
            return super.dispatchTouchEvent(event);
        }
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
    private boolean agentBackgroundHeld;
    private boolean embeddedVisible = true;
    private int scriptVersion;
    private String agentScriptAsset;
    private final BrowserAgentSession agentOwner = new BrowserAgentSession();
    private BrowserAgentFiles agentFiles;
    private final BrowserAgentDialogs agentDialogs = new BrowserAgentDialogs();
    private ActivityResultLauncher<Intent> agentChooserLauncher;
    private String launchedChooserId;
    private boolean agentBarrier;
    private boolean agentDrainInFlight;
    private long agentDrainGeneration;
    private Tab agentDrainTab;
    private String agentDrainRunId;
    private final List<Runnable> agentDrainSuccess = new ArrayList<>();
    private final List<java.util.function.Consumer<String>> agentDrainFailure = new ArrayList<>();
    private boolean agentTabTransition;
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

    public static boolean isPrivacyModeEnabled(Context context) {
        return context != null && context.getSharedPreferences("newsnook-native-browser", Context.MODE_PRIVATE)
            .getBoolean("privacy-enabled", false);
    }

    private boolean privateMode() { return isPrivacyModeEnabled(getContext()); }

    private void savePrivacyPreference(boolean enabled) {
        SharedPreferences local = getContext().getSharedPreferences("newsnook-native-browser", Context.MODE_PRIVATE);
        if (local.getBoolean("privacy-enabled", false) != enabled
                && !local.edit().putBoolean("privacy-enabled", enabled).commit())
            throw new IllegalStateException("隐私设置保存失败，请重试");
        if (enabled) {
            pendingRecoverySession.set(null);
            // A page which was private at any point must not later enter history/recovery.
            for (Tab tab : tabs) tab.recordHistory = false;
        }
    }

    private JSObject privacyCapabilities() {
        boolean clear = false;
        try { clear = WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA); }
        catch (RuntimeException ignored) {}
        return new JSObject().put("privateMode", true)
            .put("clearSiteData", clear).put("sharedSiteData", true);
    }

    @PluginMethod public void getBrowserContext(PluginCall call) {
        onUi(call, () -> call.resolve(new JSObject().put("privateMode", privateMode())
            .put("privacyCapabilities", privacyCapabilities())));
    }

    @PluginMethod public void updateSettings(PluginCall call) {
        final BrowserSettings requested;
        try { requested = new BrowserSettings(call.getObject("settings")); }
        catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        onUi(call, () -> {
            BrowserSettings previous = browserSettings;
            boolean previousPrivacy = privateMode();
            boolean reload = previous.needsReload(requested);
            boolean privacyChanged = previousPrivacy != requested.privateMode;
            java.util.Map<Tab, String> previousModes = new java.util.IdentityHashMap<>();
            for (Tab tab : tabs) previousModes.put(tab, tab.userAgentMode);
            try {
                savePrivacyPreference(requested.privateMode);
                browserSettings = requested;
                for (Tab tab : tabs) {
                    tab.freshDocumentRequired |= reload || privacyChanged;
                    tab.userAgentMode = requested.userAgentMode;
                    tab.desktop = "desktop".equals(requested.userAgentMode);
                    applySettings(tab);
                }
                if (reload && current != null && current.webView != null && current.hasLoaded) reloadTab(current);
            } catch (RuntimeException failure) {
                browserSettings = previous;
                try { savePrivacyPreference(previousPrivacy); }
                catch (RuntimeException rollback) { failure.addSuppressed(rollback); }
                for (Tab tab : tabs) {
                    tab.userAgentMode = previousModes.getOrDefault(tab, previous.userAgentMode);
                    tab.desktop = "desktop".equals(tab.userAgentMode);
                    // A rollback can rebuild document-start bindings too; the next refresh must install them.
                    tab.freshDocumentRequired |= reload || privacyChanged;
                    try { applySettings(tab); }
                    catch (RuntimeException rollback) { failure.addSuppressed(rollback); }
                }
                if (current != null) sendNavigation(current.url, "state");
                throw failure;
            }
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
                    .put("sharedSiteData", true));
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
            .put("sharedSiteData", true));
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
        final BrowserSettings requestedSettings;
        try {
            JSObject values = call.getObject("settings");
            requestedSettings = new BrowserSettings(values == null
                ? new JSObject().put("privateMode", privateMode()) : values);
        }
        catch (IllegalArgumentException error) { call.reject(error.getMessage()); return; }
        JSObject requestedRecovery = call.getObject("recoverySession");
        if (requestedSettings.privateMode && requestedRecovery != null) { call.reject("隐私模式不恢复浏览记录"); return; }
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
        float occludedBottom = call.getFloat("occludedBottom", 0f);
        onUi(call, () -> {
            savePrivacyPreference(requestedSettings.privateMode);
            closeNative();
            try {
                closing = false;
                embeddedMode = embed;
                embeddedVisible = visible;
                scriptSnapshot = scripts;
                scriptVersion++;
                preferences = getContext().getSharedPreferences("newsnook-native-browser", Context.MODE_PRIVATE);
                browserSettings = requestedSettings;
                updatePalette(palette);
                if (embed) {
                    createEmbedded(top, bottom);
                    if (pageFrame instanceof ClippedBrowserFrame)
                        ((ClippedBrowserFrame) pageFrame).setOccludedBottom(dp(occludedBottom));
                } else createDialog();
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
        pendingRecoverySession.set(null);
        if (privateMode() || tabs.isEmpty()) return;
        JSArray entries = new JSArray();
        int activeIndex = 0;
        for (Tab tab : tabs) {
            if (!tab.recordHistory) continue;
            if (tab == current) activeIndex = entries.length();
            entries.put(new JSObject().put("url", tab.url).put("title", tab.title).put("desktop", tab.desktop));
        }
        JSObject session = normalizeRecoverySession(new JSObject().put("tabs", entries).put("activeIndex", activeIndex));
        if (session != null) pendingRecoverySession.set(session);
    }

    @PluginMethod public void takeRecoverySession(PluginCall call) {
        onUi(call, () -> {
            JSObject saved = pendingRecoverySession.getAndSet(null);
            JSObject session = privateMode() ? null : saved;
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
            String next = scripts == null ? "[]" : scripts.toString();
            String previous = scriptSnapshot == null ? "[]" : scriptSnapshot.toString();
            if (next.equals(previous)) { call.resolve(); return; }
            scriptSnapshot = scripts;
            scriptVersion++;
            // Existing documents keep their running scripts and granted ports until navigation.
            // runNavigation prepares the latest snapshot before the next document is loaded.
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
        state.put("recordHistory", tab != null && tab.recordHistory && !privateMode());
        state.put("activeScriptCount", tab == null || tab.runtime == null ? 0 : tab.runtime.getActiveScriptCount());
        state.put("matchedScriptCount", tab == null || tab.runtime == null ? 0 : tab.runtime.getMatchedScriptCount(tab.url));
        state.put("userAgentMode", tab == null ? browserSettings.userAgentMode : tab.userAgentMode);
        state.put("userAgent", tab == null || tab.webView == null ? "" : tab.webView.getSettings().getUserAgentString());
        state.put("textZoom", browserSettings.textZoom);
        state.put("loading", tab != null && (tab.loading || tab.preparing));
        state.put("progress", tab == null ? 0 : tab.progress);
        state.put("error", tab == null || tab.error == null ? JSONObject.NULL : tab.error);
        state.put("documentId", tab == null || tab.agent == null ? "" : tab.agent.documentId());
        state.put("agentState", agentOwner.state());
        state.put("agentViewport", agentViewportState(tab));
        return state;
    }

    private JSObject agentViewportState(Tab tab) {
        WebView view = tab == null ? null : tab.webView;
        int width = view == null ? 0 : view.getWidth(), height = view == null ? 0 : view.getHeight();
        Rect bounds = tab == current && isLive(tab, view) ? agentVisibleBounds(view) : new Rect();
        boolean visible = width > 0 && height > 0 && !bounds.isEmpty();
        boolean occluded = view != null && (bounds.left > view.getPaddingLeft() || bounds.top > view.getPaddingTop()
            || bounds.right < width - view.getPaddingRight() || bounds.bottom < height - view.getPaddingBottom());
        return new JSObject().put("width", width).put("height", height)
            .put("visibleRect", new JSObject().put("left", bounds.left).put("top", bounds.top)
                .put("right", bounds.right).put("bottom", bounds.bottom))
            .put("visible", visible).put("occluded", occluded)
            .put("layoutPending", view != null && (view.isLayoutRequested() || pageFrame != null && pageFrame.isLayoutRequested()));
    }

    @PluginMethod public void setBounds(PluginCall call) {
        float top = call.getFloat("top", 0f);
        float bottom = call.getFloat("bottom", 0f);
        boolean visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
        boolean agentOperating = Boolean.TRUE.equals(call.getBoolean("agentOperating", false));
        float occludedBottom = call.getFloat("occludedBottom", 0f);
        onUi(call, () -> {
            if (!embeddedMode || pageFrame == null) { call.resolve(); return; }
            Rect previousVisible = current == null || current.webView == null ? null : agentVisibleBounds(current.webView);
            setEmbeddedBounds(top, bottom);
            if (pageFrame instanceof ClippedBrowserFrame) {
                ((ClippedBrowserFrame) pageFrame).setOccludedBottom(dp(occludedBottom));
                ((ClippedBrowserFrame) pageFrame).setAgentOperating(agentOperating, accent);
            }
            // 拖拽面板期间会高频更新可视区域。仅在显隐真正改变时切换 WebView 生命周期，
            // 否则每帧 onResume()/onPause() 都会干扰渲染与视频播放。
            if (embeddedVisible != visible) {
                if (!visible && current != null && current.webView != null) {
                    captureTabPreview(current);
                }
                embeddedVisible = visible;
                if (current != null && current.agent != null) current.agent.invalidateVisual();
                if (!visible) pauseAgentForHuman("hidden");
                pageFrame.setVisibility(visible ? View.VISIBLE : View.GONE);
                syncTabActivity();
            }
            // Occlusion changes only the clipped overlay. The shot still requires identical
            // visible bounds at dispatch, while real View layout/scroll events retire it.
            if (current != null && previousVisible != null && !previousVisible.equals(agentVisibleBounds(current.webView)))
                cancelAgentInputForViewport(current);
            layoutBackgroundAgent();
            call.resolve();
        });
    }

    @PluginMethod public void tabs(PluginCall call) {
        onUi(call, () -> {
            if (current != null && current.webView != null) {
                captureTabPreview(current);
            }
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
                entry.put("preview",tab.preview == null ? JSONObject.NULL : tab.preview);
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

    private String agentScriptSource() throws java.io.IOException {
        if (agentScriptAsset != null) return agentScriptAsset;
        try (java.io.InputStream input = getContext().getAssets().open("browser-agent.js");
             java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream()) {
            byte[] chunk = new byte[4096];
            int count;
            while ((count = input.read(chunk)) != -1) out.write(chunk, 0, count);
            agentScriptAsset = out.toString(java.nio.charset.StandardCharsets.UTF_8.name());
            return agentScriptAsset;
        }
    }

    @PluginMethod public void agentSession(PluginCall call) {
        onUi(call, () -> {
            String action = call.getString("action", ""), runId = call.getString("runId", "");
            try {
                if ("start".equals(action) || "resume".equals(action)) {
                    if (agentBarrier) { call.reject("网页正在确认停止，请稍候"); return; }
                    if (agentDialogs.isShowing()) { call.reject("请先处理网页确认框"); return; }
                    if (activityPaused) { call.reject("请先返回浏览器页面"); return; }
                    Tab tab = current;
                    if (tab == null || !isLive(tab, tab.webView) || tab.agent == null || pageFrame == null) {
                        call.reject("请先打开网页"); return;
                    }
                    int requestedTab = call.getInt("tabId", tab.id);
                    if (requestedTab != tab.id) { call.reject("标签页已切换"); return; }
                    if (!browserSettings.javaScriptEnabled) { call.reject("请先在浏览器设置中启用 JavaScript"); return; }
                    if ("start".equals(action)) agentOwner.start(runId, tab.id);
                    else agentOwner.resume(runId, tab.id);
                    tab.agent.resume(runId);
                    try {
                        BrowserAgentForegroundService.acquire(getContext(), () -> pauseAgentForHuman("background_service_stopped"));
                        agentBackgroundHeld = true;
                        tab.webView.getSettings().setOffscreenPreRaster(true);
                    } catch (RuntimeException error) {
                        pauseAgentForHuman("background_service_failed");
                        call.reject("无法启动后台任务服务，请重试"); return;
                    }
                    call.resolve(agentSessionState());
                    return;
                }
                if (!"pause".equals(action) && !"stop".equals(action)) { call.reject("无效的任务状态"); return; }
                agentOwner.requireOwner(runId);
                Tab tab = findAgentTab(agentOwner.tabId());
                if ("stop".equals(action)) agentOwner.stop(runId); else agentOwner.pause(runId);
                releaseAgentBackground();
                if (agentFiles != null) {
                    if ("stop".equals(action)) agentFiles.cancelRun(runId);
                    else if (tab != null && tab.agent != null) agentFiles.cancelDocument(tab.id, tab.agent.documentId());
                }
                drainAgent(tab, runId, () -> call.resolve(agentSessionState()), call::reject);
                if ("stop".equals(action)) agentDialogs.close(true);
            } catch (IllegalArgumentException | IllegalStateException error) { call.reject(error.getMessage()); }
        });
    }

    private JSObject agentSessionState() {
        Tab tab = findAgentTab(agentOwner.tabId());
        return new JSObject().put("runId", agentOwner.runId()).put("state", agentOwner.state())
            .put("tabId", tab == null ? -1 : tab.id)
            .put("documentId", tab == null || tab.agent == null ? "" : tab.agent.documentId())
            .put("capabilities", tab == null || tab.agent == null ? new JSONObject() : tab.agent.capabilities());
    }

    private Tab findAgentTab(int id) { for (Tab tab : tabs) if (tab.id == id) return tab; return null; }

    private void drainAgent(Tab tab, String runId, Runnable success, java.util.function.Consumer<String> failure) {
        if (agentDrainSuccess.isEmpty() && !agentDrainInFlight) {
            agentDrainTab = tab;
            agentDrainRunId = runId;
        } else if (!runId.equals(agentDrainRunId)) { failure.accept("另一任务仍在确认停止"); return; }
        agentDrainSuccess.add(success);
        agentDrainFailure.add(failure);
        agentBarrier = true;
        if (tab != null && tab.agentInput != null) tab.agentInput.cancel(true);
        continueAgentDrain();
    }

    private void continueAgentDrain() {
        // A modal JavaScript dialog suspends script execution. Start the renderer ACK timer
        // only after the user has answered or an explicit stop has cancelled the dialog.
        if (agentDrainInFlight || agentDialogs.isShowing() || agentDrainSuccess.isEmpty()) return;
        Tab tab = agentDrainTab;
        if (tab == null || tab.agent == null || !isLive(tab, tab.webView)) { finishAgentDrain(null); return; }
        agentDrainInFlight = true;
        long generation = ++agentDrainGeneration;
        tab.agent.cancelRun(agentDrainRunId,
            () -> { if (generation == agentDrainGeneration) finishAgentDrain(null); },
            reason -> { if (generation == agentDrainGeneration) finishAgentDrain("网页未确认停止，请关闭当前标签页后重试：" + reason); });
    }

    private void finishAgentDrain(String error) {
        agentDrainGeneration++;
        agentDrainInFlight = false;
        agentBarrier = error != null;
        List<Runnable> success = new ArrayList<>(agentDrainSuccess);
        List<java.util.function.Consumer<String>> failure = new ArrayList<>(agentDrainFailure);
        agentDrainSuccess.clear(); agentDrainFailure.clear();
        agentDrainTab = null; agentDrainRunId = null;
        for (int index = 0; index < success.size(); index++) {
            if (error == null) success.get(index).run(); else failure.get(index).accept(error);
        }
    }

    private void releaseAgentBackground() {
        if (!agentBackgroundHeld) return;
        agentBackgroundHeld = false;
        BrowserAgentForegroundService.release(getContext());
        for (Tab tab : tabs) if (tab.webView != null) tab.webView.getSettings().setOffscreenPreRaster(false);
        syncTabActivity();
    }

    private void pauseAgentForHuman(String reason) {
        if (!agentOwner.isRunning()) return;
        String runId = agentOwner.runId();
        Tab tab = findAgentTab(agentOwner.tabId());
        agentOwner.pause(runId);
        releaseAgentBackground();
        if (tab != null && tab.agent != null) {
            tab.agent.invalidateVisual();
            if (agentFiles != null) agentFiles.cancelDocument(tab.id, tab.agent.documentId());
        }
        if (agentDialogs.isShowing())
            notifyListeners("agentSessionState", agentSessionState().put("reason", reason).put("awaitingUser", true));
        drainAgent(tab, runId, () -> notifyListeners("agentSessionState", agentSessionState().put("reason", reason)),
            error -> notifyListeners("agentSessionState", agentSessionState().put("reason", reason).put("error", error)));
    }

    private boolean showAgentDialog(Tab tab, WebView view, String url, String message, String kind,
                                    String defaultValue, JsResult result) {
        if (!isLive(tab, view)) return true;
        if (current != tab || !activityAvailable()) { result.cancel(); return true; }
        String documentId = tab.agent == null ? "" : tab.agent.documentId();
        agentDialogs.show(getActivity(), tab.id, documentId, url, message, kind, defaultValue,
            () -> {
                for (Tab active : tabs) if (active.agent != null) active.agent.setNativeDialogPending(true);
                pauseAgentForHuman("js_dialog");
            },
            value -> { if (result instanceof JsPromptResult) ((JsPromptResult) result).confirm(value); else result.confirm(); },
            result::cancel, () -> {
                for (Tab active : tabs) if (active.agent != null) active.agent.setNativeDialogPending(false);
                continueAgentDrain();
            });
        return true;
    }

    private Rect agentVisibleBounds(WebView view) {
        int bottom = view.getHeight();
        if (pageFrame instanceof ClippedBrowserFrame)
            bottom = Math.min(bottom, pageFrame.getHeight() - ((ClippedBrowserFrame) pageFrame).occludedBottomPx - view.getTop());
        if (activityPaused && !(agentBackgroundHeld && agentOwner.isRunning())
                || embeddedMode && !embeddedVisible || customFullscreen != null) return new Rect();
        return new Rect(view.getPaddingLeft(), view.getPaddingTop(),
            Math.max(view.getPaddingLeft(), view.getWidth() - view.getPaddingRight()),
            Math.max(view.getPaddingTop(), bottom - view.getPaddingBottom()));
    }

    private boolean agentRequestLive(Tab tab, WebView view, BrowserAgentSession.Request request) {
        return request.isLive() && !agentBarrier && isLive(tab, view) && current == tab
            && tab.agent != null && request.documentId.equals(tab.agent.documentId());
    }

    private java.util.function.BooleanSupplier agentInputGuard(Tab tab, WebView view, BrowserAgentSession.Request request) {
        Rect bounds = agentVisibleBounds(view);
        return () -> !bounds.isEmpty() && agentRequestLive(tab, view, request) && bounds.equals(agentVisibleBounds(view));
    }

    private void cancelAgentInputForViewport(Tab tab) {
        if (tab.agentInput == null || !tab.agentInput.hasActiveInput()) return;
        if (agentOwner.tabId() == tab.id) agentOwner.invalidate("网页可见区域已变化，请重新观察");
        if (tab.agentInput != null) tab.agentInput.cancel(true);
    }

    private void resolveAgent(PluginCall call, BrowserAgentSession.Request request, JSONObject result) {
        if (result.has("error") && request.wasDispatched()) {
            BrowserAgentRuntime.put(result, "dispatched", true);
            BrowserAgentRuntime.put(result, "code", "OUTCOME_UNKNOWN");
        }
        if (request.complete()) call.resolve(new JSObject().put("result", result));
    }

    private void rejectAgent(PluginCall call, String message, boolean dispatched) {
        if (dispatched) call.resolve(new JSObject().put("result", new JSObject()
            .put("error", message).put("code", "OUTCOME_UNKNOWN").put("dispatched", true)));
        else call.reject(message);
    }

    /** All mutations, including delayed navigation and touch UP events, carry native run ownership. */
    @PluginMethod public void agentAction(PluginCall call) {
        onUi(call, () -> {
            String action = call.getString("action", ""), runId = call.getString("runId", ""), requestId = call.getString("requestId", "");
            Tab tab = current;
            boolean navigation = java.util.Arrays.asList("navigate", "back", "forward", "new_tab", "switch_tab", "close_tab").contains(action);
            if (tab == null || !isLive(tab, tab.webView) || tab.agent == null || call.getInt("tabId", -1) != tab.id || agentBarrier) {
                call.reject("当前标签页不可操作，请重新观察"); return;
            }
            String expectedDocument = call.getString("documentId", "");
            if ((!"observe".equals(action) || !expectedDocument.isEmpty()) && !tab.agent.documentId().equals(expectedDocument)) {
                call.reject("网页文档已变化，请重新观察"); return;
            }
            boolean fileAction = java.util.Arrays.asList("files", "choose_files", "read_file").contains(action);
            if (!navigation && !fileAction && (!isHttpUrl(tab.url) || tab.loading || tab.preparing)) {
                call.reject("请等待网页加载并重新观察"); return;
            }
            final BrowserAgentSession.Request request;
            try { request = agentOwner.begin(runId, requestId, tab.id, tab.agent.documentId(),
                (message, dispatched) -> rejectAgent(call, message, dispatched)); }
            catch (IllegalArgumentException | IllegalStateException error) { call.reject(error.getMessage()); return; }
            WebView view = tab.webView;
            BrowserAgentRuntime runtime = tab.agent;
            Runnable timeout = () -> request.fail("操作超时，请重新观察网页");
            mainHandler.postDelayed(timeout, "choose_files".equals(action) ? 300_000 : 20_000);
            request.onCancel(() -> {
                mainHandler.removeCallbacks(timeout);
                runtime.cancelRequest(requestId);
                if (agentFiles != null) agentFiles.disarmRun(runId);
                if (tab.agentInput != null) tab.agentInput.cancel(true);
            });
            java.util.function.Consumer<JSONObject> done = result -> {
                mainHandler.removeCallbacks(timeout);
                if ("click".equals(action) && (result.has("error") || result.optBoolean("requiresScreenshot")) && agentFiles != null)
                    agentFiles.disarmRun(runId);
                resolveAgent(call, request, result);
            };
            try {
                if (agentFiles != null && !java.util.Arrays.asList("click", "choose_files", "observe", "screenshot", "files", "read_file").contains(action))
                    agentFiles.disarmRun(runId);
                if (navigation) { agentNavigate(call, request, tab, action, timeout); return; }
                JSONObject args = new JSONObject(call.getData().toString());
                if (fileAction) {
                    BrowserAgentFiles files = agentFiles();
                    if ("files".equals(action)) {
                        if (args.has("cancelFileId")) files.cancelFile(args.optString("cancelFileId"), runId);
                        if (args.has("forgetFileId")) files.forgetFile(args.optString("forgetFileId"), runId);
                        done.accept(files.list(runId));
                    } else if ("choose_files".equals(action)) {
                        request.onCancel(() -> files.cancelDocument(tab.id, request.documentId));
                        files.chooseFiles(tab.id, request.documentId, runId, requestId, args, done, request::fail);
                    } else {
                        request.onCancel(() -> files.cancelDocument(tab.id, request.documentId));
                        files.readFile(tab.id, request.documentId, runId, requestId, args, done, request::fail);
                    }
                    return;
                }
                if ("observe".equals(action)) { runtime.observe(runId, requestId, tab.id, done, request::fail); return; }
                if ("screenshot".equals(action)) {
                    runtime.capture(runId, requestId, tab.id, args.optString("snapshot"), agentVisibleBounds(view),
                        () -> agentRequestLive(tab, view, request), done, request::fail);
                    return;
                }
                if ("key".equals(action)) {
                    if (args.optString("snapshot").isEmpty()) { request.fail("必须先观察网页"); return; }
                    runtime.executeFrame(runId, requestId, args.optString("frameId", "main"), args.optString("frameDocumentId"),
                        BrowserAgentRuntime.json("action", "validate", "snapshot", args.optString("snapshot")), result -> {
                            if (!agentRequestLive(tab, view, request)) return;
                            if (!result.optBoolean("ok")) { done.accept(result); return; }
                            runtime.invalidateVisual();
                            tab.agentInput.key(args.optString("key"), agentInputGuard(tab, view, request), request::markDispatched,
                                () -> done.accept(BrowserAgentRuntime.json("ok", true, "dispatched", true, "method", "native_key")), request::fail);
                        }, request::fail);
                    return;
                }
                if ("gesture".equals(action) || "tap".equals(action)) {
                    JSONObject gesture = args.optJSONObject("gesture");
                    if ("tap".equals(action)) gesture = BrowserAgentRuntime.json("kind", "tap", "points", new JSONArray()
                        .put(BrowserAgentRuntime.json("x", args.optDouble("x", -1), "y", args.optDouble("y", -1))));
                    if (gesture == null) { request.fail("缺少手势参数"); return; }
                    JSONObject command = gesture;
                    String shotId = args.optString("shotId");
                    if (!runtime.validateShot(shotId, agentVisibleBounds(view))) { request.fail("截图已失效，请重新截图"); return; }
                    runtime.executeFrame(runId, requestId, "main", "", BrowserAgentRuntime.json("action", "validate", "snapshot", runtime.shotSnapshot()), result -> {
                        if (!agentRequestLive(tab, view, request)) return;
                        if (!result.optBoolean("ok") || !runtime.validateShot(shotId, agentVisibleBounds(view))) {
                            request.fail("网页画面已变化，请重新截图"); return;
                        }
                        runtime.invalidateVisual();
                        tab.agentInput.perform(command, agentVisibleBounds(view), agentInputGuard(tab, view, request), request::markDispatched,
                            () -> done.accept(BrowserAgentRuntime.json("ok", true, "dispatched", true, "method", "native_touch")), request::fail);
                    }, request::fail);
                    return;
                }
                if (!java.util.Arrays.asList("click", "type", "choose", "submit", "scroll").contains(action)) {
                    request.fail("不支持的 Agent 操作"); return;
                }
                if (args.optString("text").length() > 16_000) { request.fail("输入内容过长"); return; }
                if (!"scroll".equals(action) && (args.optInt("id", -1) < 0 || args.optInt("id", -1) >= 160)) {
                    request.fail("无效的元素编号"); return;
                }
                if (args.optString("snapshot").isEmpty()) { request.fail("必须先观察网页"); return; }
                runtime.invalidateVisual();
                if ("click".equals(action)) args.put("action", "prepare_click");
                String frameId = args.optString("frameId", "main");
                runtime.executeFrame(runId, requestId, frameId, args.optString("frameDocumentId"), args,
                    "click".equals(action) ? () -> {} : request::markDispatched, result -> {
                    if (!agentRequestLive(tab, view, request)) return;
                    if (!"click".equals(action) || !result.optBoolean("ok")) { done.accept(result); return; }
                    if (!runtime.isMainFrame(frameId) || !result.optBoolean("isTop")) {
                        done.accept(BrowserAgentRuntime.json("ok", false, "requiresScreenshot", true, "error", "请依据新截图点击此框架中的目标")); return;
                    }
                    JSONObject viewport = result.optJSONObject("viewport");
                    double width = viewport == null ? 0 : viewport.optDouble("width"), height = viewport == null ? 0 : viewport.optDouble("height");
                    double scaleX = (view.getWidth() - view.getPaddingLeft() - view.getPaddingRight()) / width;
                    double scaleY = (view.getHeight() - view.getPaddingTop() - view.getPaddingBottom()) / height;
                    if (!Double.isFinite(scaleX) || !Double.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0 || Math.abs(scaleX / scaleY - 1) > .08) {
                        done.accept(BrowserAgentRuntime.json("ok", false, "requiresScreenshot", true, "error", "页面缩放状态不确定，请使用新截图")); return;
                    }
                    double x = view.getPaddingLeft() + (result.optDouble("x") - viewport.optDouble("offsetLeft")) * scaleX;
                    double y = view.getPaddingTop() + (result.optDouble("y") - viewport.optDouble("offsetTop")) * scaleY;
                    JSONObject gesture = BrowserAgentRuntime.json("kind", "tap", "points", new JSONArray().put(BrowserAgentRuntime.json("x", x, "y", y)));
                    try { if (agentFiles != null) agentFiles.authorizeUploadClick(tab.id, request.documentId, runId, args); }
                    catch (IllegalStateException error) { request.fail(error.getMessage()); return; }
                    tab.agentInput.perform(gesture, agentVisibleBounds(view), agentInputGuard(tab, view, request), request::markDispatched,
                        () -> done.accept(BrowserAgentRuntime.json("ok", true, "dispatched", true, "method", "native_touch")), request::fail);
                }, request::fail);
            } catch (Exception error) { request.fail(error.getMessage() == null ? "Agent 操作失败" : error.getMessage()); }
        });
    }

    private void agentNavigate(PluginCall call, BrowserAgentSession.Request request, Tab original, String action, Runnable timeout) {
        String targetUrl = null;
        if ("navigate".equals(action) || "new_tab".equals(action)) {
            targetUrl = normalizeUrl(call.getString("url", ""));
            if (targetUrl == null || !isHttpUrl(targetUrl)) { request.fail("仅支持 HTTP/HTTPS 网站"); return; }
        }
        if ("switch_tab".equals(action) || "close_tab".equals(action)) {
            Tab target = findAgentTab(call.getInt("targetTabId", -1));
            if (target == null) { request.fail("目标标签页已关闭"); return; }
            request.markDispatched();
            if (!request.complete()) return;
            mainHandler.removeCallbacks(timeout);
            agentTabTransition = true;
            try {
                if ("switch_tab".equals(action)) selectTab(target); else closeTab(target);
                if (current != null) agentOwner.moveToTab(current.id);
                call.resolve(new JSObject().put("result", agentNavigationResult()));
            } catch (RuntimeException error) { rejectAgent(call, "标签页切换或关闭结果未确认，请重新观察", true); }
            finally { agentTabTransition = false; }
            return;
        }
        Tab target = original;
        if ("new_tab".equals(action)) {
            if (tabs.size() >= MAX_TABS) { request.fail("最多同时打开 6 个标签页"); return; }
            request.markDispatched();
            agentTabTransition = true;
            try { createTab(targetUrl, null); target = current; }
            finally { agentTabTransition = false; }
            if (target == null || target == original || target.webView == null) { request.fail("无法创建标签页"); return; }
            agentOwner.transfer(request, target.id);
            // The guarded runnable below owns the first load, even if userscript preparation is slow.
            target.hasLoaded = true;
        }
        final Tab tab = target;
        final WebView view = tab.webView;
        final String url = targetUrl;
        Runnable navigation = () -> {
            if (!request.isLive() || current != tab || !isLive(tab, view) || agentOwner.tabId() != tab.id) return;
            if ("back".equals(action) && !view.canGoBack() || "forward".equals(action) && !view.canGoForward()) {
                request.fail("没有可前往的历史页面"); return;
            }
            request.markDispatched();
            if (!request.complete()) return;
            mainHandler.removeCallbacks(timeout);
            tab.agent.invalidateVisual();
            try {
                if ("back".equals(action)) view.goBack();
                else if ("forward".equals(action)) view.goForward();
                else { tab.url = url; tab.error = null; view.loadUrl(url); }
                call.resolve(new JSObject().put("result", agentNavigationResult().put("navigating", true)));
            } catch (RuntimeException error) { rejectAgent(call, "网页导航结果未确认，请重新观察", true); }
        };
        request.onCancel(() -> { if (tab.pendingNavigation == navigation) tab.pendingNavigation = null; });
        runNavigation(tab, navigation);
    }

    private JSObject agentNavigationResult() {
        return new JSObject().put("ok", true).put("tabId", current == null ? -1 : current.id)
            .put("documentId", current == null || current.agent == null ? "" : current.agent.documentId())
            .put("closed", current == null);
    }

    private BrowserAgentFiles agentFiles() {
        if (agentFiles == null) agentFiles = new BrowserAgentFiles(getContext(), new BrowserAgentFiles.Host() {
            @Override public android.app.Activity getActivity() { return BrowserHostPlugin.this.getActivity(); }
            @Override public boolean isDocumentLive(int tabId, String documentId) {
                Tab tab = findAgentTab(tabId);
                return tab != null && isLive(tab, tab.webView) && tab.agent != null && tab.agent.documentId().equals(documentId);
            }
            @Override public boolean isPrivateTab(int tabId) { return privateMode(); }
            @Override public void onEvent(JSONObject event) {
                try { notifyListeners("agentFileEvent", new JSObject(event.toString())); }
                catch (org.json.JSONException ignored) { }
            }
            @Override public void launchChooser(String requestId, Intent intent) { launchAgentChooser(requestId, intent); }
        });
        return agentFiles;
    }

    private void launchAgentChooser(String requestId, Intent intent) {
        if (!activityAvailable() || launchedChooserId != null) throw new IllegalStateException("系统文件选择器尚未结束");
        if (agentChooserLauncher == null) {
            agentChooserLauncher = getActivity().getActivityResultRegistry().register("newsnook-browser-files-" + java.util.UUID.randomUUID(),
                new ActivityResultContracts.StartActivityForResult(), result -> {
                    String id = launchedChooserId;
                    launchedChooserId = null;
                    if (agentFiles != null && id != null) agentFiles.handleChooserResult(id, result.getResultCode(), result.getData());
                });
        }
        launchedChooserId = requestId;
        try { agentChooserLauncher.launch(intent); }
        catch (RuntimeException error) { launchedChooserId = null; throw error; }
    }

    @PluginMethod public void navigate(PluginCall call) {
        String action = call.getString("action", "");
        String url = call.getString("url", "");
        onUi(call, () -> {
            if ("downloads".equals(action)) { openDownloads(); call.resolve(); return; }
            if (current == null) { call.reject("浏览器未打开"); return; }
            if (java.util.Arrays.asList("back", "forward", "reload", "stop", "desktop", "url", "new", "home").contains(action))
                pauseAgentForHuman("navigation");
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
        int topPx = dp(Math.max(0, top));
        int bottomPx = dp(Math.max(0, bottom));
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) pageFrame.getLayoutParams();
        if (params != null && params.topMargin == topPx && params.bottomMargin == bottomPx) return;
        if (params == null) params = new FrameLayout.LayoutParams(-1, -1, Gravity.TOP);
        params.topMargin = topPx;
        params.bottomMargin = bottomPx;
        pageFrame.setLayoutParams(params);
    }
    private void createEmbedded(float top, float bottom) {
        pageFrame = new ClippedBrowserFrame(getActivity());
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
                candidate = "https://www.google.com/search?q=" + Uri.encode(candidate);
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
            @Override public boolean dispatchKeyEvent(KeyEvent event) {
                if (event.getAction() == KeyEvent.ACTION_DOWN && (tab.agentInput == null || !tab.agentInput.isDispatching())
                        && agentOwner.tabId() == tab.id) pauseAgentForHuman("user_key");
                return super.dispatchKeyEvent(event);
            }
            @Override public boolean dispatchTouchEvent(MotionEvent event) {
                if (event.getActionMasked() == MotionEvent.ACTION_DOWN
                        && (tab.agentInput == null || !tab.agentInput.isDispatching())) {
                    if (tab.agent != null) tab.agent.invalidateVisual();
                    if (agentOwner.tabId() == tab.id) pauseAgentForHuman("user_touch");
                }
                return super.dispatchTouchEvent(event);
            }
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
        tab.agentInput = new BrowserAgentInput(view);
        try { tab.agent = new BrowserAgentRuntime(view, agentScriptSource(), () -> isLive(tab, view)); }
        catch (java.io.IOException error) {
            if (!privateMode()) android.util.Log.e("NewsNookBrowser", "Agent script unavailable", error);
        }
        view.setOnScrollChangeListener((web, x, y, oldX, oldY) -> { if (tab.agent != null) tab.agent.invalidateVisual(); });
        view.addOnLayoutChangeListener((web, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) {
                if (tab.agent != null) tab.agent.invalidateVisual();
                cancelAgentInputForViewport(tab);
            }
        });
        tab.pageProfile = new BrowserPageProfile(view);
        tab.error = null;
        tab.loading = false;
        tab.progress = 0;
        tab.hasLoaded = false;
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
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
                if (tab.agent != null) {
                    String previousDocument = tab.agent.documentId();
                    agentDialogs.cancelDocument(tab.id, previousDocument, true);
                    if (agentFiles != null) agentFiles.cancelDocument(tab.id, previousDocument);
                    if (agentOwner.tabId() == tab.id) agentOwner.invalidate("网页正在导航，请重新观察");
                    if (tab.agentInput != null) tab.agentInput.cancel(true);
                    tab.agent.onPageStarted(address);
                }
                tab.url = address; tab.loading = true; tab.progress = 0; tab.error = null;
                tab.recordHistory = !privateMode();
                tab.documentScriptVersion = tab.scriptVersion;
                tab.freshDocumentRequired = false;
                if (tab.pageProfile != null) tab.pageProfile.onPageStarted();
                if (tab.runtime != null) tab.runtime.onNavigation(address);
                if (current == tab) updateChrome();
                if (current == tab) sendNavigation(address, "start");
                if (tab.media != null) tab.media.onPageStarted(address);
                if (tab.images != null) tab.images.onPageStarted(address);
                tab.findQuery = ""; tab.findMatch = -1; tab.findCount = 0;
                sendFindResult(tab, true);
            }
            @Override public void onPageCommitVisible(WebView web, String address) {
                if (isLive(tab, web) && tab.runtime != null) tab.runtime.onDocumentCommitted(address);
            }
            @Override public void onPageFinished(WebView web, String address) {
                if (!isLive(tab, web) || (tab.loading && !address.equals(tab.url))) return;
                if (tab.runtime != null) tab.runtime.onDocumentCommitted(address);
                tab.url = address; tab.title = web.getTitle() == null ? address : web.getTitle();
                tab.loading = false; tab.progress = 100;
                if (current == tab) updateChrome();
                if (!embeddedMode && tab.recordHistory && !privateMode() && isHttpUrl(address)) recordVisit(tab.title, address);
                if (tab.pageProfile != null) tab.pageProfile.onPageFinished();
                if (current == tab) sendNavigation(address, "end");
                if (tab.media != null) tab.media.onPageFinished();
                if (isLive(tab, web)) {
                    web.postDelayed(() -> {
                        if (isLive(tab, web)) captureTabPreview(tab);
                    }, 350);
                }
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
            @Override public boolean onCreateWindow(WebView web, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                if (!isLive(tab, web) || current != tab || !isUserGesture || pageFrame == null
                        || tabs.size() >= MAX_TABS || resultMsg == null || resultMsg.getTarget() == null
                        || !(resultMsg.obj instanceof WebView.WebViewTransport)) return false;
                pauseAgentForHuman("popup");
                createTab("about:blank", null);
                Tab popup = current;
                if (popup == null || popup == tab || popup.webView == null) return false;
                // The transport owns the first navigation. Userscript preparation must not
                // later overwrite a login window's URL with our initial about:blank value.
                popup.hasLoaded = true;
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(popup.webView);
                resultMsg.sendToTarget();
                return true;
            }
            @Override public void onCloseWindow(WebView web) {
                if (isLive(tab, web)) closeTab(tab);
            }
            @Override public boolean onJsAlert(WebView web, String url, String message, JsResult result) {
                return showAgentDialog(tab, web, url, message, "alert", "", result);
            }
            @Override public boolean onJsConfirm(WebView web, String url, String message, JsResult result) {
                return showAgentDialog(tab, web, url, message, "confirm", "", result);
            }
            @Override public boolean onJsPrompt(WebView web, String url, String message, String defaultValue, JsPromptResult result) {
                return showAgentDialog(tab, web, url, message, "prompt", defaultValue, result);
            }
            @Override public boolean onJsBeforeUnload(WebView web, String url, String message, JsResult result) {
                return showAgentDialog(tab, web, url, message, "before_unload", "", result);
            }
            @Override public boolean onShowFileChooser(WebView web, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!isLive(tab, web) || current != tab || tab.agent == null) { callback.onReceiveValue(null); return true; }
                String runId = agentOwner.isRunning() && agentOwner.tabId() == tab.id ? agentOwner.runId() : "";
                return agentFiles().onShowFileChooser(tab.id, tab.agent.documentId(), runId, params, result -> {
                    if (isLive(tab, web)) callback.onReceiveValue(result);
                });
            }
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
            if (!isLive(tab, view) || tab.agent == null) return;
            try {
                String runId = agentOwner.isRunning() && agentOwner.tabId() == tab.id ? agentOwner.runId() : "";
                agentFiles().enqueueDownload(tab.id, tab.agent.documentId(), runId, link, agent, disposition, mime, size);
            } catch (Exception error) { Toast.makeText(getContext(), "下载失败，请检查文件地址", Toast.LENGTH_SHORT).show(); }
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
                if (version != scriptVersion) {
                    // A newer install can arrive while @require is being fetched.
                    // Keep the pending navigation, but never load it with the retired snapshot.
                    runtime.close(false);
                    tab.preparingRuntime = null;
                    prepareRuntime(tab);
                    return;
                }
                tab.preparingRuntime = null;
                if (tab.runtime != null) tab.runtime.close();
                tab.runtime = runtime;
                runtime.setPrivateMode(privateMode());
                runtime.setStateListener(() -> {
                    if (isLive(tab, view) && tab.runtime == runtime && current == tab) sendNavigation(tab.url, "state");
                });
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
        else runNavigation(tab, () -> {
            // WebView reload can reuse a document without installing newly added world/port
            // bindings. A same-URL navigation installs the latest bindings without a new tab.
            if (tab.freshDocumentRequired || tab.documentScriptVersion != tab.scriptVersion)
                tab.webView.loadUrl(tab.url);
            else tab.webView.reload();
        });
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

    private void captureTabPreview(Tab tab) {
        if (tab == null || tab.webView == null || closing || destroyed) return;
        final WebView view = tab.webView;
        int width = view.getWidth(), height = view.getHeight();
        if (width <= 0 || height <= 0) return;
        float scale = Math.min(1f, 360f / width);
        int targetWidth = Math.max(1, Math.round(width * scale));
        int targetHeight = Math.max(1, Math.round(height * scale));
        Bitmap bitmap = null;
        try {
            bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.RGB_565);
            Canvas canvas = new Canvas(bitmap);
            canvas.drawColor(surface);
            canvas.scale(scale, scale);
            view.draw(canvas);
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 65, stream);
            tab.preview = "data:image/jpeg;base64," + Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP);
        } catch (Throwable ignored) {
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }

    private void saveTabPreviewFromBitmap(Tab tab, Bitmap source) {
        if (tab == null || source == null || source.isRecycled()) return;
        try {
            int w = source.getWidth(), h = source.getHeight();
            if (w <= 0 || h <= 0) return;
            float scale = Math.min(1f, 360f / w);
            int targetW = Math.max(1, Math.round(w * scale));
            int targetH = Math.max(1, Math.round(h * scale));
            Bitmap thumbnail = Bitmap.createScaledBitmap(source, targetW, targetH, true);
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            thumbnail.compress(Bitmap.CompressFormat.JPEG, 65, stream);
            tab.preview = "data:image/jpeg;base64," + Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP);
            if (thumbnail != source && !thumbnail.isRecycled()) {
                thumbnail.recycle();
            }
        } catch (Throwable ignored) {}
    }

    private void selectTab(Tab tab) {
        if (!tabs.contains(tab) || pageFrame == null || closing) return;
        if (current != tab && !agentTabTransition) pauseAgentForHuman("tab_switch");
        if (current != tab && fullscreenTab != null) exitFullscreen();
        if (current != null) {
            if (current.webView != null) current.webView.onPause();
            if (current.media != null) current.media.setActive(false);
        }
        final Tab previous = current;
        current = tab;
        if (tab.recreateAfterSiteClear && !tab.siteDataClearing && tab.webView == null) {
            initializeTab(tab);
            return;
        }
        showTabContent(tab, previous);
        syncTabActivity();
        updateChrome();
        sendNavigation(tab.url, "state");
    }

    private void showTabContent(Tab tab) {
        showTabContent(tab, null);
    }

    private void showTabContent(Tab tab, Tab previous) {
        if (pageFrame == null) return;
        boolean canAnimate = previous != null && previous != tab && previous.webView != null
                && tab.webView != null && pageFrame.getWidth() > 0 && pageFrame.getHeight() > 0
                && (!embeddedMode || embeddedVisible) && !activityPaused && !closing;

        if (canAnimate) {
            Bitmap previousSnapshot = null;
            try {
                int w = pageFrame.getWidth();
                int h = pageFrame.getHeight();
                previousSnapshot = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
                Canvas canvas = new Canvas(previousSnapshot);
                canvas.drawColor(surface);
                previous.webView.draw(canvas);
                saveTabPreviewFromBitmap(previous, previousSnapshot);
            } catch (Throwable ignored) {
                previousSnapshot = null;
            }

            if (previousSnapshot != null) {
                final Bitmap bmpToRecycle = previousSnapshot;
                final ImageView snapshotView = new ImageView(getActivity());
                snapshotView.setImageBitmap(previousSnapshot);
                snapshotView.setScaleType(ImageView.ScaleType.FIT_XY);

                pageFrame.removeAllViews();
                pageFrame.addView(snapshotView, new FrameLayout.LayoutParams(-1, -1));

                if (tab.webView.getParent() != null) {
                    ((ViewGroup) tab.webView.getParent()).removeView(tab.webView);
                }
                final int width = pageFrame.getWidth();
                tab.webView.setTranslationX(width * 0.35f);
                tab.webView.setAlpha(0f);
                pageFrame.addView(tab.webView, new FrameLayout.LayoutParams(-1, -1));

                tab.webView.animate()
                    .translationX(0f)
                    .alpha(1f)
                    .setDuration(220)
                    .setInterpolator(new android.view.animation.DecelerateInterpolator(1.4f))
                    .withEndAction(() -> {
                        if (pageFrame != null) pageFrame.removeView(snapshotView);
                        if (bmpToRecycle != null && !bmpToRecycle.isRecycled()) bmpToRecycle.recycle();
                    })
                    .start();

                snapshotView.animate()
                    .translationX(-width * 0.15f)
                    .alpha(0.6f)
                    .setDuration(220)
                    .setInterpolator(new android.view.animation.DecelerateInterpolator(1.4f))
                    .start();

                layoutBackgroundAgent();
                return;
            }
        }

        pageFrame.removeAllViews();
        if (tab.webView != null) {
            tab.webView.setTranslationX(0f);
            tab.webView.setAlpha(1f);
            ViewGroup parent = (ViewGroup) tab.webView.getParent();
            if (parent != null) parent.removeView(tab.webView);
            pageFrame.addView(tab.webView, new FrameLayout.LayoutParams(-1, -1));
            layoutBackgroundAgent();
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

    private void layoutBackgroundAgent() {
        if (!activityPaused || !agentBackgroundHeld || !agentOwner.isRunning() || pageFrame == null) return;
        int width = pageFrame.getWidth(), height = pageFrame.getHeight();
        int left = pageFrame.getLeft(), top = pageFrame.getTop();
        if (embeddedMode && pageFrame.getParent() instanceof View) {
            View parent = (View) pageFrame.getParent();
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) pageFrame.getLayoutParams();
            if (parent.getWidth() > 0 && parent.getHeight() > 0) {
                left = params.leftMargin; top = params.topMargin;
                width = parent.getWidth() - left - params.rightMargin;
                height = parent.getHeight() - top - params.bottomMargin;
            }
        }
        // A stopped window has no traversal; new tabs still need the established viewport.
        if (width <= 0 || height <= 0) return;
        pageFrame.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        pageFrame.layout(left, top, left + width, top + height);
    }

    private void syncTabActivity() {
        if (current == null || current.webView == null) return;
        boolean active = !closing && (!activityPaused || agentBackgroundHeld && agentOwner.isRunning()) && (!embeddedMode || embeddedVisible);
        if (active) current.webView.onResume();
        else current.webView.onPause();
        current.webView.getSettings().setOffscreenPreRaster(agentBackgroundHeld && agentOwner.isRunning());
        layoutBackgroundAgent();
        if (current.media != null) current.media.setActive(active && !activityPaused);
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
        boolean privacy = privateMode();
        if (privacy) tab.recordHistory = false;
        settings.setSaveFormData(!privacy);
        settings.setCacheMode(privacy ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT);
        tab.webView.setSaveEnabled(!privacy);
        tab.webView.setSaveFromParentEnabled(!privacy);
        if (Build.VERSION.SDK_INT >= 26) tab.webView.setImportantForAutofill(privacy
            ? View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS : View.IMPORTANT_FOR_AUTOFILL_AUTO);
        if (Build.VERSION.SDK_INT >= 29) tab.webView.setImportantForContentCapture(privacy
            ? View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS : View.IMPORTANT_FOR_CONTENT_CAPTURE_AUTO);
        if (tab.runtime != null) tab.runtime.setPrivateMode(privacy);
        if (tab.preparingRuntime != null) tab.preparingRuntime.setPrivateMode(privacy);
        applyAgent(tab);
    }

    private void applyAgent(Tab tab) {
        if (tab.webView != null && tab.pageProfile != null)
            tab.pageProfile.apply(tab.userAgentMode, browserSettings.customUserAgent);
    }
    private void toggleDesktop() {
        if (current == null) return;
        current.desktop = !current.desktop;
        current.userAgentMode = current.desktop ? "desktop" : browserSettings.lastNonDesktopUserAgentMode;
        current.freshDocumentRequired = true;
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
        if (browserSettings.confirmExternalApps) {
            new AlertDialog.Builder(getActivity()).setTitle("打开外部应用")
                .setMessage("网站请求打开另一个应用。")
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
        if (tab.agentInput != null) tab.agentInput.cancel(!rendererGone);
        tab.agentInput = null;
        if (tab.agent != null) {
            agentDialogs.cancelDocument(tab.id, tab.agent.documentId(), !rendererGone);
            if (agentFiles != null) agentFiles.cancelDocument(tab.id, tab.agent.documentId());
            if (agentOwner.tabId() == tab.id && !agentTabTransition) {
                if (agentFiles != null) agentFiles.cancelRun(agentOwner.runId());
                agentOwner.stopCurrent();
                releaseAgentBackground();
                agentBarrier = false;
                notifyListeners("agentSessionState", agentSessionState().put("reason", rendererGone ? "renderer_exit" : "tab_closed"));
            }
            tab.agent.close(!rendererGone);
            tab.agent = null;
        }
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
        if (tab.pageProfile != null) tab.pageProfile.close(!rendererGone);
        tab.pageProfile = null;
        tab.preview = null;
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
        agentOwner.stopCurrent();
        releaseAgentBackground();
        agentDialogs.close(true);
        if (agentFiles != null) { agentFiles.close(); agentFiles = null; }
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
        finishAgentDrain(null);
        nextTabId = 1;
        scriptSnapshot=null; address=null; titleView=null; tabCounter=null; menuButton=null;
        progress=null; backButton=null; forwardButton=null; desktopButton=null;
        pageFrame=null; root=null;
        if (wasOpen) notifyListeners("closed",new JSObject());
    }
    @Override protected void handleOnPause() {
        activityPaused = true;
        // An explicit document picker owns the foreground temporarily; cancelling it here
        // would cancel every upload immediately after the chooser opens.
        if (launchedChooserId == null && !agentBackgroundHeld) pauseAgentForHuman("background");
        syncTabActivity();
    }

    @Override protected void handleOnStop() {
        // Capacitor/Cordova may pause its controller WebView after handleOnPause.
        if (agentBackgroundHeld && agentOwner.isRunning() && getBridge() != null)
            getBridge().getWebView().onResume();
        syncTabActivity();
    }

    @Override protected void handleOnResume() {
        activityPaused = false;
        syncTabActivity();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (agentChooserLauncher != null) { agentChooserLauncher.unregister(); agentChooserLauncher = null; }
        if (Looper.myLooper() == Looper.getMainLooper()) closeNative();
        else mainHandler.post(this::closeNative);
    }
}
