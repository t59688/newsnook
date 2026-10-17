package com.aizeek.newsnook;

import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Retain Capacitor's WebChromeClient (file chooser, JS dialogs and permissions)
 * while making HTML5 video fullscreen work in the MAIN WebView. Linux.do post
 * iframe players live in this WebView, not in the media-sniffer's live WebView.
 */
final class NewsNookWebChromeClient extends BridgeWebChromeClient {
    private final OriginVideoFullscreen fullscreen;
    private final boolean privateSession;

    NewsNookWebChromeClient(Bridge bridge, androidx.appcompat.app.AppCompatActivity activity) {
        super(bridge);
        privateSession = activity instanceof PrivateBrowserActivity;
        View content = activity.findViewById(android.R.id.content);
        if (!(content instanceof FrameLayout)) {
            throw new IllegalStateException("Activity content must host fullscreen video");
        }
        FrameLayout host = (FrameLayout) content;
        BrowserFullscreenHost window = (BrowserFullscreenHost) activity;
        fullscreen = new OriginVideoFullscreen(activity, host, window::setVideoFullscreen);
    }

    @Override public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
        return privateSession || super.onConsoleMessage(message);
    }

    @Override
    public void onShowCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        fullscreen.onShowCustomView(view, callback);
    }

    @Override
    public void onHideCustomView() {
        fullscreen.onHideCustomView();
    }

    void release() {
        onHideCustomView();
    }
}
