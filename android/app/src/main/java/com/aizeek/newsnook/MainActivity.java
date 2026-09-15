package com.aizeek.newsnook;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import com.aizeek.newsnook.translation.TranslationPluginRegistrar;

/**
 * NewsNook main Android activity.
 *
 * Notes:
 * - This activity keeps the Capacitor shell edge-to-edge on every supported API level.
 * - Video fullscreen owns the system bars while active; normal app mode stays edge-to-edge.
 * - The splash screen remains until WebView content is committed, avoiding a white flash.
 */
public class MainActivity extends BridgeActivity {
    private static final int FALLBACK_BACKGROUND = 0xFF0E0F12;
    private final Handler systemBarsHandler = new Handler(Looper.getMainLooper());
    private final Handler compositorWakeHandler = new Handler(Looper.getMainLooper());
    private boolean videoFullscreenActive = false;
    private boolean reHideScheduled = false;
    private volatile boolean webContentReady = false;
    private int nativeInsetTop = 0;
    private int nativeInsetBottom = 0;
    private int nativeInsetLeft = 0;
    private int nativeInsetRight = 0;
    private final Runnable reHideSystemBars = () -> {
        if (!videoFullscreenActive || !hasWindowFocus()) return;
        hideSystemBarsSticky();
    };
    private final Runnable softCompositorWake = () -> {
        WebView webView = getCapacitorWebView();
        if (webView != null) wakeWebViewCompositor(webView, false);
    };
    private final Runnable softCompositorWakeWithInsets = () -> {
        WebView webView = getCapacitorWebView();
        if (webView != null) {
            injectNativeInsets();
            wakeWebViewCompositor(webView, false);
        }
    };

    private final class NativeThemeBridge {
        @JavascriptInterface
        public void setBackgroundColor(String rawColor) {
            Integer parsed = parseCssColor(rawColor);
            if (parsed == null) return;
            runOnUiThread(() -> {
                WebView webView = getCapacitorWebView();
                if (webView != null) webView.setBackgroundColor(parsed);
            });
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean keepScreenOn) {
            runOnUiThread(() -> applyKeepScreenOn(keepScreenOn));
        }

        @JavascriptInterface
        public void setVideoFullscreen(boolean fullscreen) {
            runOnUiThread(() -> {
                videoFullscreenActive = fullscreen;
                if (fullscreen) {
                    scheduleFullscreenReassert();
                } else {
                    cancelFullscreenReassert();
                    showSystemBars();
                }
            });
        }
    }

    private WebView getCapacitorWebView() {
        return bridge == null ? null : bridge.getWebView();
    }

    private Integer parseCssColor(String rawColor) {
        if (rawColor == null) return null;
        String color = rawColor.trim();
        if (!color.matches("^#[0-9A-Fa-f]{6}$")) return null;
        try {
            return Color.parseColor(color);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private void updateNativeInsets(WindowInsetsCompat insets) {
        WindowInsetsCompat resolved = insets;
        if (resolved == null) resolved = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
        if (resolved == null) return;
        androidx.core.graphics.Insets bars = resolved.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        nativeInsetTop = bars.top;
        nativeInsetBottom = bars.bottom;
        nativeInsetLeft = bars.left;
        nativeInsetRight = bars.right;
    }

    private void injectNativeInsets() {
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        updateNativeInsets(null);
        String script = String.format(java.util.Locale.ROOT,
            "document.documentElement.style.setProperty('--native-safe-top','%dpx');" +
            "document.documentElement.style.setProperty('--native-safe-bottom','%dpx');" +
            "document.documentElement.style.setProperty('--native-safe-left','%dpx');" +
            "document.documentElement.style.setProperty('--native-safe-right','%dpx');" +
            "window.dispatchEvent(new CustomEvent('newsnook:native-insets',{detail:{top:%d,bottom:%d,left:%d,right:%d}}));",
            nativeInsetTop, nativeInsetBottom, nativeInsetLeft, nativeInsetRight,
            nativeInsetTop, nativeInsetBottom, nativeInsetLeft, nativeInsetRight);
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private void wakeWebViewCompositor(WebView webView, boolean includeSyntheticTouch) {
        if (webView == null) return;
        webView.setVisibility(View.VISIBLE);
        webView.requestLayout();
        webView.invalidate();
        webView.postInvalidateOnAnimation();
        webView.evaluateJavascript("void(document.documentElement && document.documentElement.offsetHeight);", null);
    }

    private void scheduleFullscreenReassert() {
        cancelFullscreenReassert();
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();
        decorView.postOnAnimation(reHideSystemBars);
        systemBarsHandler.postDelayed(reHideSystemBars, 64L);
        systemBarsHandler.postDelayed(reHideSystemBars, 180L);
        systemBarsHandler.postDelayed(reHideSystemBars, 420L);
    }

    private void cancelFullscreenReassert() {
        systemBarsHandler.removeCallbacks(reHideSystemBars);
        Window window = getWindow();
        if (window != null) window.getDecorView().removeCallbacks(reHideSystemBars);
    }

    @androidx.annotation.Keep
    private void hideSystemBarsSticky() {
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(android.view.WindowInsets.Type.systemBars());
                return;
            }
            WindowInsetsControllerCompat compat = WindowCompat.getInsetsController(window, decorView);
            if (compat != null) {
                compat.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                compat.hide(WindowInsetsCompat.Type.systemBars());
            }
            return;
        }
        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN;
        decorView.setSystemUiVisibility(flags);
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
    }

    private void showSystemBars() {
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_DEFAULT);
                controller.show(android.view.WindowInsets.Type.systemBars());
            } else {
                WindowInsetsControllerCompat compat = WindowCompat.getInsetsController(window, decorView);
                if (compat != null) {
                    compat.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
                    compat.show(WindowInsetsCompat.Type.systemBars());
                }
            }
        } else {
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
            decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        }
        ViewCompat.requestApplyInsets(decorView);
    }

    private void scheduleSelfHealHide() {
        if (reHideScheduled) return;
        reHideScheduled = true;
        getWindow().getDecorView().postDelayed(() -> {
            reHideScheduled = false;
            if (videoFullscreenActive) scheduleFullscreenReassert();
        }, 500L);
    }

    private void applyKeepScreenOn(boolean keepScreenOn) {
        Window window = getWindow();
        if (window == null) return;
        if (keepScreenOn) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void configureEdgeToEdgeWindow() {
        Window window = getWindow();
        if (window == null) return;
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            android.view.WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !webContentReady);
        configureEdgeToEdgeWindow();

        TranslationPluginRegistrar.register(this);
        registerPlugin(DeviceMediaControlsPlugin.class);
        registerPlugin(DlnaCastPlugin.class);
        registerPlugin(VolumePageTurnPlugin.class);
        registerPlugin(ProxiedHttpPlugin.class);
        registerPlugin(MediaSnifferPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(SyncNotificationPlugin.class);
        registerPlugin(ZhihuAuthPlugin.class);
        bridgeBuilder.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageStarted(WebView webView) {
                webView.setBackgroundColor(FALLBACK_BACKGROUND);
                webView.addJavascriptInterface(new NativeThemeBridge(), "NewsNookNative");
                injectNativeInsets();
            }

            @Override
            public void onPageCommitVisible(WebView webView, String url) {
                webView.setBackgroundColor(FALLBACK_BACKGROUND);
                webContentReady = true;
                injectNativeInsets();
                webView.postOnAnimation(() -> webView.evaluateJavascript(
                    "window.__newsnookNativeVisible=true;window.dispatchEvent(new Event('newsnook:native-visible'));",
                    null));
            }
        });
        super.onCreate(savedInstanceState);
        configureEdgeToEdgeWindow();

        if (bridge != null) bridge.setWebViewClient(new MediaPlaybackWebViewClient(bridge));

        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            updateNativeInsets(insets);
            if (videoFullscreenActive && (insets.isVisible(WindowInsetsCompat.Type.statusBars()) || insets.isVisible(WindowInsetsCompat.Type.navigationBars()))) {
                scheduleSelfHealHide();
            }
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        updateNativeInsets(null);

        WebView webView = getCapacitorWebView();
        if (webView != null) {
            webView.setBackgroundColor(FALLBACK_BACKGROUND);
            webView.addJavascriptInterface(new NativeThemeBridge(), "NewsNookNative");
            injectNativeInsets();
        }
        getWindow().getDecorView().postDelayed(() -> webContentReady = true, 2500L);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (bridge != null) {
            PluginHandle handle = bridge.getPlugin("VolumePageTurn");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof VolumePageTurnPlugin && ((VolumePageTurnPlugin) plugin).handleKeyEvent(event)) return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onResume() {
        super.onResume();
        if (videoFullscreenActive) scheduleFullscreenReassert();
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        webView.setBackgroundColor(FALLBACK_BACKGROUND);
        webView.resumeTimers();
        injectNativeInsets();
        scheduleCompositorWake(webView);
    }

    @Override
    public void onPause() {
        cancelScheduledCompositorWake();
        super.onPause();
    }

    @Override
    public void onDestroy() {
        cancelScheduledCompositorWake();
        cancelFullscreenReassert();
        videoFullscreenActive = false;
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        if (videoFullscreenActive) scheduleFullscreenReassert();
        WebView webView = getCapacitorWebView();
        if (webView != null) {
            webView.resumeTimers();
            injectNativeInsets();
            wakeWebViewCompositor(webView, true);
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (videoFullscreenActive) {
            configureEdgeToEdgeWindow();
            scheduleFullscreenReassert();
        }
    }

    private void cancelScheduledCompositorWake() {
        compositorWakeHandler.removeCallbacks(softCompositorWakeWithInsets);
        compositorWakeHandler.removeCallbacks(softCompositorWake);
    }

    private void scheduleCompositorWake(WebView webView) {
        cancelScheduledCompositorWake();
        wakeWebViewCompositor(webView, true);
        compositorWakeHandler.postDelayed(softCompositorWakeWithInsets, 60L);
        compositorWakeHandler.postDelayed(softCompositorWake, 180L);
        compositorWakeHandler.postDelayed(softCompositorWake, 500L);
        compositorWakeHandler.postDelayed(softCompositorWake, 1000L);
    }
}
