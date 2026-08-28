# News Nook 应用架构

> 日期：2026-08-27  
> 范围：仓库根目录主工程（Vite + React + Capacitor Android）+ 可选 `cloud/` 同步服务  
> 相关文档：[产品设计](./superpowers/specs/2026-07-31-newsnook-mobile-app-design.md)、[账户与云同步](./superpowers/specs/2026-08-27-account-cloud-sync-design.md)、[信源探测笔记](./news-sources.md)、[构建说明](./android-build.md)、[用户手册](./user-guide.md)、[本地推荐](./local-recommend.md)

## 1. 一句话

News Nook（有所闻）是**本地优先**的移动新闻阅读客户端：静态源注册表驱动，客户端直连上游 RSS/JSON，站内解析全文，经 Capacitor 打包为 Android APK。可选账户与云同步仅增强跨设备配置，不是阅读必经路径。

## 2. 目标与约束

| 约束 | 含义 |
|---|---|
| Local-first | 未登录、断网、NewsNook Cloud 故障均不能阻止订阅浏览、正文解析与离线缓存阅读 |
| 可选云同步 | 可同步订阅 / 分类排序启停 / 跨设备设置 / Secret；列表与正文仍由客户端直连上游；**不同步**正文、缓存、稍后读、已读、阅读位置 |
| 站内全文 | 点开条目必须在 App 内呈现可读正文；「打开原文」只能是次要操作 |
| 双运行时 | Web 端（开发态靠 Vite 代理，生产态靠 Cloudflare Pages Functions 边缘代理）；App 运行态靠 `CapacitorHttp` 与用户可选代理隧道 |
| 本地持久化 | 偏好、稍后读、已读、场景预设、列表/正文缓存先落本机；云端是同步域投影，运行时真相仍在本地 |

## 3. 仓库布局

```text
newsnook/
├── src/                      # React 应用
├── android/                  # Capacitor 原生工程（入库）
├── cloud/                    # 可选账户与同步 API（Fastify + PostgreSQL）
├── packages/contracts/       # 客户端与 cloud 共享的同步协议 / DTO
├── functions/                # 生产边缘：/api/* 反向代理 + /a/* 社交分享卡片
├── public/                   # favicon、品牌 SVG、字体
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
| 原生 | Capacitor 8（App / Browser / Preferences / StatusBar / CapacitorHttp / Share）+ 可选 ML Kit / Bergamot 翻译 + DeviceMediaControls + VolumePageTurn + MediaSniffer + SecureStore（账户 Session / Secret） |
| 云同步（可选） | Fastify + PostgreSQL + Better Auth；协议共享包 `@newsnook/contracts` |
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
│  features/account/       可选登录 / Session / 设备身份         │
│  features/sync/          SyncEngine · Outbox · 合并与冲突      │
│  features/translation/   TranslationService + Provider 接口    │
│  features/proxy/         智能分流 / 隧道 / 原生 HTTP 封装       │
│  features/comments/      跟贴 Provider（网易/知乎/煎蛋等）      │
│  features/mediaSniffer/  媒体候选 / HLS·DASH 清单 / DRM 状态  │
│  features/appUpdate/     GitHub Release 检测与应用内更新        │
├──────────────────────────────────────────────────────────────┤
│  Data                                                        │
│  lib/http · parseFeed · resolveBody · bodyCache · storage    │
│  lib/opml · sanitize · normalizeImages · eink                │
│  packages/contracts/     与 cloud 共享的同步协议 / DTO         │
├──────────────────────────────────────────────────────────────┤
│  Runtime / Native / Cloud                                    │
│  Web: Vite /api 代理（开发）/ Cloudflare Functions（生产）      │
│  App: CapacitorHttp + Preferences + 可选 ML Kit / Bergamot    │
│  Cloud（可选）: cloud/ Fastify + PostgreSQL + Better Auth     │
└──────────────────────────────────────────────────────────────┘
```

依赖方向严格自上而下：

```text
UI → account/sync features → local adapters / contracts → cloud API
reading / feed / body path ------------------------------------→ upstream sites
```

UI 不直接拼上游 URL；源 URL 与 kind 只来自 `sources/registry.ts`（含用户自建源）。现有业务模块不得直接依赖云 API：变更先写本地，再由 Sync Engine 经 Outbox 异步上传。

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
| 站点定制 | `latepost`、`jandan`、`jiqizhixin`、`cls`、`eastmoney-*`、`wscn-live`、`guokr`、`jazzyear`、`arena`、`anthropic`、`claude-webflow`、`claude-academy`、`openai-cookbook`、`paulgraham`、`wordpress` 等 | 各站列表/详情协议与 UA 在 registry 中声明 |
| 用户自建 | `feed`（`isCustom: true`） | OPML 导入或手动添加，走通用解析 |

内置源按 `SourceGroup`（`cn` / `intl` / `tech` / `ai` / `special` / `custom`）分组；用户可在「综合频道」单独开关，或在分类下覆盖选源。

### 7.2 分类与场景

分类轨（`sources/categories.ts`）：

- **综合**：跟随用户启用的全部源
- **推荐**（`recommend`）：动态聚合栏位，**不进注册表、不落分类布局偏好**——每个预设的候选池严格为该预设启用的全部信源（可见分类并集，综合贡献频道启用列表），预设内阅读量达到 `lib/recommend.ts` 的阈值后才在轨道最前出现，且默认焦点永远是第一个普通分类；条目由本机已读画像重排（纯本地，冷启动退化为按时间），推荐栏内下拉刷新即基于最新已读重建画像并重排。偏好里的 `recommendEnabled` 总开关（默认开启，设置入口在「分类与信源」）可整体关闭该栏位。「推荐」为自建分类保留名。原理、权重与效果见 [本地推荐](./local-recommend.md)
- 其余分类：绑定默认 `sourceIds`，可由偏好覆盖

场景预设（`sources/presets.ts` + `hooks/usePresets.ts`）：快照分类顺序/显隐、各类别选源与综合频道启用列表。内置可就地改并覆盖存储，另存为才复制成用户预设；`activePresetId` 可直接指向内置 id。推荐栏不进预设快照——它按各预设的阅读行为在运行时动态出现。

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
            → lib/shareLink.buildShareUrl（站内短链，v2 带原文地址 + 信源 id + 标题 + 导语，见 8.6.1）
            → lib/shareArticle
                 Android：@capacitor/share（只传 title + url，不传 text）
                 Web：navigator.share，不支持时降级 navigator.clipboard
          有链接时 text 必须省略：@capacitor/share 的 Android 端会把 text 与 url
          拼成一段 EXTRA_TEXT（"text url"），微信把这种消息当**纯文本**、根本不去抓
          OG——这正是「新链接也出不了卡片」最常见的根因，与预览缓存无关。
          EXTRA_TEXT 恰好是一条裸 URL 时才按链接消息处理，边缘 OG 卡片才有机会展示。
          摘要与首图都由 8.6.2 的卡片承载，不需要写进消息正文；标题与一段导语另外
          编进 token，边缘抓不到原文时卡片也说得出这是哪一篇、大概讲什么（见 8.6.1）。

本地搜索  LocalSearchScreen
            → lib/localSearch.loadCachedListArticles（枚举 cache:v3:* 列表缓存）
              + 稍后读 + 最近阅读（正文缓存元数据）
            → buildLocalSearchCorpus（按 id 去重，稍后读 > 最近阅读 > 列表缓存）
            → searchLocalArticles（空格切片 AND 子串匹配，标题/摘要/信源名加权，默认取前 80 条）
```

本地搜索与 `web-catalog` 源的 `searchTemplate`（站内联网搜索）是两条独立路径：前者零请求，只覆盖本机已有内容。

#### 8.6.1 分享深链 `/a/<token>`

分享出去的主链接固定指向站内：`https://news.aizeek.com/a/<token>`（常量集中在 `lib/shareLink.ts` 的 `SHARE_LINK_HOST` / `SHARE_PATH_PREFIX`）。**没有任何服务端参与**——token 自带打开阅读器所需的全部字段，接收端本地解码后照常走 `resolveBody` 抽正文。出版社地址只是 token 里的一个字段，供正文抽取与用户主动「在浏览器核对原文」使用，不作为分享主链接。

token 载荷当前是 **v2**：只留「能打开这篇」的必需字段，外加供聊天预览卡使用的标题与导语各一行。v1 的短键 JSON（带标题、摘要、信源名、时间）仍然可解码，旧链接不失效。

```text
v2 明文（换行分隔，比 JSON 再省掉键名与引号）
  第 1 行  "2.<校验位>"      版本号 + 其余内容的 4 位 djb2 短哈希
  第 2 行  sourceId
  第 3 行  原文地址          https:// 前缀省略不写
  第 4 行  可选 id           以 ':' 开头表示补回 `<sourceId>:` 前缀
                            有标题 / 导语而无 id 时写一行空串占位（见「标记行为什么排在 id 槽之后」）
  第 5 行  可选标题          以 '!' 开头，不超过 80 字，解码时摘出来不占位置槽
  第 6 行  可选导语          以 '$' 开头，截到 60 字，同样不占位置槽
  末   行  可选 salt         以 '~' 开头，解码时整行忽略（见「换新链接」）

编码  Article ─ sharePayloadFromArticle ─→ { originUrl, sourceId, id?, title?, summary? }
                                            ↓ 上述明文 + UTF-8 + URL-safe base64
                    buildShareUrl ─→ https://news.aizeek.com/a/<token>
                    （开发态 resolveShareOrigin 用 window.location.origin，原生壳与生产固定 news.aizeek.com）

解码  冷启动 App.tsx（lazy initializer，query 如卡片逃生门的 ?app=1 不参与）
        → shareTokenFromPath()       读 location.pathname，只认单段 /a/<token>；token 另存给「在 App 中打开」引导条
        → decodeShareToken()         按首行分流 v2 / v1，校验位、字段、长度与 http(s) 协议校验，失败返回 null
        → articleFromSharePayload()  本机认识该 sourceId 就用注册表元数据，否则退回「分享来源」
        → 直接进 ReaderScreen（正文仍是站内抽取），token 坏了则弹中文提示并停在首页
      Android App 唤起（launchUrl / appUrlOpen）由 lib/appDeepLink.shareTokenFromAppUrl 还原 token 后走同一条链
```

- **为什么砍字段**：中文在 UTF-8 + base64 下膨胀三倍，v1 把标题、摘要、信源名全编进去（还带着 JSON 的键名与引号），典型条目要 450～550 字符，聊天工具里折行、被截断就打不开。v2 只留必需字段时网易稿 86 字符、公众号稿 82 字符；带上标题与导语后实测网易稿 348、公众号稿 328、IT 之家稿 342、少数派短稿 227（带 salt 各 +8，完整 URL 再 +26），比 v1 全字段 JSON 省，且换来的是**预览卡零依赖上游**就有标题和小字。信源名依旧不编码（接收端查 registry）。
- **标题为什么又进链接**：聊天预览卡的标题由边缘现拼（见 8.6.2），原本只能靠边缘现抓一次原文——被反爬拦住、或抓取端被误判成真人时，卡片就只剩「一篇文章」甚至站点通用文案，对方看不出分享的是哪一篇。分享时 App 手里本来就有真标题，编进 token 后边缘零依赖也能给出正确的 `og:title`。上限是 **80 字**（`MAX_TOKEN_TITLE_LENGTH`）：中文新闻标题多在 20～40 字，上限太紧（最初是 50）会把整段标题挡在链接外，卡片直接退回「<信源名> · 一篇文章」。超过上限的标题宁可整段丢掉留给边缘抓取——截断后的标题会被接收端当成真标题存进缓存。占位标题（「加载中…」「分享的文章」）由 `usableShareTitle` 挡掉，不会被编进链接。
- **导语为什么也进链接**：卡片小字（`og:description`）原本只有上游 meta 一个来源，抓不到就退回「点击在有所闻中阅读全文」——对方看得见标题却看不出这篇讲什么。分享时列表摘要就在手边（深链打开的文章列表摘要为空，则由 `sharePayloadFromArticle` 的 `bodyHtml` 兜底，从已抽好的正文开头取一段），`shareLeadText` 去标签、还原实体、折叠空白后编进 `$` 行。与标题不同，导语本来就是节选，超过 **60 字**（`MAX_TOKEN_SUMMARY_LENGTH`，卡片小字在微信里也只显示两行左右）**按字数截断补省略号**而不是整段丢弃。
- **标记行为什么排在 id 槽之后**：旧版客户端（已安装的 App 会通过 App Links 接管 `/a/*`）按位置解码，标题 / 导语行若落在 id 槽会被当成文章 id，已读 / 正文缓存 / 稍后读就对不上。因此有标题或导语而无 inline id 时补一行空串占位：旧解码器读到空串等于「没有 id」，自己算出的 id 与从前完全一致，只是丢掉这两行。`compactArticleId` 同理拒绝以 `~` / `!` / `$` 开头的 id。
- **标题与信源名从哪来**：链接带标题时打开即显示；不带（旧链接、超长标题）先显示 `SHARE_PENDING_TITLE`（「加载中…」），`resolveBody` 抽完正文由 `ResolvedBody.title` 顶掉，抽取失败退到 `SHARE_FALLBACK_TITLE`（「分享的文章」）。信源名查 `sources/registry`，不认识就写「分享来源」。`withResolvedShareTitle` 只顶替占位标题，保证落进正文缓存与稍后读的不是占位符。链接里的标题与导语是发送方给的两段文本，仅用于展示与卡片，正文与出处仍以 `originUrl` 抽取结果为准。
- **id 怎么省的**：列表侧的条目 id 是 `lib/articleId.feedArticleId(sourceId, link)`（`<sourceId>:<djb2 哈希>`）。接收端用同一函数按原文地址算，绝大多数条目算出的 id 与发送端完全一致，已读 / 正文缓存 / 稍后读因此能对上，第 4 行也就不用出现。算不出来（例如 Google News 解码后换过地址）才写进去，且去掉冗余的 `<sourceId>:` 前缀、超过 40 字符就宁可丢掉。
- **校验位**：紧凑载荷被截断后仍可能解出一个「看着合法」的短地址，会静默打开错误页面。首行 4 位校验对不上就当损坏处理，弹中文 `ConfirmDialog`。
- **换新链接（salt 行）**：微信、WhatsApp 都**按 URL 缓存链接预览**，同一条链接一旦抓到过旧卡片（例如边缘卡片部署前的通用文案），之后无论怎么重发都不刷新，平台也没有公开的强制刷新入口。因此 `ReaderScreen` 每次打开分享卡片都用 `newShareSalt()`（4 位 base36 随机数）重新编 token：salt 以 `~` 行进入载荷并参与校验位，token 与 URL 随之变化，平台被迫按新 URL 重新抓取。接收端 `decodeShareToken` 直接跳过 `~` 行，文章 id 仍由 sourceId + 原文地址算出，已读 / 正文缓存 / 稍后读完全不受影响；不合规 salt（非 base36、超长）在编码时整个丢掉。**已发出的旧消息预览不会更新**，只有新发的链接才带新预览。
- **拒绝面**：token 超过 2048 字符、非 base64url 字符、校验位不符、版本不匹配、缺 `sourceId` / `originUrl`、`originUrl` 非 http(s) 一律返回 `null`，不抛异常打断冷启动。`safeHttpUrl` 校验后原样返回，不做归一化——归一化会改动哈希输入，接收端就算不出发送端的 id。
- **深链可刷新**：Workers 侧通过 `wrangler.jsonc` 的 `not_found_handling: single-page-application` 统一兜底，`/a/<token>` 和普通前端路径都能直接回到 SPA；同时 `run_worker_first: ["/api/*", "/a/*"]` 显式声明这两类路径**先进 worker**——SPA 模式默认按 `Sec-Fetch-Mode` 隐式分流，`compatibility_date` 一旦升到 2025-04-01 之后导航请求会完全绕过 worker，社交爬虫抓 `/a/*` 就只能拿到通用 `index.html`。开发态由 Vite 自带的 history fallback 兜底（base64url 不含 `.`，不会被当成静态文件）。关闭阅读器时 `clearShareLocation()` 把地址换回站点根（打开时不清，刷新仍能回到同一篇）。不要再额外放 `_redirects` 的 `/a/* → /index.html 200`，否则 Cloudflare 会把它判成回到同一 SPA 入口的死循环并拒绝部署。
- **与「打开原文」的区别**：分享出去的主链接永远是站内 `/a/<token>`；出版社地址只是载荷里的一个字段，供正文抽取与用户主动「在浏览器核对原文」使用，任何情况下都不会把原站 URL 当成分享结果。
- **UI 层次**：`ShareArticleSheet` 是 `z-50`，且分享卡片打开时 `ReaderScreen` 会收起跟贴悬浮胶囊与「已回到上次阅读位置」提示（两者都是 `z-40` 且在 DOM 里排在卡片之后，否则会压住卡片底部的「复制链接 / 分享」）。卡片里的链接是可点的 `<a target="_blank">`，方便自测深链。
- **Android App 唤起**：`AndroidManifest.xml` 为 MainActivity 注册了两条 VIEW intent-filter——`https://news.aizeek.com/a/*`（App Links，带 `autoVerify`）与自定义 scheme `newsnook://a/<token>`。App 侧经 Capacitor `getLaunchUrl()`（冷启动）/ `appUrlOpen`（运行中）拿到 URL，由 `lib/appDeepLink.shareTokenFromAppUrl` 还原成同一个 token 直接进阅读器（同一 URL 去重，token 损坏弹既有中文提示）。网页落地页对 Android 浏览器出「在有所闻 App 中打开」引导条（`components/OpenInAppBanner`）：Chromium 系用 `intent://…;package=com.aizeek.newsnook;end`（**不带商店 fallback**，未安装时点击无事发生、继续网页阅读），其余浏览器退回 `newsnook://`；微信 / 企业微信内置浏览器禁止唤起第三方 App，引导条不出现；iOS 无对应 App，同样不出现。注意：`autoVerify` 的自动接管要等站点提供 `/.well-known/assetlinks.json`（含正式签名 SHA-256 指纹）后才生效，此前系统只把 App 列进「用应用打开」候选；指纹不入库，该文件需在部署侧补。
- **模块划分**：token 的编解码与 `SHARE_LINK_HOST` 单独放在 `lib/shareToken.ts`（纯函数，无 Capacitor / window 依赖），边缘 worker 也 import 同一份（见 8.6.2）；`lib/shareLink.ts` 只留浏览器侧的链接组装、深链识别与 Article 还原，并原样 re-export token API，调用方不受影响；`lib/appDeepLink.ts` 负责 App 唤起 URL 的拼装与还原，同样不带 Capacitor 依赖，测试走 `npm run test:app-deep-link`。

#### 8.6.2 社交分享卡片（边缘 worker 动态 OG 标签）

微信、WhatsApp、Telegram 这类客户端是按抓到的 HTML 里的 Open Graph 标签渲染链接卡片的，而 `/a/<token>` 走 SPA 回退给出的 `index.html` 只有通用空壳标签，链接在聊天里就是一串裸地址、或者一张写着站点名的通用卡。**卡片由 `functions/lib/shareCard.ts` 在边缘现拼**，仍然不建库、不建 API。

**文章级 OG 不绑死在爬虫 UA 判定上**：判定为爬虫走现拼的卡片页，判定为真人照常走 SPA，但 `index.html` 里的站点壳 meta 会按 token 改写成这篇文章的标签（`injectShareMeta`）。抓取端伪装成真实导航（微信一类客户端会带 `Sec-Fetch-*`）时因此仍拿得到文章标题，而不是「有所闻 · News Nook」。

```text
GET /a/<token>
  │
  ├─ 爬虫（UA 命中 facebookexternalhit / Twitterbot / WhatsApp / TelegramBot / Baiduspider … ）
  │    → decodeShareToken 拿 originUrl + sourceId（+ 链接里带的标题与导语）
  │    → fetch 原文（每次 3s 超时，只读前 128KB，认 content-type / meta 里的 charset）
  │       先用浏览器 UA + 同站 Referer；没拿到标题（被拦 / 质询页）换 Googlebot UA 再试一次
  │    → 正则取 og:title | twitter:title | <title>、og:description | description、
  │       og:image（含 og:image:width/height 透传）
  │       质询页标题（Just a moment… / 安全验证 等）整页丢弃
  │    → 返回完整卡片 HTML + Vary: User-Agent：
  │       og:type=article · og:title · og:description · og:url（规范地址）
  │       og:image（**必有**，见下）· og:site_name=有所闻
  │       twitter:card=summary_large_image + twitter 三件套
  │       itemprop name/description/image（微信旧协议，与 OG 并存）
  │       文章卡（抓到标题）Cache-Control 3600s；
  │       兜底卡 max-age=0 + CDN-Cache-Control: no-store，失败态不被缓存钉住
  │
  └─ 真人（含被误判成真人的抓取端）
       → env.ASSETS.fetch(request)，SPA 回退不变
       → injectShareMeta 摘掉 index.html 的 og:* / twitter:* / description / <title>，
         按 token 补上同一组文章级标签（og:type=article、og:image 指同域端点、Vary: User-Agent）
         只用链接里已有的信息，**不为这一跳抓上游**——真人打开分享链接不能变慢
         token 解不出 / 不是 HTML / 多段路径 → 原样返回，站点壳 meta 不动

GET /a/<token>/og.png[?src=<上游首图>]   ← 卡片首图的同域端点（任何 UA）
  │    token 可解且带 src → 转发上游首图（跟随重定向、只收 image/*、5s 超时）
  │    其余情况（无首图 / 上游图挂 / 防盗链 / token 坏）→ public/og-default.png 品牌兜底图
  └─   Cache-Control: public, max-age=86400
```

- **判定方式**：`wantsShareCard()` 先匹配明确的爬虫 UA。微信抓卡片与微信内置浏览器共用 `MicroMessenger` UA（抓取端还有企业微信 `wxwork`、`WeChat`、`Weixin` 变体；微博 / QQ / 钉钉的内置浏览器同理带各自 App 标识），只能再看 `Sec-Fetch-Mode`——真实导航带（内置浏览器基于 Chromium），抓取端**通常**不带；真人聊天 App 内置浏览器因此仍进 SPA。这套判定只决定「给卡片页还是给 SPA」，**不再决定预览里有没有文章标题**：抓取端带上 `Sec-Fetch-*` 或换个没见过的 UA 时，SPA 那条路的 `injectShareMeta` 兜住。改 UA 名单仍有价值（卡片页能现抓摘要与首图），但它不再是卡片正确与否的唯一开关。
- **SPA 改写的边界**：`SHELL_META_PATTERN` 按 `property="og:*"` / `name="twitter:*"` / `name="description"` 匹配 `index.html` 里的站点级标签，连同 `<title>` 一起摘掉再补新的；`viewport`、`theme-color` 这类无关 meta 不动，`#root` 与入口脚本原样保留，SPA 行为零变化。改写后删掉 `Content-Length` / `ETag`（内容已变），并补 `Vary: User-Agent`（同址对爬虫给的是卡片页）。`index.html` 里那几行 og 标签的写法与这个正则是配套的，改一边要看另一边——`npm run test:share-og` 里有一条用**仓库真实 `index.html`** 跑的回归。
- **社交大图卡依赖「必须带图」**：微信、WhatsApp 对没有 `og:image` 的页面几乎只出小字纯文本卡甚至不出卡。因此卡片**任何情况下都输出 og:image**：上游有首图时经同域 `GET /a/<token>/og.png?src=…` 转发（微信对跨域、防盗链、http 明文图经常直接放弃渲染；端点内跟随重定向、只收 `image/*`，失败回落品牌图）；上游没图、token 坏、抓取失败时直接给 `public/og-default.png`（1200×630 品牌图，`scripts/generate-og-default.mjs` 生成并入库）并声明 `og:image:width/height`。图片端点与卡片同在 `/a/*` 路径下，WAF 的按路径 Skip 规则一并覆盖。
- **误判兜底**：卡片页带 `<meta http-equiv="refresh">` 指向 `?app=1`；worker 见到这个参数直接放行到 SPA，所以被误判成爬虫的真人只多一跳就回到阅读页，不会来回打转。`?app=1` 只是 query，前端仍按 pathname 解码 token，不影响打开文章；卡片自身的 `og:url` 指向不带该参数的规范地址。
- **路由前提**：卡片能出现在聊天里的前提是 `/a/*` 请求真的进了 worker——见 8.6.1「深链可刷新」里的 `run_worker_first` 说明。若 Cloudflare WAF / Bot 拦截对微信、WhatsApp 抓取端 IP 弹质询页，爬虫同样拿不到 OG，需在仪表盘为 `/a/*` 放行已知抓取端。
- **WAF 放行规则怎么写（常见误判）**：WAF 事件日志里显示「已跳过」的往往是 `66.249.x.x` 之类的 **Googlebot**——它有独立 IP 段与已验证爬虫身份，容易被默认规则放行；**这不代表 WhatsApp / 微信的抓取端也被放行了**，它们从普通数据中心 IP 出流量，最容易吃到质询页。核对时要按 User-Agent 过滤事件日志，别只看「有跳过记录」。自定义规则（动作选 Skip，至少跳过 Bot Fight Mode / Managed Challenge）建议按 **路径 + UA** 收窄，可直接粘贴的表达式：

  ```text
  (starts_with(http.request.uri.path, "/a/") and (
    http.user_agent contains "WhatsApp" or
    http.user_agent contains "MicroMessenger" or
    http.user_agent contains "wxwork" or
    http.user_agent contains "facebookexternalhit" or
    http.user_agent contains "TelegramBot" or
    http.user_agent contains "Twitterbot"
  ))
  ```

  不要写成对 `/a/*` 全 UA 放行（真人流量也会绕过防护），更不要以为「Googlebot 已跳过 = 修好了」。
- **「新链接也没卡」先查消息形态，别都归因缓存**：平台预览缓存只解释「旧链接刷不动」；一条**全新** URL 发出去仍没有卡片时，最常见的根因是分享面板把标题 + URL 拼成了一条**纯文本消息**（见 8.6「分享」流程里的 EXTRA_TEXT 说明），其次是卡片没有 `og:image`（微信不出大图卡）或 WAF 把社交抓取端拦在质询页。排查顺序：消息是不是裸链接 → 爬虫 UA 能否拿到带图完整卡 → **带上 `Sec-Fetch-Mode: navigate` 再抓一次**（抓取端伪装成导航时走的是 SPA 那条路，`injectShareMeta` 必须把文章标题写进去）→ WAF 事件按 UA 过滤核对。
- **卡片标题是站点名（「有所闻 · News Nook」）说明抓到了站点壳**：这两句与 `index.html` 的站点级 og 逐字相同，既不是「有所闻分享」也不是「<信源名> · 一篇文章」这两套兜底，说明请求根本没拿到文章级 OG——要么没进 worker（见「路由前提」），要么进了 SPA 那条路而改写没生效。
- **平台缓存与强制刷新**：聊天预览完全依赖边缘返回的 OG；微信、WhatsApp 都按 **URL** 缓存抓取结果，且没有官方的预览刷新调试器（Facebook 的 Sharing Debugger 只服务 Facebook 家族的 og 缓存，对 WhatsApp 个人聊天不保证生效）。**已发出的旧消息卡片永远不会更新**——修好部署、改好 WAF 都救不了旧气泡，只能新发一条。App 侧的解法见 8.6.1「换新链接（salt 行）」：每次分享都是一条新 URL，平台按新 URL 重新抓取；卡片里的 `og:url` 与首图端点仍用不带 salt 的规范 token，平台按规范地址归并，不会把缓存键打散。
- **标题三级、描述三级**：卡片标题依次取 ① 现抓到的原文 `og:title`（最新，链接里的标题可能已过时）→ ② 链接 token 里带的标题（上游超时 / 非 200 / 非 HTML / 质询页时兜住，见 8.6.1）→ ③「<信源名> · 一篇文章」（旧链接或超长标题；认识的 `sourceId` 用注册表中文名，否则用原文域名）。描述同样三级：① 现抓到的 `og:description` → ② 链接 token 里带的导语 → ③「点击在有所闻中阅读全文」，任何一级最后都补「· 原文来自 xxx」。token 整个解不出来才退到「有所闻分享」+「点击在有所闻中阅读全文」。**关键点是标题与小字都不依赖上游抓取是否成功**——微信一类抓取端带 `Sec-Fetch-*` 时走的是 `injectShareMeta`，那条路根本不抓上游，只有 token 里的这两行撑着。任何一级都**不会**落回站点通用文案；两种兜底都带品牌图，**仍是一张完整大图卡**；抓不到原文标题的卡 `max-age=0` + `CDN-Cache-Control: no-store`，上游恢复后爬虫重抓立即拿到带上游摘要与首图的完整卡。
- **安全**：上游标题、摘要与**链接里带的标题、导语**都先按 HTML 实体还原再统一 `escapeHtml`，属性边界不会被 `">` 顶开（token 是发送方可控输入，卡片页与改写后的 SPA 两条路都有转义回归）；`og:image` 与 `og.png` 端点的 `src` 只接受 http(s)，`javascript:` 之类直接丢掉；`og.png` 要求 token 可解才代转上游图，避免被当成任意图片代理。
- **只影响 Workers 部署**：`/api/*` 的边缘代理逻辑不变；Vite 开发态没有这条路径（爬虫不会来爬 localhost），本机验证请直接跑 `npm run test:share-og`。`index.html` 里另有一套站点级默认 og 标签，只服务首页等普通页面——`/a/*` 的请求要么在 worker 就被接走，要么被 `injectShareMeta` 改写，抓取端不会落到这份站点壳 meta 上。

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
- **与云同步的分工**：本地文件备份是离线/导出路径，不依赖账号；云同步是登录后的跨设备投影（V1 不含稍后读/已读/阅读位置）。两者可并存，互不替代。
- **落地方式**：Android 写入 `Directory.Cache` 后交给系统分享面板；Web 走 Blob 下载。导入两端都用 `<input type="file">`。备份本身全程本地文件。
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

### 8.9 账户与云同步（可选）

规格全文见 [账户与云同步设计](./superpowers/specs/2026-08-27-account-cloud-sync-design.md)；实现计划见 [账户与云同步计划](./superpowers/plans/2026-08-27-account-cloud-sync.md)。

**产品原则**

- 登录可选；首次引导可跳过；设置页长期保留入口。
- 所有用户操作先落本地；Sync Engine 经 Outbox 异步 push / delta pull。
- 首次登录由用户显式选择：使用本机 / 使用云端 / 合并；覆盖前先做本地恢复快照。
- 日常自动同步 +「立即同步」；普通冲突自动解决，高风险冲突进 Conflict Queue，不阻塞同账户其它实体。
- 「全部应用」走 `POST /api/v1/sync/conflicts/resolve` 批量裁决（单次最多 200 条），不得对每条冲突各打一次 HTTP。

**V1 同步域**

| 同步 | 不同步 |
|---|---|
| 订阅源、分类、排序、启停 | 文章正文、列表/正文缓存 |
| 适合跨设备的应用设置、场景预设 | 稍后读、已读、阅读历史、阅读位置 |
| 用户 Secret（第三方 AI Key、代理凭据等） | 设备本地项（如 `einkMode`、`wifiOnlyAutoLoadMedia`、`prestore`） |

**协议要点**：结构化记录 + 每用户单调 `revision` + Outbox + Tombstone；不采用整包 JSON 覆盖、CRDT、Event Sourcing、WebSocket。实体 id 复用现有 source/category/setting key，不为同步另造 UUID 映射。

**模块边界**

```text
src/features/account/     authClient(Better Auth HTTP) · useAccount · secureStore/secretStore
                          mobileCallback(newsnook://auth/callback) · screenModel
src/features/sync/        projection → reconcile(影子 + Outbox) → SyncEngine(push/pull/apply)
                          merge · runtimeAdapter/useCloudSync(接 React) · notifier · firstSync · devices
cloud/                    Fastify + PostgreSQL + Better Auth
packages/contracts/       共享协议与错误码（`./protocol` 子路径免 zod，供客户端引用）
```

**客户端数据流**：运行时真相仍是 `usePreferences` / `enabledIds` / `usePresets`。
`projectLocalState` 把它们投影成同步实体并算指纹，`reconcileProjection` 与影子表比对生成 Outbox；
push 成功后写回影子，delta pull 的记录经 apply journal 落地（崩溃后重放），
再由 `runtimeAdapter` 写回 React 状态。应用远端记录时不产生反向 mutation，避免两台设备互相对推。

**同步触发**：启动（已登录）、本地投影指纹变化后 debounce 1.5s、回到前台、网络恢复、手动。
无轮询、无 WebSocket。失败按指数退避 + 抖动重试，429 遵守 `Retry-After`，401/403 直接暂停并提示重新登录。

**首次同步闸门**：`LocalSyncState.firstSyncCompleted` 为 false 时日常同步不会跑，
必须先由用户在「账户与同步」里选 使用本机 / 使用云端 / 合并。选择前自动留一份
「同步前配置」本机快照（`lib/backup.ts` 的 `captureSyncSafetySnapshot`，只含 preferences/presets/enabledSources），
可整包回滚，不依赖服务端。

**本地键**（均在 `newsnook:` 前缀下，见 `lib/storage.ts`）：`sync-state:v1`（设备 id、影子、Outbox、游标）、
`sync-journal:v1`（apply 重放）、`sync-onboarding-seen`、`sync-safety-snapshot:v1`。
Outbox 落盘前 Secret 载荷会被抹成 null，真正的值在 push 前一刻从活投影里取。

**会话与 Secret**：Web 用 HttpOnly Cookie Session；Android 用 Keystore-backed SecureStore
（`SecureStorePlugin.java`，AES/GCM，密钥不出 Keystore），长期 Session 与同步下来的 Secret 明文只存这里，
不落普通 Preferences/localStorage。Android 社交登录走系统浏览器 → 一次性令牌深链 → 换 Session，
长期 token 绝不出现在深链里。业务 API 从 Session 推导 `userId`，从不信任客户端 payload 内的用户 id。
Secret 上传但不做 E2EE；服务端 AES-256-GCM 加密（AAD 绑定 `userId:secretKey`），日志与推送摘要禁止明文。

**服务端**：同一用户的并发 push 由 `sync_heads` 那一行的 `SELECT ... FOR UPDATE` 事务行锁串行化，
整批在一个事务里应用，`sync_mutations` 记录 mutationId 实现幂等重试。没有 Redis / MQ / 分布式锁。
设备是访问主体：每条同步路由都必须带 `x-newsnook-device`，`device_sessions` 记下「会话 ↔ 设备」，
撤销设备会一并作废它手里的会话，换个 deviceId 也绕不过去。
部署、迁移、备份与冒烟见 [云端部署运维](./cloud-deploy.md)。

**通知分寸**：前台一律用应用内 `SyncToast`；Android 通知栏只留给首次同步完成、连续失败、待裁决冲突三类
（`features/sync/notifier.ts` 的 `mapSyncEventToNotification` + `SyncNotificationPlugin.java`，
单一 `newsnook-sync` 低优先级渠道、稳定通知 id）。例行后台同步成功不发任何通知，也不为同步在冷启动索要通知权限。

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
| `lib/recommend.ts` | 本地推荐：已读画像（中文 bigram / 英文单词 TF）+ 信源亲和 + 新鲜度加权与信源打散；预设内阅读阈值判定推荐栏显隐 |
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
5. **云能力边界**：NewsNook Cloud 只承载可选账户与配置同步，不做服务端正文抓取/清洗或统一反爬；扩展新源仍靠客户端适配。未登录与云故障必须可降级为纯本地使用。
6. **跟贴与全文覆盖不均**：仅部分源有定制评论与正文路径；自建源体验弱于内置源。
7. **Bergamot 平台限制**：当前仅 `arm64-v8a` 编入原生库；其余设备自动回退其它翻译引擎。
8. **生产 Web 代理能力**：静态站无应用内 SOCKS/HTTP 隧道，国际源可用性依赖边缘 Functions。
9. **同步冲突与 Secret**：高风险结构冲突需用户处理；Secret 非零知识，服务端可解密，依赖传输与落盘加密及访问控制。

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
| 账户 / 云同步 | `src/features/account/` · `src/features/sync/` · `src/screens/settings/AccountSyncScreen.tsx` · `src/components/SyncToast.tsx` · `cloud/` · `packages/contracts/` · [部署](./cloud-deploy.md) · [设计](./superpowers/specs/2026-08-27-account-cloud-sync-design.md) |
| 阅读位置 | `src/lib/readingPosition.ts` |
| 分享 | `src/lib/shareLink.ts` · `src/lib/shareToken.ts` · `src/lib/articleId.ts` · `src/lib/shareArticle.ts` · `src/components/ShareArticleSheet.tsx` · `functions/lib/shareCard.ts` |
| 本地搜索 | `src/lib/localSearch.ts` · `src/screens/settings/LocalSearchScreen.tsx` |
| 本地推荐 | [docs/local-recommend.md](./local-recommend.md) · `src/lib/recommend.ts` · `src/lib/articleId.ts` · `src/sources/categories.ts`（`RECOMMEND_CATEGORY`） · `src/sources/preferences/categoryPrefs.ts` |
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
