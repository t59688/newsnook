package com.aizeek.newsnook;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.SharedPreferences;
import android.util.Xml;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Background RSS/Atom checks never run a WebView.
 * HTML/special adapters are intentionally excluded until a native-safe parser exists.
 */
public class SourceWatchJobService extends JobService {
    static final Object LOCK = new Object();
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private volatile boolean stopped;
    private static final AtomicInteger RUNNING = new AtomicInteger();

    static boolean isRunning() { return RUNNING.get() > 0; }

    @Override public boolean onStartJob(JobParameters params) {
        stopped = false;
        RUNNING.incrementAndGet();
        EXECUTOR.execute(() -> {
            boolean nextScheduled = true;
            try {
                performChecks();
            } catch (Exception error) {
                android.util.Log.w("SourceWatch", "Background watch check failed", error);
            } finally {
                if (!stopped) {
                    // The alternate ID is persisted *before* the current job
                    // finishes. Scheduling the currently running ID would
                    // terminate the job on Android instead of chaining it.
                    if (params.getJobId() == SourceWatchPlugin.JOB_ID ||
                        params.getJobId() == SourceWatchPlugin.SHORT_JOB_ID) {
                        nextScheduled = SourceWatchPlugin.scheduleShortFollowUp(this, params.getJobId());
                    }
                    jobFinished(params, !nextScheduled);
                }
                RUNNING.decrementAndGet();
            }
        });
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        stopped = true;
        // Android itself retries interrupted one-shot work. Do not also enqueue
        // a new short job here; retries plus our chain would duplicate polls.
        return true;
    }

    private void performChecks() {
        SharedPreferences prefs = getSharedPreferences(SourceWatchPlugin.PREFS, Context.MODE_PRIVATE);
        JSONObject config;
        try { config = new JSONObject(prefs.getString(SourceWatchPlugin.CONFIG, "{}")); }
        catch (Exception e) { config = new JSONObject(); }
        JSONArray sources = config.optJSONArray("sources");
        if (sources == null) sources = new JSONArray();
        int checked = 0;
        int discovered = 0;
        int notified = 0;
        int errors = 0;
        Calendar calendar = Calendar.getInstance();
        int hour = calendar.get(Calendar.HOUR_OF_DAY);
        boolean quiet = config.optBoolean("quietHours", true) && (hour >= 23 || hour < 8);
        for (int i = 0; i < sources.length() && !stopped; i++) {
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
                JSONArray current = fetchRss(url, prefs, id);
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
                        if (SourceWatchPlugin.postWatchedUpdates(this, id, name, notifyArticles)) notified++;
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
    }

    private static String canonicalLink(String url) {
        return url.trim().replaceAll("#.*$", "").replaceAll("/$", "");
    }

    private JSONArray fetchRss(String url, SharedPreferences prefs, String sourceId) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(14000);
        connection.setInstanceFollowRedirects(true);
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
                while ((event = xml.next()) != XmlPullParser.END_DOCUMENT && items.length() < 50 && !stopped) {
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
