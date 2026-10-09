import type { Article } from './types'

export type PagingPhase = 'uninitialized' | 'ready' | 'loading' | 'error' | 'exhausted'
export type PaginationViewState =
  | 'unsupported'
  | 'available'
  | 'loading'
  | 'error'
  | 'exhausted'

export interface SourcePagingState {
  phase: PagingPhase
  page?: number
  cursor?: string
  error?: string
  /** next-link 翻页：从上一页 HTML 中提取的下一页 URL */
  nextUrl?: string
}

export function summarizePagination(
  entries: readonly SourcePagingState[],
): PaginationViewState {
  if (!entries.length) return 'unsupported'
  if (entries.some((entry) => entry.phase === 'loading')) return 'loading'
  if (entries.some((entry) => entry.phase === 'ready' || entry.phase === 'uninitialized')) {
    return 'available'
  }
  if (entries.some((entry) => entry.phase === 'error')) return 'error'
  return 'exhausted'
}

export function sortArticles(items: Article[]): Article[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      if (a.item.hasRealDate !== b.item.hasRealDate) {
        return a.item.hasRealDate ? -1 : 1
      }
      const byTime = b.item.publishedAt - a.item.publishedAt
      if (byTime !== 0) return byTime
      return a.index - b.index
    })
    .map(({ item }) => item)
}

/** Refresh replaces the head page but retains pages already loaded below it. */
export function mergeHeadPage(existing: Article[], incoming: Article[]): Article[] {
  const incomingIds = new Set(incoming.map((item) => item.id))
  return sortArticles([
    ...incoming,
    ...existing.filter((item) => !incomingIds.has(item.id)),
  ])
}

/** Historical pages only append unseen entries and never rewrite existing order. */
export function mergeOlderPage(
  existing: Article[],
  incoming: Article[],
): { merged: Article[]; added: number } {
  const seen = new Set(existing.map((item) => item.id))
  const addedItems = incoming.filter((item) => !seen.has(item.id))
  if (!addedItems.length) return { merged: existing, added: 0 }
  return {
    merged: sortArticles([...existing, ...addedItems]),
    added: addedItems.length,
  }
}

/** Undated items from an older page must not jump above freshly fetched stories. */
export function placeUndatedPageAfterExisting(
  existing: Article[],
  incoming: Article[],
): Article[] {
  if (!existing.length) return incoming
  const oldest = Math.min(...existing.map((item) => item.publishedAt))
  let fallbackIndex = 0
  return incoming.map((item) => {
    if (item.hasRealDate) return item
    fallbackIndex += 1
    return { ...item, publishedAt: oldest - fallbackIndex }
  })
}

export function articleDateCursor(items: Article[]): string | undefined {
  const oldest = items
    .filter((item) => item.hasRealDate)
    .reduce<Article | undefined>(
      (result, item) => (!result || item.publishedAt < result.publishedAt ? item : result),
      undefined,
    )
  if (!oldest) return undefined
  const date = new Date(oldest.publishedAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/** 本地目录分页：按页切片（已按时间倒序的完整目录） */
export function sliceCatalogPage(
  catalog: readonly Article[],
  page: number,
  pageSize: number,
): Article[] {
  if (page < 0 || pageSize <= 0) return []
  const start = page * pageSize
  if (start >= catalog.length) return []
  return catalog.slice(start, start + pageSize)
}

export function catalogHasMore(
  catalogLength: number,
  page: number,
  pageSize: number,
): boolean {
  return (page + 1) * pageSize < catalogLength
}

/** 刷新时：排序完整目录 → 首页窗口 + 分页状态 */
export function openClientCatalog(
  incoming: readonly Article[],
  pageSize: number,
): { catalog: Article[]; head: Article[]; paging: SourcePagingState } {
  const catalog = sortArticles([...incoming])
  const head = sliceCatalogPage(catalog, 0, pageSize)
  return {
    catalog,
    head,
    paging: {
      phase: catalogHasMore(catalog.length, 0, pageSize) ? 'ready' : 'exhausted',
      page: 0,
    },
  }
}

/** 上拉时：从完整目录取下一窗 */
export function nextClientCatalogPage(
  catalog: readonly Article[],
  currentPage: number,
  pageSize: number,
): { slice: Article[]; paging: SourcePagingState } {
  const nextPage = currentPage + 1
  const slice = sliceCatalogPage(catalog, nextPage, pageSize)
  const exhausted = !slice.length || !catalogHasMore(catalog.length, nextPage, pageSize)
  return {
    slice,
    paging: {
      phase: exhausted ? 'exhausted' : 'ready',
      page: nextPage,
    },
  }
}

/** 启动时收缩无 page 元数据的旧全量缓存 */
export function trimLegacyCatalogCache(
  items: readonly Article[],
  pageSize: number,
): Article[] {
  if (items.length <= pageSize) return [...items]
  return sortArticles([...items]).slice(0, pageSize)
}
