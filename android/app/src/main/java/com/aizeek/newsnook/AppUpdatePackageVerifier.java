package com.aizeek.newsnook;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;

/**
 * Defense-in-depth checks on an APK before handing it to the Android package installer.
 *
 * PackageArchiveInfo may omit signingInfo on some OS versions. Compare signing certificates
 * when available; a concrete mismatch is rejected, while an unavailable archive certificate
 * defers mandatory verification to the Android system installer. A byte-for-byte target SHA
 * check has already happened before this code is called for delta output.
 */
final class AppUpdatePackageVerifier {

    private AppUpdatePackageVerifier() {}

    static void verifyIdentity(Context context, File apk, Long expectedVersionCode) throws IOException {
        PackageManager manager = context.getPackageManager();
        PackageInfo current = installedInfo(context);
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (candidate == null || !context.getPackageName().equals(candidate.packageName)) {
            throw new IOException("安装包包名不匹配");
        }
        long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? current.getLongVersionCode() : current.versionCode;
        long targetCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? candidate.getLongVersionCode() : candidate.versionCode;
        if (targetCode < installedCode
            || (expectedVersionCode != null && expectedVersionCode != targetCode)) {
            throw new IOException("安装包版本不匹配或发生降级");
        }
    }

    static void verify(Context context, File apk, Long expectedVersionCode) throws IOException {
        verifyIdentity(context, apk, expectedVersionCode);
        PackageManager manager = context.getPackageManager();
        try {
            Signature[] current = installedSigners(context);
            Signature[] candidate = archiveSigners(manager, apk);
            if (current == null || current.length == 0) {
                throw new IOException("无法获取现有应用签名");
            }
            if (candidate != null && candidate.length > 0
                && !new HashSet<>(Arrays.asList(current))
                    .equals(new HashSet<>(Arrays.asList(candidate)))) {
                throw new IOException("安装包签名与现有应用不一致");
            }
        } catch (PackageManager.NameNotFoundException error) {
            throw new IOException("无法验证当前应用签名", error);
        }
    }

    private static PackageInfo installedInfo(Context context) throws IOException {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException error) {
            throw new IOException("无法读取当前应用信息", error);
        }
    }

    private static Signature[] installedSigners(Context context)
        throws PackageManager.NameNotFoundException {
        PackageManager manager = context.getPackageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo info = manager.getPackageInfo(
                context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES
            );
            if (info.signingInfo != null) return info.signingInfo.getApkContentsSigners();
        }
        return manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
    }

    private static Signature[] archiveSigners(PackageManager manager, File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageInfo info = manager.getPackageArchiveInfo(
                apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES
            );
            if (info != null && info.signingInfo != null) {
                return info.signingInfo.getApkContentsSigners();
            }
        }
        PackageInfo legacy = manager.getPackageArchiveInfo(
            apk.getAbsolutePath(), PackageManager.GET_SIGNATURES
        );
        return legacy == null ? null : legacy.signatures;
    }
}
