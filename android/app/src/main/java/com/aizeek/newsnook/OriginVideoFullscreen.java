package com.aizeek.newsnook;

import android.graphics.Color;
import android.content.pm.ActivityInfo;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.widget.FrameLayout;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import java.util.function.Consumer;

/** Hosts the browser's custom video view independently of the inline WebView bounds. */
final class OriginVideoFullscreen extends WebChromeClient {
    private final ComponentActivity activity;
    private final FrameLayout host;
    private final Consumer<Boolean> immersive;
    private FrameLayout surface;
    private CustomViewCallback callback;
    private OnBackPressedCallback back;
    private int previousOrientation;

    OriginVideoFullscreen(ComponentActivity activity, FrameLayout host, Consumer<Boolean> immersive) {
        this.activity = activity;
        this.host = host;
        this.immersive = immersive;
    }

    @Override public boolean onCreateWindow(
        WebView view,
        boolean isDialog,
        boolean isUserGesture,
        Message resultMsg
    ) {
        // This chrome client is installed only on the owned sniff/live surface.
        // Popups are never handed to another browser or WebView.
        return false;
    }

    @Override public void onShowCustomView(View view, CustomViewCallback callback) {
        if (surface != null) {
            callback.onCustomViewHidden();
            return;
        }
        this.callback = callback;
        previousOrientation = activity.getRequestedOrientation();
        surface = new FrameLayout(activity);
        surface.setBackgroundColor(Color.BLACK);
        surface.setKeepScreenOn(true);
        surface.setClickable(true);
        surface.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        host.addView(surface, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        back = new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { onHideCustomView(); }
        };
        activity.getOnBackPressedDispatcher().addCallback(back);
        immersive.accept(true);
        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        surface.requestFocus();
    }

    @Override public void onHideCustomView() {
        if (surface == null) return;
        CustomViewCallback hidden = callback;
        callback = null;
        back.remove();
        back = null;
        surface.setKeepScreenOn(false);
        surface.removeAllViews();
        host.removeView(surface);
        surface = null;
        activity.setRequestedOrientation(previousOrientation);
        immersive.accept(false);
        hidden.onCustomViewHidden();
    }
}
