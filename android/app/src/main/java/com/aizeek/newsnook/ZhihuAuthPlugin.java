package com.aizeek.newsnook;

import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SafeBrowsingResponse;
import android.webkit.WebResourceRequest;
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

import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Hosts the official Zhihu sign-in flow and returns the resulting first-party
 * cookies to the JS layer. The WebView does not inject credentials or automate
 * login/captcha flows; those remain entirely owned by Zhihu.
 */
@CapacitorPlugin(name = "ZhihuAuth")
public class ZhihuAuthPlugin extends Plugin {
    private static final String DEFAULT_SIGNIN = "https://www.zhihu.com/signin";
    private static final int APP_BACKGROUND = Color.rgb(14, 15, 18);
    private static final int APP_SURFACE = Color.rgb(24, 25, 30);
    private static final int APP_TEXT = Color.rgb(240, 241, 244);
    private static final int APP_MUTED = Color.rgb(167, 171, 181);
    private static final int APP_ACCENT = Color.rgb(74, 144, 226);

    @PluginMethod
    public void login(PluginCall call) {
        String requested = call.getString("url", DEFAULT_SIGNIN);
        Uri start = safeOwnedUri(requested);
        if (start == null) {
            call.reject("仅允许打开知乎 HTTPS 登录页面");
            return;
        }

        getActivity().runOnUiThread(() -> showLoginDialog(call, start.toString()));
    }

    private void showLoginDialog(PluginCall call, String startUrl) {
        AtomicBoolean settled = new AtomicBoolean(false);
        Dialog dialog = new Dialog(getActivity());
        dialog.getWindow();

        LinearLayout root = new LinearLayout(getActivity());
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(APP_BACKGROUND);

        LinearLayout toolbar = new LinearLayout(getActivity());
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(8), dp(8), dp(8), dp(8));
        toolbar.setBackgroundColor(APP_SURFACE);

        TextView close = toolbarButton("关闭", APP_MUTED);
        TextView title = new TextView(getActivity());
        title.setText("登录知乎");
        title.setTextColor(APP_TEXT);
        title.setTextSize(17f);
        title.setGravity(Gravity.CENTER);
        title.setSingleLine(true);
        TextView done = toolbarButton("完成", APP_ACCENT);

        toolbar.addView(close, new LinearLayout.LayoutParams(dp(72), dp(44)));
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, dp(44), 1f);
        toolbar.addView(title, titleParams);
        toolbar.addView(done, new LinearLayout.LayoutParams(dp(72), dp(44)));

        WebView webView = new WebView(getActivity());
        configureWebView(webView);
        root.addView(toolbar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)));
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        dialog.setContentView(root);

        dialog.setOnShowListener(ignored -> {
            if (dialog.getWindow() != null) {
                dialog.getWindow().setBackgroundDrawable(new ColorDrawable(APP_BACKGROUND));
                dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            }
        });
        dialog.setOnDismissListener(ignored -> {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            if (settled.compareAndSet(false, true)) call.reject("已取消知乎登录");
        });

        close.setOnClickListener(v -> dialog.dismiss());
        done.setOnClickListener(v -> {
            String current = webView.getUrl() == null ? startUrl : webView.getUrl();
            String cookie = mergedCookieHeader(current);
            if (!hasCookie(cookie, "d_c0") || !hasCookie(cookie, "z_c0")) {
                title.setText("请先完成知乎登录");
                return;
            }
            CookieManager.getInstance().flush();
            JSObject result = new JSObject();
            result.put("cookie", cookie);
            result.put("userAgent", webView.getSettings().getUserAgentString());
            result.put("url", current);
            if (settled.compareAndSet(false, true)) call.resolve(result);
            dialog.dismiss();
        });

        dialog.show();
        webView.loadUrl(startUrl);
    }

    private void configureWebView(WebView webView) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.WHITE);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isOwnedNavigation(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri uri = Uri.parse(url);
                if (isOwnedNavigation(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType, SafeBrowsingResponse callback) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) callback.backToSafety(true);
            }
        });
    }

    private TextView toolbarButton(String label, int color) {
        TextView button = new TextView(getActivity());
        button.setText(label);
        button.setTextColor(color);
        button.setTextSize(15f);
        button.setGravity(Gravity.CENTER);
        button.setClickable(true);
        button.setFocusable(true);
        return button;
    }

    private int dp(int value) {
        float density = getActivity().getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    private Uri safeOwnedUri(String raw) {
        try {
            Uri uri = Uri.parse(raw == null ? DEFAULT_SIGNIN : raw);
            return isOwnedNavigation(uri) ? uri : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean isOwnedNavigation(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        return host.equals("zhihu.com") || host.endsWith(".zhihu.com");
    }

    private void openExternal(Uri uri) {
        if (uri == null || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))) return;
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            // No external browser is available. Keep the login dialog open.
        }
    }

    private String mergedCookieHeader(String currentUrl) {
        CookieManager manager = CookieManager.getInstance();
        String www = manager.getCookie("https://www.zhihu.com/");
        String current = manager.getCookie(currentUrl == null ? "https://www.zhihu.com/" : currentUrl);
        if (www == null || www.trim().isEmpty()) return current == null ? "" : current;
        if (current == null || current.trim().isEmpty() || www.equals(current)) return www;
        return www + "; " + current;
    }

    private boolean hasCookie(String cookieHeader, String key) {
        if (cookieHeader == null || cookieHeader.isEmpty()) return false;
        String needle = key + "=";
        for (String part : cookieHeader.split(";")) {
            if (part.trim().startsWith(needle) && part.trim().length() > needle.length()) return true;
        }
        return false;
    }
}
