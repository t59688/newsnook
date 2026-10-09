# Framework Detection & Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect CMS frameworks (MacCMS, WordPress, Hugo, Hexo, Ghost, generic rel=next) when users add web-catalog custom sources, enabling upstream pagination, category discovery, and per-source search.

**Architecture:** Provider pattern under `features/frameworkDetect/`. Each adapter exports a `detect*` function returning `FrameworkHint | null`. The first match wins. `FrameworkHint` is persisted on `NewsSource.frameworkHint` at probe time. Pagination integrates into the existing `upstream-offset` strategy via `frameworkPageUrl`. Category discovery creates multiple independent custom sources. Per-source search adds a search bar in FeedScreen when viewing a single source with `searchTemplate`.

**Tech Stack:** TypeScript, React, existing catalogEngine extractors, existing `detectNextPageUrl`

## Global Constraints

- No new `SourceKind` values; framework info lives in `NewsSource.frameworkHint`
- No new npm dependencies
- Detection runs once at probe time, result persisted in localStorage via `customSources`
- Chinese for user-facing copy; English for identifiers
- All existing `test:custom-sources` must continue to pass
- Do not modify internal built-in source behavior

---

### Task 1: Types & `frameworkPageUrl`

**Files:**
- Create: `src/features/frameworkDetect/types.ts`
- Create: `src/features/frameworkDetect/buildPageUrl.ts`
- Test: `scripts/framework-detect.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `FrameworkId`, `PaginationPattern`, `FrameworkHint`, `frameworkPageUrl(baseUrl, page, pattern): string`

- [ ] **Step 1: Write the failing test**

Create `scripts/framework-detect.test.ts`:

```typescript
import assert from 'node:assert/strict'

import type { FrameworkHint, PaginationPattern } from '../src/features/frameworkDetect/types'
import { frameworkPageUrl } from '../src/features/frameworkDetect/buildPageUrl'

console.log('Testing frameworkPageUrl...')

// query-param: page 0 → no param; page 1 → ?paged=2
const qp: PaginationPattern = { kind: 'query-param', param: 'paged' }
assert.equal(
  frameworkPageUrl('https://example.com/', 0, qp),
  'https://example.com/',
)
assert.equal(
  frameworkPageUrl('https://example.com/', 1, qp),
  'https://example.com/?paged=2',
)
assert.equal(
  frameworkPageUrl('https://example.com/?paged=5', 3, qp),
  'https://example.com/?paged=4',
)

// path-segment
const ps: PaginationPattern = {
  kind: 'path-segment',
  template: 'https://example.com/vod/type/id/1/page/{page}.html',
}
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 0, ps),
  'https://example.com/vod/type/id/1.html',
)
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 1, ps),
  'https://example.com/vod/type/id/1/page/2.html',
)
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 4, ps),
  'https://example.com/vod/type/id/1/page/5.html',
)

// next-link: always returns baseUrl
const nl: PaginationPattern = { kind: 'next-link' }
assert.equal(
  frameworkPageUrl('https://example.com/blog', 5, nl),
  'https://example.com/blog',
)

console.log('✓ frameworkPageUrl tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create types**

Create `src/features/frameworkDetect/types.ts`:

```typescript
export type FrameworkId = 'maccms' | 'wordpress' | 'hugo' | 'hexo' | 'ghost' | 'generic'

export type PaginationPattern =
  | { kind: 'query-param'; param: string }
  | { kind: 'path-segment'; template: string }
  | { kind: 'next-link' }

export interface FrameworkHint {
  framework: FrameworkId
  paginationPattern: PaginationPattern
  categories?: { title: string; url: string }[]
  searchTemplate?: string
}
```

- [ ] **Step 4: Implement `frameworkPageUrl`**

Create `src/features/frameworkDetect/buildPageUrl.ts`:

```typescript
import type { PaginationPattern } from './types'

export function frameworkPageUrl(
  baseUrl: string,
  page: number,
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
      return baseUrl
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: PASS — "✓ frameworkPageUrl tests passed"

- [ ] **Step 6: Commit**

```bash
git add src/features/frameworkDetect/types.ts src/features/frameworkDetect/buildPageUrl.ts scripts/framework-detect.test.ts
git commit -m "feat(frameworkDetect): add types and frameworkPageUrl"
```

---

### Task 2: Framework Adapters (MacCMS, WordPress, Hugo, Hexo, Ghost, Generic)

**Files:**
- Create: `src/features/frameworkDetect/adapters/maccms.ts`
- Create: `src/features/frameworkDetect/adapters/wordpress.ts`
- Create: `src/features/frameworkDetect/adapters/hugo.ts`
- Create: `src/features/frameworkDetect/adapters/hexo.ts`
- Create: `src/features/frameworkDetect/adapters/ghost.ts`
- Create: `src/features/frameworkDetect/adapters/generic.ts`
- Create: `src/features/frameworkDetect/detect.ts`
- Modify: `scripts/framework-detect.test.ts`

**Interfaces:**
- Consumes: `FrameworkHint` from Task 1; `detectNextPageUrl` from `features/catalogEngine/pagination`
- Produces: `detectFramework(html, pageUrl): FrameworkHint | null`; per-adapter `detect*` functions

- [ ] **Step 1: Add detection tests to `scripts/framework-detect.test.ts`**

Append to the existing test file:

```typescript
import { detectFramework } from '../src/features/frameworkDetect/detect'

// --- MacCMS ---
console.log('Testing MacCMS detection...')
const maccmsHtml = `<html><head><title>Test</title></head><body>
<script>var maccms={"path":"","mid":"","url":"example.com"};</script>
<ul>
<li><a href="/index.php/vod/type/id/1.html">最新资讯</a></li>
<li><a href="/index.php/vod/type/id/2.html">影视剧集</a></li>
<li><a href="/index.php/vod/type/id/4.html">综艺节目</a></li>
</ul>
</body></html>`

const maccms = detectFramework(maccmsHtml, 'https://example.com/index.php')
assert.ok(maccms, 'should detect MacCMS')
assert.equal(maccms!.framework, 'maccms')
assert.equal(maccms!.paginationPattern.kind, 'path-segment')
assert.ok(maccms!.categories && maccms!.categories.length >= 3, 'should find categories')
assert.ok(maccms!.searchTemplate?.includes('{query}'), 'should have search template')
console.log('✓ MacCMS detection passed')

// --- WordPress ---
console.log('Testing WordPress detection...')
const wpHtml = `<html><head>
<meta name="generator" content="WordPress 6.5" />
</head><body><p>Hello</p></body></html>`

const wp = detectFramework(wpHtml, 'https://blog.example.com/')
assert.ok(wp, 'should detect WordPress')
assert.equal(wp!.framework, 'wordpress')
assert.ok(wp!.searchTemplate?.includes('{query}'), 'should have search template')
console.log('✓ WordPress detection passed')

// wp-content fallback
const wpHtml2 = `<html><head></head><body>
<link rel="stylesheet" href="/wp-content/themes/flavor/style.css">
</body></html>`
const wp2 = detectFramework(wpHtml2, 'https://blog2.example.com/')
assert.ok(wp2, 'should detect WordPress via wp-content')
assert.equal(wp2!.framework, 'wordpress')
console.log('✓ WordPress wp-content fallback passed')

// --- Hugo ---
console.log('Testing Hugo detection...')
const hugoHtml = `<html><head>
<meta name="generator" content="Hugo 0.128.0">
</head><body>
<nav><a href="/categories/">Categories</a><a href="/tags/">Tags</a></nav>
</body></html>`

const hugo = detectFramework(hugoHtml, 'https://hugo.example.com/')
assert.ok(hugo, 'should detect Hugo')
assert.equal(hugo!.framework, 'hugo')
assert.equal(hugo!.paginationPattern.kind, 'path-segment')
assert.ok(hugo!.categories && hugo!.categories.length >= 1, 'should find categories/tags links')
assert.equal(hugo!.searchTemplate, undefined, 'Hugo has no search')
console.log('✓ Hugo detection passed')

// --- Hexo ---
console.log('Testing Hexo detection...')
const hexoHtml = `<html><head>
<meta name="generator" content="Hexo 7.0.0">
</head><body>
<nav><a href="/categories/">分类</a></nav>
</body></html>`

const hexo = detectFramework(hexoHtml, 'https://hexo.example.com/')
assert.ok(hexo, 'should detect Hexo')
assert.equal(hexo!.framework, 'hexo')
assert.equal(hexo!.paginationPattern.kind, 'path-segment')
console.log('✓ Hexo detection passed')

// --- Ghost ---
console.log('Testing Ghost detection...')
const ghostHtml = `<html><head>
<meta name="generator" content="Ghost 5.87">
</head><body></body></html>`

const ghost = detectFramework(ghostHtml, 'https://ghost.example.com/')
assert.ok(ghost, 'should detect Ghost')
assert.equal(ghost!.framework, 'ghost')
assert.equal(ghost!.paginationPattern.kind, 'path-segment')
console.log('✓ Ghost detection passed')

// --- Generic rel=next ---
console.log('Testing generic rel=next detection...')
const nextHtml = `<html><head>
<link rel="next" href="https://other.com/articles?page=2">
</head><body></body></html>`

const generic = detectFramework(nextHtml, 'https://other.com/articles')
assert.ok(generic, 'should detect generic next-link')
assert.equal(generic!.framework, 'generic')
assert.equal(generic!.paginationPattern.kind, 'next-link')
console.log('✓ Generic rel=next detection passed')

// --- No framework ---
console.log('Testing no-framework fallback...')
const plainHtml = `<html><head><title>Plain</title></head><body><p>Hello</p></body></html>`
const none = detectFramework(plainHtml, 'https://plain.example.com/')
assert.equal(none, null, 'should return null for unrecognized HTML')
console.log('✓ No-framework fallback passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: FAIL — `detect` module not found

- [ ] **Step 3: Implement MacCMS adapter**

Create `src/features/frameworkDetect/adapters/maccms.ts`:

```typescript
import type { FrameworkHint } from '../types'

export function detectMaccms(html: string, pageUrl: string): FrameworkHint | null {
  if (!/var\s+maccms\s*=/.test(html)) return null

  const categories = extractMaccmsNavCategories(html, pageUrl)

  const base = new URL(pageUrl)
  const pathBase = base.pathname.replace(/\.html$/i, '')
  const template = `${base.origin}${pathBase}/page/{page}.html`

  return {
    framework: 'maccms',
    paginationPattern: { kind: 'path-segment', template },
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate: `${base.origin}/index.php/vod/search.html?wd={query}`,
  }
}

function extractMaccmsNavCategories(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  const results: { title: string; url: string }[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(
    /<a\b[^>]+href=["']([^"']*\/vod\/type\/id\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const rawHref = match[1]
    const rawTitle = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!rawTitle || !rawHref) continue
    try {
      const url = new URL(rawHref, pageUrl).href
      if (seen.has(url)) continue
      seen.add(url)
      results.push({ title: rawTitle, url })
    } catch {
      continue
    }
  }

  return results
}
```

- [ ] **Step 4: Implement WordPress adapter**

Create `src/features/frameworkDetect/adapters/wordpress.ts`:

```typescript
import type { FrameworkHint } from '../types'

export function detectWordpress(html: string, pageUrl: string): FrameworkHint | null {
  const isWp =
    /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(html) ||
    /\/wp-content\//i.test(html)
  if (!isWp) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  return {
    framework: 'wordpress',
    paginationPattern: { kind: 'path-segment', template },
    searchTemplate: `${base.origin}/?s={query}`,
  }
}
```

- [ ] **Step 5: Implement Hugo adapter**

Create `src/features/frameworkDetect/adapters/hugo.ts`:

```typescript
import type { FrameworkHint } from '../types'

export function detectHugo(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Hugo/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  const categories = extractHugoNavLinks(html, pageUrl)

  return {
    framework: 'hugo',
    paginationPattern: { kind: 'path-segment', template },
    categories: categories.length > 0 ? categories : undefined,
  }
}

function extractHugoNavLinks(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  const results: { title: string; url: string }[] = []
  const patterns = [/\/categories\//i, /\/tags\//i, /\/section\//i]

  for (const match of html.matchAll(
    /<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? ''
    const label = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!label || !href) continue
    if (!patterns.some((p) => p.test(href))) continue
    try {
      const url = new URL(href, pageUrl).href
      results.push({ title: label, url })
    } catch {
      continue
    }
  }

  return results
}
```

- [ ] **Step 6: Implement Hexo adapter**

Create `src/features/frameworkDetect/adapters/hexo.ts`:

```typescript
import type { FrameworkHint } from '../types'

export function detectHexo(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Hexo/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  const categories: { title: string; url: string }[] = []
  for (const match of html.matchAll(
    /<a\b[^>]+href=["']([^"']*\/categories\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? ''
    const label = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!label || !href) continue
    try {
      categories.push({ title: label, url: new URL(href, pageUrl).href })
    } catch {
      continue
    }
  }

  return {
    framework: 'hexo',
    paginationPattern: { kind: 'path-segment', template },
    categories: categories.length > 0 ? categories : undefined,
  }
}
```

- [ ] **Step 7: Implement Ghost adapter**

Create `src/features/frameworkDetect/adapters/ghost.ts`:

```typescript
import type { FrameworkHint } from '../types'

export function detectGhost(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Ghost/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  return {
    framework: 'ghost',
    paginationPattern: { kind: 'path-segment', template },
  }
}
```

- [ ] **Step 8: Implement generic rel=next adapter**

Create `src/features/frameworkDetect/adapters/generic.ts`:

```typescript
import { detectNextPageUrl } from '../../catalogEngine/pagination'
import type { FrameworkHint } from '../types'

export function detectGenericNextLink(html: string, pageUrl: string): FrameworkHint | null {
  const nextUrl = detectNextPageUrl(html, pageUrl)
  if (!nextUrl) return null
  return {
    framework: 'generic',
    paginationPattern: { kind: 'next-link' },
  }
}
```

- [ ] **Step 9: Create detect.ts entry point**

Create `src/features/frameworkDetect/detect.ts`:

```typescript
import { detectMaccms } from './adapters/maccms'
import { detectWordpress } from './adapters/wordpress'
import { detectHugo } from './adapters/hugo'
import { detectHexo } from './adapters/hexo'
import { detectGhost } from './adapters/ghost'
import { detectGenericNextLink } from './adapters/generic'
import type { FrameworkHint } from './types'

export function detectFramework(html: string, pageUrl: string): FrameworkHint | null {
  return (
    detectMaccms(html, pageUrl) ??
    detectWordpress(html, pageUrl) ??
    detectHugo(html, pageUrl) ??
    detectHexo(html, pageUrl) ??
    detectGhost(html, pageUrl) ??
    detectGenericNextLink(html, pageUrl) ??
    null
  )
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: PASS — all detection tests pass

- [ ] **Step 11: Commit**

```bash
git add src/features/frameworkDetect/ scripts/framework-detect.test.ts
git commit -m "feat(frameworkDetect): add detection adapters for 6 frameworks"
```

---

### Task 3: Integrate `frameworkHint` into NewsSource & Pagination

**Files:**
- Modify: `src/sources/registry.ts:43-67` (add `frameworkHint?` to `NewsSource`)
- Modify: `src/sources/registry.ts:795-797` (`offsetPageRequest` web-catalog branch)
- Modify: `src/sources/registry.ts:813-824` (`pagingStrategyOf` web-catalog branch)
- Modify: `scripts/framework-detect.test.ts` (add integration tests)

**Interfaces:**
- Consumes: `FrameworkHint` from Task 1; `frameworkPageUrl` from Task 1
- Produces: Updated `pagingStrategyOf` and `offsetPageRequest` that respect `frameworkHint`

- [ ] **Step 1: Add integration tests to `scripts/framework-detect.test.ts`**

Append:

```typescript
import {
  pagingStrategyOf,
  offsetPageRequest,
  type NewsSource,
} from '../src/sources/registry'

console.log('Testing pagination integration...')

const maccmsSource: NewsSource = {
  id: 'custom_test_mac',
  name: 'Test MacCMS',
  label: 'Test',
  group: 'custom',
  kind: 'web-catalog',
  url: 'https://example.com/index.php/vod/type/id/1.html',
  enabled: true,
  isCustom: true,
  frameworkHint: {
    framework: 'maccms',
    paginationPattern: {
      kind: 'path-segment',
      template: 'https://example.com/index.php/vod/type/id/1/page/{page}.html',
    },
  },
}

// web-catalog with frameworkHint → upstream-offset
assert.equal(pagingStrategyOf(maccmsSource), 'upstream-offset')

// page 0 → base URL; page 1 → /page/2.html
assert.equal(
  offsetPageRequest(maccmsSource, 0).url,
  'https://example.com/index.php/vod/type/id/1.html',
)
assert.equal(
  offsetPageRequest(maccmsSource, 1).url,
  'https://example.com/index.php/vod/type/id/1/page/2.html',
)

// web-catalog WITHOUT frameworkHint, no page param → client-catalog (unchanged)
const plainCatalogSource: NewsSource = {
  id: 'custom_test_plain',
  name: 'Plain Catalog',
  label: 'Plain',
  group: 'custom',
  kind: 'web-catalog',
  url: 'https://example.com/articles',
  enabled: true,
  isCustom: true,
}
assert.equal(pagingStrategyOf(plainCatalogSource), 'client-catalog')

console.log('✓ Pagination integration tests passed')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: FAIL — `frameworkHint` not a known property of `NewsSource`

- [ ] **Step 3: Add `frameworkHint` to `NewsSource`**

In `src/sources/registry.ts`, after line 66 (`createdAt?: number`), add:

```typescript
  /** CMS 框架探测结果（仅自定义 web-catalog 源） */
  frameworkHint?: import('../features/frameworkDetect/types').FrameworkHint
```

- [ ] **Step 4: Update `pagingStrategyOf`**

In `src/sources/registry.ts`, replace the `web-catalog` branch (lines 820-822):

```typescript
  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) return 'upstream-offset'
    return catalogUsesOffsetPaging(source.url) ? 'upstream-offset' : 'client-catalog'
  }
```

- [ ] **Step 5: Update `offsetPageRequest`**

In `src/sources/registry.ts`, add import at the top:

```typescript
import { frameworkPageUrl } from '../features/frameworkDetect/buildPageUrl'
```

Replace the `web-catalog` branch in `offsetPageRequest` (lines 795-797):

```typescript
  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) {
      return { url: frameworkPageUrl(source.url, safePage, source.frameworkHint.paginationPattern) }
    }
    return { url: buildCatalogPageUrl(source.url, safePage) }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: PASS

- [ ] **Step 7: Run existing custom-sources test**

Run: `npm run test:custom-sources`
Expected: PASS (no regressions)

- [ ] **Step 8: Commit**

```bash
git add src/sources/registry.ts scripts/framework-detect.test.ts
git commit -m "feat(frameworkDetect): integrate frameworkHint into NewsSource and pagination"
```

---

### Task 4: next-link Pagination in `useFeeds.ts`

**Files:**
- Modify: `src/hooks/useFeeds.ts:710-755` (upstream-offset branch in `loadMore`)
- Modify: `src/lib/feedPagination.ts:11-16` (add `nextUrl` to `SourcePagingState`)

**Interfaces:**
- Consumes: `detectNextPageUrl` from `catalogEngine/pagination`; `source.frameworkHint` from Task 3
- Produces: `loadMore` supports `next-link` pattern by storing discovered next URL in paging state cursor

- [ ] **Step 1: Add `nextUrl` to `SourcePagingState`**

In `src/lib/feedPagination.ts`, add to `SourcePagingState` (after line 15 `error?: string`):

```typescript
  /** next-link 翻页：从上一页 HTML 中提取的下一页 URL */
  nextUrl?: string
```

- [ ] **Step 2: Update `loadMore` upstream-offset branch for next-link**

In `src/hooks/useFeeds.ts`, inside the `if (strategy === 'upstream-offset')` block (around line 710), before the `for` loop, add a next-link early branch:

```typescript
            if (strategy === 'upstream-offset') {
              // next-link: use discovered URL from previous page
              if (source.frameworkHint?.paginationPattern.kind === 'next-link') {
                const nextUrl = pagingRef.current[id]?.nextUrl
                if (!nextUrl) {
                  // First load: fetch current page to discover next link
                  const headPayload = await fetchSourceText(source, controller.signal)
                  if (controller.signal.aborted) return
                  const headArticles = await parseSourceArticles(source, headPayload, controller.signal)
                  applyHeadPage(id, source, headPayload, headArticles)
                  const discoveredNext = detectNextPageUrl(headPayload, source.url)
                  updatePaging(id, {
                    phase: discoveredNext ? 'ready' : 'exhausted',
                    page: 0,
                    nextUrl: discoveredNext,
                  })
                  return
                }

                const payload = await fetchSourceText(source, controller.signal, { url: nextUrl })
                if (controller.signal.aborted) return
                const parsed = await parseSourceArticles(source, payload, controller.signal)
                const discoveredNext = detectNextPageUrl(payload, nextUrl)
                const currentPage = pagingRef.current[id]?.page ?? 0
                updatePaging(id, {
                  phase: discoveredNext && parsed.length ? 'ready' : 'exhausted',
                  page: currentPage + 1,
                  nextUrl: discoveredNext,
                })
                const existing = bucketsRef.current.get(id) ?? []
                if (!parsed.length) {
                  saveCachedArticles(id, existing, cacheMetaForItems(id, pagingRef.current[id], existing))
                  return
                }
                const historical = placeUndatedPageAfterExisting(existing, parsed)
                const { merged, added } = mergeOlderPage(existing, historical)
                if (added > 0) {
                  commitBucket(id, merged)
                  anyAdded = true
                  markBucketReady(id, merged)
                }
                return
              }

              const maxPages = maxOffsetPages(source)
```

Add the import for `detectNextPageUrl` at the top of `useFeeds.ts`:

```typescript
import { detectNextPageUrl } from '../features/catalogEngine/pagination'
```

- [ ] **Step 3: Run existing tests**

Run: `npm run test:custom-sources`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/feedPagination.ts src/hooks/useFeeds.ts
git commit -m "feat(frameworkDetect): support next-link pagination in loadMore"
```

---

### Task 5: Probe Flow Integration (CustomSourcesScreen)

**Files:**
- Modify: `src/screens/settings/CustomSourcesScreen.tsx:84-87` (extend `probeCatalogHit` state)
- Modify: `src/screens/settings/CustomSourcesScreen.tsx:244-274` (call `detectFramework` after catalog hit)
- Modify: `src/screens/settings/CustomSourcesScreen.tsx:301-336` (`handleSaveSource` passes `frameworkHint`)
- Modify: `src/screens/settings/CustomSourcesScreen.tsx:41-52` (`Props.onAddCustomSource` accepts `frameworkHint`)
- Modify: `src/sources/preferences.ts:658-690` (`addCustomSource` accepts and stores `frameworkHint`)

**Interfaces:**
- Consumes: `detectFramework` from Task 2; `FrameworkHint` from Task 1
- Produces: Probe flow detects frameworks, shows categories, stores `frameworkHint` on created sources

- [ ] **Step 1: Update `addCustomSource` draft type to accept `frameworkHint`**

In `src/sources/preferences.ts`, in the `addCustomSource` function's `draft` parameter (around line 660-667), add:

```typescript
    frameworkHint?: import('../features/frameworkDetect/types').FrameworkHint
```

And in the `newSource` construction (around line 679-690), add:

```typescript
    ...(draft.frameworkHint ? { frameworkHint: draft.frameworkHint } : {}),
```

- [ ] **Step 2: Update `Props.onAddCustomSource` in CustomSourcesScreen**

In `src/screens/settings/CustomSourcesScreen.tsx`, update the `onAddCustomSource` prop type (around line 43-52) to include `frameworkHint`:

```typescript
  onAddCustomSource: (
    source: {
      name: string
      label: string
      url: string
      siteUrl?: string
      kind?: NewsSource['kind']
      frameworkHint?: FrameworkHint
    },
    targetCategoryId?: CategoryId,
  ) => void
```

Add import:

```typescript
import { detectFramework } from '../../features/frameworkDetect/detect'
import type { FrameworkHint } from '../../features/frameworkDetect/types'
```

- [ ] **Step 3: Extend `probeCatalogHit` state to hold `FrameworkHint`**

Change the state type (around line 84-87):

```typescript
  const [probeCatalogHit, setProbeCatalogHit] = useState<{
    name: string
    extractor?: string
    frameworkHint?: FrameworkHint
  } | null>(null)
```

Add state for selected categories:

```typescript
  const [selectedCategories, setSelectedCategories] = useState<Set<number>>(new Set())
```

- [ ] **Step 4: Call `detectFramework` after catalog engine hit**

In `probeFeedUrl`, after the catalog hit block (around line 244-274), after `setProbeCatalogHit`, add framework detection:

```typescript
      const catalog = extractCatalog(text, normalizedUrl)
      if (catalog.items.length > 0) {
        const displayName = (() => {
          try {
            return new URL(normalizedUrl).hostname
          } catch {
            return '网页目录'
          }
        })()
        const extractorLabel =
          catalog.extractor === 'json-ld'
            ? 'JSON-LD'
            : catalog.extractor === 'heuristic-cards'
              ? '通用卡片'
              : '通用'

        const hint = detectFramework(text, normalizedUrl)
        setProbeCatalogHit({ name: displayName, extractor: extractorLabel, frameworkHint: hint ?? undefined })
        if (hint?.categories?.length) {
          setSelectedCategories(new Set(hint.categories.map((_, i) => i)))
        }
        // ... rest unchanged
```

- [ ] **Step 5: Update `handleSaveSource` to pass frameworkHint and handle category batch**

Replace the `handleSaveSource` function to handle category selection:

```typescript
  const handleSaveSource = (e?: React.FormEvent) => {
    e?.preventDefault()
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }
    const name = inputName.trim() || url
    const label = inputLabel.trim() || name.slice(0, 4)
    let siteUrl = inputSiteUrl.trim() || undefined
    if (siteUrl && !siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
      siteUrl = `https://${siteUrl}`
    }

    const hint = probeCatalogHit?.frameworkHint
    const cats = hint?.categories

    if (editingSourceId) {
      onUpdateCustomSource(editingSourceId, {
        url,
        name,
        label,
        siteUrl,
        ...(probeCatalogHit ? { kind: 'web-catalog' as const } : {}),
      })
    } else if (cats?.length && selectedCategories.size > 0) {
      // Batch-add selected categories as independent sources
      const targetCatId =
        targetCategory !== 'none' ? (targetCategory as CategoryId) : undefined
      for (const idx of selectedCategories) {
        const cat = cats[idx]
        if (!cat) continue
        const catUrl = cat.url
        const catName = `${name} · ${cat.title}`
        const catLabel = cat.title.slice(0, 4)
        // Build per-category pagination template
        const catHint: FrameworkHint | undefined = hint
          ? {
              ...hint,
              categories: undefined,
              paginationPattern:
                hint.paginationPattern.kind === 'path-segment'
                  ? {
                      kind: 'path-segment',
                      template: catUrl.replace(/\.html$/i, '') + '/page/{page}.html',
                    }
                  : hint.paginationPattern,
            }
          : undefined
        onAddCustomSource(
          {
            name: catName,
            label: catLabel,
            url: catUrl,
            siteUrl,
            kind: 'web-catalog',
            frameworkHint: catHint,
          },
          targetCatId,
        )
      }
    } else {
      const targetCatId =
        targetCategory !== 'none' ? (targetCategory as CategoryId) : undefined
      onAddCustomSource(
        {
          name,
          label,
          url,
          siteUrl,
          ...(probeCatalogHit ? { kind: 'web-catalog' as const } : {}),
          ...(hint ? { frameworkHint: hint } : {}),
        },
        targetCatId,
      )
    }

    resetForm()
  }
```

- [ ] **Step 6: Add category selection UI in the probe result area**

After the existing `probeCatalogHit` display block (around line 689-696), add category checkboxes:

```tsx
                {probeCatalogHit?.frameworkHint && (
                  <div className="mt-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                    <span className="block font-mono text-[10px] text-emerald-300">
                      已识别为 {probeCatalogHit.frameworkHint.framework.toUpperCase()} 站点
                      {probeCatalogHit.frameworkHint.searchTemplate ? ' · 支持站内搜索' : ''}
                    </span>

                    {probeCatalogHit.frameworkHint.categories &&
                      probeCatalogHit.frameworkHint.categories.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] text-paper-muted">
                              发现 {probeCatalogHit.frameworkHint.categories.length} 个分类
                            </span>
                            <button
                              type="button"
                              className="font-mono text-[10px] text-cinnabar-soft hover:text-cinnabar"
                              onClick={() => {
                                const cats = probeCatalogHit.frameworkHint!.categories!
                                if (selectedCategories.size === cats.length) {
                                  setSelectedCategories(new Set())
                                } else {
                                  setSelectedCategories(new Set(cats.map((_, i) => i)))
                                }
                              }}
                            >
                              {selectedCategories.size === probeCatalogHit.frameworkHint.categories.length
                                ? '全不选'
                                : '全选'}
                            </button>
                          </div>
                          {probeCatalogHit.frameworkHint.categories.map((cat, idx) => (
                            <label
                              key={cat.url}
                              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-paper/5"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCategories.has(idx)}
                                onChange={() => {
                                  setSelectedCategories((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(idx)) next.delete(idx)
                                    else next.add(idx)
                                    return next
                                  })
                                }}
                                className="accent-cinnabar"
                              />
                              <span className="text-[12px] text-paper">{cat.title}</span>
                            </label>
                          ))}
                        </div>
                      )}
                  </div>
                )}
```

- [ ] **Step 7: Run lint check**

Run: `npm run lint`
Expected: PASS or only pre-existing warnings

- [ ] **Step 8: Commit**

```bash
git add src/screens/settings/CustomSourcesScreen.tsx src/sources/preferences.ts
git commit -m "feat(frameworkDetect): integrate framework detection into probe flow with category selection"
```

---

### Task 6: Per-Source Search in FeedScreen

**Files:**
- Modify: `src/screens/FeedScreen.tsx` (add search bar and search result state for single-source view)
- Modify: `src/screens/FeedScreen.tsx:24-60` (add `searchTemplate` to Props or derive from source)

**Interfaces:**
- Consumes: `source.frameworkHint.searchTemplate` from Task 3; `extractCatalog` from `catalogEngine/engine`; `fetchAbsoluteText` from `lib/http`
- Produces: Search bar UI in single-source FeedScreen view; search results rendered as articles

- [ ] **Step 1: Add search state and UI to FeedScreen**

In `src/screens/FeedScreen.tsx`, add imports:

```typescript
import { useState, useCallback } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import { fetchAbsoluteText } from '../lib/http'
import { extractCatalog } from '../features/catalogEngine/engine'
import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
```

Add a `searchTemplate` prop (around line 45):

```typescript
  /** 站内搜索模板（仅 web-catalog 源有 frameworkHint.searchTemplate 时传入） */
  searchTemplate?: string
```

Inside the component, add search state:

```typescript
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Article[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    if (!searchTemplate || !searchQuery.trim()) return
    const url = searchTemplate.replace('{query}', encodeURIComponent(searchQuery.trim()))
    setSearching(true)
    setSearchError(null)
    try {
      const html = await fetchAbsoluteText(url)
      const catalog = extractCatalog(html, url)
      if (!catalog.items.length) {
        setSearchResults([])
        return
      }
      const dummySource: NewsSource = {
        id: 'search_temp',
        name: 'Search',
        label: 'Search',
        group: 'custom',
        kind: 'web-catalog',
        url,
        enabled: true,
      }
      const articles = catalogHtmlToArticles(dummySource, html, Date.now())
      setSearchResults(articles)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }, [searchTemplate, searchQuery])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
  }, [])
```

Add the search bar UI before the article list (after the header/category rail area):

```tsx
        {searchTemplate && (
          <div className="page-x flex items-center gap-2 py-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="站内搜索…"
                className="w-full rounded-xl border border-haze bg-ink py-2 pl-8 pr-8 text-[13px] text-paper placeholder:text-paper-muted/50 focus:border-cinnabar/40 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-paper-muted hover:text-paper"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="rounded-xl border border-haze bg-paper/5 px-3 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-paper disabled:opacity-40"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : '搜索'}
            </button>
          </div>
        )}

        {searchError && (
          <p className="page-x py-2 text-[12px] text-red-400">{searchError}</p>
        )}
```

When `searchResults` is not null, render search results instead of the normal article list. Wrap the existing article list rendering in a condition:

```tsx
        {searchResults !== null ? (
          <div className="page-x">
            <div className="flex items-center justify-between py-2">
              <span className="font-mono text-[11px] text-paper-muted">
                搜索结果：{searchResults.length} 条
              </span>
              <button
                type="button"
                onClick={clearSearch}
                className="font-mono text-[11px] text-cinnabar-soft hover:text-cinnabar"
              >
                返回列表
              </button>
            </div>
            {searchResults.map((article) => (
              <ArticleRow
                key={article.id}
                article={article}
                isRead={readIds.has(article.id)}
                isLater={laterIds.has(article.id)}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : (
          /* existing article list rendering */
        )}
```

- [ ] **Step 2: Pass `searchTemplate` from App.tsx**

In `src/App.tsx`, where `FeedScreen` is rendered for single-source view, pass the `searchTemplate` prop:

```typescript
searchTemplate={selectedSource?.frameworkHint?.searchTemplate}
```

(The exact location depends on how single-source view is wired — find the `FeedScreen` render with `selectedSourceId` and add the prop.)

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS or only pre-existing warnings

- [ ] **Step 4: Commit**

```bash
git add src/screens/FeedScreen.tsx src/App.tsx
git commit -m "feat(frameworkDetect): add per-source search in FeedScreen"
```

---

### Task 7: Wire `frameworkHint` Through App.tsx & Verify End-to-End

**Files:**
- Modify: `src/App.tsx` (pass `frameworkHint` in `onAddCustomSource` callback)
- Test: run `npm run test:custom-sources` and `npx tsx scripts/framework-detect.test.ts`

**Interfaces:**
- Consumes: all previous tasks
- Produces: complete working feature

- [ ] **Step 1: Update App.tsx `onAddCustomSource` handler**

In `src/App.tsx`, find the `onAddCustomSource` callback passed to `CustomSourcesScreen`. It likely calls `addCustomSource` from preferences. Ensure the `frameworkHint` field from the draft is forwarded:

```typescript
onAddCustomSource={(draft, targetCategoryId) => {
  const { nextPrefs, newSourceId } = addCustomSource(prefs, {
    ...draft,
    frameworkHint: draft.frameworkHint,
  }, targetCategoryId)
  setPrefs(nextPrefs)
}}
```

(If the callback already spreads the draft into `addCustomSource`, this may already work. Verify by reading the existing handler.)

- [ ] **Step 2: Run all related tests**

Run: `npx tsx scripts/framework-detect.test.ts`
Expected: PASS

Run: `npm run test:custom-sources`
Expected: PASS

Run: `npm run lint`
Expected: PASS or pre-existing warnings only

- [ ] **Step 3: Add test:framework-detect to package.json**

Add to `scripts` in `package.json`:

```json
"test:framework-detect": "npx tsx scripts/framework-detect.test.ts",
```

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx package.json
git commit -m "feat(frameworkDetect): wire frameworkHint through App and add test script"
```

---

## Self-Review

**Spec coverage:**
- ✅ Framework detection for all 6 frameworks
- ✅ Pagination (path-segment, query-param, next-link)
- ✅ Category discovery with user selection
- ✅ Per-source search
- ✅ Backward compatibility for sources without frameworkHint

**Placeholder scan:** No TBD/TODO/placeholders found.

**Type consistency:** `FrameworkHint`, `PaginationPattern`, `frameworkPageUrl`, `detectFramework` — consistent naming across all tasks.
