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
├── functions/                # Cloudflare Pages Functions（生产边缘代理）
├── public/                   # favicon、品牌 SVG、字体等静态资源
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
| 媒体 | hls.js（网易 HLS） |
| 原生 | Capacitor 8（App / Browser / Preferences / StatusBar / CapacitorHttp / Share）+ 可选 ML Kit / Bergamot 翻译 + DeviceMediaControls + VolumePageTurn |
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
| 我的 `MeScreen` | 稍后读、最近阅读、设置入口 |
| 阅读器 `ReaderScreen`（lazy） | 站内全文 / 视频 / 墨水屏分页 / 翻译 / 跟贴 / 错误重试 |
| 设置栈 | 自定义订阅、分类与信源、场景预设、排版、外观、翻译、代理、存储、关于 |

设置路由（`SettingsRoute`）包括：`typography`、`appearance`、`translation`、`proxy`、`presets`、`custom-sources`、`categories`、`channels`、`category-sources`、`category-edit`、`later`、`history`、`storage`、`about`、`changelog`、`licenses`。

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

场景预设（`sources/presets.ts` + `hooks/usePresets.ts`）：快照分类顺序/显隐、各类别选源与综合频道启用列表，一键切换。

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
           1. 视频稿 → 占位 HTML + InkVideoPlayer（bodySource: video）
           2. Feed 已有足够 HTML → feed
           3. 网易 / 知乎 / 站点定制 kind → 各专用解析路径
           4. GET originUrl（简繁 URL 互试，最多 2 次）
              → Readability 抽取 → readability
           5. 失败 → 错误态可重试（禁止以外链替代主路径）
      → normalizeContentImages → sanitizeArticleHtml → saveCachedBody
```

正文预取：稍后读加入时入队，`BODY_PREFETCH_CONCURRENCY = 2`，离开稍后读则跳过。

### 8.3 文章翻译

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

### 8.4 跟贴评论

```text
ReaderScreen / CommentsDrawer
  → features/comments/service.findCommentProvider(article)
       ├── eastmoney / netease / zhihu / jandan / hackerNews
  → provider.getComments(tab, offset) → 渲染 CommentCard
```

仅部分源实现 `CommentProvider`；不支持时隐藏跟贴入口。

### 8.5 持久化键

前缀 `newsnook:`（`lib/storage.ts`）：

| 键模式 | 内容 |
|---|---|
| `enabled` | 启用源 ID 列表 |
| `preferences` | 分类/排版/主题/eink/翻译/代理等偏好与 API 配置 |
| `presets` | 场景预设快照 |
| `custom-sources` | 用户自建源 |
| `later-items` | 稍后读文章 |
| `read` | 已读 ID 集合 |
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
| `components/InkImage.tsx` / `InkVideoPlayer.tsx` | 图片渐进加载 / HLS 播放与全屏手势 |
| `components/EinkReaderMenu.tsx` | 墨水屏阅读菜单（字号、页码、翻译、收藏） |
| `lib/videoGestures.ts` / `lib/deviceMediaControls.ts` | 全屏手势 / 系统亮度与媒体音量 |
| `hooks/useFeeds.ts` | 多源并行拉取与合并 |
| `lib/http.ts` | 平台分流 GET + 代理隧道 |
| `lib/parseFeed.ts` | 多 kind 列表 → `Article[]` |
| `lib/resolveBody.ts` | 站内全文策略 |
| `lib/bodyCache.ts` | 正文 LRU + pin |
| `lib/opml.ts` | OPML 导入导出与 Feed 探测 |
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
| `DeviceMediaControls` | 全屏视频窗口亮度与媒体音量 |
| `VolumePageTurn` | 墨水屏模式下音量键翻页 |

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
| 主题 / 墨水屏 | `src/lib/theme.ts` · `src/lib/eink.ts` · `src/index.css` |
| HTTP / 代理 | `src/lib/http.ts` · `src/features/proxy/` |
| 翻译 | `src/features/translation/` |
| 跟贴 | `src/features/comments/` |
| 应用更新 | `src/features/appUpdate/` |
| Vite 代理 | `vite.config.ts` |
| CF 边缘代理 | `functions/` |
| Capacitor | `capacitor.config.ts` |
| 网络安全 | `android/app/src/main/res/xml/network_security_config.xml` |
| APK 构建 | `scripts/android-build.mjs` |
| 产品设计 | `docs/superpowers/specs/2026-07-31-newsnook-mobile-app-design.md` |
| 墨水屏设计 | `docs/superpowers/specs/2026-08-11-eink-mode-design.md` |
