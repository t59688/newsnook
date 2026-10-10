# InkPlayer 应用内悬浮播放实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 用户已批准设计并明确要求开始实现；本会话直接执行，最后进行一次独立审查。

**Goal:** 视频脱离母页后可以在应用内移动、缩放、恢复、全屏和关闭，展示切换保留同一播放实例。

**Architecture:** 应用级 Provider 持有会话管理器，Host 持有稳定 portal 内的播放器运行时。原 InkVideoPlayer 入口注册 slot，播放器继续复用现有引擎；窗口只管理布局与手势。

**Tech Stack:** React 19、TypeScript、现有 CSS / lucide、Capacitor；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-10-10-inkplayer-floating-design.md`

## Global Constraints

- 本地优先，媒体仍直连上游，无云端和存储契约变化。
- 保留既有 public props、按媒体身份重建与鉴权检查点恢复语义。
- 窗口默认宽度 clamp(220px, 可用宽度 × 0.60, 360px)，最小 200px，最大 min(640px, 可用宽度)，受高度限制；操作栏 44px、安全边距 8px。
- 一个悬浮窗口，后台暂停且不自动续播，母页失效时恢复到独立播放页。
- 中文 UI、现有日志命名空间、旧 WebView 使用传统 transform、DLNA 本地关闭不停止电视。

## Review Focus

- StrictMode 的旧 cleanup 不能销毁新注册会话：任务 1 与 2 增加重挂行为测试。
- 脱离后页面回调 / props 更新不能把独立会话拉回：任务 2 增加 detach 与源替换测试。
- 全屏异步操作晚到不能复活已关闭会话：任务 4 增加关闭竞态测试。
- 相同 CDN 上不同鉴权媒体不能互相覆盖原生上下文：任务 4 验证会话隔离。
- 原站 native WebView 不受 CSS 层级控制：任务 4 增加可见性与过期 session 测试。

### Task 1: 会话和窗口几何

**Files:** `src/features/floatingVideo/{types,session,geometry}.ts`；`scripts/floating-video-session.test.ts`；`scripts/floating-video-geometry.test.ts`。

**Interfaces:** `createVideoSessionManager()` 提供 register/update/detach/float/restore/close/subscribe/getSnapshot；会话 ID 为 slot 独立身份；`constrainWindow(rect, bounds, ratio)`、`initialWindow(bounds, ratio)` 保证可达。

- [x] 写会话 detach、单窗口替换、旧 owner cleanup、关闭幂等和纯几何行为测试，运行并确认 RED。
- [x] 实现类型、管理器和几何函数，保持缓存快照、不可变发布；关闭同步撤销访问。
- [x] 运行两组新测试，确认 GREEN。

### Task 2: 应用所有权和稳定宿主

**Files:** `src/features/floatingVideo/{context,FloatingVideoProvider,VideoSessionHost}.tsx`；`src/components/InkVideoPlayer.tsx`；`src/BootstrapRoot.tsx`；`src/lib/inlineVideoFullscreenHost.ts`；`scripts/floating-video-lifecycle.test.tsx`。

**Interfaces:** 兼容 `InkVideoPlayerProps`，`InkVideoPlayerRuntime` 供 Host 使用；Context 提供当前 mode 与 float/restore/close、全屏通知；runtime 句柄提供暂停、退出全屏。

- [x] 写真实 React 测试，断言悬浮入口、母页卸载不销毁 video、恢复保持元素身份/进度/倍速/load 次数、关闭后清理；确认 RED。
- [x] 提取兼容入口与 runtime，Provider 在页面分支之外挂载；Host 固定 portal container，移动 DOM 而不更换 portal target。
- [x] detach 撤销页面回调和 fullscreen ref；内嵌卸载清理，悬浮会话继续；禁用正文 watcher 对应用会话宿主的迁移。
- [x] 运行新生命周期测试与既有两组 ink-video 回归，确认 GREEN。

### Task 3: 小窗 UI 与输入

**Files:** `src/features/floatingVideo/{FloatingVideoWindow,useWindowGesture}.tsx`；`src/styles/player/floating.css`；`src/index.css`；扩展 `scripts/floating-video-lifecycle.test.tsx` 与几何测试。

**Interfaces:** Window 接收 title/mode/rect/fullscreen 与 restore/close 操作；手势使用 geometry，支持 pointer capture、双指、取消、键盘和 rAF。

- [x] 添加拖动、缩放、取消、恢复页、背景点透、视口限制行为测试，确认 RED。
- [x] 实现 44px 标题栏、恢复/关闭、缩放把手、首次提示与独立播放页；runtime compact 模式保留进度/播放/全屏，禁用画面拖动手势与嗅探 FAB。
- [x] 实现安全区/visualViewport 监听和窗口尺寸重限，位置尺寸跨全屏保留；CSS 遵循墨水屏和减少动效。
- [x] 运行新测试、WebView CSS 兼容和视频手势回归，确认 GREEN。

### Task 4: 全屏、后台和原生协调

**Files:** `src/components/InkVideoPlayer.tsx`；`src/features/floatingVideo/`；`src/features/mediaSniffer/native.ts`；`src/components/OriginPlayerSurface.tsx`；必要的 Android 媒体桥接实现；新增原生协调行为测试。

**Interfaces:** 复用 hardwareBackStack；native live 可见性按 session ID 和全局租约协调，串流按播放会话隔离。

- [x] 写全屏往返、返回键、关闭竞态、后台暂停不续播、第二播放器焦点、原生可见性与鉴权隔离测试，确认 RED。
- [x] 串行化全屏操作并检查 mounted/generation；Host 提供全局返回处理，普通小窗不消费返回；后台暂停/退出全屏。
- [x] live surface 全局抑制与来源页提示；恢复只针对存活 session；保证新页面准备不覆盖旧播放会话上下文，释放不影响其他会话。
- [x] 运行新增测试和原站、全屏、返回键、DLNA、Wi-Fi 回归，确认 GREEN。

### Task 5: 验收与文档

**Files:** `package.json`；`docs/architecture.md`；`docs/user-guide.md`；`AGENTS.md`；设计与计划状态。

- [x] 为新增测试增加项目脚本，更新架构所有权、用户操作和项目入口映射。
- [x] 运行规格列出的回归、lint、build；记录每项实际结果，不通过的检查定位原因。
- [x] 按用户要求使用 ADB 操作模拟器，以可控本地媒体验收；Web DOM 全屏由行为回归检查。
- [x] 依据 executing-plans 技能进行一次独立审查，复现并修复重要问题，再运行相关验证。
- [x] 保存改动供用户审查，不推送或发布；总结已完成、已验证与未验证事项。

## 验收记录（2026-10-10）

- 新增 `test:floating-video`：会话、几何、真实 React / StrictMode 生命周期和触摸 / 键盘行为通过。覆盖母页卸载、同一 video 与引擎 load 次数、进度 / 倍速、窗口位置尺寸、双指 / 取消、资源页、后台自动续播阻止、延迟进入 / 旋转 / 旧会话退出、DOM 全屏宿主与无障碍祖先。
- 相关回归：ink-video-lifecycle、ink-video-live-updates（19 项）、native-fullscreen、origin-player-live-sniff、hardware-back、dlna-cast、wifi-media、video-gestures、inline-video 全部通过。
- Android：PlaybackSessionTest（3 项）、LiveSurfaceSessionTest（1 项）、LocalStreamProxyTest（1 项）、OriginHeaderStoreTest（7 项）通过。Cloud debug APK 构建成功。
- lint 与生产 Web build 通过；保留仓库既有 lint 警告、bundle 大小提示与 Gradle 弃用提示。无新增生产依赖。
- ADB：emulator-5554 独立验收包使用生产组件，Progressive / HLS / DASH 本地流实际播放；跨新闻 / 设置页面卸载母页、拖动、角落缩放、横屏全屏与返回、独立页恢复、后台暂停不续播和关闭通过。ADB 转发下读取 video 身份 / 时间辅助确认，交互由 adb input 完成。发现并修复 DASH 内部会话标识引起的预检失败。
- 独立审查发现的旋转关闭竞态、DOM 全屏祖先迁移、其他播放器 FAB 遮挡与原生销毁顺序均已修复，并增加行为回归。
- 测试包已卸载，模拟器旋转设置恢复，临时入口和媒体删除；正式配置关闭 WebView 调试，无验收素材进入最终 APK。原 NewsNook 应用数据保留。
- 未验证：实体设备 / 不同系统 WebView、真实上游鉴权站点、真实浏览器 top layer 行为与电视投屏硬件。本次不推送、不发版，工作区改动保留供审查。

