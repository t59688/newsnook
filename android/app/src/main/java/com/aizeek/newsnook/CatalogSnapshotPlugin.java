package com.aizeek.newsnook;

import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.json.JSONTokener;

@CapacitorPlugin(name = "CatalogSnapshot")
public class CatalogSnapshotPlugin extends Plugin {
    private static final long POLL_INTERVAL_MS = 250L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Operation active;
    private long operationEpoch;

    private static final class Operation {
        final PluginCall call;
        final String sessionId;
        final String initialUrl;
        final int maxBytes;
        final long epoch;
        WebView webView;
        FrameLayout host;
        Runnable poll;
        Runnable timeout;
        long navigationEpoch;
        String stableHtml;
        int stableCount;
        boolean settled;

        Operation(PluginCall call, String sessionId, String initialUrl, int maxBytes, long epoch) {
            this.call = call;
            this.sessionId = sessionId;
            this.initialUrl = initialUrl;
            this.maxBytes = maxBytes;
            this.epoch = epoch;
        }
    }

    static boolean acceptsSnapshot(long expectedEpoch, long currentEpoch, String expectedId, String currentId) {
        return expectedEpoch == currentEpoch && expectedId != null && expectedId.equals(currentId);
    }

    @PluginMethod
    public void render(PluginCall call) {
        String url = call.getString("url");
        String sessionId = call.getString("sessionId");
        String userAgent = call.getString("userAgent");
        if (!CatalogSnapshotPolicy.isInitialUrlAllowed(url)) {
            call.reject("目录快照 URL 无效");
            return;
        }
        if (!CatalogSnapshotPolicy.isSessionIdAllowed(sessionId)) {
            call.reject("目录快照会话 ID 无效");
            return;
        }
        if (!CatalogSnapshotPolicy.isUserAgentAllowed(userAgent)) {
            call.reject("目录快照 User-Agent 无效");
            return;
        }
        int timeoutMs = CatalogSnapshotPolicy.timeoutMs(call.getInt("timeoutMs"));
        int maxBytes = CatalogSnapshotPolicy.maxBytes(call.getInt("maxBytes"));
        getActivity().runOnUiThread(() -> start(call, sessionId, url, userAgent, timeoutMs, maxBytes));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (!CatalogSnapshotPolicy.isSessionIdAllowed(sessionId)) {
            call.reject("目录快照会话 ID 无效");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Operation operation = active;
            if (operation != null && sessionId.equals(operation.sessionId)) {
                reject(operation, "目录快照已取消");
            }
            call.resolve();
        });
    }

    private void start(
        PluginCall call,
        String sessionId,
        String url,
        String suppliedUserAgent,
        int timeoutMs,
        int maxBytes
    ) {
        if (active != null) reject(active, "目录快照已被新请求替换");
        Operation operation = new Operation(call, sessionId, url, maxBytes, ++operationEpoch);
        active = operation;
        try {
            WebView view = new WebView(getActivity());
            operation.webView = view;
            configureWebView(operation, view, suppliedUserAgent);
            attachOffscreen(operation, view);

            operation.poll = new Runnable() {
                @Override public void run() { poll(operation, this); }
            };
            operation.timeout = () -> reject(operation, "目录快照加载超时");
            handler.postDelayed(operation.poll, POLL_INTERVAL_MS);
            handler.postDelayed(operation.timeout, timeoutMs);
            view.loadUrl(url);
        } catch (RuntimeException error) {
            reject(operation, "目录快照浏览器不可用");
        }
    }

    private void configureWebView(Operation operation, WebView view, String suppliedUserAgent) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(false);
        settings.setSaveFormData(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        String userAgent = suppliedUserAgent == null || suppliedUserAgent.trim().isEmpty()
            ? CatalogSnapshotPolicy.normalizeUserAgent(settings.getUserAgentString())
            : suppliedUserAgent.trim();
        if (userAgent != null && !userAgent.isEmpty()) settings.setUserAgentString(userAgent);

        view.setFocusable(false);
        view.setFocusableInTouchMode(false);
        view.setLongClickable(false);
        view.setOnTouchListener((ignored, event) -> true);
        view.setDownloadListener((url, agent, disposition, mimeType, length) -> {});
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(
                String origin,
                GeolocationPermissions.Callback callback
            ) { callback.invoke(origin, false, false); }
            @Override public boolean onShowFileChooser(
                WebView webView,
                ValueCallback<Uri[]> filePathCallback,
                FileChooserParams fileChooserParams
            ) {
                filePathCallback.onReceiveValue(null);
                return true;
            }
            @Override public boolean onCreateWindow(
                WebView webView,
                boolean isDialog,
                boolean isUserGesture,
                android.os.Message resultMsg
            ) { return false; }
            @Override public boolean onConsoleMessage(ConsoleMessage consoleMessage) { return true; }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                return CatalogSnapshotPolicy.shouldBlockNavigation(
                    operation.initialUrl,
                    request.getUrl().toString(),
                    request.isForMainFrame(),
                    request.getMethod()
                );
            }

            @Override public boolean shouldOverrideUrlLoading(WebView ignored, String target) {
                return CatalogSnapshotPolicy.shouldBlockNavigation(operation.initialUrl, target, true, "GET");
            }

            @Override public void onPageStarted(WebView ignored, String target, Bitmap favicon) {
                if (!isCurrent(operation)) return;
                operation.navigationEpoch++;
                operation.stableHtml = null;
                operation.stableCount = 0;
                if (CatalogSnapshotPolicy.shouldBlockNavigation(operation.initialUrl, target, true, "GET")) {
                    reject(operation, "目录页面跳转超出允许范围");
                    return;
                }
                handler.removeCallbacks(operation.poll);
                handler.postDelayed(operation.poll, POLL_INTERVAL_MS);
            }

            @Override public void onReceivedError(
                WebView ignored,
                WebResourceRequest request,
                WebResourceError error
            ) {
                if (request.isForMainFrame()) reject(operation, "目录页面加载失败");
            }

            @SuppressWarnings("deprecation")
            @Override public void onReceivedError(
                WebView ignored,
                int errorCode,
                String description,
                String failingUrl
            ) {
                if (isCurrent(operation) && failingUrl != null && failingUrl.equals(ignored.getUrl())) {
                    reject(operation, "目录页面加载失败");
                }
            }

            @Override public void onReceivedHttpError(
                WebView ignored,
                WebResourceRequest request,
                WebResourceResponse response
            ) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    reject(operation, "目录页面 HTTP " + response.getStatusCode());
                }
            }

            @Override public void onReceivedSslError(
                WebView ignored,
                SslErrorHandler sslHandler,
                SslError error
            ) {
                sslHandler.cancel();
                reject(operation, "目录页面 TLS 校验失败");
            }

            @Override public boolean onRenderProcessGone(WebView ignored, RenderProcessGoneDetail detail) {
                reject(operation, "目录页面渲染进程已退出");
                return true;
            }
        });
    }

    private void attachOffscreen(Operation operation, WebView view) {
        DisplayMetrics metrics = getActivity().getResources().getDisplayMetrics();
        int width = Math.max(metrics.widthPixels, Math.round(360 * metrics.density));
        int height = Math.max(metrics.heightPixels, Math.round(640 * metrics.density));
        FrameLayout host = new FrameLayout(getActivity());
        operation.host = host;
        host.setTranslationX(-width * 2f);
        host.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
        host.addView(view, new FrameLayout.LayoutParams(width, height));
        getActivity().addContentView(host, new ViewGroup.LayoutParams(width, height));
    }

    private void poll(Operation operation, Runnable again) {
        if (!isCurrent(operation)) return;
        final long navigationEpoch = operation.navigationEpoch;
        operation.webView.evaluateJavascript(CatalogSnapshotScript.PROBE, encoded -> {
            if (!isCurrent(operation) || navigationEpoch != operation.navigationEpoch) return;
            try {
                Object decoded = new JSONTokener(encoded).nextValue();
                if (!(decoded instanceof String)) {
                    handler.postDelayed(again, POLL_INTERVAL_MS);
                    return;
                }
                JSONObject snapshot = new JSONObject((String) decoded);
                String resultUrl = snapshot.optString("url", "");
                if (!CatalogSnapshotPolicy.isInitialUrlAllowed(resultUrl)
                    || CatalogSnapshotPolicy.shouldBlockNavigation(operation.initialUrl, resultUrl, true, "GET")) {
                    reject(operation, "目录页面跳转超出允许范围");
                    return;
                }
                if (!snapshot.optBoolean("ready", false)) {
                    handler.postDelayed(again, POLL_INTERVAL_MS);
                    return;
                }
                if (snapshot.optBoolean("tooLarge", false)) {
                    reject(operation, "目录快照超过大小限制");
                    return;
                }
                String html = snapshot.optString("html", "");
                int byteLength = html.getBytes(StandardCharsets.UTF_8).length;
                if (html.isEmpty() || byteLength > operation.maxBytes) {
                    reject(operation, "目录快照为空或超过大小限制");
                    return;
                }
                if (!resultUrl.equals(operation.webView.getUrl())) {
                    handler.postDelayed(again, POLL_INTERVAL_MS);
                    return;
                }
                // Equal lengths/head/tail do not prove a stable list or selection.
                // Exact comparison is bounded by maxBytes and avoids hash collisions.
                if (!html.equals(operation.stableHtml)) {
                    operation.stableHtml = html;
                    operation.stableCount = 1;
                    handler.postDelayed(again, POLL_INTERVAL_MS);
                    return;
                }
                operation.stableCount++;
                if (operation.stableCount < 2) {
                    handler.postDelayed(again, POLL_INTERVAL_MS);
                    return;
                }
                JSObject result = new JSObject();
                result.put("html", html);
                result.put("url", resultUrl);
                resolve(operation, result);
            } catch (Exception ignored) {
                if (isCurrent(operation)) handler.postDelayed(again, POLL_INTERVAL_MS);
            }
        });
    }

    private boolean isCurrent(Operation operation) {
        return active == operation && !operation.settled
            && acceptsSnapshot(operation.epoch, operationEpoch, operation.sessionId, active.sessionId);
    }

    private void resolve(Operation operation, JSObject result) {
        if (!isCurrent(operation)) return;
        PluginCall call = operation.call;
        cleanup(operation);
        call.resolve(result);
    }

    private void reject(Operation operation, String message) {
        if (operation == null || operation.settled) return;
        PluginCall call = operation.call;
        cleanup(operation);
        call.reject(message);
    }

    private void cleanup(Operation operation) {
        if (operation.settled) return;
        operation.settled = true;
        if (active == operation) active = null;
        operationEpoch++;
        if (operation.poll != null) handler.removeCallbacks(operation.poll);
        if (operation.timeout != null) handler.removeCallbacks(operation.timeout);
        WebView view = operation.webView;
        operation.webView = null;
        if (view != null) {
            try { view.stopLoading(); } catch (RuntimeException ignored) {}
            try { view.setWebChromeClient(null); } catch (RuntimeException ignored) {}
            try { view.setWebViewClient(null); } catch (RuntimeException ignored) {}
            try {
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            } catch (RuntimeException ignored) {}
            try { view.destroy(); } catch (RuntimeException ignored) {}
        }
        FrameLayout host = operation.host;
        operation.host = null;
        try {
            if (host != null && host.getParent() instanceof ViewGroup) {
                ((ViewGroup) host.getParent()).removeView(host);
            }
        } catch (RuntimeException ignored) {
            // The Activity may already have detached its content root.
        }
    }

    private void cancelActive(String message) {
        Operation operation = active;
        if (operation != null) reject(operation, message);
    }

    @Override protected void handleOnPause() {
        handler.post(() -> cancelActive("目录快照已暂停"));
        super.handleOnPause();
    }

    @Override protected void handleOnDestroy() {
        handler.post(() -> cancelActive("目录快照已销毁"));
        super.handleOnDestroy();
    }
}
