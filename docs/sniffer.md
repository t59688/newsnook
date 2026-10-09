
# 一、总体架构

不要把嗅探器设计成：

```text
URL 包含 .mp4 / .m3u8
        ↓
      播放
```

最佳实践应该是：

```text
                   ┌──────────────┐
                   │ Browser Engine│
                   │  WebView/Web  │
                   └───────┬──────┘
                           │
                    页面正常运行
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     网络请求观察      Media DOM/MSE      DRM信号
          │              运行时观察           │
          └────────────────┼────────────────┘
                           ▼
                    Candidate Collector
                           │
                           ▼
                     媒体资源识别
                           │
                           ▼
                     Manifest解析
                           │
                           ▼
                      Media Graph
                           │
                   ┌───────┴────────┐
                   ▼                ▼
                非DRM              DRM
                   │                │
              播放器直接播       正常DRM链路
                   │                │
                   └───────┬────────┘
                           ▼
                        Player
```

核心不是“抓 URL”，而是建立一个完整的 **Media Resource Graph**。

---

# 二、第一层：网络请求观察

这是主嗅探通道。

浏览器页面运行时，对所有资源请求建立观察器。

每条请求至少记录：

```text
RequestRecord
{
    url
    method
    requestHeaders
    responseHeaders
    mimeType
    statusCode
    initiator
    resourceType
    timestamp
    pageUrl
}
```

重点观察：

```text
video/*
audio/*

application/vnd.apple.mpegurl
application/x-mpegURL

application/dash+xml

video/mp4
audio/mp4
video/webm
audio/webm

.m3u8
.mpd
.mp4
.m4s
.ts
.webm
.m4a
.aac
```

但**扩展名只能作为一个信号，不能作为最终依据**。

因为可能出现：

```text
https://cdn.example.com/play?id=123
```

实际上 Response：

```text
Content-Type: video/mp4
```

或者：

```text
https://example.com/api/stream?token=xxxx
```

实际上返回：

```text
#EXTM3U
...
```

因此判断优先级应该是：

```text
响应内容类型
       +
URL特征
       +
响应内容特征
       +
请求行为特征
       ↓
   Media Candidate
```

Android WebView 这类环境确实可以通过宿主回调观察大量资源请求，不过官方也明确指出，`blob:` 请求本身不会进入 `shouldInterceptRequest()`，重定向也存在一些回调限制，所以生产级实现不能只依赖这一层。([Android Developers][2])

---

# 三、第二层：网页媒体运行时观察

网络嗅探必须搭配网页运行时观察。

监听：

```text
<video>
<audio>
<source>
```

重点观察这些变化：

```text
video.src
video.currentSrc

source.src

srcObject

load()
play()
```

例如页面最开始：

```html
<video></video>
```

几秒后 JS 才执行：

```text
video.src = xxx
```

嗅探器应该立刻收到：

```text
MEDIA_ELEMENT_SOURCE_CHANGED
```

然后把 URL 加入候选池。

---

# 四、第三层：专门处理 Blob / MSE

这是现代视频网站非常重要的一层。

你经常会看到：

```text
<video src="blob:https://example.com/2d4....">
```

这个 `blob:` 地址本身**不是视频 CDN 地址**。

真实情况通常是：

```text
网络
 │
 ├─ video_xxx.m4s
 ├─ video_xxx.m4s
 ├─ audio_xxx.m4s
 └─ audio_xxx.m4s
        ↓
   JavaScript
        ↓
    MediaSource
        ↓
   SourceBuffer
        ↓
   blob:xxxx
        ↓
    <video>
```

MSE 就是为了让 JavaScript 动态向媒体缓冲区追加音视频数据而设计的。([W3C][3])

因此：

```text
看到 blob:
```

绝对不能：

```text
把 blob URL 交给播放器
```

而应该：

```text
发现 blob:
      ↓
标记页面正在使用 MSE
      ↓
关联该页面最近发生的媒体网络请求
      ↓
识别 Manifest / 音视频 Adaptation Set
      ↓
恢复逻辑媒体资源
```

同时观察：

```text
MediaSource

addSourceBuffer(
    'video/mp4; codecs="..."'
)

addSourceBuffer(
    'audio/mp4; codecs="..."'
)
```

这里非常有价值，因为它会直接告诉你：

```text
这是 video
这是 audio
codec 是什么
```

不必通过 URL 猜。

---

# 五、不要把媒体分片当成多个“视频”

这是很多初级嗅探器的问题。

例如网页请求：

```text
master.mpd

video-init.m4s
video-001.m4s
video-002.m4s
video-003.m4s

audio-init.m4s
audio-001.m4s
audio-002.m4s
audio-003.m4s
```

错误实现会提示：

> 检测到 9 个视频。

正确实现应该最终只显示：

```text
发现 1 个媒体

视频：
1080P
AVC
5 Mbps

音频：
AAC
128 kbps
```

所以需要一个：

# Media Graph

例如：

```text
MediaAsset
│
├── Manifest
│     └── master.mpd
│
├── Video AdaptationSet
│     │
│     ├── 360p
│     ├── 720p
│     ├── 1080p
│     └── 2160p
│
├── Audio AdaptationSet
│     │
│     ├── AAC 64K
│     └── AAC 192K
│
└── Subtitle
      ├── zh
      └── en
```

**用户看到的是 MediaAsset，不是网络请求列表。**

---

# 六、Manifest 优先

一旦检测到：

```text
.m3u8
```

或者：

```text
.mpd
```

优先级应该立刻高于：

```text
.ts
.m4s
```

也就是说：

```text
master.m3u8     ← 高价值
index.m3u8      ← 高价值
master.mpd      ← 高价值

segment001.ts   ← 低价值
segment002.ts   ← 低价值

chunk001.m4s    ← 低价值
chunk002.m4s    ← 低价值
```

因为 Manifest 描述的是**完整媒体结构**。

---

# 七、HLS 嗅探逻辑

发现 HLS：

```text
master.m3u8
```

解析：

```text
#EXT-X-STREAM-INF:
BANDWIDTH=
RESOLUTION=
CODECS=
AUDIO=
SUBTITLES=
```

生成：

```text
HLS Asset
│
├── 360P
├── 720P
├── 1080P
└── 4K
```

如果存在独立音频：

```text
#EXT-X-MEDIA:TYPE=AUDIO
```

则建立：

```text
Video Variant
       │
       └──── Audio Group
```

不要自己把 segment 拼起来再播。

播放器应该直接吃：

```text
Master Playlist
```

然后让自适应流媒体模块自己处理。

---

# 八、DASH 嗅探逻辑

发现：

```text
manifest.mpd
```

解析：

```text
Period

AdaptationSet
    contentType=video

Representation
    width
    height
    bandwidth
    codecs

AdaptationSet
    contentType=audio

Representation
```

最终得到：

```text
                 DASH Asset
                     │
          ┌──────────┴──────────┐
          │                     │
        VIDEO                  AUDIO
          │                     │
      ┌───┼────┐            ┌───┼───┐
     720 1080 4K            AAC EAC3 ...
```

播放时：

```text
Video Representation
           +
Audio Representation
           ↓
          Player
```

而不是期望某个 1080P URL 同时有声音。

---

# 九、请求上下文必须跟媒体一起保存

真正可以播放的资源不是：

```text
String url
```

而应该是：

```text
PlayableResource
{
    url

    requestContext {
        headers
        cookieSession
        referer
        origin
        userAgent
    }

    format

    sourcePage

    expiry

    drmInfo
}
```

尤其是：

```text
Referer
Cookie
Authorization
Origin
User-Agent
```

有些 CDN 是：

```text
URL 正确
+
Cookie 不正确
=
403
```

因此最好的做法不是：

> 嗅探完 URL，然后重新构造一个完全独立的 HTTP 请求。

而是：

> **让播放器使用和浏览器同一个授权会话，或者使用与当前会话绑定的数据源。**

这样不会丢掉认证状态。

---

# 十、不要破坏签名 URL

例如抓到：

```text
https://cdn.example.com/video.m3u8
    ?expire=1780000000
    &token=...
    &signature=...
```

原 URL 必须完整保存。

不要为了“去重”把：

```text
?token=
&signature=
&expire=
```

删掉以后再播放。

正确做法是保存两个值：

```text
originalUrl
```

用于实际播放。

另生成：

```text
resourceFingerprint
```

只用于内部去重。

即：

```text
Original URL
    ↓
绝不修改
    ↓
播放器


Original URL
    ↓
Normalize
    ↓
Fingerprint
    ↓
去重
```

---

# 十一、候选资源评分，而不是简单 true/false

可以采用：

```text
Candidate Score
```

例如：

```text
发现 DASH MPD                    +100

发现 HLS Master                  +100

Content-Type = video/*           +70

Content-Type = audio/*           +60

URL 包含 .mp4                    +50

URL 包含 .m3u8                   +80

URL 包含 .m4s                    +20

URL 包含 .ts                     +10

Range Request                    +10

被 MediaSource 使用             +80

被 <video> currentSrc 使用       +100
```

最后：

```text
score > threshold
```

才进入媒体列表。

这样误报会少非常多。

---

# 十二、资源去重逻辑

同一个视频可能出现：

```text
https://cdn/a.m3u8?token=111
https://cdn/a.m3u8?token=222

https://cdn/video/seg1.ts
https://cdn/video/seg2.ts
https://cdn/video/seg3.ts
```

不要显示成 5 个资源。

应该按：

```text
页面上下文
+
Manifest
+
媒体轨
+
时间关联
+
URL结构
```

归并成：

```text
MediaAsset #1
```

理想结果始终应该接近：

```text
这个网页上有几个“节目/媒体”

而不是：

这个网页发出了多少媒体 HTTP 请求
```

---

# 十三、嗅探后先做轻量验证

进入“可播放资源”之前做一次验证。

例如：

```text
Candidate
   ↓
轻量网络验证
   ↓
检查状态
   ↓
检查Content-Type
   ↓
必要时读少量前导字节
```

判断：

```text
200 / 206
```

以及实际数据类型。

对于支持 Range 的媒体，可以只读取很小一部分数据，而不是把整个文件下载下来。

结果：

```text
VALID
INVALID
EXPIRED
UNAUTHORIZED
DRM
```

这样 UI 不会把一堆已经失效的临时 URL 显示成“可播放”。

---

# 十四、播放模块只接受“已经规范化的媒体描述”

不要：

```text
嗅探器发现 URL
        ↓
player.play(url)
```

建议：

```text
MediaDescriptor
{
    type:
        progressive
        hls
        dash

    manifest

    videoTracks[]

    audioTracks[]

    subtitles[]

    sessionContext

    drm
}
```

然后：

```text
MediaDescriptor
       ↓
Playback Engine
```

---

# 十五、播放策略

### Progressive MP4

```text
URL
 ↓
带当前Session请求
 ↓
播放器
```

### HLS

```text
Master m3u8
 ↓
播放器解析 Variant
 ↓
选择画质
 ↓
加载 Media Playlist
 ↓
Segment
```

### DASH

```text
MPD
 ↓
播放器解析
 ↓
选择 Video Representation
          +
选择 Audio Representation
 ↓
同步播放
```

### MSE

如果能够恢复：

```text
MPD / HLS / 原始流
```

优先交给原生播放器。

如果只能得到：

```text
浏览器内部生成的数据流
```

而无法恢复稳定媒体描述，则不要假装存在一个“可复制的真实 URL”。

---

# 十六、DRM 要作为独立状态处理

嗅探阶段检测：

```text
MPD ContentProtection

PSSH

encrypted event

MediaKeys / KeySystem
```

一旦判断为 DRM：

```text
MediaAsset
{
    drm = true
}
```

之后不要继续把它当普通 MP4/M3U8。

W3C EME 的模型本身就是：

```text
Encrypted Media
      ↓
HTMLMediaElement
      ↓
EME
      ↓
Key System / CDM
      ↓
License Exchange
      ↓
Playback
```

CDM 才负责受保护内容的解密，而且认证/授权依然由内容服务控制。([W3C][1])

因此播放逻辑是：

```text
检测到 DRM
     ↓
当前播放器是否支持对应 KeySystem？
     │
   否 ──→ 不可播放
     │
    是
     ↓
当前会话正常请求 License
     ↓
License Server
     │
授权失败 ──→ 不可播放
     │
授权成功
     ↓
CDM
     ↓
播放
```

**不要把 DRM 媒体进入普通直链播放通道。**

---

# 十七、会员画质就在这里处理

比如 Manifest：

```text
360P
720P
1080P
4K
```

不要简单认为：

```text
解析到了 4K
=
可以播放 4K
```

正确状态应该是：

```text
Representation
{
    resolution: 3840x2160

    advertised: true
    authorized: ?
    playable: ?
}
```

然后实际验证。

最终可能是：

```text
360P   ✓
720P   ✓
1080P  ✓
4K     × entitlement
```

也可能游客得到的 Manifest 从开始就是：

```text
360P
720P
```

根本不存在 1080P / 4K。

还可能是：

```text
4K Manifest     ✓
4K Segment      ✓
DRM License     ×
```

最终仍然不能播放。

因此：

> **资源发现和播放授权必须是两个状态。**

---

# 十八、临时 URL 过期处理

大型视频网站的资源地址经常有有效期。

播放过程中：

```text
403
401
URL expired
```

最佳实践不是试图自行生成新的签名。

而是：

```text
播放器发现授权地址失效
        ↓
重新激活原网页会话
        ↓
网页正常重新获取播放信息
        ↓
重新嗅探
        ↓
建立新的 MediaDescriptor
        ↓
从原时间点继续播放
```

即：

```text
重新嗅探
而不是
逆向签名
```

这种方案维护成本最低，也最适合不同视频网站。

---

# 十九、最终推荐的嗅探状态机

整个逻辑可以浓缩为：

```text
PAGE_OPEN
   │
   ▼
OBSERVE
网络 + DOM + MSE + DRM
   │
   ▼
COLLECT
收集候选请求
   │
   ▼
CLASSIFY
MP4 / HLS / DASH / AUDIO / MSE / DRM
   │
   ▼
GROUP
分片 → Representation
Representation → MediaAsset
   │
   ▼
PARSE
Manifest
   │
   ▼
BUILD_MEDIA_GRAPH
   │
   ▼
VALIDATE
当前 Session 是否可访问
   │
   ├──── unauthorized ──→ 标记不可播
   │
   ▼
PLAYABLE
   │
   ▼
HANDOFF
URL/Manifest + Session Context
   │
   ▼
PLAYER
   │
   ├── Progressive
   ├── HLS
   ├── DASH
   └── DRM/CDM
   │
   ▼
PLAY
```

其中最重要的设计原则就是这一句：

> **嗅探器应该让网站在合法会话里自己完成鉴权和播放地址生成，然后观察最终媒体拓扑，把当前会话已经有权访问的资源交给正确的播放器。**

对于 MSE，浏览器本身可以通过 `MediaSource` 和多个 `SourceBuffer` 动态构造音视频流，所以“找到一个视频 URL”已经不是现代嗅探器的正确抽象；应该恢复的是**媒体清单、轨道关系和播放会话**。([W3C][3])

对于 DRM，则明确停在正常的 EME/CDM/License 播放链路，不把“拿到媒体 URL”误认为“拿到了播放权限”。([W3C][4])

---

# 二十、NewsNook 当前实现

本节记录仓库中的实际实现，作为前述设计原则的落地说明。设计目标与代码现状发生差异时，以本节和 [`architecture.md`](./architecture.md) 为准。

## 20.1 实际数据流

```text
resolveArticleBody
  ├─ 静态 HTML/JSON（始终）
  └─ Android SniffSession（始终，quiet window）
       Network + SW + DOM/MSE + fetch/XHR JSON + __playinfo__
            → Classifier / Probe / ApiParser
            → MediaAsset[]
            → selectPlayableAsset → MediaDescriptor 适配
            → InkVideoPlayer
            → OriginHeaderStore exact origin
```

运行时 WebView（SniffSession）仅用于当前文章或其播放器嵌入页的一次短时探测，不作为常驻浏览器，也不把媒体字节或登录凭据写入正文缓存。静态 HTML / JSON 与 Android 运行时嗅探始终都跑：静态已经给出可信媒体时仍会启动 SniffSession，在 quiet window（清单/MSE 等高价值信号静止约 800ms，且已过最短时长）结束后收集观察，而不是「得到完整候选后立即停止」。正文含 iframe 时最多对 3 个嵌入页与文章页一并探测，按目标顺序共享一个全局 deadline；首个目标获得完整预算，后续目标只使用剩余时间。播放器 iframe 的 inline 配置若声明强媒体 URL，即使页面脚本在首次媒体请求前报错，也可在 iframe 文档自身已被当前 SniffSession 加载的前提下进入 Graph；普通跨文档消息仍要求媒体 URL 真实出现在网络观察中。Web 平台无 SniffSession，仅静态 HTML/JSON 观察。

**自建源视频（Android）例外路径：** 当 `isCustomSourceId` 且 `contentType === 'video'` 时，阅读器上方挂载可见可操作的原站 WebView（`startLiveSession`），旁路观察与表面同寿、不以 quiet/timeout 结束会话；出现可信非广告 `MediaDescriptor` 后显示浮钮「用阅读器播放」，用户点击才进入 `InkVideoPlayer`。离开文章调用 `stopLiveSession`。此路径不替代内置源与 Web 上的短时 SniffSession。

## 20.2 候选选择与媒体描述

内部先建成 `MediaAsset[]`（清单 + 多轨），再由 `selectPlayableAsset` 选出一个最优非 DRM 资产，薄适配为现有 `MediaDescriptor`。阅读器仍只交给自定义播放器一个结果；播放表面仍是 `InkVideoPlayer`，不上 Media3。

当前支持规范化为以下三类可播放描述：

| `MediaDescriptor.type` | 发现信号 | 播放路径 |
|---|---|---|
| `progressive` | `video/*`、`audio/*` 或常见直链扩展名；视频描述会排除纯音频候选 | HTMLMediaElement；Android 必要时走流式请求桥 |
| `hls` | HLS MIME 或 `.m3u8` | 原生 HLS 能力或 hls.js |
| `dash` | `application/dash+xml`、`.mpd`，或分离音视频轨合成的最小 MPD | dash.js；Android 用会话化请求桥承接清单与分片 |

选择规则不是“第一个看起来像视频的 URL”，也不是“第一个完整候选就停”：

- HLS / DASH Manifest 高于单文件；广告 MP4 与后期 HLS 并存时选出 HLS。DOM `currentSrc`、MSE、fetch/XHR、网络、Service Worker 与静态信号都进入同一观察池。
- 不要求 URL 带文件扩展名：`mime` / `content-type` / `format` 等查询参数、Probe 得到的 Content-Type、以及结构化播放器 payload 中的 MIME、codec、音视频属性都会参与 Classifier。无扩展名的未知 URL 可由 Android `MediaProbe`（HEAD，必要时小 Range GET）补 MIME。
- `.m4s` 按角色分类：video MIME（或无 MIME 的 `.m4s`）为 `video-track`，audio MIME 为 `audio-track`，不是一律当垃圾分片丢弃。成对的音视频轨可合成最小 MPD，以 `dash` 交给现有 dash.js。
- API 明确声明的分离轨会保留 `initialization` / `index_range`，合成 MPD 输出 `SegmentBase`，避免 dash.js 丢失初始化段、索引段和 seek 能力。
- URL 查询参数中的 `range` / `bytes` 经 `logicalMediaUrl` 剥离后聚合为同一条轨；带 byte-range 的响应不得作为 `MediaDescriptor.url` 交给播放器。
- 真机 quiet window 可能只观察到 YouTube `googlevideo.com/videoplayback` 的单个分片；在 MIME 已确认且 CDN 已知的前提下允许将该单段提升为逻辑轨，同时仍保留 `expire` / `sig` 等播放授权参数。
- 同一资源按指纹合并多个观察来源；只有内部去重指纹会忽略常见临时授权参数，`MediaDescriptor.url` 始终保留原始签名 URL。
- 结构化播放器数据能够明确区分 muxed 音视频资源和 video-only 自适应轨；自定义播放器优先完整资源，不能把单独视频轨伪装成可完整播放的视频。
- fetch/XHR 的小型 JSON/text 与页面 `__playinfo__` 由 ApiParser 抽出 playurl / DASH 轨。
- 最多读取两个高分 Manifest 的前 512 KiB，用于补充 HLS 变体、音轨、字幕或 DASH Representation 与 DRM 状态；解析失败不会丢弃已经发现的可播放 URL。
- `blob:` 只作为 MSE 运行时信号，不作为可移交的 CDN URL；Graph 合成的 MPD 可以使用阅读器 WebView 里创建的 `blob:`。当前实现不会重组任意站点私有的 SourceBuffer 字节流。

稳定边界是 `src/features/mediaSniffer/types.ts`：阅读器消费 `MediaDescriptor`；图与轨模型是 `MediaAsset` / `MediaAssetTrack`（`role`）。正文解析只消费描述，不再依赖虎嗅、网易等站点的固定画质字段；站点适配负责取得可用页面或 payload，媒体识别交给通用模块。

## 20.3 会话、防盗链与代理

媒体 URL 不能脱离发现它的页面上下文。Android `OriginHeaderStore` 按 **exact origin**（scheme+host+port，默认端口省略）键入嗅探时捕获的请求头；播放时按目标 URL 的 origin 取头。

交给播放器的描述会携带：

- 原始媒体 URL；
- `pageUrl` / Referer 来源页；
- 探测时可安全复用的请求头（`data-media-headers` 只序列化非凭证头）；
- 当前 WebView Cookie（仅 exact origin）；
- 用户已配置的 HTTP / SOCKS5 代理路由。

规则：

- Cookie / Authorization **不跨 origin**：同 origin 才带页面凭证；跨 origin 的 CDN 只用该 origin 自己捕获的头，Referer 回落到页面 origin。
- 从不复制网页捕获的 `Range`，以免播放被钉死在旧字节窗口。
- `InkVideoPlayer` 手势与内核未改。

Android 播放前通过 `MediaSniffer.preparePlayback` 登记一个短生命周期会话，`MediaPlaybackWebViewClient` 仅在需要时流式补齐 Referer、Cookie、请求头或代理，不缓存、拼接或改写媒体字节。公开 progressive 视频优先留在 WebView 原生网络栈中，以保持 Range 请求和持续播放；显式请求头、用户隧道、DASH 或直连失败后的 progressive 重试才启用桥接。

播放上下文按候选实例保留，不再由同一 origin 的后一次探测覆盖前一次；登记时快照对应 exact origin 的观察头，后续分片请求只使用自身 origin 的快照。网络观察池满载时按 manifest / 媒体 MIME / API body 优先级淘汰低价值静态噪声；Network、Service Worker 与 JS 高价值事件共同推动 quiet window。

签名 URL 过期或服务端返回 401/403 时，播放器显示“重新探测”。该操作重新执行正文解析和原页探测，取得新的 `MediaDescriptor`；不会猜测、生成或逆向签名。

## 20.4 DRM 与授权边界

以下任一信号会把描述标记为 DRM：

- HLS 非 `identity` 的 `KEYFORMAT`；
- DASH `ContentProtection`；
- 页面调用 EME `requestMediaKeySystemAccess`。

自定义播放器只直接接收非 DRM 描述。检测到 DRM 时提示在原站授权播放，不截获 License、不绕过 CDM、不降级窃取加密分片。付费、地区、账号或会员权限仍由原站决定。

## 20.5 自定义播放器能力

`InkVideoPlayer` 是文章视频的统一播放表面：

| 类型 | 操作 |
|---|---|
| 基础控制 | 播放/暂停、进度、缓冲状态、0.75x～2x 倍速、静音、全屏 |
| 快捷操作 | 点击暂停态中央按钮继续播放；双击画面切换播放/暂停；播放时长按临时 2.5x |
| 全屏手势 | 下半屏横滑调整进度；左下竖滑调整屏幕亮度；右下竖滑调整系统媒体音量 |
| 画面手势 | 双指缩放；放大后单指平移；顶部按钮还原缩放和平移 |
| 横竖屏 | Android 优先锁定 Activity 方向，使视频、控制条、系统返回/主页/最近任务区域一起旋转；横向视频进入全屏时自动请求横屏，退出或卸载播放器时恢复原方向 |
| 降级 | Web 或系统拒绝方向锁定时，旋转整个播放器交互平面；视频、进度条和按钮保持同一坐标系 |

装饰性渐变不拦截画面手势，只有实体按钮和进度条接管指针事件。Android 原生安全区同时注入上、下、左、右四个方向，横屏三键导航、手势导航或挖孔区域不会覆盖控制组件。

## 20.6 嵌入播放器的“先嗅探、后降级”

正文中的 YouTube 等播放器 iframe 与普通 `<video>` 走相同的资源发现边界：

```text
iframe URL
  → 带正文 Referer 的隔离 WebView
  → 网络请求 + DOM/MSE + 结构化播放器状态
  → 完整、非 DRM MediaDescriptor
      ├─ 是 → InkVideoPlayer
      └─ 否 → 原站 iframe / 原文兜底
```

隔离 WebView 会在静音状态尝试启动页面已有的媒体元素，以让按需加载的资源实际进入网络拓扑；不会点击任意页面按钮、提交表单或伪造账号权限。YouTube 这类 MSE 播放器常同时暴露 video-only 与 audio-only 自适应轨；成对轨可由 Graph 合成最小 MPD 后交给 `InkVideoPlayer`，muxed 资源或 HLS/DASH 清单同样可切换到自定义播放器。只观察到 `blob:`、byte-range 分片、无法配对的分离轨、DRM/EME 或失效签名时，均视为尚未形成可交付资源并保留原站播放链路。

“全部资源嗅探”指观察当前合法页面会话能够公开产生的媒体信号，并不承诺把任何站点都转换成直链。付费、登录、地区、DRM/CDM、私有加密协议或服务端拒绝仍是明确的降级边界。

## 20.7 代码与验证入口

| 职责 | 入口 |
|---|---|
| 分类、Range 聚合、`.m4s` 角色 | `src/features/mediaSniffer/classifier.ts` |
| exact origin 头策略 | `src/features/mediaSniffer/originHeaders.ts` |
| JSON / `__playinfo__` | `src/features/mediaSniffer/apiParser.ts` |
| Media Graph、`selectPlayableAsset`、合成 MPD | `src/features/mediaSniffer/graph.ts` |
| 静态 HTML/payload、HLS/DASH 解析、Descriptor 适配 | `src/features/mediaSniffer/core.ts` |
| 静态+runtime 始终编排、`MediaDescriptor` 输出 | `src/features/mediaSniffer/service.ts` |
| Android 嗅探与播放会话桥 | `src/features/mediaSniffer/native.ts`、`android/.../MediaSnifferPlugin.java` |
| Probe / Service Worker / Origin 头存储 | `android/.../MediaProbe.java`、`ServiceWorkerSniffer.java`、`OriginHeaderStore.java` |
| Android 流式请求上下文 | `android/.../MediaPlaybackWebViewClient.java` |
| 正文接入与失败重探测 | `src/lib/resolveBody.ts`、`src/screens/ReaderScreen.tsx` |
| 自定义播放器 | `src/components/InkVideoPlayer.tsx` |
| 手势纯函数 | `src/lib/videoGestures.ts` |
| 亮度、音量、系统方向 | `src/lib/deviceMediaControls.ts`、`android/.../DeviceMediaControlsPlugin.java` |

相关验证命令：

```bash
npm run test:media-sniffer
npm run test:inline-video
npm run test:video-gestures
npm run build
npm run android:sync
```
