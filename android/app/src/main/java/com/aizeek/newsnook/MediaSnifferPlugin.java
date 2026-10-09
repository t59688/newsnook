package com.aizeek.newsnook;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.graphics.Outline;
import android.net.Uri;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewOutlineProvider;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.annotation.NonNull;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Collections;
import java.util.Arrays;
import java.util.HashSet;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Proxy;
import okhttp3.Authenticator;
import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.Credentials;
import okhttp3.HttpUrl;
import okhttp3.Interceptor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.Route;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * 在短生命周期、无界面的 WebView 中观察网页自己产生的媒体拓扑。
 * 只收集 URL/类型信号，不代理响应、不注入凭证、不接管 DRM 授权。
 */
@CapacitorPlugin(name = "MediaSniffer")
public class MediaSnifferPlugin extends Plugin {

    private interface ObservationEmitter {
        void emit(JSONObject observation);
    }

    private static final int MIN_TIMEOUT_MS = 1500;
    private static final int MAX_TIMEOUT_MS = 12000;
    private static final int QUIET_MS = 800;
    private static final int POLL_INTERVAL_MS = 200;
    private static final int MAX_NETWORK_EVENTS = 256;
    private static final int MAX_BODY_TEXT_BYTES = 262144;
    private static final long PLAYBACK_CONTEXT_TTL_MS = 10 * 60 * 1000L;
    private static final ConcurrentHashMap<String, PlaybackContext> PLAYBACK_CONTEXTS =
        new ConcurrentHashMap<>();
    private static final Set<String> SAFE_REQUEST_HEADERS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "accept", "accept-language", "origin", "referer", "user-agent"
        ))
    );

    /** Visible, long-lived origin player surface (at most one). */
    private String liveSessionId;
    private WebView liveWebView;
    private FrameLayout liveHost;
    private ScriptHandler liveScriptHandler;
    private JSONArray liveNetworkEvents;
    private LiveProbeQueue liveProbeQueue;
    private final AtomicBoolean liveActive = new AtomicBoolean(false);
    /** Entry URL/referrer; blank-fallback reload uses these when MUTE_AUDIO is unavailable. */
    private String liveEntryUrl;
    private String liveReferrer;
    private boolean liveSuspended;
    /** True when hide had to navigate to about:blank (no WebView-level mute). */
    private boolean liveBlanked;

    private static final String PROBE_SCRIPT_TEMPLATE = """
        (() => {
          if (window.__newsnookMediaProbeInstalled) return;
          window.__newsnookMediaProbeInstalled = true;
          const nonce = '__NEWSNOOK_SESSION_NONCE__';
          const maxBodyText = __NEWSNOOK_MAX_BODY_TEXT__;
          if (window.__newsnookLastHighValueAt == null) window.__newsnookLastHighValueAt = 0;
          const events = window.__newsnookMediaEvents = [];
          const seen = new Set();
          const inspectedPayloads = new WeakSet();
          const inspectedScripts = new WeakSet();
          const isHighValue = (event) => {
            // Progressive mp4/webm often arrives as preroll. Arming quiet-exit on
            // it ends the session before the real HLS/DASH request. Only
            // manifests, MSE, and player JSON count as completion signals.
            if (!event || event.source === 'performance') return false;
            const mime = String(event.mimeType || event.mseMimeType || '').toLowerCase();
            const url = String(event.url || '').toLowerCase();
            if (mime.includes('mpegurl') || mime.includes('dash+xml') || mime.includes('vnd.apple.mpegurl')) return true;
            if (/\\.(?:m3u8|mpd)(?:[?#]|$)/.test(url)) return true;
            if (event.source === 'mse' && event.mseMimeType) return true;
            if ((event.source === 'fetch' || event.source === 'xhr') && event.bodyText && looksLikePlayerJson(event.bodyText)) return true;
            if (event.source === 'static' && event.url && /\\.(?:m3u8|mpd)(?:[?#]|$)/i.test(String(event.url))) return true;
            return false;
          };
          const push = (event) => {
            try {
              const key = [event.source, event.url || '', event.mimeType || '', event.drmKeySystem || '', event.bodyText ? 'body' : ''].join('|');
              if (seen.has(key)) return;
              seen.add(key);
              const observation = { pageUrl: location.href, timestamp: Date.now(), sessionNonce: nonce, ...event };
              const priority = (item) => {
                const mime = String(item.mimeType || item.mseMimeType || '').toLowerCase();
                const url = String(item.url || '').toLowerCase();
                if (/^(video|audio)\\//.test(mime) || /mpegurl|dash\\+xml/.test(mime) || /\\.(m3u8|mpd)(?:[?#]|$)/.test(url)) return 3;
                if (/\\.(m4s|ts)(?:[?#]|$)/.test(url)) return 1;
                if (/\\.(js|css|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)(?:[?#]|$)/.test(url)) return 0;
                return 2;
              };
              if (events.length >= 256) {
                let lowest = 4, lowestIndex = -1;
                events.forEach((item, index) => { const value = priority(item); if (value < lowest) { lowest = value; lowestIndex = index; } });
                if (lowestIndex < 0 || priority(observation) <= lowest) return;
                events.splice(lowestIndex, 1);
              }
              events.push(observation);
              if (isHighValue(observation)) window.__newsnookLastHighValueAt = Date.now();
              if (window !== window.top) window.top.postMessage({ __newsnookMediaObservation: observation, nonce }, '*');
              return observation;
            } catch (_) { return undefined; }
          };
          if (window === window.top) window.addEventListener('message', (message) => {
            try {
              if (!message.data || message.data.nonce !== nonce) return;
              const observation = message.data.__newsnookMediaObservation;
              if (observation && typeof observation === 'object') push({ ...observation, fromIframe: true });
            } catch (_) {}
          });
          const looksMediaUrl = (value) => {
            const url = String(value || '');
            if (!url || url.startsWith('blob:')) return url.startsWith('blob:');
            return /\\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|m4a|aac|mp3|ogg|opus|m4s|ts|cmfv|cmfa)(?:[?#]|$)/i.test(url);
          };
          const looksLikePlayerJson = (text) => {
            const trimmed = String(text || '').trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
            return /"(?:url|playurl|play_url|manifestUrl|hlsmanifesturl|dashmanifesturl|manifest_url|video_url|media_url|backupUrl|backup_url|file)"\\s*:/i.test(trimmed)
              || /"(?:video|audio|stream|streams|playinfo|player)"\\s*:/i.test(trimmed);
          };
          const triggerPlayback = () => {
            if (window.__newsnookPlaybackTriggered) return;
            try {
              const playPattern = /play|watch|观看|播放/i;
              const candidates = [];
              document.querySelectorAll('button,[role="button"]').forEach((el) => {
                const text = (el.textContent || '').trim();
                const label = [text, el.getAttribute('aria-label') || '', el.getAttribute('title') || ''].join(' ');
                if (playPattern.test(label)) candidates.push({ priority: 0, element: el });
              });
              document.querySelectorAll('a[href]').forEach((el) => {
                const href = el.getAttribute('href') || '';
                try {
                  const target = new URL(href, location.href);
                  if (target.origin !== location.origin) return;
                  if (/\\/(?:play|watch|vodplay|player|embed|video\\/play)(?:[/?#]|$)/i.test(target.pathname + target.search + target.hash)) candidates.push({ priority: 1, element: el });
                } catch (_) {}
              });
              document.querySelectorAll('iframe[src],iframe[data-src]').forEach((el) => {
                const raw = el.getAttribute('src') || el.getAttribute('data-src') || '';
                try {
                  const target = new URL(raw, location.href);
                  if (/\\/(?:player|embed|play|watch)(?:[/?#]|$)/i.test(target.pathname + target.search + target.hash)) candidates.push({ priority: 2, element: el });
                } catch (_) {}
              });
              const candidate = candidates.sort((left, right) => left.priority - right.priority)[0];
              if (!candidate) return;
              window.__newsnookPlaybackTriggered = true;
              try { candidate.element.click(); } catch (_) {}
            } catch (_) {}
          };
          const positiveNumber = (value) => {
            const number = Number(value);
            return Number.isFinite(number) && number > 0 ? number : undefined;
          };
          const inspectPayload = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 12 || inspectedPayloads.has(value)) return;
            inspectedPayloads.add(value);
            if (Array.isArray(value)) {
              value.forEach((item) => inspectPayload(item, depth + 1));
              return;
            }
            try {
              const url = [value.url, value.contentUrl, value.playbackUrl, value.src, value.baseUrl, value.base_url, value.playurl, value.play_url, value.backupUrl, value.backup_url, value.manifestUrl]
                .find((item) => typeof item === 'string' && item);
              const mimeType = [value.mimeType, value.contentType, value.mime]
                .find((item) => typeof item === 'string');
              // 图片 URL（favicon/logo/海报）不是可播放媒体，宽度高度不构成视频信号
              const pathOnly = String(url).split('?')[0].split('#')[0];
              const isImagePath = /\\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/i.test(pathOnly);
              if (url && !isImagePath) {
                const codecText = `${mimeType || ''} ${typeof value.codecs === 'string' ? value.codecs : ''}`;
                const width = positiveNumber(value.width);
                const height = positiveNumber(value.height);
                const hasVideo = Boolean(value.qualityLabel || /^video\\//i.test(mimeType || '') || /(?:avc1|av01|hvc1|hev1|vp0?9|vp8)/i.test(codecText));
                const hasAudio = Boolean(value.audioQuality || value.audioSampleRate || value.audioChannels || /^audio\\//i.test(mimeType || '') || /(?:mp4a|aac|opus|vorbis|ac-3|ec-3)/i.test(codecText));
                if (looksMediaUrl(url) || mimeType || hasVideo || hasAudio) {
                  push({
                    source: 'static',
                    url,
                    mimeType,
                    codecs: typeof value.codecs === 'string' ? value.codecs : undefined,
                    mediaKind: /^audio\\//i.test(mimeType || '') ? 'audio' : hasVideo ? 'video' : undefined,
                    hasAudio: hasAudio ? true : hasVideo && value.qualityLabel ? false : undefined,
                    hasVideo: hasVideo || undefined,
                    width,
                    height,
                    bitrate: positiveNumber(value.bitrate),
                  });
                }
              }
            } catch (_) {}
            try { Object.values(value).forEach((item) => inspectPayload(item, depth + 1)); } catch (_) {}
          };
          const inspectPlayerState = () => {
            try { inspectPayload(window.ytInitialPlayerResponse); } catch (_) {}
            try { inspectPayload(window.__playinfo__); } catch (_) {}
            // Embedded YouTube currently places the authoritative player
            // response under ytcfg.PLAYER_VARS rather than the older
            // ytplayer.config.args.player_response path.
            try {
              const playerVars = window.ytcfg?.get?.('PLAYER_VARS');
              const embeddedResponse = playerVars?.embedded_player_response || playerVars?.player_response;
              if (typeof embeddedResponse === 'string') inspectPayload(JSON.parse(embeddedResponse));
              else inspectPayload(embeddedResponse);
            } catch (_) {}
            try {
              const playerResponse = window.ytplayer?.config?.args?.player_response;
              if (typeof playerResponse === 'string') inspectPayload(JSON.parse(playerResponse));
              else inspectPayload(playerResponse);
            } catch (_) {}
            try {
              document.querySelectorAll('script[type="application/ld+json"],script[type="application/json"]').forEach((script) => {
                try { inspectPayload(JSON.parse(script.textContent || '')); } catch (_) {}
              });
            } catch (_) {}
          };
          const inspect = (node) => {
            if (!(node instanceof Element)) return;
            const nodes = node.matches('video,audio,source') ? [node] : node.querySelectorAll('video,audio,source');
            for (const media of nodes) {
              const url = media.currentSrc || media.src || media.getAttribute('data-src') || media.getAttribute('data-video-src');
              if (url) push({ source: 'dom', url, mimeType: media.getAttribute('type') || undefined, mediaKind: media.tagName === 'AUDIO' ? 'audio' : media.tagName === 'VIDEO' ? 'video' : undefined });
              if (media.srcObject) push({ source: 'mse', url: media.currentSrc || 'blob:', mseMimeType: 'srcObject' });
              if (media instanceof HTMLMediaElement) {
                try {
                  media.muted = true;
                  const playback = media.play();
                  if (playback?.catch) playback.catch(() => {});
                } catch (_) {}
              }
            }
          };
          const inspectScriptPayloads = () => {
            try {
              document.querySelectorAll('script').forEach((script) => {
                if (inspectedScripts.has(script)) return;
                inspectedScripts.add(script);
                const text = script.textContent || '';
                if (!text || text.length > maxBodyText) return;
                for (const match of text.matchAll(/https?:\\\\?\\/\\\\?\\/[^\\s"'<>]+/gi)) {
                  const url = match[0]
                    .replace(/\\\\\\//g, '/')
                    .replace(/\\\\u0026/gi, '&')
                    .replace(/[),;]+$/g, '');
                  if (looksMediaUrl(url)) push({ source: 'static', url });
                }
              });
            } catch (_) {}
          };
          const scan = () => {
            inspect(document.documentElement);
            inspectPlayerState();
            inspectScriptPayloads();
            try {
              for (const entry of performance.getEntriesByType('resource')) {
                if (looksMediaUrl(entry.name)) push({ source: 'performance', url: entry.name });
              }
            } catch (_) {}
          };
          const startDom = () => {
            scan();
            setTimeout(triggerPlayback, 400);
            setTimeout(triggerPlayback, 1200);
            try {
              new MutationObserver((records) => records.forEach((record) => {
                inspect(record.target);
                if (record.target?.tagName === 'SCRIPT') inspectScriptPayloads();
                record.addedNodes.forEach(inspect);
                record.addedNodes.forEach((node) => { if (node?.tagName === 'SCRIPT') inspectScriptPayloads(); });
              })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'data-src', 'data-video-src'] });
              document.addEventListener('play', (event) => inspect(event.target), true);
              document.addEventListener('loadedmetadata', (event) => inspect(event.target), true);
              document.addEventListener('encrypted', () => push({ source: 'mse', drmKeySystem: 'encrypted-media' }), true);
            } catch (_) {}
          };
          if (document.documentElement) startDom();
          else document.addEventListener('DOMContentLoaded', startDom, { once: true });

          try {
            const originalFetch = window.fetch;
            window.fetch = async function(...args) {
              const response = await originalFetch.apply(this, args);
              try {
                const mimeType = response.headers.get('content-type') || undefined;
                const event = { source: 'fetch', url: response.url || String(args[0]), mimeType, statusCode: response.status };
                const mime = String(mimeType || '').toLowerCase();
                if (/json|text\\/plain|javascript/.test(mime)) {
                  const lengthHeader = response.headers.get('content-length');
                  const reported = lengthHeader == null || lengthHeader === '' ? NaN : Number(lengthHeader);
                  if (!Number.isFinite(reported) || reported <= maxBodyText) {
                    try {
                      const text = await response.clone().text();
                      if (text && text.length <= maxBodyText && looksLikePlayerJson(text)) event.bodyText = text;
                    } catch (_) {}
                  }
                }
                push(event);
              } catch (_) {}
              return response;
            };
          } catch (_) {}
          try {
            const open = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, ...rest) {
              this.__newsnookUrl = String(url);
              this.__newsnookMethod = method;
              this.addEventListener('loadend', () => {
                let mimeType;
                try { mimeType = this.getResponseHeader('content-type') || undefined; } catch (_) {}
                const event = { source: 'xhr', url: this.responseURL || this.__newsnookUrl, method: this.__newsnookMethod, mimeType, statusCode: this.status };
                try {
                  const responseType = this.responseType;
                  if (!responseType || responseType === 'text' || responseType === 'json') {
                    let text;
                    if (responseType === 'json') {
                      text = typeof this.response === 'string' ? this.response : JSON.stringify(this.response);
                    } else {
                      text = this.responseText;
                    }
                    if (typeof text === 'string' && text.length > 0 && text.length <= maxBodyText && looksLikePlayerJson(text)) event.bodyText = text;
                  }
                } catch (_) {}
                push(event);
              }, { once: true });
              return open.call(this, method, url, ...rest);
            };
          } catch (_) {}
          try {
            const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
            MediaSource.prototype.addSourceBuffer = function(mimeType) {
              if (!this.__newsnookMediaSessionId) this.__newsnookMediaSessionId = `mse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              push({ source: 'mse', mseMimeType: String(mimeType), mediaSessionId: this.__newsnookMediaSessionId });
              return addSourceBuffer.call(this, mimeType);
            };
          } catch (_) {}
          try {
            const requestKeySystem = navigator.requestMediaKeySystemAccess?.bind(navigator);
            if (requestKeySystem) navigator.requestMediaKeySystemAccess = function(keySystem, configurations) {
              push({ source: 'mse', drmKeySystem: String(keySystem), mediaSessionId: `eme-${String(keySystem)}` });
              return requestKeySystem(keySystem, configurations);
            };
          } catch (_) {}
          try {
            new PerformanceObserver((list) => list.getEntries().forEach((entry) => {
              if (looksMediaUrl(entry.name)) push({ source: 'performance', url: entry.name });
            })).observe({ type: 'resource', buffered: true });
          } catch (_) {}
          window.__newsnookCollectMedia = () => { scan(); return events; };
        })();
        """;

    private static String buildProbeScript(String nonce) {
        return PROBE_SCRIPT_TEMPLATE
            .replace("__NEWSNOOK_SESSION_NONCE__", nonce)
            .replace("__NEWSNOOK_MAX_BODY_TEXT__", Integer.toString(MAX_BODY_TEXT_BYTES));
    }

    @PluginMethod
    public void sniff(PluginCall call) {
        String url = call.getString("url");
        if (!isAllowedPageUrl(url)) {
            call.reject("仅支持 HTTP/HTTPS 原文地址");
            return;
        }
        int requestedTimeout = call.getInt("timeoutMs", 6000);
        int timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, requestedTimeout));
        String referrer = call.getString("referrer");
        if (!isAllowedPageUrl(referrer)) referrer = null;
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.trim().isEmpty()) sessionId = UUID.randomUUID().toString();
        String finalReferrer = referrer;
        String finalSessionId = sessionId;
        getActivity().runOnUiThread(() -> startSniff(call, url, timeoutMs, finalReferrer, finalSessionId));
    }

    @PluginMethod
    public void preparePlayback(PluginCall call) {
        String url = call.getString("url");
        String sourcePage = call.getString("sourcePage");
        if (sourcePage != null && !isAllowedPageUrl(sourcePage)) sourcePage = null;
        boolean opaque = isOpaquePlaybackUrl(url);
        if (opaque) {
            if (sourcePage == null) {
                call.reject("媒体地址无效");
                return;
            }
        } else if (!isAllowedPageUrl(url)) {
            call.reject("媒体地址无效");
            return;
        }
        String format = call.getString("format", "progressive");
        boolean intercept = call.getBoolean("intercept", true);
        JSObject headersObject = call.getObject("headers");
        Map<String, String> jsHeaders = new HashMap<>();
        if (headersObject != null) {
            Iterator<String> keys = headersObject.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headersObject.getString(key);
                if (value != null && SAFE_REQUEST_HEADERS.contains(key.toLowerCase(Locale.ROOT))) {
                    jsHeaders.put(key, value);
                }
            }
        }
        OkHttpClient client = intercept ? createPlaybackClient(call.getObject("proxy")) : null;
        if (!opaque) {
            registerPlaybackContext(url, format, intercept, false, jsHeaders, sourcePage, client);
        }
        if (intercept) {
            Set<String> seeds = new HashSet<>();
            JSArray origins = call.getArray("origins");
            if (origins != null) {
                for (int index = 0; index < origins.length(); index += 1) {
                    String origin = origins.optString(index, "");
                    if (origin != null && !origin.isEmpty()) seeds.add(origin);
                }
            }
            seeds.addAll(OriginHeaderStore.notedOrigins());
            for (String origin : seeds) {
                if (origin == null || origin.isEmpty()) continue;
                String seed = origin.endsWith("/") ? origin : origin + "/";
                if (!isAllowedPageUrl(seed)) continue;
                registerPlaybackContext(seed, format, true, true, jsHeaders, sourcePage, client);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void getStreamProxyPort(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("port", LocalStreamProxy.getInstance().getPort());
            call.resolve(result);
        } catch (IOException error) {
            call.reject("无法启动本地视频代理", error);
        }
    }

    @PluginMethod
    public void startLiveSession(PluginCall call) {
        String url = call.getString("url");
        if (!isAllowedPageUrl(url)) {
            call.reject("仅支持 HTTP/HTTPS 原文地址");
            return;
        }
        String referrer = call.getString("referrer");
        if (!isAllowedPageUrl(referrer)) referrer = null;
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.trim().isEmpty()) sessionId = UUID.randomUUID().toString();
        String finalReferrer = referrer;
        String finalSessionId = sessionId;
        getActivity().runOnUiThread(() -> startLiveSessionOnUi(call, url, finalReferrer, finalSessionId));
    }

    @PluginMethod
    public void stopLiveSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        getActivity().runOnUiThread(() -> {
            stopLiveSessionOnUi(sessionId);
            call.resolve();
        });
    }

    @PluginMethod
    public void setLiveSessionVisible(PluginCall call) {
        boolean visible = call.getBoolean("visible", true);
        getActivity().runOnUiThread(() -> {
            setLiveSessionVisibleOnUi(visible);
            call.resolve();
        });
    }

    /**
     * Hide does not destroy the live session (「返回原站播放器」 / 403 旁路仍可保留).
     * Prefer WebView-level mute + pause so the document stays; blank only as fallback.
     */
    private void setLiveSessionVisibleOnUi(boolean visible) {
        WebView webView = liveWebView;
        if (webView == null) return;
        if (visible) {
            if (liveSuspended) {
                liveSuspended = false;
                webView.onResume();
                setLiveWebViewAudioMuted(webView, false);
                if (liveBlanked) {
                    liveBlanked = false;
                    reloadLiveEntry(webView);
                }
            }
            webView.setVisibility(View.VISIBLE);
            return;
        }
        pauseLiveSessionMedia(webView);
        liveSuspended = true;
        boolean muted = setLiveWebViewAudioMuted(webView, true);
        if (!muted) {
            // Old WebView builds: cross-origin player iframes ignore same-doc pause().
            liveBlanked = true;
            webView.loadUrl("about:blank");
        } else {
            liveBlanked = false;
        }
        webView.onPause();
        webView.setVisibility(View.GONE);
    }

    private static boolean setLiveWebViewAudioMuted(WebView webView, boolean muted) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)) return false;
        try {
            WebViewCompat.setAudioMuted(webView, muted);
            return true;
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private void reloadLiveEntry(WebView webView) {
        String url = liveEntryUrl;
        if (url == null || url.trim().isEmpty()) return;
        String referrer = liveReferrer;
        if (referrer == null || referrer.trim().isEmpty()) {
            webView.loadUrl(url);
            return;
        }
        Map<String, String> navigationHeaders = new HashMap<>();
        navigationHeaders.put("Referer", referrer);
        webView.loadUrl(url, navigationHeaders);
    }

    private static void pauseLiveSessionMedia(WebView webView) {
        webView.evaluateJavascript(
            "(function(){try{"
                + "var pauseAll=function(doc){"
                + "if(!doc)return;"
                + "doc.querySelectorAll('video,audio').forEach(function(m){"
                + "try{m.pause()}catch(e){}"
                + "try{m.muted=true}catch(e){}"
                + "});"
                + "};"
                + "pauseAll(document);"
                + "document.querySelectorAll('iframe').forEach(function(frame){"
                + "try{pauseAll(frame.contentDocument)}catch(e){}"
                + "});"
                + "}catch(e){}})();",
            null
        );
    }

    /**
     * Align the live origin WebView to the Reader media slot.
     * Coordinates are CSS pixels relative to the Capacitor WebView viewport
     * (same space as Element.getBoundingClientRect()).
     */
    @PluginMethod
    public void setLiveSessionBounds(PluginCall call) {
        Double x = call.getDouble("x");
        Double y = call.getDouble("y");
        Double width = call.getDouble("width");
        Double height = call.getDouble("height");
        Double cornerRadius = call.getDouble("cornerRadius", 0d);
        if (x == null || y == null || width == null || height == null) {
            call.reject("x/y/width/height required");
            return;
        }
        final double cssX = x;
        final double cssY = y;
        final double cssW = width;
        final double cssH = height;
        final double cssRadius = cornerRadius == null ? 0d : Math.max(0d, cornerRadius);
        getActivity().runOnUiThread(() -> {
            applyLiveSessionBoundsOnUi(cssX, cssY, cssW, cssH, cssRadius);
            call.resolve();
        });
    }

    static void clearPlaybackContexts() {
        PLAYBACK_CONTEXTS.clear();
    }

    static void registerPlaybackContext(
        String url,
        String format,
        boolean intercept,
        boolean extraOrigin,
        Map<String, String> jsHeaders,
        String sourcePage,
        OkHttpClient client
    ) {
        String origin = OriginHeaderStore.originOf(url);
        if (!intercept) {
            if (origin != null) PLAYBACK_CONTEXTS.entrySet().removeIf(entry -> origin.equals(entry.getValue().origin));
            purgePlaybackContexts();
            return;
        }
        if (origin == null) return;
        Map<String, String> headers = jsHeaders == null ? Collections.emptyMap() : jsHeaders;
        OkHttpClient playbackClient = client == null ? new OkHttpClient() : client;
        long expiresAt = System.currentTimeMillis() + PLAYBACK_CONTEXT_TTL_MS;
        PlaybackContext context = new PlaybackContext(
            url,
            format,
            extraOrigin,
            headers,
            sourcePage,
            playbackClient,
            expiresAt
        );
        PLAYBACK_CONTEXTS.put(UUID.randomUUID().toString(), context);
        purgePlaybackContexts();
    }

    private static boolean hasHeader(Map<String, String> headers, String target) {
        for (String key : headers.keySet()) {
            if (target.equalsIgnoreCase(key)) return true;
        }
        return false;
    }

    private static OkHttpClient createPlaybackClient(JSObject proxyObject) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .cookieJar(new WebViewCookieJar());
        if (proxyObject == null) return builder.build();

        String host = proxyObject.getString("host");
        int port = proxyObject.optInt("port", -1);
        if (host == null || host.isEmpty() || port <= 0) return builder.build();
        String type = proxyObject.getString("type", "http");
        Proxy.Type proxyType = "socks5".equalsIgnoreCase(type) ? Proxy.Type.SOCKS : Proxy.Type.HTTP;
        builder.proxy(new Proxy(proxyType, new InetSocketAddress(host, port)));

        String username = proxyObject.getString("username");
        String password = proxyObject.getString("password", "");
        if (username != null && !username.isEmpty()) {
            builder.proxyAuthenticator(new Authenticator() {
                @Override
                public Request authenticate(Route route, Response response) {
                    if (response.request().header("Proxy-Authorization") != null) return null;
                    return response.request().newBuilder()
                        .header("Proxy-Authorization", Credentials.basic(username, password))
                        .build();
                }
            });
        }
        return builder.build();
    }

    private static final class WebViewCookieJar implements CookieJar {
        @Override
        public void saveFromResponse(@NonNull HttpUrl url, @NonNull List<Cookie> cookies) {
            CookieManager manager = CookieManager.getInstance();
            for (Cookie cookie : cookies) manager.setCookie(url.toString(), cookie.toString());
        }

        @NonNull
        @Override
        public List<Cookie> loadForRequest(@NonNull HttpUrl url) {
            String header = CookieManager.getInstance().getCookie(url.toString());
            if (header == null || header.isEmpty()) return Collections.emptyList();
            List<Cookie> cookies = new ArrayList<>();
            for (String part : header.split(";")) {
                Cookie cookie = Cookie.parse(url, part.trim());
                if (cookie != null) cookies.add(cookie);
            }
            return cookies;
        }
    }

    static PlaybackContext findPlaybackContext(String url) {
        purgePlaybackContexts();
        String origin = OriginHeaderStore.originOf(url);
        if (origin == null) return null;
        long now = System.currentTimeMillis();
        PlaybackContext best = null;
        for (PlaybackContext candidate : PLAYBACK_CONTEXTS.values()) {
            if (!origin.equals(candidate.origin) || candidate.expiresAt < now) continue;
            if (!candidate.scoped && !url.equals(candidate.originalUrl)) continue;
            if (best == null
                || (url.equals(candidate.originalUrl) && !url.equals(best.originalUrl))
                || candidate.expiresAt > best.expiresAt) {
                best = candidate;
            }
        }
        return best == null ? null : best.forRequest(url);
    }

    private static void purgePlaybackContexts() {
        long now = System.currentTimeMillis();
        PLAYBACK_CONTEXTS.entrySet().removeIf(entry -> entry.getValue().expiresAt < now);
    }

    static final class PlaybackContext {
        final String originalUrl;
        final String origin;
        final boolean scoped;
        final Map<String, String> headers;
        final Map<String, String> capturedHeaders;
        final Map<String, String> jsHeaders;
        final String sourcePage;
        final OkHttpClient client;
        final long expiresAt;

        PlaybackContext(
            String originalUrl,
            String format,
            boolean extraOrigin,
            Map<String, String> jsHeaders,
            String sourcePage,
            OkHttpClient client,
            long expiresAt
        ) {
            this.originalUrl = originalUrl;
            String origin = OriginHeaderStore.originOf(originalUrl);
            this.origin = origin == null ? "" : origin;
            this.scoped = extraOrigin || "dash".equalsIgnoreCase(format) || "hls".equalsIgnoreCase(format);
            this.jsHeaders = Collections.unmodifiableMap(new HashMap<>(jsHeaders));
            this.sourcePage = sourcePage;
            this.capturedHeaders = Collections.unmodifiableMap(new HashMap<>(OriginHeaderStore.headersFor(originalUrl, sourcePage)));
            this.headers = Collections.unmodifiableMap(mergePlaybackHeaders(originalUrl, sourcePage, jsHeaders, capturedHeaders, this.origin));
            this.client = client;
            this.expiresAt = expiresAt;
        }

        private PlaybackContext(PlaybackContext source, Map<String, String> headers) {
            this.originalUrl = source.originalUrl;
            this.origin = source.origin;
            this.scoped = source.scoped;
            this.headers = Collections.unmodifiableMap(new HashMap<>(headers));
            this.capturedHeaders = source.capturedHeaders;
            this.jsHeaders = source.jsHeaders;
            this.sourcePage = source.sourcePage;
            this.client = source.client;
            this.expiresAt = source.expiresAt;
        }

        PlaybackContext forRequest(String requestUrl) {
            return new PlaybackContext(this, mergePlaybackHeaders(requestUrl, sourcePage, jsHeaders, capturedHeaders, origin));
        }
    }

    private static Map<String, String> mergePlaybackHeaders(
        String requestUrl,
        String sourcePage,
        Map<String, String> jsHeaders,
        Map<String, String> capturedHeaders,
        String capturedOrigin
    ) {
        Map<String, String> merged = new HashMap<>();
        if (jsHeaders != null) putAllIgnoreCase(merged, jsHeaders);
        String requestOrigin = OriginHeaderStore.originOf(requestUrl);
        if (capturedHeaders != null && !capturedHeaders.isEmpty() && capturedOrigin != null && capturedOrigin.equals(requestOrigin)) {
            putAllIgnoreCase(merged, capturedHeaders);
        } else {
            putAllIgnoreCase(merged, OriginHeaderStore.headersFor(requestUrl, sourcePage));
        }
        if (sourcePage != null && !hasHeader(merged, "referer")) {
            merged.put("referer", sourcePage);
        }
        merged.remove("range");
        merged.remove("Range");
        return merged;
    }

    private static void putAllIgnoreCase(Map<String, String> target, Map<String, String> incoming) {
        if (incoming == null || incoming.isEmpty()) return;
        for (Map.Entry<String, String> entry : incoming.entrySet()) {
            String name = entry.getKey();
            if (name == null || entry.getValue() == null) continue;
            String existing = null;
            for (String key : target.keySet()) {
                if (name.equalsIgnoreCase(key)) {
                    existing = key;
                    break;
                }
            }
            if (existing != null) target.remove(existing);
            target.put(name, entry.getValue());
        }
    }

    private static boolean isAllowedPageUrl(String value) {
        if (value == null || value.trim().isEmpty()) return false;
        Uri uri = Uri.parse(value);
        String scheme = uri.getScheme();
        return uri.getHost() != null && ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme));
    }

    private static boolean isOpaquePlaybackUrl(String value) {
        if (value == null) return false;
        String trimmed = value.trim().toLowerCase(Locale.ROOT);
        return trimmed.startsWith("blob:") || trimmed.startsWith("data:");
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void startLiveSessionOnUi(
        PluginCall call,
        String initialUrl,
        String referrer,
        String sessionId
    ) {
        FrameLayout root = getActivity().findViewById(android.R.id.content);
        if (root == null) {
            call.reject("无法创建原站播放表面");
            return;
        }
        stopLiveSessionOnUi(null);

        WebView webView = new WebView(getActivity());
        webView.setBackgroundColor(Color.BLACK);
        webView.setAlpha(1f);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        JSONArray networkEvents = new JSONArray();
        AtomicReference<String> pageUrl = new AtomicReference<>(initialUrl);
        AtomicLong nativeLastHighValueAt = new AtomicLong(0L);
        String sessionNonce = UUID.randomUUID().toString();
        String probeScript = buildProbeScript(sessionNonce);
        LiveProbeQueue liveProbes = new LiveProbeQueue(
            createProbeClient(settings.getUserAgentString()),
            nativeLastHighValueAt,
            event -> emitMediaObservation(sessionId, event)
        );
        ScriptHandler scriptHandler = installDocumentStartProbe(webView, probeScript);
        ServiceWorkerSniffer.install(
            networkEvents,
            pageUrl,
            nativeLastHighValueAt,
            event -> handleNetworkObservation(event, liveProbes, sessionId)
        );

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageUrl.set(url);
                if (scriptHandler == null) view.evaluateJavascript(probeScript, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageUrl.set(url);
                view.evaluateJavascript(probeScript, null);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                JSONObject event = recordNetworkEvent(networkEvents, pageUrl.get(), request, nativeLastHighValueAt);
                handleNetworkObservation(event, liveProbes, sessionId);
                return null;
            }
        });

        // Start off-screen / zero-size until JS syncs to the Reader media slot.
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(1, 1, Gravity.TOP);
        params.leftMargin = -10000;
        params.topMargin = 0;
        webView.setVisibility(View.INVISIBLE);
        root.addView(webView, params);

        liveSessionId = sessionId;
        liveWebView = webView;
        liveHost = root;
        liveScriptHandler = scriptHandler;
        liveNetworkEvents = networkEvents;
        liveProbeQueue = liveProbes;
        liveEntryUrl = initialUrl;
        liveReferrer = referrer;
        liveSuspended = false;
        liveBlanked = false;
        liveActive.set(true);

        if (referrer == null) {
            webView.loadUrl(initialUrl);
        } else {
            Map<String, String> navigationHeaders = new HashMap<>();
            navigationHeaders.put("Referer", referrer);
            webView.loadUrl(initialUrl, navigationHeaders);
        }
        call.resolve();
    }

    private void applyLiveSessionBoundsOnUi(
        double cssX,
        double cssY,
        double cssW,
        double cssH,
        double cssRadius
    ) {
        WebView webView = liveWebView;
        FrameLayout host = liveHost;
        if (webView == null || host == null) return;

        WebView bridgeWebView = getBridge() != null ? getBridge().getWebView() : null;
        DisplayMetrics metrics = getActivity().getResources().getDisplayMetrics();
        float density = metrics.density;
        int width = Math.max(1, Math.round((float) cssW * density));
        int height = Math.max(1, Math.round((float) cssH * density));
        int[] hostLoc = new int[2];
        host.getLocationInWindow(hostLoc);
        int left;
        int top;
        if (bridgeWebView != null) {
            int[] bridgeLoc = new int[2];
            bridgeWebView.getLocationInWindow(bridgeLoc);
            left = (bridgeLoc[0] - hostLoc[0]) + Math.round((float) cssX * density);
            top = (bridgeLoc[1] - hostLoc[1]) + Math.round((float) cssY * density);
        } else {
            left = Math.round((float) cssX * density) - hostLoc[0];
            top = Math.round((float) cssY * density) - hostLoc[1];
        }

        boolean onScreen = cssW >= 8 && cssH >= 8
            && cssY + cssH > 0
            && cssY < bridgeWebViewHeightCss(bridgeWebView, density);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height, Gravity.TOP | Gravity.START);
        params.leftMargin = left;
        params.topMargin = top;
        webView.setLayoutParams(params);

        final float radiusPx = (float) cssRadius * density;
        webView.setOutlineProvider(new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
                outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radiusPx);
            }
        });
        webView.setClipToOutline(radiusPx > 0.5f);

        if (webView.getVisibility() != View.GONE) {
            webView.setVisibility(onScreen ? View.VISIBLE : View.INVISIBLE);
        }
    }

    private static int bridgeWebViewHeightCss(WebView bridgeWebView, float density) {
        if (bridgeWebView == null || density <= 0f) return Integer.MAX_VALUE;
        return Math.round(bridgeWebView.getHeight() / density);
    }

    private void stopLiveSessionOnUi(String sessionId) {
        if (!liveActive.get() && liveWebView == null) return;
        if (sessionId != null
            && liveSessionId != null
            && !sessionId.isEmpty()
            && !sessionId.equals(liveSessionId)) {
            return;
        }
        liveActive.set(false);
        WebView webView = liveWebView;
        FrameLayout host = liveHost;
        ScriptHandler scriptHandler = liveScriptHandler;
        JSONArray networkEvents = liveNetworkEvents;
        LiveProbeQueue probes = liveProbeQueue;
        liveWebView = null;
        liveHost = null;
        liveScriptHandler = null;
        liveNetworkEvents = null;
        liveProbeQueue = null;
        liveSessionId = null;
        liveEntryUrl = null;
        liveReferrer = null;
        liveSuspended = false;
        liveBlanked = false;
        if (probes != null) {
            new Thread(probes::closeAndAwait, "newsnook-live-stop").start();
        }
        if (webView != null && host != null) {
            cleanup(webView, host, scriptHandler, networkEvents != null ? networkEvents : new JSONArray());
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void startSniff(
        PluginCall call,
        String initialUrl,
        int timeoutMs,
        String referrer,
        String sessionId
    ) {
        FrameLayout root = getActivity().findViewById(android.R.id.content);
        if (root == null) {
            call.reject("无法创建页面观察器");
            return;
        }

        WebView webView = new WebView(getActivity());
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setAlpha(0.01f);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        JSONArray networkEvents = new JSONArray();
        AtomicReference<String> pageUrl = new AtomicReference<>(initialUrl);
        AtomicBoolean finished = new AtomicBoolean(false);
        AtomicLong nativeLastHighValueAt = new AtomicLong(0L);
        String sessionNonce = UUID.randomUUID().toString();
        String probeScript = buildProbeScript(sessionNonce);
        LiveProbeQueue liveProbes = new LiveProbeQueue(
            createProbeClient(settings.getUserAgentString()),
            nativeLastHighValueAt,
            event -> emitMediaObservation(sessionId, event)
        );
        // Header capture is TTL-bound and shared by the discovery lifecycle.
        // Never clear it when another iframe/page sniff may still be active;
        // doing so loses credentials for already discovered CDN tracks.
        ScriptHandler scriptHandler = installDocumentStartProbe(webView, probeScript);
        ServiceWorkerSniffer.install(
            networkEvents,
            pageUrl,
            nativeLastHighValueAt,
            event -> handleNetworkObservation(event, liveProbes, sessionId)
        );

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageUrl.set(url);
                if (scriptHandler == null) view.evaluateJavascript(probeScript, null);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageUrl.set(url);
                view.evaluateJavascript(probeScript, null);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                JSONObject event = recordNetworkEvent(networkEvents, pageUrl.get(), request, nativeLastHighValueAt);
                handleNetworkObservation(event, liveProbes, sessionId);
                return null;
            }
        });

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(360, 640);
        params.leftMargin = -10000;
        root.addView(webView, params);

        long startMs = System.currentTimeMillis();
        Runnable[] pollHolder = new Runnable[1];
        pollHolder[0] = () -> {
            if (finished.get()) return;
            long now = System.currentTimeMillis();
            if (now - startMs >= timeoutMs) {
                finishSniff(call, webView, root, scriptHandler, networkEvents, initialUrl, finished, sessionNonce, liveProbes);
                return;
            }
            webView.evaluateJavascript(
                "Number(window.__newsnookLastHighValueAt) || 0",
                value -> {
                    if (finished.get()) return;
                    long lastHigh = Math.max(parseJsMillis(value), nativeLastHighValueAt.get());
                    long innerNow = System.currentTimeMillis();
                    if (innerNow - startMs >= timeoutMs) {
                        finishSniff(call, webView, root, scriptHandler, networkEvents, initialUrl, finished, sessionNonce, liveProbes);
                        return;
                    }
                    if (innerNow - startMs >= MIN_TIMEOUT_MS && lastHigh > 0 && innerNow - lastHigh >= QUIET_MS) {
                        finishSniff(call, webView, root, scriptHandler, networkEvents, initialUrl, finished, sessionNonce, liveProbes);
                        return;
                    }
                    webView.postDelayed(pollHolder[0], POLL_INTERVAL_MS);
                }
            );
        };
        webView.postDelayed(pollHolder[0], POLL_INTERVAL_MS);
        webView.postDelayed(
            () -> finishSniff(call, webView, root, scriptHandler, networkEvents, initialUrl, finished, sessionNonce, liveProbes),
            timeoutMs
        );

        if (referrer == null) {
            webView.loadUrl(initialUrl);
        } else {
            Map<String, String> navigationHeaders = new HashMap<>();
            navigationHeaders.put("Referer", referrer);
            webView.loadUrl(initialUrl, navigationHeaders);
        }
    }

    private void emitMediaObservation(String sessionId, JSONObject observation) {
        if (observation == null || sessionId == null || sessionId.isEmpty()) return;
        JSONObject snapshot;
        try {
            snapshot = new JSONObject(observation.toString());
        } catch (JSONException ignored) {
            return;
        }
        Runnable emit = () -> {
            JSObject payload = new JSObject();
            payload.put("sessionId", sessionId);
            payload.put("observation", snapshot);
            notifyListeners("mediaObservation", payload);
        };
        android.app.Activity activity = getActivity();
        if (activity != null) activity.runOnUiThread(emit);
        else emit.run();
    }

    private void handleNetworkObservation(
        JSONObject event,
        LiveProbeQueue liveProbes,
        String sessionId
    ) {
        if (event == null) return;
        if (isImmediatelyPlayable(event)) {
            emitMediaObservation(sessionId, event);
        } else {
            JSONObject nested = nestedPlayableObservation(event);
            if (nested != null) emitMediaObservation(sessionId, nested);
            liveProbes.offer(event);
        }
    }

    private static JSONObject nestedPlayableObservation(JSONObject event) {
        String wrapperUrl = event.optString("url", "");
        try {
            Uri wrapper = Uri.parse(wrapperUrl);
            for (String key : wrapper.getQueryParameterNames()) {
                if (!key.matches("(?i)(url|src|source|file|video|video_url|playurl|play_url|media|media_url)")) continue;
                String nestedUrl = wrapper.getQueryParameter(key);
                if (!isAllowedPageUrl(nestedUrl)) continue;
                String mime = inferredMimeType(nestedUrl);
                if (mime == null) continue;
                JSONObject nested = new JSONObject(event.toString());
                nested.put("url", nestedUrl);
                nested.put("mimeType", mime);
                if (mime.startsWith("audio/")) nested.put("mediaKind", "audio");
                else if (mime.startsWith("video/")) nested.put("mediaKind", "video");
                return nested;
            }
        } catch (JSONException | RuntimeException ignored) {
            // The original request remains available for normal runtime probing.
        }
        return null;
    }

    private ScriptHandler installDocumentStartProbe(WebView webView, String probeScript) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return null;
        return WebViewCompat.addDocumentStartJavaScript(webView, probeScript, Collections.singleton("*"));
    }

    static JSONObject recordNetworkEventForServiceWorker(JSONArray events, String pageUrl, WebResourceRequest request, AtomicLong lastHighValueAt) {
        return recordNetworkEvent(events, pageUrl, request, true, lastHighValueAt);
    }

    private static JSONObject recordNetworkEvent(JSONArray events, String pageUrl, WebResourceRequest request, AtomicLong lastHighValueAt) {
        return recordNetworkEvent(events, pageUrl, request, false, lastHighValueAt);
    }

    private static JSONObject recordNetworkEvent(
        JSONArray events,
        String pageUrl,
        WebResourceRequest request,
        boolean fromServiceWorker,
        AtomicLong lastHighValueAt
    ) {
        String url = request.getUrl().toString();
        Map<String, String> requestHeaders = request.getRequestHeaders();
        if (requestHeaders == null) requestHeaders = Collections.emptyMap();
        OriginHeaderStore.note(url, requestHeaders);
        if (isSkippableStaticAsset(url)) return null;
        synchronized (events) {
            JSONObject event = new JSONObject();
            try {
                event.put("url", url);
                event.put("pageUrl", pageUrl);
                event.put("source", "network");
                event.put("method", request.getMethod());
                event.put("timestamp", System.currentTimeMillis());
                if (fromServiceWorker) event.put("fromServiceWorker", true);
                String mimeType = inferredMimeType(url);
                if (mimeType != null) {
                    event.put("mimeType", mimeType);
                    if (mimeType.startsWith("audio/")) event.put("mediaKind", "audio");
                    else if (mimeType.startsWith("video/")) event.put("mediaKind", "video");
                }
                JSONObject headers = new JSONObject();
                for (Map.Entry<String, String> entry : requestHeaders.entrySet()) {
                    String headerName = entry.getKey();
                    if (headerName == null) continue;
                    String lower = headerName.toLowerCase(Locale.ROOT);
                    if ("range".equals(lower)) continue;
                    if (SAFE_REQUEST_HEADERS.contains(lower)) {
                        headers.put(headerName, entry.getValue());
                    }
                }
                if (headers.length() > 0) event.put("requestHeaders", headers);
                // Quiet-exit only for manifests. Progressive video/audio is still
                // recorded at priority 3 for retention, but must not end the session
                // while a preroll may still be playing.
                if (isManifestHighValue(event) && lastHighValueAt != null) {
                    lastHighValueAt.set(System.currentTimeMillis());
                }
                appendPrioritized(events, event);
                return event;
            } catch (JSONException ignored) {
                // 单条异常不影响页面继续加载。
                return null;
            }
        }
    }

    private static final Set<String> TRACKER_HOST_SUFFIXES = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList(
            "google-analytics.com",
            "googletagmanager.com",
            "doubleclick.net",
            "cloudflareinsights.com",
            "sentry.io",
            "hotjar.com",
            "cnzz.com",
            "hm.baidu.com"
        ))
    );

    private static boolean isTrackerHost(String url) {
        try {
            String host = Uri.parse(url).getHost();
            if (host == null) return false;
            String lower = host.toLowerCase(Locale.ROOT);
            if (lower.contains("jsdelivr.net") && url.toLowerCase(Locale.ROOT).contains("disable-devtool")) {
                return true;
            }
            for (String suffix : TRACKER_HOST_SUFFIXES) {
                if (lower.equals(suffix) || lower.endsWith("." + suffix)) return true;
            }
        } catch (RuntimeException ignored) {
            // malformed URL
        }
        return false;
    }

    private static boolean isImmediatelyPlayable(JSONObject event) {
        if (event == null) return false;
        String mime = event.optString("mimeType", "").toLowerCase(Locale.ROOT);
        String url = event.optString("url", "");
        String path = url.split("[?#]", 2)[0].toLowerCase(Locale.ROOT);
        if (mime.startsWith("video/") && path.matches(".*\\.(png|jpe?g|gif|webp|avif|svg|ico)$")) return false;
        return mime.startsWith("video/")
            || mime.startsWith("audio/")
            || mime.contains("mpegurl")
            || mime.contains("dash+xml");
    }

    /**
     * Classifies extensionless requests as they arrive. This is intentionally
     * independent per URL: a slow endpoint cannot delay an obvious m3u8/mp4
     * hit, and the final result only waits for a small bounded drain.
     */
    private static final class LiveProbeQueue {
        // MediaProbe has a three-second call timeout; a shorter drain drops
        // late Range/HEAD classifications before they reach the graph.
        private static final long DRAIN_MS = 3500L;

        private final OkHttpClient client;
        private final AtomicLong lastHighValueAt;
        private final ObservationEmitter emitter;
        // Probe candidates are independent. Eight workers let the bounded
        // session queue converge within the final drain without serializing
        // extensionless requests behind one slow endpoint.
        private final ExecutorService executor = Executors.newFixedThreadPool(8);
        private final Set<String> seen = ConcurrentHashMap.newKeySet();
        private final AtomicInteger scheduled = new AtomicInteger(0);
        private final AtomicBoolean closed = new AtomicBoolean(false);

        LiveProbeQueue(
            OkHttpClient client,
            AtomicLong lastHighValueAt,
            ObservationEmitter emitter
        ) {
            this.client = client;
            this.lastHighValueAt = lastHighValueAt;
            this.emitter = emitter;
        }

        void offer(JSONObject event) {
            if (closed.get() || event == null || scheduled.get() >= MediaProbe.MAX_PER_SESSION) return;
            String method = event.optString("method", "GET");
            String url = event.optString("url", "");
            if (!"GET".equalsIgnoreCase(method)
                || !isAllowedPageUrl(url)
                || isTrackerHost(url)
                || hasMediaExtension(url)
                || !seen.add(url)) return;
            int count = scheduled.incrementAndGet();
            if (count > MediaProbe.MAX_PER_SESSION) {
                scheduled.decrementAndGet();
                return;
            }
            try {
                executor.execute(() -> {
                    try {
                        String pageUrl = event.optString("pageUrl", "");
                        Map<String, String> captured = OriginHeaderStore.headersFor(url, pageUrl);
                        MediaProbe.Result result = MediaProbe.classify(client, url, captured);
                        if (result == null || result.mimeType == null || result.mimeType.isEmpty()) return;
                        synchronized (event) {
                            event.put("mimeType", result.mimeType);
                            if (result.mimeType.startsWith("audio/")) event.put("mediaKind", "audio");
                            else if (result.mimeType.startsWith("video/")) event.put("mediaKind", "video");
                        }
                        if (isManifestHighValue(event)) {
                            lastHighValueAt.set(System.currentTimeMillis());
                        }
                        emitter.emit(event);
                    } catch (JSONException | RuntimeException ignored) {
                        // One URL must not block or cancel the other request tasks.
                    }
                });
            } catch (RuntimeException rejected) {
                seen.remove(url);
                scheduled.decrementAndGet();
            }
        }

        void closeAndAwait() {
            if (!closed.compareAndSet(false, true)) return;
            executor.shutdown();
            try {
                if (!executor.awaitTermination(DRAIN_MS, TimeUnit.MILLISECONDS)) {
                    executor.shutdownNow();
                }
            } catch (InterruptedException interrupted) {
                executor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }

    private static void appendPrioritized(JSONArray events, JSONObject incoming) {
        synchronized (events) {
            if (events.length() < MAX_NETWORK_EVENTS) {
                events.put(incoming);
                return;
            }
            int incomingPriority = observationPriority(incoming);
            int lowestIndex = -1;
            int lowestPriority = Integer.MAX_VALUE;
            for (int index = 0; index < events.length(); index += 1) {
                JSONObject existing = events.optJSONObject(index);
                int priority = observationPriority(existing);
                if (priority < lowestPriority) {
                    lowestPriority = priority;
                    lowestIndex = index;
                }
            }
            if (lowestIndex >= 0 && incomingPriority > lowestPriority) {
                events.remove(lowestIndex);
                events.put(incoming);
            }
        }
    }

    private static int observationPriority(JSONObject event) {
        if (event == null) return 0;
        String mime = event.optString("mimeType", "").toLowerCase(Locale.ROOT);
        String url = event.optString("url", "").toLowerCase(Locale.ROOT);
        if (mime.startsWith("video/") || mime.startsWith("audio/")
            || mime.contains("mpegurl") || mime.contains("dash+xml")
            || url.matches(".*\\.(m3u8|mpd)(?:[?#].*)?$")) return 3;
        if (url.matches(".*\\.(m4s|ts)(?:[?#].*)?$")) return 1;
        if (url.matches(".*\\.(js|css|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)(?:[?#].*)?$")) return 0;
        return 2;
    }

    private static boolean isManifestHighValue(JSONObject event) {
        if (event == null) return false;
        String mime = event.optString("mimeType", "").toLowerCase(Locale.ROOT);
        String url = event.optString("url", "").toLowerCase(Locale.ROOT);
        return mime.contains("mpegurl")
            || mime.contains("dash+xml")
            || url.matches(".*\\.(m3u8|mpd)(?:[?#].*)?$");
    }

    private static boolean isSkippableStaticAsset(String url) {
        Uri uri = Uri.parse(url);
        String path = uri.getPath();
        if (path == null) return false;
        return path.toLowerCase(Locale.ROOT).matches(".*\\.(js|css|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf)$");
    }

    private static String inferredMimeType(String value) {
        try {
            Uri uri = Uri.parse(value);
            for (String key : uri.getQueryParameterNames()) {
                String normalizedKey = key.toLowerCase(Locale.ROOT);
                String parameter = uri.getQueryParameter(key);
                if (parameter == null) continue;
                String normalized = parameter.trim().toLowerCase(Locale.ROOT);
                if (normalizedKey.matches("mime|mime-type|mimetype|content-type|content_type|type") &&
                    normalized.matches("(?:video|audio)/[a-z0-9.+-]+")) {
                    return normalized;
                }
                if (normalizedKey.matches("format|fmt|container|ext")) {
                    if (normalized.matches("m3u8|hls")) return "application/vnd.apple.mpegurl";
                    if (normalized.matches("mpd|dash")) return "application/dash+xml";
                    if (normalized.matches("mp4|m4v|webm|mov|flv|mkv")) return "video/" + normalized;
                    if (normalized.matches("m4a|aac|mp3|ogg|opus")) return "audio/" + normalized;
                }
            }
            String path = uri.getPath();
            if (path != null) {
                String lower = path.toLowerCase(Locale.ROOT);
                if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
                if (lower.endsWith(".mpd")) return "application/dash+xml";
                if (lower.endsWith(".mp4") || lower.endsWith(".m4v") || lower.endsWith(".mov")) return "video/mp4";
                if (lower.endsWith(".webm")) return "video/webm";
                if (lower.endsWith(".m4a")) return "audio/mp4";
                if (lower.endsWith(".mp3")) return "audio/mpeg";
                if (lower.endsWith(".aac")) return "audio/aac";
                if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
            }
        } catch (RuntimeException ignored) {
            // Extension matching remains available for malformed URLs.
        }
        return null;
    }

    private void finishSniff(
        PluginCall call,
        WebView webView,
        FrameLayout root,
        ScriptHandler scriptHandler,
        JSONArray networkEvents,
        String pageUrl,
        AtomicBoolean finished,
        String sessionNonce,
        LiveProbeQueue liveProbes
    ) {
        if (!finished.compareAndSet(false, true)) return;
        webView.evaluateJavascript(
            "window.__newsnookCollectMedia ? JSON.stringify(window.__newsnookCollectMedia()) : '[]'",
            value -> {
                cleanup(webView, root, scriptHandler, networkEvents);
                new Thread(() -> {
                    // Unknown resources are classified while the page is loading,
                    // like youtoo's per-request VideoTask. Give in-flight probes a
                    // short bounded drain instead of starting a second 15 s batch.
                    liveProbes.closeAndAwait();
                    JSONArray networkCopy = copyEvents(networkEvents);
                    appendEvaluatedEvents(networkCopy, value);
                    JSObject result = new JSObject();
                    result.put("pageUrl", pageUrl);
                    result.put("observations", keepTrustedObservations(networkCopy, sessionNonce));
                    android.app.Activity activity = getActivity();
                    if (activity != null) {
                        activity.runOnUiThread(() -> call.resolve(result));
                    } else {
                        call.resolve(result);
                    }
                }, "newsnook-media-probe").start();
            }
        );
    }

    private static JSONArray keepTrustedObservations(JSONArray events, String sessionNonce) {
        Set<String> networkUrls = new HashSet<>();
        for (int index = 0; index < events.length(); index += 1) {
            JSONObject event = events.optJSONObject(index);
            if (event == null) continue;
            String url = event.optString("url", "");
            if (url.isEmpty()) continue;
            String source = event.optString("source", "");
            if ("network".equals(source) || event.optBoolean("fromServiceWorker", false)) {
                networkUrls.add(url);
            }
        }
        JSONArray trusted = new JSONArray();
        for (int index = 0; index < events.length(); index += 1) {
            JSONObject event = events.optJSONObject(index);
            if (event == null) continue;
            String eventNonce = event.optString("sessionNonce", "");
            if (!eventNonce.isEmpty() && !eventNonce.equals(sessionNonce)) continue;
            if (event.optBoolean("fromIframe", false)) {
                String url = event.optString("url", "");
                String frameUrl = event.optString("pageUrl", "");
                boolean loadedFrame = !frameUrl.isEmpty() && networkUrls.contains(frameUrl);
                String source = event.optString("source", "");
                String inferred = inferredMimeType(url);
                boolean strongManifest = inferred != null
                    && (inferred.contains("mpegurl") || inferred.contains("dash+xml"));
                boolean staticMedia = "static".equals(source) && inferred != null;
                // A player may publish its manifest in inline configuration / DOM
                // and only request it after preroll. Trust HLS/DASH when the iframe
                // document itself was loaded; progressive still needs static config
                // or a real network hit.
                if (url.isEmpty() || (!networkUrls.contains(url) && !(loadedFrame && (strongManifest || staticMedia)))) continue;
            }
            event.remove("sessionNonce");
            trusted.put(event);
        }
        return trusted;
    }

    private static long parseJsMillis(String value) {
        if (value == null || "null".equals(value) || "undefined".equals(value)) return 0L;
        try {
            String trimmed = value.trim();
            if (trimmed.length() >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
                trimmed = trimmed.substring(1, trimmed.length() - 1);
            }
            return (long) Double.parseDouble(trimmed);
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    private static JSONArray copyEvents(JSONArray source) {
        synchronized (source) {
            try {
                return new JSONArray(source.toString());
            } catch (JSONException ignored) {
                return new JSONArray();
            }
        }
    }

    private static void appendEvaluatedEvents(JSONArray target, String evaluatedValue) {
        if (evaluatedValue == null || "null".equals(evaluatedValue)) return;
        try {
            Object decoded = new JSONTokener(evaluatedValue).nextValue();
            JSONArray events = decoded instanceof String
                ? new JSONArray((String) decoded)
                : (JSONArray) decoded;
            for (int index = 0; index < events.length(); index += 1) target.put(events.get(index));
        } catch (JSONException | ClassCastException ignored) {
            // 网络观察结果仍可用。
        }
    }

    private static OkHttpClient createProbeClient(String userAgent) {
        OkHttpClient.Builder builder = new OkHttpClient.Builder()
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .callTimeout(3, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true);
        String ua = userAgent == null ? "" : userAgent.trim();
        if (!ua.isEmpty()) {
            builder.addInterceptor(new Interceptor() {
                @Override
                public Response intercept(Chain chain) throws IOException {
                    Request request = chain.request();
                    if (request.header("User-Agent") != null) return chain.proceed(request);
                    return chain.proceed(request.newBuilder().header("User-Agent", ua).build());
                }
            });
        }
        return builder.build();
    }

    private static boolean hasMediaExtension(String url) {
        Uri uri = Uri.parse(url);
        String path = uri.getPath();
        if (path == null) return false;
        return path.toLowerCase(Locale.ROOT).matches(
            ".*\\.(?:m3u8|m3u|mpd|mp4|m4v|m4s|m4a|webm|mov|flv|mkv|aac|mp3|ogg|opus|ts)$"
        );
    }

    private static void cleanup(WebView webView, ViewGroup root, ScriptHandler scriptHandler, JSONArray networkEvents) {
        ServiceWorkerSniffer.uninstall(networkEvents);
        if (scriptHandler != null) scriptHandler.remove();
        webView.stopLoading();
        root.removeView(webView);
        webView.loadUrl("about:blank");
        webView.destroy();
    }
}
