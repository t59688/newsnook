# 视频识别回归修复实施计划

> **For agentic workers:** Use superpowers:executing-plans; each task follows failing behavior test, implementation, verification.

**Goal:** 修复自动嗅探无结果、辅助入口延迟、播放线路混入推荐、视频页退化为图片的问题，并在现有 feature/media-sniffer-production-v2 分支推送。
**Architecture:** 分离内容条目与播放控制；直接配置提取优先，运行时监听连续回传，辅助操作即时可用。普通浏览器保持被动观察。复用现有播放器及鉴权传输，不引入站点域名特例或新依赖。
**Tech Stack:** TypeScript / React / linkedom / Capacitor / Android WebView / JUnit.
**Spec:** 用户本轮反馈及已审核的媒体嗅探设计；本次聚焦已报告的实际回归。

## Global Constraints
- 不切换分支，不覆盖用户改动，不合并 beta，不发版。
- 普通浏览器不自动点击、不改变导航、隐私和播放行为。
- Android 9 / WebView 69 兼容；JavaScript 注入不得依赖其不支持的语法。
- 不启动整集下载，不扫描推荐视频，不混合剧集，不泄露 Cookie/签名 URL。
- 不对现有有数据的设备运行卸载、清数据或 connectedAndroidTest。
- 每项行为先补可失败的测试，不以源码正则匹配代替运行行为验收。

## Review Focus
- 同页播放器配置已给 URL，但媒体请求尚未发出：应可直接识别。
- 动态 iframe/Fetch/MSE：DOM 观察必须传回客户端，不只监听网络 URL。
- 缩略图锚点/播放器封面/图片链接与真正的视频详情链接不能混淆。
- 相同 URL 的异步更新、离页和重试不能回灌旧状态或打断已选视频。
- 分离音轨的 HLS 和 DASH Representation 不能当作独立完整播放地址。

## Tasks
- [x] 原生链路：补运行时脚本和生命周期测试；修复 JS 观察回传、受控主动触发、辅助模式和浏览器隔离。
- [x] 内容语义：复现线路被当推荐及图片地址被当详情；共享播放控制判定，保留真正相关内容与图文稿。
- [x] 静态与调度：复现 CMS 对象、编码 URL、播放器配置与预算问题；提取当前播放上下文，确保取消和分级证据。
- [x] 阅读器接线：立即提供辅助入口，补漏判视频的恢复，不阻塞自动识别、不创建重复表面。
- [x] 验收：运行 media/browser/catalog/resolveBody 回归、生产构建及双变体原生编译/单测，审查差异；交付只推送当前功能分支，不合并或发版。


## Implementation and evidence

Base: `29b8fd5bb8107a6bc9caeec19b232290a2deaecb` on
`feature/media-sniffer-production-v2`.

### Root causes addressed

- The long-lived origin WebView installed the JavaScript probe but only forwarded native network observations. The live collector now drains DOM/config/fetch/XHR/MSE observations, publishes semantic metadata changes, and rejects stale session/document results.
- The injected Java text block contained optional chaining and `String.matchAll`, incompatible with the minimum WebView target. Tests decode and execute the actual shipped probe, not a second test-only implementation.
- Persistent payload WeakSets suppressed asynchronous updates of an existing player configuration. Scans now use bounded per-scan traversal; arbitrary recommendation/next-episode script literals are not treated as current-player evidence.
- The manual-assistance action was gated behind an eight-second timeout and hidden in embedded layouts. It is now present immediately, reuses the live WebView, and becomes actionable when the native surface is ready. Automatic discovery continues independently.
- Catalog extraction admitted playback controls and poster-file anchors as content. Admission now distinguishes content documents, controls and assets before clustering and at materialization. Current-episode identity prevents probing the next episode as a fallback line.
- Hyphenated video document paths such as `video-123.htm` lost video identity. Shared URL evidence, local cache migration, Reader cache bypass and primary-player detection prevent stale image-only extraction from replacing the player. Prose-heavy articles and genuine photo content are retained.
- Descriptor round-tripping flattened DASH representations and HLS external-audio variants into incorrect standalone URLs. Resource metadata is merged directly, with safe HLS-only expansion and stable selected playback.
- Advertising/tracking frames could consume all of the runtime budget. They are filtered before planning; current-player evidence is prioritized, fallback targets receive bounded shares, and the already-live page is not reopened by finite discovery.
- Finite cancellation now releases its owned WebView and listeners; live polling suspends on activity pause and source handoff and resumes without duplicate collectors.

### Review findings resolved

Independent read-only review identified two concrete P2 conditions. Navigation now emits a dedicated `mediaDocument` event before the next media result, so old candidates are cleared even if the new page never exposes media. Owned navigation permits same-registrable-site canonical/mobile aliases while still rejecting unrelated redirects and external-app schemes. Both conditions have regression coverage.

### Final verification

All commands below completed with exit code zero against the final implementation:

- `npm run test:media-sniffer`: existing media suite, 19 root-regression cases, 3 native-session lifecycle cases, and executable injected-script checks.
- `npm run test:video-player`: complete existing video aggregate, including 27 live-update cases and immediate/embedded assistance coverage.
- `npm run test:browser`: existing browser, privacy/bookmarks, userscripts, image and browser-agent regression suites.
- `npm run test:site-catalog`, `test:resolve-body-custom`, `test:feed-body-general`, `test:resolve-body-blocked`, `test:rss-video-feed`.
- `npm run build`: TypeScript and production Vite build.
- `npm run lint`: no errors; warnings remain in unchanged files, none in the changed production files.
- `:app:compileCloudDebugJavaWithJavac` and `:app:compileLocalDebugJavaWithJavac`.
- `:app:testCloudDebugUnitTest`: 282 tests across 46 suites, zero failures/errors/skips.
- `git diff --check`.

`BrowserHostPlugin`, `BrowserMediaCapture` and `src/features/browser` were not modified. The shared probe is covered by passive-mode assertions: no automatic playback, muting, arbitrary clicks or navigation in ordinary browser mode.

### External validation boundary

The reported site's accessible listing confirmed the hyphenated video-document template. Its sampled detail request returned HTTP 403; the supplied qiyunzl detail returned HTTP 502. The parser, UI, native callback lifecycle and navigation changes are covered by reproducible fixtures and automated tests, but these responses do not establish successful real-device end-to-end playback of those two sites. No device installation, data clearing, permission bypass, release or beta merge was performed.
