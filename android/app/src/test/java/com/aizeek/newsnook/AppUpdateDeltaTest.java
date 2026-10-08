package com.aizeek.newsnook;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import com.nothome.delta.Delta;
import com.nothome.delta.GDiffWriter;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.util.zip.GZIPOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

/** End-to-end checks using the same GDIFF implementation as release CI. */
public class AppUpdateDeltaTest {

    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test
    public void reconstructsExactTargetFromCompressedDelta() throws Exception {
        Fixture fixture = fixture();
        File installed = tmp.newFile("rebuilt.apk");
        AppUpdateDelta.apply(
            fixture.source, fixture.patch, installed, sha(fixture.source), sha(fixture.patch),
            fixture.patch.length(), sha(fixture.target), fixture.target.length()
        );
        assertArrayEquals(Files.readAllBytes(fixture.target.toPath()), Files.readAllBytes(installed.toPath()));
    }

    @Test
    public void refusesWrongSourceAndLeavesNoOutput() throws Exception {
        Fixture fixture = fixture();
        File installed = new File(tmp.getRoot(), "invalid.apk");
        assertThrows(IOException.class, () -> AppUpdateDelta.apply(
            fixture.source, fixture.patch, installed, "0".repeat(64), sha(fixture.patch),
            fixture.patch.length(), sha(fixture.target), fixture.target.length()
        ));
        assertFalse(installed.exists());
    }

    @Test
    public void refusesCorruptPatchAndUnboundedOutput() throws Exception {
        Fixture fixture = fixture();
        File installed = new File(tmp.getRoot(), "invalid.apk");
        assertThrows(IOException.class, () -> AppUpdateDelta.apply(
            fixture.source, fixture.patch, installed, sha(fixture.source), "0".repeat(64),
            fixture.patch.length(), sha(fixture.target), fixture.target.length()
        ));
        assertThrows(IOException.class, () -> AppUpdateDelta.apply(
            fixture.source, fixture.patch, installed, sha(fixture.source), sha(fixture.patch),
            fixture.patch.length(), sha(fixture.target), fixture.target.length() - 1
        ));
        assertFalse(installed.exists());
        assertFalse(new File(tmp.getRoot(), "invalid.apk.partial").exists());
    }

    private Fixture fixture() throws Exception {
        File source = tmp.newFile("old.apk");
        File target = tmp.newFile("target.apk");
        byte[] old = new byte[65536];
        byte[] newer = new byte[65536 + 128];
        for (int i = 0; i < old.length; i++) old[i] = (byte) (i * 13);
        System.arraycopy(old, 0, newer, 0, old.length);
        for (int i = 30000; i < 31000; i++) newer[i] = (byte) (i * 7);
        for (int i = old.length; i < newer.length; i++) newer[i] = 42;
        Files.write(source.toPath(), old);
        Files.write(target.toPath(), newer);
        File raw = tmp.newFile("patch.gdiff");
        try (DataOutputStream stream = new DataOutputStream(new FileOutputStream(raw))) {
            GDiffWriter writer = new GDiffWriter(stream);
            new Delta().compute(source, target, writer);
            writer.flush();
        }
        File patch = tmp.newFile("patch.gdiff.gz");
        try (FileInputStream input = new FileInputStream(raw);
             GZIPOutputStream output = new GZIPOutputStream(new FileOutputStream(patch))) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        }
        return new Fixture(source, target, patch);
    }

    private String sha(File file) throws Exception {
        return AppUpdateIntegrity.sha256(file);
    }

    private static final class Fixture {
        final File source;
        final File target;
        final File patch;

        Fixture(File source, File target, File patch) {
            this.source = source;
            this.target = target;
            this.patch = patch;
        }
    }
}
