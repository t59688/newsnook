package com.aizeek.newsnook;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LiveMediaObservationGateTest {
    private static JSONObject event(String url) throws Exception {
        return new JSONObject().put("source", "dom").put("pageUrl", "https://video.example/watch/1").put("url", url);
    }

    @Test public void suppressesExactDuplicatesButPublishesMetadataEnrichment() throws Exception {
        LiveMediaObservationGate gate = new LiveMediaObservationGate(4);
        JSONObject first = event("https://cdn.example/video");
        assertNotNull(gate.accept(first));
        assertNull(gate.accept(new JSONObject(first.toString())));
        JSONObject enriched = new JSONObject(first.toString()).put("mimeType", "video/mp4").put("width", 1920).put("height", 1080);
        assertNotNull(gate.accept(enriched));
        assertNull(gate.accept(new JSONObject(enriched.toString())));
    }

    @Test public void keepsTheIdentitySetBounded() throws Exception {
        LiveMediaObservationGate gate = new LiveMediaObservationGate(2);
        assertNotNull(gate.accept(event("https://cdn.example/one.mp4")));
        assertNotNull(gate.accept(event("https://cdn.example/two.mp4")));
        assertNull(gate.accept(event("https://cdn.example/three.mp4")));
        assertEquals(2, gate.size());
    }
}
