package com.aizeek.newsnook;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.WebView;
import androidx.webkit.ProcessGlobalConfig;
import java.io.File;

/** Select the WebView directory before providers or Activities can initialize WebView. */
public final class NewsNookApplication extends Application {
    private boolean privateProcess;
    private boolean privateReady;
    private String privateStartupError;

    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        privateProcess = PrivateBrowserSession.isPrivateProcess(base);
        if (!privateProcess) {
            PrivateBrowserSession.sweepInterruptedSession(base);
            return;
        }
        try {
            if (!PrivateBrowserSession.supported(base))
                throw new IllegalStateException(PrivateBrowserSession.unavailableReason(base));
            PrivateBrowserSession.cleanupOwnedDirectories(base);
            if (Build.VERSION.SDK_INT >= 28) {
                WebView.setDataDirectorySuffix(PrivateBrowserSession.DATA_SUFFIX);
            } else {
                ProcessGlobalConfig config = new ProcessGlobalConfig();
                config.setDataDirectorySuffix(base, PrivateBrowserSession.DATA_SUFFIX);
                ProcessGlobalConfig.apply(config);
            }
            privateReady = true;
        } catch (Exception error) {
            privateStartupError = "无法安全建立独立隐私会话，请关闭后重试或更新系统 WebView";
        }
    }

    boolean isPrivateProcess() { return privateProcess; }
    boolean isPrivateReady() { return privateProcess && privateReady; }
    String getPrivateStartupError() { return privateStartupError; }

    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
        return privateProcess ? PrivateBrowserSession.preferences(name) : super.getSharedPreferences(name, mode);
    }
    @Override public boolean deleteSharedPreferences(String name) {
        if (!privateProcess) return super.deleteSharedPreferences(name);
        return PrivateBrowserSession.preferences(name).edit().clear().commit();
    }
    @Override public File getCacheDir() {
        return privateProcess ? PrivateBrowserSession.temporaryDirectory(this, "cache") : super.getCacheDir();
    }
    @Override public File getFilesDir() {
        return privateProcess ? PrivateBrowserSession.temporaryDirectory(this, "files") : super.getFilesDir();
    }
    @Override public File getCodeCacheDir() {
        return privateProcess ? PrivateBrowserSession.temporaryDirectory(this, "code_cache") : super.getCodeCacheDir();
    }
}
