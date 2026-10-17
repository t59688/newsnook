package com.aizeek.newsnook;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcel;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.os.RemoteException;
import android.system.Os;
import android.system.OsConstants;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A disposable System WebView process, not an in-memory Chromium profile.
 * WebView may write inside its private directory during the session. Delete it only
 * after that process dies, and sweep an interrupted session before the next launch.
 */
final class PrivateBrowserSession {
    static final String PROCESS_SUFFIX = ":browser_private";
    static final String DATA_SUFFIX = "newsnook_private_v1";
    static final String TEMP_DIRECTORY = "browser-private";
    static final String EXTRA_OWNER = "com.aizeek.newsnook.private.OWNER";
    static final String DESCRIPTOR = "com.aizeek.newsnook.private.Lifecycle";
    static final int REGISTER_PEER = IBinder.FIRST_CALL_TRANSACTION;
    static final int MAX_CONFIG_BYTES = 56 * 1024 * 1024;
    private static final Object SESSION_LOCK = new Object();
    private static final Map<String, MemoryPreferences> preferences = new ConcurrentHashMap<>();
    private static final ExecutorService IO = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "NewsNookPrivateSession");
        thread.setDaemon(true);
        return thread;
    });
    private static boolean launching;
    private static IBinder sessionPeer;
    private static Binder sessionOwner;

    private PrivateBrowserSession() {}

    static MemoryPreferences preferences(String name) {
        return preferences.computeIfAbsent(name, ignored -> new MemoryPreferences());
    }

    static void execute(Runnable action) { IO.execute(action); }

    static boolean isPrivateProcess(Context context) {
        String expected = context.getPackageName() + PROCESS_SUFFIX;
        if (Build.VERSION.SDK_INT >= 28) {
            String name = Application.getProcessName();
            if (name != null) return expected.equals(name);
        }
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = manager == null ? null : manager.getRunningAppProcesses();
        if (processes != null) for (ActivityManager.RunningAppProcessInfo process : processes)
            if (process.pid == Process.myPid()) return expected.equals(process.processName);
        return false;
    }

    static boolean hasPrivateProcess(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = manager == null ? null : manager.getRunningAppProcesses();
        if (processes == null) return true; // Unknown is never permission to delete live WebView files.
        String expected = context.getPackageName() + PROCESS_SUFFIX;
        for (ActivityManager.RunningAppProcessInfo process : processes)
            if (expected.equals(process.processName)) return true;
        return false;
    }

    static boolean supported(Context context) {
        if (Build.VERSION.SDK_INT >= 28) return true;
        try {
            return WebViewFeature.isStartupFeatureSupported(context,
                WebViewFeature.STARTUP_FEATURE_SET_DATA_DIRECTORY_SUFFIX);
        } catch (RuntimeException error) { return false; }
    }

    static String unavailableReason(Context context) {
        return supported(context) ? null : "当前 Android / 系统 WebView 不支持独立隐私会话，请更新系统 WebView";
    }

    static void launch(Activity activity, JSObject configuration) throws IOException {
        Context context = activity.getApplicationContext();
        if (isPrivateProcess(context)) throw new IOException("已在隐私会话中");
        if (!supported(context)) throw new IOException(unavailableReason(context));
        byte[] payload = configuration.toString().getBytes(StandardCharsets.UTF_8);
        if (payload.length > MAX_CONFIG_BYTES) throw new IOException("脚本配置过大，无法启动隐私会话");
        final ParcelFileDescriptor[] pipe;
        synchronized (SESSION_LOCK) {
            if (launching || sessionPeer != null || hasPrivateProcess(context))
                throw new IOException("隐私会话正在运行或清理，请稍后重试");
            cleanupOwnedDirectories(context);
            pipe = ParcelFileDescriptor.createPipe();
            launching = true;
        }
        AtomicReference<byte[]> transfer = new AtomicReference<>(payload);
        Binder owner = new Binder() {
            @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
                if (code != REGISTER_PEER) return super.onTransact(code, data, reply, flags);
                if (Binder.getCallingUid() != Process.myUid()) throw new SecurityException("private session owner");
                data.enforceInterface(DESCRIPTOR);
                IBinder peer = data.readStrongBinder();
                if (peer == null) throw new SecurityException("missing private session peer");
                if (reply == null) throw new SecurityException("private session registration must be synchronous");
                synchronized (SESSION_LOCK) {
                    if (sessionOwner != this || !launching || sessionPeer != null)
                        throw new SecurityException("private session already attached or expired");
                    try {
                        peer.linkToDeath(() -> execute(() -> {
                            synchronized (SESSION_LOCK) {
                                if (sessionPeer != peer || sessionOwner != this) return;
                                try { cleanupOwnedDirectories(context); }
                                catch (IOException error) {
                                    android.util.Log.w("NewsNookBrowser", "Private session cleanup will be retried at startup");
                                } finally {
                                    closePipe(pipe);
                                    transfer.set(null);
                                    sessionPeer = null;
                                    sessionOwner = null;
                                    launching = false;
                                }
                            }
                        }), 0);
                    } catch (RemoteException error) {
                        closePipe(pipe);
                        transfer.set(null);
                        sessionOwner = null;
                        launching = false;
                        throw error;
                    }
                    sessionPeer = peer;
                    launching = false;
                }
                byte[] configurationBytes = transfer.getAndSet(null);
                reply.writeNoException();
                reply.writeParcelable(pipe[0], 0);
                try { pipe[0].close(); } catch (IOException ignored) {}
                execute(() -> {
                    try (OutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                        if (configurationBytes != null) output.write(configurationBytes);
                    } catch (IOException error) {
                        android.util.Log.w("NewsNookBrowser", "Private session configuration transfer interrupted");
                    }
                });
                return true;
            }
        };
        synchronized (SESSION_LOCK) { sessionOwner = owner; }
        Intent intent = new Intent(activity, PrivateBrowserActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Bundle extras = new Bundle();
        extras.putBinder(EXTRA_OWNER, owner);
        intent.putExtras(extras);
        try {
            activity.startActivity(intent);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                synchronized (SESSION_LOCK) {
                    if (sessionOwner != owner || sessionPeer != null || !launching) return;
                    // A provider crash before Activity.onCreate must not retain FDs/configuration
                    // or permanently block the next launch. A late Activity is rejected by owner identity.
                    closePipe(pipe);
                    transfer.set(null);
                    sessionOwner = null;
                    launching = false;
                }
            }, 15000);
        } catch (RuntimeException error) {
            closePipe(pipe);
            transfer.set(null);
            synchronized (SESSION_LOCK) {
                if (sessionOwner == owner && sessionPeer == null) {
                    launching = false;
                    sessionOwner = null;
                }
            }
            throw new IOException("无法打开隐私会话", error);
        }
    }

    private static void closePipe(ParcelFileDescriptor[] pipe) {
        for (ParcelFileDescriptor descriptor : pipe)
            try { descriptor.close(); } catch (IOException ignored) {}
    }

    static ParcelFileDescriptor registerPeer(IBinder owner, IBinder peer) throws RemoteException {
        if (owner == null) throw new RemoteException("private session expired");
        Parcel request = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            request.writeInterfaceToken(DESCRIPTOR);
            request.writeStrongBinder(peer);
            if (!owner.transact(REGISTER_PEER, request, reply, 0)) throw new RemoteException("private session unavailable");
            reply.readException();
            return reply.readParcelable(ParcelFileDescriptor.class.getClassLoader());
        } finally { request.recycle(); reply.recycle(); }
    }

    static File temporaryDirectory(Context context, String parent) {
        File directory = new File(new File(context.getApplicationInfo().dataDir, parent), TEMP_DIRECTORY);
        if (!directory.isDirectory() && !directory.mkdirs())
            throw new IllegalStateException("Private browser temporary storage unavailable");
        return directory;
    }

    static void sweepInterruptedSession(Context context) {
        execute(() -> {
            synchronized (SESSION_LOCK) {
                if (launching || sessionPeer != null || hasPrivateProcess(context)) return;
                try { cleanupOwnedDirectories(context); }
                catch (IOException error) {
                    android.util.Log.w("NewsNookBrowser", "Interrupted private session cleanup will be retried");
                }
            }
        });
    }

    /** Strict allowlist: never clear an application-wide cache, database, files, or default WebView directory. */
    static void cleanupOwnedDirectories(Context context) throws IOException {
        File data = new File(context.getApplicationInfo().dataDir).getCanonicalFile();
        for (String path : new String[] {
                "app_webview_" + DATA_SUFFIX,
                "cache/webview_" + DATA_SUFFIX,
                "cache/" + TEMP_DIRECTORY,
                "files/" + TEMP_DIRECTORY,
                "code_cache/" + TEMP_DIRECTORY
        }) {
            deleteOwnedTree(new File(data, path), data);
        }
    }

    private static void deleteOwnedTree(File entry, File data) throws IOException {
        try {
            android.system.StructStat stat = Os.lstat(entry.getAbsolutePath());
            if (OsConstants.S_ISLNK(stat.st_mode)) {
                if (!entry.delete()) throw new IOException("Could not delete private storage link");
                return;
            }
        } catch (android.system.ErrnoException error) {
            if (error.errno == OsConstants.ENOENT) return;
            throw new IOException("Could not inspect private storage", error);
        }
        File canonical = entry.getCanonicalFile();
        if (!canonical.getPath().startsWith(data.getPath() + File.separator))
            throw new IOException("Private storage escaped application directory");
        if (entry.isDirectory()) {
            File[] children = entry.listFiles();
            if (children == null) throw new IOException("Could not enumerate private storage");
            for (File child : children) deleteOwnedTree(child, data);
        }
        if (!entry.delete()) throw new IOException("Could not clear private browser storage");
    }
}
