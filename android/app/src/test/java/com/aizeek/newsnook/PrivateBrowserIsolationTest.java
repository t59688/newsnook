package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;
import java.io.File;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.rules.TemporaryFolder;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PrivateBrowserIsolationTest {
    @Rule public TemporaryFolder directory = new TemporaryFolder();

    private Context isolatedDataContext() {
        Context application = RuntimeEnvironment.getApplication();
        return new ContextWrapper(application) {
            @Override public ApplicationInfo getApplicationInfo() {
                ApplicationInfo info = new ApplicationInfo(application.getApplicationInfo());
                info.dataDir = directory.getRoot().getAbsolutePath();
                return info;
            }
        };
    }

    private File marker(String path) throws Exception {
        File file = new File(directory.getRoot(), path);
        assertTrue(file.getParentFile().isDirectory() || file.getParentFile().mkdirs());
        Files.write(file.toPath(), "sentinel".getBytes(StandardCharsets.UTF_8));
        return file;
    }

    @org.robolectric.annotation.Implements(android.system.Os.class)
    public static class AndroidFileStat {
        @org.robolectric.annotation.Implementation
        protected static android.system.StructStat lstat(String path) throws android.system.ErrnoException {
            // Robolectric's host-file stat returns an empty StructStat for absent paths on Windows.
            // Android lstat throws ENOENT, including the second idempotent cleanup pass.
            File file = new File(path);
            if (!file.exists() && !Files.isSymbolicLink(file.toPath()))
                throw new android.system.ErrnoException("lstat", android.system.OsConstants.ENOENT);
            return org.robolectric.shadow.api.Shadow.directlyOn(android.system.Os.class, "lstat",
                org.robolectric.util.ReflectionHelpers.ClassParameter.from(String.class, path));
        }
    }

    @Test
    @Config(shadows = AndroidFileStat.class)
    public void interruptedSessionCleanupOnlyRemovesOwnedDirectories() throws Exception {
        File cookie = marker("app_webview/Default/Cookies");
        File regularCache = marker("cache/regular-image");
        File account = marker("files/account-state");
        File preferences = marker("shared_prefs/user.xml");
        File ordinaryCodeCache = marker("code_cache/normal-module");
        File privateCookie = marker("app_webview_" + PrivateBrowserSession.DATA_SUFFIX + "/Default/Cookies");
        File privateCache = marker("cache/webview_" + PrivateBrowserSession.DATA_SUFFIX + "/Cache/data");
        File privateExport = marker("cache/" + PrivateBrowserSession.TEMP_DIRECTORY + "/share-image.png");
        File privateFiles = marker("files/" + PrivateBrowserSession.TEMP_DIRECTORY + "/temporary-image");
        File privateCodeCache = marker("code_cache/" + PrivateBrowserSession.TEMP_DIRECTORY + "/temporary-code");

        PrivateBrowserSession.cleanupOwnedDirectories(isolatedDataContext());

        for (File preserved : new File[] { cookie, regularCache, account, preferences, ordinaryCodeCache })
            assertTrue("ordinary application data must survive: " + preserved.getName(), preserved.isFile());
        for (File removed : new File[] { privateCookie, privateCache, privateExport, privateFiles, privateCodeCache })
            assertFalse("an interrupted private session must not be restored", removed.exists());
        // A second startup/owner-death sweep is harmless after a successful cleanup.
        PrivateBrowserSession.cleanupOwnedDirectories(isolatedDataContext());
    }

    @Test public void temporaryExportsStayInsideTheirDedicatedSubdirectory() throws Exception {
        Context context = isolatedDataContext();
        for (String parent : new String[] { "cache", "files", "code_cache" }) {
            File temporary = PrivateBrowserSession.temporaryDirectory(context, parent);
            assertEquals(new File(directory.getRoot(), parent + "/" + PrivateBrowserSession.TEMP_DIRECTORY)
                .getCanonicalFile(), temporary.getCanonicalFile());
            assertTrue(temporary.isDirectory());
        }
    }

    @Test public void privateScriptValuesAreSharedOnlyWithinTheDisposableSession() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        String key = "privacy-isolation-" + UUID.randomUUID();
        SharedPreferences disk = context.getSharedPreferences("newsnook-userscript-storage", Context.MODE_PRIVATE);
        disk.edit().putString(key, "{\"ordinary\":true}").commit();
        WebView firstView = new WebView(context);
        WebView secondView = new WebView(context);
        UserscriptRuntime first = new UserscriptRuntime(context, firstView, true);
        UserscriptRuntime second = new UserscriptRuntime(context, secondView, true);
        UserscriptRuntime normal = new UserscriptRuntime(context, firstView, false);
        try {
            Field field = UserscriptRuntime.class.getDeclaredField("storage");
            field.setAccessible(true);
            SharedPreferences privateValues = (SharedPreferences) field.get(first);
            SharedPreferences secondPrivateValues = (SharedPreferences) field.get(second);
            SharedPreferences ordinaryValues = (SharedPreferences) field.get(normal);
            assertTrue(privateValues instanceof MemoryPreferences);
            assertSame(privateValues, secondPrivateValues);
            assertFalse("a private script must not import an ordinary GM value", privateValues.contains(key));
            privateValues.edit().putString(key, "{\"private\":true}").commit();
            assertEquals("{\"private\":true}", secondPrivateValues.getString(key, null));
            assertEquals("{\"ordinary\":true}", ordinaryValues.getString(key, null));
            assertEquals("{\"ordinary\":true}", disk.getString(key, null));
            privateValues.edit().remove(key).apply();
        } finally {
            first.close();
            second.close();
            normal.close();
            firstView.destroy();
            secondView.destroy();
            disk.edit().remove(key).commit();
        }
    }

    @Test public void memoryPreferencesDoNotMutateTheirInputSets() {
        MemoryPreferences values = new MemoryPreferences();
        java.util.Set<String> input = new java.util.HashSet<>();
        input.add("private");
        values.edit().putStringSet("selection", input).apply();
        input.add("ordinary");
        assertEquals(java.util.Collections.singleton("private"), values.getStringSet("selection", null));
        values.getStringSet("selection", null).clear();
        assertEquals(java.util.Collections.singleton("private"), values.getStringSet("selection", null));
        values.edit().clear().apply();
        assertTrue(values.getAll().isEmpty());
    }
}
