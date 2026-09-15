package com.aizeek.newsnook;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewParent;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    /** 系统开屏一直挂到 WebView 提交首帧，避免撤出后露出默认白底 WebView */
    private volatile boolean webContentReady = false;
    /** 视频全屏态：系统栏必须持续隐藏。旋转 / 重新获焦后隐藏状态可能被系统复位，需要主动补隐藏 */
    private volatile boolean videoFullscreenActive = false;
    /** 自愈重排标志：同一窗口期内只排一次补隐藏，避免叠加（仅主线程读写） */
    private boolean reHideScheduled = false;
    private int nativeStatusBarDp = 0;
    private int nativeNavBarDp = 0;
    private int nativeLeftInsetDp = 0;
    private int nativeRightInsetDp = 0;
    /** 全屏播放器只避让真实屏幕切口，不继承已隐藏的状态栏/导航栏尺寸。 */
    private int nativeVideoTopInsetDp = 0;
    private int nativeVideoBottomInsetDp = 0;
    private int nativeVideoLeftInsetDp = 0;
    private int nativeVideoRightInsetDp = 0;

    private final Handler systemBarsHandler = new Handler(Looper.getMainLooper());
    private final Runnable reHideSystemBars = () -> {
        if (videoFullscreenActive) {
            hideSystemBarsSticky();
        }
    };

    private final Handler compositorWakeHandler = new Handler(Looper.getMainLooper());

    /** Delayed soft wakes only: invalidate + JS, no synthetic touch (avoids aborting real gestures). */
    private final Runnable softCompositorWakeWithInsets = () -> {
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        injectNativeInsets();
        wakeWebViewCompositor(webView, false);
    };

    private final Runnable softCompositorWake = () -> {
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        wakeWebViewCompositor(webView, false);
    };

    @androidx.annotation.Keep
    public class NativeThemeBridge {
        @androidx.annotation.Keep
        @JavascriptInterface
        public void setSystemTheme(String theme) {
            runOnUiThread(() -> applySystemTheme("light".equalsIgnoreCase(theme)));
        }

        @androidx.annotation.Keep
        @JavascriptInterface
        public void setFullScreen(boolean fullScreen) {
            runOnUiThread(() -> applyFullScreen(fullScreen));
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean keepScreenOn) {
            runOnUiThread(() -> applyKeepScreenOn(keepScreenOn));
        }
    }

    @androidx.annotation.Keep
    private void applySystemTheme(boolean isLight) {
        Window window = getWindow();
        if (window == null) return;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(isLight);
            controller.setAppearanceLightNavigationBars(isLight);
        }
    }

    @androidx.annotation.Keep
    private void applyFullScreen(boolean fullScreen) {
        setVideoFullscreen(fullScreen);
    }

    /** Package-visible entry point used by DeviceMediaControlsPlugin. */
    void setVideoFullscreen(boolean fullScreen) {
        videoFullscreenActive = fullScreen;
        if (fullScreen) {
            hideSystemBarsSticky();
            scheduleFullscreenReassert();
            return;
        }

        cancelFullscreenReassert();
        showSystemBars();
    }


    private void scheduleFullscreenReassert() {
        cancelFullscreenReassert();
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();

        // Rotation and OEM window relayouts can make bars visible one or two frames
        // after the initial hide. Reassert across that short transition window.
        decorView.postOnAnimation(reHideSystemBars);
        systemBarsHandler.postDelayed(reHideSystemBars, 64L);
        systemBarsHandler.postDelayed(reHideSystemBars, 180L);
        systemBarsHandler.postDelayed(reHideSystemBars, 420L);
    }

    private void cancelFullscreenReassert() {
        systemBarsHandler.removeCallbacks(reHideSystemBars);
        Window window = getWindow();
        if (window != null) {
            window.getDecorView().removeCallbacks(reHideSystemBars);
        }
    }

    @androidx.annotation.Keep
    private void hideSystemBarsSticky() {
        Window window = getWindow();
        if (window == null) return;
        View decorView = window.getDecorView();

        // BridgeActivity changes the theme/content view during super.onCreate().
        // Reassert edge-to-edge whenever immersive mode is applied.
        WindowCompat.setDecorFitsSystemWindows(window, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.view.WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
                controller.hide(android.view.WindowInsets.Type.systemBars());
                return;
            }

            // Extremely defensive fallback for OEM windows that temporarily expose
            // no framework controller during a configuration transition.
            WindowInsetsControllerCompat compat = WindowCompat.getInsetsController(window, decorView);
            if (compat != null) {
                compat.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
                compat.hide(WindowInsetsCompat.Type.systemBars());
            }
            return;
        }

        // API 24-29: use the platform's legacy immersive-sticky contract directly.
        // This is what WindowInsetsControllerCompat ultimately maps to on these APIs,
        // but setting the complete flag set at once avoids OEM partial-state resets.
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
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            );
        }

        ViewCompat.requestApplyInsets(decorView);
    }

    /**
     * 自愈：视频全屏期间若系统栏被任何因素重新显示（旧版 systemUiVisibility 写入、
     * OEM 旋转 / 焦点复位等），延迟后重藏。延迟是为了不与「swipe 临时唤回」的
     * 系统自动隐藏互相打架；窗口失焦时不干预。
     */
    private void scheduleSelfHealHide() {
        if (reHideScheduled) return;
        reHideScheduled = true;
        getWindow().getDecorView().postDelayed(() -> {
            reHideScheduled = false;
            if (!videoFullscreenActive) return;
            scheduleFullscreenReassert();
        }, 500L);
    }

    private void applyKeepScreenOn(boolean keepScreenOn) {
        Window window = getWindow();
        if (window == null) return;
        if (keepScreenOn) {
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
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
            lp.layoutInDisplayCutoutMode =
                android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
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
        bridgeBuilder.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageStarted(WebView webView) {
                    // 越早越好：WebView 默认底是白的，主题色还没画出来前先压住
                    webView.setBackgroundColor(0xFF0E0F12);
                    webView.addJavascriptInterface(new NativeThemeBridge(), "NewsNookNative");
                    injectNativeInsets();
                }

                @Override
                public void onPageCommitVisible(WebView webView, String url) {
                    webView.setBackgroundColor(0xFF0E0F12);
                    webContentReady = true;
                    injectNativeInsets();
                    webView.postOnAnimation(
                        () ->
                            webView.evaluateJavascript(
                                "window.__newsnookNativeVisible=true;" +
                                "window.dispatchEvent(new Event('newsnook:native-visible'));",
                                null
                            )
                    );
                }
            }
        );
        super.onCreate(savedInstanceState);

        // BridgeActivity switches to Capacitor's no-action-bar theme and installs
        // its content view in super.onCreate(); reassert our window contract after it.
        configureEdgeToEdgeWindow();

        // 外部媒体仍由 WebView 播放；仅已登记的媒体会话走流式请求上下文桥接。
        if (bridge != null) {
            bridge.setWebViewClient(new MediaPlaybackWebViewClient(bridge));
        }

        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            updateNativeInsets(insets);
            if (
                videoFullscreenActive
                    && (insets.isVisible(WindowInsetsCompat.Type.statusBars())
                        || insets.isVisible(WindowInsetsCompat.Type.navigationBars()))
            ) {
                scheduleSelfHealHide();
            }
            return ViewCompat.onApplyWindowInsets(v, insets);
        });
        updateNativeInsets(null);

        WebView webView = getCapacitorWebView();
        if (webView != null) {
            webView.setBackgroundColor(0xFF0E0F12);
            webView.addJavascriptInterface(new NativeThemeBridge(), "NewsNookNative");
            injectNativeInsets();
        }

        // 极端情况下 commit 回调没来：超时也撤系统开屏，避免卡死
        getWindow().getDecorView().postDelayed(() -> webContentReady = true, 2500L);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (bridge != null) {
            PluginHandle handle = bridge.getPlugin("VolumePageTurn");
            if (handle != null) {
                Plugin plugin = handle.getInstance();
                if (plugin instanceof VolumePageTurnPlugin) {
                    if (((VolumePageTurnPlugin) plugin).handleKeyEvent(event)) {
                        return true;
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onResume() {
        super.onResume();

        if (videoFullscreenActive) {
            scheduleFullscreenReassert();
        }

        WebView webView = getCapacitorWebView();
        if (webView == null) return;

        webView.setBackgroundColor(0xFF0E0F12);
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

        // 重新获焦时若仍处视频全屏，系统栏隐藏状态可能已被复位，补一次隐藏
        if (videoFullscreenActive) {
            scheduleFullscreenReassert();
        }

        // onResume may run before the WebView's surface is visible again. One immediate
        // synthetic touch here; delayed soft kicks from scheduleCompositorWake cover lag.
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
        // manifest 已声明 orientation 等 configChanges，Activity 不重建；
        // 但部分机型旋转后 insets controller 的隐藏状态会丢，视频全屏期间必须补隐藏
        if (videoFullscreenActive) {
            configureEdgeToEdgeWindow();
            scheduleFullscreenReassert();
        }
    }

    private void cancelScheduledCompositorWake() {
        compositorWakeHandler.removeCallbacks(softCompositorWakeWithInsets);
        compositorWakeHandler.removeCallbacks(softCompositorWake);
    }

    /**
     * Immediate kick uses synthetic touch; staggered soft kicks only invalidate/JS so a
     * delayed CANCEL cannot abort pull-to-refresh or swipe after the user starts interacting.
     */
    private void scheduleCompositorWake(WebView webView) {
        cancelScheduledCompositorWake();
        wakeWebViewCompositor(webView, true);
        compositorWakeHandler.postDelayed(softCompositorWakeWithInsets, 60L);
        compositorWakeHandler.postDelayed(softCompositorWake, 180L);
        compositorWakeHandler.postDelayed(softCompositorWake, 500L);
        compositorWakeHandler.postDelayed(softCompositorWake, 1000L);
    }

    private void updateNativeInsets(WindowInsetsCompat windowInsets) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1.0f;

        int statusBarPx = 0;
        int navBarPx = 0;
        int leftInsetPx = 0;
        int rightInsetPx = 0;
        int cutoutTopPx = 0;
        int cutoutBottomPx = 0;
        int cutoutLeftPx = 0;
        int cutoutRightPx = 0;

        if (windowInsets != null) {
            Insets statusInsets = windowInsets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets navInsets = windowInsets.getInsets(WindowInsetsCompat.Type.navigationBars());
            Insets cutoutInsets = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());

            cutoutTopPx = cutoutInsets.top;
            cutoutBottomPx = cutoutInsets.bottom;
            cutoutLeftPx = cutoutInsets.left;
            cutoutRightPx = cutoutInsets.right;

            statusBarPx = Math.max(statusInsets.top, cutoutTopPx);
            navBarPx = Math.max(navInsets.bottom, cutoutBottomPx);
            leftInsetPx = Math.max(Math.max(statusInsets.left, navInsets.left), cutoutLeftPx);
            rightInsetPx = Math.max(Math.max(statusInsets.right, navInsets.right), cutoutRightPx);
        }

        // 只在尚未收到任何 WindowInsets 的启动阶段使用资源兜底。
        // 全屏后 statusBars() 正确返回 0 时绝不能再把 status_bar_height 填回来，
        // 否则 Web 端 --sat 会永久保留一条“幽灵通知栏”的高度。
        if (windowInsets == null && statusBarPx <= 0) {
            int resourceId = getResources().getIdentifier("status_bar_height", "dimen", "android");
            if (resourceId > 0) {
                statusBarPx = getResources().getDimensionPixelSize(resourceId);
            }
        }

        nativeStatusBarDp = (int) Math.ceil(Math.max(0, statusBarPx) / density);
        nativeNavBarDp = (int) Math.ceil(Math.max(0, navBarPx) / density);
        nativeLeftInsetDp = (int) Math.ceil(Math.max(0, leftInsetPx) / density);
        nativeRightInsetDp = (int) Math.ceil(Math.max(0, rightInsetPx) / density);

        // 沉浸式播放器绘制在系统栏区域内，只需要避让不可覆盖的物理切口。
        nativeVideoTopInsetDp = (int) Math.ceil(Math.max(0, cutoutTopPx) / density);
        nativeVideoBottomInsetDp = (int) Math.ceil(Math.max(0, cutoutBottomPx) / density);
        nativeVideoLeftInsetDp = (int) Math.ceil(Math.max(0, cutoutLeftPx) / density);
        nativeVideoRightInsetDp = (int) Math.ceil(Math.max(0, cutoutRightPx) / density);

        injectNativeInsets();
    }

    private void injectNativeInsets() {
        WebView webView = getCapacitorWebView();
        if (webView == null) return;

        final String js = String.format(
            Locale.US,
            "(function() {" +
            "  var r = document.documentElement;" +
            "  if (r) {" +
            "    r.style.setProperty('--sat-native', '%dpx');" +
            "    r.style.setProperty('--sab-native', '%dpx');" +
            "    r.style.setProperty('--sal-native', '%dpx');" +
            "    r.style.setProperty('--sar-native', '%dpx');" +
            "    r.style.setProperty('--video-sat-native', '%dpx');" +
            "    r.style.setProperty('--video-sab-native', '%dpx');" +
            "    r.style.setProperty('--video-sal-native', '%dpx');" +
            "    r.style.setProperty('--video-sar-native', '%dpx');" +
            "  }" +
            "})();",
            nativeStatusBarDp,
            nativeNavBarDp,
            nativeLeftInsetDp,
            nativeRightInsetDp,
            nativeVideoTopInsetDp,
            nativeVideoBottomInsetDp,
            nativeVideoLeftInsetDp,
            nativeVideoRightInsetDp
        );

        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private WebView getCapacitorWebView() {
        return bridge == null ? null : bridge.getWebView();
    }

    private static void wakeWebViewCompositor(WebView webView, boolean syntheticTouch) {
        if (!webView.isAttachedToWindow()) return;

        webView.resumeTimers();
        webView.requestLayout();
        webView.postInvalidateOnAnimation();

        ViewParent parent = webView.getParent();
        if (parent instanceof View) {
            ((View) parent).postInvalidateOnAnimation();
        }

        // Only on the immediate resume/focus path. Delayed CANCEL would abort real gestures.
        if (syntheticTouch) {
            dispatchSyntheticTouchCancel(webView);
        }

        // Attribute + reflow + resize: wake JS layout listeners without translateZ layers.
        webView.evaluateJavascript(
            "(function() {" +
            "  var root = document.documentElement;" +
            "  if (!root) return;" +
            "  root.setAttribute('data-wake', String(Date.now()));" +
            "  void root.offsetHeight;" +
            "  window.dispatchEvent(new Event('resize'));" +
            "})();",
            null
        );
    }

    private static void dispatchSyntheticTouchCancel(WebView webView) {
        MotionEvent down = null;
        MotionEvent cancel = null;
        try {
            long now = SystemClock.uptimeMillis();
            float x = 1f;
            float y = 1f;
            down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
            cancel = MotionEvent.obtain(now, now + 1, MotionEvent.ACTION_CANCEL, x, y, 0);
            webView.dispatchTouchEvent(down);
            webView.dispatchTouchEvent(cancel);
        } catch (Throwable ignored) {
            // Window may already be detached between schedule and run.
        } finally {
            if (down != null) down.recycle();
            if (cancel != null) cancel.recycle();
        }
    }
}
