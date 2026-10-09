# 自建源原站播放表面 + 持续旁路嗅探（Origin Player Live Sniff）

> 日期：2026-08-20  
> 状态：已定稿，实现中（`feat/wevb-arch`）  
> 前置：`2026-08-17-media-sniffer-engine-design.md`（已实现）、`2026-08-20-media-sniffer-universal-hardening-design.md`（门控/Planner）  
> 动机：短时隐藏 `SniffSession` 在「预告片先到、正片晚到、需用户点播放」的自建 CMS 播页上经常只命中广告（见 `logs/1.log`）；vela/youtoo 高命中依赖可见会话 + 用户触发，而非站点规则引擎。

## 1. 问题陈述

自建源视频稿当前路径：隐藏 WebView 短时嗅探（约 9–12s + quiet）→ 自动选出一个 `MediaDescriptor` → `InkVideoPlayer`。

失败模式：

1. 原站先请求预告片 progressive（如广告 mp4），quiet 早退或增量发布把广告当正文。
2. 正片 HLS 常在 iframe 配置里或广告结束后才发网络请求，短窗内进不了可播主资源。
3. 即便配置里有 m3u8，CDN 403 时仍可能回退到广告。

根因是**会话模型**（短时、不可操作、自动替换），不是缺某一条 CMS 适配。

## 2. 产品决策（已确认）

| 项 | 选择 |
|---|---|
| 首屏 | 始终可操作的**原站播放表面** |
| 静默命中后 | **不**自动切自定义播放器；只出浮钮 |
| 浮钮 | 用户点击后才挂载 `InkVideoPlayer` |
| 范围 | 仅 **自建源**（`isCustomSourceId`）且 `contentType === 'video'` |
| 平台 | 仅 **Android** |
| 非范围 | 内置源、YouTube、Web、资源列表、下载、CMS 站名规则 |

产品句：自建源视频在 Android 上默认用原站表面观看；旁路嗅探与该表面同寿；出现可信正片后浮钮邀请「用阅读器播放」。

## 3. 目标与非目标

### 3.1 目标

| # | 目标 |
|---|---|
| G1 | 门控命中时，Reader 视频主区为可见可操作原站 WebView，用户可点播放、过广告 |
| G2 | 旁路观察挂在同一 WebView 上，与表面同寿；不依赖 timeout/quiet 结束整段会话 |
| G3 | 可信非广告、非 DRM 的 `MediaDescriptor` 出现后显示浮钮；点击后 `preparePlayback` + `InkVideoPlayer` |
| G4 | 离开文章即销毁表面与旁路；无 App 级常驻浏览器 |
| G5 | 未命中门控的路径行为不变（内置源 / Web / 图文） |

### 3.2 非目标

- 不做站内浏览器 Tab、不做「发现 N 个资源」列表、不做下载中心  
- 不引入 youtoo `videoRules` / `@rule=`，不新增 MacCMS/站名适配器  
- 不自动把自定义播放器设为首屏（与已确认决策冲突）  
- 不绕过 DRM、不逆向签名、不代发 POST 播放 API  
- 不在 Web 实现对等持续旁路  

## 4. 方案对比（摘要）

| 方案 | 结论 |
|---|---|
| A. 可见原站表面 = 唯一嗅探宿主 | **采用** |
| B. 隐藏长嗅探 + 同步可见 iframe | 拒绝（双 WebView、会话不一致） |
| C. 先短时静默再降级到 A | 不做首版（与「浮钮不自动切」叠床架屋） |

## 5. 架构

```text
ReaderScreen
  gate: Android && isCustomSourceId(sourceId) && contentType === 'video'
        │
        ├─ YES → OriginPlayerSurface（可见 WebView）
        │         load originUrl 或 planSniffTargets 首个播页
        │         └─ LiveSniffSession（同 WebView 旁路）
        │               Network + SW + JS hooks
        │               → admitObservation → Graph
        │               → onCandidate(MediaDescriptor)
        │         └─ 浮钮「用阅读器播放」（达门槛才显示）
        │               → 用户点击 → InkVideoPlayer + preparePlayback
        │
        └─ NO  → 现有 resolveBody / 短时 SniffSession / Inline 路径
```

### 5.1 组件边界

| 单元 | 职责 | 不做什么 |
|---|---|---|
| 门控 | `isCustomSourceId` + video + `Capacitor.isNativePlatform()`（Android） | 不解析 CMS |
| `OriginPlayerSurface` | 可见原站页、与 Reader 滚动/返回协调 | 不站点规则 |
| `LiveSniffSession` | 复用 Classifier / Graph / OriginHeaderStore；随表面生命周期 | 无资源列表 |
| 浮钮 | 达门槛才显示；点击切换自定义播放 | 不因广告 progressive 单独亮起 |
| `InkVideoPlayer` | 用户点击后的自定义播放 | 本路径不自动首屏挂载 |

### 5.2 与短时 SniffSession 的关系

门控命中时：

- **不再**对正文自动注入 `data-media-pending` 并短时隐藏嗅探后替换为 `<video>`。
- `resolveArticleBody` 仍可拉页面 HTML 供摘要、相关推荐、`planSniffTargets` 选播页 URL。
- 未命中门控：现有短时 `SniffSession` 与 quiet 逻辑保持（含近期预告片 quiet 修复），本 spec 不废除。

### 5.3 原生形态（Android）

在现有 `MediaSnifferPlugin` 上扩展（名称可调整，语义如下）：

- `startLiveSession({ url, referrer, sessionId })`：创建**可见** WebView（阅读器媒体区尺寸，非屏外 -10000），安装与现网一致的旁路脚本与 Network/SW 观察。
- 持续 `mediaObservation` 事件；**无**「quiet 结束整段会话」；可选在清单高价值命中后降低 Probe 频率以省电。
- `stopLiveSession({ sessionId })`：拆 WebView、清监听、清该会话的播放登记。
- 播放仍走现有 `preparePlayback` + `OriginHeaderStore` exact origin。

JS 侧：`OriginPlayerSurface` 组件封装插件；候选状态用 React state；卸载时必调 `stopLiveSession`。

## 6. 数据流与浮钮门槛

### 6.1 加载 URL

1. 默认 `article.originUrl`。  
2. 若已有 `pageHtml`，可用 `planSniffTargets` 得到的首个播页（iframe / 同站 play 路径），`referrer` 为详情或列表页。  
3. 不写死 `vodplay` 等 CMS 名以外的专用分支；复用通用 Planner。

### 6.2 浮钮亮起（须同时满足）

1. 存在 `MediaDescriptor`，且非 DRM。  
2. 主资源为 `hls` / `dash`，**或** progressive 且非 `isAd` / `isLikelyAdMediaUrl`。  
3. 若候选池中同时有清单与 progressive：浮钮绑定清单（或 `selectPlayableAsset` 的非广告首选），**不得**仅因广告 mp4 亮起。  
4. 主候选 URL 变化时更新按钮态，避免闪烁。

未达门槛：用户继续原站播放；首版不强制「仍在识别…」弱提示。

### 6.3 点击浮钮之后

1. `prepareNativeMediaPlayback` + 覆盖层或媒体区切换到 `InkVideoPlayer`。  
2. 原站 Surface 暂停或不可见，但会话可保留至离开文章（便于 403 后新签名再更新）。  
3. 返回键：若自定义层打开 → 先关自定义并回到原站表面；否则退出 Reader。  
4. 首版可不做「设置里关原站表面」；若自定义播放失败，提供返回原站。

## 7. 生命周期

| 事件 | 行为 |
|---|---|
| 进入门控文章 | 创建 Surface + `startLiveSession` |
| 同 Reader 切下一条门控视频 | 先 `stop` 再 `start` |
| 离开 Reader / 切走文章 | 立即 `stopLiveSession`，无残留 |
| 进程后台 | 可降频；回前台恢复观察，不新建无限全局会话 |
| 无硬 timeout 结束旁路 | 与表面同寿 |

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| 原站加载失败 / SSL | Surface 错误态 + 次要「打开原文」；停旁路；无浮钮 |
| 仅广告 progressive | 不亮浮钮 |
| 自定义播放 403/过期 | 提示失败；可回原站；旁路继续，新候选可更新浮钮 |
| DRM / 仅 blob | 不亮浮钮 |
| 非 Android / 非自建源 | 现有路径，零变化 |

## 9. UI / 手势

- Surface 占据阅读器上方固定媒体区（对齐现有视频位高度习惯）；正文可滚动。  
- 竖滑优先 Reader；Surface 内点击/必要手势给 WebView（避免整页被 WebView 吞掉）。  
- 浮钮文案：「用阅读器播放」（中文，与设置语气一致）。  
- 墨水屏：纸感控件，无依赖炫光动画。

## 10. 测试与验收

### 10.1 自动化

- 门控：自建源 + video + native → true；内置源 → false。  
- 浮钮门槛：广告 mp4 不通过；HLS 通过；HLS+广告并存只认 HLS。  
- 卸载：mock native 断言 `stopLiveSession` 被调用。

### 10.2 实机（一条自建 CMS）

1. 打开自建源视频 → 可见可点原站播放器。  
2. 过预告片或清单出现后 → 浮钮出现。  
3. 点浮钮 → 自定义播放器为正片，非广告。  
4. 离开文章 → 无残留 WebView / 无后台嗅探。

### 10.3 相关命令

```bash
npm run test:media-sniffer
# 门控/浮钮纯函数测试随实现加入 scripts/*.test.ts
npm run android:run   # 或 android:run:local
```

## 11. 文档与代码入口（实现时）

| 项 | 位置 |
|---|---|
| 门控 | Reader / `resolveBody` 分支（`isCustomSourceId`） |
| Surface + 浮钮 UI | `src/components/`（新组件，如 `OriginPlayerSurface.tsx`） |
| Live session API | `src/features/mediaSniffer/native.ts` + `MediaSnifferPlugin.java` |
| 分类/建图复用 | `classifier.ts` / `graph.ts` / `service` 增量，非第二套引擎 |
| 规范同步 | 实现后更新 `docs/sniffer.md` §20：门控路径与短时路径并列 |

## 12. 风险

| 风险 | 缓解 |
|---|---|
| 原站广告/追踪进入阅读器 | 范围限自建源视频；离开即销毁；不扩到内置源 |
| WebView 抢手势 | 固定媒体区 + 滚动归属 Reader |
| 内存 | 同时仅一个 Live session；切条目前销毁 |
| 与「拒绝常驻 Sniff WebView」冲突 | 本方案是**文章级、门控、可见、可销毁**表面，不是 App 常驻浏览器 |
| CDN 正片本身 403 | 浮钮可出现但播放失败 → 回原站；不把广告当成功 |

## 13. 验收标准

1. 门控外路径零回归。  
2. 门控内无自动首屏 `InkVideoPlayer`。  
3. 浮钮不因单独广告 progressive 亮起。  
4. 实机自建 CMS：原站可播 + 浮钮切正片。  
5. 代码审查：无新 CMS 模块名、无资源列表 UI、无 Web 对等实现承诺。

---

更新本文件时：保持与已确认产品决策一致；实现细节以 implementation plan 为准。
