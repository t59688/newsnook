package com.aizeek.newsnook;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Xml;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

/**
 * Background RSS/Atom checks never run a WebView.
 * HTML/special adapters are intentionally excluded until a native-safe parser exists.
 */
public class SourceWatchJobService extends JobService {
    static final Object LOCK = new Object();
    static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final String USER_AGENT =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
    private static final long CHECK_COOLDOWN_MS = 45_000L;
    private static final long WAKE_LOCK_TIMEOUT_MS = 180_000L;
    private static final Object RUN_GATE = new Object();
    private static long lastSuccessfulCheckElapsedMs = Long.MIN_VALUE;
    private static int lastCheckConfigHash = 0;
    private static final AtomicInteger RUNNING = new AtomicInteger();
    private final Map<Integer, AtomicBoolean> jobCancelled = new ConcurrentHashMap<>();

    static boolean isRunning() { return RUNNING.get() > 0; }

    static void markRunStart() { RUNNING.incrementAndGet(); }

    static void markRunEnd() { RUNNING.decrementAndGet(); }

    static void resetCooldown() {
        synchronized (RUN_GATE) {
            lastSuccessfulCheckElapsedMs = Long.MIN_VALUE;
            lastCheckConfigHash = 0;
        }
    }

    @Override public boolean onStartJob(JobParameters params) {
        int jobId = params.getJobId();
        AtomicBoolean cancelled = new AtomicBoolean(false);
        jobCancelled.put(jobId, cancelled);
        markRunStart();
        EXECUTOR.execute(() -> {
            boolean nextScheduled = true;
            try {
                performChecks(this, cancelled::get, true);
            } catch (Exception error) {
                android.util.Log.w("SourceWatch", "Background watch check failed", error);
            } finally {
                jobCancelled.remove(jobId, cancelled);
                if (!cancelled.get()) {
                    // The alternate ID is persisted *before* the current job
                    // finishes. Scheduling the currently running ID would
                    // terminate the job on Android instead of chaining it.
                    if (jobId == SourceWatchPlugin.JOB_ID ||
                        jobId == SourceWatchPlugin.SHORT_JOB_ID) {
                        nextScheduled = SourceWatchPlugin.scheduleShortFollowUp(this, jobId);
                    }
                    jobFinished(params, !nextScheduled);
                }
                markRunEnd();
            }
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        AtomicBoolean cancelled = jobCancelled.get(params.getJobId());
        if (cancelled != null) cancelled.set(true);
        // Android itself retries interrupted periodic/one-shot work. Do not also
        // enqueue a new short job here; retries plus our chain would duplicate polls.
        return true;
    }

    static boolean isNetworkAllowed(Context context, boolean wifiOnly) {
        ConnectivityManager connectivity =
            (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivity == null) return true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network active = connectivity.getActiveNetwork();
            if (active == null) return false;
            NetworkCapabilities caps = connectivity.getNetworkCapabilities(active);
            if (caps != null) {
                if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;
                if (!wifiOnly) return true;
                return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
            }
        }
        @SuppressWarnings("deprecation")
        android.net.NetworkInfo info = connectivity.getActiveNetworkInfo();
        if (info == null || !info.isConnected()) return false;
        return !wifiOnly || !connectivity.isActiveNetworkMetered();
    }

    static void performChecks(Context context, BooleanSupplier isCancelled, boolean allowRecentCooldown) {
        SharedPreferences prefs = context.getSharedPreferences(SourceWatchPlugin.PREFS, Context.MODE_PRIVATE);
        JSONObject config;
        try { config = new JSONObject(prefs.getString(SourceWatchPlugin.CONFIG, "{}")); }
        catch (Exception e) { config = new JSONObject(); }
        JSONArray sources = config.optJSONArray("sources");
        if (sources == null) sources = new JSONArray();
        if (sources.length() == 0 || isCancelled.getAsBoolean()) return;
        boolean wifiOnly = config.optBoolean("wifiOnly", false);
        if (!isNetworkAllowed(context, wifiOnly)) return;

        int configHash = config.toString().hashCode();
        long nowElapsed = SystemClock.elapsedRealtime();
        synchronized (RUN_GATE) {
            if (allowRecentCooldown &&
                lastCheckConfigHash == configHash &&
                lastSuccessfulCheckElapsedMs != Long.MIN_VALUE &&
                nowElapsed - lastSuccessfulCheckElapsedMs < CHECK_COOLDOWN_MS) {
                return;
            }
        }

        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wakeLock = null;
        if (powerManager != null) {
            try {
                wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NewsNook:SourceWatchPoll");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS);
            } catch (Exception ignored) {
                wakeLock = null;
            }
        }

        try {
            int checked = 0;
            int discovered = 0;
            int notified = 0;
            int errors = 0;
            Calendar calendar = Calendar.getInstance();
            int hour = calendar.get(Calendar.HOUR_OF_DAY);
            boolean quiet = config.optBoolean("quietHours", true) && (hour >= 23 || hour < 8);
            for (int i = 0; i < sources.length() && !isCancelled.getAsBoolean(); i++) {
                JSONObject source = sources.optJSONObject(i);
                if (source == null) continue;
                String id = source.optString("id");
                String name = source.optString("name");
                String url = source.optString("url");
                if (id.isEmpty() || url.isEmpty() || !url.startsWith("https://")) continue;
                try {
                    // A successful HTTP 304 still counts as a network check.
                    // "checked" records attempted eligible feeds; errors are separate.
                    checked++;
                    JSONArray current = fetchRss(url, prefs, id, isCancelled);
                    if (current.length() == 0) continue;
                    synchronized (LOCK) {
                        String key = "seen:" + id;
                        String prior = prefs.getString(key, null);
                        Set<String> seen = new HashSet<>();
                        if (prior != null) {
                            JSONArray old = new JSONArray(prior);
                            for (int k = 0; k < old.length(); k++) seen.add(old.optString(k));
                        }
                        JSONArray pending;
                        try { pending = new JSONArray(prefs.getString("events", "[]")); }
                        catch (Exception e) { pending = new JSONArray(); }
                        Set<String> queued = new HashSet<>();
                        for (int k = 0; k < pending.length(); k++) {
                            JSONObject old = pending.optJSONObject(k);
                            if (old != null) queued.add(old.optString("key"));
                        }
                        int added = 0;
                        JSONArray notifyArticles = new JSONArray();
                        for (int k = current.length() - 1; k >= 0; k--) {
                            JSONObject article = current.optJSONObject(k);
                            if (article == null) continue;
                            String link = canonicalLink(article.optString("url"));
                            String eventKey = id + ":" + link;
                            if (prior != null && !seen.contains(link) && !queued.contains(eventKey)) {
                                JSONObject event = new JSONObject();
                                event.put("key", eventKey).put("sourceId", id).put("sourceName", name)
                                    .put("title", article.optString("title")).put("url", link)
                                    .put("discoveredAt", System.currentTimeMillis());
                                pending.put(event);
                                notifyArticles.put(new JSONObject().put("key", eventKey)
                                    .put("title", article.optString("title")).put("url", link));
                                added++;
                            }
                        }
                        JSONArray nextSeen = new JSONArray();
                        for (int k = 0; k < current.length(); k++) nextSeen.put(canonicalLink(current.optJSONObject(k).optString("url")));
                        if (prior != null) {
                            JSONArray old = new JSONArray(prior);
                            for (int k = 0; k < old.length() && nextSeen.length() < 150; k++) {
                                String link = old.optString(k);
                                boolean found = false;
                                for (int j = 0; j < nextSeen.length(); j++) if (link.equals(nextSeen.optString(j))) { found = true; break; }
                                if (!found) nextSeen.put(link);
                            }
                        }
                        JSONArray bounded = new JSONArray();
                        for (int k = Math.max(0, pending.length() - 300); k < pending.length(); k++) bounded.put(pending.optJSONObject(k));
                        prefs.edit().putString(key, nextSeen.toString()).putString("events", bounded.toString()).apply();
                        discovered += added;
                        if (added > 0 && "instant".equals(source.optString("mode")) && !quiet) {
                            if (SourceWatchPlugin.postWatchedUpdates(context, id, name, notifyArticles)) notified++;
                        }
                    }
                } catch (Exception failure) {
                    errors++;
                    // Retain the cursor on network/parser failure. Diagnostics record
                    // only the source id and exception type, never feed contents.
                    android.util.Log.w("SourceWatch", "Source check failed: " + id, failure);
                }
            }
            prefs.edit().putLong("lastJobAt", System.currentTimeMillis())
                .putInt("lastJobChecked", checked)
                .putInt("lastJobNew", discovered)
                .putInt("lastJobNotified", notified)
                .putInt("lastJobErrors", errors).apply();
            if (checked > errors && !isCancelled.getAsBoolean()) {
                synchronized (RUN_GATE) {
                    lastSuccessfulCheckElapsedMs = SystemClock.elapsedRealtime();
                    lastCheckConfigHash = configHash;
                }
            }
        } finally {
            if (wakeLock != null) {
                try {
                    if (wakeLock.isHeld()) wakeLock.release();
                } catch (Exception ignored) {}
            }
        }
    }

    private static String canonicalLink(String url) {
        return url.trim().replaceAll("#.*$", "").replaceAll("/$", "");
    }

    private static JSONArray fetchRss(String url, SharedPreferences prefs, String sourceId, BooleanSupplier isCancelled) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(14000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml");
        String etag = prefs.getString("etag:" + sourceId, null);
        String modified = prefs.getString("modified:" + sourceId, null);
        if (etag != null) connection.setRequestProperty("If-None-Match", etag);
        if (modified != null) connection.setRequestProperty("If-Modified-Since", modified);
        try {
            int httpStatus = connection.getResponseCode();
            if (httpStatus == HttpURLConnection.HTTP_NOT_MODIFIED) return new JSONArray();
            if (httpStatus != HttpURLConnection.HTTP_OK) throw new java.io.IOException("RSS HTTP " + httpStatus);
            String newEtag = connection.getHeaderField("ETag");
            String newModified = connection.getHeaderField("Last-Modified");
            if (connection.getContentLengthLong() > 2_000_000) return new JSONArray();
            try (InputStream stream = new java.io.BufferedInputStream(connection.getInputStream())) {
                XmlPullParser xml = Xml.newPullParser();
                xml.setInput(stream, null);
                JSONArray items = new JSONArray();
                boolean inEntry = false;
                String title = null;
                String link = null;
                int event;
                while ((event = xml.next()) != XmlPullParser.END_DOCUMENT && items.length() < 50 && !isCancelled.getAsBoolean()) {
                    String tag = xml.getName();
                    if (event == XmlPullParser.START_TAG) {
                        if ("item".equals(tag) || "entry".equals(tag)) { inEntry = true; title = ""; link = ""; }
                        else if (inEntry && "title".equals(tag)) title = xml.nextText();
                        else if (inEntry && "link".equals(tag)) {
                            String href = xml.getAttributeValue(null, "href");
                            if (href != null) link = href;
                            else link = xml.nextText();
                        }
                    } else if (event == XmlPullParser.END_TAG && ("item".equals(tag) || "entry".equals(tag))) {
                        if (inEntry && link != null && (link.startsWith("https://") || link.startsWith("http://")) && title != null && !title.isEmpty()) {
                            items.put(new JSONObject().put("title", title).put("url", link));
                        }
                        inEntry = false;
                    }
                }
                if (items.length() > 0) {
                    SharedPreferences.Editor headers = prefs.edit();
                    if (newEtag != null) headers.putString("etag:" + sourceId, newEtag);
                    if (newModified != null) headers.putString("modified:" + sourceId, newModified);
                    headers.apply();
                }
                return items;
            }
        } finally { connection.disconnect(); }
    }
}
