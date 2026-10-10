# CMS Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为常用 CMS 和未知引擎站点提供统一、可验证、兼容旧订阅的目录、分类、搜索、分页与站内阅读能力。

**Architecture:** 用 `siteCatalog` 门面整合页面上下文、能力发现、请求计划与会话。保留 frameworkDetect/catalogEngine 入口，复用现有 HTTP、linkedom、正文与媒体模块；UI 不自行推测上游 URL。

**Tech Stack:** React 19、TypeScript、linkedom、现有 HTTP/Feed/Readability 与 tsx 测试脚本；无新增生产依赖。

**Spec:** `docs/superpowers/specs/2026-10-09-cms-catalog-architecture-review.md`

## Global Constraints

- 核心阅读本地优先、登录可选、正文在应用内阅读；不上云解析或缓存。
- sourceId 和 Article URL 哈希规则保持稳定。
- 用户文案与文档中文；生产日志使用 log.catalog。
- 不动 Android cloud/local 翻译边界。
- 每页默认最多 200 条；探测最多四请求、并发二、25 秒、响应 2 MiB。
- 请求取消和过期响应隔离适用于所有浏览入口。
- 保留现有测试命令，不提交用户的 test_xiangguys.html。

## Review Focus

- 明确 CMS 标识与共享模板冲突：必须采用身份信号或降级，不按函数顺序误判。
- 单条搜索结果与详情页：单条结果可展示，详情文章不可误作目录。
- 不同页面的相对链接、子目录与跳转：使用当前上游页上下文。
- 站点/分类/搜索快速切换：旧响应不可覆盖新会话。
- 旧配置与同步导入：无效能力降级，来源及阅读身份不丢失。

## Task 1: 回归样本与目录解析

Files: `scripts/site-catalog.test.ts`、`catalogEngine/{types,engine,toArticles,normalize}.ts`、`extractors/{jsonLd,domCards}.ts`。

Interfaces: `extractCatalog(html, pageUrl, options): CatalogExtractionResult`；`catalogHtmlToArticles(source, html, fetchedAt, pageUrl?): Article[]` 保持前三参数兼容。

- [x] 先加入 slug、单条搜索、路径大小写、无图文章、分离封面、当前页 base 与混合类型断言；运行看到失败。
- [x] 增加 DOM 卡片抽取与上限/截断，保留 JSON-LD 和旧启发式回退；修正内容类型与 URL 去重。
- [x] 跑新增测试与 `test:catalog-engine`，核对保留的兼容预期。

## Task 2: 引擎识别与能力发现

Files: `frameworkDetect/{detect,types}.ts`、`siteCatalog/{types,context,detection,capabilities,requests}.ts`。

Interfaces: `discoverCatalogProfile(html, pageUrl): CatalogProfile`；`catalogRequest(profile, state): CatalogRequest | null`；`CatalogRequest` 支持 GET/POST。

- [x] 先写身份冲突、属性乱序、飞飞 Public/Tpl、自定义分类、表单 GET/POST、offset 步长和禁用末页测试，确认失败。
- [x] 用注册的引擎证据加权比较，覆盖既有 CMS 与 Dede/帝国/Pboot/易优/Typecho/Z-Blog/Drupal/Joomla；共享模板不作为独立身份。
- [x] 从 DOM 提取分类、实际分页、搜索/排序/筛选链接；没有证据的能力不构造请求。
- [x] 校验当前 URL、合法 base 和请求参数；跑 `test:framework-detect` 与新增矩阵。

## Task 3: 统一服务与纯会话

Files: `siteCatalog/{service,session,useCatalogSession}.ts`、必要的 HTTP 元信息 helper。

Interfaces: `loadCatalogPage(source, request, signal): Promise<CatalogPage>`；纯 session 保存访问页和稳定去重；React hook 只接线请求与状态。

- [x] 先写下一页首屏记录、循环页、重复内容、错误保留列表、慢请求过期、取消与响应预算测试，确认失败。
- [x] 同一管线读取响应、判定页面类型、解析、映射真实来源、发现当前页能力。
- [x] 记录有证据的 page links/next URL；未知总页数仅上一/下一页；错误可重试。
- [x] 旧纯文本 HTTP 入口兼容；无法取得上游 final URL 时明确使用请求 URL，不用代理地址。
- [x] 跑服务与会话测试。

## Task 4: 配置保存、兼容与探测

Files: `siteCatalog/profile.ts`、registry model、preferences、customSources、sync projection/merge、contracts sync、CustomSourcesScreen。

Interfaces: 可选 `catalogProfile` version 1；`normalizeCatalogProfile(input, pageUrl): CatalogProfile | undefined`；旧 FrameworkHint 转换为运行配置。

- [x] 先写旧 hint/no hint、新配置、未知版本、备份同步往返、重新探测与编辑 URL 的测试。
- [x] 添加受限配置序列化与归一化；维护 sourceId；重新探测保存；探测失败不抹掉旧有效配置。
- [x] 添加探测门面与最多四请求预算；不盲扫端点；Feed 与目录均可发现。
- [x] 跑 custom-sources、sync projection、contracts、相关 UI 测试。

## Task 5: 接通所有运行入口

Files: SiteScreen、FeedScreen、App、useFeeds、sourceArticles、registry paging、prestore sourceWindow。

- [x] 先写 UI/运行集成测试：next-link 真换页，未知引擎可浏览，搜索/分类保留 sourceId，切站不串结果，错误不伪装空列表。
- [x] SiteScreen/FeedScreen 共用 hook 和页面能力；取消重复 URL 构造、假总页数与临时来源。
- [x] useFeeds 与预存接同一页面解析/分页请求逻辑；首屏存 next URL，去重无新增与循环时终止。
- [x] 跑 paging/prestore/CMS UI/相关 runtime 测试。

## Task 6: 详情字段、规则矩阵与验证

Files: catalogEngine/detailMeta、framework adapters、resolveBody 接线、引擎 fixtures、新测试、docs/architecture、user-guide、AGENTS。

- [x] 先写品牌 h1、结构化详情、CMS 简介与正文、媒体线索及旧阅读状态测试。
- [x] 拆分通用元信息与引擎/主题线索；保留现有播放器/媒体发现分集能力，接入可验证线索。
- [x] 确认每个支持引擎的正例、变体、冲突和负例；记录仅通用解析/不具备的能力。
- [x] 运行新增测试、所有受影响 test:*、lint、build；进行香菇影视公开页 smoke。
- [x] 更新中文文档、执行记录；完成一次独立代码审查，修复重要问题并再次验证。

## 执行记录

- 2026-10-09：用户已审阅架构方案并要求按生产级标准开发；在当前会话执行。工作区基线除方案与用户现有 HTML 样本外无其他改动。
- Ruling：不自动提交或推送；按任务保留测试证据与可审阅工作区改动，避免把未授权用户文件混入提交。

- 2026-10-10：六项任务完成。实际公开请求接口为 `catalogSearchRequest` / `CatalogRequest`；HTTP 复用可选 `onResponse` 元信息，不增加生产依赖。
- 规则验证分层：17 个身份 × 两种 generator 变体与负例，加既有影视主题和 Typecho / Joomla / Drupal Views / DedeCMS 官方结构样本；不把身份覆盖等同于所有商业模板已验证。详见 `docs/cms-catalog.md`。
- 独立审查与复核已执行；修复分页重试、刷新保留历史、重复表单字段、POST 重定向、未来配置保留、混合 CMS 类型迁移、分页导航分类、canonical 详情、相关阅读排除与导入边界问题。对应用例先失败再通过。
- 兼容裁定：旧目录缓存就地修正元信息，不清空离线条目；保留原缓存时间、来源 ID 和 URL-hash Article ID。新版可选配置字段、列表版本与 nextUrl 在文档中说明；正文缓存、已读、稍后读与阅读位置不迁移。
- 验证通过：`test:site-catalog`（12 个测试文件）；`test:framework-detect`、`test:catalog-engine`、`test:custom-sources`、`test:feed-pagination`、`test:prestore`、`test:cache`、`test:feed-status`、`test:feed-payload`、`test:cms-switcher-ui`、`test:sync-projection`、`test:cloud-contracts`、`test:config-backup`、`test:resolve-body`、`test:resolve-body-custom`、`test:resolve-body-blocked`、`test:media-sniffer`、`test:native-http`、`test:cf-proxy`、`test:proxy`、`test:webview-runtime-compat`。
- 缓存测试原环境缺少浏览器空闲调度器；补充独立测试环境 helper，原断言全部保留，生产调度代码不变。
- 实站 smoke：香菇影视识别为飞飞 CMS；首页 54 条、9 栏目，实际 GET 搜索 6 条；动作栏目 hjs1 / hjs2 各 42 条且下一页有新条目，来源身份保持一致。不推断精确 CMS 版本。
- `lint` 无错误，保留既有告警；`build` 成功，仍有既有大分块提示。未运行 Android 真机或云端数据库集成测试，本次验证原生传输通过桥接 mock，云端仅共享契约新增可选字段。
- 共享边界：URL 构造器拆为无 DOM 的 pageUrl 模块，保留旧导出；registry 的 Node/边缘转发入口不加载客户端解析器，新增依赖边界回归。
