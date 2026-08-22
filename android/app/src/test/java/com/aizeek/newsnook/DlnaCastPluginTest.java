package com.aizeek.newsnook;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 33)
public class DlnaCastPluginTest {

    @Test
    public void android16LocalNetworkProtectionEpermIsRecognized() {
        IOException error = new IOException(
            "sendto failed: EPERM (Operation not permitted)"
        );

        assertTrue(DlnaCastPlugin.isLocalNetworkPermissionError(error));
    }

    @Test
    public void nestedLocalNetworkProtectionErrorIsRecognized() {
        IOException error = new IOException(
            "SSDP discovery failed",
            new IOException("sendto failed: ECONNABORTED (Operation not permitted)")
        );

        assertTrue(DlnaCastPlugin.isLocalNetworkPermissionError(error));
    }

    @Test
    public void tcpPermissionFailureIsRecognized() {
        IOException error = new IOException(
            "connect failed: EACCES (Permission denied)"
        );

        assertTrue(DlnaCastPlugin.isLocalNetworkPermissionError(error));
    }

    @Test
    public void ordinaryDiscoveryFailureIsNotReportedAsPermissionFailure() {
        IOException error = new IOException("Network is unreachable");

        assertFalse(DlnaCastPlugin.isLocalNetworkPermissionError(error));
    }
}
