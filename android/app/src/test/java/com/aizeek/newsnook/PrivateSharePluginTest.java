package com.aizeek.newsnook;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class PrivateSharePluginTest {
    @org.robolectric.annotation.Implements(
        className = "androidx.core.content.FileProvider$SimplePathStrategy", isInAndroidSdk = false)
    public static class HostFileSeparators {
        @org.robolectric.annotation.Implementation
        protected boolean belongsToRoot(String filePath, String rootPath) {
            // AndroidX 1.18's method appends literal '/' to a canonical root. On Windows the
            // host JVM canonicalizes to '\\'. Adapt only this separator comparison; the real
            // XML parser, URI construction, traversal check and openFile still execute.
            String file = filePath.replace('\\', '/');
            String root = rootPath.replace('\\', '/');
            if (file.endsWith("/")) file = file.substring(0, file.length() - 1);
            if (root.endsWith("/")) root = root.substring(0, root.length() - 1);
            return file.startsWith(root + "/");
        }
    }

    @Test
    @Config(shadows = HostFileSeparators.class, instrumentedPackages = "androidx.core.content")
    public void privateUriResolvesToTheSameFileInTheOrdinaryProvider() throws Exception {
        Context base = RuntimeEnvironment.getApplication().getBaseContext();
        File folder = new File(base.getCacheDir(), PrivateBrowserSession.TEMP_DIRECTORY);
        assertTrue(folder.isDirectory() || folder.mkdirs());
        File image = new File(folder, "explicit-share-" + UUID.randomUUID() + ".png");
        byte[] content = "private export marker".getBytes(StandardCharsets.UTF_8);
        Files.write(image.toPath(), content);
        try {
            JSArray files = new JSArray();
            files.put(Uri.fromFile(image).toString());
            Intent share = PrivateSharePlugin.buildShareIntent(base, new JSObject().put("files", files));
            Uri uri = share.getParcelableExtra(Intent.EXTRA_STREAM);
            assertNotNull(uri);
            assertEquals(base.getPackageName() + ".privatefileprovider", uri.getAuthority());
            assertEquals("private_cache", uri.getPathSegments().get(0));
            assertEquals(Intent.FLAG_GRANT_READ_URI_PERMISSION,
                share.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertEquals(uri, share.getClipData().getItemAt(0).getUri());

            ProviderInfo info = base.getPackageManager().resolveContentProvider(uri.getAuthority(), PackageManager.GET_META_DATA);
            assertNotNull("the narrow export provider must be declared", info);
            PrivateBrowserFileProvider provider = new PrivateBrowserFileProvider();
            provider.attachInfo(base, info);
            try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(provider.openFile(uri, "r"))) {
                assertArrayEquals(content, input.readAllBytes());
            }
        } finally { Files.deleteIfExists(image.toPath()); }
    }

    @Test public void privateShareRejectsOrdinaryApplicationFiles() throws Exception {
        Context base = RuntimeEnvironment.getApplication().getBaseContext();
        File ordinary = new File(base.getCacheDir(), "ordinary-" + UUID.randomUUID() + ".png");
        Files.write(ordinary.toPath(), new byte[] { 1, 2, 3 });
        try {
            JSArray files = new JSArray();
            files.put(Uri.fromFile(ordinary).toString());
            try {
                PrivateSharePlugin.buildShareIntent(base, new JSObject().put("files", files));
                fail("a private share must never grant an ordinary application file");
            } catch (java.io.IOException expected) {
                assertTrue(expected.getMessage().contains("outside"));
            }
        } finally { Files.deleteIfExists(ordinary.toPath()); }
    }

    @Test public void explicitTextShareNeedsNoFileGrant() throws Exception {
        Context base = RuntimeEnvironment.getApplication().getBaseContext();
        Intent intent = PrivateSharePlugin.buildShareIntent(base,
            new JSObject().put("text", "Article").put("url", "https://example.com/article"));
        assertEquals("Article https://example.com/article", intent.getStringExtra(Intent.EXTRA_TEXT));
        assertEquals(Intent.ACTION_SEND, intent.getAction());
        assertNull(intent.getClipData());
        assertEquals(0, intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
}
