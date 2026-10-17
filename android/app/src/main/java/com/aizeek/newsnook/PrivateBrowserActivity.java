package com.aizeek.newsnook;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.CapConfig;
import com.getcapacitor.CapacitorWebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.WebViewListener;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/** Same bundled browser UI, with a separate process and no ordinary app bootstrap. */
public final class PrivateBrowserActivity extends AppCompatActivity implements BrowserFullscreenHost {
    private final IBinder lifetime = new Binder();
    private final CompletableFuture<JSObject> configuration = new CompletableFuture<>();
    private Bridge bridge;
    private WebView shell;
    private NewsNookWebChromeClient chrome;
    private IBinder owner;
    private boolean privateReady;
    private boolean ending;
    private boolean fullscreen;
    private IBinder.DeathRecipient ownerDeath;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(null); // Never restore private WebView, input, or plugin state.
        setTheme(com.getcapacitor.android.R.style.AppTheme_NoActionBar);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }
        ParcelFileDescriptor pendingInput = null;
        try {
            Bundle extras = getIntent().getExtras();
            owner = extras == null ? null : extras.getBinder(PrivateBrowserSession.EXTRA_OWNER);
            pendingInput = PrivateBrowserSession.registerPeer(owner, lifetime);
            ownerDeath = () -> runOnUiThread(this::finishPrivate);
            owner.linkToDeath(ownerDeath, 0);
            getIntent().replaceExtras((Bundle) null);
            NewsNookApplication application = getApplication() instanceof NewsNookApplication
                ? (NewsNookApplication) getApplication() : null;
            if (application == null || !application.isPrivateReady())
                throw new IllegalStateException(application == null ? "隐私进程不可用" : application.getPrivateStartupError());
            if (pendingInput == null) throw new IllegalStateException("隐私会话配置已失效");
            privateReady = true;
            ParcelFileDescriptor input = pendingInput;
            PrivateBrowserSession.execute(() -> readConfiguration(input));
            pendingInput = null; // Ownership moved to AutoCloseInputStream in the worker.
            createBrowserShell();
        } catch (Exception error) {
            privateReady = false;
            if (pendingInput != null) try { pendingInput.close(); } catch (java.io.IOException ignored) {}
            configuration.completeExceptionally(error);
            showStartupFailure();
        }
    }

    boolean isPrivateReady() { return privateReady && !ending; }

    void browserContext(Consumer<JSObject> success, Consumer<String> failure) {
        configuration.whenComplete((value, error) -> runOnUiThread(() -> {
            if (ending || isDestroyed() || error != null) {
                failure.accept("隐私会话已关闭或配置不可用");
                return;
            }
            try { success.accept(new JSObject(value.toString())); }
            catch (Exception invalid) { failure.accept("隐私会话配置不可用"); }
        }));
    }

    private void readConfiguration(ParcelFileDescriptor descriptor) {
        try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (ending || output.size() + count > PrivateBrowserSession.MAX_CONFIG_BYTES)
                    throw new IllegalStateException("private configuration interrupted");
                output.write(buffer, 0, count);
            }
            JSObject result = new JSObject(output.toString(StandardCharsets.UTF_8.name()));
            configuration.complete(result);
        } catch (Exception error) {
            configuration.completeExceptionally(error);
            runOnUiThread(this::finishPrivate);
        }
    }

    private void showStartupFailure() {
        TextView message = new TextView(this);
        message.setText("无法安全建立隐私会话\n请关闭后重试或更新系统 WebView\n\n点此返回");
        message.setGravity(android.view.Gravity.CENTER);
        message.setTextColor(Color.WHITE);
        message.setBackgroundColor(0xff0e0f12);
        message.setPadding(32, 32, 32, 32);
        message.setOnClickListener(view -> finishPrivate());
        setContentView(message);
    }

    private void createBrowserShell() {
        FrameLayout content = new FrameLayout(this);
        shell = new CapacitorWebView(this, null) {
            @Override public InputConnection onCreateInputConnection(EditorInfo info) {
                InputConnection connection = super.onCreateInputConnection(info);
                if (Build.VERSION.SDK_INT >= 26) info.imeOptions |= EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING;
                return connection;
            }
        };
        shell.setId(com.getcapacitor.android.R.id.webview);
        shell.setSaveEnabled(false);
        shell.setSaveFromParentEnabled(false);
        shell.setBackgroundColor(0xff0e0f12);
        if (Build.VERSION.SDK_INT >= 26)
            shell.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 29)
            shell.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        content.addView(shell, new FrameLayout.LayoutParams(-1, -1));
        setContentView(content);
        CapConfig config = new CapConfig.Builder(this)
            .setStartPath("/#private-browser")
            .setAndroidScheme("https")
            .setAllowMixedContent(true)
            .setWebContentsDebuggingEnabled(false)
            .setLoggingEnabled(false)
            .setResolveServiceWorkerRequests(false)
            .create();
        Bridge.Builder builder = new Bridge.Builder(this).setConfig(config)
            .addPlugin(BrowserHostPlugin.class)
            .addPlugin(com.capacitorjs.plugins.app.AppPlugin.class)
            .addPlugin(com.capacitorjs.plugins.filesystem.FilesystemPlugin.class)
            .addPlugin(PrivateSharePlugin.class)
            .addPlugin(com.getcapacitor.community.media.MediaPlugin.class)
            .addPlugin(DeviceMediaControlsPlugin.class)
            .addPlugin(MediaSnifferPlugin.class)
            .addPlugin(NewsNookNetworkPlugin.class)
            .addWebViewListener(new WebViewListener() {
                @Override public void onPageStarted(WebView view) { injectInsets(); }
                @Override public void onPageCommitVisible(WebView view, String url) {
                    injectInsets();
                    view.evaluateJavascript("window.__newsnookNativeVisible=true;window.dispatchEvent(new Event('newsnook:native-visible'));", null);
                }
                @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    finishPrivate(); // No snapshot or URL restoration across a failed private shell.
                    return true;
                }
            });
        bridge = builder.create();
        bridge.setWebViewClient(new MediaPlaybackWebViewClient(bridge));
        chrome = new NewsNookWebChromeClient(bridge, this);
        shell.setWebChromeClient(chrome);
        shell.addJavascriptInterface(new PrivateChromeBridge(), "NewsNookNative");
        shell.getSettings().setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE);
        shell.getSettings().setSaveFormData(false);
        shell.getSettings().setDatabaseEnabled(false);
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            injectInsets();
            if (fullscreen) setVideoFullscreen(true);
            return ViewCompat.onApplyWindowInsets(view, insets);
        });
    }

    @androidx.annotation.Keep
    public final class PrivateChromeBridge {
        @JavascriptInterface public void setSystemTheme(String theme) {
            runOnUiThread(() -> {
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                controller.setAppearanceLightStatusBars("light".equalsIgnoreCase(theme));
                controller.setAppearanceLightNavigationBars("light".equalsIgnoreCase(theme));
            });
        }
        @JavascriptInterface public void setFullScreen(boolean enabled) { runOnUiThread(() -> setVideoFullscreen(enabled)); }
        @JavascriptInterface public void setEmbeddedVideoFullscreen(boolean enabled) { setFullScreen(enabled); }
        @JavascriptInterface public void setKeepScreenOn(boolean enabled) {
            runOnUiThread(() -> {
                if (enabled) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }

    @Override public void setVideoFullscreen(boolean active) {
        fullscreen = active;
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (active) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
    }

    private void injectInsets() {
        WebView view = shell;
        if (view == null || ending) return;
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
        if (insets == null) return;
        Insets system = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
        float density = getResources().getDisplayMetrics().density;
        String script = String.format(Locale.US,
            "(function(){var s=document.documentElement.style;s.setProperty('--sat-native','%dpx');s.setProperty('--sab-native','%dpx');s.setProperty('--sal-native','%dpx');s.setProperty('--sar-native','%dpx');s.setProperty('--video-sat-native','%dpx');s.setProperty('--video-sab-native','%dpx');s.setProperty('--video-sal-native','%dpx');s.setProperty('--video-sar-native','%dpx');})();",
            Math.round(system.top / density), Math.round(system.bottom / density),
            Math.round(system.left / density), Math.round(system.right / density),
            Math.round(cutout.top / density), Math.round(cutout.bottom / density),
            Math.round(cutout.left / density), Math.round(cutout.right / density));
        view.post(() -> { if (!ending && shell == view) view.evaluateJavascript(script, null); });
    }

    void finishPrivate() {
        if (ending) return;
        ending = true;
        configuration.cancel(true);
        finishAndRemoveTask();
    }

    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
        return PrivateBrowserSession.preferences(name);
    }
    @Override public File getCacheDir() { return PrivateBrowserSession.temporaryDirectory(this, "cache"); }
    @Override public File getFilesDir() { return PrivateBrowserSession.temporaryDirectory(this, "files"); }
    @Override public File getCodeCacheDir() { return PrivateBrowserSession.temporaryDirectory(this, "code_cache"); }
    @Override public void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.clear();
    }
    @Override protected void onStart() { super.onStart(); if (bridge != null) bridge.onStart(); }
    @Override protected void onRestart() { super.onRestart(); if (bridge != null) bridge.onRestart(); }
    @Override protected void onResume() {
        super.onResume();
        if (bridge != null) { bridge.getApp().fireStatusChange(true); bridge.onResume(); }
    }
    @Override protected void onPause() { if (bridge != null) bridge.onPause(); super.onPause(); }
    @Override protected void onStop() {
        if (bridge != null) { bridge.getApp().fireStatusChange(false); bridge.onStop(); }
        super.onStop();
    }
    @Override public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        if (bridge != null) bridge.onConfigurationChanged(config);
        injectInsets();
    }
    // The narrow plugin set uses @ActivityCallback / @PermissionCallback. Capacitor registers
    // those through this AppCompatActivity's ActivityResultRegistry; inherited dispatch handles
    // share/media/filesystem results. Do not call Bridge's legacy Cordova/request-code callbacks.
    @Override public void onDetachedFromWindow() {
        if (bridge != null) bridge.onDetachedFromWindow();
        super.onDetachedFromWindow();
    }
    @Override protected void onDestroy() {
        ending = true;
        configuration.cancel(true);
        if (owner != null && ownerDeath != null) owner.unlinkToDeath(ownerDeath, 0);
        try {
            if (chrome != null) chrome.release();
            if (bridge != null) bridge.onDestroy();
            if (shell != null) {
                if (shell.getParent() instanceof ViewGroup) ((ViewGroup) shell.getParent()).removeView(shell);
                shell.destroy();
            }
        } finally {
            bridge = null;
            shell = null;
            super.onDestroy();
            // The owner observes Binder death and only then removes the isolated data directory.
            if (PrivateBrowserSession.isPrivateProcess(this)) Process.killProcess(Process.myPid());
        }
    }
}
