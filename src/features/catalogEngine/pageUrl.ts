// Legacy URL builders shared with the source registry; no DOM or client runtime imports.
const PAGE_PARAM_NAMES = ['page', 'p', 'pg', 'page_index', 'pageIndex', 'offset'] as const
const DEFAULT_MAX_OFFSET_PAGES = 30

export function pageParamName(pageUrl: string): (typeof PAGE_PARAM_NAMES)[number] | undefined {
  try {
    const url = new URL(pageUrl)
    return PAGE_PARAM_NAMES.find((name) => url.searchParams.has(name))
  } catch {
    return undefined
  }
}

/** 通用 ?page= / ?p= 翻页（0-based page index） */
export function buildCatalogPageUrl(pageUrl: string, page: number): string {
  const url = new URL(pageUrl)
  const pageNum = page + 1
  const param = pageParamName(pageUrl) ?? 'page'

  if (pageNum <= 1) {
    url.searchParams.delete(param)
  } else {
    url.searchParams.set(param, String(pageNum))
  }
  return url.href
}

export function catalogUsesOffsetPaging(pageUrl: string): boolean {
  return Boolean(pageParamName(pageUrl))
}

export function catalogMaxOffsetPages(): number {
  return DEFAULT_MAX_OFFSET_PAGES
}
