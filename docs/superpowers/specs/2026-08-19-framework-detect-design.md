# CMS 框架探测与深度适配设计

> 日期：2026-08-19
> 范围：自定义 web-catalog 源的框架探测、分页适配、分类发现、站内搜索
> 不改：内置源逻辑、RSS/Atom feed 路径、路由架构、XPath 规则编辑器

## 1. 目标

用户添加网页 URL 作为自定义源时，自动探测底层 CMS 框架，据此提供：

1. **上游翻页**：支持路径段分页（`/page/N.html`）、查询参数分页（`?page=N`）、`rel=next` 跟随
2. **分类发现**：从导航栏提取站点分类列表，用户选择后每个分类成为独立自定义源
3. **站内搜索**：在单源视图中提供该站点的搜索入口

解决已知问题：MacCMS 和类似 PHP CMS 的 web-catalog 源无法上拉加载更多。

## 2. 约束

- 不新增 SourceKind；框架适配信息存入 `NewsSource` 的新增字段
- 探测仅在用户添加源时执行一次（`probeFeedUrl` 阶段），结果持久化
- 分页策略扩展 `upstream-offset`，不新增策略类型
- 搜索仅限单源视图（不改 FeedScreen 全局逻辑）
- 不为框架适配引入新依赖

## 3. 支持的框架

| 框架 | 探测信号 | 分页模式 | 分类发现 | 搜索 |
|---|---|---|---|---|
| MacCMS | `var maccms=` 全局变量 | path-segment `/page/{N}.html` | 导航 `vod/type/id/` 链接 | `/index.php/vod/search.html?wd={query}` |
| WordPress HTML | `<meta name="generator" content="WordPress">` 或 `/wp-content/` | query-param `?paged=N` 或 path-segment `/page/N/` | 无（已有 RSS） | `?s={query}` |
| Hugo | `<meta name="generator" content="Hugo">` | path-segment `/page/N/` | 导航中 `/categories/` 或 `/tags/` | 无（静态站） |
| Hexo | `<meta name="generator" content="Hexo">` | path-segment `/page/N/` | 导航中 `/categories/` | 无（静态站） |
| Ghost | `<meta name="generator" content="Ghost">` | path-segment `/page/N/` | 无（已有 RSS） | Content API `/ghost/api/content/posts/?key=...&filter=...` |
| 通用 | HTML 中存在 `rel=next` 或"下一页"链接 | next-link 逐页跟随 | 无 | 无 |

优先级：按表格顺序匹配；命中即停。

## 4. 数据模型

### 4.1 FrameworkHint

```typescript
type FrameworkId = 'maccms' | 'wordpress' | 'hugo' | 'hexo' | 'ghost' | 'generic'

type PaginationPattern =
  | { kind: 'query-param'; param: string }
  | { kind: 'path-segment'; template: string }  // 含 {page} 占位符
  | { kind: 'next-link' }

interface FrameworkHint {
  framework: FrameworkId
  paginationPattern: PaginationPattern
  categories?: { title: string; url: string }[]
  searchTemplate?: string  // 含 {query} 占位符
}
```

### 4.2 NewsSource 扩展

```typescript
interface NewsSource {
  // ... 现有字段 ...
  frameworkHint?: FrameworkHint
}
```

`frameworkHint` 仅在 `kind: 'web-catalog'` 且 `isCustom: true` 时有意义。内置源不使用。

### 4.3 存储兼容

`frameworkHint` 作为 `customSources` 的 JSON 字段序列化到 localStorage。旧版无此字段的源保持现有行为（`client-catalog` 策略）。

## 5. 模块结构

```
features/
  frameworkDetect/
    types.ts           — FrameworkHint、PaginationPattern、FrameworkId 类型
    detect.ts          — detectFramework(html, pageUrl): FrameworkHint | null
    buildPageUrl.ts    — frameworkPageUrl(baseUrl, page, pattern): string
    adapters/
      maccms.ts        — detectMaccms / extractMaccmsCategories / maccmsSearchTemplate
      wordpress.ts     — detectWordpress / wordpressSearchTemplate
      hugo.ts          — detectHugo / extractHugoCategories
      hexo.ts          — detectHexo / extractHexoCategories
      ghost.ts         — detectGhost / ghostSearchTemplate
      generic.ts       — detectGenericNextLink
```

### 5.1 detect.ts 入口

```typescript
export function detectFramework(html: string, pageUrl: string): FrameworkHint | null {
  return detectMaccms(html, pageUrl)
    ?? detectWordpress(html, pageUrl)
    ?? detectHugo(html, pageUrl)
    ?? detectHexo(html, pageUrl)
    ?? detectGhost(html, pageUrl)
    ?? detectGenericNextLink(html, pageUrl)
    ?? null
}
```

### 5.2 buildPageUrl.ts

```typescript
export function frameworkPageUrl(
  baseUrl: string,
  page: number,        // 0-based
  pattern: PaginationPattern,
): string {
  const pageNum = page + 1
  switch (pattern.kind) {
    case 'query-param': {
      const url = new URL(baseUrl)
      if (pageNum <= 1) url.searchParams.delete(pattern.param)
      else url.searchParams.set(pattern.param, String(pageNum))
      return url.href
    }
    case 'path-segment':
      if (pageNum <= 1) return baseUrl
      return pattern.template.replace('{page}', String(pageNum))
    case 'next-link':
      // next-link 不预构建 URL；由调用方从上一页 HTML 中提取
      return baseUrl
  }
}
```

## 6. 集成点

### 6.1 探测流程（CustomSourcesScreen.tsx）

`probeFeedUrl` 在 catalog engine 命中后，额外调用 `detectFramework`。若命中：

1. 将 `frameworkHint` 存入 `probeCatalogHit` 状态
2. 若 `categories` 非空，展示分类选择列表（多选 checkbox）
3. 若 `searchTemplate` 非空，展示"支持站内搜索"标识
4. 用户选择分类后，每个分类创建独立 `web-catalog` 源（URL 为分类页 URL，继承框架 hint 的分页和搜索信息）
5. 若用户不选分类，使用首页 URL 创建单源

### 6.2 分页策略（registry.ts）

```typescript
export function pagingStrategyOf(source: NewsSource): PagingStrategy {
  // ... 现有逻辑 ...
  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) return 'upstream-offset'
    return catalogUsesOffsetPaging(source.url) ? 'upstream-offset' : 'client-catalog'
  }
  return 'client-catalog'
}
```

### 6.3 翻页 URL 构建（registry.ts）

```typescript
export function offsetPageRequest(source: NewsSource, page: number): OffsetPageRequest {
  // ... 现有逻辑 ...
  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) {
      return { url: frameworkPageUrl(source.url, safePage, source.frameworkHint.paginationPattern) }
    }
    return { url: buildCatalogPageUrl(source.url, safePage) }
  }
  // ...
}
```

### 6.4 next-link 分页（useFeeds.ts）

对 `next-link` 模式，`loadMore` 的 `upstream-offset` 路径需要额外逻辑：

- 首次加载后，从 HTML 调用 `detectNextPageUrl` 提取下一页 URL
- 将 URL 存入 `SourcePagingState.cursor`
- 翻页时直接使用 cursor URL 而非 `offsetPageRequest`

实现方式：在 `loadMore` 的 `upstream-offset` 分支中，若 `frameworkHint.paginationPattern.kind === 'next-link'`，走类似 `upstream-cursor` 的流程。

### 6.5 站内搜索（FeedScreen.tsx / 新组件）

仅在查看单个 `web-catalog` 源且该源有 `searchTemplate` 时：

- 列表顶部显示搜索输入框
- 用户输入关键词后，构建搜索 URL → `fetchAbsoluteText` → catalog engine 提取 → 展示搜索结果列表
- 搜索结果使用相同的 `web-catalog` 解析和阅读路径
- 搜索态不影响主列表状态，有独立的 loading/error/结果 state

## 7. 各适配器探测规则

### MacCMS

```typescript
export function detectMaccms(html: string, pageUrl: string): FrameworkHint | null {
  if (!/var\s+maccms\s*=/.test(html)) return null
  const categories = extractMaccmsNavCategories(html, pageUrl)
  // MacCMS 分类页：/index.php/vod/type/id/1.html → 翻页 /index.php/vod/type/id/1/page/2.html
  // 首页无标准翻页
  const base = new URL(pageUrl)
  const paginationTemplate = base.origin + base.pathname.replace(/\.html$/, '') + '/page/{page}.html'
  return {
    framework: 'maccms',
    paginationPattern: { kind: 'path-segment', template: paginationTemplate },
    categories,
    searchTemplate: base.origin + '/index.php/vod/search.html?wd={query}',
  }
}
```

### WordPress HTML

```typescript
export function detectWordpress(html: string, pageUrl: string): FrameworkHint | null {
  const isWp = /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(html)
    || html.includes('/wp-content/')
  if (!isWp) return null
  // WordPress 支持 ?paged=N 或 /page/N/
  const base = new URL(pageUrl)
  return {
    framework: 'wordpress',
    paginationPattern: { kind: 'query-param', param: 'paged' },
    searchTemplate: base.origin + '/?s={query}',
  }
}
```

### Hugo / Hexo / Ghost

类似模式：检查 `<meta name="generator">`，构建对应的分页模板。

### 通用 rel=next

```typescript
export function detectGenericNextLink(html: string, pageUrl: string): FrameworkHint | null {
  const nextUrl = detectNextPageUrl(html, pageUrl)
  if (!nextUrl) return null
  return {
    framework: 'generic',
    paginationPattern: { kind: 'next-link' },
  }
}
```

## 8. 分类发现 UX

探测到分类后，在添加源弹窗中展示：

```
已识别为 MacCMS 站点 ✓
├ 支持翻页加载 ✓
├ 支持站内搜索 ✓
└ 发现 6 个分类：

  ☑ 最新资讯    /vod/type/id/1.html
  ☑ 影视剧集    /vod/type/id/2.html
  ☐ 综艺节目    /vod/type/id/3.html
  ☑ 纪录片      /vod/type/id/4.html
  ☐ 动画专区    /vod/type/id/22.html
  ☐ 短视频      /vod/type/id/20.html

  [全选] [添加选中分类]
```

每个选中的分类创建一个独立自定义源，URL 为分类页 URL，名称为"站点名 · 分类名"。

若用户不选任何分类，仅添加首页 URL 作为单源。

## 9. 非目标

- 不做网页爬虫规则编辑器（XPath/CSS 选择器配置 UI）
- 不新增 SourceKind 类型
- 不做框架自动更新检测（框架升级后用户需重新探测）
- 不支持需要登录/Cookie 的搜索
- 不做全局跨源搜索（本版仅单源站内搜索）

## 10. 成功标准

1. MacCMS 站点添加后可上拉加载更多页
2. 探测到的分类列表可选择订阅，每个分类独立翻页
3. 支持搜索的源在单源视图中可站内搜索
4. WordPress HTML 页面可翻页（不依赖 REST API）
5. Hugo/Hexo 静态站可翻页
6. 无框架但有 rel=next 的页面可逐页跟随
7. 旧版无 frameworkHint 的 web-catalog 源行为不变
8. 相关单测通过

## 11. 测试要点

- `scripts/framework-detect.test.ts`：各框架的探测 + 分页 URL + 分类提取
- `scripts/framework-pagination.test.ts`：path-segment / next-link 翻页的集成
- 现有 `test:custom-sources` 不被破坏
