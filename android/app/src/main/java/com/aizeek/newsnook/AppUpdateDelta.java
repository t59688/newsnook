package com.aizeek.newsnook;

import com.nothome.delta.GDiffPatcher;
import com.nothome.delta.RandomAccessFileSeekableSource;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.zip.GZIPInputStream;

/**
 * Applies a standard GDIFF stream to an immutable installed APK. The patch is gzip-compressed
 * for transport; reconstruction is streamed to a sibling temporary file and strictly bounded.
 * Only the exact byte-for-byte signed target artifact is accepted.
 */
final class AppUpdateDelta {

    private static final int BUFFER_SIZE = 64 * 1024;

    private AppUpdateDelta() {}

    static File apply(
        File installedApk,
        File patch,
        File destination,
        String sourceSha256,
        String patchSha256,
        long patchSize,
        String targetSha256,
        long targetSize
    ) throws IOException {
        if (targetSize <= 0 || patchSize <= 0
            || AppUpdateIntegrity.normalizeSha256(sourceSha256) == null
            || AppUpdateIntegrity.normalizeSha256(patchSha256) == null
            || AppUpdateIntegrity.normalizeSha256(targetSha256) == null) {
            throw new IOException("增量更新元数据无效");
        }
        requireVerified(installedApk, sourceSha256, null, "已安装 APK");
        requireVerified(patch, patchSha256, patchSize, "差分文件");

        File temporary = new File(destination.getParentFile(), destination.getName() + ".partial");
        if (temporary.exists() && !temporary.delete()) {
            throw new IOException("无法清除旧增量临时文件");
        }
        try {
            try (
                RandomAccessFileSeekableSource source =
                    new RandomAccessFileSeekableSource(new RandomAccessFile(installedApk, "r"));
                GZIPInputStream delta = new GZIPInputStream(new FileInputStream(patch), BUFFER_SIZE);
                OutputStream output = new BoundedOutputStream(
                    new BufferedOutputStream(new FileOutputStream(temporary), BUFFER_SIZE),
                    targetSize
                )
            ) {
                new GDiffPatcher().patch(source, delta, output);
            }
            requireVerified(temporary, targetSha256, targetSize, "合成 APK");
            if (destination.exists() && !destination.delete()) {
                throw new IOException("无法清除旧安装包");
            }
            if (!temporary.renameTo(destination)) {
                throw new IOException("无法保存合成 APK");
            }
            return destination;
        } finally {
            if (temporary.exists()) {
                //noinspection ResultOfMethodCallIgnored
                temporary.delete();
            }
        }
    }

    private static void requireVerified(
        File file, String sha256, Long size, String label
    ) throws IOException {
        AppUpdateIntegrity.VerificationResult result = AppUpdateIntegrity.verify(file, sha256, size);
        if (!result.valid) throw new IOException(label + "校验失败: " + result.message);
    }

    private static final class BoundedOutputStream extends FilterOutputStream {
        private final long limit;
        private long written;

        BoundedOutputStream(OutputStream out, long limit) {
            super(out);
            this.limit = limit;
        }

        @Override
        public void write(int value) throws IOException {
            checkCapacity(1);
            out.write(value);
            written++;
        }

        @Override
        public void write(byte[] data, int offset, int length) throws IOException {
            checkCapacity(length);
            out.write(data, offset, length);
            written += length;
        }

        private void checkCapacity(int bytes) throws IOException {
            if (bytes < 0 || written > limit - bytes) {
                throw new IOException("差分合成超出目标 APK 大小");
            }
        }
    }
}
