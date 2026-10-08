package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.app.DownloadManager;
import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class AppUpdateBridgeTest {
    @Test
    public void selectsMatchingDeltaForJsonIntegerMetadata() throws Exception {
        assertDownloadSelection(true, false);
    }

    @Test
    public void downloadsFullApkWhenRebuiltSourceDoesNotMatchDelta() throws Exception {
        assertDownloadSelection(false, false);
    }

    @Test
    public void fullFallbackRetainsFailureReasonAndDoesNotRetryDelta() throws Exception {
        assertDownloadSelection(true, true);
    }

    private void assertDownloadSelection(boolean matchingSource, boolean testFallback) throws Exception {
        Application context = RuntimeEnvironment.getApplication();
        File source = new File(context.getCacheDir(), "installed.apk");
        Files.write(source.toPath(), new byte[] { 1, 2, 3 });
        String originalSource = context.getApplicationInfo().sourceDir;
        context.getApplicationInfo().sourceDir = source.getAbsolutePath();
        String from = matchingSource ? AppUpdateIntegrity.sha256(source) : "c".repeat(64);
        String target = "a".repeat(64);
        String patchName = "delta-" + from + "-" + target + ".gdiff.gz";
        String patchUrl = "https://news-update.aizeek.com/newsnook/beta/deltas/" + patchName;
        JSObject options = new JSObject("{\"size\":32308608,\"versionCode\":10811013}");
        String fullUrl = "https://news-update.aizeek.com/newsnook/beta/new.apk";
        options.put("url", fullUrl);
        options.put("fileName", "new.apk");
        options.put("sha256", target);
        options.put("deltas", new com.getcapacitor.JSArray("[{"
            + "\"algorithm\":\"gdiff-gzip-v1\",\"fromSha256\":\"" + from
            + "\",\"sha256\":\"" + "b".repeat(64)
            + "\",\"fileName\":\"" + patchName + "\",\"url\":\"" + patchUrl
            + "\",\"size\":1180797}]"));
        CountDownLatch finished = new CountDownLatch(1);
        long[] downloadId = new long[1];
        PluginCall call = new PluginCall(null, "AppUpdate", "test", "startDownload", options) {
            @Override public void resolve(JSObject result) {
                downloadId[0] = result.optLong("downloadId");
                finished.countDown();
            }
        };
        java.util.List<String> events = new java.util.ArrayList<>();
        java.util.List<JSObject> payloads = new java.util.ArrayList<>();
        AppUpdatePlugin plugin = new AppUpdatePlugin() {
            @Override public Context getContext() { return context; }
            @Override public PermissionState getPermissionState(String alias) {
                return PermissionState.GRANTED;
            }
            @Override protected void notifyListeners(String event, JSObject data) {
                events.add(event);
                payloads.add(data);
            }
        };
        try {
            plugin.startDownload(call);
            assertTrue("Download should be enqueued", finished.await(10, TimeUnit.SECONDS));
            DownloadManager manager = context.getSystemService(DownloadManager.class);
            DownloadManager.Request request = Shadows.shadowOf(manager).getRequest(downloadId[0]);
            assertEquals(matchingSource ? patchUrl : fullUrl, Shadows.shadowOf(request).getUri().toString());
            if (testFallback) {
                // Inject the failure at the native fallback boundary, not at the JS event
                // receiver: assert the real full request and the real emitted event.
                java.lang.reflect.Method fallback = AppUpdatePlugin.class.getDeclaredMethod(
                    "failOrFallback", long.class, String.class
                );
                fallback.setAccessible(true);
                fallback.invoke(plugin, downloadId[0], "patch hash mismatch");
                assertEquals(java.util.List.of("downloadRedirected"), events);
                JSObject redirected = payloads.get(0);
                assertEquals(downloadId[0], redirected.optLong("fromDownloadId"));
                assertEquals("patch hash mismatch", redirected.optString("message"));
                long fullId = redirected.optLong("toDownloadId");
                assertTrue(fullId != downloadId[0]);
                assertEquals(fullUrl, Shadows.shadowOf(
                    Shadows.shadowOf(manager).getRequest(fullId)
                ).getUri().toString());
                fallback.invoke(plugin, fullId, "full request failed");
                assertEquals(java.util.List.of("downloadRedirected", "downloadFailed"), events);
                assertEquals(fullId, payloads.get(1).optLong("downloadId"));
            }
        } finally {
            plugin.handleOnDestroy();
            context.getApplicationInfo().sourceDir = originalSource;
        }
    }
}
