package com.aizeek.newsnook;

import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.webkit.JavaScriptExecutionWorld;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okio.BufferedSource;

/** WebView userscript host. Trusted app UI installs scripts; remote pages never receive a Java bridge. */
final class UserscriptRuntime {
    private static final int MAX_SCRIPTS = 128;
    private static final int MAX_SCRIPT_BYTES = 400_000;
    private static final int MAX_RESOURCE_BYTES = 1_500_000;
    private static final int MAX_RESPONSE_BYTES = 32_000_000;
    private static final String JS_PORT = "__NewsNookUserScriptPort";
    private final WebView webView;
    private final Context context;
    private final SharedPreferences storage;
    private final boolean privateMode;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build();
    private final SecureRandom random = new SecureRandom();
    private final Map<String, InstalledScript> scripts = new LinkedHashMap<>();
    private final Map<String, Call> activeRequests = new ConcurrentHashMap<>();
    private final Set<Call> ownedCalls = ConcurrentHashMap.newKeySet();
    private final List<ScriptHandler> scriptHandlers = new ArrayList<>();
    private final List<JavaScriptExecutionWorld> listenerWorlds = new ArrayList<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Map<String, DownloadTransfer> downloads = new ConcurrentHashMap<>();
    private final ArrayList<MenuCommand> menus = new ArrayList<>();
    private volatile boolean closed;
    private boolean hasBridge;
    private static final String ISOLATED_WORLD = "newsnook.userscripts.privileged";

    private static final class InstalledScript {
        final String id;
        final String secret;
        final JSONObject metadata;
        final String source;
        final String resources;
        volatile JavaScriptReplyProxy proxy;
        InstalledScript(String id, String secret, JSONObject metadata, String source, String resources) {
            this.id = id; this.secret = secret; this.metadata = metadata;
            this.source = source; this.resources = resources;
        }
    }

    private static final class MenuCommand {
        final InstalledScript script;
        final String key;
        final String title;
        MenuCommand(InstalledScript script, String key, String title) {
            this.script = script; this.key = key; this.title = title;
        }
    }

    private static final class DownloadTransfer {
        final String id;
        final InstalledScript script;
        final File file;
        final FileOutputStream stream;
        final String filename;
        long size;
        DownloadTransfer(String id, InstalledScript script, File file, FileOutputStream stream, String filename) {
            this.id = id; this.script = script; this.file = file; this.stream = stream; this.filename = filename;
        }
    }

    UserscriptRuntime(Context context, WebView webView) {
        this(context, webView, false);
    }

    UserscriptRuntime(Context context, WebView webView, boolean privateMode) {
        this.context = context.getApplicationContext(); this.webView = webView;
        this.privateMode = privateMode;
        this.storage = privateMode ? PrivateBrowserSession.preferences("newsnook-userscript-storage")
            : this.context.getSharedPreferences("newsnook-userscript-storage", Context.MODE_PRIVATE);
    }

    void prepare(JSONArray requested) throws Exception {
        if (closed || requested == null || requested.length() == 0) return;
        if (requested.length() > MAX_SCRIPTS) throw new IllegalArgumentException("too many userscripts");
        byte[] randomBytes = new byte[32];
        for (int i = 0; i < requested.length(); i++) {
            if (closed || Thread.currentThread().isInterrupted()) return;
            JSONObject entry = requested.getJSONObject(i);
            if (!entry.optBoolean("enabled", false)) continue;
            String source = entry.optString("source", "");
            if (source.getBytes(StandardCharsets.UTF_8).length > MAX_SCRIPT_BYTES) throw new IllegalArgumentException("script too large");
            String id = entry.getString("id");
            if (!id.startsWith("us-") || id.length() > 128) throw new IllegalArgumentException("invalid script id");
            random.nextBytes(randomBytes);
            String secret = Base64.encodeToString(randomBytes, Base64.NO_WRAP | Base64.URL_SAFE);
            String resources = loadResources(entry.optJSONArray("requires"));
            synchronized (scripts) {
                if (closed) return;
                scripts.put(id, new InstalledScript(id, secret, entry, source, resources));
            }
        }
    }

    boolean install() throws Exception {
        if (closed) return false;
        if (scripts.isEmpty()) return true;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
                && !WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD)) {
            throw new UnsupportedOperationException("此系统 WebView 不支持脚本文档开始注入，请更新 Android System WebView");
        }
        hasBridge = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
        if (!hasBridge) throw new UnsupportedOperationException("此系统 WebView 不支持安全脚本通信，请更新 Android System WebView");
        boolean modern = WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD);
        Set<String> pageOrigins = new LinkedHashSet<>();
        Set<String> isolatedOrigins = new LinkedHashSet<>();
        for (InstalledScript script : scripts.values()) {
            (runsInPage(script) ? pageOrigins : isolatedOrigins).addAll(scriptOrigins(script));
        }
        if (modern) {
            JavaScriptExecutionWorld pageWorld = WebViewCompat.getExecutionWorld(webView, JavaScriptExecutionWorld.PAGE_WORLD_NAME);
            JavaScriptExecutionWorld isolatedWorld = WebViewCompat.getExecutionWorld(webView, ISOLATED_WORLD);
            if (!pageOrigins.isEmpty()) registerListener(pageWorld, pageOrigins, "page");
            if (!isolatedOrigins.isEmpty()) registerListener(isolatedWorld, isolatedOrigins, "isolated");
            for (InstalledScript script : scripts.values()) {
                scriptHandlers.add(WebViewCompat.addJavaScriptOnEvent(webView, buildScript(script),
                    WebViewCompat.INJECTION_EVENT_DOCUMENT_START, scriptOrigins(script),
                    runsInPage(script) ? pageWorld : isolatedWorld));
            }
        } else {
            // Legacy WebView has no isolated world. Never grant native capabilities through page JS.
            for (InstalledScript script : scripts.values()) {
                if (script.metadata.optJSONArray("grants") != null && script.metadata.optJSONArray("grants").length() > 0)
                    throw new UnsupportedOperationException("此 WebView 版本无法安全运行带 GM 权限的脚本，请更新 Android System WebView");
                scriptHandlers.add(WebViewCompat.addDocumentStartJavaScript(webView, buildScript(script), scriptOrigins(script)));
            }
        }
        return true;
    }

    private void registerListener(JavaScriptExecutionWorld world, Set<String> origins, String runtimeWorld) {
        WebViewCompat.addWebMessageListener(webView, JS_PORT, origins, world,
            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (closed || view != webView || !isMainFrame || message.getType() != WebMessageCompat.TYPE_STRING) return;
                String scheme = sourceOrigin.getScheme();
                if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
                String text = message.getData();
                if (text == null || text.length() > 220000) return;
                try { receive(new JSONObject(text), sourceOrigin.toString(), replyProxy, runtimeWorld); }
                catch (Exception failed) {
                    try {
                        JSONObject payload = new JSONObject(text);
                        if (payload.optString("op", "").startsWith("download"))
                            failDownload(payload.optString("req", ""), "保存文件失败", replyProxy);
                    } catch (Exception ignored) { }
                }
            });
        listenerWorlds.add(world);
    }

    private static boolean runsInPage(InstalledScript script) {
        JSONArray grants = script.metadata.optJSONArray("grants");
        if (grants == null || grants.length() == 0) return true;
        for (int i=0; i<grants.length(); i++) {
            String grant = grants.optString(i);
            if ("unsafeWindow".equals(grant) || "none".equals(grant)) return true;
        }
        return false;
    }

    // Constrain both privileged bridge and the injected source to declared sites.
    // Regex includes cannot be represented as Android origin rules: fall back to * and
    // keep strict script-level URL validation before any native operation.
    private static Set<String> scriptOrigins(InstalledScript script) {
        Set<String> allowed = new LinkedHashSet<>();
        for (String field : new String[]{"matches", "includes"}) {
            JSONArray rules = script.metadata.optJSONArray(field);
            if (rules == null) continue;
            for (int i=0;i<rules.length();i++) {
                String pattern = rules.optString(i);
                int schemeSep = pattern.indexOf("://");
                if (schemeSep<0 || pattern.startsWith("/")) return Collections.singleton("*");
                String scheme = pattern.substring(0,schemeSep);
                int hostEnd=pattern.indexOf('/',schemeSep+3);
                if (hostEnd<0) return Collections.singleton("*");
                String host=pattern.substring(schemeSep+3, hostEnd);
                if (host.isEmpty() || host.equals("*") || host.contains(":") ||
                        (host.contains("*") && !host.startsWith("*."))) return Collections.singleton("*");
                if (!host.matches("[A-Za-z0-9.*-]+")) return Collections.singleton("*");
                if (scheme.equals("*")) {
                    allowed.add("http://"+host.toLowerCase(java.util.Locale.ROOT));
                    allowed.add("https://"+host.toLowerCase(java.util.Locale.ROOT));
                } else if (scheme.equals("http") || scheme.equals("https")) {
                    allowed.add(scheme+"://"+host.toLowerCase(java.util.Locale.ROOT));
                } else return Collections.singleton("*");
            }
        }
        return allowed.isEmpty() ? Collections.singleton("*") : allowed;
    }

    private String loadResources(JSONArray urls) throws Exception {
        if (urls == null || urls.length() == 0) return "";
        if (urls.length() > 12) throw new IllegalArgumentException("too many dependencies");
        StringBuilder bundled = new StringBuilder();
        for (int i = 0; i < urls.length(); i++) {
            if (closed || Thread.currentThread().isInterrupted()) return "";
            String value = urls.getString(i);
            if (!value.startsWith("https://")) throw new IllegalArgumentException("@require must use HTTPS");
            URL uri = new URL(value);
            if (uri.getUserInfo() != null) throw new IllegalArgumentException("@require invalid URL");
            byte[] key = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder name = new StringBuilder(); for (byte b : key) name.append(String.format("%02x", b & 255));
            File target = null;
            if (!privateMode) {
                File directory = new File(context.getCacheDir(), "userscript-requires");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("resource cache failed");
                target = new File(directory, name.toString() + ".js");
            }
            byte[] bytes;
            if (target != null && target.isFile() && target.length() < MAX_RESOURCE_BYTES) {
                try (InputStream in = new FileInputStream(target)) { bytes = readBounded(in, MAX_RESOURCE_BYTES); }
            } else {
                Request request = new Request.Builder().url(uri).build();
                Call call = trackedCall(request);
                try (Response response = call.execute()) {
                    if (!response.isSuccessful() || response.body() == null) throw new IllegalStateException("dependency download failed");
                    bytes = readBounded(response.body().byteStream(), MAX_RESOURCE_BYTES);
                } finally { ownedCalls.remove(call); }
                if (closed) return "";
                if (target != null)
                    try (FileOutputStream output = new FileOutputStream(target)) { output.write(bytes); }
            }
            bundled.append("\n").append(new String(bytes, StandardCharsets.UTF_8)).append("\n;");
        }
        return bundled.toString();
    }

    private static byte[] readBounded(InputStream in, int max) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = in.read(buffer)) != -1) {
            if (output.size() + count > max) throw new IllegalStateException("body too large");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private String buildScript(InstalledScript script) throws Exception {
        JSONObject opts = new JSONObject();
        opts.put("id", script.id); opts.put("secret", script.secret);
        opts.put("name", script.metadata.optString("name", ""));
        opts.put("version", script.metadata.optString("version", ""));
        opts.put("matches", script.metadata.optJSONArray("matches") != null ? script.metadata.optJSONArray("matches") : new JSONArray());
        opts.put("includes", script.metadata.optJSONArray("includes") != null ? script.metadata.optJSONArray("includes") : new JSONArray());
        opts.put("excludes", script.metadata.optJSONArray("excludes") != null ? script.metadata.optJSONArray("excludes") : new JSONArray());
        opts.put("excludeMatches", script.metadata.optJSONArray("excludeMatches") != null ? script.metadata.optJSONArray("excludeMatches") : new JSONArray());
        opts.put("runAt", script.metadata.optString("runAt", "document-end"));
        opts.put("executionWorld", runsInPage(script) ? "page" : "isolated");
        opts.put("grants", script.metadata.optJSONArray("grants") != null ? script.metadata.optJSONArray("grants") : new JSONArray());
        opts.put("values", new JSONObject(storage.getString(script.id, "{}")));
        String runtime;
        try (InputStream stream = context.getAssets().open("newsnook-userscript-runtime.js")) {
            runtime = new String(readBounded(stream, 300_000), StandardCharsets.UTF_8);
        }
        return "(function(){\nconst __NN_CONFIG=" + opts + ";\n" + runtime
            + "\nfunction __NN_USER_SCRIPT(GM_addStyle,GM_getValue,GM_setValue,GM_registerMenuCommand,GM_xmlhttpRequest,GM_download,unsafeWindow,GM,GM_deleteValue,GM_listValues,GM_addValueChangeListener,GM_removeValueChangeListener,GM_info){\n"
            + script.resources + "\n" + script.source + "\n}\n__NN_BOOT(__NN_USER_SCRIPT);\n})();";
    }

    private static boolean matchesHost(String host, String allowed) {
        if (allowed.equals("*")) return true;
        if (allowed.startsWith("*.")) return host.equals(allowed.substring(2)) || host.endsWith(allowed.substring(1));
        return host.equalsIgnoreCase(allowed);
    }

    private static boolean matchesScript(InstalledScript script, String url) {
        try {
            URI target = new URI(url);
            String host = target.getHost();
            if (host == null) return false;
            JSONArray matches = script.metadata.optJSONArray("matches");
            JSONArray includes = script.metadata.optJSONArray("includes");
            boolean accepted = false;
            String full = target.toString();
            if (matches != null) for (int i = 0; i < matches.length(); i++) if (matchPattern(matches.optString(i),target)) accepted = true;
            if (includes != null) for (int i = 0; i < includes.length(); i++) if (includeMatch(includes.optString(i),full)) accepted = true;
            if (!accepted) return false;
            JSONArray excludes = script.metadata.optJSONArray("excludes");
            if (excludes != null) for (int i=0;i<excludes.length();i++) if (includeMatch(excludes.optString(i),full)) return false;
            JSONArray excludeMatches = script.metadata.optJSONArray("excludeMatches");
            if (excludeMatches != null) for (int i=0;i<excludeMatches.length();i++) if (matchPattern(excludeMatches.optString(i),target)) return false;
            return true;
        } catch (Exception ignored) { return false; }
    }

    private static boolean glob(String pattern, String text) {
        StringBuilder regex = new StringBuilder("^");
        for (char character : pattern.toCharArray()) {
            if (character == '*') regex.append(".*");
            else if (".\\\\+?^${}()|[]".indexOf(character) >= 0) regex.append('\\').append(character);
            else regex.append(character);
        }
        regex.append('$');
        try { return text.matches(regex.toString()); } catch (Exception e) { return false; }
    }

    private static boolean includeMatch(String pattern, String url) {
        if (pattern.length() > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
            try { return java.util.regex.Pattern.compile(pattern.substring(1, pattern.length() - 1)).matcher(url).find(); }
            catch (Exception ignored) { return false; }
        }
        return glob(pattern,url);
    }

    private static boolean matchPattern(String rule, URI target) {
        try {
            int separator = rule.indexOf("://");
            if (separator < 0) return false;
            String scheme = rule.substring(0, separator);
            String rest = rule.substring(separator+3);
            int slash=rest.indexOf('/'); if(slash<0) return false;
            String host=rest.substring(0,slash), path=rest.substring(slash);
            if (!(scheme.equals("*") ? ("http".equals(target.getScheme())||"https".equals(target.getScheme())) : scheme.equalsIgnoreCase(target.getScheme()))) return false;
            if (!matchesHost(target.getHost(),host)) return false;
            return glob(path,target.getRawPath() + (target.getRawQuery() == null ? "" : "?"+target.getRawQuery()) + (target.getRawFragment() == null ? "" : "#"+target.getRawFragment()));
        } catch(Exception e) { return false; }
    }

    private boolean hasGrant(InstalledScript script, String name) {
        JSONArray list=script.metadata.optJSONArray("grants");
        if(list==null) return false;
        String alternate;
        switch(name) {
            case "GM_xmlhttpRequest": alternate="GM.xmlHttpRequest"; break;
            case "GM_download": alternate="GM.download"; break;
            case "GM_setValue": alternate="GM.setValue"; break;
            case "GM_getValue": alternate="GM.getValue"; break;
            case "GM_deleteValue": alternate="GM.deleteValue"; break;
            case "GM_listValues": alternate="GM.listValues"; break;
            case "GM_registerMenuCommand": alternate="GM.registerMenuCommand"; break;
            default: alternate=name;
        }
        for(int i=0;i<list.length();i++) {
            String grant=list.optString(i);
            if(name.equals(grant) || alternate.equals(grant)) return true;
        }
        return false;
    }

    private void receive(JSONObject payload, String sourceOrigin, JavaScriptReplyProxy proxy, String runtimeWorld) throws Exception {
        String id=payload.optString("id"), secret=payload.optString("token"), op=payload.optString("op");
        InstalledScript script = scripts.get(id);
        if(script==null || !script.secret.equals(secret) || !matchesScript(script,webView.getUrl())) return;
        if (runsInPage(script) != "page".equals(runtimeWorld)) return;
        if(!sameOrigin(sourceOrigin, webView.getUrl())) return;
        script.proxy = proxy;
        if (privateMode && op.startsWith("download")) {
            failDownload(payload.optString("req", ""), "隐私模式不允许脚本自动保存文件，请退出隐私模式后重试", proxy);
            return;
        }
        if ("set".equals(op) && hasGrant(script,"GM_setValue")) {
            String key=payload.optString("key");
            if(key.length()==0 || key.length()>256) return;
            String serialized=payload.optString("value"); if(serialized.length()>100000) return;
            JSONObject current=new JSONObject(storage.getString(script.id,"{}"));
            current.put(key,new org.json.JSONTokener(serialized).nextValue());
            storage.edit().putString(script.id,current.toString()).apply();
        } else if ("delete".equals(op) && hasGrant(script,"GM_deleteValue")) {
            String key=payload.optString("key");
            if(key.length()==0 || key.length()>256) return;
            JSONObject current=new JSONObject(storage.getString(script.id,"{}"));
            current.remove(key);
            storage.edit().putString(script.id,current.toString()).apply();
        } else if ("menu".equals(op) && hasGrant(script,"GM_registerMenuCommand")) {
            String key=payload.optString("key"),title=payload.optString("title");
            if(key.length()>64 || title.length()>100 || title.isEmpty()) return;
            synchronized(menus) { menus.removeIf(menu->menu.script==script && menu.key.equals(key)); menus.add(new MenuCommand(script,key,title)); }
        } else if("http".equals(op) && hasGrant(script,"GM_xmlhttpRequest")) {
            handleHttp(script,payload,proxy);
        } else if("abort".equals(op) && hasGrant(script,"GM_xmlhttpRequest")) {
            Call call=activeRequests.remove(id+":"+payload.optString("req")); if(call!=null)call.cancel();
        } else if("downloadStart".equals(op) && hasGrant(script,"GM_download")) {
            startTransfer(script,payload,proxy);
        } else if("downloadChunk".equals(op) && hasGrant(script,"GM_download")) {
            writeChunk(script,payload,proxy);
        } else if("downloadFinish".equals(op) && hasGrant(script,"GM_download")) {
            finishTransfer(script,payload,proxy);
        } else if("downloadUrl".equals(op) && hasGrant(script,"GM_download")) {
            downloadUrl(script,payload,proxy);
        }
    }

    private static boolean sameOrigin(String origin,String address) {
        try {
            URI a=new URI(origin),b=new URI(address);
            return a.getScheme().equalsIgnoreCase(b.getScheme()) && a.getHost().equalsIgnoreCase(b.getHost()) && (a.getPort()==b.getPort());
        } catch(Exception e){return false;}
    }

    private boolean hostAllowed(InstalledScript script,String address) {
        try {
            URI uri=new URI(address);
            if(!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return false;
            if(uri.getHost()==null || uri.getUserInfo()!=null) return false;
            JSONArray hosts=script.metadata.optJSONArray("connects");
            if(hosts==null) return false;
            for(int i=0;i<hosts.length();i++) if(matchesHost(uri.getHost(),hosts.optString(i))) return true;
            return false;
        } catch(Exception e){return false;}
    }

    private Call trackedCall(Request request) {
        Call call = client.newCall(request);
        ownedCalls.add(call);
        // Covers close racing with registration, before OkHttp starts executing the call.
        if (closed) call.cancel();
        return call;
    }

    private void send(JavaScriptReplyProxy proxy,JSONObject event) {
        if(closed)return;
        mainHandler.post(()->{ if(!closed)try {proxy.postMessage(event.toString());}catch(Exception ignored){} });
    }

    private void handleHttp(InstalledScript script,JSONObject payload,JavaScriptReplyProxy proxy) {
        String req=payload.optString("req"), url=payload.optString("url"),method=payload.optString("method","GET").toUpperCase();
        if(req.isEmpty() || req.length()>80 || !hostAllowed(script,url)) {
            failHttp(req,"未经 @connect 授权的请求",proxy); return;
        }
        if (!Arrays.asList("GET","POST","HEAD","PUT","DELETE","PATCH").contains(method)) {failHttp(req,"无效请求方法",proxy);return;}
        executor.execute(()->{
            try {
                String current=url;
                for(int redirect=0;redirect<6;redirect++) {
                    if(closed)return;
                    if(!hostAllowed(script,current)) {failHttp(req,"重定向超出 @connect 授权",proxy);return;}
                    String body=payload.optString("data", "");
                    RequestBody requestBody=Arrays.asList("POST","PUT","PATCH").contains(method) ? RequestBody.create(body, MediaType.parse("application/octet-stream")) : null;
                    Request.Builder builder=new Request.Builder().url(current).method(method,requestBody);
                    JSONObject headers=payload.optJSONObject("headers");
                    if(headers!=null) {
                        java.util.Iterator<String> keys=headers.keys();
                        while(keys.hasNext()) {
                            String key=keys.next();
                            if("host".equalsIgnoreCase(key) || "cookie".equalsIgnoreCase(key) || "content-length".equalsIgnoreCase(key)) continue;
                            builder.header(key,headers.optString(key));
                        }
                    }
                    String cookie=CookieManager.getInstance().getCookie(current);
                    if(cookie!=null)builder.header("Cookie",cookie);
                    Call call=trackedCall(builder.build()); activeRequests.put(script.id+":"+req,call);
                    try(Response response=call.execute()) {
                        int status=response.code();
                        if(status>=300 && status<400 && response.header("Location")!=null) {
                            URI next=new URI(current).resolve(response.header("Location"));
                            if(!hostAllowed(script,next.toString())) {failHttp(req,"重定向超出 @connect 授权",proxy);return;}
                            current=next.toString(); continue;
                        }
                        ByteArrayOutputStream collected = new ByteArrayOutputStream();
                        long total=response.body()!=null?response.body().contentLength():0;
                        long lastProgress=0;
                        if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("body too large");
                        if (response.body()!=null) try(InputStream stream=response.body().byteStream()) {
                            byte[] buffer=new byte[8192];int count;
                            while((count=stream.read(buffer))!=-1) {
                                if (collected.size()+count>MAX_RESPONSE_BYTES) throw new IllegalStateException("body too large");
                                collected.write(buffer,0,count);
                                long now=System.currentTimeMillis();
                                if(now-lastProgress>150 || (total>0 && collected.size()==total)) {
                                    JSONObject progress=new JSONObject();progress.put("event","httpProgress");
                                    progress.put("req",req);progress.put("loaded",collected.size());progress.put("total",total);
                                    send(proxy,progress);lastProgress=now;
                                }
                            }
                        }
                        JSONObject event=new JSONObject();event.put("event","httpLoad");event.put("req",req);
                        event.put("status",status);event.put("finalUrl",current);
                        event.put("data",Base64.encodeToString(collected.toByteArray(),Base64.NO_WRAP));
                        event.put("contentType",response.header("Content-Type","application/octet-stream"));
                        send(proxy,event);return;
                    } finally {activeRequests.remove(script.id+":"+req, call); ownedCalls.remove(call);}
                }
                failHttp(req,"请求重定向次数过多",proxy);
            } catch(Exception e) {failHttp(req,"网络请求失败: "+e.getClass().getSimpleName(),proxy);}
        });
    }

    private void failHttp(String req,String reason,JavaScriptReplyProxy proxy) {
        try { JSONObject event=new JSONObject();event.put("event","httpError");event.put("req",req);event.put("message",reason);send(proxy,event); }
        catch(Exception ignored) {}
    }

    private String cleanFilename(String name) {
        String clean=name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_").trim();
        if(clean.length()>120)clean=clean.substring(0,120);
        return clean.isEmpty()?"download.bin":clean;
    }

    private void startTransfer(InstalledScript script,JSONObject payload,JavaScriptReplyProxy proxy) throws Exception {
        String rid=payload.optString("req");if(rid.length()<1||rid.length()>80)return;
        String fileName=cleanFilename(payload.optString("name","download.bin"));
        File directory=new File(context.getCacheDir(),"userscript-downloads");
        if(!directory.isDirectory()&&!directory.mkdirs()) throw new IllegalStateException("download cache unavailable");
        File file=File.createTempFile("nn-userscript-",".partial",directory);
        DownloadTransfer transfer=new DownloadTransfer(rid,script,file,new FileOutputStream(file),fileName);
        downloads.put(script.id+":"+rid,transfer);
        JSONObject ack=new JSONObject();ack.put("event","downloadAck");ack.put("req",rid);send(proxy,ack);
    }

    private void writeChunk(InstalledScript script,JSONObject payload,JavaScriptReplyProxy proxy) throws Exception {
        String rid=payload.optString("req");
        DownloadTransfer t=downloads.get(script.id+":"+rid);
        if(t==null)return;
        byte[] bytes=Base64.decode(payload.optString("data"),Base64.DEFAULT);
        if(bytes.length>75000||t.size+bytes.length>512L*1024*1024) throw new IllegalArgumentException("download too large");
        t.stream.write(bytes);t.size+=bytes.length;
        JSONObject ack=new JSONObject();ack.put("event","downloadAck");ack.put("req",rid);send(proxy,ack);
    }

    private void finishTransfer(InstalledScript script,JSONObject payload,JavaScriptReplyProxy proxy) throws Exception {
        String rid=payload.optString("req");
        DownloadTransfer t=downloads.remove(script.id+":"+rid);
        if(t==null)return;
        t.stream.close();
        executor.execute(()->{
            try {
                saveCompletedDownload(t.file,t.filename);
                JSONObject event=new JSONObject();event.put("event","downloadDone");event.put("req",rid);send(proxy,event);
            } catch(Exception e) {failDownload(rid,e.getMessage(),proxy);}
            finally {t.file.delete();}
        });
    }

    private void failDownload(String rid,String reason,JavaScriptReplyProxy proxy) {
        try {JSONObject error=new JSONObject();error.put("event","downloadError");error.put("req",rid);error.put("message",reason);send(proxy,error);}catch(Exception ignored){}
    }

    private void downloadUrl(InstalledScript script,JSONObject payload,JavaScriptReplyProxy proxy) {
        String req=payload.optString("req"),url=payload.optString("url");
        if(!hostAllowed(script,url)) {failDownload(req,"目标不在 @connect 授权范围",proxy);return;}
        executor.execute(()->{
            File tmp=null;
            try {
                String current=url;
                File directory=new File(context.getCacheDir(),"userscript-downloads");
                if(!directory.isDirectory()&&!directory.mkdirs())throw new IllegalStateException("下载缓存不可用");
                tmp=File.createTempFile("nn-url-",".partial",directory);
                boolean completed=false;
                for(int redirected=0;redirected<6;redirected++) {
                    if(closed)return;
                    if(!hostAllowed(script,current))throw new SecurityException("重定向超出 @connect 授权范围");
                    Request.Builder builder=new Request.Builder().url(current);
                    String cookie=CookieManager.getInstance().getCookie(current);
                    if(cookie!=null)builder.header("Cookie",cookie);
                    Call call=trackedCall(builder.build());
                    try(Response response=call.execute()) {
                        if(response.code()>=300 && response.code()<400 && response.header("Location")!=null) {
                            current=new URI(current).resolve(response.header("Location")).toString();
                            continue;
                        }
                        if(!response.isSuccessful() || response.body()==null)throw new IllegalStateException("下载 HTTP "+response.code());
                        long contentLength=response.body().contentLength();
                        if(contentLength>512L*1024L*1024L)throw new IllegalStateException("文件超过大小限制");
                        long count=0;
                        try(InputStream in=response.body().byteStream();FileOutputStream out=new FileOutputStream(tmp)) {
                            byte[] buffer=new byte[32768];int n;
                            while((n=in.read(buffer))!=-1) {
                                count+=n;
                                if(count>512L*1024L*1024L)throw new IllegalStateException("文件超过大小限制");
                                if(closed)throw new IllegalStateException("下载已取消");
                                out.write(buffer,0,n);
                            }
                        }
                        completed=true;
                        break;
                    } finally { ownedCalls.remove(call); }
                }
                if(!completed)throw new IllegalStateException("重定向次数过多");
                saveCompletedDownload(tmp,cleanFilename(payload.optString("name","download.bin")));
                JSONObject event=new JSONObject();event.put("event","downloadDone");event.put("req",req);send(proxy,event);
            } catch(Exception e) {failDownload(req,"下载失败: "+e.getMessage(),proxy);}
            finally {if(tmp!=null)tmp.delete();}
        });
    }

    private void saveCompletedDownload(File file,String filename) throws Exception {
        // On Android 10+, MediaStore places downloads in a location owned by the system.
        // On older Android, use app-specific external storage without dangerous global-storage permissions.
        if(android.os.Build.VERSION.SDK_INT<29) {
            File folder=context.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
            if(folder==null || (!folder.isDirectory()&&!folder.mkdirs()))throw new IllegalStateException("下载目录不可用");
            File output=new File(folder,filename);
            if(!output.getCanonicalPath().startsWith(folder.getCanonicalPath()+File.separator))throw new SecurityException("非法文件名");
            try(InputStream in=new FileInputStream(file);FileOutputStream out=new FileOutputStream(output)) {
                byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
            }
            return;
        }
        android.content.ContentValues values=new android.content.ContentValues();
        values.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,filename);
        values.put(android.provider.MediaStore.MediaColumns.MIME_TYPE,"application/octet-stream");
        values.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
            android.os.Environment.DIRECTORY_DOWNLOADS+"/NewsNook");
        Uri uri=context.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
        if(uri==null)throw new IllegalStateException("系统下载目录不可用");
        boolean success=false;
        try(InputStream in=new FileInputStream(file);java.io.OutputStream out=context.getContentResolver().openOutputStream(uri)) {
            if(out==null)throw new IllegalStateException("无法保存文件");
            byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);
            success=true;
        } finally {if(!success)context.getContentResolver().delete(uri,null,null);}
    }

    void showMenus() {
        if (closed) return;
        ArrayList<MenuCommand> available;
        synchronized(menus) {available=new ArrayList<>(menus);}
        if(available.isEmpty()) {new AlertDialog.Builder(webView.getContext()).setMessage("当前页面没有用户脚本菜单").setPositiveButton("确定",null).show();return;}
        CharSequence[] choices=new CharSequence[available.size()];
        for(int i=0;i<available.size();i++)choices[i]=available.get(i).title;
        new AlertDialog.Builder(webView.getContext()).setTitle("用户脚本").setItems(choices,(dialog,index)->{
            MenuCommand command=available.get(index);
            if(command.script.proxy==null)return;
            try {JSONObject event=new JSONObject();event.put("event","menuInvoke");event.put("key",command.key);send(command.script.proxy,event);}catch(Exception ignored){}
        }).show();
    }

    void onNavigation(String url) {
        synchronized(menus){menus.clear();}
    }

    void close() { close(true); }

    void close(boolean removeWebViewBindings) {
        if (closed) return;
        closed=true;
        mainHandler.removeCallbacksAndMessages(null);
        client.dispatcher().cancelAll();
        for(Call call:ownedCalls)call.cancel();
        ownedCalls.clear();
        for(Call call:activeRequests.values())call.cancel();
        activeRequests.clear();
        for(DownloadTransfer transfer:downloads.values()){
            try {transfer.stream.close();} catch(Exception ignored) {}
            transfer.file.delete();
        }
        downloads.clear();
        executor.shutdownNow();
        if (removeWebViewBindings) {
            for (ScriptHandler handler : scriptHandlers) {
                try { handler.remove(); }
                catch (RuntimeException error) { if (!privateMode) android.util.Log.w("NewsNookBrowser", "Script binding already unavailable", error); }
            }
            for (JavaScriptExecutionWorld world : listenerWorlds) {
                try { WebViewCompat.removeWebMessageListener(webView, world, JS_PORT); }
                catch (RuntimeException error) { if (!privateMode) android.util.Log.w("NewsNookBrowser", "Script listener already unavailable", error); }
            }
        }
        scriptHandlers.clear();
        listenerWorlds.clear();
        synchronized (menus) { menus.clear(); }
        synchronized (scripts) {
            for (InstalledScript script : scripts.values()) script.proxy = null;
            scripts.clear();
        }
    }
}
