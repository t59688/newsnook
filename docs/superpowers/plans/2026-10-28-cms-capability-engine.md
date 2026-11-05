# CMS Capability Engine Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; every task uses a failing regression before implementation.

**Goal:** 在当前分支交付基于实际页面证据的通用 CMS 能力识别与可执行 UI。
**Architecture:** 保留原有导航/内容/HTTP边界，添加响应级 capabilities；HTML链接、表单和渲染快照进入同一算法；身份适配器只提供字段先验，不生成未观察的端点。
**Tech Stack:** TypeScript/React/linkedom，Capacitor/Android Java，现有 Node 与 Robolectric 测试。
**Spec:** `docs/superpowers/specs/2026-10-28-cms-capability-engine.md`

## Global Constraints
- 在 `feature/media-sniffer-production-v2`，基线 `cbc20e1`；保持现有生产依赖、存储/同步协议及浏览器行为。
- Android 9 / WebView 69；用户模拟器不卸载、不清数据，更新前备份。
- 任何上游请求必须来自已观察的链接/表单；复杂 JS 控件没有可执行证据时明确保留浏览器回退。

## Review Focus
- 年份等数字选项不得变成分页；筛选容器不得覆盖真实内容或站点导航。
- 同名多值字段、外部关联控件、disabled fieldset、form action query和POST方法必须保真。
- 密码/文件/登录/修改动作与敏感动态字段不得成为无感知的表单重放或持久化配置。
- 相同 URL 的不同 POST 不得被当成分页循环；失败/取消/快速切换保留正确选中态。
- 已识别 CMS 的混合图文/人物/视频不能被引擎默认类型错误覆盖；动态快照不能改变普通浏览器策略。

## Task 1: 可执行能力模型与通用静态推断
**Files:** `siteCatalog/{types,capabilities,requests,service,navigation,pagination}.ts`; new `siteCatalog/abilities/{types,semantics,forms,linkControls,discover}.ts`; tests `scripts/catalog-capability-engine.test.ts`.
**Interfaces:** `discoverPageCapabilities(document, pageUrl, baseUrl, engine, request)` 返回响应级 `CatalogCapabilities`；`CatalogChoice.request` 为真实GET/POST；`catalogSearchRequest`复用表单请求生成。
- [x] 写并运行失败测试：年份与地区分组/组合、path链接保真、select/radio/multiple、字段和控件禁用、搜索保留其他选择、危险表单负例、随机类名负例。
- [x] 实现无域名分支的语义注册表、最小分组、成功控件和请求生成；兼容profile只保留安全投影。
- [x] 同步导航/内容排除边界，建立未发现/需浏览器的证据状态。
- [x] `npm run test:cms-capabilities`、原 `test:site-catalog` 通过。

## Task 2: 会话、内容与全部已知引擎契约
**Files:** `siteCatalog/session.ts`, `catalogEngine/{types,toArticles,extractors/domCards,extractors/jsonLd}.ts`; tests `catalog-capability-session.test.ts`, `catalog-capability-matrix.test.ts`.
- [x] 失败测试：POST页身份/重试/取消；排行名次、人物与图文；现有FrameworkId逐一进入相同发现管线，无能力凭空出现。
- [x] 会话使用完整请求身份；只按真实下一页动作执行；保留有效内容类型证据和排行元数据。
- [x] 使用多种真实结构原型/变形夹具验证未知主题，而非只更换generator。
- [x] 原目录/正文/框架/同步相关回归全部通过。

## Task 3: 动态目录只读快照
**Files:** `siteCatalog/{renderedPage,service,session}.ts`; `android/.../CatalogSnapshotPlugin.java`, MainActivity registration; native tests.
- [x] 失败测试：动态回退条件、取消、超时、HTTP失败和验证码不自动重试绕过、旧壳缺插件可降级。
- [x] 在独立受限WebView读取当前DOM；不自动点控件、不播放、不下载、不改BrowserHost；每次请求可取消且有总预算。
- [x] UI目录动态壳才触发，普通RSS/后台预存默认静态；快照回到同一解析器。
- [x] 原生单测、Cloud/Local编译与生命周期回归通过。

## Task 4: 产品UI、审查与交付
**Files:** `SiteScreen.tsx`, new scoped controls component, `scripts/site-capability-ui.test.tsx`, docs.
- [x] 真实React流程失败测试：选择年份/地区/排序、多选、搜索、失败重试、快速切换、清理上下文。
- [x] UI仅消费能力请求；保留现有主题与导航，不用系统选择器；忙碌与选中态由最后成功响应驱动。
- [x] 完成全部相关测试、lint、生产构建、Android构建；可用模拟器备份后覆盖安装验证。
- [x] 独立只读代码审查，重要发现补红绿回归；记录未覆盖范围，提交并推送原分支，不合并不发版。

执行记录保存在 `node_modules/.cache/cms-capability-engine/progress.md`（不入库）。


## Completion evidence

- Red/green regressions and 19-identity capability matrix complete. Final Node targeted suites contain 69 test cases plus real React UI flow; existing cache-runtime test adds v3-to-v4 offline metadata repair without changing IDs/time.
- Independent read-only reviews found 6 Important defects. Each was reproduced by a failing test and fixed; review logs and final verification are retained in the ignored task directory.
- Complete related CMS/catalog/framework/content/browser/player/startup/shared-contract suites, lint, and production build exit 0. Native Cloud/Local full suites: 291 / 293 tests, 0 failures/errors/skips.
- Final installed APK was backed up and replaced with `adb install -r`. Native dynamic/redirect/cancel/timeout/cleanup acceptance and production SiteScreen real-click POST combination tests passed three consecutive runs. 412px/360px viewport checks show no horizontal overflow.
- Online qiyunzl four-route attempts returned connection closed. This is recorded as unverified online behavior, not converted into a passing test or a domain-specific workaround.
- Scope decision: catalog-v4 is a marker-only lossless migration; persistent Article/Profile/cloud contracts, cache keys, reads/bookmarks and timestamps are unchanged.
- Integration decision already authorized by user: push the current feature branch; do not merge beta or publish a release.
