package com.aizeek.newsnook;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.view.ViewTreeObserver;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
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
import java.util.Locale;

public class MainActivity extends BridgeActivity implements BrowserFullscreenHost {

    private static final String STARTUP_TRACE = "NewsNookStartup";
    private static void traceStartup(String stage) {
        if (!BuildConfig.DEBUG && !BuildConfig.STARTUP_BENCHMARK) return;
        Log.i(STARTUP_TRACE, stage + " elapsed=" + SystemClock.elapsedRealtime() + "ms");
    }

    /** Splash recovery must never stand in for a committed document. */
    private boolean webContentReady;
    private boolean splashMayExit;
    /** React has committed the initial surface; native drawing is still pending. */
    private boolean webUiFirstFrameReady;
    private boolean fullyDrawnReported;
    /** OS timing belongs to the content draw; the external ready marker follows it. */
    private boolean startupOsReportSent;
    private boolean startupResumed;
    private long startupDrawGeneration;
    private boolean startupDrawPending;
    private boolean startupDrawPosted;
    private ViewTreeObserver startupDrawObserver;
    private ViewTreeObserver.OnDrawListener startupDrawListener;

    private final Runnable releaseLaunchSplash = () -> {
        if (!MainActivity.this.mainWebViewRetired) splashMayExit = true;
    };

    private boolean isCurrentStartupDraw(WebView webView, long generation) {
        return generation == startupDrawGeneration && startupResumed && !fullyDrawnReported
            && webView == getCapacitorWebView();
    }

    private boolean isStartupWebViewVisible(WebView webView) {
        return webView.isAttachedToWindow() && webView.isShown()
            && webView.getWindowVisibility() == View.VISIBLE
            && webView.getWidth() > 0 && webView.getHeight() > 0;
    }

    private void maybeRequestFirstUiDraw() {
        if (fullyDrawnReported || startupDrawPending || !startupResumed
                || !webContentReady || !webUiFirstFrameReady) return;
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        startupDrawPending = true;
        long generation = startupDrawGeneration;
        try {
            webView.postVisualStateCallback(generation, new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    if (!isCurrentStartupDraw(webView, generation)) return;
                    traceStartup("first-ui-visual-state-ready");
                    startupDrawObserver = webView.getViewTreeObserver();
                    startupDrawListener = () -> {
                        if (startupDrawPosted || !isCurrentStartupDraw(webView, generation)
                                || !isStartupWebViewVisible(webView)) return;
                        if (!startupOsReportSent) {
                            try {
                                // AndroidX measures the completion of the frame containing
                                // this signal. Posting it after OnDraw can select a later
                                // user-input frame on an otherwise static page.
                                reportFullyDrawn();
                                startupOsReportSent = true;
                                traceStartup("first-ui-report-in-draw");
                            } catch (RuntimeException error) {
                                Log.w(STARTUP_TRACE, "Could not report the initial WebView draw", error);
                                return;
                            }
                        }
                        startupDrawPosted = true;
                        // Readiness stays after drawing. A pause, navigation or renderer
                        // retirement still invalidates this posted confirmation.
                        mainWebViewHandler.post(() -> completeFirstUiDraw(webView, generation));
                    };
                    startupDrawObserver.addOnDrawListener(startupDrawListener);
                    webView.invalidate();
                }
            });
        } catch (RuntimeException error) {
            startupDrawPending = false;
            Log.w(STARTUP_TRACE, "Could not request the initial WebView visual state", error);
        }
    }

    private void completeFirstUiDraw(WebView webView, long generation) {
        if (!isCurrentStartupDraw(webView, generation)) return;
        startupDrawPosted = false;
        if (!isStartupWebViewVisible(webView)) return;
        removeStartupDrawListener();
        startupDrawPending = false;
        fullyDrawnReported = true;
        traceStartup("fully-drawn-real-ui");
        setStartupBenchmarkMarker("newsnook-first-frame-ready");
    }

    private void setStartupBenchmarkMarker(String value) {
        if (!BuildConfig.STARTUP_BENCHMARK) return;
        // An active WebView accessibility provider replaces the host node and can
        // omit its ID/description. The native content root stays observable.
        View content = findViewById(android.R.id.content);
        if (content != null) content.setContentDescription(value);
    }

    private void removeStartupDrawListener() {
        if (startupDrawListener != null) {
            ViewTreeObserver observer = startupDrawObserver;
            // An unattached view's observer is merged into the window on attach.
            if ((observer == null || !observer.isAlive()) && mainWebView != null) {
                observer = mainWebView.getViewTreeObserver();
            }
            if (observer != null && observer.isAlive()) observer.removeOnDrawListener(startupDrawListener);
        }
        startupDrawObserver = null;
        startupDrawListener = null;
    }

    private void cancelFirstUiDraw() {
        startupDrawGeneration++;
        startupDrawPending = false;
        startupDrawPosted = false;
        removeStartupDrawListener();
    }

    // The pre-navigation JS interface and origin-checked console fallback share
    // one gate. Neither transport is evidence of a native WebView draw by itself.
    void notifyFirstUiPaintFromConsole() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnUiThread(this::notifyFirstUiPaintFromConsole);
            return;
        }
        if (getCapacitorWebView() == null) return;
        webUiFirstFrameReady = true;
        maybeRequestFirstUiDraw();
    }

    /** Main WebView hosts embedded videos (Linux.do, RSS); keep Capacitor chrome features intact. */
    private NewsNookWebChromeClient mainWebChromeClient;
    private WebView mainWebView;
    private boolean mainWebViewRetired;
    private boolean rendererRecoveryScheduled;
    private final Handler mainWebViewHandler = new Handler(Looper.getMainLooper());
    /** Restore the user's previous rotation policy after CSS fullscreen fallback. */
    private int previousEmbeddedOrientation = android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private boolean embeddedFullscreenFallback;
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

    private final WebViewListener mainWebViewListener = new WebViewListener() {
        @Override
        public void onPageStarted(WebView webView) {
            if (!bindMainWebView(webView)) return;
            cancelFirstUiDraw();
            webContentReady = false;
            webUiFirstFrameReady = false;
            setStartupBenchmarkMarker(null);
            traceStartup("webview-page-started");
            // Apply the native background before the first document frame.
            webView.setBackgroundColor(0xFF0E0F12);
            injectNativeInsets();
        }

        @Override
        public void onPageCommitVisible(WebView webView, String url) {
            if (!bindMainWebView(webView)) return;
            webView.setBackgroundColor(0xFF0E0F12);
            webContentReady = true;
            splashMayExit = true;
            traceStartup("webview-page-commit-visible");
            maybeRequestFirstUiDraw();
            injectNativeInsets();
            webView.postOnAnimation(notifyMainWebViewVisible);
        }

        @Override
        public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
            return recoverMainRenderer(webView);
        }
    };

    private final Runnable notifyMainWebViewVisible = () -> {
        WebView webView = getCapacitorWebView();
        if (webView == null) return;
        webView.evaluateJavascript(
            "window.__newsnookNativeVisible=true;" +
            "window.dispatchEvent(new Event('newsnook:native-visible'));",
            null
        );
    };

    @androidx.annotation.Keep
    public class NativeThemeBridge {
        @JavascriptInterface
        public void notifyFirstUiPaint() {
            runOnUiThread(MainActivity.this::notifyFirstUiPaintFromConsole);
        }

        @JavascriptInterface
        public void reportStartupStage(String stage, double webTimeMs) {
            if (!BuildConfig.DEBUG && !BuildConfig.STARTUP_BENCHMARK) return;
            if (stage == null || stage.length() > 64) return;
            Log.i(STARTUP_TRACE, "js:" + stage + " web=" + webTimeMs + "ms elapsed=" + SystemClock.elapsedRealtime() + "ms");
        }

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
        public void setEmbeddedVideoFullscreen(boolean enabled) {
            runOnUiThread(() -> applyEmbeddedVideoFullscreen(enabled));
        }

        @JavascriptInterface
        public void setKeepScreenOn(boolean keepScreenOn) {
            runOnUiThread(() -> applyKeepScreenOn(keepScreenOn));
        }
    }

    @androidx.annotation.Keep
    private void applySystemTheme(boolean isLight) {
        if (mainWebViewRetired) return;
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

    private void applyEmbeddedVideoFullscreen(boolean enabled) {
        if (mainWebViewRetired) return;
        if (embeddedFullscreenFallback == enabled) return;
        embeddedFullscreenFallback = enabled;
        if (enabled) {
            previousEmbeddedOrientation = getRequestedOrientation();
            setVideoFullscreen(true);
            setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else {
            setRequestedOrientation(previousEmbeddedOrientation);
            setVideoFullscreen(false);
        }
    }

    /** Package-visible entry point used by DeviceMediaControlsPlugin. */
    @Override public void setVideoFullscreen(boolean fullScreen) {
        if (mainWebViewRetired) return;
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
        if (mainWebViewRetired) return;
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
        if (mainWebViewRetired || reHideScheduled) return;
        reHideScheduled = true;
        getWindow().getDecorView().postDelayed(() -> {
            reHideScheduled = false;
            if (mainWebViewRetired || !videoFullscreenActive) return;
            scheduleFullscreenReassert();
        }, 500L);
    }

    private void applyKeepScreenOn(boolean keepScreenOn) {
        if (mainWebViewRetired) return;
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
    protected void load() {
        traceStartup("bridge-load-begin");
        // The layout exists, but Bridge.create() has not called loadUrl() yet.
        // Installing the interface here makes it available to the first document.
        WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (bindMainWebView(webView)) {
            webView.setBackgroundColor(0xFF0E0F12);
            webView.addJavascriptInterface(new NativeThemeBridge(), "NewsNookNative");
        }
        // BridgeActivity has now added generated plugins. Register this override
        // last so the upstream Network plugin cannot replace its safe lifecycle.
        registerPlugin(NewsNookNetworkPlugin.class);
        super.load();
        traceStartup("bridge-load-completed");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        traceStartup("activity-onCreate-begin");
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !splashMayExit);

        configureEdgeToEdgeWindow();

        TranslationPluginRegistrar.register(this);
        registerPlugin(DeviceMediaControlsPlugin.class);
        registerPlugin(ReadAloudPlugin.class);
        registerPlugin(DlnaCastPlugin.class);
        registerPlugin(VolumePageTurnPlugin.class);
        registerPlugin(ProxiedHttpPlugin.class);
        registerPlugin(EncyclopediaPagePlugin.class);
        registerPlugin(BrowserHostPlugin.class);
        registerPlugin(MediaSnifferPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(ZhihuSessionPlugin.class);
        registerPlugin(LinuxDoSessionPlugin.class);
        registerPlugin(SyncNotificationPlugin.class);
        registerPlugin(CatalogSnapshotPlugin.class);
        bridgeBuilder.addWebViewListener(mainWebViewListener);
        traceStartup("plugins-registered");
        super.onCreate(savedInstanceState);
        traceStartup("bridge-onCreate-completed");

        // BridgeActivity switches to Capacitor's no-action-bar theme and installs
        // its content view in super.onCreate(); reassert our window contract after it.
        configureEdgeToEdgeWindow();

        // 外部媒体仍由 WebView 播放；仅已登记的媒体会话走流式请求上下文桥接。
        if (bridge != null) {
            bridge.setWebViewClient(new MediaPlaybackWebViewClient(bridge));
            // Capacitor's default BridgeWebChromeClient immediately declines
            // onShowCustomView. Its replacement must STILL extend that class so
            // file pickers, Web permissions, alerts and prompts remain functional.
            WebView mainWebView = bridge.getWebView();
            if (bindMainWebView(mainWebView)) {
                mainWebChromeClient = new NewsNookWebChromeClient(bridge, this);
                mainWebView.setWebChromeClient(mainWebChromeClient);
            }
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
            injectNativeInsets();
        }

        // 极端情况下 commit 回调没来：超时只撤系统开屏，不伪造页面完成。
        getWindow().getDecorView().postDelayed(releaseLaunchSplash, 2500L);
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
        startupResumed = true;
        maybeRequestFirstUiDraw();

        if (videoFullscreenActive) {
            scheduleFullscreenReassert();
        }

        WebView webView = getCapacitorWebView();
        if (webView == null) return;

        webView.setBackgroundColor(0xFF0E0F12);
        webView.resumeTimers();
        injectNativeInsets();
        // Synthetic touch/resize retries are only needed for restoring an already
        // painted WebView. On a cold launch they run on an empty document and can
        // compete with the first layout/Chromium compositor initialization.
        if (webUiFirstFrameReady) scheduleCompositorWake(webView);
    }

    @Override
    public void onPause() {
        startupResumed = false;
        cancelFirstUiDraw();
        cancelScheduledCompositorWake();
        super.onPause();
    }

    @Override
    public void onDestroy() {
        retireMainWebViewWork();
        releaseMainWebChromeClient();
        super.onDestroy();
    }

    @Override
    public void onDetachedFromWindow() {
        // BridgeActivity destroys its WebView here. Reject queued native work first.
        retireMainWebViewWork();
        super.onDetachedFromWindow();
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
            if (webUiFirstFrameReady) wakeWebViewCompositor(webView, true);
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
        if (mainWebViewRetired) return;
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

        mainWebViewHandler.post(() -> {
            if (webView == getCapacitorWebView()) webView.evaluateJavascript(js, null);
        });
    }

    private boolean bindMainWebView(WebView webView) {
        if (webView == null || mainWebViewRetired || isFinishing() || isDestroyed()) return false;
        if (mainWebView == null) mainWebView = webView;
        return mainWebView == webView;
    }

    private WebView getCapacitorWebView() {
        return mainWebViewRetired || isFinishing() || isDestroyed() ? null : mainWebView;
    }

    private void retireMainWebViewWork() {
        mainWebViewRetired = true;
        cancelFirstUiDraw();
        Window window = getWindow();
        if (window != null) window.getDecorView().removeCallbacks(releaseLaunchSplash);
        mainWebViewHandler.removeCallbacksAndMessages(null);
        cancelScheduledCompositorWake();
        cancelFullscreenReassert();
        videoFullscreenActive = false;
        reHideScheduled = false;
        if (mainWebView != null) mainWebView.removeCallbacks(notifyMainWebViewVisible);
        mainWebView = null;
    }

    private void releaseMainWebChromeClient() {
        NewsNookWebChromeClient client = mainWebChromeClient;
        mainWebChromeClient = null;
        if (client == null) return;
        try {
            client.release();
        } catch (RuntimeException error) {
            Log.w("NewsNookMainWebView", "Could not release the retired fullscreen view", error);
        }
    }

    private boolean recoverMainRenderer(WebView webView) {
        if (rendererRecoveryScheduled) return true;
        if (mainWebView != null && mainWebView != webView) return false;
        rendererRecoveryScheduled = true;
        retireMainWebViewWork();
        splashMayExit = true;

        // The old Bridge cannot be reused with a different WebView. In particular,
        // BridgeActivity.onDetachedFromWindow must not destroy this instance again.
        Bridge retiredBridge = bridge;
        if (retiredBridge != null) {
            try {
                PluginHandle browserHandle = retiredBridge.getPlugin("NewsNookBrowser");
                if (browserHandle != null && browserHandle.getInstance() instanceof BrowserHostPlugin browserHost) {
                    browserHost.captureRecoverySession();
                }
            } catch (RuntimeException error) {
                Log.w("NewsNookMainWebView", "Could not preserve browser tabs before recovery", error);
            }
        }
        bridge = null;
        releaseMainWebChromeClient();
        try {
            if (retiredBridge != null && !isDestroyed()) retiredBridge.onDestroy();
        } catch (RuntimeException error) {
            Log.w("NewsNookMainWebView", "Could not fully release the retired Bridge", error);
        } finally {
            ViewParent parent = webView.getParent();
            if (parent instanceof ViewGroup) ((ViewGroup) parent).removeView(webView);
            webView.destroy();
        }

        // Recreate the complete Capacitor shell after this callback has returned.
        // No cache, cookies, WebStorage or preferences are cleared.
        mainWebViewHandler.post(() -> {
            if (!isFinishing() && !isDestroyed()) recreate();
        });
        Log.w("NewsNookMainWebView", "Main renderer exited; recreating the Activity");
        return true;
    }

    private void wakeWebViewCompositor(WebView webView, boolean syntheticTouch) {
        if (webView != getCapacitorWebView() || !webView.isAttachedToWindow()) return;

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
