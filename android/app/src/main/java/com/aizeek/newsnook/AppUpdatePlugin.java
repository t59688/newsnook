package com.aizeek.newsnook;

import android.Manifest;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.net.URI;

/**
 * 从受信任更新源下载 APK（系统 DownloadManager + 自管通知栏进度），校验后调起安装。
 * 自管通知可用时隐藏系统通知，否则保留系统下载通知兜底。
 */
@CapacitorPlugin(
    name = "AppUpdate",
    permissions = {
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class AppUpdatePlugin extends Plugin {

    private static final long PROGRESS_POLL_MS = 500L;

    private Long activeDownloadId = null;
    private String activeFileName = null;
    private String activeExpectedSha256 = null;
    private Long activeExpectedSize = null;
    private BroadcastReceiver downloadReceiver = null;
    private AppUpdateDownloadNotifier notifier = null;
    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressTick = new Runnable() {
        @Override
        public void run() {
            if (activeDownloadId == null) return;
            pollActiveProgress(activeDownloadId);
            progressHandler.postDelayed(this, PROGRESS_POLL_MS);
        }
    };

    @PluginMethod
    public void getSupportedAbis(PluginCall call) {
        JSObject result = new JSObject();
        result.put("abis", new JSArray(java.util.Arrays.asList(Build.SUPPORTED_ABIS)));
        call.resolve(result);
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            result.put("value", getContext().getPackageManager().canRequestPackageInstalls());
        } else {
            result.put("value", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Context context = getContext();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + context.getPackageName())
            );
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        String rawSha256 = call.getString("sha256");
        Long expectedSize = call.getLong("size");
        String expectedSha256 = rawSha256 == null ? null : AppUpdateIntegrity.normalizeSha256(rawSha256);
        if (url == null || url.isEmpty() || fileName == null || fileName.isEmpty()) {
            call.reject("缺少 url 或 fileName");
            return;
        }
        if (!isAllowedDownloadUrl(url)) {
            call.reject("不允许的下载地址");
            return;
        }
        if (fileName.contains("..") || fileName.contains("/") || fileName.contains("\\")) {
            call.reject("非法 fileName");
            return;
        }
        if (rawSha256 != null && expectedSha256 == null) {
            call.reject("非法 sha256");
            return;
        }
        if (expectedSize != null && expectedSize <= 0) {
            call.reject("非法 size");
            return;
        }

        if (activeDownloadId != null && isDownloadInProgress(activeDownloadId)) {
            JSObject result = new JSObject();
            result.put("downloadId", activeDownloadId);
            call.resolve(result);
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "downloadPermissionsCallback");
            return;
        }

        beginDownload(call);
    }

    @PermissionCallback
    private void downloadPermissionsCallback(PluginCall call) {
        // 拒绝通知权限不能阻止更新；beginDownload 会保留系统通知。
        beginDownload(call);
    }

    private void beginDownload(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName");
        String rawSha256 = call.getString("sha256");
        String expectedSha256 = rawSha256 == null ? null : AppUpdateIntegrity.normalizeSha256(rawSha256);
        Long expectedSize = call.getLong("size");

        // 权限弹窗期间可能已有另一调用启动下载。
        if (activeDownloadId != null && isDownloadInProgress(activeDownloadId)) {
            JSObject result = new JSObject();
            result.put("downloadId", activeDownloadId);
            call.resolve(result);
            return;
        }

        ensureReceiverRegistered();

        Context context = getContext();
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("DownloadManager 不可用");
            return;
        }

        // 覆盖同名残留，避免解析到旧包
        File destination = destinationFile(fileName);
        if (destination != null && destination.exists()) {
            //noinspection ResultOfMethodCallIgnored
            destination.delete();
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("有所闻 · 正在下载更新");
        request.setDescription(fileName);
        // 只有自管通知能显示时才隐藏系统通知，避免下载失去进度入口。
        request.setNotificationVisibility(ensureNotifier().canPost()
            ? DownloadManager.Request.VISIBILITY_HIDDEN
            : DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);

        long downloadId = manager.enqueue(request);
        activeDownloadId = downloadId;
        activeFileName = fileName;
        activeExpectedSha256 = expectedSha256;
        activeExpectedSize = expectedSize;
        ensureNotifier().start(fileName);
        startProgressPolling();

        JSObject result = new JSObject();
        result.put("downloadId", downloadId);
        call.resolve(result);
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null) {
            call.reject("缺少 downloadId");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("DownloadManager 不可用");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                JSObject result = new JSObject();
                result.put("status", "unknown");
                call.resolve(result);
                return;
            }

            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int statusCode = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;

            JSObject result = new JSObject();
            result.put("status", mapStatus(statusCode));
            File apk = resolveDownloadedFile(downloadId);
            if (apk != null) {
                result.put("localUri", Uri.fromFile(apk).toString());
            }
            call.resolve(result);
        }
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        Long downloadId = call.getLong("downloadId");
        if (downloadId == null) {
            call.reject("缺少 downloadId");
            return;
        }
        try {
            File apk = resolveDownloadedFile(downloadId);
            if (apk == null || !apk.exists()) {
                call.reject("安装包不存在");
                return;
            }
            AppUpdateIntegrity.VerificationResult verification = AppUpdateIntegrity.verify(
                apk,
                activeExpectedSha256,
                activeExpectedSize
            );
            if (!verification.valid) {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                clearActiveIfMatch(downloadId);
                call.reject(verification.message);
                return;
            }
            installApk(apk);
            clearActiveIfMatch(downloadId);
            call.resolve();
        } catch (Exception error) {
            call.reject("安装失败: " + error.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopProgressPolling();
        unregisterReceiverQuietly();
        super.handleOnDestroy();
    }

    private static String mapStatus(int statusCode) {
        switch (statusCode) {
            case DownloadManager.STATUS_PENDING:
                return "pending";
            case DownloadManager.STATUS_RUNNING:
            case DownloadManager.STATUS_PAUSED:
                return "running";
            case DownloadManager.STATUS_SUCCESSFUL:
                return "successful";
            case DownloadManager.STATUS_FAILED:
                return "failed";
            default:
                return "unknown";
        }
    }

    private boolean isDownloadInProgress(long downloadId) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return false;
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            if (statusIndex < 0) return false;
            int status = cursor.getInt(statusIndex);
            return status == DownloadManager.STATUS_PENDING
                || status == DownloadManager.STATUS_RUNNING
                || status == DownloadManager.STATUS_PAUSED;
        }
    }

    private static boolean isAllowedDownloadUrl(String url) {
        try {
            URI uri = URI.create(url);
            String scheme = uri.getScheme();
            if (scheme == null || !scheme.equalsIgnoreCase("https")) return false;
            String host = uri.getHost();
            if (host == null) return false;
            String lower = host.toLowerCase();
            return lower.equals("news-update.aizeek.com")
                || lower.equals("github.com")
                || lower.endsWith(".github.com")
                || lower.equals("objects.githubusercontent.com")
                || lower.endsWith(".githubusercontent.com");
        } catch (Exception ignored) {
            return false;
        }
    }

    private void ensureReceiverRegistered() {
        if (downloadReceiver != null) return;
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (activeDownloadId == null || completedId != activeDownloadId) return;
                handleDownloadComplete(completedId);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // 系统 DownloadManager 完成广播需 EXPORTED 才能收到
            getContext().registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            getContext().registerReceiver(downloadReceiver, filter);
        }
    }

    private void handleDownloadComplete(long downloadId) {
        stopProgressPolling();
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            emitFailed(downloadId, "download", "DownloadManager 不可用");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                emitFailed(downloadId, "download", "找不到下载记录");
                return;
            }
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
                emitFailed(downloadId, "download", "下载失败 (" + reason + ")");
                return;
            }
            int bytesIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int totalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            long received = bytesIndex >= 0 ? cursor.getLong(bytesIndex) : -1L;
            long total = totalIndex >= 0 ? cursor.getLong(totalIndex) : -1L;
            if (received >= 0L) {
                ensureNotifier().updateBytes(received, total > 0L ? total : received);
            }
        }

        File apk = resolveDownloadedFile(downloadId);
        if (apk == null || !apk.exists()) {
            emitFailed(downloadId, "download", "安装包不存在");
            return;
        }

        AppUpdateIntegrity.VerificationResult verification = AppUpdateIntegrity.verify(
            apk,
            activeExpectedSha256,
            activeExpectedSize
        );
        if (!verification.valid) {
            //noinspection ResultOfMethodCallIgnored
            apk.delete();
            emitFailed(downloadId, "download", verification.message);
            return;
        }

        ensureNotifier().complete("下载完成，正在打开安装界面");
        try {
            installApk(apk);
            JSObject payload = new JSObject();
            payload.put("downloadId", downloadId);
            notifyListeners("downloadComplete", payload);
        } catch (Exception error) {
            emitFailed(
                downloadId,
                "install",
                error.getMessage() != null ? ("安装失败: " + error.getMessage()) : "安装失败"
            );
        } finally {
            clearActiveIfMatch(downloadId);
        }
    }

    private void emitFailed(long downloadId, String kind, String message) {
        stopProgressPolling();
        String text = message != null ? message : "下载失败";
        ensureNotifier().fail(text);
        clearActiveIfMatch(downloadId);
        JSObject payload = new JSObject();
        payload.put("downloadId", downloadId);
        payload.put("kind", kind);
        payload.put("message", text);
        notifyListeners("downloadFailed", payload);
    }

    private void clearActiveIfMatch(long downloadId) {
        if (activeDownloadId != null && activeDownloadId == downloadId) {
            activeDownloadId = null;
            activeFileName = null;
            activeExpectedSha256 = null;
            activeExpectedSize = null;
        }
    }

    private AppUpdateDownloadNotifier ensureNotifier() {
        if (notifier == null) {
            notifier = new AppUpdateDownloadNotifier(getContext());
        }
        return notifier;
    }

    private void startProgressPolling() {
        progressHandler.removeCallbacks(progressTick);
        progressHandler.post(progressTick);
    }

    private void stopProgressPolling() {
        progressHandler.removeCallbacks(progressTick);
    }

    private void pollActiveProgress(long downloadId) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return;
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
                // 完成广播会接手；此处只停轮询，避免与 complete/fail 抢通知文案
                stopProgressPolling();
                return;
            }
            int bytesIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int totalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            long received = bytesIndex >= 0 ? cursor.getLong(bytesIndex) : 0L;
            long total = totalIndex >= 0 ? cursor.getLong(totalIndex) : -1L;
            ensureNotifier().updateBytes(received, total);
        }
    }

    /** 与 setDestinationInExternalFilesDir(..., DIRECTORY_DOWNLOADS, fileName) 对齐 */
    private File destinationFile(String fileName) {
        if (fileName == null || fileName.isEmpty()) return null;
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) return null;
        return new File(dir, fileName);
    }

    private File resolveDownloadedFile(long downloadId) {
        if (activeFileName != null) {
            File byName = destinationFile(activeFileName);
            if (byName != null && byName.exists()) return byName;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return null;
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            int localUriIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
            if (localUriIndex < 0) return null;
            String localUri = cursor.getString(localUriIndex);
            if (localUri == null || localUri.isEmpty()) return null;
            Uri uri = Uri.parse(localUri);
            if ("file".equalsIgnoreCase(uri.getScheme()) && uri.getPath() != null) {
                File file = new File(uri.getPath());
                if (file.exists()) return file;
            }
        }
        return null;
    }

    private void installApk(File apk) {
        Context context = getContext();
        Uri contentUri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private void unregisterReceiverQuietly() {
        if (downloadReceiver == null) return;
        try {
            getContext().unregisterReceiver(downloadReceiver);
        } catch (Exception ignored) {
            // already unregistered
        }
        downloadReceiver = null;
    }
}
