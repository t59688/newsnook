package com.aizeek.newsnook;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.MulticastSocket;
import java.net.NetworkInterface;
import java.net.Proxy;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * Minimal UPnP/DLNA MediaRenderer controller for InkVideoPlayer.
 *
 * Discovery is SSDP; playback uses AVTransport and optional RenderingControl.
 * No vendor SDK is required, so common DLNA televisions can be used without
 * adding another production dependency.
 */
@CapacitorPlugin(
    name = "DlnaCast",
    permissions = {
        @Permission(
            alias = "nearbyWifi",
            strings = { Manifest.permission.NEARBY_WIFI_DEVICES }
        )
    }
)
public class DlnaCastPlugin extends Plugin {

    private static final String SSDP_ADDRESS = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int MIN_DISCOVERY_MS = 800;
    private static final int MAX_DISCOVERY_MS = 6000;
    private static final int MAX_DISCOVERY_LOCATIONS = 64;
    private static final int SSDP_RETRY_DELAY_MS = 500;
    private static final int DIRECT_PROBE_MS = 3200;
    private static final int RESTORE_DISCOVERY_MS = 2000;
    private static final long SAVED_CAST_TTL_MS = 12L * 60L * 60L * 1000L;
    private static final String TAG = "NewsNookDlna";
    private static final String MODE_DIRECT = "direct";
    private static final String MODE_PROXY = "proxy";
    private static final String CAST_PREFS = "newsnook_dlna_cast";
    private static final String LOCAL_NETWORK_PERMISSION_MESSAGE =
        "局域网访问被系统阻止。请在系统设置 > 应用 > NewsNook > 权限中允许“附近的设备”，然后重试";
    private static final String NO_LAN_MESSAGE =
        "未连接可用于投屏的 Wi-Fi 或有线网络，请先连接电视所在的局域网";

    private final ExecutorService executor = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "newsnook-dlna-" + System.nanoTime());
        thread.setDaemon(true);
        return thread;
    });
    private final Map<String, RendererDevice> devices = new ConcurrentHashMap<>();
    private final Map<String, CastSession> sessions = new ConcurrentHashMap<>();
    private final CastMediaProxy mediaProxy = CastMediaProxy.getInstance();

    private final OkHttpClient http = new OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .writeTimeout(4, TimeUnit.SECONDS)
        .callTimeout(6, TimeUnit.SECONDS)
        .build();

    @PluginMethod
    public void discover(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("nearbyWifi") != PermissionState.GRANTED
        ) {
            requestPermissionForAlias("nearbyWifi", call, "nearbyWifiPermissionCallback");
            return;
        }
        discoverAfterPermission(call);
    }

    @PermissionCallback
    private void nearbyWifiPermissionCallback(PluginCall call) {
        if (getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            call.reject("需要“附近的设备”权限才能搜索并投屏到电视");
            return;
        }
        discoverAfterPermission(call);
    }

    private void discoverAfterPermission(PluginCall call) {
        int requested = call.getInt("timeoutMs", 2600);
        int timeoutMs = Math.max(MIN_DISCOVERY_MS, Math.min(MAX_DISCOVERY_MS, requested));
        executor.execute(() -> {
            try {
                List<RendererDevice> found = discoverRenderers(timeoutMs);
                JSArray resultDevices = new JSArray();
                for (RendererDevice device : found) resultDevices.put(device.toJson());
                JSObject result = new JSObject();
                result.put("devices", resultDevices);
                call.resolve(result);
            } catch (SecurityException error) {
                rejectLocalNetworkPermission(call, error);
            } catch (Exception error) {
                if (isLocalNetworkPermissionError(error)) {
                    rejectLocalNetworkPermission(call, error);
                } else {
                    call.reject("搜索投屏设备失败：" + safeMessage(error), error);
                }
            }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String url = call.getString("url");
        String title = call.getString("title", "文章视频");
        String format = call.getString("format", "progressive");
        Double position = call.getDouble("positionSeconds");

        if (deviceId == null || deviceId.isEmpty()) {
            call.reject("缺少投屏设备");
            return;
        }
        if (!isHttpUrl(url)) {
            call.reject("当前视频是临时媒体流，无法发送到电视");
            return;
        }
        if ("dash".equalsIgnoreCase(format)) {
            call.reject("DASH 视频源暂不支持投屏");
            return;
        }

        RendererDevice device = devices.get(deviceId);
        if (device == null) {
            call.reject("投屏设备已失效，请重新搜索");
            return;
        }

        final double startPosition = position == null || !Double.isFinite(position)
            ? 0d
            : Math.max(0d, position);

        executor.execute(() -> {
            CastMediaProxy.SessionHandle relay = null;
            boolean relayRegistered = false;
            String mode = MODE_DIRECT;
            String transportUrl = url;
            try {
                boolean directReady = false;
                try {
                    setTransportUri(device, url, title, format);
                    playWithRetry(device);
                    directReady = confirmDirectPlayback(device);
                } catch (Exception directError) {
                    Log.i(TAG, "Direct cast unavailable for " + device.id + "; falling back to relay");
                }

                if (directReady) {
                    Context context = getContext();
                    if (context != null) {
                        DlnaCastForegroundService.releaseRelay(context, device.id);
                    }
                } else {
                    try {
                        soap(device.avTransport, "Stop", instanceBody());
                    } catch (IOException ignored) {
                        // The renderer may already be stopped or may reject Stop before media exists.
                    }
                    relay = mediaProxy.openSession(url, device.host, device.network);
                    Context context = getContext();
                    if (context == null) throw new IOException("无法启动投屏后台服务");
                    DlnaCastForegroundService.registerRelay(
                        context,
                        device.id,
                        device.name,
                        relay
                    );
                    relayRegistered = true;
                    mode = MODE_PROXY;
                    transportUrl = relay.url;
                    setTransportUri(device, transportUrl, title, format);
                    playWithRetry(device);
                }

                if (startPosition >= 1d) {
                    try {
                        seek(device, startPosition);
                    } catch (IOException ignored) {
                        // A few renderers reject Seek until playback has advanced once.
                    }
                }

                CastMediaProxy.SessionHandle activeRelay = MODE_PROXY.equals(mode)
                    ? DlnaCastForegroundService.findRelay(device.id, transportUrl)
                    : null;
                String sessionId = UUID.randomUUID().toString();
                CastSession session = new CastSession(
                    sessionId,
                    device,
                    activeRelay,
                    mode,
                    url,
                    transportUrl
                );
                sessions.put(sessionId, session);
                saveCastResume(session);

                Log.i(TAG, "Cast started renderer=" + device.id + " mode=" + mode);
                call.resolve(sessionToJson(session));
            } catch (Exception error) {
                Context context = getContext();
                if (relayRegistered && context != null) {
                    DlnaCastForegroundService.releaseRelay(context, device.id);
                } else if (relay != null) {
                    mediaProxy.closeSession(relay.token);
                }
                call.reject("无法开始投屏：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void restore(PluginCall call) {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("nearbyWifi") != PermissionState.GRANTED
        ) {
            call.resolve(new JSObject());
            return;
        }

        executor.execute(() -> {
            SavedCast saved = loadCastResume();
            if (saved == null) {
                call.resolve(new JSObject());
                return;
            }
            if (System.currentTimeMillis() - saved.savedAt > SAVED_CAST_TTL_MS) {
                clearCastResume(saved.rendererId);
                call.resolve(new JSObject());
                return;
            }

            CastMediaProxy.SessionHandle relay = null;
            if (MODE_PROXY.equals(saved.mode)) {
                relay = DlnaCastForegroundService.findRelay(saved.rendererId, saved.transportUrl);
                if (relay == null) {
                    clearCastResume(saved.rendererId);
                    call.resolve(new JSObject());
                    return;
                }
            }

            try {
                RendererDevice device = null;
                for (RendererDevice candidate : discoverRenderers(RESTORE_DISCOVERY_MS)) {
                    if (saved.rendererId.equals(candidate.id)) {
                        device = candidate;
                        break;
                    }
                }
                if (device == null) {
                    call.resolve(new JSObject());
                    return;
                }

                String state = readTransportState(device);
                if ("stopped".equals(state)) {
                    clearCastResume(saved.rendererId);
                    call.resolve(new JSObject());
                    return;
                }
                if (
                    !"playing".equals(state)
                        && !"paused".equals(state)
                        && !"transitioning".equals(state)
                ) {
                    call.resolve(new JSObject());
                    return;
                }

                String currentUri = readCurrentTransportUri(device);
                if (currentUri == null) {
                    call.resolve(new JSObject());
                    return;
                }
                if (!sameTransportUri(saved.transportUrl, currentUri)) {
                    clearCastResume(saved.rendererId);
                    call.resolve(new JSObject());
                    return;
                }

                String sessionId = UUID.randomUUID().toString();
                CastSession session = new CastSession(
                    sessionId,
                    device,
                    relay,
                    saved.mode,
                    saved.sourceUrl,
                    saved.transportUrl
                );
                sessions.put(sessionId, session);

                TransportStatus transport;
                try {
                    transport = readTransportStatus(device);
                } catch (IOException statusError) {
                    transport = new TransportStatus(state, 0d, 0d);
                }

                JSObject result = new JSObject();
                result.put("session", sessionToJson(session));
                result.put("status", statusToJson(session, transport));
                call.resolve(result);
            } catch (Exception error) {
                Log.d(TAG, "Cast restore deferred: " + safeMessage(error));
                call.resolve(new JSObject());
            }
        });
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        CastSession session = requireSession(call);
        if (session == null) return;

        executor.execute(() -> {
            try {
                TransportStatus transport = readTransportStatus(session.device);
                JSObject result = new JSObject();
                result.put("state", transport.state);
                result.put("current", transport.currentSeconds);
                result.put("duration", transport.durationSeconds);
                result.put("deviceName", session.device.name);

                if (session.device.renderingControl != null) {
                    try {
                        result.put("volume", readVolume(session.device));
                    } catch (IOException ignored) {
                        // Volume is optional; transport controls remain usable.
                    }
                }
                call.resolve(result);
            } catch (Exception error) {
                call.reject("读取投屏状态失败：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void control(PluginCall call) {
        CastSession session = requireSession(call);
        if (session == null) return;

        String action = call.getString("action");
        Double value = call.getDouble("value");
        if (action == null) {
            call.reject("缺少投屏控制命令");
            return;
        }

        executor.execute(() -> {
            try {
                switch (action) {
                    case "play":
                        soap(session.device.avTransport, "Play", playBody());
                        break;
                    case "pause":
                        soap(session.device.avTransport, "Pause", instanceBody());
                        break;
                    case "seek":
                        if (value == null || !Double.isFinite(value)) {
                            throw new IOException("缺少跳转位置");
                        }
                        seek(session.device, Math.max(0d, value));
                        break;
                    case "volume":
                        if (value == null || !Double.isFinite(value)) {
                            throw new IOException("缺少音量值");
                        }
                        setVolume(session.device, value);
                        break;
                    default:
                        throw new IOException("不支持的投屏控制命令");
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("投屏控制失败：" + safeMessage(error), error);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.resolve();
            return;
        }

        CastSession session = sessions.remove(sessionId);
        if (session == null) {
            call.resolve();
            return;
        }

        executor.execute(() -> {
            try {
                try {
                    soap(session.device.avTransport, "Stop", instanceBody());
                } catch (IOException ignored) {
                    // Renderer might already be offline. Always release local state.
                }
            } finally {
                if (MODE_PROXY.equals(session.mode)) {
                    Context context = getContext();
                    if (context != null) {
                        DlnaCastForegroundService.releaseRelay(context, session.device.id);
                    } else if (session.relay != null) {
                        mediaProxy.closeSession(session.relay.token);
                    }
                }
                clearCastResume(session.device.id);
                call.resolve();
            }
        });
    }

    private CastSession requireSession(PluginCall call) {
        String sessionId = call.getString("sessionId");
        CastSession session = sessionId == null ? null : sessions.get(sessionId);
        if (session == null) {
            call.reject("投屏会话已结束");
            return null;
        }
        return session;
    }

    private List<RendererDevice> discoverRenderers(int timeoutMs) throws IOException {
        Network lanNetwork = resolveLanNetwork();
        NetworkInterface multicastInterface = resolveMulticastInterface(lanNetwork);
        OkHttpClient lanHttp = httpForNetwork(lanNetwork);
        WifiManager.MulticastLock multicastLock = null;
        Context context = getContext();
        if (context != null) {
            WifiManager wifi = (WifiManager) context.getApplicationContext()
                .getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("newsnook-dlna-discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
        }

        try {
            Log.i(
                TAG,
                "Discovery start interface=" + multicastInterface.getName() + " timeoutMs=" + timeoutMs
            );
            Map<String, String> locations = collectSsdpLocations(
                timeoutMs,
                lanNetwork,
                multicastInterface
            );
            LinkedHashMap<String, RendererDevice> found = new LinkedHashMap<>();
            String lastDescriptionError = null;
            for (Map.Entry<String, String> entry : locations.entrySet()) {
                try {
                    RendererDevice device = readRendererDescription(
                        entry.getKey(),
                        entry.getValue(),
                        lanNetwork,
                        lanHttp
                    );
                    if (device == null || device.avTransport == null) {
                        Log.d(TAG, "Ignoring UPnP response without AVTransport: " + entry.getKey());
                        continue;
                    }
                    found.put(device.id, device);
                } catch (SecurityException error) {
                    throw error;
                } catch (Exception error) {
                    if (isLocalNetworkPermissionError(error)) {
                        throw new IOException(LOCAL_NETWORK_PERMISSION_MESSAGE, error);
                    }
                    lastDescriptionError = safeMessage(error);
                    Log.w(TAG, "Failed to read UPnP device description: " + entry.getKey(), error);
                    // One malformed/offline UPnP device must not hide other TVs.
                }
            }

            if (!locations.isEmpty() && found.isEmpty()) {
                String detail = lastDescriptionError == null ? "设备描述无效或缺少 AVTransport"
                    : lastDescriptionError;
                throw new IOException("已发现局域网设备，但无法读取投屏信息：" + detail);
            }

            Log.i(
                TAG,
                "Discovery finished responses=" + locations.size() + " renderers=" + found.size()
            );
            devices.clear();
            devices.putAll(found);
            return new ArrayList<>(found.values());
        } finally {
            if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
        }
    }

    private Network resolveLanNetwork() throws IOException {
        Context context = getContext();
        if (context == null) throw new IOException("无法访问系统网络服务");

        ConnectivityManager connectivity = (ConnectivityManager) context.getSystemService(
            Context.CONNECTIVITY_SERVICE
        );
        if (connectivity == null) throw new IOException("无法访问系统网络服务");

        Network active = connectivity.getActiveNetwork();
        if (
            active != null
                && isLanNetworkCapabilities(connectivity.getNetworkCapabilities(active))
        ) {
            return active;
        }

        for (Network network : connectivity.getAllNetworks()) {
            if (isLanNetworkCapabilities(connectivity.getNetworkCapabilities(network))) {
                return network;
            }
        }
        throw new IOException(NO_LAN_MESSAGE);
    }

    private NetworkInterface resolveMulticastInterface(Network network) throws IOException {
        Context context = getContext();
        if (context == null) throw new IOException("无法访问系统网络服务");

        ConnectivityManager connectivity = (ConnectivityManager) context.getSystemService(
            Context.CONNECTIVITY_SERVICE
        );
        if (connectivity == null) throw new IOException("无法访问系统网络服务");

        LinkProperties properties = connectivity.getLinkProperties(network);
        if (properties == null) throw new IOException("无法读取局域网接口信息");

        String interfaceName = properties.getInterfaceName();
        if (interfaceName != null && !interfaceName.trim().isEmpty()) {
            NetworkInterface byName = NetworkInterface.getByName(interfaceName);
            if (isUsableMulticastInterface(byName)) return byName;
        }

        for (LinkAddress linkAddress : properties.getLinkAddresses()) {
            InetAddress address = linkAddress.getAddress();
            if (address == null || address.isLoopbackAddress()) continue;
            NetworkInterface byAddress = NetworkInterface.getByInetAddress(address);
            if (isUsableMulticastInterface(byAddress)) return byAddress;
        }

        throw new IOException("无法确定局域网投屏接口");
    }

    private static boolean isUsableMulticastInterface(NetworkInterface networkInterface)
        throws IOException {
        return networkInterface != null
            && networkInterface.isUp()
            && !networkInterface.isLoopback();
    }

    static boolean isLanNetworkCapabilities(NetworkCapabilities capabilities) {
        if (capabilities == null) return false;
        boolean lanTransport =
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
        return lanTransport
            && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN);
    }

    private OkHttpClient httpForNetwork(Network network) {
        return http.newBuilder()
            .socketFactory(network.getSocketFactory())
            .dns(hostname -> Arrays.asList(network.getAllByName(hostname)))
            .proxy(Proxy.NO_PROXY)
            .build();
    }

    private Map<String, String> collectSsdpLocations(
        int timeoutMs,
        Network lanNetwork,
        NetworkInterface multicastInterface
    ) throws IOException {
        LinkedHashMap<String, String> locations = new LinkedHashMap<>();
        InetAddress group = InetAddress.getByName(SSDP_ADDRESS);
        long startedAt = System.currentTimeMillis();
        long deadline = startedAt + timeoutMs;
        long retryAt = startedAt + Math.min(SSDP_RETRY_DELAY_MS, Math.max(250, timeoutMs / 2));
        boolean retried = false;
        int responseCount = 0;

        try (MulticastSocket socket = new MulticastSocket(null)) {
            socket.setReuseAddress(true);
            // Keep the socket on the LAN even when Android's process default is VPN/cellular.
            lanNetwork.bindSocket(socket);
            socket.bind(new InetSocketAddress(0));
            // Network.bindSocket selects an Android Network, but multicast also needs
            // IP_MULTICAST_IF. Some OEM stacks otherwise send on Wi-Fi but do not receive
            // the unicast SSDP replies on the expected interface.
            socket.setNetworkInterface(multicastInterface);
            socket.setTimeToLive(2);
            socket.setSoTimeout(Math.min(200, timeoutMs));

            sendSearchBurst(socket, group);

            byte[] buffer = new byte[16 * 1024];
            while (System.currentTimeMillis() < deadline && locations.size() < MAX_DISCOVERY_LOCATIONS) {
                long now = System.currentTimeMillis();
                if (!retried && now >= retryAt) {
                    sendSearchBurst(socket, group);
                    if (locations.isEmpty()) {
                        // Some consumer renderers only answer broad discovery even though their
                        // device description exposes the standard MediaRenderer/AVTransport types.
                        sendSearch(socket, group, "ssdp:all");
                    }
                    retried = true;
                }

                DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                try {
                    socket.receive(packet);
                } catch (SocketTimeoutException timeout) {
                    continue;
                }
                responseCount++;
                String response = new String(
                    packet.getData(),
                    packet.getOffset(),
                    packet.getLength(),
                    StandardCharsets.ISO_8859_1
                );
                Map<String, String> headers = parseSsdpHeaders(response);
                String location = headers.get("location");
                if (!isHttpUrl(location)) continue;
                locations.putIfAbsent(location, headers.get("usn"));
            }
        }

        Log.i(
            TAG,
            "SSDP finished interface=" + multicastInterface.getName()
                + " packets=" + responseCount
                + " locations=" + locations.size()
        );
        return locations;
    }

    private static void sendSearchBurst(DatagramSocket socket, InetAddress group)
        throws IOException {
        sendSearch(socket, group, "urn:schemas-upnp-org:device:MediaRenderer:1");
        sendSearch(socket, group, "urn:schemas-upnp-org:device:MediaRenderer:2");
        sendSearch(socket, group, "urn:schemas-upnp-org:service:AVTransport:1");
        sendSearch(socket, group, "urn:schemas-upnp-org:service:AVTransport:2");
    }

    private static void sendSearch(DatagramSocket socket, InetAddress group, String searchTarget)
        throws IOException {
        String payload =
            "M-SEARCH * HTTP/1.1\r\n"
                + "HOST: " + SSDP_ADDRESS + ":" + SSDP_PORT + "\r\n"
                + "MAN: \"ssdp:discover\"\r\n"
                + "MX: 2\r\n"
                + "ST: " + searchTarget + "\r\n"
                + "\r\n";
        byte[] bytes = payload.getBytes(StandardCharsets.US_ASCII);
        socket.send(new DatagramPacket(bytes, bytes.length, group, SSDP_PORT));
    }

    private static Map<String, String> parseSsdpHeaders(String response) {
        LinkedHashMap<String, String> headers = new LinkedHashMap<>();
        if (response == null) return headers;
        for (String line : response.split("\\r?\\n")) {
            int separator = line.indexOf(':');
            if (separator <= 0) continue;
            String name = line.substring(0, separator).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(separator + 1).trim();
            if (!name.isEmpty() && !value.isEmpty()) headers.put(name, value);
        }
        return headers;
    }

    private RendererDevice readRendererDescription(
        String location,
        String usn,
        Network lanNetwork,
        OkHttpClient lanHttp
    ) throws Exception {
        Request request = new Request.Builder().url(location).get().build();
        try (Response response = lanHttp.newCall(request).execute()) {
            if (!response.isSuccessful()) return null;
            ResponseBody body = response.body();
            if (body == null) return null;

            Document document = parseXml(body.string());
            String deviceType = firstText(document, "deviceType");
            if (
                deviceType != null
                    && !deviceType.contains("MediaRenderer")
                    && !containsService(document, "AVTransport")
            ) {
                return null;
            }

            String friendlyName = firstText(document, "friendlyName");
            String manufacturer = firstText(document, "manufacturer");
            String model = firstText(document, "modelName");
            String udn = firstText(document, "UDN");

            ServiceEndpoint avTransport = null;
            ServiceEndpoint renderingControl = null;
            NodeList services = document.getElementsByTagNameNS("*", "service");
            if (services.getLength() == 0) services = document.getElementsByTagName("service");
            for (int index = 0; index < services.getLength(); index++) {
                if (!(services.item(index) instanceof Element)) continue;
                Element service = (Element) services.item(index);
                String serviceType = firstText(service, "serviceType");
                String controlUrl = firstText(service, "controlURL");
                if (serviceType == null || controlUrl == null) continue;

                String resolved = new URL(new URL(location), controlUrl).toString();
                if (serviceType.contains(":service:AVTransport:")) {
                    avTransport = new ServiceEndpoint(serviceType, resolved, lanHttp);
                } else if (serviceType.contains(":service:RenderingControl:")) {
                    renderingControl = new ServiceEndpoint(serviceType, resolved, lanHttp);
                }
            }
            if (avTransport == null) return null;

            URL descriptionUrl = new URL(location);
            String id = nonEmpty(udn, nonEmpty(usn, location));
            String name = nonEmpty(friendlyName, nonEmpty(model, descriptionUrl.getHost()));
            return new RendererDevice(
                id,
                name,
                emptyToNull(manufacturer),
                emptyToNull(model),
                descriptionUrl.getHost(),
                lanNetwork,
                location,
                avTransport,
                renderingControl
            );
        }
    }

    private static boolean containsService(Document document, String needle) {
        NodeList serviceTypes = document.getElementsByTagNameNS("*", "serviceType");
        if (serviceTypes.getLength() == 0) serviceTypes = document.getElementsByTagName("serviceType");
        for (int index = 0; index < serviceTypes.getLength(); index++) {
            String value = serviceTypes.item(index).getTextContent();
            if (value != null && value.contains(needle)) return true;
        }
        return false;
    }


    private void playWithRetry(RendererDevice device) throws IOException {
        try {
            soap(device.avTransport, "Play", playBody());
        } catch (IOException first) {
            try {
                Thread.sleep(180L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw first;
            }
            soap(device.avTransport, "Play", playBody());
        }
    }

    private boolean confirmDirectPlayback(RendererDevice device) throws IOException {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(DIRECT_PROBE_MS);
        long playingSince = -1L;
        boolean observedPlaying = false;
        IOException lastError = null;

        while (System.nanoTime() < deadline) {
            try {
                String state = readTransportState(device);
                if ("playing".equals(state)) {
                    observedPlaying = true;
                    if (playingSince < 0L) playingSince = System.nanoTime();
                    if (
                        System.nanoTime() - playingSince
                            >= TimeUnit.MILLISECONDS.toNanos(1800L)
                    ) {
                        return true;
                    }
                } else if ("stopped".equals(state) && observedPlaying) {
                    return false;
                } else if (!"transitioning".equals(state)) {
                    playingSince = -1L;
                }
            } catch (IOException error) {
                lastError = error;
            }

            try {
                Thread.sleep(300L);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IOException("投屏连接被中断", interrupted);
            }
        }

        if (!observedPlaying && lastError != null) throw lastError;
        return false;
    }

    private String readTransportState(RendererDevice device) throws IOException {
        String xml = soap(device.avTransport, "GetTransportInfo", instanceBody());
        return normalizeTransportState(textFromXml(xml, "CurrentTransportState"));
    }

    private String readCurrentTransportUri(RendererDevice device) throws IOException {
        String positionXml = soap(device.avTransport, "GetPositionInfo", instanceBody());
        String trackUri = emptyToNull(textFromXml(positionXml, "TrackURI"));
        if (trackUri != null) return trackUri;

        String mediaXml = soap(device.avTransport, "GetMediaInfo", instanceBody());
        return emptyToNull(textFromXml(mediaXml, "CurrentURI"));
    }

    private static boolean sameTransportUri(String expected, String actual) {
        String left = emptyToNull(expected);
        String right = emptyToNull(actual);
        return left != null && left.equals(right);
    }

    private void setTransportUri(
        RendererDevice device,
        String mediaUrl,
        String title,
        String format
    ) throws IOException {
        String metadata = didlMetadata(mediaUrl, title, mimeFor(mediaUrl, format));
        String body =
            "<InstanceID>0</InstanceID>"
                + "<CurrentURI>" + xmlEscape(mediaUrl) + "</CurrentURI>"
                + "<CurrentURIMetaData>" + xmlEscape(metadata) + "</CurrentURIMetaData>";
        try {
            soap(device.avTransport, "SetAVTransportURI", body);
        } catch (IOException metadataRejected) {
            // Some older TVs reject DIDL metadata but accept the same URI with an empty metadata field.
            String fallback =
                "<InstanceID>0</InstanceID>"
                    + "<CurrentURI>" + xmlEscape(mediaUrl) + "</CurrentURI>"
                    + "<CurrentURIMetaData></CurrentURIMetaData>";
            soap(device.avTransport, "SetAVTransportURI", fallback);
        }
    }

    private TransportStatus readTransportStatus(RendererDevice device) throws IOException {
        String transportXml = soap(device.avTransport, "GetTransportInfo", instanceBody());
        String positionXml = soap(device.avTransport, "GetPositionInfo", instanceBody());

        String rawState = textFromXml(transportXml, "CurrentTransportState");
        String relTime = textFromXml(positionXml, "RelTime");
        String trackDuration = textFromXml(positionXml, "TrackDuration");
        return new TransportStatus(
            normalizeTransportState(rawState),
            parseUpnpTime(relTime),
            parseUpnpTime(trackDuration)
        );
    }

    private double readVolume(RendererDevice device) throws IOException {
        if (device.renderingControl == null) throw new IOException("设备不支持音量控制");
        String xml = soap(
            device.renderingControl,
            "GetVolume",
            "<InstanceID>0</InstanceID><Channel>Master</Channel>"
        );
        String raw = textFromXml(xml, "CurrentVolume");
        try {
            int volume = Integer.parseInt(raw == null ? "" : raw.trim());
            return clamp01(volume / 100d);
        } catch (NumberFormatException error) {
            throw new IOException("设备返回了无效音量", error);
        }
    }

    private void setVolume(RendererDevice device, double value) throws IOException {
        if (device.renderingControl == null) throw new IOException("设备不支持音量控制");
        int volume = (int) Math.round(clamp01(value) * 100d);
        soap(
            device.renderingControl,
            "SetVolume",
            "<InstanceID>0</InstanceID>"
                + "<Channel>Master</Channel>"
                + "<DesiredVolume>" + volume + "</DesiredVolume>"
        );
    }

    private void seek(RendererDevice device, double seconds) throws IOException {
        soap(
            device.avTransport,
            "Seek",
            "<InstanceID>0</InstanceID>"
                + "<Unit>REL_TIME</Unit>"
                + "<Target>" + formatUpnpTime(seconds) + "</Target>"
        );
    }

    private String soap(ServiceEndpoint endpoint, String action, String actionBody)
        throws IOException {
        String envelope =
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>"
                + "<s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\""
                + " s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\">"
                + "<s:Body>"
                + "<u:" + action + " xmlns:u=\"" + xmlEscape(endpoint.serviceType) + "\">"
                + actionBody
                + "</u:" + action + ">"
                + "</s:Body></s:Envelope>";

        MediaType xml = MediaType.parse("text/xml; charset=utf-8");
        RequestBody requestBody = RequestBody.create(xml, envelope);
        Request request = new Request.Builder()
            .url(endpoint.controlUrl)
            .post(requestBody)
            .header("Content-Type", "text/xml; charset=\"utf-8\"")
            .header("SOAPACTION", "\"" + endpoint.serviceType + "#" + action + "\"")
            .build();

        try (Response response = endpoint.http.newCall(request).execute()) {
            ResponseBody body = response.body();
            String responseText = body == null ? "" : body.string();
            if (!response.isSuccessful()) {
                String detail = textFromXml(responseText, "errorDescription");
                throw new IOException(
                    action + " failed (" + response.code() + ")"
                        + (detail == null || detail.isEmpty() ? "" : ": " + detail)
                );
            }
            return responseText;
        }
    }

    private static String didlMetadata(String mediaUrl, String title, String mime) {
        return
            "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\""
                + " xmlns:dc=\"http://purl.org/dc/elements/1.1/\""
                + " xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">"
                + "<item id=\"0\" parentID=\"0\" restricted=\"1\">"
                + "<dc:title>" + xmlEscape(nonEmpty(title, "文章视频")) + "</dc:title>"
                + "<upnp:class>object.item.videoItem</upnp:class>"
                + "<res protocolInfo=\"http-get:*:" + xmlEscape(mime) + ":*\">"
                + xmlEscape(mediaUrl)
                + "</res></item></DIDL-Lite>";
    }

    private static String mimeFor(String url, String format) {
        if ("hls".equalsIgnoreCase(format)) return "application/vnd.apple.mpegurl";
        String lower = url == null ? "" : url.toLowerCase(Locale.ROOT);
        if (lower.contains(".webm")) return "video/webm";
        if (lower.contains(".mov")) return "video/quicktime";
        if (lower.contains(".mkv")) return "video/x-matroska";
        return "video/mp4";
    }

    private static String instanceBody() {
        return "<InstanceID>0</InstanceID>";
    }

    private static String playBody() {
        return "<InstanceID>0</InstanceID><Speed>1</Speed>";
    }

    private static String normalizeTransportState(String state) {
        if (state == null) return "unknown";
        String upper = state.trim().toUpperCase(Locale.ROOT);
        if ("PLAYING".equals(upper)) return "playing";
        if (upper.startsWith("PAUSED")) return "paused";
        if ("STOPPED".equals(upper) || "NO_MEDIA_PRESENT".equals(upper)) return "stopped";
        if ("TRANSITIONING".equals(upper)) return "transitioning";
        return "unknown";
    }

    private static double parseUpnpTime(String value) {
        if (value == null || value.isEmpty() || "NOT_IMPLEMENTED".equalsIgnoreCase(value)) return 0d;
        try {
            String[] parts = value.trim().split(":");
            if (parts.length != 3) return 0d;
            double hours = Double.parseDouble(parts[0]);
            double minutes = Double.parseDouble(parts[1]);
            double seconds = Double.parseDouble(parts[2]);
            return Math.max(0d, hours * 3600d + minutes * 60d + seconds);
        } catch (NumberFormatException ignored) {
            return 0d;
        }
    }

    private static String formatUpnpTime(double seconds) {
        long total = Math.max(0L, Math.round(seconds));
        long hours = total / 3600L;
        long minutes = (total % 3600L) / 60L;
        long secs = total % 60L;
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, secs);
    }

    private static Document parseXml(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        trySetParserOption(factory, () -> factory.setXIncludeAware(false));
        trySetParserOption(factory, () -> factory.setExpandEntityReferences(false));
        trySetFeature(factory, "http://apache.org/xml/features/disallow-doctype-decl", true);
        trySetFeature(factory, "http://xml.org/sax/features/external-general-entities", false);
        trySetFeature(factory, "http://xml.org/sax/features/external-parameter-entities", false);
        trySetFeature(factory, "http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        // Android's javax.xml.XMLConstants lacks ACCESS_EXTERNAL_* fields; use JAXP URIs.
        try {
            factory.setAttribute(
                "http://javax.xml.XMLConstants/property/accessExternalDTD",
                ""
            );
            factory.setAttribute(
                "http://javax.xml.XMLConstants/property/accessExternalSchema",
                ""
            );
        } catch (IllegalArgumentException ignored) {
            // Older Android XML implementations may not expose these JAXP attributes.
        }

        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(
            new java.io.ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))
        );
    }

    private static void trySetFeature(
        DocumentBuilderFactory factory,
        String feature,
        boolean value
    ) {
        try {
            factory.setFeature(feature, value);
        } catch (Exception ignored) {
            // Harden where supported without dropping compatibility with older Android XML parsers.
        }
    }

    private static void trySetParserOption(DocumentBuilderFactory factory, Runnable option) {
        try {
            option.run();
        } catch (Exception ignored) {
            // Android's bundled parser often reports spec "Unknown" and rejects XInclude toggles.
        }
    }

    private static String firstText(Document document, String localName) {
        NodeList nodes = document.getElementsByTagNameNS("*", localName);
        if (nodes.getLength() == 0) nodes = document.getElementsByTagName(localName);
        if (nodes.getLength() == 0) return null;
        String value = nodes.item(0).getTextContent();
        return emptyToNull(value);
    }

    private static String firstText(Element element, String localName) {
        NodeList nodes = element.getElementsByTagNameNS("*", localName);
        if (nodes.getLength() == 0) nodes = element.getElementsByTagName(localName);
        if (nodes.getLength() == 0) return null;
        String value = nodes.item(0).getTextContent();
        return emptyToNull(value);
    }

    private static String textFromXml(String xml, String localName) {
        if (xml == null || xml.isEmpty()) return null;
        try {
            return firstText(parseXml(xml), localName);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String xmlEscape(String value) {
        if (value == null) return "";
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }

    private static double clamp01(double value) {
        return Math.max(0d, Math.min(1d, value));
    }

    private static boolean isHttpUrl(String value) {
        if (value == null) return false;
        String lower = value.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static String nonEmpty(String value, String fallback) {
        String normalized = emptyToNull(value);
        return normalized == null ? fallback : normalized;
    }

    private static String emptyToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    static boolean isLocalNetworkPermissionError(Throwable error) {
        Throwable current = error;
        while (current != null) {
            String message = current.getMessage();
            if (message != null) {
                String lower = message.toLowerCase(Locale.ROOT);
                boolean operationBlocked =
                    lower.contains("operation not permitted")
                        || lower.contains("permission denied");
                boolean localSocketFailure =
                    lower.contains("sendto")
                        || lower.contains("connect failed")
                        || lower.contains("eperm")
                        || lower.contains("econnaborted")
                        || lower.contains("eacces");
                if (operationBlocked && localSocketFailure) return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static void rejectLocalNetworkPermission(PluginCall call, Exception error) {
        call.reject(LOCAL_NETWORK_PERMISSION_MESSAGE, error);
    }

    private static String safeMessage(Throwable error) {
        String message = error == null ? null : error.getMessage();
        return message == null || message.trim().isEmpty() ? "未知错误" : message.trim();
    }

    private JSObject sessionToJson(CastSession session) {
        JSObject result = new JSObject();
        result.put("id", session.id);
        result.put("deviceId", session.device.id);
        result.put("deviceName", session.device.name);
        result.put("mode", session.mode);
        return result;
    }

    private JSObject statusToJson(CastSession session, TransportStatus transport) {
        JSObject result = new JSObject();
        result.put("state", transport.state);
        result.put("current", transport.currentSeconds);
        result.put("duration", transport.durationSeconds);
        result.put("deviceName", session.device.name);
        if (session.device.renderingControl != null) {
            try {
                result.put("volume", readVolume(session.device));
            } catch (IOException ignored) {
                // Volume support is optional.
            }
        }
        return result;
    }

    private SharedPreferences castPreferences() {
        Context context = getContext();
        if (context == null) return null;
        return context.getApplicationContext().getSharedPreferences(CAST_PREFS, Context.MODE_PRIVATE);
    }

    private void saveCastResume(CastSession session) {
        SharedPreferences preferences = castPreferences();
        if (preferences == null) return;
        preferences.edit()
            .putString("rendererId", session.device.id)
            .putString("deviceName", session.device.name)
            .putString("mode", session.mode)
            .putString("sourceUrl", session.sourceUrl)
            .putString("transportUrl", session.transportUrl)
            .putLong("savedAt", System.currentTimeMillis())
            .apply();
    }

    private SavedCast loadCastResume() {
        SharedPreferences preferences = castPreferences();
        if (preferences == null) return null;
        String rendererId = emptyToNull(preferences.getString("rendererId", null));
        String deviceName = emptyToNull(preferences.getString("deviceName", null));
        String mode = emptyToNull(preferences.getString("mode", null));
        String sourceUrl = emptyToNull(preferences.getString("sourceUrl", null));
        String transportUrl = emptyToNull(preferences.getString("transportUrl", null));
        long savedAt = preferences.getLong("savedAt", 0L);
        if (
            rendererId == null
                || deviceName == null
                || (!MODE_DIRECT.equals(mode) && !MODE_PROXY.equals(mode))
                || sourceUrl == null
                || transportUrl == null
                || savedAt <= 0L
        ) {
            preferences.edit().clear().apply();
            return null;
        }
        return new SavedCast(rendererId, deviceName, mode, sourceUrl, transportUrl, savedAt);
    }

    private void clearCastResume(String rendererId) {
        SharedPreferences preferences = castPreferences();
        if (preferences == null) return;
        String savedRenderer = preferences.getString("rendererId", null);
        if (rendererId == null || rendererId.equals(savedRenderer)) {
            preferences.edit().clear().apply();
        }
    }

    @Override
    protected void handleOnDestroy() {
        // Activity/WebView lifetime is intentionally independent from TV playback.
        // Direct casts live entirely on the renderer; proxy casts are owned by the
        // foreground service. Destroying the Capacitor plugin only detaches control.
        sessions.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static final class ServiceEndpoint {
        final String serviceType;
        final String controlUrl;
        final OkHttpClient http;

        ServiceEndpoint(String serviceType, String controlUrl, OkHttpClient http) {
            this.serviceType = serviceType;
            this.controlUrl = controlUrl;
            this.http = http;
        }
    }

    private static final class RendererDevice {
        final String id;
        final String name;
        final String manufacturer;
        final String model;
        final String host;
        final Network network;
        final String descriptionUrl;
        final ServiceEndpoint avTransport;
        final ServiceEndpoint renderingControl;

        RendererDevice(
            String id,
            String name,
            String manufacturer,
            String model,
            String host,
            Network network,
            String descriptionUrl,
            ServiceEndpoint avTransport,
            ServiceEndpoint renderingControl
        ) {
            this.id = id;
            this.name = name;
            this.manufacturer = manufacturer;
            this.model = model;
            this.host = host;
            this.network = network;
            this.descriptionUrl = descriptionUrl;
            this.avTransport = avTransport;
            this.renderingControl = renderingControl;
        }

        JSObject toJson() {
            JSObject json = new JSObject();
            json.put("id", id);
            json.put("name", name);
            if (manufacturer != null) json.put("manufacturer", manufacturer);
            if (model != null) json.put("model", model);
            json.put("address", host);
            json.put("supportsVolume", renderingControl != null);
            return json;
        }
    }

    private static final class CastSession {
        final String id;
        final RendererDevice device;
        final CastMediaProxy.SessionHandle relay;
        final String mode;
        final String sourceUrl;
        final String transportUrl;

        CastSession(
            String id,
            RendererDevice device,
            CastMediaProxy.SessionHandle relay,
            String mode,
            String sourceUrl,
            String transportUrl
        ) {
            this.id = id;
            this.device = device;
            this.relay = relay;
            this.mode = mode;
            this.sourceUrl = sourceUrl;
            this.transportUrl = transportUrl;
        }
    }

    private static final class SavedCast {
        final String rendererId;
        final String deviceName;
        final String mode;
        final String sourceUrl;
        final String transportUrl;
        final long savedAt;

        SavedCast(
            String rendererId,
            String deviceName,
            String mode,
            String sourceUrl,
            String transportUrl,
            long savedAt
        ) {
            this.rendererId = rendererId;
            this.deviceName = deviceName;
            this.mode = mode;
            this.sourceUrl = sourceUrl;
            this.transportUrl = transportUrl;
            this.savedAt = savedAt;
        }
    }

    private static final class TransportStatus {
        final String state;
        final double currentSeconds;
        final double durationSeconds;

        TransportStatus(String state, double currentSeconds, double durationSeconds) {
            this.state = state;
            this.currentSeconds = currentSeconds;
            this.durationSeconds = durationSeconds;
        }
    }
}
