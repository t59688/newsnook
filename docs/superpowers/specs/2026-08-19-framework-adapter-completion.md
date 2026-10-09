# 网页源框架适配补全设计（翻页 / 分类 / 搜索）

> 日期：2026-08-19
> 上游规格：`2026-08-19-framework-detect-design.md`（框架探测总设计，已大部分落地）
> 范围：补全剩余缺口，让「上拉翻页 + 分类订阅 + 站内搜索」三件事端到端可用
> 不改：内置源、RSS/Atom 路径、路由架构、不新增 SourceKind、不引入新依赖

## 1. 现状盘点

| 模块 | 状态 | 位置 |
|---|---|---|
| FrameworkHint / PaginationPattern 类型 | ✓ 已提交 | `features/frameworkDetect/types.ts` |
| frameworkPageUrl（query-param / path-segment / next-link） | ✓ 已提交 | `features/frameworkDetect/buildPageUrl.ts` |
| 6 个探测适配器（maccms / wordpress / hugo / hexo / ghost / generic） | ✓ 已提交 | `features/frameworkDetect/adapters/` |
| detectFramework 有序入口 | ✓ 已提交 | `features/frameworkDetect/detect.ts` |
| NewsSource.frameworkHint + pagingStrategyOf + offsetPageRequest | ✓ 已提交 | `sources/registry.ts` |
| next-link 逐页跟随（SourcePagingState.nextUrl） | ✓ 已提交 | `hooks/useFeeds.ts` |
| 添加源时探测 + 分类勾选 + 每分类独立成源 + 保存 hint | ✓ 已提交 | `screens/settings/CustomSourcesScreen.tsx` |
| addCustomSource 透传 frameworkHint | ✓ 已提交 | `sources/preferences.ts` |
| 探测单测（6 框架 + 分页集成） | ✓ 通过 | `scripts/framework-detect.test.ts` |
| **normalizePreferences 保留 frameworkHint** | ✗ 未做（bug） | `sources/preferences.ts` |
| **站内搜索 UI** | ✗ 未做 | `screens/FeedScreen.tsx` |
| **搜索翻页模板**（searchTemplate 只有第 1 页） | ✗ 未做 | types + maccms 适配器 |
| `test:framework-detect` 脚本注册 | ✗ 未做 | `package.json` |
| 文档同步（架构 / 源笔记 / AGENTS.md） | ✗ 未做 | `docs/` |

### 关键 bug

`normalizePreferences` 重建 `customSources` 时字段是白名单（`preferences.ts:228-239`），
不含 `frameworkHint`。结果：hint 写入 localStorage 后，**App 重启即被剥离**，
翻页/搜索能力静默失效，源退回 client-catalog 单页行为。

## 2. 设计决策

### 2.1 数据模型（最小增量）

`FrameworkHint` 新增一个可选字段，其余不动：

```typescript
interface FrameworkHint {
  framework: FrameworkId
  paginationPattern: PaginationPattern
  categories?: { title: string; url: string }[]
  searchTemplate?: string        // 第 1 页，含 {query}（已有）
  searchPageTemplate?: string    // 新增：第 N 页，含 {page} 与 {query}
}
```

Maccms（实测）：

- 第 1 页：`{origin}/index.php/vod/search.html?wd={query}`
- 第 N 页：`{origin}/index.php/vod/search/by/time_add/page/{page}/wd/{query}`

其余框架不填 `searchPageTemplate`（WordPress `?s=` 翻页同样可用 `?s=&paged=N`，
v1 不做；Hugo/Hexo 无服务端搜索）。

### 2.2 站内搜索（单源视图，遵循上游规格 §6.5）

- **入口**：仅当单源视图（`focusSource`）且该源为 `web-catalog` 且
  `frameworkHint.searchTemplate` 非空时，FeedScreen 头部（刷新按钮旁）显示搜索图标。
- **交互**：点搜索图标 → 头部下方展开输入条 → 提交 → 拉取搜索第 1 页 →
  复用 catalog 引擎（`catalogHtmlToArticles`）提取 → 结果列表（复用 ArticleItem）→
  底部「加载更多」（`searchPageTemplate` 存在时）→ 点结果走现有 `openArticle` 进站内阅读器。
- **状态**：FeedScreen 内独立本地 state（keyword / loading / error / articles / page /
  exhausted），**不写入列表缓存、不进入已读/稍后读**；清空关键词或返回即还原主列表。
- **Article 映射**：合成 `NewsSource` 视图字段（`id`/`url` 用搜索 URL，`sourceName`
  形如「站点名 · 搜索」），`id` 由文章 URL 稳定派生，去重天然成立。
- **App.tsx 改动**：仅在 `focusSource` 分支给 FeedScreen 传一个新 prop
  `searchSource?: { name: string; searchTemplate: string; searchPageTemplate?: string }`。

### 2.3 normalize 修复

`normalizePreferences` 的 customSources 白名单中加回 `frameworkHint`，
带轻量校验：`framework` 为字符串、`paginationPattern.kind ∈
{'query-param','path-segment','next-link'}`，其余字段（categories / searchTemplate /
searchPageTemplate）结构合法则保留；校验失败丢弃该字段（源本身保留，行为退回现状）。

### 2.4 边界（不做什么）

- 不做跨源全局搜索（仅单源视图）。
- 不做需登录 / Cookie 的搜索。
- 不改编辑老源时的 hint（保留原值；重新探测只在「添加」流程执行）。
- 翻页上限维持 `catalogMaxOffsetPages()`（30 页 / 约 600 条）。
- 不针对任何特定站点提供内置源；一切经用户自建源进入。

## 3. 完成后效果（以某个 MacCMS 站点为例）

1. **添加**：我的 → 自定义源 → 输入 `example-maccms.com/index.php` → 探测提示
   「已识别为 MACCMS 站点 · 支持站内搜索 · 发现 15 个分类」→ 勾选「电影」「剧集」
   → 保存 → 得到两个独立源：`example-maccms.com · 电影`、`example-maccms.com · 剧集`。
2. **翻页**：信息流中上拉加载更多 → 依次请求 `/vod/type/id/1/page/2.html`、
   `page/3.html` …（上限 30 页）。旧版单页截断问题消除。
3. **搜索**：点进单个源 → 头部搜索图标 → 输入关键词 → 结果卡片列表 →
   加载更多（搜索翻页）→ 点任意结果在 App 内阅读。
4. **持久化**：杀进程重启后以上行为全部保持（normalize 修复后）。
5. **未知框架**：有 `rel=next`/「下一页」链接 → generic next-link 逐页跟随；
   什么都没有 → 维持现状（零回归）。

## 4. 实施计划

| # | 文件 | 改动 |
|---|---|---|
| 1 | `src/sources/preferences.ts` | normalize 保留 frameworkHint（bug 修复） |
| 2 | `src/features/frameworkDetect/types.ts` | 新增 `searchPageTemplate?` |
| 3 | `src/features/frameworkDetect/adapters/maccms.ts` | 填 `searchPageTemplate`（实测路径） |
| 4 | `src/screens/FeedScreen.tsx` | 单源视图搜索 UI（入口 + 输入条 + 结果列表 + 加载更多） |
| 5 | `src/App.tsx` | focusSource 分支传 `searchSource` prop |
| 6 | `package.json` | 注册 `test:framework-detect` |
| 7 | `scripts/framework-detect.test.ts` | 补 searchPageTemplate 断言 |
| 8 | `scripts/`（custom-sources 测试或新增） | normalize 保留/丢弃 hint 的用例 |
| 9 | `docs/news-sources.md` | Maccms 探测结论（URL 规则、API closed、翻页/搜索格式） |
| 10 | `docs/architecture.md` + `AGENTS.md` | frameworkDetect 模块入口与功能边界一行 |

顺序：1 → 2/3 → 4/5 → 6/7/8 → 9/10。

## 5. 验证

- `npm run test:framework-detect`（新注册）
- `npm run test:custom-sources`、`test:catalog-engine`、`test:feed-refresh-concurrency`（回归）
- `npm run lint`、`npm run build`（tsc -b）
- 手工：`npm run dev` 添加任一 MacCMS 站点（/index.php 入口），验证三件事（翻页/分类/搜索）+ 刷新页面（模拟重启）后行为保持

## 6. 成功标准

1. MacCMS 站点（/index.php 入口）添加后可上拉加载更多页
2. 探测到的分类可选择订阅，每个分类独立翻页
3. 单源视图可站内搜索（含加载更多）
4. 重启后行为不变
5. 无 frameworkHint 的旧 web-catalog 源行为完全不变
6. 相关测试全绿
