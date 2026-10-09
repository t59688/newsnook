# OriginPlayerSurface 阅读器壳对齐（方案 A）

> 日期：2026-08-20  
> 状态：已实现；外层对齐阅读器 `page-x lg:px-8` + related 卡片圆角/边框；原站 WebView 同步媒体槽 bounds  
> 前置：`2026-08-20-origin-player-live-sniff-design.md`（行为契约不变）  
> 范围：自建源 Android 原站播放表面的 **外层壳 / 状态条 / WebView 槽位对齐**，不改 CMS 页内样式、不改嗅探门槛

## 1. 背景（已解决）

首版 React 壳曾用主题色 `bg-ink-deep` 填 16:9，昼读下呈奶油空卡，且与阅读器视频槽、相关卡片外层不一致；原生 WebView 曾全宽贴顶，与媒体槽错位叠出第二层画面。

现行方案：阅读器同款卡片外壳 + 槽下状态条；WebView 经 `setLiveSessionBounds` 对齐槽位。CMS 页内线路钮 / 报错 **仍不在范围**（第三方 HTML）。

## 2. 目标与非目标

### 目标

| # | 目标 |
|---|---|
| G1 | 外层与阅读器统一：`page-x lg:px-8`、related 同款圆角边框卡片、状态条 `px-2.5` |
| G2 | 原站 WebView 对齐媒体槽（bounds + 圆角裁剪）；取消第二层海报占位 |
| G3 | 状态在槽下：短文案 + 主按钮「用阅读器播放」；失败态短句 +「打开原文」 |
| G4 | 产品行为：可见原站 WebView、浮钮门槛、切自定义播放、返回键、会话生命周期；**仅**在已识别正片后可关原站（叉 / 主按钮） |

### 非目标

- 不注入 CMS CSS、不藏线路钮、不新增站点适配  
- 不改 `InkVideoPlayer` 内部控件  
- 不改门控 / `liveCandidate` / 原生 `startLiveSession` 契约  
- 不做「首屏改自定义播放器」等产品决策回退  
- 未识别正片前不允许关闭原站（点播 / 过广告仍依赖原站）  

## 3. UI 规格

### 3.1 容器

- 外层：`mt-5 page-x lg:px-8`（与封面图一致）。
- 卡片：`rounded-xl border border-haze bg-ink-raised/80 overflow-hidden`（与相关内容卡片同圆角/边框语言）。
- 媒体槽：`aspect-video` + 固定深底 `#0c0d10`；**不再**铺海报当第二块画面。
- Android 原站 WebView 经 `setLiveSessionBounds` 对齐到该槽（含 12px 圆角裁剪）；滚动/缩放时持续同步。
- `mode === 'custom'` 时槽内挂 `InkVideoPlayer`，隐藏原站 WebView。

### 3.2 状态条（仅 `mode === 'origin'`，媒体槽下方）

与相关卡片 body 同级内边距 `px-2.5 py-2.5`（0.625rem）：

| 状态 | 表现 |
|---|---|
| 正常、未达浮钮门槛 | 左侧 mono 文案 `原站播放中` + 脉冲点；**无**关闭叉 |
| 已有合格候选 | 左侧 `已识别正片` +「用阅读器播放」+ 关闭叉（二者均切阅读器并藏原站 WebView） |
| `sessionError` | 左侧短句 + 次要「打开原文」 |

禁止再显示长段说明；禁止在媒体槽内叠第二层海报壳。

### 3.3 主按钮与关闭叉

- 文案：`用阅读器播放`；叉的 `aria-label`：`关闭原站并使用阅读器播放`
- 视觉：主按钮对齐阅读器朱红操作钮；叉为次要图标钮
- 显示条件：`mode === 'origin' && candidate`（未识别正片时不出现）

### 3.4 自定义模式脚注

- 「返回原站播放器」保持次要文字链（`text-paper-muted`），不做新组件。

## 4. 实现边界

| 文件 | 职责 |
|---|---|
| `src/components/OriginPlayerSurface.tsx` | 卡片壳、状态条、槽位 ref、bounds 同步、关闭叉 |
| `src/features/mediaSniffer/native.ts` | `setNativeLiveSessionBounds` |
| `android/.../MediaSnifferPlugin.java` | `setLiveSessionBounds` + 启动时离屏直至 JS 对齐 |

## 5. 测试与验收

- 自动化：门控 / 浮钮门槛既有 `test:origin-player-live-sniff`；纯 UI 无强制新测。
- 实机：自建源视频 → 卡片外壳与相关区 padding 一致；WebView 落在媒体槽内；未识别无叉；识别后主按钮/叉切阅读器；失败态短文案。
- 回归：门控外路径（内置源、Web、图文）零变化。

## 6. 验证清单

1. 仍满足「无后端 / 站内可切阅读器播放 / 本地优先」。  
2. 只碰 Origin 壳相关文件。  
3. 不引入密钥或新生产依赖。  
4. 用户可见文案为中文且更短。  
