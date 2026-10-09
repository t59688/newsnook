package com.aizeek.newsnook;

import android.app.Dialog;
import android.graphics.Color;
import android.net.Uri;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.json.JSONObject;

/**
 * 知乎独立账号认证桥。
 *
 * 这里只承载必须由第一方页面完成的登录/注册/验证码/风控流程；NewsNook 的推荐、
 * 问答、评论、编辑器等业务 UI 仍全部由 React 实现。认证成功的判定也不依赖页面
 * DOM，而是从当前第一方会话请求 /api/v4/me，只有拿到合法身份才把会话交回 JS。
 *
 * Cookie 只在运行时通过 Capacitor 返回给 JS，随后由现有 SecureStorePlugin 的
 * AndroidKeyStore AES-GCM 边界持久化。插件本身不写 localStorage/SharedPreferences。
 */
@CapacitorPlugin(name = "ZhihuSession")
public class ZhihuSessionPlugin extends Plugin {

    private static final String SIGN_IN_URL = "https://www.zhihu.com/signin?next=%2F";
    private static final String ME_URL = "https://www.zhihu.com/api/v4/me";
    private static final String WWW_ORIGIN = "https://www.zhihu.com";
    private static final String API_ORIGIN = "https://api.zhihu.com";

    private Dialog authDialog;
    private WebView authWebView;
    private volatile PluginCall pendingCall;
    private final AtomicBoolean probing = new AtomicBoolean(false);
    private final OkHttpClient identityClient = new OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build();
    private volatile boolean finishing;
    private volatile boolean closeRequested;

    @PluginMethod
    public void authenticate(PluginCall call) {
        if (pendingCall != null || authDialog != null) {
            call.reject("ZH_AUTH_BUSY", "已有知乎认证窗口正在进行");
            return;
        }

        String initialUrl = call.getString("url", SIGN_IN_URL);
        if (!isAllowedAuthUrl(initialUrl)) {
            call.reject("ZH_AUTH_URL_BLOCKED", "认证地址不属于知乎第一方 HTTPS 域名");
            return;
        }

        String wwwCookie = call.getString("wwwCookie");
        String apiCookie = call.getString("apiCookie");
        pendingCall = call;
        finishing = false;
        closeRequested = false;

        getActivity().runOnUiThread(() -> openAuthDialog(initialUrl, wwwCookie, apiCookie));
    }

    @PluginMethod
    public void clearBrowserSession(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                CookieManager cookieManager = CookieManager.getInstance();
                clearZhihuCookies(cookieManager);
                cookieManager.flush();
                call.resolve();
            } catch (Exception error) {
                call.reject("ZH_AUTH_COOKIE_CLEAR_FAILED", "清理知乎浏览器会话失败");
            }
        });
    }

    private void openAuthDialog(String initialUrl, String wwwCookie, String apiCookie) {
        if (pendingCall == null || getActivity().isFinishing()) {
            rejectPending("ZH_AUTH_UNAVAILABLE", "当前 Activity 无法打开知乎认证页");
            return;
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        // CookieManager 属于应用 WebView 进程全局。必须先清理“知乎域自身”的旧账号
        // Cookie，再恢复目标账号；不能使用 removeAllCookies()，否则会破坏 NewsNook
        // 其它站点/媒体登录态。
        clearZhihuCookies(cookieManager);
        restoreCookieHeader(cookieManager, WWW_ORIGIN, wwwCookie);
        restoreCookieHeader(cookieManager, API_ORIGIN, apiCookie);
        cookieManager.flush();

        Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
        LinearLayout root = new LinearLayout(getActivity());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });

        // 认证页只把知乎第一方页面放进 WebView；关闭、标题和系统栏全部由 NewsNook
        // 原生壳负责。这样不会再把一个“完成”浮层压在网页上，也不会因为网页布局变化
        // 造成点击区域错位。登录成功仍由 /api/v4/me 自动确认并自动返回。
        FrameLayout chrome = new FrameLayout(getActivity());
        chrome.setBackgroundColor(Color.rgb(248, 250, 249));
        LinearLayout.LayoutParams chromeParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(56)
        );
        root.addView(chrome, chromeParams);

        TextView title = new TextView(getActivity());
        title.setText("登录知乎");
        title.setTextSize(16f);
        title.setTextColor(Color.rgb(28, 38, 35));
        title.setGravity(Gravity.CENTER);
        title.setPadding(dp(56), 0, dp(56), 0);
        chrome.addView(title, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        TextView close = new TextView(getActivity());
        close.setText("×");
        close.setTextSize(25f);
        close.setTextColor(Color.rgb(72, 88, 83));
        close.setGravity(Gravity.CENTER);
        GradientDrawable closeBackground = new GradientDrawable();
        closeBackground.setColor(Color.rgb(235, 240, 238));
        closeBackground.setShape(GradientDrawable.OVAL);
        close.setBackground(closeBackground);
        FrameLayout.LayoutParams closeParams = new FrameLayout.LayoutParams(
            dp(38),
            dp(38),
            Gravity.CENTER_VERTICAL | Gravity.START
        );
        closeParams.leftMargin = dp(12);
        chrome.addView(close, closeParams);

        View divider = new View(getActivity());
        divider.setBackgroundColor(Color.rgb(226, 231, 229));
        FrameLayout.LayoutParams dividerParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(1),
            Gravity.BOTTOM
        );
        chrome.addView(divider, dividerParams);

        WebView webView = new WebView(getActivity());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // 知乎登录链包含跨子域认证与风控资源；与参考实现保持一致，仅对这个受控
        // 登录 WebView 允许第三方 Cookie，业务 WebView/普通站点不受影响。
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            0,
            1f
        );
        root.addView(webView, webParams);

        webView.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    String target = uri != null ? uri.toString() : "";
                    if (isAllowedAuthUrl(target)) return false;
                    Toast.makeText(getActivity(), "已阻止跳出知乎第一方认证域名", Toast.LENGTH_SHORT).show();
                    return true;
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (isAllowedAuthUrl(url)) probeAuthenticatedIdentity(false);
                }
            }
        );

        close.setOnClickListener(v -> requestAuthenticationClose());
        dialog.setOnKeyListener((ignored, keyCode, event) -> {
            if (keyCode != KeyEvent.KEYCODE_BACK || event.getAction() != KeyEvent.ACTION_UP) return false;
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                requestAuthenticationClose();
            }
            return true;
        });
        dialog.setOnCancelListener(ignored -> requestAuthenticationClose());
        dialog.setOnDismissListener(ignored -> {
            if (!finishing && pendingCall != null) {
                cancelAuthenticationNow();
            }
            destroyAuthWebView();
            authDialog = null;
        });
        dialog.setContentView(root);
        Window window = dialog.getWindow();
        if (window != null) {
            // 主 Activity 是 edge-to-edge；认证 Dialog 自己负责系统栏，避免网页内容/控制按钮
            // 再延伸到打孔区。外部 chrome 从状态栏下方开始，触摸区域稳定。
            WindowCompat.setDecorFitsSystemWindows(window, false);
            window.setStatusBarColor(Color.rgb(248, 250, 249));
            window.setNavigationBarColor(Color.WHITE);
            WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
            insetsController.setAppearanceLightStatusBars(true);
            insetsController.setAppearanceLightNavigationBars(true);
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }

        authDialog = dialog;
        authWebView = webView;
        dialog.show();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }
        ViewCompat.requestApplyInsets(root);
        webView.loadUrl(initialUrl);
    }

    /**
     * 认证完成只以第一方 /api/v4/me 为准，避免依赖登录页 DOM/文案。
     *
     * 不能用 evaluateJavascript(async () => ...) 判断登录：WebView 的 evaluateJavascript
     * 回调不会等待 Promise resolve，实际拿到的是 Promise 对象而不是 /api/v4/me 正文。
     * 这里直接读取 WebView Cookie，再用原生 OkHttp 校验同一会话；因此用户登录完成后
     * 自动返回，或点击“完成”时都能可靠收口当前账号。
     */
    private void probeAuthenticatedIdentity(boolean finalAttempt) {
        if (pendingCall == null || finishing) return;
        if (finalAttempt) closeRequested = true;

        CookieManager cookieManager = CookieManager.getInstance();
        String wwwCookie = nullToEmpty(cookieManager.getCookie(WWW_ORIGIN));
        String apiCookie = nullToEmpty(cookieManager.getCookie(API_ORIGIN));
        // /api/v4/me 位于 www.zhihu.com：同名 Cookie 冲突时以 www 域当前值为准。
        String checkedCookieHeader = mergeCookieHeaders(apiCookie, wwwCookie);
        if (checkedCookieHeader.isEmpty()) {
            if (finalAttempt) cancelAuthenticationNow();
            return;
        }
        if (!probing.compareAndSet(false, true)) return;

        String userAgent = authWebView != null
            ? nullToEmpty(authWebView.getSettings().getUserAgentString())
            : "";
        Request.Builder request = new Request.Builder()
            .url(ME_URL)
            .get()
            .header("Accept", "application/json")
            .header("Referer", WWW_ORIGIN + "/")
            .header("Cookie", checkedCookieHeader);
        if (!userAgent.isEmpty()) request.header("User-Agent", userAgent);

        identityClient.newCall(request.build()).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException error) {
                probing.set(false);
                finishFailedProbe(checkedCookieHeader, finalAttempt);
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response closeable = response) {
                    ResponseBody body = closeable.body();
                    String text = body != null ? body.string() : "";
                    if (!closeable.isSuccessful() || text.isEmpty()) {
                        probing.set(false);
                        finishFailedProbe(checkedCookieHeader, finalAttempt);
                        return;
                    }
                    JSONObject profile = new JSONObject(text);
                    String id = firstNonBlank(
                        profile.optString("id", ""),
                        profile.optString("url_token", "")
                    );
                    if (id == null) {
                        probing.set(false);
                        finishFailedProbe(checkedCookieHeader, finalAttempt);
                        return;
                    }

                    JSObject result = new JSObject();
                    result.put("accountId", id);
                    result.put("name", profile.optString("name", ""));
                    result.put("urlToken", profile.optString("url_token", ""));
                    result.put("avatarUrl", profile.optString("avatar_url", ""));
                    result.put("headline", profile.optString("headline", ""));
                    result.put("wwwCookie", wwwCookie);
                    result.put("apiCookie", apiCookie);
                    result.put("userAgent", userAgent);
                    result.put("profileJson", profile.toString());
                    probing.set(false);
                    finishSuccess(result);
                } catch (Exception ignored) {
                    probing.set(false);
                    finishFailedProbe(checkedCookieHeader, finalAttempt);
                }
            }
        });
    }

    /**
     * 如果用户点关闭时恰好有旧页面的校验请求在飞行，旧请求可能拿的是登录前
     * Cookie。失败后重新比较 Cookie；只有 Cookie 未变化时才真正取消，否则用最新
     * 会话再校验一次，避免“已经登录却被当成取消”。
     */
    private void finishFailedProbe(String checkedCookieHeader, boolean finalAttempt) {
        if ((!finalAttempt && !closeRequested) || pendingCall == null || finishing) return;
        getActivity().runOnUiThread(() -> {
            if (pendingCall == null || finishing) return;
            CookieManager manager = CookieManager.getInstance();
            String latest = mergeCookieHeaders(
                nullToEmpty(manager.getCookie(API_ORIGIN)),
                nullToEmpty(manager.getCookie(WWW_ORIGIN))
            );
            if (!latest.isEmpty() && !latest.equals(checkedCookieHeader)) {
                probeAuthenticatedIdentity(true);
            } else {
                cancelAuthenticationNow();
            }
        });
    }

    private void requestAuthenticationClose() {
        if (finishing || pendingCall == null) return;
        closeRequested = true;
        if (probing.get()) return;
        probeAuthenticatedIdentity(true);
    }

    private void finishSuccess(JSObject result) {
        if (finishing || pendingCall == null) return;
        finishing = true;
        PluginCall call = pendingCall;
        pendingCall = null;
        call.resolve(result);
        getActivity().runOnUiThread(() -> {
            if (authDialog != null && authDialog.isShowing()) authDialog.dismiss();
        });
    }

    private void cancelAuthenticationNow() {
        if (finishing) return;
        finishing = true;
        closeRequested = false;
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call != null) call.reject("ZH_AUTH_CANCELLED", "未检测到已登录的知乎账号");
        if (authDialog != null && authDialog.isShowing()) authDialog.dismiss();
    }

    private void rejectPending(String code, String message) {
        PluginCall call = pendingCall;
        pendingCall = null;
        finishing = true;
        if (call != null) call.reject(code, message);
    }

    private void destroyAuthWebView() {
        WebView webView = authWebView;
        authWebView = null;
        if (webView == null) return;
        webView.stopLoading();
        webView.setWebViewClient(null);
        webView.loadUrl("about:blank");
        webView.removeAllViews();
        webView.destroy();
    }

    static boolean isAllowedAuthUrl(String raw) {
        if (raw == null || raw.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(raw);
            if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
            String host = uri.getHost();
            if (host == null) return false;
            host = host.toLowerCase(Locale.ROOT);
            return host.equals("zhihu.com") || host.endsWith(".zhihu.com");
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void restoreCookieHeader(CookieManager manager, String origin, String header) {
        if (header == null || header.trim().isEmpty()) return;
        String[] pairs = header.split(";");
        for (String raw : pairs) {
            String pair = raw.trim();
            int separator = pair.indexOf('=');
            if (separator <= 0) continue;
            manager.setCookie(origin, pair + "; Path=/; Secure");
        }
    }

    private static void clearZhihuCookies(CookieManager manager) {
        clearCookiesForOrigin(manager, WWW_ORIGIN);
        clearCookiesForOrigin(manager, API_ORIGIN);
    }

    private static void clearCookiesForOrigin(CookieManager manager, String origin) {
        String header = manager.getCookie(origin);
        if (header == null || header.trim().isEmpty()) return;
        String[] pairs = header.split(";");
        for (String raw : pairs) {
            String pair = raw.trim();
            int separator = pair.indexOf('=');
            if (separator <= 0) continue;
            String name = pair.substring(0, separator).trim();
            if (name.isEmpty()) continue;
            String expired = name + "=; Max-Age=0; Path=/; Secure";
            manager.setCookie(origin, expired);
            // 同时覆盖 Domain=.zhihu.com 的共享 Cookie；host-only Cookie 由上一行清除。
            manager.setCookie(origin, expired + "; Domain=.zhihu.com");
        }
    }

    private static String mergeCookieHeaders(String... headers) {
        Map<String, String> cookies = new LinkedHashMap<>();
        for (String header : headers) {
            if (header == null || header.trim().isEmpty()) continue;
            for (String raw : header.split(";")) {
                String pair = raw.trim();
                int separator = pair.indexOf('=');
                if (separator <= 0) continue;
                String name = pair.substring(0, separator).trim();
                String value = pair.substring(separator + 1).trim();
                if (!name.isEmpty()) cookies.put(name, value);
            }
        }
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> entry : cookies.entrySet()) {
            if (result.length() > 0) result.append("; ");
            result.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return result.toString();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.trim().isEmpty()) return first.trim();
        if (second != null && !second.trim().isEmpty()) return second.trim();
        return null;
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private int dp(int value) {
        return Math.round(value * getContext().getResources().getDisplayMetrics().density);
    }

    @Override
    protected void handleOnDestroy() {
        identityClient.dispatcher().cancelAll();
        if (pendingCall != null) {
            pendingCall.reject("ZH_AUTH_DESTROYED", "知乎认证页已被系统关闭");
            pendingCall = null;
        }
        if (authDialog != null && authDialog.isShowing()) authDialog.dismiss();
        destroyAuthWebView();
        authDialog = null;
        super.handleOnDestroy();
    }
}
