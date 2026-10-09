# Origin Player Live Sniff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 自建源视频稿在 Android 上默认用可见可操作的原站播放表面，旁路嗅探与表面同寿；可信正片出现后浮钮「用阅读器播放」，点击才进入 `InkVideoPlayer`。

**Architecture:** 门控命中时跳过短时隐藏 `SniffSession` 自动换 `<video>`。`OriginPlayerSurface` 在阅读器上方固定媒体区挂可见 WebView（`MediaSnifferPlugin.startLiveSession`）；同 WebView 旁路观察增量建 Graph；达浮钮门槛后用户手动切换自定义播放器。离开文章 `stopLiveSession`。

**Tech Stack:** React 19 + Capacitor 8 Android、现有 `mediaSniffer`（classifier/graph/native）、`InkVideoPlayer`、`scripts/*.test.ts` + `npm run test:media-sniffer`。

## Global Constraints

- 仅 `isCustomSourceId(sourceId) && contentType === 'video' && Capacitor.getPlatform() === 'android'`
- 不自动把自定义播放器设为首屏；浮钮不因单独广告 progressive 亮起
- 无 CMS 模块名 / 无资源列表 / 无 Web 对等持续旁路
- `src/` 日志走 `log.sniffer`；不引入生产依赖
- 插件只增方法，不破坏现有 `sniff` / `preparePlayback` 签名
- Spec：`docs/superpowers/specs/2026-08-20-origin-player-live-sniff-design.md`

## File Structure

| 文件 | 职责 |
|---|---|
| `src/features/mediaSniffer/originPlayerGate.ts` | 门控 + 浮钮门槛纯函数 |
| `scripts/origin-player-live-sniff.test.ts` | 门控/浮钮单测 |
| `android/.../MediaSnifferPlugin.java` | `startLiveSession` / `stopLiveSession`（可见 WebView，无 quiet 结束） |
| `src/features/mediaSniffer/native.ts` | Capacitor 封装 + 观察流 |
| `src/components/OriginPlayerSurface.tsx` | 媒体区 UI、浮钮、切换 `InkVideoPlayer` |
| `src/lib/resolveBody.ts` | 门控路径不 schedule 短时嗅探替换 |
| `src/screens/ReaderScreen.tsx` | 挂载 Surface、返回键关自定义层 |
| `docs/sniffer.md` §20 | 并列文档两条路径 |
| `package.json` | `test:origin-player-live-sniff` |

---

### Task 1: 门控与浮钮门槛纯函数（TDD）

**Files:**
- Create: `src/features/mediaSniffer/originPlayerGate.ts`
- Create: `scripts/origin-player-live-sniff.test.ts`
- Modify: `package.json`（增加 test script）

**Interfaces:**
- Produces:
  - `shouldUseOriginPlayerSurface(input: { sourceId: string; contentType?: string; platform: string }): boolean`
  - `isFloatButtonEligible(descriptor: MediaDescriptor | null | undefined): boolean`

- [ ] **Step 1: 写失败测试**

```ts
import assert from 'node:assert/strict'
import { shouldUseOriginPlayerSurface, isFloatButtonEligible } from '../src/features/mediaSniffer/originPlayerGate'
import type { MediaDescriptor } from '../src/features/mediaSniffer/types'

assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'custom_abc', contentType: 'video', platform: 'android' }),
  true,
)
assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'netease', contentType: 'video', platform: 'android' }),
  false,
)
assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'custom_abc', contentType: 'video', platform: 'web' }),
  false,
)

function baseDescriptor(overrides: Partial<MediaDescriptor> & Pick<MediaDescriptor, 'type' | 'url'>): MediaDescriptor {
  return {
    pageUrl: 'https://play.example/1',
    score: 80,
    videoTracks: [],
    audioTracks: [],
    subtitles: [],
    drm: false,
    drmKeySystems: [],
    ...overrides,
  }
}

const ad = baseDescriptor({
  type: 'progressive',
  url: 'https://cdn.example/ad/preroll.mp4',
  isAd: true,
})
const hls = baseDescriptor({
  type: 'hls',
  url: 'https://cdn.example/index.m3u8',
  isAd: false,
})

assert.equal(isFloatButtonEligible(ad), false)
assert.equal(isFloatButtonEligible(hls), true)
```

（广告 URL 也可用 `isLikelyAdMediaUrl` 路径另测 `isAd` 未标的情况。）

- [ ] **Step 2: 跑测确认失败**

```bash
npx tsx scripts/origin-player-live-sniff.test.ts
```

Expected: 模块不存在或断言失败。

- [ ] **Step 3: 实现 `originPlayerGate.ts`**

```ts
import { Capacitor } from '@capacitor/core'
import { isCustomSourceId } from '../../sources/registry'
import { isLikelyAdMediaUrl } from './classifier'
import type { MediaDescriptor } from './types'

export function shouldUseOriginPlayerSurface(input: {
  sourceId: string
  contentType?: string
  platform?: string
}): boolean {
  const platform = input.platform ?? Capacitor.getPlatform()
  return (
    platform === 'android'
    && input.contentType === 'video'
    && isCustomSourceId(input.sourceId)
  )
}

export function isFloatButtonEligible(descriptor: MediaDescriptor | null | undefined): boolean {
  if (!descriptor || descriptor.drm) return false
  const primary = descriptor.resources?.[0] ?? descriptor
  if (primary.isAd || isLikelyAdMediaUrl(primary.url)) return false
  if (primary.type === 'hls' || primary.type === 'dash') return true
  if (primary.type === 'progressive') return true
  return false
}
```

规则对齐 spec：有 `resources` 时以排序后首位为准（`buildMediaDescriptor` 已把非广告/高分放前）；单独广告 progressive 因 `isAd` 或 URL 标记失败。

- [ ] **Step 4: 跑测通过 + 注册 script**

`package.json`:
```json
"test:origin-player-live-sniff": "npx tsx scripts/origin-player-live-sniff.test.ts"
```

```bash
npm run test:origin-player-live-sniff
```

Expected: pass

- [ ] **Step 5: Commit**（若用户要求再提交）

```bash
git add src/features/mediaSniffer/originPlayerGate.ts scripts/origin-player-live-sniff.test.ts package.json
git commit -m "feat(media): gate and float-button rules for origin player surface"
```

---

### Task 2: Android `startLiveSession` / `stopLiveSession`

**Files:**
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java`

**Interfaces:**
- Consumes: 现有 probe 脚本、`recordNetworkEvent`、`emitMediaObservation`、`keepTrustedObservations` 逻辑
- Produces: Capacitor methods
  - `startLiveSession({ url, referrer?, sessionId })`
  - `stopLiveSession({ sessionId })`
  - 继续发 `mediaObservation` 事件（带 `sessionId`）

- [ ] **Step 1: 在插件中增加 live session 状态字段**

与现有单次 `sniff` 并存：`liveSessionId`、`liveWebView`、`liveRoot`、`liveFinished` 等；**同时只允许一个 live session**（新 start 先 stop 旧的）。

- [ ] **Step 2: 实现 `startLiveSession`**

行为要点（相对 `startSniff`）：

1. WebView **可见**：放入 Activity 内容区顶部媒体槽（全宽，高度约 `width * 9/16`，`top` 避开状态栏/App 顶栏可用固定 dp 或由 JS 后续再调；首版可用 `Gravity.TOP` + 16:9，左右 0）。
2. **不要** `leftMargin = -10000`。
3. **不要** `postDelayed(finish, timeoutMs)`，**不要** quiet 轮询里 `finishSniff`。
4. 仍安装 document-start probe、Network/SW、`emitMediaObservation`。
5. `loadUrl(url)` / 带 Referer。
6. `call.resolve()` 在 WebView 创建成功后立即返回（不等待嗅探结束）。

- [ ] **Step 3: 实现 `stopLiveSession`**

匹配 `sessionId`（或无 id 则停当前）：`cleanup` WebView、移除 root、取消 probe、resolve。幂等。

- [ ] **Step 4: 手动 sanity（可选）**

用现有 App 或临时代码调插件，确认可见 WebView 能加载页、离开后消失。

- [ ] **Step 5: Commit**（若用户要求）

```bash
git add android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java
git commit -m "feat(android): add visible live sniff session without quiet timeout"
```

---

### Task 3: `native.ts` 封装 live session

**Files:**
- Modify: `src/features/mediaSniffer/native.ts`
- Modify: `scripts/origin-player-live-sniff.test.ts`（mock 形状测试可选）

**Interfaces:**
- Produces:
  - `startNativeLiveSniffSession(options: { url: string; referrer?: string; onObservation: (o: MediaObservation) => void }): Promise<{ sessionId: string; stop: () => Promise<void> }>`

- [ ] **Step 1: 扩展 Plugin 类型**

```ts
startLiveSession(options: { url: string; referrer?: string; sessionId: string }): Promise<void>
stopLiveSession(options: { sessionId: string }): Promise<void>
```

- [ ] **Step 2: 实现 `startNativeLiveSniffSession`**

1. 生成 `sessionId`（同现有 `observeMediaInNativePage`）。
2. `addListener('mediaObservation', …)`，过滤 `sessionId`，`observationsWithoutSessionNonce` 后回调。
3. `await startLiveSession({ url, referrer, sessionId })`。
4. 返回 `{ sessionId, stop }`：`stop` 内 removeListener + `stopLiveSession`。

- [ ] **Step 3: 非 Android 时**

`startNativeLiveSniffSession` 若 `getPlatform() !== 'android'`，直接 throw 或返回 no-op stop（Surface 组件不应调用）。

- [ ] **Step 4: Commit**（若用户要求）

---

### Task 4: 观察聚合 → 候选 Descriptor

**Files:**
- Create: `src/features/mediaSniffer/liveCandidate.ts`（或放进 `originPlayerGate.ts` 旁）
- Modify: `scripts/origin-player-live-sniff.test.ts`

**Interfaces:**
- Produces:
  - `reduceLiveObservations(observations: MediaObservation[]): MediaDescriptor | null`
  - 内部：`buildMediaDescriptor(observations)`；再经 `isFloatButtonEligible` 过滤，不合格返回 `null`（UI 不亮钮）

- [ ] **Step 1: 失败测试** — 仅广告网络观察 → `null`；广告+HLS → HLS descriptor。

- [ ] **Step 2: 实现并用 `buildMediaDescriptor`**

```ts
export function reduceLiveObservations(observations: MediaObservation[]): MediaDescriptor | null {
  const descriptor = buildMediaDescriptor(observations)
  return isFloatButtonEligible(descriptor) ? descriptor : null
}
```

- [ ] **Step 3: `npm run test:origin-player-live-sniff` 通过**

- [ ] **Step 4: Commit**（若用户要求）

---

### Task 5: `OriginPlayerSurface` UI

**Files:**
- Create: `src/components/OriginPlayerSurface.tsx`

**Interfaces:**
- Consumes: `startNativeLiveSniffSession`, `reduceLiveObservations`, `prepareNativeMediaPlayback`, `InkVideoPlayer`
- Props 示例：
  ```ts
  {
    pageUrl: string
    referrer?: string
    title: string
    poster?: string
    openOriginal?: () => void
    customPlayerOpenRef?: MutableRefObject<boolean | null> // 供 Reader 返回键
  }
  ```

- [ ] **Step 1: 布局**

- 外层：`aspect-video`（或 `min-h`）固定媒体区，`relative`。
- 未切自定义时：占位说明「原站播放器」+ 由 native WebView 盖在同区域（首版 WebView 由插件贴在屏幕顶部媒体槽；React 区负责高度占位，避免正文顶上去）。
- 浮钮：绝对定位右下，文案「用阅读器播放」，仅 `candidate` 非空时渲染。
- 点击浮钮：`setMode('custom')`，渲染 `InkVideoPlayer`（全区域），可暂停/隐藏占位（live session **保持**至 unmount）。

- [ ] **Step 2: effects**

```ts
useEffect(() => {
  let stop: (() => Promise<void>) | undefined
  const observations: MediaObservation[] = []
  void startNativeLiveSniffSession({
    url: pageUrl,
    referrer,
    onObservation: (o) => {
      observations.push(o)
      const next = reduceLiveObservations(observations)
      if (next) setCandidate(next)
    },
  }).then((session) => { stop = session.stop })
  return () => { void stop?.() }
}, [pageUrl, referrer])
```

- [ ] **Step 3: 错误态**

加载失败时（若插件后续发 `liveSessionError` 事件可接；首版可用超时无候选也不报错）显示次要「打开原文」调用 `openOriginal`。

- [ ] **Step 4: `customPlayerOpenRef`**

`useEffect` 同步 `() => { if (mode === 'custom') { setMode('origin'); return true }; return false }` 供返回键。

- [ ] **Step 5: Commit**（若用户要求）

---

### Task 6: `resolveBody` 跳过短时自动嗅探

**Files:**
- Modify: `src/lib/resolveBody.ts`

**Interfaces:**
- Consumes: `shouldUseOriginPlayerSurface`

- [ ] **Step 1: 在 `contentType === 'video'` 分支**

当 `shouldUseOriginPlayerSurface({ sourceId: article.sourceId, contentType: article.contentType, platform: Capacitor.getPlatform() })` 为 true：

- **不要** `scheduleMediaDiscovery` / 等待 `discoverMediaDescriptor` 写 `<video>`。
- 返回摘要/相关 HTML + **不**带 `data-media-pending` 的主视频占位（或空媒体槽，由 Reader 挂 Surface）。
- 仍可 `fetchAbsoluteText(originUrl)` 做 related（若现有 `withRelatedFromPage` 需要）。

示例策略：`buildVideoBody` 增加 `mode: 'origin-surface'`，contentHtml 仅 summary，无 sniffing placeholder。

- [ ] **Step 2: 确认内置源视频仍走原 `timeoutMs: 12000` 路径**

- [ ] **Step 3: Commit**（若用户要求）

---

### Task 7: `ReaderScreen` 集成

**Files:**
- Modify: `src/screens/ReaderScreen.tsx`
- Modify: `src/App.tsx`（仅当返回键需从 Reader 暴露关闭自定义层时）

- [ ] **Step 1: 计算门控**

```ts
const useOriginSurface = shouldUseOriginPlayerSurface({
  sourceId: article.sourceId,
  contentType: article.contentType,
})
```

- [ ] **Step 2: 条件渲染**

在现有 `VideoSniffPlaceholder` / 视频位附近：

```tsx
{useOriginSurface && article.originUrl && (
  <OriginPlayerSurface
    pageUrl={article.originUrl}
    referrer={article.originUrl}
    title={article.title}
    poster={article.image}
    openOriginal={() => { /* 现有打开原文 */ }}
    customPlayerOpenRef={originCustomCloseRef}
  />
)}
```

门控命中时隐藏「嗅探中」占位与对自动 `<video>` 的依赖。

- [ ] **Step 3: 返回键**

在 Reader 处理返回（或 App `backButton` 调 Reader 回调）时：若 `originCustomCloseRef.current?.()` 为 true，则消费返回事件。

- [ ] **Step 4: 实机检查清单**（文档记在 PR）

1. 自建源视频 → 可见原站  
2. 浮钮 → 自定义正片  
3. 返回 → 先关自定义  
4. 离开 → WebView 消失  

- [ ] **Step 5: Commit**（若用户要求）

---

### Task 8: 文档与回归

**Files:**
- Modify: `docs/sniffer.md` §20.1 / §20.6：增加「自建源 Android 原站表面 + Live session」并列路径
- Modify: spec 状态行可为「已定稿，实现中/已实现」

- [ ] **Step 1: 更新 sniffer.md 数据流一小段**（中文，与 §20 语气一致）

- [ ] **Step 2: 跑回归**

```bash
npm run test:origin-player-live-sniff
npm run test:media-sniffer
```

Expected: 全绿

- [ ] **Step 3: Commit**（若用户要求）

---

## Spec coverage check

| Spec 项 | Task |
|---|---|
| 门控自建源+video+Android | T1, T7 |
| 可见原站表面 | T2, T5 |
| 持续旁路无 quiet 结束 | T2 |
| 浮钮门槛 / 不自动切 | T1, T4, T5 |
| 离开销毁 | T3, T5 |
| resolveBody 不短时替换 | T6 |
| 返回键 | T7 |
| sniffer.md | T8 |
| 无 CMS / 无资源列表 | Global Constraints |

## Placeholder scan

无 TBD；原生媒体槽几何首版固定 16:9 顶栏，若与 React 顶栏重叠，在 T5/T7 用 `paddingTop`/`statusBar` 微调（实现时量一次真机）。

---

**Plan complete and saved to `docs/superpowers/plans/2026-08-20-origin-player-live-sniff.md`.**

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每 Task 新开子代理，Task 间审查  
2. **Inline Execution** — 本会话按 executing-plans 连续做并设检查点  

你要哪一种？（需要的话也可先让我把 spec + plan commit 进仓库。）
