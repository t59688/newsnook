package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.webkit.WebView;
import java.lang.reflect.Field;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class UserscriptRuntimeLifecycleTest {
    @Test public void closedRuntimeCannotReinstallIntoAReleasedTab() throws Exception {
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        runtime.close();
        assertFalse(runtime.install());
        view.destroy();
    }

    @Test public void closeCancelsDependenciesAndDownloadsNotInTheGmRequestMap() throws Exception {
        WebView view = new WebView(RuntimeEnvironment.getApplication());
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        Field clientField = UserscriptRuntime.class.getDeclaredField("client");
        clientField.setAccessible(true);
        OkHttpClient client = (OkHttpClient) clientField.get(runtime);
        AtomicReference<Exception> failure = new AtomicReference<>();
        try (ServerSocket server = new ServerSocket(0)) {
            server.setSoTimeout(5000);
            Call call = client.newCall(new Request.Builder().url("http://127.0.0.1:" + server.getLocalPort() + "/dependency").build());
            Thread worker = new Thread(() -> {
                try (Response ignored = call.execute()) { }
                catch (Exception error) { failure.set(error); }
            }, "UserscriptDependencyTest");
            worker.start();
            try (Socket connection = server.accept()) {
                runtime.close();
                assertTrue("all runtime-owned calls must be cancelled, including synchronous @require/download calls", call.isCanceled());
            } finally {
                call.cancel();
                worker.join(5000);
                runtime.close();
                view.destroy();
            }
            assertFalse("the cancelled resource download must not outlive the tab", worker.isAlive());
            assertNotNull(failure.get());
        }
    }

    private static final String PAGE = "https://example.com/article";
    private static final class DocumentWebView extends WebView {
        String address = PAGE;
        final java.util.List<android.webkit.ValueCallback<String>> replies = new java.util.ArrayList<>();
        DocumentWebView() { super(RuntimeEnvironment.getApplication()); }
        @Override public String getUrl() { return address; }
        @Override public void evaluateJavascript(String source, android.webkit.ValueCallback<String> callback) {
            if (callback != null) replies.add(callback);
        }
        void identity(int index, String id) throws Exception {
            replies.get(index).onReceiveValue(org.json.JSONObject.quote(
                new org.json.JSONObject().put("id", id).put("url", address).toString()));
        }
    }

    private static org.json.JSONObject script(String id, String... grants) throws Exception {
        return new org.json.JSONObject().put("id", id).put("enabled", true).put("name", id).put("source", "void 0")
            .put("matches", new org.json.JSONArray().put("https://example.com/*"))
            .put("grants", new org.json.JSONArray(java.util.Arrays.asList(grants)));
    }

    private static Object field(Object target, String name) throws Exception {
        Field value = target.getClass().getDeclaredField(name);
        value.setAccessible(true);
        return value.get(target);
    }

    private static org.json.JSONObject message(UserscriptRuntime runtime, String id, String op, String documentId) throws Exception {
        Object installed = ((java.util.Map<?, ?>) field(runtime, "scripts")).get(id);
        return new org.json.JSONObject().put("id", id).put("token", field(installed, "secret"))
            .put("op", op).put("documentId", documentId).put("documentUrl", PAGE).put("storageEpoch", 0);
    }

    private static void receive(UserscriptRuntime runtime, org.json.JSONObject payload, String origin, String world) throws Exception {
        receive(runtime, payload, origin, world, null);
    }

    private static void receive(UserscriptRuntime runtime, org.json.JSONObject payload, String origin, String world,
                                androidx.webkit.JavaScriptReplyProxy proxy) throws Exception {
        java.lang.reflect.Method receive = UserscriptRuntime.class.getDeclaredMethod("receive",
            org.json.JSONObject.class, String.class, androidx.webkit.JavaScriptReplyProxy.class, String.class);
        receive.setAccessible(true);
        receive.invoke(runtime, payload, origin, proxy, world);
    }

    private static final class RecordingProxy extends androidx.webkit.JavaScriptReplyProxy {
        final java.util.List<String> messages = new java.util.ArrayList<>();
        @Override public void postMessage(String message) { messages.add(message); }
        @Override public void postMessage(byte[] message) { throw new AssertionError("unexpected binary message"); }
        @Override public void executeJavaScript(String source,
                androidx.webkit.WebViewOutcomeReceiver<String, androidx.webkit.JavaScriptExecutionException> receiver) {
            throw new AssertionError("unexpected script evaluation");
        }
    }

    @Test public void actualStartsWaitForCommittedDocumentAndCountEachScriptOnce() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        java.util.concurrent.atomic.AtomicInteger notifications = new java.util.concurrent.atomic.AtomicInteger();
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-one", "none"))
                .put(script("us-other").put("matches", new org.json.JSONArray().put("https://other.example/*")))
                .put(script("us-disabled").put("enabled", false)));
            runtime.setStateListener(notifications::incrementAndGet);
            runtime.onNavigation(PAGE);
            assertEquals("installed and matched are different from actually executed", 1, runtime.getMatchedScriptCount(PAGE));
            assertEquals(0, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, "us-one", "started", "1000.25"), "https://example.com", "page");
            assertEquals("document-start can report before commit but is not trusted as the new document yet", 0, runtime.getActiveScriptCount());
            runtime.onDocumentCommitted(PAGE);
            view.identity(0, "1000.25");
            assertEquals(1, runtime.getActiveScriptCount());
            assertEquals(1, notifications.get());
            receive(runtime, message(runtime, "us-one", "started", "1000.25"), "https://example.com", "page");
            runtime.onDocumentCommitted(PAGE);
            assertEquals(1, runtime.getActiveScriptCount());
            assertEquals("finished fallback does not repeat the identity query", 1, view.replies.size());
            assertEquals(1, notifications.get());
            runtime.onNavigation("https://other.example/next");
            assertEquals(0, runtime.getActiveScriptCount());
            assertEquals(1, runtime.getMatchedScriptCount("https://other.example/next"));
            assertEquals(2, notifications.get());
        } finally { runtime.close(); view.destroy(); }
    }

    @Test public void sameAddressNavigationRejectsRetiredStartsAndLateIdentityReplies() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-old")).put(script("us-new")));
            runtime.onNavigation(PAGE);
            runtime.onDocumentCommitted(PAGE);
            receive(runtime, message(runtime, "us-old", "started", "1000"), "https://example.com", "page");
            runtime.onNavigation(PAGE);
            view.identity(0, "1000");
            assertEquals(0, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, "us-old", "started", "1000"), "https://example.com", "page");
            receive(runtime, message(runtime, "us-new", "started", "2000"), "https://example.com", "page");
            runtime.onDocumentCommitted(PAGE);
            view.identity(1, "2000");
            assertEquals("only the started id from the new committed document is counted", 1, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, "us-old", "started", "1000"), "https://example.com", "page");
            assertEquals(1, runtime.getActiveScriptCount());
            runtime.onNavigation(PAGE);
            runtime.onDocumentCommitted(PAGE);
            runtime.close();
            view.identity(2, "3000");
            assertEquals(0, runtime.getActiveScriptCount());
        } finally { runtime.close(); view.destroy(); }
    }

    @Test public void retiredSameAddressMessagesCannotReplaceTheCurrentStorageChannel() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        RecordingProxy oldProxy = new RecordingProxy();
        RecordingProxy newProxy = new RecordingProxy();
        String id = "us-current-channel";
        try {
            runtime.prepare(new org.json.JSONArray().put(script(id, "GM_setValue")));
            runtime.onNavigation(PAGE);
            receive(runtime, message(runtime, id, "started", "1000"), "https://example.com", "isolated", oldProxy);
            runtime.onDocumentCommitted(PAGE);
            view.identity(0, "1000");
            runtime.onNavigation(PAGE);
            receive(runtime, message(runtime, id, "started", "2000"), "https://example.com", "isolated", newProxy);
            receive(runtime, message(runtime, id, "started", "1000"), "https://example.com", "isolated", oldProxy);
            runtime.onDocumentCommitted(PAGE);
            view.identity(1, "2000");
            Object installed = ((java.util.Map<?, ?>) field(runtime, "scripts")).get(id);
            assertSame("commit must choose the proxy belonging to the confirmed document", newProxy, field(installed, "proxy"));
            receive(runtime, message(runtime, id, "started", "1000"), "https://example.com", "isolated", oldProxy);
            receive(runtime, message(runtime, id, "set", "1000").put("key", "retired").put("value", "true"),
                "https://example.com", "isolated", oldProxy);
            assertSame("late starts and GM messages cannot steal the current reply channel", newProxy, field(installed, "proxy"));
            assertEquals(1, runtime.getActiveScriptCount());
            assertFalse(((android.content.SharedPreferences) field(runtime, "storage")).contains(id));
            runtime.setPrivateMode(true);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertTrue("the retired document must never receive the current storage reset", oldProxy.messages.isEmpty());
            assertEquals(1, newProxy.messages.size());
            assertEquals("storageReset", new org.json.JSONObject(newProxy.messages.get(0)).getString("event"));
        } finally { runtime.close(); view.destroy(); }
    }

    @Test public void deferredStartSynchronizesSubsequentStorageCallsAfterAModeChange() throws Exception {
        assertStartReceivesCurrentStorage(false);
    }

    @Test public void pendingStartSynchronizesSubsequentStorageCallsAfterDocumentConfirmation() throws Exception {
        assertStartReceivesCurrentStorage(true);
    }

    private static void assertStartReceivesCurrentStorage(boolean startsBeforeCommit) throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        RecordingProxy proxy = new RecordingProxy();
        String id = "us-storage-start-" + startsBeforeCommit;
        android.content.SharedPreferences disk = view.getContext().getSharedPreferences("newsnook-userscript-storage", 0);
        disk.edit().putString(id, "{\"ordinary\":\"saved-value\"}").commit();
        try {
            runtime.prepare(new org.json.JSONArray().put(script(id, "GM_setValue")));
            runtime.onNavigation(PAGE);
            if (startsBeforeCommit) receive(runtime, message(runtime, id, "started", "1000"), "https://example.com", "isolated", proxy);
            runtime.onDocumentCommitted(PAGE);
            if (!startsBeforeCommit) view.identity(0, "1000");
            runtime.setPrivateMode(true);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertTrue("a pending or deferred script has no confirmed current reply channel yet", proxy.messages.isEmpty());
            if (startsBeforeCommit) view.identity(0, "1000");
            else receive(runtime, message(runtime, id, "started", "1000"), "https://example.com", "isolated", proxy);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals("accepting the current start sends a reset for subsequent storage calls", 1, proxy.messages.size());
            org.json.JSONObject reset = new org.json.JSONObject(proxy.messages.get(0));
            assertEquals("storageReset", reset.getString("event"));
            assertEquals(1, reset.getLong("storageEpoch"));
            assertEquals(0, reset.getJSONObject("values").length());
            assertEquals(1, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, id, "set", "1000").put("storageEpoch", 1)
                .put("key", "temporary").put("value", "true"), "https://example.com", "isolated", proxy);
            assertTrue(((android.content.SharedPreferences) field(runtime, "storage")).getString(id, "").contains("temporary"));
            assertFalse(disk.getString(id, "").contains("temporary"));
            runtime.setPrivateMode(false);
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
            assertEquals(2, proxy.messages.size());
            org.json.JSONObject ordinary = new org.json.JSONObject(proxy.messages.get(1));
            assertEquals(2, ordinary.getLong("storageEpoch"));
            assertEquals("saved-value", ordinary.getJSONObject("values").getString("ordinary"));
            assertFalse(ordinary.getJSONObject("values").has("temporary"));
        } finally { runtime.close(); disk.edit().remove(id).commit(); view.destroy(); }
    }

    @Test public void startedReportsKeepTokenWorldOriginUrlAndMainFrameValidation() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-count", "GM_getValue")));
            runtime.onNavigation(PAGE);
            runtime.onDocumentCommitted(PAGE);
            view.identity(0, "1000");
            receive(runtime, message(runtime, "us-count", "started", "1000").put("token", "wrong"), "https://example.com", "isolated");
            receive(runtime, message(runtime, "us-count", "started", "1000"), "https://attacker.example", "isolated");
            receive(runtime, message(runtime, "us-count", "started", "1000"), "https://example.com", "page");
            receive(runtime, message(runtime, "us-count", "started", "1000").put("documentUrl", "https://example.com/old"), "https://example.com", "isolated");
            java.lang.reflect.Method port = UserscriptRuntime.class.getDeclaredMethod("onWebMessage", WebView.class,
                androidx.webkit.WebMessageCompat.class, android.net.Uri.class, boolean.class,
                androidx.webkit.JavaScriptReplyProxy.class, String.class);
            port.setAccessible(true);
            port.invoke(runtime, view, new androidx.webkit.WebMessageCompat(message(runtime, "us-count", "started", "1000").toString()),
                android.net.Uri.parse("https://example.com"), false, null, "isolated");
            assertEquals(0, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, "us-count", "started", "1000"), "https://example.com", "isolated");
            assertEquals(1, runtime.getActiveScriptCount());
        } finally { runtime.close(); view.destroy(); }
    }

    @Test public void storageModeSwitchRejectsOldWritesAndNeverCopiesTemporaryValuesToDisk() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        android.content.SharedPreferences disk = view.getContext().getSharedPreferences("newsnook-userscript-storage", 0);
        String id = "us-storage-switch";
        disk.edit().putString(id, "{\"normal\":\"ordinary-marker\"}").commit();
        try {
            runtime.prepare(new org.json.JSONArray().put(script(id, "GM_getValue", "GM_setValue", "GM_deleteValue")));
            runtime.setPrivateMode(true);
            android.content.SharedPreferences memory = (android.content.SharedPreferences) field(runtime, "storage");
            assertTrue(memory instanceof MemoryPreferences);
            assertFalse(memory.contains(id));
            receive(runtime, message(runtime, id, "set", "1000").put("key", "late").put("value", "true"), "https://example.com", "isolated");
            assertFalse("a write issued before entering no-record mode is rejected", memory.contains(id));
            receive(runtime, message(runtime, id, "set", "1000").put("storageEpoch", 1).put("key", "temporary").put("value", "\"ephemeral-marker\""), "https://example.com", "isolated");
            assertTrue(memory.getString(id, "").contains("ephemeral-marker"));
            assertFalse(disk.getString(id, "").contains("ephemeral-marker"));
            java.lang.reflect.Method build = UserscriptRuntime.class.getDeclaredMethod("buildScript",
                Class.forName("com.aizeek.newsnook.UserscriptRuntime$InstalledScript"));
            build.setAccessible(true);
            String injected = (String) build.invoke(runtime, ((java.util.Map<?, ?>) field(runtime, "scripts")).get(id));
            assertTrue(injected.contains("\"storageEpoch\":1"));
            assertFalse("future documents cannot receive the old ordinary values", injected.contains("ordinary-marker"));
            runtime.setPrivateMode(false);
            assertTrue("leaving no-record mode clears its runtime memory", memory.getAll().isEmpty());
            receive(runtime, message(runtime, id, "set", "1000").put("storageEpoch", 1).put("key", "leak").put("value", "\"ephemeral-marker\""), "https://example.com", "isolated");
            assertFalse(disk.getString(id, "").contains("ephemeral-marker"));
            assertTrue(disk.getString(id, "").contains("ordinary-marker"));
            receive(runtime, message(runtime, id, "set", "1000").put("storageEpoch", 2).put("key", "normal").put("value", "\"ordinary-updated\""), "https://example.com", "isolated");
            assertTrue(disk.getString(id, "").contains("ordinary-updated"));
            runtime.setPrivateMode(true);
            assertFalse(((android.content.SharedPreferences) field(runtime, "storage")).contains(id));
        } finally { runtime.close(); disk.edit().remove(id).commit(); view.destroy(); }
    }

    @Test public void dependencyCrossingPrivacyBoundaryNeverCreatesACacheFile() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        String url = "https://example.com/require-" + java.util.UUID.randomUUID() + ".js";
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte value : digest) name.append(String.format("%02x", value & 255));
        java.io.File cache = new java.io.File(new java.io.File(view.getContext().getCacheDir(), "userscript-requires"), name + ".js");
        OkHttpClient intercepted = new OkHttpClient.Builder().addInterceptor(chain -> {
            runtime.setPrivateMode(true);
            runtime.setPrivateMode(false);
            return new Response.Builder().request(chain.request()).protocol(okhttp3.Protocol.HTTP_1_1).code(200).message("OK")
                .body(okhttp3.ResponseBody.create(okhttp3.MediaType.get("application/javascript"), "void 0;")).build();
        }).build();
        Field client = UserscriptRuntime.class.getDeclaredField("client");
        client.setAccessible(true);
        client.set(runtime, intercepted);
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-require").put("requires", new org.json.JSONArray().put(url))));
            assertEquals(1, runtime.getMatchedScriptCount(PAGE));
            assertFalse("normal -> no-record -> normal during fetch cannot write a resource cache", cache.exists());
        } finally { runtime.close(); cache.delete(); view.destroy(); }
    }

    @Test public void matchingGrantNoneFrameMayReportStartButCannotUseNativeBridge() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        String id = "us-frame-none";
        String frameUrl = "https://player.example/embed";
        try {
            org.json.JSONObject entry = script(id, "none").put("matches",
                new org.json.JSONArray().put("https://player.example/*"));
            runtime.prepare(new org.json.JSONArray().put(entry));
            runtime.onNavigation(PAGE);
            org.json.JSONObject started = message(runtime, id, "started", "2000").put("documentUrl", frameUrl);
            receive(runtime, started, "https://player.example", "page", null, false);
            assertEquals("a matching no-grant iframe contributes to the executed-script count", 1, runtime.getActiveScriptCount());
            org.json.JSONObject forgedWrite = message(runtime, id, "set", "2000").put("documentUrl", frameUrl)
                .put("key", "x").put("value", "true");
            receive(runtime, forgedWrite, "https://player.example", "page", null, false);
            assertFalse("iframe messages cannot reach native storage operations", ((android.content.SharedPreferences) field(runtime, "storage")).contains(id));
        } finally { runtime.close(); view.destroy(); }
    }

    @Test public void noFramesAndNativeGrantScriptsCannotStartInsideFrames() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        try {
            runtime.prepare(new org.json.JSONArray()
                .put(script("us-frame-optout", "none").put("noFrames", true).put("matches", new org.json.JSONArray().put("https://player.example/*")))
                .put(script("us-frame-privileged", "GM_getValue").put("matches", new org.json.JSONArray().put("https://player.example/*"))));
            runtime.onNavigation(PAGE);
            receive(runtime, message(runtime, "us-frame-optout", "started", "2001").put("documentUrl", "https://player.example/embed"),
                "https://player.example", "page", null, false);
            receive(runtime, message(runtime, "us-frame-privileged", "started", "2002").put("documentUrl", "https://player.example/embed"),
                "https://player.example", "isolated", null, false);
            assertEquals("frame opt-outs and native-grant scripts cannot become active from child frames", 0, runtime.getActiveScriptCount());
        } finally { runtime.close(); view.destroy(); }
    }

    private static void receive(UserscriptRuntime runtime, org.json.JSONObject payload, String origin, String world,
                                androidx.webkit.JavaScriptReplyProxy proxy, boolean mainFrame) throws Exception {
        java.lang.reflect.Method receive = UserscriptRuntime.class.getDeclaredMethod("receive",
            org.json.JSONObject.class, String.class, androidx.webkit.JavaScriptReplyProxy.class, String.class, boolean.class);
        receive.setAccessible(true);
        receive.invoke(runtime, payload, origin, proxy, world, mainFrame);
    }

    @Test public void noRecordModeRetainsExplicitDownloadGrantChecks() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view, true);
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-download", "GM_download")).put(script("us-no-download", "none")));
            receive(runtime, message(runtime, "us-no-download", "downloadStart", "1000").put("req", "forbidden").put("name", "forbidden.bin"), "https://example.com", "page");
            assertTrue(((java.util.Map<?, ?>) field(runtime, "downloads")).isEmpty());
            receive(runtime, message(runtime, "us-download", "downloadStart", "1000").put("req", "manual").put("name", "manual.bin"), "https://example.com", "isolated");
            assertEquals("an authorized explicit download is allowed without leaving no-record mode", 1,
                ((java.util.Map<?, ?>) field(runtime, "downloads")).size());
        } finally { runtime.close(); view.destroy(); }
    }

    @org.robolectric.annotation.Implements(value = androidx.webkit.WebViewFeature.class, isInAndroidSdk = false)
    public static class LegacyFeatureShadow {
        @org.robolectric.annotation.Implementation public static boolean isFeatureSupported(String feature) {
            return androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT.equals(feature)
                || androidx.webkit.WebViewFeature.WEB_MESSAGE_LISTENER.equals(feature);
        }
    }

    @org.robolectric.annotation.Implements(value = androidx.webkit.WebViewCompat.class, isInAndroidSdk = false)
    public static class LegacyCompatShadow {
        static androidx.webkit.WebViewCompat.WebMessageListener listener;
        static String source;
        static boolean removed;
        @org.robolectric.annotation.Implementation public static void addWebMessageListener(WebView view, String name,
                java.util.Set<String> origins, androidx.webkit.WebViewCompat.WebMessageListener value) {
            assertEquals("__NewsNookUserScriptPort", name);
            assertTrue(origins.contains("https://example.com"));
            listener = value;
        }
        @org.robolectric.annotation.Implementation public static androidx.webkit.ScriptHandler addDocumentStartJavaScript(
                WebView view, String script, java.util.Set<String> origins) {
            source = script;
            return () -> {};
        }
        @org.robolectric.annotation.Implementation public static void removeWebMessageListener(WebView view, String name) { removed = true; }
    }

    @Test
    @Config(sdk = 34, instrumentedPackages = {"androidx.webkit"},
        shadows = {LegacyFeatureShadow.class, LegacyCompatShadow.class})
    public void legacyGrantNoneInstallsAValidatedStatusPortAndRebuildsFutureStorage() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        LegacyCompatShadow.listener = null;
        LegacyCompatShadow.source = null;
        LegacyCompatShadow.removed = false;
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-legacy", "none")));
            assertTrue(runtime.install());
            assertNotNull("legacy scripts require their port before boot can execute", LegacyCompatShadow.listener);
            assertTrue(LegacyCompatShadow.source.contains("__NN_BOOT"));
            runtime.onNavigation(PAGE);
            runtime.onDocumentCommitted(PAGE);
            view.identity(0, "1000");
            LegacyCompatShadow.listener.onPostMessage(view,
                new androidx.webkit.WebMessageCompat(message(runtime, "us-legacy", "started", "1000").toString()),
                android.net.Uri.parse("https://example.com"), true, null);
            assertEquals(1, runtime.getActiveScriptCount());
            receive(runtime, message(runtime, "us-legacy", "downloadStart", "1000").put("req", "no-grant"), "https://example.com", "page");
            assertTrue(((java.util.Map<?, ?>) field(runtime, "downloads")).isEmpty());
            runtime.setPrivateMode(true);
            assertTrue("mode changes replace the future document binding without navigating the current page",
                LegacyCompatShadow.source.contains("\"storageEpoch\":1"));
            assertEquals(PAGE, view.getUrl());
            runtime.close();
            assertTrue(LegacyCompatShadow.removed);
        } finally { runtime.close(); view.destroy(); }
    }

    @Test
    @Config(sdk = 34, instrumentedPackages = {"androidx.webkit"},
        shadows = {LegacyFeatureShadow.class, LegacyCompatShadow.class})
    public void legacyRuntimeDoesNotDowngradeNativeGmPermissionsIntoPageWorld() throws Exception {
        DocumentWebView view = new DocumentWebView();
        UserscriptRuntime runtime = new UserscriptRuntime(view.getContext(), view);
        LegacyCompatShadow.listener = null;
        try {
            runtime.prepare(new org.json.JSONArray().put(script("us-privileged", "GM_setValue", "unsafeWindow")));
            try { runtime.install(); fail("legacy page world cannot receive native GM capabilities"); }
            catch (UnsupportedOperationException expected) { assertTrue(expected.getMessage().contains("GM")); }
            assertNull(LegacyCompatShadow.listener);
        } finally { runtime.close(); view.destroy(); }
    }

}
