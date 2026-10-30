package com.aizeek.newsnook;

import static org.junit.Assert.*;
import org.junit.Test;

public class CatalogSnapshotScriptTest {
    @Test public void fixedProbeClonesLiveFormStateWithoutPasswordValues() {
        String script = CatalogSnapshotScript.PROBE;
        assertTrue(script.contains("cloneNode(true)"));
        assertTrue(script.contains("source.value"));
        assertTrue(script.contains("source.checked"));
        assertTrue(script.contains("source.selected"));
        assertTrue(script.contains("type === 'password'"));
        assertTrue(script.contains("removeAttribute('value')"));
        assertTrue(script.contains("location.href"));
        assertFalse(script.contains("=>"));
        assertFalse(script.contains("?."));
        assertFalse(script.contains("`"));
    }

    @Test public void staleNavigationEpochCannotCompleteReplacementOperation() {
        assertTrue(CatalogSnapshotPlugin.acceptsSnapshot(7L, 7L, "session-a", "session-a"));
        assertFalse(CatalogSnapshotPlugin.acceptsSnapshot(7L, 8L, "session-a", "session-a"));
        assertFalse(CatalogSnapshotPlugin.acceptsSnapshot(7L, 7L, "session-a", "session-b"));
    }
}
