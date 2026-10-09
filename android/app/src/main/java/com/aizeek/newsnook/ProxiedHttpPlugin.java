package com.aizeek.newsnook;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import okhttp3.Authenticator;
import okhttp3.Credentials;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okhttp3.Route;

/**
 * 支持可选 HTTP / SOCKS5 隧道的原生 HTTP。
 * CapacitorHttp 无法配置 Proxy，国际源需经用户代理时走本插件。
 */
@CapacitorPlugin(name = "ProxiedHttp")
public class ProxiedHttpPlugin extends Plugin {

    private static final MediaType FORM =
        MediaType.parse("application/x-www-form-urlencoded; charset=UTF-8");

    // OkHttpClient 本身就是面向进程复用设计的。每个请求都 new client 会同时丢掉
    // DNS/连接池/TLS session 复用，知乎这类连续分页请求会被放大成大量 TLS 握手。
    // newBuilder() 仍允许每个请求设置独立超时/代理，但共享 dispatcher 与 connectionPool。
    private final OkHttpClient sharedClient = new OkHttpClient.Builder()
        .retryOnConnectionFailure(true)
        .build();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少 url");
            return;
        }

        String method = call.getString("method", "GET");
        if (method == null) method = "GET";
        method = method.toUpperCase();

        JSObject headersObj = call.getObject("headers");
        String body = call.getString("data");
        String bodyBase64 = call.getString("dataBase64");
        boolean omitContentType = Boolean.TRUE.equals(call.getBoolean("omitContentType", false));
        JSObject proxyObj = call.getObject("proxy");

        int connectTimeout = call.getInt("connectTimeout", 15000);
        int readTimeout = call.getInt("readTimeout", 25000);
        boolean followRedirects = Boolean.TRUE.equals(call.getBoolean("followRedirects", false));

        OkHttpClient.Builder clientBuilder = sharedClient.newBuilder()
            .connectTimeout(connectTimeout, TimeUnit.MILLISECONDS)
            .readTimeout(readTimeout, TimeUnit.MILLISECONDS)
            .writeTimeout(readTimeout, TimeUnit.MILLISECONDS)
            .followRedirects(followRedirects)
            .followSslRedirects(followRedirects);

        if (proxyObj != null) {
            String type = proxyObj.getString("type", "http");
            String host = proxyObj.getString("host");
            Integer portValue = proxyObj.getInteger("port");
            if (portValue == null) {
                int optPort = proxyObj.optInt("port", -1);
                if (optPort > 0) {
                    portValue = optPort;
                }
            }
            if (host == null || host.isEmpty() || portValue == null || portValue <= 0) {
                call.reject("代理主机或端口无效");
                return;
            }
            final int port = portValue;
            Proxy.Type proxyType =
                "socks5".equalsIgnoreCase(type) ? Proxy.Type.SOCKS : Proxy.Type.HTTP;
            clientBuilder.proxy(new Proxy(proxyType, new InetSocketAddress(host, port)));

            String username = proxyObj.getString("username");
            String password = proxyObj.getString("password");
            if (username != null && !username.isEmpty()) {
                final String user = username;
                final String pass = password != null ? password : "";
                clientBuilder.proxyAuthenticator(new Authenticator() {
                    @Override
                    public Request authenticate(Route route, Response response) {
                        if (response.request().header("Proxy-Authorization") != null) {
                            return null;
                        }
                        String credential = Credentials.basic(user, pass);
                        return response.request().newBuilder()
                            .header("Proxy-Authorization", credential)
                            .build();
                    }
                });
            }
        }

        Request.Builder requestBuilder = new Request.Builder().url(url);
        if (headersObj != null) {
            Iterator<String> keys = headersObj.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                String value = headersObj.getString(key);
                if (value != null) {
                    requestBuilder.header(key, value);
                }
            }
        }

        if ("POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method)) {
            String contentType = headersObj != null ? headersObj.getString("Content-Type") : null;
            MediaType mediaType = omitContentType ? null : (contentType != null ? MediaType.parse(contentType) : FORM);
            RequestBody requestBody;
            if (bodyBase64 != null) {
                try {
                    requestBody = RequestBody.create(Base64.decode(bodyBase64, Base64.DEFAULT), mediaType);
                } catch (IllegalArgumentException error) {
                    call.reject("请求体 dataBase64 不是有效 base64");
                    return;
                }
            } else {
                requestBody = RequestBody.create(body != null ? body : "", mediaType);
            }
            requestBuilder.method(method, requestBody);
        } else if ("HEAD".equals(method) || "DELETE".equals(method)) {
            requestBuilder.method(method, null);
        } else {
            requestBuilder.get();
        }

        OkHttpClient client = clientBuilder.build();
        Request request = requestBuilder.build();

        try (Response response = client.newCall(request).execute()) {
            JSObject result = new JSObject();
            result.put("status", response.code());

            JSObject responseHeaders = new JSObject();
            for (String name : response.headers().names()) {
                responseHeaders.put(name, response.header(name));
            }
            result.put("headers", responseHeaders);

            // Headers.get()/response.header() 只能得到同名 header 的最后一个值。
            // Set-Cookie 不能安全用逗号拼接（Expires 本身含逗号），因此单独把所有
            // Set-Cookie 原样返回给 JS，供需要长期会话的站点精确更新 cookie jar。
            JSArray setCookies = new JSArray();
            for (String setCookie : response.headers("Set-Cookie")) {
                setCookies.put(setCookie);
            }
            result.put("setCookies", setCookies);

            ResponseBody responseBody = response.body();
            byte[] bytes = responseBody != null ? responseBody.bytes() : new byte[0];
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(result);
        } catch (IOException error) {
            call.reject(error.getMessage() != null ? error.getMessage() : "网络请求失败");
        }
    }
}
