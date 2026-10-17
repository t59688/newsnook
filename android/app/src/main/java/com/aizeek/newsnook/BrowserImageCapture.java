package com.aizeek.newsnook;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Explicit, tab-scoped image inspection. The website receives no Capacitor
 * bridge, event handlers, click interception, or automatic image requests.
 * Resource bytes live only in memory, including in the private WebView process.
 */
final class BrowserImageCapture {
    static final int MAX_IMAGES = 240;
    static final int MAX_SOURCE_BYTES = 6 * 1024 * 1024;
    static final int MAX_DISPLAY_BYTES = 2 * 1024 * 1024;
    static final long LOAD_TIMEOUT_MS = 18000L;
    private static final long SCAN_TIMEOUT_MS = 6000L;
    private static final int MAX_REQUEST_CONTEXTS = 320;
    private static final String CANCELLED = "图片读取已取消";
    private final WebView webView;
    private final int tabId;
    private final String key = "__newsnookImages_" + UUID.randomUUID().toString().replace("-", "");
    private final String probe;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient client = new OkHttpClient.Builder()
        .cache(null).followRedirects(false).followSslRedirects(false)
        .connectTimeout(7, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(15, TimeUnit.SECONDS).build();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8), runnable -> new Thread(runnable, "NewsNookBrowserImage"));
    private final Map<String, Work> work = new LinkedHashMap<>();
    private volatile Page page;
    private Scan pendingScan;
    private volatile boolean closed;

    private static final class Page {
        final String id = UUID.randomUUID().toString();
        final Map<String, JSONObject> candidates = new LinkedHashMap<>();
        final Map<String, Map<String, String>> headers = Collections.synchronizedMap(new LinkedHashMap<>());
        final String url;
        Page(String url) { this.url = url; }
    }

    private static final class Scan {
        final Page page;
        final String requestId;
        final Consumer<String> failure;
        Runnable timeout;
        Scan(Page page, String requestId, Consumer<String> failure) {
            this.page = page; this.requestId = requestId; this.failure = failure;
        }
    }

    private static final class Bytes {
        final byte[] value;
        final String mime;
        Bytes(byte[] value, String mime) { this.value = value; this.mime = mime; }
    }

    private static final class Encoded {
        final byte[] value;
        final String mime;
        final int width;
        final int height;
        final boolean reduced;
        Encoded(byte[] value, String mime, int width, int height, boolean reduced) {
            this.value = value; this.mime = mime; this.width = width; this.height = height; this.reduced = reduced;
        }
    }

    private static final class Work {
        final Page page;
        final String requestId;
        final String imageId;
        final JSONObject image;
        final Consumer<JSONObject> success;
        final Consumer<String> failure;
        final AtomicBoolean cancelled = new AtomicBoolean();
        final AtomicBoolean settled = new AtomicBoolean();
        final CountDownLatch transferReady = new CountDownLatch(1);
        volatile Call call;
        volatile Future<?> future;
        volatile Bytes transferred;
        volatile String transferError;
        Runnable timeout;
        Runnable poll;
        Work(Page page, String requestId, String imageId, JSONObject image,
             Consumer<JSONObject> success, Consumer<String> failure) {
            this.page = page; this.requestId = requestId; this.imageId = imageId;
            this.image = image; this.success = success; this.failure = failure;
        }
    }

    BrowserImageCapture(WebView view, int id, String initialUrl) {
        webView = view;
        tabId = id;
        page = new Page(initialUrl);
        workers.allowCoreThreadTimeOut(true);
        String source;
        try (InputStream input = view.getContext().getAssets().open("browser-image-probe.js")) {
            source = new String(readBounded(input, 64 * 1024), StandardCharsets.UTF_8);
        } catch (Exception ignored) { source = ""; }
        probe = source;
    }

    void onPageStarted(String url) {
        if (closed) return;
        cancel(null, null);
        page = new Page(url);
    }

    /** Observe request context without replacing the original WebView request. */
    void onRequest(WebResourceRequest request) {
        Page current = page;
        if (closed || current == null || request == null || request.isForMainFrame()) return;
        String url = request.getUrl().toString();
        if (!isHttpUrl(url)) return;
        Map<String, String> captured = new LinkedHashMap<>();
        Map<String, String> original = request.getRequestHeaders();
        if (original != null) {
            for (Map.Entry<String, String> entry : original.entrySet()) {
                String name = entry.getKey().toLowerCase(Locale.ROOT);
                if (!"referer".equals(name) && !"origin".equals(name) && !"user-agent".equals(name)
                    && !"authorization".equals(name) && !"accept".equals(name) && !"accept-language".equals(name)) continue;
                String value = entry.getValue();
                if (value != null && value.length() <= 8192 && value.indexOf('\r') < 0 && value.indexOf('\n') < 0) {
                    captured.put(name, value);
                }
            }
        }
        synchronized (current.headers) {
            current.headers.put(url, captured);
            while (current.headers.size() > MAX_REQUEST_CONTEXTS) {
                current.headers.remove(current.headers.keySet().iterator().next());
            }
        }
    }

    void scan(String requestId, Consumer<JSONObject> success, Consumer<String> failure) {
        if (closed) { failure.accept("网页已关闭"); return; }
        if (!validRequestId(requestId)) { failure.accept("扫描请求无效"); return; }
        if (probe.isEmpty()) { failure.accept("图片扫描暂不可用，请重启应用后重试"); return; }
        String liveUrl = webView.getUrl();
        if (isHttpUrl(liveUrl) && !liveUrl.equals(page.url)) onPageStarted(liveUrl);
        Page current = page;
        if (!isHttpUrl(current.url)) { failure.accept("请先打开一个网页"); return; }
        cancel(null, null);
        current.candidates.clear();
        Scan scan = new Scan(current, requestId, failure);
        pendingScan = scan;
        scan.timeout = () -> {
            if (pendingScan == scan) {
                pendingScan = null;
                failure.accept("扫描超时，请等网页加载完成后重试");
            }
        };
        main.postDelayed(scan.timeout, SCAN_TIMEOUT_MS);
        String scanId = UUID.randomUUID().toString();
        String script = probe.replace("__NEWSNOOK_IMAGE_KEY__", JSONObject.quote(key))
            .replace("__NEWSNOOK_IMAGE_SCAN__", JSONObject.quote(scanId));
        try {
            webView.evaluateJavascript(script, result -> {
                if (closed || page != current || pendingScan != scan) return;
                pendingScan = null;
                main.removeCallbacks(scan.timeout);
                try {
                    JSONObject payload = decode(result);
                    String sourcePage = payload.optString("pageUrl");
                    String actualUrl = webView.getUrl();
                    if (!sourcePage.equals(current.url) || (isHttpUrl(actualUrl) && !sourcePage.equals(actualUrl))) {
                        failure.accept("网页已变化，请重新扫描"); return;
                    }
                    JSONArray input = payload.optJSONArray("items");
                    JSONArray items = new JSONArray();
                    if (input != null) for (int index = 0; index < Math.min(input.length(), MAX_IMAGES); index++) {
                        JSONObject item = input.optJSONObject(index);
                        if (!validCandidate(item, scanId)) continue;
                        Map<String, String> captured = current.headers.get(item.optString("sourceUrl"));
                        JSONObject publicHeaders = new JSONObject();
                        String referer = captured == null ? defaultReferer(item.optString("sourceUrl"), item.optString("pageUrl"))
                            : captured.get("referer");
                        if (referer != null && !referer.isEmpty()) publicHeaders.put("Referer", referer);
                        if (captured != null && captured.get("origin") != null) publicHeaders.put("Origin", captured.get("origin"));
                        String ua = captured == null ? null : captured.get("user-agent");
                        publicHeaders.put("User-Agent", ua == null ? webView.getSettings().getUserAgentString() : ua);
                        item.put("requestHeaders", publicHeaders);
                        current.candidates.put(item.getString("id"), item);
                        items.put(item);
                    }
                    success.accept(new JSONObject().put("tabId", tabId).put("documentId", current.id)
                        .put("requestId", requestId).put("pageUrl", current.url).put("items", items)
                        .put("truncated", payload.optBoolean("truncated", false) || input != null && input.length() > MAX_IMAGES)
                        .put("inaccessibleFrames", Math.max(0, Math.min(1000, payload.optInt("inaccessibleFrames", 0)))));
                } catch (Exception ignored) { failure.accept("无法读取这页的图片，请重新扫描"); }
            });
        } catch (RuntimeException ignored) {
            pendingScan = null;
            main.removeCallbacks(scan.timeout);
            failure.accept("网页暂时无法扫描，请重试");
        }
    }

    void load(String documentId, String requestId, String imageId, boolean thumbnail, boolean original,
              Consumer<JSONObject> success, Consumer<String> failure) {
        Page current = page;
        if (closed || current == null || !current.id.equals(documentId)) { failure.accept("网页已变化，请重新扫描"); return; }
        JSONObject image = current.candidates.get(imageId);
        if (image == null || !validRequestId(requestId)) { failure.accept("图片已失效，请重新扫描"); return; }
        if (work.containsKey(requestId) || work.size() >= 10) { failure.accept("正在读取其他图片，请稍后重试"); return; }
        Work request = new Work(current, requestId, imageId, image, success, failure);
        work.put(requestId, request);
        request.timeout = () -> cancelWork(request, "图片读取超时，请重试");
        main.postDelayed(request.timeout, LOAD_TIMEOUT_MS);
        // Read WebView settings on its owning UI thread.
        final String userAgent = webView.getSettings().getUserAgentString();
        try {
            request.future = workers.submit(() -> {
                try {
                    ensureLive(request);
                    Bytes bytes = "page".equals(image.optString("transport")) ? readFromPage(request) : readHttp(request, userAgent);
                    ensureLive(request);
                    Encoded encoded = encode(bytes, thumbnail, original);
                    ensureLive(request);
                    JSONObject result = new JSONObject().put("tabId", tabId).put("documentId", current.id)
                        .put("requestId", requestId).put("imageId", imageId)
                        .put("mimeType", encoded.mime).put("byteLength", encoded.value.length)
                        .put("width", encoded.width).put("height", encoded.height).put("reduced", encoded.reduced)
                        .put("dataUrl", "data:" + encoded.mime + ";base64," + Base64.encodeToString(encoded.value, Base64.NO_WRAP));
                    main.post(() -> complete(request, result, null));
                } catch (Exception error) {
                    String message = error.getMessage();
                    main.post(() -> complete(request, null, message == null ? "图片无法加载，请重试" : message));
                } catch (OutOfMemoryError error) {
                    main.post(() -> complete(request, null, "图片尺寸过大，请返回网页查看"));
                }
            });
        } catch (RuntimeException ignored) { complete(request, null, "正在读取其他图片，请稍后重试"); }
    }

    private Bytes readHttp(Work request, String userAgent) throws Exception {
        String originalUrl = request.image.optString("sourceUrl");
        HttpUrl url = HttpUrl.parse(originalUrl);
        if (url == null) throw new IOException("图片网址无效");
        Map<String, String> captured = request.page.headers.get(originalUrl);
        String pageUrl = request.image.optString("pageUrl", request.page.url);
        for (int redirects = 0; redirects <= 4; redirects++) {
            ensureLive(request);
            String target = url.toString();
            Map<String, String> headers = headersFor(target, originalUrl, pageUrl, captured, userAgent,
                CookieManager.getInstance().getCookie(target));
            Request.Builder builder = new Request.Builder().url(url);
            for (Map.Entry<String, String> entry : headers.entrySet()) builder.header(entry.getKey(), entry.getValue());
            Call call = client.newCall(builder.build());
            request.call = call;
            try (Response response = call.execute()) {
                int status = response.code();
                if (status >= 300 && status < 400) {
                    String location = response.header("Location");
                    HttpUrl next = location == null ? null : url.resolve(location);
                    if (next == null || "https".equals(url.scheme()) && !"https".equals(next.scheme())) {
                        throw new IOException("图片跳转不可用，请返回网页查看");
                    }
                    url = next;
                    continue;
                }
                if (!response.isSuccessful() || response.body() == null) throw new IOException("图片加载失败 HTTP " + status);
                if (response.body().contentLength() > MAX_SOURCE_BYTES) throw new IOException("图片超过 6 MB，请返回网页查看");
                byte[] body = readBounded(response.body().byteStream(), MAX_SOURCE_BYTES);
                String mime = response.header("Content-Type", "").split(";")[0].trim().toLowerCase(Locale.ROOT);
                return new Bytes(body, mime);
            } finally { request.call = null; }
        }
        throw new IOException("图片跳转过多，请返回网页查看");
    }

    /** Credentials are recomputed for each redirect; observed auth never crosses origins. */
    static Map<String, String> headersFor(String targetUrl, String originalUrl, String pageUrl,
                                         Map<String, String> captured, String userAgent, String cookie) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("User-Agent", userAgent);
        headers.put("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
        boolean sameOrigin = equalOrigins(targetUrl, originalUrl);
        if (captured != null && sameOrigin) {
            for (Map.Entry<String, String> entry : captured.entrySet()) headers.put(entry.getKey(), entry.getValue());
        } else {
            String referer = defaultReferer(targetUrl, pageUrl);
            if (!referer.isEmpty()) headers.put("Referer", referer);
        }
        if (cookie != null && !cookie.isEmpty()) headers.put("Cookie", cookie);
        return headers;
    }

    private static boolean equalOrigins(String first, String second) {
        String left = OriginHeaderStore.originOf(first);
        return left != null && left.equals(OriginHeaderStore.originOf(second));
    }

    private static String defaultReferer(String targetUrl, String sourcePage) {
        if (!isHttpUrl(sourcePage)) return "";
        if (sourcePage.startsWith("https:") && targetUrl.startsWith("http:")) return "";
        if (equalOrigins(targetUrl, sourcePage)) {
            int hash = sourcePage.indexOf('#');
            return hash < 0 ? sourcePage : sourcePage.substring(0, hash);
        }
        String origin = OriginHeaderStore.originOf(sourcePage);
        return origin == null ? "" : origin + "/";
    }

    private Bytes readFromPage(Work request) throws Exception {
        main.post(() -> {
            if (!isLive(request)) { request.transferReady.countDown(); return; }
            String script = "(function(){try{var s=window[" + JSONObject.quote(key)
                + "];return JSON.stringify(s?s.start(" + JSONObject.quote(request.imageId) + ","
                + JSONObject.quote(request.requestId) + "," + MAX_SOURCE_BYTES
                + "):{error:'图片已失效，请重新扫描'});}catch(e){return JSON.stringify({error:'图片读取失败'})}})()";
            try { webView.evaluateJavascript(script, result -> {
                if (!isLive(request)) return;
                try {
                    JSONObject value = decode(result);
                    if (value.has("error")) {
                        request.transferError = value.optString("error");
                        request.transferReady.countDown();
                    } else pollPage(request);
                } catch (Exception ignored) {
                    request.transferError = "图片读取失败，请重试";
                    request.transferReady.countDown();
                }
            }); } catch (RuntimeException ignored) {
                request.transferError = "网页暂时无法读取图片，请重试";
                request.transferReady.countDown();
            }
        });
        if (!request.transferReady.await(LOAD_TIMEOUT_MS - 1000, TimeUnit.MILLISECONDS)) throw new IOException("图片读取超时，请重试");
        ensureLive(request);
        if (request.transferred == null) throw new IOException(request.transferError == null ? "图片读取失败，请重试" : request.transferError);
        return request.transferred;
    }

    private void pollPage(Work request) {
        if (!isLive(request)) return;
        request.poll = () -> {
            if (!isLive(request)) return;
            String script = "(function(){try{var s=window[" + JSONObject.quote(key)
                + "];return JSON.stringify(s?s.read(" + JSONObject.quote(request.requestId)
                + "):{error:'图片已失效，请重新扫描'});}catch(e){return JSON.stringify({error:'图片读取失败'})}})()";
            try { webView.evaluateJavascript(script, result -> {
                if (!isLive(request)) return;
                try {
                    JSONObject payload = decode(result);
                    if (payload.optBoolean("pending", false)) { main.postDelayed(request.poll, 90); return; }
                    if (payload.has("error")) request.transferError = payload.optString("error");
                    else {
                        String data = payload.optString("dataUrl");
                        int comma = data.indexOf(',');
                        if (comma < 0 || comma > 128 || data.length() > MAX_SOURCE_BYTES * 4 / 3 + 256
                            || !data.startsWith("data:image/") || !data.substring(0, comma).endsWith(";base64")) {
                            throw new IOException("图片数据无效或超过 6 MB");
                        }
                        String mime = data.substring(5, comma - 7).toLowerCase(Locale.ROOT);
                        byte[] bytes = Base64.decode(data.substring(comma + 1), Base64.DEFAULT);
                        if (bytes.length == 0 || bytes.length > MAX_SOURCE_BYTES) throw new IOException("图片数据无效或超过 6 MB");
                        request.transferred = new Bytes(bytes, mime);
                    }
                } catch (Exception error) { request.transferError = "网页内存图片无法读取，请重新扫描"; }
                request.transferReady.countDown();
            }); } catch (RuntimeException ignored) {
                request.transferError = "网页暂时无法读取图片，请重试";
                request.transferReady.countDown();
            }
        };
        main.postDelayed(request.poll, 60);
    }

    private static Encoded encode(Bytes source, boolean thumbnail, boolean original) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(source.value, 0, source.value.length, bounds);
        if ("image/svg+xml".equals(source.mime)) {
            if (source.value.length > (thumbnail ? 128 : 512) * 1024) throw new IOException("矢量图片过大，请返回网页查看");
            String prefix = new String(source.value, 0, Math.min(source.value.length, 2048), StandardCharsets.UTF_8);
            if (!prefix.toLowerCase(Locale.ROOT).contains("<svg")) throw new IOException("图片格式无法识别");
            return new Encoded(source.value, "image/svg+xml", 0, 0, false);
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outMimeType == null) throw new IOException("图片格式暂不支持，请返回网页查看");
        if ((long) bounds.outWidth * bounds.outHeight > 100_000_000L) throw new IOException("图片尺寸过大，请返回网页查看");
        String mime = bounds.outMimeType.toLowerCase(Locale.ROOT);
        if (original) return new Encoded(source.value, mime, bounds.outWidth, bounds.outHeight, false);
        int edge = thumbnail ? 320 : 2560;
        long pixels = thumbnail ? 102_400L : 4_194_304L;
        if (!thumbnail && bounds.outWidth <= edge && bounds.outHeight <= edge
            && (long) bounds.outWidth * bounds.outHeight <= pixels && source.value.length <= MAX_DISPLAY_BYTES) {
            return new Encoded(source.value, mime, bounds.outWidth, bounds.outHeight, false);
        }
        int sample = 1;
        while (bounds.outWidth / sample > edge * 2 || bounds.outHeight / sample > edge * 2
            || (long) (bounds.outWidth / sample) * (bounds.outHeight / sample) > pixels * 2) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        Bitmap bitmap = BitmapFactory.decodeByteArray(source.value, 0, source.value.length, options);
        if (bitmap == null) throw new IOException("图片解码失败，请重试");
        Bitmap scaled = null;
        try {
            double ratio = Math.min(1.0, Math.min((double) edge / bitmap.getWidth(), (double) edge / bitmap.getHeight()));
            ratio = Math.min(ratio, Math.sqrt((double) pixels / ((long) bitmap.getWidth() * bitmap.getHeight())));
            int width = Math.max(1, (int) Math.round(bitmap.getWidth() * ratio));
            int height = Math.max(1, (int) Math.round(bitmap.getHeight() * ratio));
            scaled = ratio < 1 ? Bitmap.createScaledBitmap(bitmap, width, height, true) : bitmap;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            // WebP preserves transparency and bounds the thumbnail/display transfer.
            if (!scaled.compress(Bitmap.CompressFormat.WEBP, thumbnail ? 78 : 90, output)) throw new IOException("图片解码失败，请重试");
            int budget = thumbnail ? 128 * 1024 : MAX_DISPLAY_BYTES;
            if (output.size() > budget) throw new IOException("图片细节过多，请返回网页查看");
            return new Encoded(output.toByteArray(), "image/webp", width, height, true);
        } finally {
            if (scaled != null && scaled != bitmap) scaled.recycle();
            bitmap.recycle();
        }
    }

    void cancel(String documentId, String requestId) {
        if (documentId != null && page != null && !documentId.equals(page.id)) return;
        Scan scan = pendingScan;
        if (scan != null && (requestId == null || requestId.equals(scan.requestId))) {
            pendingScan = null;
            main.removeCallbacks(scan.timeout);
            scan.failure.accept(CANCELLED);
        }
        for (Work request : new ArrayList<>(work.values())) {
            if (requestId == null || requestId.equals(request.requestId)) cancelWork(request, CANCELLED);
        }
    }

    private void cancelWork(Work request, String message) {
        if (!request.cancelled.compareAndSet(false, true)) return;
        if (request.call != null) request.call.cancel();
        if (request.future != null) request.future.cancel(true);
        if (request.future instanceof Runnable) workers.remove((Runnable) request.future);
        request.transferReady.countDown();
        if (!closed && "page".equals(request.image.optString("transport"))) {
            try {
                webView.evaluateJavascript("(function(){var s=window[" + JSONObject.quote(key)
                    + "];if(s)s.stop(" + JSONObject.quote(request.requestId) + ")})()", null);
            } catch (RuntimeException ignored) {}
        }
        complete(request, null, message);
    }

    private boolean isLive(Work request) {
        return !closed && page == request.page && !request.cancelled.get() && !request.settled.get();
    }

    private void ensureLive(Work request) throws IOException {
        if (!isLive(request) || Thread.currentThread().isInterrupted()) throw new IOException(CANCELLED);
    }

    private void complete(Work request, JSONObject result, String error) {
        if (!request.settled.compareAndSet(false, true)) return;
        work.remove(request.requestId);
        main.removeCallbacks(request.timeout);
        if (request.poll != null) main.removeCallbacks(request.poll);
        request.transferred = null;
        if (error != null) request.failure.accept(error);
        else if (closed || page != request.page || request.cancelled.get()) request.failure.accept(CANCELLED);
        else request.success.accept(result);
    }

    private static JSONObject decode(String result) throws Exception {
        Object decoded = new JSONTokener(result == null ? "null" : result).nextValue();
        if (!(decoded instanceof String)) throw new IOException("invalid result");
        return new JSONObject((String) decoded);
    }

    private static boolean validCandidate(JSONObject item, String scanId) {
        if (item == null || !item.optString("id").startsWith(scanId + "-")) return false;
        String source = item.optString("sourceUrl");
        String transport = item.optString("transport");
        if (!isHttpUrl(item.optString("pageUrl"))) return false;
        if ("http".equals(transport)) return source.length() <= 8192 && isHttpUrl(source);
        return "page".equals(transport) && ("data:".equals(source) || source.startsWith("blob:") && source.length() <= 8192);
    }

    private static boolean validRequestId(String requestId) {
        return requestId != null && !requestId.isEmpty() && requestId.length() <= 128;
    }

    private static boolean isHttpUrl(String url) {
        if (url == null) return false;
        HttpUrl parsed = HttpUrl.parse(url);
        return parsed != null && parsed.username().isEmpty() && parsed.password().isEmpty();
    }

    static byte[] readBounded(InputStream input, int maxBytes) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream(Math.min(maxBytes, 8192));
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (result.size() + count > maxBytes) throw new IOException("图片超过 6 MB，请返回网页查看");
            result.write(buffer, 0, count);
        }
        return result.toByteArray();
    }

    void close() { close(true); }

    void close(boolean removeBindings) {
        if (closed) return;
        closed = true;
        cancel(null, null);
        workers.shutdownNow();
        if (removeBindings) try {
            webView.evaluateJavascript("(function(){var s=window[" + JSONObject.quote(key)
                + "];if(s)s.cancel();delete window[" + JSONObject.quote(key) + "]})()", null);
        } catch (RuntimeException ignored) {}
        page = null;
    }
}
