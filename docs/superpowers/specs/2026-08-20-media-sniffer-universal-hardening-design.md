# 媒体嗅探通用化加固（Universal Sniff Hardening）

> 日期：2026-08-20  
> 状态：草案，待评审  
> 前置：`docs/superpowers/specs/2026-08-17-media-sniffer-engine-design.md`（已实现基线）  
> 动机：SniffSession 在「详情/播放分离」页与 JSON-LD 图片元数据场景出现假阳性与漏检；吸收 vela-browser / youtoo 的**通用旁路观察**思想，**不**引入站点规则引擎或 CMS 适配层。

## 1. 问题陈述

2026-08-20 日志（`logs/1.log`）暴露两类失败，均属**通用类**问题：

1. **假阳性**：结构化数据里的 `ImageObject`（favicon/logo，带宽高）被 `width/height` 启发式标成 `video`，`.png` 进入 progressive 候选并 `preparePlayback`。
2. **漏检**：当前 URL 是「元数据页」而非「播放器页」；限时 SniffSession 在**无媒体请求的页面**空等，而真流在后续导航/iframe 中才出现。

vela-browser / youtoo 成功率高的根因是**观察模型**（常驻 WebView + 全请求旁路 + URL 优先分类 + 用户触发播放），不是某条 MacCMS 专用规则。NewsNook 必须在 **SniffSession + 阅读器** 约束下，用**协议级、可单测**的通用规则逼近同一效果。

## 2. 目标与非目标

### 2.1 目标

| # | 目标 |
|---|---|
| G1 | **统一分类门控（Classifier Gate）**：任意 observation 源入库前同一套 `admitObservation`；URL/MIME/魔数优先，元数据仅佐证 |
| G2 | **播放目标规划（Target Planner）**：静态分析推断「更可能发起媒体请求的 URL」（JSON-LD、同站播放型链接、iframe），SniffSession 预算优先给这些目标 |
| G3 | **旁路观察对齐**：network / SW / fetch / xhr / performance / dom 与 vela 同级过滤；无扩展名 URL 走 Probe（HEAD → Range + 魔数） |
| G4 | **假阳性零容忍**：静态资源扩展名、tracker 域、纯 JSON 尺寸字段不得单独构成可播候选 |
| G5 | **可验证**：`scripts/media-sniffer.test.ts` 覆盖门控、目标规划、API 字段扩展；不依赖 live 站点 |

### 2.2 非目标

- 不做站内浏览器、不做资源列表 UI、不做 youtoo 式 `videoRules` / `@rule=` 引擎  
- 不接入 `frameworkDetect` 或 MacCMS/WordPress 等 **框架适配层** 到嗅探路径  
- 不新增 `nnyyPlay` 类单站解析器；既有单站模块冻结，新能力走通用路径  
- 不 native 代发 POST play API、不逆向签名、不绕过 DRM  
- 不把 SniffSession 改成无限长会话（仍受 `timeoutMs` + quiet window 约束）

## 3. 设计原则（从 vela / youtoo 抽象）

1. **URL first**：扩展名、query MIME hint、Content-Type、魔数、DOM `video/audio/source` tag 才是准入；`width/height` 只能加分，不能定罪。  
2. **One classifier**：TS 为权威语义；Java probe 脚本与 `MediaProbe` 镜像同一黑名单/白名单，避免 static 源绕过 network 过滤。  
3. **Observe real traffic**：SniffSession 加载的 URL 必须是「页面自己也会去播」的目标；元数据页若无 direct media，应规划到 **secondary playback targets**。  
4. **Budget to signal**：probe 配额不给 tracker/statistics；高价值 MIME 命中后 quiet 早退。  
5. **Fail closed for autoplay**：阅读器自动播时，宁可 `null` + iframe 兜底，不可播 favicon/tracker。

## 4. 方案对比

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. 站点适配** | 为 MacCMS 等加 vodplay 规则 | 快 | 违背 backendless 工具定位；组合爆炸 | **拒绝** |
| **B. 统一门控 + 目标规划** | Classifier Gate + 通用 Secondary Target 发现 | 可单测；vela/youtoo 同源 | 需 refactor 未提交的 MacCMS 命名代码 | **采用** |
| **C. 常驻 Sniff WebView** | 模仿浏览器整页挂载 | 最接近 youtoo | 违背现有架构；内存/隐私 | **拒绝** |

## 5. 架构

在 2026-08-17 引擎上**增量**三层：

```text
discoverMediaDescriptor (service.ts)
        │
        ├─ StaticObserver（HTML / JSON payload / apiParser）
        │
        ▼
   TargetPlanner（新增，纯 TS）
        │  输入：pageUrl, html, staticObservations
        │  输出：SniffTarget[] { url, referrer, budgetMs, autoplayHints? }
        │
        ▼
   SniffSession（Android，按 Target 顺序执行）
        NetworkObserver + SW + ProbeBridge + PlaybackTrigger（通用 DOM 启发式）
        │
        ▼
   ObservationStore → admitObservation（classifier.ts）→ Graph → Descriptor
```

### 5.1 Classifier Gate（`admitObservation`）

**新增/扩展于** `src/features/mediaSniffer/classifier.ts`：

```ts
// 概念 API（实现时导出）
export function isStaticAssetUrl(url: string): boolean
export function looksMediaUrl(url: string): boolean
export function looksLikePlayerJson(text: string): boolean
export function admitObservation(obs: MediaObservation): MediaObservation | null
```

**规则（顺序）**：

1. 无 `url` 且非 MSE/DRM 信号 → reject  
2. `isStaticAssetUrl(url)` → reject（png/jpg/gif/webp/svg/ico/css/js/woff…，query 前 path 判定）  
3. `mediaFormatFor` → `unknown` | `blob` → reject（DOM/MSE 例外走 graph）  
4. `source === 'performance'` 且 `!looksMediaUrl(url)` → reject  
5. `source === 'static'` 且无 `hasStrongMediaSignal`（MIME video/audio、codec、manifest 扩展名、DOM 同源）→ reject  
6. URL query 通用 hint（**非 CMS 名**）：`isVideo=true` / `isMusic=true` / `mime=video%2F` → 正向 hint，仍过扩展名黑名单  

**`mediaFormatFor` 硬约束**：`mediaKind: 'video'` 时，若 path 为图片扩展名且无 `video/*` MIME → `unknown`。

**`addStructuredPayloadObservation`（core.ts）**：删除 `width || height` 作为唯一 video 条件；与 Gate 一致。

### 5.2 Target Planner（替代站点命名函数）

**重命名/refactor**：`playbackPageUrlsInHtml` → `planSniffTargets()`（或 `discoverSniffTargets()`），**删除** `MACCMS_PLAYBACK_PATH` 等 CMS 字面量。

**Secondary playback target 来源（通用，按优先级）**：

| 优先级 | 信号 | 说明 |
|---|---|---|
| 1 | JSON-LD `VideoObject.embedUrl` / `contentUrl` | schema.org 标准 |
| 2 | JSON-LD `WatchAction` → `EntryPoint.urlTemplate` | 标准 |
| 3 | 同站 `<a href>` path 匹配 **通用播放路径模式** | 见下 |
| 4 | `embeddedPageUrlsInHtml`（iframe src） | 已有 |
| 5 | 当前 `pageUrl` | 仅当静态已发现 direct media，或无 secondary target |

**通用播放路径模式**（单条正则，非 CMS 名）：

```text
/(?:^|\/)(?:play|player|watch|embed|vodplay|vod\/play|video\/play)(?:\/|$|[?#])/i
```

同站判定：`originOf(a) === originOf(pageUrl)`。

**预算分配**：

- 若静态 `collectMediaCandidates` 已有非 segment 候选 → targets = `[...iframeUrls, pageUrl]`（现行为）  
- 否则若存在 secondary targets → **仅嗅 secondary**（整窗给播放页，不对元数据页空等）  
- 多 target：`budgetMs = max(1500, floor(totalTimeout / count))`；secondary-only 时 `totalTimeout` 默认 9000ms（视频稿 `resolveBody`）

**`runtimeProbePageUrl`**：保留 YouTube/Vimeo embed autoplay 参数（已知 embed 协议）；**不**为聚合 CMS 改 query。

### 5.3 SniffSession 加固（Android）

| 项 | 改动 |
|---|---|
| WebView 尺寸 | 创建即 360×640；屏外偏移；禁止 0×0 |
| Probe 脚本 `inspectPayload` | 图片扩展名用 `split('?')[0]` + 后缀匹配（避免 `\\.` 引擎差异） |
| `isImmediatelyPlayable` | 有 video MIME 但 URL 为图片后缀 → false |
| `performance` push | 仅 `looksMediaUrl`（与 TS 同 regex，文档化单源） |
| fetch/xhr body | 先 `looksLikePlayerJson` 再 parse |
| **Tracker filter** | probe 队列前丢弃统计/telemetry 域（见 §5.4） |
| **PlaybackTrigger** | 一次性通用 DOM：`button/[role=button]` 含 play 语义、`a[href*="/play"]` 同站、首个 `iframe[src*=player|embed]`；**无** CMS class 名 |
| `MAX_PER_SESSION` | 12 → 24；HEAD 透传 captured Accept/Referer/UA |

### 5.4 Tracker / noise filter（通用名单）

probe **offer 前**跳过主机名后缀匹配（可维护常量数组，~15 条）：

```text
google-analytics.com, googletagmanager.com, doubleclick.net,
cloudflareinsights.com, sentry.io, hotjar.com, cnzz.com,
hm.baidu.com, jsdelivr.net/npm/disable-devtool
```

不阻断 `shouldInterceptRequest` 记录；只省 probe 配额。名单变更需单测快照。

### 5.5 ApiParser 扩展（vela 对齐）

`URL_FIELDS` 补充：`file`, `hlsmanifesturl`, `dashmanifesturl`, `manifest_url`, `video_url`, `media_url`, `backup_urls`（数组）。  
**入库前**每条 URL 须 `mediaFormatFor !== 'unknown'`（与 vela `MediaApiParser` 一致）。

### 5.6 与未提交改动的关系

工作区已有 MacCMS 导向命名（`playbackPageUrlsInHtml`、`MACCMS_PLAYBACK_PATH`）在合并前**必须 refactor 为 §5.2**，测试 fixture 保留行为、改通用描述。

## 6. 数据流（单页视频稿）

```text
1. fetch pageHtml
2. staticObs = observeMediaInHtml + parseMediaApiBody
3. targets = planSniffTargets(pageUrl, html, staticObs)
4. for target in targets:
     observeNative(target.url, target.budgetMs, target.referrer, onObservation)
     onObservation → admitObservation → merge → emitAvailableDescriptor
5. buildMediaDescriptor(admitted observations)
6. null → iframe / 失败态；非 null → InkVideoPlayer
```

## 7. 错误处理

| 场景 | 行为 |
|---|---|
| 全部 target 超时无高价值 obs | `null`；不选 favicon；Reader 走 iframe/原文 |
| Probe 403/SSL | 单 URL 失败；不阻断其他 target |
| DRM / blob-only | Graph 标记；Descriptor 提示原站授权 |
| 多候选 | `selectPlayableAsset`；static-only 弱信号不得胜 network/dom |

## 8. 测试策略

| 层 | 内容 |
|---|---|
| classifier | 图片 URL + video kind；query hint；static asset |
| planSniffTargets | JSON-LD embedUrl；通用 /play/ 链接；无 secondary 时 fallback |
| admitObservation | performance 噪声；ImageObject fixture（原 huarenok 结构作 **generic JSON-LD 夹具**） |
| apiParser | backup_urls 数组；新 URL 字段 |
| integration | `discoverMediaDescriptor` mock native 增量 emit |
| 回归 | YouTube embed autoplay URL 不变 |

## 9. 文档与日志

- 更新 `docs/architecture.md` §8.3：Classifier Gate、Target Planner、tracker filter  
- 更新 `docs/sniffer.md` 第一层：URL-first 门控  
- `log.sniffer`：`targetPlanned`, `admitted`, `rejectedReason`（debug 级）

## 10. 风险

| 风险 | 缓解 |
|---|---|
| 播放路径 regex 过宽 | 必须同站 + 排除 `/play.png` 类（static asset gate） |
| probe 配额上升 | tracker filter + secondary-only 减少无效页 |
| PlaybackTrigger 误点广告 | 单次 click + play 语义选择器；失败仅少一条路径 |
| 与 2026-08-17 行为差异 | 夹具矩阵 + 明确「假阳性修复」为 intentional break |

## 11. 验收标准

1. Generic JSON-LD Organization.logo + VideoObject.embedUrl 夹具：无 favicon 候选；runtime target 为 embedUrl  
2. `npm run test:media-sniffer` 全绿  
3. 实机：至少 1 个「详情/播放分离」站（不必写死站名）在 secondary target 路径下出现 m3u8/mp4 或 graceful null  
4. 代码审查：无 `MacCMS`/`vodplay`/`nnyy` 出现在新模块路径（`nnyyPlay.ts` 保持冻结）

---

**评审请确认**：是否同意以 **方案 B（Classifier Gate + Target Planner）** 为唯一实施方向，并拒绝站点规则引擎扩展。
