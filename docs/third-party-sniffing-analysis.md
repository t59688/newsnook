# 第三方资源嗅探实现分析：youtoo（海阔系）与 vela-browser

本文分析 `third-party/youtoo`（HikariView / 海阔浏览器分支）与 `third-party/vela-browser` 两个 Android WebView 浏览器的资源嗅探逻辑与完整过程，并逐条标注逻辑所在位置（`文件:行号`）。项目自身的嗅探设计与实现见 [sniffer.md](./sniffer.md) 第二十节。

## 0. 结论先行

两者都能"几乎嗅探所有可播放资源"，本质是同一个第一性原理的两套实现：

> 在 WebView 架构里，页面能播的东西只有两种来源——(a) 内核发起的 HTTP 请求，(b) JS fetch 后喂给 MSE 的分片。把 (a)(b) 全部罩住，再叠加多级判别（URL 特征 → Content-Type → 魔数）与**请求头随资源回放**，覆盖率就与具体站点的播放器实现无关了。

差异在验证深度与元数据结构：

| | youtoo | vela-browser |
|---|---|---|
| 设计哲学 | URL 规则级联 + 单次 HEAD 验证，用户可用正则/标记无限扩展 | 多通道观察 + 信任模型 + 三级验证 + 结构化轨道元数据 |
| 观察通道 | 内核拦截（全子资源） | 内核拦截 + Service Worker + JS 桥（fetch/XHR/Performance/DOM/MSE/内联 JSON） |
| 验证 | HEAD + Content-Type + 尺寸启发 | HEAD → Range GET → 魔数 |
| MSE/blob | blob 无解，靠分段请求碰关键词 | MSE 仅作信号；API JSON 解析直接拿 manifest |
| 凭据 | 拦截时请求头整体附加到播放 URL | 按 exact origin 隔离回传，重定向逐跳剥离 |
| 输出 | 扁平视频 URL 列表 | 带 groupId/trackRole/quality/language/DRM 的媒体图 |

---

## 1. youtoo（海阔系）嗅探全流程

### 1.1 总体数据流

```text
WebViewClient.shouldInterceptRequest        （每个子资源请求必经）
   third-party/youtoo/app/src/main/java/com/example/hikerview/ui/browser/webview/WebViewHelper.java:1366
        │
        ▼
shouldInterceptRequest0                      WebViewHelper.java:1374
   ├─ requestHeaderMap.put(url, headers)     WebViewHelper.java:1385   ← 保存原始请求头
   ├─ AdUrlBlocker 黑名单命中 → 记 BLOCK      WebViewHelper.java:1394-1399
   ├─ ABP 规则命中 → 记 BLOCK                WebViewHelper.java:1406-1415
   └─ DetectorManager.addTask(VideoTask)     WebViewHelper.java:1421   ← 每个 URL 都入队
        │
        ▼
DetectorManager.addTask                      third-party/youtoo/.../ui/browser/model/DetectorManager.java:207
   ├─ taskUrlsSet 去重                       DetectorManager.java:212
   ├─ "url=" 包裹地址解包再入队              DetectorManager.java:215-218
   └─ HeavyTaskUtil 线程池异步执行           DetectorManager.java:221
        │
        ▼
MyRunnable.run                               DetectorManager.java:306
   └─ UrlDetector.getMediaType(url, headers, method)
        │
        ├─ 命中 VIDEO/MUSIC → EventBus 发 FindVideoEvent（上限 videoLimit）
        │     DetectorManager.java:315-319
        ▼
WebViewActivity.onFindVideoEvent             third-party/youtoo/.../ui/browser/WebViewActivity.java:3501
   ├─ 页面 hash 变化 → DetectorManager.reset  WebViewActivity.java:3512-3519
   ├─ 结果写回页面 window.videoUrls           WebViewActivity.java:3521-3526
   ├─ 底部嗅探条 / 悬浮窗 / Toast             WebViewActivity.java:3527-3553
   └─ 按域名白名单自动速播 fastPlay            WebViewActivity.java:3554-3568
        │
        ▼
startPlayVideo → PlayerChooser.decorateHeader  ← 回放拦截时保存的请求头
   WebViewActivity.java:2424 / 2460
   PlayerChooser.java:236-279
```

### 1.2 观察点：拦截层全覆盖

`WebViewHelper.shouldInterceptRequest0`（`WebViewHelper.java:1374-1431`）是唯一的媒体观察入口：

- Android WebView 下，页面的**所有**子资源请求（`<video src>`、XHR、fetch、m3u8 分片等）都会经过 `shouldInterceptRequest`，且 `request.getRequestHeaders()` 能拿到完整请求头。
- `WebViewHelper.java:1385` 先把 `url → headers` 存入 `requestHeaderMap`（`WebViewHelper.java:144,148` 提供读取），后面播放/下载时按 URL 精确取回。
- 无论广告拦截是否命中，URL 都会进入嗅探任务队列（`WebViewHelper.java:1387` 与 `WebViewHelper.java:1421` 两条分支都调 `addTask`）；被广告规则命中的请求记为 `Media.BLOCK` 结果但不播放（`WebViewHelper.java:1394-1415`）。
- Service Worker 请求同样被截获：`WebViewHelper.java:1439-1477` 安装 `ServiceWorkerClient`，把请求分发给各 `ServiceWorkerInterceptor`（广告拦截侧使用；媒体嗅探侧靠主 WebView 拦截通道）。

### 1.3 分类级联：`UrlDetector.getMediaType`

`third-party/youtoo/.../ui/browser/model/UrlDetector.java:46-154`，一条瀑布式判断，命中即返回：

| 顺序 | 规则 | 位置 |
|---|---|---|
| 1 | `rtmp://` → 视频 | `UrlDetector.java:50-53` |
| 2 | `rtsp://` → 视频 | `UrlDetector.java:54-57` |
| 3 | 显式标记 `isVideo=true` → 视频 | `UrlDetector.java:58-61` |
| 4 | 显式标记 `isMusic=true` → 音乐 | `UrlDetector.java:62-65` |
| 5 | 去掉域名后的短路径直接放行 | `UrlDetector.java:67-72`（`DetectUrlUtil.getNeedCheckUrl` 在 `DetectUrlUtil.java:27-42`） |
| 6 | 伪装后缀黑名单 `.mp4.jp`、`.mp4.png` → 非视频 | `UrlDetector.java:73-79`（规则表 `UrlDetector.java:38`） |
| 7 | **用户自定义正则** `videoRules`（默认 `.*\.mp4.*`，LitePal 持久化） | `UrlDetector.java:80-90`；规则维护 `UrlDetector.java:329-390` |
| 8 | `.php?url=http` 代理页拦截 | `UrlDetector.java:91-98` |
| 9 | html/图片/安装包扩展名排除 | `UrlDetector.java:99-113`（表在 `UrlDetector.java:32-36`） |
| 10 | 视频扩展名/关键词 `contains` 匹配 | `UrlDetector.java:114-122`（表 `UrlDetector.java:34`，含 `mime=video%2F`、`qqBFdownload` 等站点特征） |
| 11 | 音乐扩展名 | `UrlDetector.java:123-131` |
| 12 | `POST` 请求 → OTHER（不嗅） | `UrlDetector.java:132-136` |
| 13 | 站点/验证码特判 | `UrlDetector.java:137-146` |
| 14 | **都不命中 → 主动 HEAD 验证** | `UrlDetector.java:147-150` → `isVideo()` `UrlDetector.java:303-327` |
| 15 | 默认 OTHER | `UrlDetector.java:151-153` |

关键细节：

- 扩展名匹配用 **`contains` 而非 `endsWith`**（`UrlDetector.java:115-116`），所以 `xxx.mp4?token=...`、`/path/v.mp4/index` 这类都能命中。
- `#ignoreVideo=true#`、`#ignoreMusic=true#` 标签是用户规则注入的排除开关（`UrlDetector.java:114,123`），`clearTag`（`UrlDetector.java:210-243`）负责在展示前剥掉这批内部标记。
- 用户正则（第 7 步）与显式标记（第 3/4 步）是这套系统的"逃生通道"：任何站点只要用户写一条正则或给 URL 打上 `isVideo=true`，就能被嗅到——这是它能"几乎全覆盖"的第二根支柱。

### 1.4 主动验证：HEAD + Content-Type + 尺寸启发

`DetectUrlUtil.detectVideoComplex`（`DetectUrlUtil.java:44-106`）：

1. 用**拦截时保存的原始请求头**发 HEAD（`DetectUrlUtil.java:45` → `HttpRequestUtil.performHeadRequest`，`HttpRequestUtil.java:87-139`：手动处理重定向，最多 4 次；`HttpRequestUtil.java:49-75` 全局 trustAll 证书）。
2. 无 `Content-Type` → 检测失败放弃（`DetectUrlUtil.java:58-61`）。
3. 交给 `VideoFormatUtil.detectVideoFormat`（`third-party/youtoo/.../ui/download/util/VideoFormatUtil.java:167-234`）：
   - 无 Content-Type → 按 `Content-Disposition` 文件名 → URL 文件名匹配（`VideoFormatUtil.java:171-174`，`getVideoFormatByName` 在 `:148-165`）；
   - 扩展名 `.mp4` 强制 MIME 为 `video/mp4`（`:180-181`），`.m3u8` 直接归为 m3u8（`:182-183`）；
   - **`application/octet-stream` 等"流类型"**（`isStream`，`VideoFormatUtil.java:244-246`）：先按文件名匹配（`:191-197`），匹配不到时——
   - **Content-Length > 200MB 的流文件直接当 mp4**（`VideoFormatUtil.java:217-231`）；
   - 仍不中 → `getVideoFormatAnyway` 忽略 MIME 校验、只认扩展名（`:233`，`:105-133`）。
   - MIME 白名单表（`VideoFormatUtil.java:35-42`）：m3u8 全家（`application/x-mpegurl` 等 7 种写法）、`video/mp4`、`video/mpeg`、`video/x-flv`、`video/x-f4v`、`video/vnd.mpegurl`。
4. 浏览器场景的严格化（`DetectUrlUtil.java:67-80`）：若 Content-Type 是流类型，URL 必须还含 `.mp4/.m3u8/.mp3/.mkv/.flv/.avi/.rmvb` 之一才算视频——用"大尺寸兜底"换召回，再用"扩展名二次确认"压误报。

### 1.5 结果投递、去重与上限

- `DetectorManager.addTask`（`DetectorManager.java:207-222`）：`taskUrlsSet` 精确去重；若 URL 形如 `...url=http...`（代理包裹），解包后**额外**再入队一个真实地址（`DetectorManager.java:215-218`）。
- 数量上限 `videoLimit` 初始 20（`DetectorManager.java:52`），`startDetect` 重置（`:224-230`），`reset` 每页 +20（`:232-235`）；超上限的结果仍记录但不发 `FindVideoEvent`（`DetectorManager.java:315`）。
- 结果列表按时间戳排序输出（`DetectorManager.java:294`）。

### 1.6 播放/下载时的凭据回放

这是"嗅到了还能播"的关键一环：

- `WebViewActivity.startPlayVideo`（`WebViewActivity.java:2424-2464`）：
  - `PlayerChooser.decorateHeader(WebViewHelper.getRequestHeaderMap(webViewT, videoUrl), ...)`（`WebViewActivity.java:2460`）——按 URL 取回拦截时保存的请求头；
  - `PlayerChooser.decorateHeader`（`PlayerChooser.java:236-279`）：剥掉 `Accept`/`Range`/`Upgrade-Insecure-Requests`（`:258-270`），Referer 对应 Cookie 缺失时从 `CookieManager` 补（`:242-250,272-274`），最终把请求头序列化成 `url;headers` 形式交给播放器（`:278`）。
- 下载走同样路径：`WebViewActivity.startDownloadVideo`（`WebViewActivity.java:2479-2498`）。
- 播放/下载时不依赖"重新构造独立请求"，而是复用页面会话当时的鉴权状态。

### 1.7 JS 侧（辅助，非嗅探主通道）

- `loadAllJs`（`WebViewHelper.java:1235-1248`）在页面进度 ≥40%（`WebViewHelper.java:611-618`）与页面结束（`WebViewHelper.java:1061-1063`）两个时机注入用户 JS 插件，并把 `getVideoUrls()`（`WebViewHelper.java:1250-1259`，即已嗅到的视频/音乐 URL 列表）写进页面 `window.videoUrls`（`JsPluginHelper.java:43-45`）——用户插件可以读取嗅探结果，但不能反过来驱动嗅探。
- `assets/Hikerurl.js` 是海阔规则 DSL 的点击事件生成工具（`@rule=` / `select://` 等协议头），服务于用户规则体系，不是嗅探引擎。
- `assets/inject.js` 是 Adblock 元素隐藏、`assets/fastPlay.js` 是倍速注入、`assets/blob.js` 是 blob 下载器（经 `fy_bridge_app` 桥把 base64 传回原生），均与媒体发现无关。

**youtoo 的边界**：MSE `blob:` 本身不可外部播放，系统只能指望 `.ts/.m3u8/.m4s` 分片请求经过拦截层并命中关键词表；没有轨道结构（分辨率/语言/码率），没有 origin 级凭据隔离（请求头整体附加）。

---

## 2. vela-browser 嗅探全流程

### 2.1 总体数据流

```text
BrowserActivity.configureWebView            third-party/vela-browser/android/app/src/main/java/com/vela/browser/browser/BrowserActivity.kt:116
   │
   ├─ [通道 A] WebViewClient.shouldInterceptRequest        BrowserActivity.kt:220-225
   │      └─ sniffer.observe(request)
   ├─ [通道 A'] ServiceWorkerSniffer.attach                 ServiceWorkerSniffer.kt:16-29
   │      └─ ServiceWorkerClient → sniffer.observe(request)
   └─ [通道 B] WebMediaBridge.installBeforeNavigation      WebMediaBridge.kt:19-38
          ├─ addWebMessageListener("VelaMediaBridge")       WebMediaBridge.kt:20-31
          └─ addDocumentStartJavaScript(vela_web_bridge.js) WebMediaBridge.kt:32-37
                 │（页面 JS 执行前就位）
                 ├─ hook fetch / XHR        vela_web_bridge.js:46-98
                 ├─ PerformanceObserver     vela_web_bridge.js:125-131
                 ├─ DOM/MutationObserver    vela_web_bridge.js:133-146, 194-210
                 ├─ MSE/blob 信号           vela_web_bridge.js:214-231
                 └─ 小型播放器 JSON         vela_web_bridge.js:30-43, 100-123
                       │ postMessage
                       ▼
                WebMediaBridge.handleMessage                WebMediaBridge.kt:44-79
                 ├─ url → sniffer.observeUrl                WebMediaBridge.kt:51-59
                 ├─ api → sniffer.observeApiResponse        WebMediaBridge.kt:62-73
                 └─ mse/blob → sniffer.markMseObserved      WebMediaBridge.kt:77
                       │
                       ▼
                MediaSniffer（归一、去重、升级、凭据）
                 ├─ MediaClassifier（URL/CT/分段/探针判定）
                 ├─ MediaProbe（HEAD → Range → 魔数）
                 ├─ MediaApiParser（JSON 轨道解析 + groupId）
                 └─ OriginHeaderStore（exact-origin 凭据）
                       ▼
                ResourceSheet（播放/下载）→ PlayerActivity / DownloadService
```

### 2.2 通道 A：原生网络观察（权威源）

- `BrowserActivity.kt:220-225`：`shouldInterceptRequest` 里先过 `AdBlockEngine`，再 `sniffer.observe(request)`，返回 null 放行。
- `MediaSniffer.observe`（`MediaSniffer.kt:47-75`）：
  - 只收 http/https（`:50`），`UrlSecurityPolicy.isAllowedCandidate` 做页面-资源关系校验（`:51`）；
  - `observedUrls.add(url)`（`:54`）——这个集合是整个信任模型的权威基准；
  - `headerStore.record(url, headers)`（`:55`）按 origin 存请求头；
  - **分段**（`.ts/.cmfv/.cmfa`，`MediaClassifier.isSegment` `MediaClassifier.kt:78-81`）不作资源展示，只记录其 origin（`rememberMediaOrigin`，`MediaSniffer.kt:268-277`，上限 12 个 origin）供凭据复用（`:56-59`）；
  - URL 可直接分类（`.m3u8/.mpd/mime=video/...`）→ 直接入库（`:62-72`）；
  - 不能直接分类且满足探针条件 → `MediaProbe.probe`（`:74`）。

Service Worker 侧（`ServiceWorkerSniffer.kt:16-29`）：`ServiceWorkerClient.shouldInterceptRequest` 同样做广告拦截 + `observe`。这一条通道覆盖"播放器逻辑跑在 SW 里"的站点，是 youtoo 媒体侧没有的。

页面生命周期：
- `onPageStarted` → `sniffer.reset(page)`（`BrowserActivity.kt:187-193`）清空全部状态；
- `doUpdateVisitedHistory` 处理 SPA `pushState/replaceState` 同文档导航，URL 变化即 reset（`BrowserActivity.kt:202-213`）——避免新旧页面资源混入；
- `onReceivedTitle` → `sniffer.setPageTitle`（`BrowserActivity.kt:150-152`），标题回填到尚未有标题的资源（`MediaSniffer.kt:157-171`）。

### 2.3 通道 B：JS 桥（`vela_web_bridge.js`）

注入时机：`WebMediaBridge.installBeforeNavigation`（`WebMediaBridge.kt:19-38`）在首个页面加载前注册 `DOCUMENT_START` 脚本（`:32-37`），保证 hook 先于页面任何脚本执行；老 WebView 不支持时退化为 `onPageFinished` 注入（`BrowserActivity.kt:198`，`WebMediaBridge.kt:40-42`）。

各 hook 的职责与位置（均在 `third-party/vela-browser/android/app/src/main/assets/vela_web_bridge.js`）：

| Hook | 位置 | 作用 |
|---|---|---|
| `fetch` | `:46-68` | 上报请求 URL 与响应 URL（重定向后）；对 ≤768KB 的 json/text 响应 `clone().text()` 检查是否为播放器 JSON（`:60-62`），不消费原响应 |
| `XHR` | `:70-98` | `open` 时记录 method/url/page 并上报（`:74-81`）；`load` 事件上报 `responseURL` 并检查 text 响应（`:83-97`） |
| 内联播放器全局 | `:100-123` | 只读 `ytInitialPlayerResponse`、`__playinfo__`、`__PLAYER_CONFIG__` 三个白名单全局（`:103`），`JSON.stringify` 后上报；DOMContentLoaded + 800ms + 2200ms 三次时机（`:115-123`）。**只读取，不执行、不解密** |
| `PerformanceObserver` | `:125-131` | resource timing 兜住不经 DOM 暴露的资源；`looksMediaUrl`（`:21`）过滤，只报媒体特征 URL |
| DOM 扫描 | `:133-146` + `:194-210` | `MutationObserver`（childList + `src/class/id/aria-label` 属性）追踪 `video/audio/source/track` 的 `currentSrc/src`；捕获 JS 晚绑定的 src |
| `URL.createObjectURL` | `:214-221` | 仅上报 blob 事件作为 **MSE 信号** |
| `MediaSource.addSourceBuffer` | `:223-231` | 同上，`mse` 事件 |

`blob:`/MSE 事件的定性（`WebMediaBridge.kt:75-77`、`MediaSniffer.kt:150-152`）：blob URL 只在文档内有效，**永不作为可播放 URL 提供**，只证明"MSE 流水线在工作"；真实的 `.m4s` 分段由 fetch/XHR/performance/网络通道捕获。

"播放器 JSON"启发式（`vela_web_bridge.js:30-36`）：正文 ≤32KB 采样内出现 `m3u8`/`.mpd`/`baseurl`/`adaptiveformats`/`streamingdata`/`dash`/`playurl`/`mimetype` 之一才上报，控制信噪比。

（同文件 `:148-186` 是广告浮层隐藏/化妆品规则，属广告拦截侧，与嗅探无关。）

### 2.4 通道 C：API 解析（`MediaApiParser.kt`）

`MediaSniffer.observeApiResponse`（`MediaSniffer.kt:109-148`）先过信任校验：API 响应体必须来自 `observedUrls` 里真实观察到的请求；例外是同源的"内联播放器 JSON"（其声明源必须是当前加载的同源页面），这是为了发现 bootstrap 播放数据而**不把原生 HTTP 栈变成任意请求原语**（`:116-126`）。

`MediaApiParser.parse`（`MediaApiParser.kt:40-46`，正文上限 768KB `:29`）对 JSON 做**通用树遍历**（`walk` `:48-60`），不针对任何特定站点：

- **URL 键白名单**（`urlKeys` `:30-33`）：`url/baseurl/base_url/src/file/playurl/play_url/hlsManifestUrl/dashManifestUrl/manifestUrl/manifest_url`；`backupUrls` 数组键（`:34`）逐个展开（`:112-136`）。
- **类型推断三级**：URL 分类（`classifyUrl`）→ 对象内 `mimeType/type` 的 MIME 分类（`classifyContentType`）→ JSON 路径推断（`inferKindFromPath` `:187-195`：路径含 `subtitle/caption/texttrack` → TEXT，`audio` → AUDIO，`video/adaptiveformat/format` → VIDEO）。
- **元数据抽取**（`walkObject` `:69-78`）：`codecs`、`width/w`、`height/h`、`bitrate/bandwidth`、`qualityLabel/qn/desc`（缺省用分辨率生成如 `1080P`）、`language`（含嵌套 `audioTrack.displayName`）。
- **DRM 信号**（`containsDrmSignal` `:213-222`）：键名含 `drm/widevine/license/keysystem/contentprotection` 即标记，并沿遍历继承（`:79`）。
- **groupId**（`:205-211`）：`sha256(sourceUrl | 路径根)`，路径根 = 去掉数组下标后截到第一个分组标记（`.video/.audio/.subtitle/.adaptiveformats/.formats`，`:35-38`）之前——把"同一媒体"的视频轨/音频轨/字幕归到同一组，供配对与展示。
- 相对 URL 归一化（`normalizeUrl` `:175-185`）：`//` 协议相对、相对路径按 sourceUrl resolve。
- 松散字符串兜底（`addLooseUrl` `:142-168`）：树中任何位置的字符串，能解析为 URL 且 URL 分类命中（如 `.m3u8`）也纳入。

### 2.5 信任模型（`UrlSecurityPolicy`）

位置：`MediaSniffer.kt:51,86,89-92,123-126` 与 `WebMediaBridge.kt:47-49`，文档化于 `third-party/vela-browser/docs/ARCHITECTURE.md:55-62`：

1. 原生 WebView/ServiceWorker 观察是**权威**（`observedUrls`）。
2. JS 上报的**跨源** URL 只有在原生侧真的见过同一 URL 时才接受（`MediaSniffer.kt:89-92`）——防止页面 JS 把任意 URL 塞给原生层。
3. **同源** DOM URL 可提前接受（原生回调可能晚于 JS 执行）（`:89-91`）。
4. 消息来源 origin 必须与声明 page 同源（`WebMediaBridge.kt:47-49`）。
5. `blob:` 永不作为外部可播放 URL；POST 播放 API 只观察、不重放为原生 POST（`ARCHITECTURE.md:60-62`）。

### 2.6 分类器（`MediaClassifier.kt`）

- `classifyUrl`（`:14-32`）：`.m3u8`/`format=m3u8`/`type=m3u8` → HLS；`.mpd`/`dash_manifest` → DASH；`mime=video%2f`/`mime=video/`（YouTube 风格查询参数）→ VIDEO；音频 MIME 参数 → AUDIO；**`.m4s` 不猜**（fragmented MP4 可音可视频，交给探针，`:22-26`）；常见视频/音频/字幕扩展名；`staticExtensions`（`:7-10`：css/js/png/woff/json…）明确排除。
- `classifyContentType`（`:34-44`）：`mpegurl` 家族 → HLS、`dash+xml` → DASH、`video/*`、`audio/*`、`text/vtt|subrip|ttml` → TEXT。
- `shouldProbe`（`:83-96`）：仅 GET/HEAD；URL 已可分类或是分段 → 不探；排除静态扩展名；**Accept 头含 `video/`/`audio/`/`mpegurl`/`dash`** 或 URL 含 `m4s`/`video/media/stream/play/manifest/playlist/source/videoplayback` 关键词 → 探。即"页面自己声明了媒体意图"才花一次探针。

### 2.7 三级探针（`MediaProbe.kt`）

`probe`（`:35-90`）：

1. 去重与限流：`inFlight` + `checked` 防重复（`:37`），`Semaphore(4)` 并发上限（`:24,38-41`），`generation` 计数在翻页时作废旧探针（`:20,26-33`，注释明确说明为何不能清 inFlight 标记——避免许可泄漏）。
2. **一级：HEAD**。`enrichHeaders`（`:149-158`）用 `CookieManager` 补 Cookie；scoped OkHttp client（`ScopedHttpClientFactory`）；剥掉 `Host`/`Content-Length`（`:138-147`）。
   - HEAD 失败（CDN 常拒 HEAD）→ 降级二级（`:58-66`）；
   - 响应可分类 → 上报（`:74-81`）；
   - 405/403/无 CT/`octet-stream` → 降级二级（`:82-85`）。
3. **二级：`Range: bytes=0-4095` GET**（`probeRange` `:92-136`，Range 头 `:145`）：
   - 先看 Content-Type（`:115-119`）；
   - 仍不中 → **三级：魔数嗅探** `sniffBytes`（`:120-130` → `:160-178`）：
     - `#EXTM3U` → HLS
     - `<MPD` → DASH
     - ISO BMFF `ftyp`（`:165-172`）：再查前 4KB 内 `soun/mp4a/Opus` → AUDIO，`vide/avc1/hvc1/hev1/av01/vp09` → VIDEO，否则 VIDEO
     - `0x1A 0x45 0xDF 0xA3` → FLV（`:173`）
     - `ID3` → MP3、`fLaC`、`OggS`（`:174-176`）

三级组合覆盖了：正常扩展名（一级都不用到）、无扩展名签名 URL（CT）、标签错误/`octet-stream`（魔数）。

### 2.8 归一、去重与升级（`MediaSniffer.addDetected`）

`MediaSniffer.kt:174-254`：

- 分段丢弃（`:191`）；
- `MediaUrlNormalizer.identity`（`MediaUrlNormalizer.kt:15-34`）：剥 fragment + **易变签名参数**（`volatileParams` `:8-13`：`token/sig/expire/timestamp/hdntl/policy/key-pair-id/x-amz-*` 等）后排序重排——同一 CDN 资源不同签名的 URL 归一为同一身份；**原始签名 URL 始终保留在 `MediaResource.url`**（`MediaResource.kt:26-49`），播放用原始值，去重用指纹；
- `canonicalToBestId` 升级逻辑（`:198-217`）：
  - 早到的"裸网络发现"（无 groupId）被晚到的 API 解析结果（带 groupId/trackRole）**替换升级**（`:202-210`）；
  - 晚到的无组信息重复请求**合并**进已有组（`:211-212`）；
  - 同组同角色 → 原样合并（`:213`）；
- 字段级合并（`:226-250`）：新值优先、空值回填旧值；`originHeaders` 按相关 origin（本 URL + 页面 + 已记录媒体 origin，`:219-224`）从 `OriginHeaderStore` 取快照合并（`:256-266`）；
- 新增资源才 `order.add`，每次变更通知 UI（`:251-253`）。

### 2.9 凭据模型（exact-origin）

- `OriginHeaderStore`（`OriginHeaderStore.kt`）：按 origin（`MediaResource.originOf` `MediaResource.kt:150-161`，scheme+host+port）存**白名单**请求头——`user-agent/referer/origin/authorization/accept/accept-language/cookie`（`:60-62`），Cookie/Authorization 值限 8KiB、其余 2KiB（`:69-72`），LRU 上限 32 origin（`:13,30-32`）；记录时 `CookieManager` 补 Cookie（`:23-27`）。
- `safeFallback`（`:51-57`）：拿不到精确 origin 头时只回落 UA/Referer/Origin/Accept 等**非凭据**头。
- 资源侧：`MediaResource.headers`（本 origin）+ `originHeaders`（各相关 origin，`MediaResource.kt:31-35`）。
- 重定向安全：`ScopedHttpClientFactory` 每跳重定向剥离继承的敏感头、再按目标 origin 重放；`SafeDns` 禁止原生请求解析到 loopback/LAN/link-local/CGNAT 段（`ARCHITECTURE.md:64-66`）。
- 安全姿态：整个浏览器是无痕模式（`BrowserActivity.kt:109-112,308-351`），关闭即擦除，嗅到的凭据不落盘。

### 2.10 展示（`MediaPresentation.kt`）

`visible`（`:10-31`）：隐藏 TEXT/UNKNOWN；**同一 groupId 里已有视频/HLS/DASH 时隐藏伴生音轨**（音轨保留在 `currentResources` 里供配对，只是不进浮层计数，`BrowserActivity.kt:90-97`）；按 id 去重。UI 显示"发现 N 个资源"（`BrowserActivity.kt:269-282`），点开 `ResourceSheet` 播放/下载（`:290-306`）。

---

## 3. 为何能"几乎嗅探所有可播放资源"

### 3.1 覆盖矩阵

| 资源形态 | youtoo | vela-browser |
|---|---|---|
| 直链 mp4/flv/mkv（带扩展名） | URL `contains` 命中（`UrlDetector.java:114-122`） | `classifyUrl`（`MediaClassifier.kt:27`） |
| HLS `.m3u8` / 参数化（`format=m3u8`） | 关键词表（`UrlDetector.java:34`） | `classifyUrl`（`MediaClassifier.kt:18`） |
| DASH `.mpd` | 不在关键词表（靠用户正则/HEAD 的 CT） | `classifyUrl`（`MediaClassifier.kt:19`）+ CT |
| 无扩展名签名 URL（octet-stream） | HEAD + CT + >200MB 启发（`VideoFormatUtil.java:217-231`） | HEAD → Range → 魔数（`MediaProbe.kt:82-85,120-130`） |
| YouTube 风格 `mime=video%2F` | 关键词表命中（`UrlDetector.java:34`） | `classifyUrl`（`MediaClassifier.kt:20`） |
| MSE `blob:` 播放器 | 只能靠 `.ts/.m4s` 分段请求碰关键词 | MSE 信号 + fetch/XHR/performance 抓真实分段 + **API JSON 拿 manifest**（含内联 `ytInitialPlayerResponse`） |
| SW 内发起的媒体请求 | SW 拦截仅用于广告侧 | `ServiceWorkerSniffer`（`ServiceWorkerSniffer.kt:20-27`） |
| 带 Cookie/Referer/Authorization 鉴权 | 请求头整体附加播放（`PlayerChooser.java:236-279`） | exact-origin 回放（`OriginHeaderStore.kt`） |
| 用户可指定的任意站点 | 自定义正则 + `isVideo=true` 标记（`UrlDetector.java:58-90`） | 探针 Accept 头判定 + API 解析（无需用户介入） |

### 3.2 四个共同支柱

1. **观察点在内核拦截层**：WebView 里"页面播 = 内核请求过"。youtoo `WebViewHelper.java:1421`、vela `BrowserActivity.kt:223`，覆盖率与站点实现无关，不需要知道任何播放器的内部结构。
2. **URL → Content-Type → 魔数三级漏斗**：扩展名/关键词走快路径；签名 URL 靠 HEAD/Range 的 CT；标签错误的靠二进制头。youtoo 止于 CT+尺寸（`DetectUrlUtil.java:44-106`），vela 到魔数（`MediaProbe.kt:160-178`）。
3. **请求头随资源走**：拦截瞬间保存头，播放/下载时回放到正确 origin。"URL 正确 + Cookie 不正确 = 403"是嗅探器最常见的死亡原因，两者都解决了（youtoo 整体附加，vela 按 origin 精确回放）。
4. **归一去重**：同一资源不因签名参数变化/多次观察而刷屏或漏并。youtoo `taskUrlsSet` + `clearTag`（`DetectorManager.java:212`、`UrlDetector.java:210-243`）；vela `MediaUrlNormalizer` 指纹 + `canonicalToBestId` 升级合并（`MediaUrlNormalizer.kt:15-34`、`MediaSniffer.kt:198-217`）。

### 3.3 诚实的边界（"几乎"的原因）

- **DRM/Widevine**：两者都不解密。vela 显式打 `drmHint`（`MediaApiParser.kt:213-222`）并交给正常播放链路；youtoo 无此概念（DRM 流通常 CT 是 `application/octet-stream` 且无扩展名，大概率漏掉或误判）。
- **`blob:` 本身**：文档域内有效，外部不可用。vela 明确只当 MSE 信号（`WebMediaBridge.kt:75-77`）；youtoo 的 `blob.js` 只解决"页内 blob 下载到本地"，不解决外部播放。
- **POST 播放 API**：youtoo 直接判 OTHER（`UrlDetector.java:132-136`）；vela 观察但不重放（`ARCHITECTURE.md:62`）。
- **会员/地区/账号授权**：嗅到 ≠ 授权，两者都依赖页面会话自身已获得的权限，不伪造、不逆向签名。

---

## 4. 对 newsnook 的参考点

对照 [sniffer.md](./sniffer.md) 第二十节的现有实现，两套第三方实现中最值得对照的细节：

1. **探针降级链**（vela `MediaProbe.kt:58-85,92-136`）：HEAD 失败/405/403/octet 才降 Range，Range 仍不中才读魔数——三级都是廉价操作，且 `Semaphore(4)` + generation 计数控制了翻页抖动。
2. **签名参数归一与原始 URL 分离**（vela `MediaUrlNormalizer.kt:15-34`）：指纹用于去重，`MediaResource.url` 保留原始签名——sniffer.md 第十节"不要破坏签名 URL"的直接落地。
3. **JS 上报的信任校验**（vela `MediaSniffer.kt:89-92`）：跨源 JS 声称必须被原生观察背书，同源 DOM 可先行——防止把页面 JS 变成任意 URL 注入通道。
4. **API JSON 的通用遍历 + groupId**（vela `MediaApiParser.kt:48-140,205-211`）：不针对站点，靠键白名单 + 路径分组标记归组，分离音视频轨配对的基础。
5. **octet-stream 的尺寸启发**（youtoo `VideoFormatUtil.java:217-231`）：>200MB 流当 mp4 是粗但有效的召回手段，可与"URL 必须含已知扩展名"的二次确认（youtoo `DetectUrlUtil.java:67-80`）配合使用，作为魔数不可用时的兜底。
6. **用户逃生通道**（youtoo `UrlDetector.java:58-90,329-390`）：`isVideo=true` 标记 + 持久化自定义正则，是长尾站点的最低成本覆盖手段。
