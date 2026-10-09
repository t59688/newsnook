package com.aizeek.newsnook;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** Pure-Java integrity checks used before handing an APK to Android's package installer. */
final class AppUpdateIntegrity {

    private static final int BUFFER_SIZE = 64 * 1024;

    private AppUpdateIntegrity() {}

    static String normalizeSha256(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.regionMatches(true, 0, "sha256:", 0, 7)) {
            normalized = normalized.substring(7).trim();
        }
        if (!normalized.matches("(?i)[0-9a-f]{64}")) return null;
        return normalized.toLowerCase(java.util.Locale.ROOT);
    }

    static VerificationResult verify(File file, String expectedSha256, Long expectedSize) {
        if (file == null || !file.isFile()) {
            return VerificationResult.failed("安装包不存在");
        }
        if (expectedSize != null && expectedSize > 0 && file.length() != expectedSize) {
            return VerificationResult.failed("安装包大小校验失败");
        }
        if (expectedSha256 == null) return VerificationResult.ok();

        String normalized = normalizeSha256(expectedSha256);
        if (normalized == null) {
            return VerificationResult.failed("安装包 SHA-256 无效");
        }
        try {
            String actual = sha256(file);
            if (!normalized.equals(actual)) {
                return VerificationResult.failed("安装包完整性校验失败");
            }
            return VerificationResult.ok();
        } catch (IOException | NoSuchAlgorithmException error) {
            return VerificationResult.failed("安装包校验失败: " + error.getMessage());
        }
    }

    static String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[BUFFER_SIZE];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] bytes = digest.digest();
        char[] chars = new char[bytes.length * 2];
        final char[] alphabet = "0123456789abcdef".toCharArray();
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            chars[i * 2] = alphabet[value >>> 4];
            chars[i * 2 + 1] = alphabet[value & 0x0f];
        }
        return new String(chars);
    }

    static final class VerificationResult {
        final boolean valid;
        final String message;

        private VerificationResult(boolean valid, String message) {
            this.valid = valid;
            this.message = message;
        }

        static VerificationResult ok() {
            return new VerificationResult(true, null);
        }

        static VerificationResult failed(String message) {
            return new VerificationResult(false, message);
        }
    }
}
