# News Nook 应用架构

> 日期：2026-08-12  
> 范围：仓库根目录主工程（Vite + React + Capacitor Android）  
> 相关文档：[产品设计](./superpowers/specs/2026-07-31-newsnook-mobile-app-design.md)、[旧版源逆向](./news-sources.md)、[构建说明](./android-build.md)、[用户手册](./user-guide.md)

## 1. 一句话

News Nook（有所闻）是**无后端**移动新闻阅读客户端：静态源注册表驱动，客户端直连上游 RSS/JSON，站内解析全文，经 Capacitor 打包为 Android APK。

## 2. 目标与约束

| 约束 | 含义 |
|---|---|
| Backendless | 无自建 API、无账号、无云同步；列表与正文均由客户端直连上游 |
| 站内全文 | 点开条目必须在 App 内呈现可读正文；「打开原文」只能是次要操作 |
| 双运行时 | Web 端（开发态靠 Vite 代理，生产态靠 Cloudflare Pages Functions 边缘代理）；App 运行态靠 `CapacitorHttp` 与用户可选代理隧道 |
| 本地持久化 | 偏好、稍后读、已读、场景预设、列表/正文缓存全部落在本机 |

## 3. 仓库布局

```text
newsnook/
├── src/                      # React 应用
├── android/                  # Capacitor 原生工程（入库）
├── functions/                # 生产边缘：/api/* 反向代理 + /a/* 社交分享卡片
├── public/                   # favicon、品牌 SVG、字体，以及 _redirects（/a/* 深链回退）
├── assets/                   # 启动图 / Android 图标源图
├── scripts/                  # 构建、探针与单元测试脚本
├── dist/                     # Vite 产物（capacitor webDir）
├── artifacts/                # 签名 APK/AAB（gitignore）
├── docs/                     # 设计、架构、源探测、用户手册
├── package.json              # 版本号唯一源（Gradle versionName / versionCode 同源）
├── vite.config.ts
└── capacitor.config.ts
```

## 4. 技术栈

| 层 | 选型 |
|---|---|
| UI | React 19、TypeScript、Tailwind CSS v4、lucide-react、animejs |
| 解析 | fast-xml-parser、@mozilla/readability、linkedom、DOMPurify |
| 媒体 | hls.js（HLS）、dash.js（MPEG-DASH）、`features/mediaSniffer`（资源发现与媒体图） |
| 原生 | Capacitor 8（App / Browser / Preferences / StatusBar / CapacitorHttp / Share）+ 可选 ML Kit / Bergamot 翻译 + DeviceMediaControls + VolumePageTurn + MediaSniffer |
| 构建 | Vite 8、oxlint、Gradle（minSdk 24 / targetSdk 36） |

## 5. 分层架构

```text
┌──────────────────────────────────────────────────────────────┐
│  Presentation                                                │
│  screens/* · components/*                                    │
│  （无路由库；App.tsx 内状态机切换 Tab / 设置栈 / 阅读器）        │
├──────────────────────────────────────────────────────────────┤
│  Domain                                                      │
│  hooks/useFeeds · usePreferences · usePullToRefresh          │
│  hooks/usePresets · usePagedReader                           │
│  sources/registry · categories · preferences · presets       │
│  features/translation/   TranslationService + Provider 接口    │
│  features/proxy/         智能分流 / 隧道 / 原生 HTTP 封装       │
│  features/comments/      跟贴 Provider（网易/知乎/煎蛋等）      │
│  features/mediaSniffer/  媒体候选 / HLS·DASH 清单 / DRM 状态  │
│  features/appUpdate/     GitHub Release 检测与应用内更新        │
├──────────────────────────────────────────────────────────────┤
│  Data                                                        │
│  lib/http · parseFeed · resolveBody · bodyCache · storage    │
│  lib/opml · sanitize · normalizeImages · eink                │
├──────────────────────────────────────────────────────────────┤
│  Runtime / Native                                            │
│  Web: Vite /api 代理（开发）/ Cloudflare Functions（生产）      │
│  App: CapacitorHttp + Preferences + 可选 ML Kit / Bergamot    │
└──────────────────────────────────────────────────────────────┘
```

依赖方向严格自上而下：UI 不直接拼上游 URL；源 URL 与 kind 只来自 `sources/registry.ts`（含用户自建源）。

## 6. 信息架构与导航

底部主 Tab（「综合频道」管理入口在「我的 → 分类与自动刷新」，见 `App.tsx`）：

| 界面 | 职责 |
|---|---|
| 速闻 `FeedScreen` | 分类轨 + 多源混合时间线 + 下拉刷新 + 场景预设切换 |
| 我的 `MeScreen` | 稍后读、最近阅读、本地搜索、设置入口 |
| 阅读器 `ReaderScreen`（lazy） | 站内全文 / 视频 / 墨水屏分页 / 翻译 / 跟贴 / 分享 / 错误重试 |
| 设置栈 | 自定义订阅、分类与信源、场景预设、排版、外观、翻译、代理、存储与备份、本地搜索、关于 |

设置路由（`SettingsRoute`）包括：`typography`、`appearance`、`translation`、`proxy`、`presets`、`custom-sources`、`categories`、`channels`、`category-sources`、`category-edit`、`later`、`history`、`local-search`、`storage`、`about`、`changelog`、`licenses`。

Android 物理返回键由 `@capacitor/app` 在 `App.tsx` 统一处理：阅读器 → 设置栈 → 单源焦点 → 退出确认。

## 7. 源模型

### 7.1 SourceKind

`SourceKind`（`src/sources/registry.ts`）按协议与站点定制分多类，核心如下：

| 类别 | kind 示例 | 说明 |
|---|---|---|
| 通用 Feed | `feed` | RSS 2.0 / Atom / RDF / JSON Feed |
| 搜索聚合 | `google-news` | Google News RSS，需解码真实 URL |
| 门户 JSON | `netease`、`zhihu` | 网易移动端列表、知乎日报 |
| 站点定制 | `latepost`、`jandan`、`jiqizhixin`、`cls`、`eastmoney-*`、`wscn-live`、`guokr`、`jazzyear`、`arena`、`anthropic`、`paulgraham`、`wordpress` 等 | 各站列表/详情协议与 UA 在 registry 中声明 |
| 用户自建 | `feed`（`isCustom: true`） | OPML 导入或手动添加，走通用解析 |

内置源按 `SourceGroup`（`cn` / `intl` / `tech` / `ai` / `special` / `custom`）分组；用户可在「综合频道」单独开关，或在分类下覆盖选源。

### 7.2 分类与场景

分类轨（`sources/categories.ts`）：

- **综合**：跟随用户启用的全部源
- 其余分类：绑定默认 `sourceIds`，可由偏好覆盖

场景预设（`sources/presets.ts` + `hooks/usePresets.ts`）：快照分类顺序/显隐、各类别选源与综合频道启用列表。内置可就地改并覆盖存储，另存为才复制成用户预设；`activePresetId` 可直接指向内置 id。

### 7.3 用户偏好

`sources/preferences.ts` + `hooks/usePreferences.ts` 管理：

- 分类顺序/显隐、分类选源、综合频道启用列表
- 正文字号/字体/行高/段距/首行缩进（CSS 变量注入阅读器）
- 主题 `system | light | dark`；风格方案 `ink | celadon | custom`（与明暗正交，custom 配色见 `lib/customScheme.ts`）；**墨水屏** `einkMode`（行为叠加，非第三主题）
- 翻译引擎、语言、呈现方式、云 API 配置、列表标题翻译
- 代理模式与地址、切换分类时自动刷新

主题（`lib/theme.ts`）：明暗解析后写入 `<html data-theme>`；风格方案写入 `<html data-scheme>`（默认 `ink` 墨问，另有天青一套内置配色与 `custom` 自定义；已下线方案在读取偏好时自动回落墨问）。`index.css` 语义色 `--color-ink / --color-paper / …` 统一指向 `--tone-*`；内置方案块按 `[data-scheme][data-theme]` 重绑同一组 token，`--tone-cinnabar` 是「主题强调色」语义 token（各方案取色不同，名称保留兼容）。自定义配色（`lib/customScheme.ts`）：用户只选昼/夜两档的「底色 + 强调色」（存 `prefs.customScheme`），其余 token 由 `deriveSchemeTokens` 按对比度推导并内联到 `<html>`（内联优先于样式表，故无静态方案块；切回内置方案按 `CUSTOM_TOKEN_KEYS` 移除）；推导含文字色/强调色可读性兜底。图片查看器与视频播放器局部 `data-theme="dark"`（自定义方案下保持墨问夜读底色，与既有「固定深色」设计一致）。首屏由 `index.html` 内联脚本先行定色，并同步写入 `data-scheme` / `data-eink` 防闪。

## 8. 核心数据流

### 8.1 列表加载

```text
App 计算 fetchIds（当前分类源 ∪ 启用源 ∪ 单源 focus）
  → useFeeds.refresh()
      → 启动：loadCachedList 先渲染
      → 每源并行（feedRefreshConcurrency 限流）：
           http.fetchSourceText
             Web dev: GET /api/feed/{id}（Vite 代理改 Host/UA，可跟用户代理）
             Web prod / App: CapacitorHttp 或 ProxiedHttp 隧道
      → parseSourcePayload → Article[]
      → saveCachedArticles（剥掉 contentHtml，约 40 条/源）
      → 单源失败不影响其它源
  → App 按 categorySourceIds 过滤后交给 FeedScreen
```

列表模型见 `lib/types.ts` 的 `Article`：元数据为主；`contentHtml` 仅在 Feed 已带全文时短暂存在，不进入长期列表缓存。

### 8.2 打开文章 / 正文解析

```text
openArticle → setReading + markRead
  → ReaderScreen
      → 命中 bodyCache？→ 直接渲染
      → 否则 resolveArticleBody(article)：
           1. 视频稿/正文媒体 → 静态 HTML·JSON + Android 网络/DOM/MSE 观察
              → 候选评分与去重 → HLS/DASH 媒体图 → InkVideoPlayer
           2. Feed 已有足够 HTML → feed
           3. 网易 / 知乎 / 站点定制 kind → 各专用解析路径
           4. GET originUrl（简繁 URL 互试，最多 2 次）
              → Readability 抽取 → readability
           5. 失败 → 错误态可重试（禁止以外链替代主路径）
      → normalizeContentImages → sanitizeArticleHtml → saveCachedBody
```

正文预取：稍后读加入时入队，`BODY_PREFETCH_CONCURRENCY = 2`，离开稍后读则跳过。

### 8.3 媒体嗅探与自定义播放器

媒体能力分成“发现、描述、播放”三层，正文解析不直接控制播放器：

```text
HTML / JSON / iframe 嵌入页 / Android 短生命周期 WebView
  → MediaObservation[]（network / DOM / fetch / XHR / performance / MSE / DRM）
  → admitObservation（Classifier Gate：静态资源/performance 噪声/弱 structured 信号过滤）
  → collectMediaCandidates（分类、评分、指纹去重、分片抑制）
  → HLS / DASH Manifest 轻量解析
  → MediaDescriptor（原始 URL + pageUrl + headers + tracks + DRM）
  → mediaDescriptorHtml
  → InlineArticleVideos
  → InkVideoPlayer
```

关键约束：

- **Classifier Gate**（`classifier.admitObservation`）：任意 observation 入库前统一 URL-first 门控；图片/CSS/JS/字体扩展名、无 MIME/codec/清单扩展名的 `static` 弱信号、非媒体形态的 `performance` 条目会被丢弃；`selectPlayableAsset` 进一步排除仅含 `static` 源的弱候选。
- **Target Planner**（`targetPlanner.planSniffTargets`）：静态扫描未发现 direct media 时，按 JSON-LD embedUrl/WatchAction → 同站通用播放路径链接 → iframe 嵌入页的优先级规划 secondary 播放页；首个目标使用完整预算，编排层以全局 deadline 截断后续目标，避免均分后每个播放器只剩短窗口。
- 静态 HTML / payload 已发现可播放资源时，不再启动 Android 运行时探测；否则由 `MediaSnifferPlugin` 在隔离 WebView（360×640，屏外）中观察网络、DOM、MSE 与 EME 信号；probe 队列跳过常见 tracker 域并提高无扩展名 URL 探针配额（24/会话）。
- 正文 iframe 不直接绕过发现层：最多取 3 个嵌入页作为独立探测目标。已加载 iframe 文档中的 inline 强媒体配置可作为静态观察进入 Graph，但普通跨文档消息仍需对应媒体 URL 的网络观察。YouTube 组件先探测公开、非 DRM 且可完整播放的资源，成功后交给 `InkVideoPlayer`；只有未得到完整资源、只得到分片/无声自适应轨、检测到 DRM 或加载失败时，才回退原站 iframe。
- 无扩展名 URL 会从查询参数和结构化播放器数据推断 MIME；URL 自带 byte range 的响应只记为分片，不能作为完整 progressive 视频。结构化候选明确区分复用音视频资源与 video-only 自适应轨。
- 播放 URL 保留完整签名参数；去重指纹才忽略常见临时授权字段。完整 Manifest 存在时不把 `.ts` / `.m4s` 分片当成视频。
- `MediaDescriptor` 只向播放器交付 `progressive`、`hls`、`dash`；`blob:`/MSE 是发现信号而非可移交 URL；DRM 进入原站授权边界，不尝试绕过。
- Android 播放会话短时登记来源页、Cookie、必要请求头与用户代理路由。公开 progressive 优先使用 WebView 原生 Range 请求；显式请求头、隧道、DASH 或 progressive 直连失败时才启用 `MediaPlaybackWebViewClient` 流式桥接。
- 播放失败后的“重新探测”通过 `ReaderScreen.retryToken` 重新执行正文解析与原页发现，不生成或逆向签名。

`InkVideoPlayer` 统一处理 HLS/dash.js/HTMLMediaElement、播放控制、双击播放/暂停、长按临时倍速、进度/亮度/音量手势、捏合缩放、平移和还原。Android 横向视频进入全屏时优先锁定 Activity 横屏，系统导航栏和四向安全区随屏幕一起旋转；退出全屏或卸载播放器时恢复原方向。方向锁定不可用时才旋转播放器交互平面，确保视频与控件仍处于同一坐标系。

完整设计与实现映射见 [`xiutan.md`](./xiutan.md#二十newsnook-当前实现)。

### 8.4 文章翻译

```text
ReaderScreen（只依赖 TranslationService）
  → 从已消毒 HTML 抽取可见文本节点
  → TranslationProvider.translate(texts[])
       ├── MlKitProvider      → local 包 · 设备语言包
       ├── BergamotProvider   → local 包 · Marian 离线模型（arm64-v8a）
       ├── GoogleProvider     → Cloud Translation v2
       ├── AzureProvider      → Translator Text API v3
       ├── DeepLProvider      → 官方 /v2/translate
       ├── DeepLXProvider     → 自建 /translate
       └── OpenAiProvider     → OpenAI 兼容 Chat Completions
  → 按节点原位回填译文 → 原文/译文切换
```

译文呈现：`replace`（只显示译文）或 `compare`（段落下附译文）。列表标题可单独缓存翻译（`features/translation/feedTranslationStorage.ts`）。

`features/translation/types.ts` 是稳定边界；新增提供商只需实现 `TranslationProvider` 并在工厂注册。`local` 构建变体注册 ML Kit 与 Bergamot 原生插件；`cloud` 变体提供空实现，保证轻量包不含 JNI 翻译库。

### 8.5 跟贴评论

```text
ReaderScreen / CommentsDrawer
  → features/comments/service.findCommentProvider(article)
       ├── eastmoney / netease / zhihu / jandan / hackerNews
  → provider.getComments(tab, offset) → 渲染 CommentCard
```

仅部分源实现 `CommentProvider`；不支持时隐藏跟贴入口。

### 8.6 阅读位置、分享与本地搜索

三者都只读写本机数据，不新增任何网络路径：

```text
阅读位置  ReaderScreen 滚动 / usePagedReader 翻页
            → lib/readingPosition（内存表 + 800ms 节流落盘）
            → newsnook:reading-pos（单键整表，按 updatedAt 保留最近 240 篇）
          重开文章：正文就绪后按「记录时可滚动高度 → 当前可滚动高度」等比折算回落
          顶部附近（<120px）与读到结尾（≥97%）视为无需记忆，会清掉旧记录

分享      ReaderMoreMenu / EinkReaderMenu（两个入口同一流程）
            → ShareArticleSheet（应用内预览卡片，只用主题变量着色）
            → lib/shareLink.buildShareUrl（站内短链，v2 只带原文地址 + 信源 id，见 8.6.1）
            → lib/shareArticle
                 Android：@capacitor/share（标题 + text + url）
                 Web：navigator.share，不支持时降级 navigator.clipboard

本地搜索  LocalSearchScreen
            → lib/localSearch.loadCachedListArticles（枚举 cache:v3:* 列表缓存）
              + 稍后读 + 最近阅读（正文缓存元数据）
            → buildLocalSearchCorpus（按 id 去重，稍后读 > 最近阅读 > 列表缓存）
            → searchLocalArticles（空格切片 AND 子串匹配，标题/摘要/信源名加权，默认取前 80 条）
```

本地搜索与 `web-catalog` 源的 `searchTemplate`（站内联网搜索）是两条独立路径：前者零请求，只覆盖本机已有内容。

#### 8.6.1 分享深链 `/a/<token>`

分享出去的主链接固定指向站内：`https://news.aizeek.com/a/<token>`（常量集中在 `lib/shareLink.ts` 的 `SHARE_LINK_HOST` / `SHARE_PATH_PREFIX`）。**没有任何服务端参与**——token 自带打开阅读器所需的全部字段，接收端本地解码后照常走 `resolveBody` 抽正文。出版社地址只是 token 里的一个字段，供正文抽取与用户主动「在浏览器核对原文」使用，不作为分享主链接。

token 载荷当前是 **v2**：只留「能打开这篇」的两个必需字段，中文一律不进链接。v1 的短键 JSON（带标题、摘要、信源名、时间）仍然可解码，旧链接不失效。

```text
v2 明文（换行分隔，比 JSON 再省掉键名与引号）
  第 1 行  "2.<校验位>"      版本号 + 其余内容的 4 位 djb2 短哈希
  第 2 行  sourceId
  第 3 行  原文地址          https:// 前缀省略不写
  第 4 行  可选 id           以 ':' 开头表示补回 `<sourceId>:` 前缀

编码  Article ─ sharePayloadFromArticle ─→ { originUrl, sourceId, id? }
                                            ↓ 上述明文 + UTF-8 + URL-safe base64
                    buildShareUrl ─→ https://news.aizeek.com/a/<token>
                    （开发态 resolveShareOrigin 用 window.location.origin，原生壳与生产固定 news.aizeek.com）

解码  冷启动 App.tsx
        → shareTargetFromLocation()  读 location.pathname，只认单段 /a/<token>
        → decodeShareToken()         按首行分流 v2 / v1，校验位、字段、长度与 http(s) 协议校验，失败返回 null
        → articleFromSharePayload()  本机认识该 sourceId 就用注册表元数据，否则退回「分享来源」
        → 直接进 ReaderScreen（正文仍是站内抽取），token 坏了则弹中文提示并停在首页
```

- **为什么砍字段**：中文在 UTF-8 + base64 下膨胀三倍，v1 把标题、摘要、信源名全编进去，典型条目要 450～550 字符，聊天工具里折行、被截断就打不开。v2 网易稿 86 字符、公众号稿 82 字符（完整 URL 112 / 108）。
- **标题与信源名从哪来**：标题不编码，打开后先显示 `SHARE_PENDING_TITLE`（「加载中…」），`resolveBody` 抽完正文由 `ResolvedBody.title` 顶掉；抽取失败退到 `SHARE_FALLBACK_TITLE`（「分享的文章」）。信源名查 `sources/registry`，不认识就写「分享来源」。`withResolvedShareTitle` 保证落进正文缓存与稍后读的是补齐后的标题，不是占位符。
- **id 怎么省的**：列表侧的条目 id 是 `lib/articleId.feedArticleId(sourceId, link)`（`<sourceId>:<djb2 哈希>`）。接收端用同一函数按原文地址算，绝大多数条目算出的 id 与发送端完全一致，已读 / 正文缓存 / 稍后读因此能对上，第 4 行也就不用出现。算不出来（例如 Google News 解码后换过地址）才写进去，且去掉冗余的 `<sourceId>:` 前缀、超过 40 字符就宁可丢掉。
- **校验位**：紧凑载荷被截断后仍可能解出一个「看着合法」的短地址，会静默打开错误页面。首行 4 位校验对不上就当损坏处理，弹中文 `ConfirmDialog`。
- **拒绝面**：token 超过 2048 字符、非 base64url 字符、校验位不符、版本不匹配、缺 `sourceId` / `originUrl`、`originUrl` 非 http(s) 一律返回 `null`，不抛异常打断冷启动。`safeHttpUrl` 校验后原样返回，不做归一化——归一化会改动哈希输入，接收端就算不出发送端的 id。
- **深链可刷新**：Workers 侧靠 `wrangler.jsonc` 的 `not_found_handling: single-page-application`；Cloudflare Pages 侧靠 `public/_redirects` 里 `/a/* → /index.html 200` 这一条（只放行该前缀，`/api/*` 仍归边缘代理）；开发态由 Vite 自带的 SPA history fallback 兜底（base64url 不含 `.`，不会被当成静态文件）。关闭阅读器时 `clearShareLocation()` 把地址换回站点根。
- **与「打开原文」的区别**：分享出去的主链接永远是站内 `/a/<token>`；出版社地址只是载荷里的一个字段，供正文抽取与用户主动「在浏览器核对原文」使用，任何情况下都不会把原站 URL 当成分享结果。
- **UI 层次**：`ShareArticleSheet` 是 `z-50`，且分享卡片打开时 `ReaderScreen` 会收起跟贴悬浮胶囊与「已回到上次阅读位置」提示（两者都是 `z-40` 且在 DOM 里排在卡片之后，否则会压住卡片底部的「复制链接 / 分享」）。卡片里的链接是可点的 `<a target="_blank">`，方便自测深链。
- **Android**：暂未配置 App Links，分享出去的 https 链接由对方浏览器打开网页版站内阅读；不会偷偷回退成原站 URL。
- **模块划分**：token 的编解码单独放在 `lib/shareToken.ts`（纯函数，无 Capacitor / window 依赖），边缘 worker 也 import 同一份（见 8.6.2）；`lib/shareLink.ts` 只留浏览器侧的链接组装、深链识别与 Article 还原，并原样 re-export token API，调用方不受影响。

#### 8.6.2 社交分享卡片（边缘 worker 动态 OG 标签）

微信、WhatsApp、Telegram 这类客户端是按抓到的 HTML 里的 Open Graph 标签渲染链接卡片的，而 `/a/<token>` 走 SPA 回退给出的 `index.html` 只有通用空壳标签，链接在聊天里就是一串裸地址。**卡片由 `functions/lib/shareCard.ts` 在边缘现拼**，仍然不建库、不建 API：

```text
GET /a/<token>
  │
  ├─ 爬虫（UA 命中 facebookexternalhit / Twitterbot / WhatsApp / TelegramBot / Baiduspider … ）
  │    → decodeShareToken 拿 originUrl + sourceId
  │    → fetch 原文（3s 超时，只读前 128KB，认 content-type / meta 里的 charset）
  │    → 正则取 og:title | twitter:title | <title>、og:description | description、og:image
  │    → 返回一页只有 OG / twitter meta 的极简 HTML（Cache-Control 600s + Vary: User-Agent）
  │
  └─ 真人 → env.ASSETS.fetch(request)，SPA 回退不变
```

- **判定方式**：`wantsShareCard()` 先匹配明确的爬虫 UA。微信抓卡片与微信内置浏览器共用 `MicroMessenger` UA，只能再看 `Sec-Fetch-Mode`——真实导航带（内置浏览器基于 Chromium），抓取端不带。
- **误判兜底**：卡片页带 `<meta http-equiv="refresh">` 指向 `?app=1`；worker 见到这个参数直接放行到 SPA，所以被误判成爬虫的真人只多一跳就回到阅读页，不会来回打转。
- **兜底文案**：token 解不出来、上游超时 / 非 200 / 非 HTML，一律退到「有所闻分享」+「点击在有所闻中阅读全文」，并尽量补上「原文来自 xxx」（认识的 `sourceId` 用注册表中文名，否则用原文域名）。`og:image` 只在上游确有首图时输出，不塞占位图。
- **安全**：上游标题、摘要先按 HTML 实体还原再统一 `escapeHtml`，属性边界不会被 `">` 顶开；`og:image` 只接受 http(s)，`javascript:` 之类直接丢掉。
- **只影响 Workers 部署**：`/api/*` 的边缘代理逻辑不变；Vite 开发态没有这条路径（爬虫不会来爬 localhost），本机验证请直接跑 `npm run test:share-og`。

### 8.7 配置备份与恢复

`lib/backup.ts` 把本机关键配置导出成一个 JSON 文件，导入时按分区整段覆盖：

```json
{
  "format": "newsnook-backup",
  "version": 1,
  "exportedAt": 1756000000000,
  "appVersion": "1.6.4",
  "data": {
    "preferences": {}, "presets": {}, "enabledSources": [],
    "laterItems": [], "readIds": [], "readingPositions": {}
  }
}
```

- **校验与迁移**：`parseBackup` 检查 `format` / `version` / `data` 形状，逐分区做与运行态相同的 normalize；版本高于当前会拒绝导入，低版本走 `migrate` 补齐（当前仅 v1，新增字段一律「缺省即默认」以保持可逆）。
- **范围**：只搬配置，不搬缓存——正文缓存、列表缓存、预存正文都可再生，稍后读只留元数据（`contentHtml` 被剥掉）。
- **与 OPML 的分工**：`lib/opml.ts` 只覆盖自建订阅源，可与其它阅读器互通；备份是「有所闻」自有格式，覆盖偏好、预设、启用信源、稍后读、已读与阅读位置。
- **落地方式**：Android 写入 `Directory.Cache` 后交给系统分享面板；Web 走 Blob 下载。导入两端都用 `<input type="file">`。全程本地文件，无账号、无云同步。
- 恢复通过 `storage.writeRestoredKeys` 整段写回；该函数会等原生 Preferences 也落盘再 resolve（否则冷启动的 `hydrateNativeStorage` 会用旧值盖回来），随后由 UI 重载应用让内存态跟上。

### 8.8 持久化键

前缀 `newsnook:`（`lib/storage.ts`）：

| 键模式 | 内容 |
|---|---|
| `enabled` | 启用源 ID 列表 |
| `preferences` | 分类/排版/主题/eink/翻译/代理等偏好与 API 配置 |
| `presets` | 场景预设：`activePresetId`、用户预设、内置覆盖 |
| `custom-sources` | 用户自建源 |
| `later-items` | 稍后读文章 |
| `read` | 已读 ID 集合 |
| `reading-pos` | 阅读位置表 `{ [articleId]: { scrollTop, scrollRange?, pageIndex?, updatedAt } }`（仅 localStorage，上限 240 条） |
| `cache:v3:{sourceId}` | 列表元数据（约 7 天过期 / 12 小时标 stale） |
| `body:v1:{id}` + `body:index` | 正文缓存（约 3MB 预算，稍后读 pin） |
| `feed-translation:*` | 列表标题译文缓存 |

策略：小配置同步镜像到 Capacitor Preferences；大列表/正文只走 localStorage。启动顺序：`hydrateNativeStorage` + `applyNativeChrome` → 再 mount React。

## 9. HTTP、代理与网络安全

| 环境 | 行为 |
|---|---|
| `npm run dev` | `/api/feed/{id}`、`/api/page`、`/api/image` 由 `vite.config.ts` 代理；可同步用户代理偏好 |
| 生产静态 Web | Cloudflare Pages Functions（`functions/`）边缘代理；**不支持**应用内 HTTP/SOCKS 隧道 |
| Android App | `CapacitorHttp` 直连，或 `features/proxy` 经原生隧道；绕过 WebView CORS |
| 代理模式 | 智能分流（国际走代理）、全局代理、直连关闭 |
| 明文 HTTP | `network_security_config.xml` **仅放行** 163/126/netease + 本地调试主机 |
| 混合内容 | `capacitor.config.ts` 中 `allowMixedContent: true`（部分网易媒体仍为 http） |

图片：开发态可走 `/api/image` 带 Referer；真机直连，防盗链失败时降级为占位。

## 10. 墨水屏模式（einkMode）

正交于亮/暗主题的**行为叠加**（`prefs.einkMode`，默认 `false`）：

```text
einkMode=true
  → <html data-eink="1">（index.html 内联脚本防闪）
  → useReducedMotion 恒 true；压制动画/阴影/blur/纸纹
  → ReaderScreen：usePagedReader 分页阅读
       左区 ~28% 上一页 · 中区 ~44% 打开 EinkReaderMenu · 右区 ~28% 下一页
       音量键翻页（VolumePageTurn 原生插件）
       页码与内容偏移一起写入 newsnook:reading-pos，跨会话恢复，
       且与滚动模式共用同一张表（关掉墨水屏仍落在同一段文字）
  → 翻译/跟贴/图片/视频策略与正常模式相同
einkMode=false → 完全恢复现有上下滚动阅读，零残留
```

实现落点：`lib/eink.ts`、`lib/readerPagination.ts`、`hooks/usePagedReader.ts`、`components/EinkReaderMenu.tsx`、`lib/volumePageTurn.ts`、`index.css` 中 `[data-eink='1']` 规则。

## 11. UI 模块职责速查

| 路径 | 职责 |
|---|---|
| `src/main.tsx` / `BootstrapRoot.tsx` | 原生存储/系统栏就绪后 mount |
| `src/App.tsx` | 全局状态机、返回键、正文预取队列、设置栈 |
| `components/AppShell.tsx` | 墨砚壳 + safe-area |
| `components/TabBar.tsx` | 底栏 |
| `components/InkImage.tsx` / `InkVideoPlayer.tsx` | 图片渐进加载 / Progressive·HLS·DASH 播放 / 缩放、全屏与系统级横竖屏 |
| `components/EinkReaderMenu.tsx` | 墨水屏阅读菜单（字号、页码、翻译、收藏、分享） |
| `components/ReaderMoreMenu.tsx` | 滚动模式阅读器溢出菜单（分享、复制链接、浏览器核对、重新抽取） |
| `components/ShareArticleSheet.tsx` | 分享预览卡片（标题、信源、摘要、品牌与站内短链） |
| `components/BackupPanel.tsx` | 「离线存储与备份」里的配置导出/导入面板 |
| `lib/videoGestures.ts` / `lib/deviceMediaControls.ts` | 播放器手势 / 系统亮度、媒体音量与 Activity 方向控制 |
| `features/mediaSniffer/*` | 媒体观察、候选评分、Manifest 解析、播放会话上下文 |
| `hooks/useFeeds.ts` | 多源并行拉取与合并 |
| `lib/http.ts` | 平台分流 GET + 代理隧道 |
| `lib/parseFeed.ts` | 多 kind 列表 → `Article[]` |
| `lib/articleId.ts` | 条目 id 生成规则（列表解析与分享短链共用，见 8.6.1） |
| `lib/resolveBody.ts` | 站内全文策略 |
| `lib/bodyCache.ts` | 正文 LRU + pin |
| `lib/opml.ts` | OPML 导入导出与 Feed 探测 |
| `lib/backup.ts` | 配置备份 JSON 的采集、校验、迁移与恢复 |
| `lib/readingPosition.ts` | 阅读位置表（节流落盘、容量淘汰、按比例还原） |
| `lib/shareToken.ts` | 分享 token 的编解码（纯函数，边缘 worker 共用，见 8.6.2） |
| `lib/shareLink.ts` | 站内分享短链组装、深链识别与 Article 还原 |
| `lib/shareArticle.ts` | 系统分享面板与剪贴板降级 |
| `lib/localSearch.ts` | 本地语料合并与离线检索 |
| `lib/sanitize.ts` | DOMPurify |
| `features/translation/*` | 翻译领域模型与可替换提供商 |
| `features/proxy/*` | 代理配置、路由与原生隧道 |
| `features/comments/*` | 跟贴 Provider 与抽屉 UI |
| `features/appUpdate/*` | 版本检测、更新对话框、变体切换 |
| `screens/settings/*` | 各设置子页 |

## 12. Android 打包层

```text
npm run android:apk | android:aab
  → tsc -b && vite build          # dist/
  → cap sync android
  ├→ Gradle assembleCloudRelease | bundleCloudRelease
  │    # 不编译 ML Kit / Bergamot SDK 与 JNI
  └→ Gradle assembleLocalRelease | bundleLocalRelease
       # 编译 ML Kit、Bergamot 与本地翻译插件
  → 拷贝到 artifacts/android/newsnook-<version>-<cloud|local>-release.{apk|aab}
```

`android/app` 以 `translation` flavor 提供 `cloud` / `local` 两变体。`cloud` source set 对 `TranslationPluginRegistrar` 提供空实现；`local` 注册 `MlKitTranslationPlugin` 与 `BergamotTranslationPlugin`。

共用 `main` source set 插件：

| 插件 | 职责 |
|---|---|
| `DeviceMediaControls` | 全屏视频窗口亮度、媒体音量与横竖屏锁定/恢复 |
| `VolumePageTurn` | 墨水屏模式下音量键翻页 |
| `MediaSniffer` | 短生命周期 WebView 观察网络、DOM、MSE 与 EME 信号；不接管 DRM 或授权 |

媒体播放前只在内存登记 10 分钟会话上下文；`MediaPlaybackWebViewClient` 以 OkHttp
流式复用 WebView Cookie、来源页请求头和用户 HTTP/SOCKS 隧道。签名 URL 原样播放，
仅另算去重指纹；401/403 或过期失败由阅读器重新激活原网页探测，不逆向生成签名。

| 配置 | 值 |
|---|---|
| `appId` | `com.aizeek.newsnook` |
| `webDir` | `dist` |
| `androidScheme` | `https` |
| SDK | min 24 / compile & target 36 |
| 版本 | `package.json` 的 `version`；Gradle `versionName` 同源，`versionCode = X*10000+Y*100+Z` |

签名：本机 `.android-signing/` + `.env.android.local`（gitignore）；CI 注入 `NEWSNOOK_KEYSTORE_*`。详见 `docs/android-build.md`。

## 13. 状态管理原则

- **无** Redux / Zustand / React Router。
- 导航与会话态在 `App` 的 `useState`：`tab`、`settingsRoute`、`focusSourceId`、`reading`、`enabledIds`、`later`、`readIds` 等。
- 领域逻辑下沉到 hooks 与纯函数（`preferences.ts` 不可变更新）。
- 模块级可变状态用于正文预取队列与代理运行时（不进 React 树）。

## 14. 风险与边界

1. **上游结构变化**：RSS 字段或站点 JSON 键变更会导致解析失败；单源失败可隔离，但需人工改 registry/parser。
2. **Readability 空抽**：付费墙、强动态页可能抽不出正文；有重试，无破解。
3. **防盗链 / 反爬**：UA 分源、图片 Referer、用户代理只能缓解，不能保证。
4. **存储配额**：WebView localStorage 有限；正文预算约 3MB，列表禁止再缓存全文 HTML。
5. **无服务端**：无法做账号同步、服务端清洗或统一反爬；扩展新源只能加客户端适配。
6. **跟贴与全文覆盖不均**：仅部分源有定制评论与正文路径；自建源体验弱于内置源。
7. **Bergamot 平台限制**：当前仅 `arm64-v8a` 编入原生库；其余设备自动回退其它翻译引擎。
8. **生产 Web 代理能力**：静态站无应用内 SOCKS/HTTP 隧道，国际源可用性依赖边缘 Functions。

## 15. 关键入口索引

| 角色 | 路径 |
|---|---|
| Web 入口 | `src/main.tsx` → `src/App.tsx` |
| 源注册表 | `src/sources/registry.ts` |
| 分类 / 预设 | `src/sources/categories.ts` · `src/sources/presets.ts` |
| 列表 | `src/hooks/useFeeds.ts` |
| 正文 | `src/lib/resolveBody.ts` |
| 正文缓存 | `src/lib/bodyCache.ts` |
| 持久化 | `src/lib/storage.ts` |
| 配置备份 | `src/lib/backup.ts` · `src/components/BackupPanel.tsx` |
| 阅读位置 | `src/lib/readingPosition.ts` |
| 分享 | `src/lib/shareLink.ts` · `src/lib/shareToken.ts` · `src/lib/articleId.ts` · `src/lib/shareArticle.ts` · `src/components/ShareArticleSheet.tsx` · `functions/lib/shareCard.ts` |
| 本地搜索 | `src/lib/localSearch.ts` · `src/screens/settings/LocalSearchScreen.tsx` |
| 主题 / 墨水屏 | `src/lib/theme.ts` · `src/lib/eink.ts` · `src/index.css` |
| HTTP / 代理 | `src/lib/http.ts` · `src/features/proxy/` |
| 翻译 | `src/features/translation/` |
| 跟贴 | `src/features/comments/` |
| 媒体嗅探 / 播放器 | `src/features/mediaSniffer/` · `src/components/InkVideoPlayer.tsx` · `docs/xiutan.md` |
| 应用更新 | `src/features/appUpdate/` |
| Vite 代理 | `vite.config.ts` |
| CF 边缘代理 | `functions/` |
| Capacitor | `capacitor.config.ts` |
| 网络安全 | `android/app/src/main/res/xml/network_security_config.xml` |
| APK 构建 | `scripts/android-build.mjs` |
| 产品设计 | `docs/superpowers/specs/2026-07-31-newsnook-mobile-app-design.md` |
| 墨水屏设计 | `docs/superpowers/specs/2026-08-11-eink-mode-design.md` |
