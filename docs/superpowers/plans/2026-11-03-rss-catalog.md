# RSS 目录实现计划

**Goal:** 本地即时发现 RSS，并手动发布 R2 目录更新。
**Architecture:** 纯校验与搜索 → IndexedDB/更新服务 → 独立目录视图 → 现有订阅详情。
**Tech Stack:** React 19、TypeScript、IndexedDB、Node、AWS CLI；不加依赖。
**Spec:** `docs/superpowers/specs/2026-11-03-rss-catalog-design.md`

## 约束与审查重点

保持本地优先、中文文案、已有订阅与存储契约。审查损坏缓存、更新失败、并发检查、跨域快照及关键词泄露。R2 读取只限固定目录，不执行远端代码；历史快照保留不清理。

## 任务

- [x] 1. `src/features/rssCatalog/schema.ts`、`search.ts`：严格契约、排名与筛选；先写 `scripts/rss-catalog.test.ts`，执行失败再实现。
- [x] 2. `storage.ts`、`service.ts`：种子/缓存、去重请求、节流、限流读取与校验后持久化；注入存储与 fetch 验证失败保留旧版及重试。
- [x] 3. `RssCatalogBrowser.tsx` 与 `FeedStoreScreen.tsx`：第三种发现模式，独立搜索、筛选、分页、重复标记、复用详情；现有 Feedly/网址测试回归。
- [x] 4. `scripts/rss-catalog-release.ts` 与 `.github/workflows/rss-catalog-publish.yml`：确定性生成、读回校验、manifest 最后发布；通过注入上传器验证发布顺序。
- [x] 5. 接入原始目录附件、更新架构文档与 AGENTS 入口；运行目录测试、发现测试、lint、build、浏览器视觉检查及代码审查。

用户已明确授权按照设计历史直接开始，在当前 beta 内执行；不新建工作树，不自动提交或推送。

## 验证与剩余事项

- 新增目录契约、搜索、更新生命周期、UI、商店预览/订阅集成、空闲维护、发布顺序测试通过；原有 `test:feed-discovery` 回归通过。
- 浏览器模拟 R2 更新验证真实 IndexedDB 写入，断网下新实例读回缓存、输入关键词零远端检索；390px 手机与 768px 墨水屏视口无横向溢出。视觉检查使用临时独立入口，测试后已删除。
- 独立代码审查发现正式入口默认模式偏差，已增加失败回归测试并修正为默认目录；预填关键词/网址保持原行为。
- 原始 3,493 条 JSON 已由用户提供并归档到 `data/rss-catalog/upstream.json`，导入脚本无损保留记录数量/ID/URL/语言，生成 61 个中文专题的精简种子；完整数据检查通过。语言筛选已替换为应用现有主题弹窗。
- 已完成真实 R2 首发、CORS 配置、追加新源发布与模拟器完整下载/落盘/离线冷启动验收，详见 `docs/rss-catalog-publishing.md`；Android 实体设备仍未测试。
- 已在 Pixel 6 Pro / Android 12 模拟器覆盖安装当前 cloud debug APK，验证目录、搜索、专题/分页、原站实际预览、飞行模式冷启动与入口切换；数据备份与安装保留检查通过。详细证据见 `docs/rss-catalog-publishing.md` 的模拟器验证记录。
- 完整数据与主题弹窗已在同一模拟器复验。独立审查发现通用移动资讯不宜归为开发类，已补失败回归并调整为“手机与移动技术”；所有源身份/地址/语言守恒检查通过。
