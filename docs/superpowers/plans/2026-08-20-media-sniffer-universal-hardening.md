# 媒体嗅探通用化加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Media Graph 引擎上引入 **Classifier Gate + Target Planner + SniffSession 旁路加固**，以 vela/youtoo 的通用 URL-first 观察模型提升嗅探成功率并消除 JSON-LD 图片假阳性；**不**添加 CMS/站点定制规则。

**Architecture:** TypeScript 新增 `admitObservation` / `planSniffTargets` 作为权威语义；Android SniffSession 镜像过滤与 probe 策略；未提交 MacCMS 命名代码 refactor 为通用 API 后再合并。

**Tech Stack:** 现有 React 19 / Capacitor 8 / TypeScript mediaSniffer 模块、`scripts/media-sniffer.test.ts`、Android `MediaSnifferPlugin` / `MediaProbe`；不新增 npm 生产依赖。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-08-20-media-sniffer-universal-hardening-design.md`
- 基线：`docs/superpowers/specs/2026-08-17-media-sniffer-engine-design.md`
- Backendless：不代发 POST play API、不逆向签名、不 DRM 绕过
- 不做站内浏览器、videoRules 引擎、frameworkDetect 嗅探集成
- 新代码禁止 CMS 名（MacCMS/vodplay/nnyy）作为模块/函数名；测试夹具可用 JSON-LD 结构描述
- 中文用户文案；标识符英文；`src/` 走 `log.sniffer`
- 每 Task 末 `npm run test:media-sniffer`；用户未要求不 `git push`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/features/mediaSniffer/classifier.ts` | Gate：`isStaticAssetUrl`, `looksMediaUrl`, `looksLikePlayerJson`, `admitObservation`, query hints |
| `src/features/mediaSniffer/targetPlanner.ts` | **新建**：`planSniffTargets()` 通用 secondary target + 预算 |
| `src/features/mediaSniffer/core.ts` | 收紧 `addStructuredPayloadObservation`；collect/merge 出口调用 `admitObservation` |
| `src/features/mediaSniffer/apiParser.ts` | 扩展 URL_FIELDS；push 前 classify |
| `src/features/mediaSniffer/service.ts` | 用 `planSniffTargets` 替代 `playbackPageUrlsInHtml`；删除 CMS 常量 |
| `src/features/mediaSniffer/graph.ts` | static-only 弱候选负分/丢弃 |
| `android/.../MediaSnifferPlugin.java` | 图片正则、performance 过滤、PlaybackTrigger、tracker filter |
| `android/.../MediaProbe.java` | MAX_PER_SESSION=24；HEAD 头完善 |
| `scripts/media-sniffer.test.ts` | Gate + planner + 回归夹具 |
| `docs/architecture.md` §8.3 | 同步 Gate / Planner |

---

### Task 1: Classifier Gate（TS 权威语义）

**Files:**
- Modify: `src/features/mediaSniffer/classifier.ts`
- Modify: `src/features/mediaSniffer/core.ts`（`addStructuredPayloadObservation`）
- Modify: `scripts/media-sniffer.test.ts`

**Interfaces:**
- Produces:
  - `isStaticAssetUrl(url: string): boolean`
  - `looksMediaUrl(url: string): boolean`
  - `looksLikePlayerJson(text: string): boolean`
  - `admitObservation(obs: MediaObservation): MediaObservation | null`

- [ ] **Step 1: 写失败测试 — 图片与 performance 噪声**

```ts
assert.equal(admitObservation({
  url: 'https://cdn.example/static/favicon.png',
  pageUrl: 'https://news.example/v/1',
  source: 'static',
  mediaKind: 'video',
  hasVideo: true,
  width: 192,
  height: 192,
}), null)

assert.equal(admitObservation({
  url: 'https://cdn.example/theme/common.css',
  pageUrl: 'https://news.example/v/1',
  source: 'performance',
}), null)

assert.ok(admitObservation({
  url: 'https://cdn.example/live/master.m3u8',
  pageUrl: 'https://news.example/v/1',
  source: 'network',
  mimeType: 'application/vnd.apple.mpegurl',
}))
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run: `npm run test:media-sniffer`  
Expected: FAIL — `admitObservation` not defined

- [ ] **Step 3: 实现 Gate + 收紧 structured payload**

在 `classifier.ts` 实现 §spec 5.1 规则。  
在 `core.ts` 将 `hasVideoSignal` 改为需 MIME/codec/qualityLabel/媒体扩展名之一，**不含**单独 width/height。

- [ ] **Step 4: 运行测试 PASS**

Run: `npm run test:media-sniffer`

- [ ] **Step 5: Commit**

```bash
git add src/features/mediaSniffer/classifier.ts src/features/mediaSniffer/core.ts scripts/media-sniffer.test.ts
git commit -m "feat(sniffer): add universal Classifier Gate for observations"
```

---

### Task 2: Target Planner（通用 secondary target）

**Files:**
- Create: `src/features/mediaSniffer/targetPlanner.ts`
- Modify: `src/features/mediaSniffer/service.ts`（删除 `playbackPageUrlsInHtml`, `MACCMS_PLAYBACK_PATH`）
- Modify: `scripts/media-sniffer.test.ts`

**Interfaces:**
- Produces:

```ts
export type SniffTarget = {
  url: string
  referrer?: string
  budgetMs: number
}

export function planSniffTargets(input: {
  pageUrl: string
  html?: string
  staticObservations: MediaObservation[]
  totalTimeoutMs?: number
}): SniffTarget[]
```

- [ ] **Step 1: 写失败测试 — JSON-LD + 通用 /play/ 路径**

使用 spec §8 夹具（Organization.logo + VideoObject.embedUrl + `<a href="/vodplay/...">` 仅作 path 样例，测试描述写「generic playback path」）。

```ts
const targets = planSniffTargets({
  pageUrl: 'https://vod.example/voddetail/42.html',
  html: detailHtmlFixture,
  staticObservations: [],
  totalTimeoutMs: 9000,
})
assert.deepEqual(targets.map(t => t.url), ['https://vod.example/vodplay/42-1-1.html'])
assert.equal(targets[0].budgetMs, 9000)
```

- [ ] **Step 2: FAIL**

Run: `npm run test:media-sniffer`

- [ ] **Step 3: 实现 `targetPlanner.ts`**

- JSON-LD 逻辑从现有 `service.ts` 迁入（`collectJsonLdPlaybackUrls` 私有）  
- 链接扫描用 `PLAYBACK_PATH_PATTERN`（spec §5.2），同站过滤  
- 静态有 direct media → `[...iframe, pageUrl]`；否则 secondary-only

- [ ] **Step 4: Refactor `service.ts` 调用 planner**

- [ ] **Step 5: PASS + commit**

```bash
git commit -m "feat(sniffer): add generic Target Planner for SniffSession"
```

---

### Task 3: 观察管线接入 Gate

**Files:**
- Modify: `src/features/mediaSniffer/core.ts`（`collectMediaCandidates` 入口或 merge 后 filter）
- Modify: `src/features/mediaSniffer/service.ts`（`onObservation` 回调）
- Modify: `src/features/mediaSniffer/apiParser.ts`

- [ ] **Step 1: apiParser push 前 classify 测试**

```ts
// JSON 仅含 logo png 的 url 字段不应产生 observation
const obs = parseMediaApiBody('{"logo":{"url":"https://x.com/a.png","width":192}}', pageUrl, 'fetch')
assert.equal(obs.length, 0)
```

- [ ] **Step 2: 实现 apiParser URL_FIELDS 扩展 + classify 门控**

字段：`file`, `hlsmanifesturl`, `dashmanifesturl`, `manifest_url`, `video_url`, `media_url`, `backup_urls`。

- [ ] **Step 3: mergeObservationSources / discoverMediaDescriptor 仅保留 admitted obs**

- [ ] **Step 4: graph static-only 负分**

`selectPlayableAsset`：若候选仅 `static` 源且无 network/dom/fetch/xhr → 不参与排序。

- [ ] **Step 5: test + commit**

```bash
git commit -m "feat(sniffer): wire admitObservation through parser and graph"
```

---

### Task 4: Android SniffSession 镜像加固

**Files:**
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java`
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MediaProbe.java`
- Optional: `android/.../MediaSnifferPluginTest` 若已有 — 否则 manual

- [ ] **Step 1: WebView 360×640**（`startSniff` LayoutParams）

- [ ] **Step 2: 图片后缀 guard**

- `inspectPayload`：`url.split('?')[0]` + 后缀 regex  
- `isImmediatelyPlayable`：图片后缀 → false

- [ ] **Step 3: performance 仅 looksMediaUrl**

与 TS `looksMediaUrl` 同模式（注释引用 classifier 单源定义）

- [ ] **Step 4: Tracker filter + MAX_PER_SESSION=24**

`LiveProbeQueue.offer` 前 `isTrackerHost(url)`；`MediaProbe.MAX_PER_SESSION = 24`

- [ ] **Step 5: PlaybackTrigger（通用）**

document-ready 后单次：`querySelector` play 语义 button / 同站 play href / player iframe

- [ ] **Step 6: 手工 smoke + commit**

```bash
git commit -m "feat(android): harden SniffSession probe bridge and filters"
```

---

### Task 5: 文档与 resolveBody 超时

**Files:**
- Modify: `docs/architecture.md`（§8.3 增补 Gate/Planner）
- Modify: `src/lib/resolveBody.ts`（视频稿 `timeoutMs: 9000` 若未合并）
- Modify: `src/lib/logger.ts`（可选 `sniffer` namespace debug 字段）

- [ ] **Step 1: 更新 architecture 段落**

- [ ] **Step 2: 确认 resolveBody 视频路径 9000ms 与 planner secondary-only 一致**

- [ ] **Step 3: Commit docs**

```bash
git commit -m "docs: document universal sniff gate and target planner"
```

---

### Task 6: 端到端验证

- [ ] **Step 1:** `npm run test:media-sniffer`  
- [ ] **Step 2:** `npm run test:resolve-body`（若触达 resolveBody）  
- [ ] **Step 3:** `npm run lint`  
- [ ] **Step 4:** 实机 APK — 详情/播放分离页 + 1 个 direct mp4 页 + YouTube embed 回归  
- [ ] **Step 5:** 确认无新 CMS 命名导出

---

## Self-Review（plan ↔ spec）

| Spec 章节 | Task |
|---|---|
| G1 Classifier Gate | Task 1, 3 |
| G2 Target Planner | Task 2 |
| G3 旁路观察 | Task 4 |
| G4 假阳性 | Task 1, 3, 4 |
| G5 单测 | 各 Task |
| §5.4 Tracker | Task 4 |
| §5.5 ApiParser | Task 3 |
| §11 验收 | Task 6 |

无 TBD / 无站点规则引擎任务。

---

## Execution Handoff

Plan 已保存至 `docs/superpowers/plans/2026-08-20-media-sniffer-universal-hardening.md`。

**执行选项：**

1. **Subagent-Driven（推荐）** — 每 Task 独立 subagent + 审查  
2. **Inline Execution** — 本会话按 Task 1→6 顺序实施  

Spec 评审：`docs/superpowers/specs/2026-08-20-media-sniffer-universal-hardening-design.md`  
请先确认 spec 再开始 Task 1。未提交改动应在 Task 2 中 refactor，勿直接合并 MacCMS 命名代码。
