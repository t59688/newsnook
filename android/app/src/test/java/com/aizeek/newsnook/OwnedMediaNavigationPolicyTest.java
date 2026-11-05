package com.aizeek.newsnook;

import static org.junit.Assert.*;
import org.junit.Test;

public class OwnedMediaNavigationPolicyTest {
    @Test public void blocksExternalSchemesAdsAndUnknownMainFramePosts() {
        assertTrue(OwnedMediaNavigationPolicy.shouldBlock("intent://open/player", true, "GET"));
        assertTrue(OwnedMediaNavigationPolicy.shouldBlock("https://ads.example/preroll/1", true, "GET"));
        assertTrue(OwnedMediaNavigationPolicy.shouldBlock("https://video.example/submit", true, "POST"));
    }

    @Test public void preservesLegitimateCrossOriginPlayersAndCdnFrames() {
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://player.example/embed/42", true, "GET"));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://cdn.example/frame/42", false, "GET"));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("blob:https://player.example/id", false, "GET"));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("about:blank", true, "GET"));
    }
    @Test public void unrelatedCrossSiteRedirectCannotReplaceAnOwnedPlayer() {
        String current = "https://video.example/watch/42";
        assertTrue(OwnedMediaNavigationPolicy.shouldBlock("https://unrelated.example/landing?ref=42", true, "GET", current));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://player.example/player/index.php?id=42", true, "GET", current));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://cdn.example/frame/42", false, "GET", current));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://video.example/route?id=42", true, "GET", current));
    }
    @Test public void canonicalAndMobileAliasesStayWithinTheSameRegistrableSite() {
        String current = "https://video.example/v/42";
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://www.video.example/v/42", true, "GET", current));
        assertFalse(OwnedMediaNavigationPolicy.shouldBlock("https://m.video.example/detail?id=42", true, "GET", current));
        assertTrue(OwnedMediaNavigationPolicy.shouldBlock("https://video.example.attacker.test/detail?id=42", true, "GET", current));
    }
}
