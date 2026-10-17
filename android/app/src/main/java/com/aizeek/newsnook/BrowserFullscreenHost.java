package com.aizeek.newsnook;

/** Window contract shared by the ordinary app and the isolated browser Activity. */
interface BrowserFullscreenHost {
    void setVideoFullscreen(boolean active);
}
