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
import java.io.IOException;
import java.net.URI;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

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

    private volatile Long activeDownloadId = null;
    private volatile UpdateRequest activeUpdate = null;
    private volatile DeltaCandidate activeDelta = null;
    private final ExecutorService updateIo = Executors.newSingleThreadExecutor();
    private volatile String activeFileName = null;
    private volatile String activeExpectedSha256 = null;
    private volatile Long activeExpectedSize = null;
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
        // Digesting a 30MB+ installed APK, patch reconstruction and signature checks must
        // not block the Capacitor bridge or the Android main thread.
        updateIo.execute(() -> {
            try {
                if (activeDownloadId != null) {
                    JSObject busy = new JSObject();
                    busy.put("downloadId", activeDownloadId);
                    call.resolve(busy);
                    return;
                }
                UpdateRequest request = new UpdateRequest(
                    call.getString("url"),
                    call.getString("fileName"),
                    AppUpdateIntegrity.normalizeSha256(call.getString("sha256")),
                    call.getLong("size"),
                    call.getLong("versionCode")
                );
                DeltaCandidate selected = chooseDelta(call, request);
                activeUpdate = request;
                activeDelta = selected;
                try {
                    long downloadId = selected == null
                        ? enqueueDownload(request.url, request.fileName, request.sha256, request.size)
                        : enqueueDownload(selected.url, selected.fileName, selected.sha256, selected.size);
                    JSObject result = new JSObject();
                    result.put("downloadId", downloadId);
                    call.resolve(result);
                } catch (Exception error) {
                    activeUpdate = null;
                    activeDelta = null;
                    throw error;
                }
            } catch (Exception error) {
                call.reject("无法开始更新: " + error.getMessage());
            }
        });
    }

    private DeltaCandidate chooseDelta(PluginCall call, UpdateRequest request) {
        JSArray candidates = call.getArray("deltas");
        if (candidates == null || candidates.length() == 0 || candidates.length() > 16
            || request.sha256 == null || request.size == null || request.size <= 0
            || request.versionCode == null || request.versionCode <= 0) return null;
        File source = installedSingleApk();
        if (source == null) return null;
        try {
            String installedSha256 = AppUpdateIntegrity.sha256(source);
            for (int index = 0; index < candidates.length(); index++) {
                JSONObject raw = candidates.optJSONObject(index);
                if (raw == null || !"gdiff-gzip-v1".equals(raw.optString("algorithm"))) continue;
                String from = AppUpdateIntegrity.normalizeSha256(raw.optString("fromSha256"));
                String sha256 = AppUpdateIntegrity.normalizeSha256(raw.optString("sha256"));
                String fileName = raw.optString("fileName");
                String url = raw.optString("url");
                long size = raw.optLong("size", -1);
                if (from == null || sha256 == null || !from.equals(installedSha256) || size <= 0) continue;
                if (!fileName.equals("delta-" + from + "-" + request.sha256 + ".gdiff.gz")) continue;
                if (!isAllowedDeltaUrl(url, fileName, request.url)) continue;
                return new DeltaCandidate(source, from, url, fileName, sha256, size);
            }
        } catch (IOException | NoSuchAlgorithmException ignored) {
            // Non-readable base APK or damaged metadata always falls back to the full signed APK.
        }
        return null;
    }

    private File installedSingleApk() {
        android.content.pm.ApplicationInfo info = getContext().getApplicationInfo();
        if (info.splitSourceDirs != null && info.splitSourceDirs.length > 0) return null;
        File source = new File(info.sourceDir);
        return source.isFile() ? source : null;
    }

    private static boolean isAllowedDeltaUrl(String url, String fileName, String fullUrl) {
        try {
            URI uri = URI.create(url);
            URI full = URI.create(fullUrl);
            if (!"https".equals(uri.getScheme()) || !"news-update.aizeek.com".equals(uri.getHost())
                || uri.getPort() != -1 || uri.getRawQuery() != null || uri.getRawFragment() != null
                || uri.getRawUserInfo() != null) return false;
            String base = full.getPath();
            if (!"news-update.aizeek.com".equals(full.getHost())
                || !(base.startsWith("/newsnook/beta/") || base.startsWith("/newsnook/stable/"))) return false;
            String trackPrefix = base.startsWith("/newsnook/beta/") ? "/newsnook/beta/" : "/newsnook/stable/";
            return uri.getPath().equals(trackPrefix + "deltas/" + fileName);
        } catch (Exception ignored) {
            return false;
        }
    }

    private long enqueueDownload(String url, String fileName, String sha256, Long size) throws IOException {
        ensureReceiverRegistered();
        Context context = getContext();
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new IOException("DownloadManager 不可用");
        File destination = destinationFile(fileName);
        if (destination == null || (destination.exists() && !destination.delete())) {
            throw new IOException("无法准备下载目标文件");
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("有所闻 · 正在下载更新");
        request.setDescription(fileName);
        request.setNotificationVisibility(ensureNotifier().canPost()
            ? DownloadManager.Request.VISIBILITY_HIDDEN
            : DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);

        long downloadId = manager.enqueue(request);
        activeFileName = fileName;
        activeExpectedSha256 = sha256;
        activeExpectedSize = size;
        activeDownloadId = downloadId;
        ensureNotifier().start(fileName);
        startProgressPolling();
        return downloadId;
    }

    private static final class UpdateRequest {
        final String url;
        final String fileName;
        final String sha256;
        final Long size;
        final Long versionCode;

        UpdateRequest(String url, String fileName, String sha256, Long size, Long versionCode) {
            this.url = url;
            this.fileName = fileName;
            this.sha256 = sha256;
            this.size = size;
            this.versionCode = versionCode;
        }
    }

    private static final class DeltaCandidate {
        final File source;
        final String fromSha256;
        final String url;
        final String fileName;
        final String sha256;
        final long size;

        DeltaCandidate(File source, String fromSha256, String url, String fileName, String sha256, long size) {
            this.source = source;
            this.fromSha256 = fromSha256;
            this.url = url;
            this.fileName = fileName;
            this.sha256 = sha256;
            this.size = size;
        }
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
            if (activeDelta != null && activeDownloadId != null && activeDownloadId == downloadId) {
                call.reject("差分安装包尚在合成中");
                return;
            }
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
            AppUpdatePackageVerifier.verifyIdentity(
                getContext(), apk, activeUpdate == null ? null : activeUpdate.versionCode
            );
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
        updateIo.shutdown();
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
        updateIo.execute(() -> processDownloadComplete(downloadId));
    }

    private void processDownloadComplete(long downloadId) {
        if (activeDownloadId == null || activeDownloadId != downloadId) return;
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            failOrFallback(downloadId, "DownloadManager 不可用");
            return;
        }

        DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                failOrFallback(downloadId, "找不到下载记录");
                return;
            }
            int statusIndex = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int reasonIndex = cursor.getColumnIndex(DownloadManager.COLUMN_REASON);
            int status = statusIndex >= 0 ? cursor.getInt(statusIndex) : -1;
            if (status != DownloadManager.STATUS_SUCCESSFUL) {
                int reason = reasonIndex >= 0 ? cursor.getInt(reasonIndex) : -1;
                failOrFallback(downloadId, "下载失败 (" + reason + ")");
                return;
            }
            int bytesIndex = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int totalIndex = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            long received = bytesIndex >= 0 ? cursor.getLong(bytesIndex) : -1L;
            long total = totalIndex >= 0 ? cursor.getLong(totalIndex) : -1L;
            if (received >= 0) ensureNotifier().updateBytes(received, total > 0 ? total : received);
        }

        File downloaded = resolveDownloadedFile(downloadId);
        if (downloaded == null || !downloaded.isFile()) {
            failOrFallback(downloadId, "更新文件不存在");
            return;
        }

        AppUpdateIntegrity.VerificationResult verified = AppUpdateIntegrity.verify(
            downloaded, activeExpectedSha256, activeExpectedSize
        );
        if (!verified.valid) {
            //noinspection ResultOfMethodCallIgnored
            downloaded.delete();
            failOrFallback(downloadId, verified.message);
            return;
        }

        File apk = downloaded;
        DeltaCandidate delta = activeDelta;
        if (delta != null) {
            try {
                UpdateRequest target = activeUpdate;
                if (target == null || target.sha256 == null || target.size == null) {
                    throw new IOException("差分目标元数据缺失");
                }
                File output = destinationFile(target.fileName);
                if (output == null) throw new IOException("无法创建差分目标 APK");
                ensureNotifier().assembling();
                apk = AppUpdateDelta.apply(
                    delta.source, downloaded, output, delta.fromSha256, delta.sha256,
                    delta.size, target.sha256, target.size
                );
                AppUpdatePackageVerifier.verify(getContext(), apk, target.versionCode);
            } catch (Exception error) {
                failOrFallback(downloadId, "差分合成失败: " + error.getMessage());
                return;
            } finally {
                // Remove the completed delta DownloadManager record and its system notification.
                removeDownloadRecord(downloadId);
            }
        } else {
            try {
                AppUpdatePackageVerifier.verifyIdentity(
                    getContext(), apk, activeUpdate == null ? null : activeUpdate.versionCode
                );
            } catch (Exception error) {
                emitFailed(downloadId, "install", "安装包校验失败: " + error.getMessage());
                return;
            }
        }

        ensureNotifier().complete("下载完成，正在打开安装界面");
        try {
            installApk(apk);
            JSObject payload = new JSObject();
            payload.put("downloadId", downloadId);
            notifyListeners("downloadComplete", payload);
        } catch (Exception error) {
            emitFailed(downloadId, "install", "安装失败: " + error.getMessage());
        } finally {
            clearActiveIfMatch(downloadId);
        }
    }

    private void failOrFallback(long downloadId, String message) {
        DeltaCandidate delta = activeDelta;
        UpdateRequest target = activeUpdate;
        if (delta == null || target == null) {
            emitFailed(downloadId, "download", message);
            return;
        }
        activeDelta = null; // Full fallback must never recursively retry a patch.
        File stale = destinationFile(delta.fileName);
        if (stale != null && stale.exists()) {
            //noinspection ResultOfMethodCallIgnored
            stale.delete();
        }
        removeDownloadRecord(downloadId);
        try {
            long nextId = enqueueDownload(target.url, target.fileName, target.sha256, target.size);
            JSObject payload = new JSObject();
            payload.put("fromDownloadId", downloadId);
            payload.put("toDownloadId", nextId);
            notifyListeners("downloadRedirected", payload);
        } catch (Exception error) {
            emitFailed(downloadId, "download", message + "；全量回退失败: " + error.getMessage());
        }
    }

    private void removeDownloadRecord(long downloadId) {
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager != null) manager.remove(downloadId);
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
            activeUpdate = null;
            activeDelta = null;
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
