package com.aizeek.newsnook;

import android.app.Dialog;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.graphics.Bitmap;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Ordinary first-party navigation, with manual verification when required. No remote JS interface. */
@CapacitorPlugin(name = "EncyclopediaPage")
public class EncyclopediaPagePlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView browser;
    private FrameLayout host;
    private Dialog dialog;
    private PluginCall active;
    private String requestId;
    private Runnable poll;
    private Runnable timeout;
    private boolean returnedFromVerification;
    private String requestedUrl;
    private String lastProbeState;
    private long unsupportedSince;
    private long navigationVersion;
    private long finishedNavigation = -1;

    static boolean acceptsProbe(long expected, long current, String startUrl, String resultUrl, String currentUrl) {
        return expected == current && startUrl != null && startUrl.equals(resultUrl) && startUrl.equals(currentUrl);
    }

    static boolean shouldReturnToItem(String url, String state, boolean finished) {
        if (!finished || !"unsupported".equals(state) || !allowsNavigation(url)) return false;
        try {
            URI uri = new URI(url);
            return "baike.baidu.com".equalsIgnoreCase(uri.getHost()) && (uri.getPath().isEmpty() || "/".equals(uri.getPath()));
        } catch (Exception ignored) { return false; }
    }

    static String desktopUserAgent(String browserUserAgent) {
        return browserUserAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
            .replace("Version/4.0 ", "").replace(" Mobile ", " ");
    }

    private void diagnostic(String message) {
        if ((getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) Log.d("NewsNookWiki", "request=" + requestId + " navigation=" + navigationVersion + " " + message);
    }

    static boolean allowsNavigation(String raw) {
        try {
            URI uri = new URI(raw);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && ("baike.baidu.com".equalsIgnoreCase(uri.getHost()) || "wappass.baidu.com".equalsIgnoreCase(uri.getHost()));
        } catch (Exception ignored) { return false; }
    }

    static boolean isItemUrl(String raw) {
        if (!allowsNavigation(raw)) return false;
        try {
            URI uri = new URI(raw);
            return "baike.baidu.com".equalsIgnoreCase(uri.getHost()) && uri.getPath() != null
                && uri.getPath().startsWith("/item/") && uri.getPath().length() > 6;
        } catch (Exception ignored) { return false; }
    }

    @PluginMethod public void read(PluginCall call) {
        String url = call.getString("url");
        String id = call.getString("id");
        if (id == null || id.isEmpty() || !isItemUrl(url)) { call.reject("百度百科词条地址无效"); return; }
        getActivity().runOnUiThread(() -> start(call, id, url));
    }

    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("id");
        getActivity().runOnUiThread(() -> {
            if (id != null && id.equals(requestId)) fail("百科查询已取消");
            call.resolve();
        });
    }

    private void start(PluginCall call, String id, String url) {
        if (active != null) fail("百科查询已取消");
        active = call;
        requestId = id;
        requestedUrl = url;
        returnedFromVerification = false;
        lastProbeState = "";
        unsupportedSince = 0;
        try {
            final String script;
            try (InputStream input = getContext().getAssets().open("wiki-baike-probe.js")) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int length;
                while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
                script = output.toString(StandardCharsets.UTF_8.name());
            }
            WebView view = new WebView(getActivity());
            DisplayRefreshPolicy.configureWebView(view);
            browser = view;
            WebSettings settings = view.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setUserAgentString(desktopUserAgent(settings.getUserAgentString()));
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setSupportMultipleWindows(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
            // Request the supported desktop layout using this WebView's Chromium version and cookie jar.
            host = new FrameLayout(getActivity());
            host.setVisibility(View.INVISIBLE);
            host.addView(view, new FrameLayout.LayoutParams(-1, -1));
            getActivity().addContentView(host, new ViewGroup.LayoutParams(-1, -1));
            view.setWebViewClient(new WebViewClient() {
                @Override public void onPageStarted(WebView ignored, String target, Bitmap favicon) {
                    if (browser != view) return;
                    navigationVersion++;
                    finishedNavigation = -1;
                    unsupportedSince = 0;
                    lastProbeState = "";
                    diagnostic("event=page-started");
                }
                @Override public void onPageFinished(WebView ignored, String target) {
                    if (browser == view && target.equals(view.getUrl())) {
                        finishedNavigation = navigationVersion;
                        diagnostic("event=page-finished");
                    }
                }
                @Override public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                    return request.isForMainFrame() && !allowsNavigation(request.getUrl().toString());
                }
                @Override public void onReceivedError(WebView ignored, WebResourceRequest request, WebResourceError error) {
                    if (browser == view && request.isForMainFrame()) {
                        diagnostic("event=main-frame-error code=" + error.getErrorCode());
                        fail("百度百科页面加载失败：" + error.getDescription());
                    }
                }
                @Override public void onReceivedHttpError(WebView ignored, WebResourceRequest request, WebResourceResponse response) {
                    if (browser == view && request.isForMainFrame() && response.getStatusCode() == 404) fail("HTTP 404");
                    // 403 may contain an official verification document; let it render for the user.
                }
            });
            poll = new Runnable() {
                @Override public void run() {
                    if (browser != view) return;
                    final long version = navigationVersion;
                    final String startUrl = view.getUrl();
                    view.evaluateJavascript(script, encoded -> {
                        if (browser != view) return;
                        try {
                            Object decoded = new JSONTokener(encoded).nextValue();
                            JSONObject data = decoded instanceof String ? new JSONObject((String) decoded) : null;
                            if (data != null && !acceptsProbe(version, navigationVersion, startUrl, data.optString("url", ""), view.getUrl())) {
                                handler.postDelayed(this, 250L);
                                return;
                            }
                            String state = data == null ? "loading" : data.optString("state", "loading");
                            if (!state.equals(lastProbeState)) {
                                lastProbeState = state;
                                diagnostic("event=probe state=" + state + " diagnostics=" + (data == null ? "null" : data.optJSONObject("diagnostics")));
                            }
                            if ("unsupported".equals(state)) {
                                if (unsupportedSince == 0) unsupportedSince = SystemClock.elapsedRealtime();
                                // Allow client hydration to finish before declaring a completed layout unsupported.
                                if (SystemClock.elapsedRealtime() - unsupportedSince >= 5_000L) {
                                    fail("百度百科页面已加载，但未识别到词条正文，请重试或切换百科源");
                                    return;
                                }
                            } else unsupportedSince = 0;
                            if ("ready".equals(state) && isItemUrl(view.getUrl())) {
                                String html = data.optString("html", "");
                                if (html.isEmpty() || html.length() > 4 * 1024 * 1024) { fail("百度百科页面过大或为空"); return; }
                                JSObject result = new JSObject();
                                result.put("html", html);
                                result.put("url", data.getString("url"));
                                CookieManager.getInstance().flush();
                                PluginCall completed = active;
                                cleanup();
                                completed.resolve(result);
                                return;
                            }
                            if ("missing".equals(state)) { fail("HTTP 404"); return; }
                            if ("too-large".equals(state)) { fail("百度百科页面过大"); return; }
                            if ("challenge".equals(state)) showVerification(view);
                            // Some verification flows finish on Baike's homepage. Return to the requested item once.
                            if (dialog != null && shouldReturnToItem(view.getUrl(), state, finishedNavigation == navigationVersion)
                                && !returnedFromVerification) {
                                returnedFromVerification = true;
                                view.loadUrl(requestedUrl);
                            }
                        } catch (Exception error) {
                            diagnostic("event=probe-decode-error type=" + error.getClass().getSimpleName());
                        }
                        if (browser == view) handler.postDelayed(this, 500L);
                    });
                }
            };
            timeout = () -> {
                diagnostic("event=timeout lastState=" + lastProbeState);
                fail("百度百科加载超时，请重试");
            };
            handler.postDelayed(timeout, 30_000L);
            handler.postDelayed(poll, 500L);
            view.loadUrl(url);
        } catch (Exception error) { fail("百度百科浏览器不可用：" + error.getMessage()); }
    }

    private void showVerification(WebView view) {
        if (dialog != null || browser != view) return;
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, 180_000L);
        Dialog visible = new Dialog(getActivity());
        dialog = visible;
        visible.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout layout = new LinearLayout(getActivity());
        layout.setOrientation(LinearLayout.VERTICAL);
        TextView close = new TextView(getActivity());
        close.setText("百度百科 · 请完成页面验证    取消");
        close.setPadding(24, 24, 24, 24);
        close.setOnClickListener(ignored -> fail("百科验证已取消"));
        layout.addView(close, new LinearLayout.LayoutParams(-1, -2));
        host.removeView(view);
        layout.addView(view, new LinearLayout.LayoutParams(-1, 0, 1));
        visible.setContentView(layout);
        visible.setOnCancelListener(ignored -> fail("百科验证已取消"));
        visible.show();
        if (visible.getWindow() != null) visible.getWindow().setLayout(-1, -1);
    }

    private void fail(String message) {
        PluginCall failed = active;
        cleanup();
        if (failed != null) failed.reject(message);
    }

    private void cleanup() {
        if (poll != null) handler.removeCallbacks(poll);
        if (timeout != null) handler.removeCallbacks(timeout);
        active = null;
        requestId = null;
        requestedUrl = null;
        WebView old = browser;
        browser = null;
        if (dialog != null) { dialog.setOnCancelListener(null); dialog.dismiss(); dialog = null; }
        if (old != null) {
            old.stopLoading();
            if (old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
            old.destroy();
        }
        if (host != null) {
            if (host.getParent() instanceof ViewGroup) ((ViewGroup) host.getParent()).removeView(host);
            host = null;
        }
    }

    @Override protected void handleOnDestroy() {
        handler.post(() -> fail("百科查询已取消"));
        super.handleOnDestroy();
    }
}
