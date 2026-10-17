# Browser Privacy and Images Implementation Plan

**Goal:** 完成浏览器隐私会话、常用设置、独立看图与统一交互。
**Architecture:** 原生隔离会话承载相同 BrowserWorkspace；原生设置与图片捕获有显式契约；React 会话 hook 处理生命周期，面板只管理显示与交互。
**Tech Stack:** React 19、TypeScript、Capacitor 8、Android System WebView、AndroidX WebKit 1.17.1。
**Spec:** ../specs/2026-10-17-browser-privacy-images-design.md

## 全局约束

从 6a9ab5f 建立 feat/browser-privacy-images-20261017；无新生产依赖；不更换内核、不改版本。所有用户数据修改受隐私边界约束。使用现有主题、控件与测试习惯。

## 审查重点

- 主壳/网页 renderer 崩溃、进程异常终止后不能恢复或残留私密地址。
- 迟到导航、扫描、图片请求和关闭不能复活已退出会话或覆盖新文档。
- 原生与React设置保存失败不分裂，UA切换正确恢复，首页和新建标签同样应用设置。
- 网易防盗链、srcset/lazy/background、blob/data及大量图片受预算保护。
- 320px、明暗/自定义主题、安全区、键盘、返回键和深层确认不遮挡网页或逃逸焦点。

## 工作项

- [x] 拉取远端确认最新功能分支，建立独立工作区，读取现有架构与第三方参考。
- [x] 基线 browser-workspace 测试 3 轮通过（Windows Node 26.8.2）。
- [x] 原生：独立 private 进程/目录与清理、GM 内存、真实上下文、UA/settings/find/site-data、图片 Host 接线。
- [x] 图片：BrowserImageCapture、扫描 asset、browserImages 模型、BrowserImagesPanel 与现有灯箱扩展、针对性测试。
- [x] UI：BrowserPreferences 归一化与持久化、设置与共享页面细节、隐私呈现、针对性测试。
- [x] 主集成：PrivateBrowserRoot 入口、useBrowserSession 协议和代次取消、BrowserWorkspace 菜单/查找/分享/图片/隐私边界。
- [x] 红绿验证隐私历史零写、原生隐私隔离、设置和图片关键行为。
- [x] 已完成一轮正式前端入口、类型/lint、原生单元测试和隔离 Debug 构建；12:44 功能实施原生批次 160 tests / 0 failures / 0 errors / 0 skipped，站点清理套件为 14 项（9 项生命周期 + 5 项应用壳保护）。
- [x] 完成 44 个明暗/宽度视觉状态，以及 3 个非零安全区状态；修复选中卡片、字体、窄屏尺寸、私密标识、确认时序及安全区问题。
- [x] Android 17 模拟器验证私密正常关闭、强制停止后再次启动清理、普通数据保持，以及网易 72/67 图片、320×240 WebP 和 2/67 灯箱切图。
- [x] 独立审查与实际问题修正；保存中文验收记录 `../reports/2026-10-17-browser-product-validation.md`。
- [x] 补充浏览器灯箱的系统栏主题作用域和主图加载前调整禁用；目标红绿测试及前端构建通过。
- [x] 针对最终灯箱补丁和站点清理壳保护重新完成正式入口、修改范围 lint 与完整原生门禁：12:44 前端入口通过，31 个 JS/TS 文件零警告，全仓原生 160 项通过；隔离 APK 构建通过。
- [x] 最终隔离调试包查看器设备复验：light 主题保持，进入白色状态栏图标、退出恢复黑色；2/68、330×248 主图、调整面板与关闭后 12 个可见缩略图恢复。切图 click 后未等 React 提交的瞬时 disabled 读数不作为成败依据。
- [x] 最终包真实多标签站点清理通过：127.0.0.1 的 A/B 旧实例退役，B 重载请求无旧 Cookie、localStorage/IndexedDB prior 为 null；localhost 的 C 保持，A 重新激活为新实例。证据为 device-site-clear.json。
- [x] 私密分享正式 audit 包完整设备验收通过：私密 CDP 关闭，真实点击分享与键盘焦点陷阱确认，系统 chooser 打开、取消、分层返回、私密退出清理及普通进程保持。独立 Android DOM/可访问性树诊断与早期失败尝试分别留证。
- [x] 归档 Android 17 x86_64 / 16KB / WebView 150 主进程 onTrimMemory SIGILL 的当前分支与准确 6a9ab5f 基线对照：当前 ordinary-only 在 BACKGROUND、基线在 COMPLETE 复现相同顶部 PC/BuildId；私密新增不是必要条件，根因仍未定位、未修复。
- [x] 完成 CI 暴露的既有问题修正：Cloud 源 ID 完整覆盖断言及 WORLD 21；Video 独立注册顺序与 exact 优先。新增排序 4 项有效 RED 后，21 项目标及 164 项完整原生回归通过，Local Debug Java 编译成功；JS/TS 修改范围 32 文件分批检查无诊断。
- [x] 完成最终分支、差异、证据与交付材料核对；本轮功能设备验收完成，PR #80 保持 Draft 供审阅，基线崩溃未定因及旧设备覆盖限制保留。
- [x] 代码随此实施计划提交至独立功能分支。

## 接口与分工

- root：main.tsx、PrivateBrowserRoot、browserPrivacy、useBrowserSession、BrowserWorkspace、BrowserFindBar、workspace测试和集成验证。
- privacy_research：BrowserHostPlugin、UserscriptRuntime、MainActivity、私密进程/生命周期类、manifest、原生测试。
- browser_images：图片helper/asset/模型/面板、ImageLightbox向后兼容扩展和图片测试。
- browser_ui：browserPreferences、Settings/Start/Search/Tabs/Places/Primitives、browser.css和对应测试。

## 过程记录

- 2026-10-17：原工作区存在生成的 capacitor.settings.gradle 路径改动，不迁移、不覆盖。
- 2026-10-17：WSL Node 无法使用现有 Windows esbuild，改用已安装 Windows Node 26.8.2；不修改共享node_modules。
- 2026-10-17：系统WebView无纯内存 profile，使用独立进程/目录及清理边界，明确不承诺物理零写入。
- 2026-10-17：12:36 原生批次为 155 项；补充壳站点保护后，12:44 完整原生批次为 160 项，全通过。正式前端和 31 文件修改范围 lint 于 12:44:28.521–12:44:35.121 UTC 全通过。
- 2026-10-17：最终设备包 SHA-256 为 b54ee814b45790bb0d968b47f9aab63c853cfb97f318ae176a95588df702d939。主集成已审查 device-viewer-final/close JSON 与 PNG，并于 12:49:51–12:49:56 UTC 完成多标签站点清理通过轮；私密分享后于 13:27 正式包完整轮通过，详见后续记录。
- 2026-10-17：强制停止私密会话的首次 CDP 取证遇到 execution context destroyed，原始输出和重试事实保留；重试后的目录清理、普通数据与私密网址检查通过。
- 2026-10-17：实际运行环境为 Android 17 x86_64 / 16KB / WebView 150 模拟器。API 28 AVD 系统镜像缺失，未能启动；本轮没有实体机或 API 28 运行验收。主进程 onTrimMemory SIGILL 根因尚未定位，未声称修复。12:43:56 UTC 起普通进程在 privatePid 为空时接受内存回调，RUNNING_LOW/CRITICAL 存活、BACKGROUND 触发 SIGILL；证据为 device-ordinary-trim.json 与 device-ordinary-trim-crash.log。
- 2026-10-17：准确基线 6a9ab5f 包 SHA-256 为 fc40c82acc97d7040374a6b2bb210a8249f333d2ca1d1503e962f6b41cfe5097；同环境 baselineaudit PID26359 / UID10241 在 RUNNING_LOW/CRITICAL/BACKGROUND 后存活，COMPLETE 时于 13:10:25.890 触发 SIGILL/code2，顶部 PC0x7827733/0x7828673 与 BuildId68328f9a49348833c7ebe4e41849dca6c2462e4f 相同。仅确认相同崩溃签名在基线也存在，不声称触发级别或全部栈帧一致。
- 2026-10-17：基线崩溃归因使用后来补取 device-baseline-trim-crash.log 中真实 PID26359 的段落；device-baseline-trim.json 的 crashLog 混入旧 PID25866，不作为归因证据。
- 2026-10-17：私密分享早先三轮保留原失败结果：13:11 slow UI 轮等待“继续分享”超时且收尾普通 PID 已空；13:13 首页 8 秒等待超时，后续快照已出现首页；13:15 轮到达分享菜单后等待确认节点超时，普通 28269 / 私密 28706 均存活。分别归档为 device-private-share-slow-ui-attempt.json、device-private-share-home-readiness-attempt.json、device-private-share-ax-timeout-attempt.json；另保留两份更早的驱动准备失败记录。
- 2026-10-17：13:21 桌面独立组件的 Input.dispatchTouchEvent 分享确认诊断通过，证据为 browser-private-share-touch.json 与 before/after PNG；不覆盖完整 Workspace/FullPage 或 Android 宿主。原 44 状态矩阵使用 focus() + DOM click()，私密导出覆盖保存确认与取消，不替代设备触控。
- 2026-10-17：13:24:53.482–13:25:47.693 独立 Android diagnostic 包通过真实点击、确认 DOM/可访问性树读取、chooser、取消、退出清理。确认 visible、z-index 90，AX“继续分享”未被忽略，同刻 UiAutomator 只返回 WebView 无子节点，证明可能遗漏已显示确认。该包开启私密 CDP，单独记录于 device-private-share-diagnostic.json，不与正式 audit 包混同。
- 2026-10-17：最终 device-private-share.json 为 13:27:14.500–13:28:42.210 的正式 audit 包通过轮，SHA 仍为 b54ee814b45790bb0d968b47f9aab63c853cfb97f318ae176a95588df702d939，私密 CDP 关闭。真实 adb 点击分享后，通过已验证焦点陷阱的 Tab → Tab → Enter 确认；13:28:15.116 打开系统 ChooserActivityLauncher，13:28:20.694 取消，6 次分层 Back 后私密 PID 30723 消失、ownedAfter 为空，普通 PID 30434 保持。previewNodes 只证明预览容器存在，未向任何外部目标发送。
- 2026-10-17：实现提交 24ec7b9 已推送，浏览器 CI [39036507402](https://github.com/t59688/newsnook/actions/runs/39036507402) 于 13:29:43 UTC 完整成功并产出 APK；PR #80 保持 Draft 供审阅。最终提交的远端状态以 [PR #80 Checks](https://github.com/t59688/newsnook/pull/80/checks) 为准。
- 2026-10-17：Cloud 既有 b628dec0f45759f82dfc05386bf885eb76ce3122 移除 cna-intl-zh，使非工作区源由 153 变为 152；修正 layout-presets 测试为 ID 完整覆盖与唯一性，WORLD 数量为 21。13:33:08.106 UTC 开始的 test:layout-presets、test:custom-sources、test:webview-css-compat 均通过，证据为 D:/tmp/newsnook-cloud-regression.log/.exit。原 31 文件 lint 加新增 layout-presets 单项无诊断，合计 32 文件，保留分批口径。
- 2026-10-17：Video 旧选择竞态以独立注册序号和 exact 优先修正，旧上下文读取/续租不改注册顺序，显式重注册更新顺序。新增 4 项于 13:36 得到有效 RED；13:37:04.794–13:37:13.677 的 21 项目标 GREEN；13:37:52.885–13:38:20.138 完整 164 项零失败/错误/跳过及 Local Debug Java 编译通过，退出码 0。证据为 native-playback-order-verification.json 与 red/green/full 日志、退出码及新增测试 XML。
- 2026-10-17：12:44 的 160 项 / 31 文件及 24ec7b9 / b54ee814… 设备流程保留为功能实施批次；最后原生排序补丁未重新跑全部设备流程，其验证依据为追加 164 项回归与 Local Java 编译。基线 SIGILL 未定位、API 28 与实体机覆盖限制继续保留。
