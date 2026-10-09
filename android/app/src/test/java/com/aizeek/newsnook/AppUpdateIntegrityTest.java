package com.aizeek.newsnook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Test;

public class AppUpdateIntegrityTest {

    @Test
    public void normalizesSha256() {
        String hash = "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD";
        assertEquals(hash.toLowerCase(), AppUpdateIntegrity.normalizeSha256("sha256:" + hash));
        assertNull(AppUpdateIntegrity.normalizeSha256("not-a-hash"));
    }

    @Test
    public void verifiesSizeAndHash() throws Exception {
        File file = File.createTempFile("newsnook-update-", ".apk");
        try {
            Files.write(file.toPath(), "abc".getBytes(StandardCharsets.UTF_8));
            AppUpdateIntegrity.VerificationResult ok = AppUpdateIntegrity.verify(
                file,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                3L
            );
            assertTrue(ok.valid);

            AppUpdateIntegrity.VerificationResult badHash = AppUpdateIntegrity.verify(
                file,
                "0000000000000000000000000000000000000000000000000000000000000000",
                3L
            );
            assertFalse(badHash.valid);

            AppUpdateIntegrity.VerificationResult badSize = AppUpdateIntegrity.verify(file, null, 4L);
            assertFalse(badSize.valid);
        } finally {
            Files.deleteIfExists(file.toPath());
        }
    }
}
