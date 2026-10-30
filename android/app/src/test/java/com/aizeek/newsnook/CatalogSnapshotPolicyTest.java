package com.aizeek.newsnook;

import static org.junit.Assert.*;
import org.junit.Test;

public class CatalogSnapshotPolicyTest {
    @Test public void acceptsOnlyCredentialFreeHttpUrlsAndSafeSessionIds() {
        assertTrue(CatalogSnapshotPolicy.isInitialUrlAllowed("https://catalog.example/items"));
        assertTrue(CatalogSnapshotPolicy.isInitialUrlAllowed("http://catalog.example/items"));
        assertFalse(CatalogSnapshotPolicy.isInitialUrlAllowed("https://user:secret@catalog.example/items"));
        assertFalse(CatalogSnapshotPolicy.isInitialUrlAllowed("file:///sdcard/page.html"));
        assertFalse(CatalogSnapshotPolicy.isInitialUrlAllowed("https:///missing-host"));

        assertTrue(CatalogSnapshotPolicy.isSessionIdAllowed("catalog_42.a-b:c"));
        assertFalse(CatalogSnapshotPolicy.isSessionIdAllowed(""));
        assertFalse(CatalogSnapshotPolicy.isSessionIdAllowed("catalog id"));
        assertFalse(CatalogSnapshotPolicy.isSessionIdAllowed("../catalog"));
    }

    @Test public void clampsBudgetsAndUsesContractDefaults() {
        assertEquals(8_000, CatalogSnapshotPolicy.timeoutMs(null));
        assertEquals(10_000, CatalogSnapshotPolicy.timeoutMs(60_000));
        assertEquals(8_000, CatalogSnapshotPolicy.timeoutMs(0));
        assertEquals(2 * 1024 * 1024, CatalogSnapshotPolicy.maxBytes(null));
        assertEquals(2 * 1024 * 1024, CatalogSnapshotPolicy.maxBytes(9 * 1024 * 1024));
        assertEquals(2 * 1024 * 1024, CatalogSnapshotPolicy.maxBytes(-1));
        assertEquals(64 * 1024, CatalogSnapshotPolicy.maxBytes(64 * 1024));
    }

    @Test public void normalizesOnlyWebViewTokensAndRejectsHeaderInjection() {
        String webView = "Mozilla/5.0 (Linux; Android 9; Pixel; wv) AppleWebKit/537.36 Version/4.0 Chrome/69.0 Mobile Safari/537.36";
        String normalized = CatalogSnapshotPolicy.normalizeUserAgent(webView);
        assertFalse(normalized.contains("; wv"));
        assertFalse(normalized.contains("Version/4.0"));
        assertTrue(normalized.contains("Chrome/69.0"));
        assertTrue(CatalogSnapshotPolicy.isUserAgentAllowed("NewsNook Catalog/1.0"));
        assertFalse(CatalogSnapshotPolicy.isUserAgentAllowed("safe\r\nInjected: value"));
    }

    @Test public void permitsSameRegistrableSiteRedirectsAndBlocksAdsOrExternalTargets() {
        String start = "https://www.catalog.example/items";
        assertFalse(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://m.catalog.example/filter?q=books", true, "GET"));
        assertFalse(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://catalog.example:443/items?page=2", true, "GET"));
        assertTrue(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://catalog.example.attacker.test/items", true, "GET"));
        assertTrue(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://doubleclick.net/redirect", true, "GET"));
        assertTrue(CatalogSnapshotPolicy.shouldBlockNavigation(start, "intent://catalog.example/items", true, "GET"));
        assertTrue(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://catalog.example/submit", true, "POST"));
        assertFalse(CatalogSnapshotPolicy.shouldBlockNavigation(start, "https://cdn.example/image.jpg", false, "GET"));
    }
}
