import type { FrameworkHint, FrameworkSortKey, PaginationPattern } from './types'

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

/**
 * Build a paginated URL for a specific category within a framework site.
 * Each CMS has its own category pagination URL convention.
 */
export function frameworkCategoryPageUrl(
  catUrl: string,
  page: number,
  hint: FrameworkHint,
  sortKey: FrameworkSortKey = 'default',
): string {
  const pageNum = page + 1

  if (sortKey !== 'default') {
    const sorted = frameworkSortedCategoryUrl(catUrl, pageNum, hint, sortKey)
    if (sorted) return sorted
  }

  if (page <= 0) return catUrl

  // MacCMS / ZanPian 伪静态：/vodtype/2.html → /vodtype/2-2.html
  if (
    (hint.framework === 'maccms' || hint.framework === 'zanpian') &&
    /\/vod(?:type|show)\/\d+\.html$/i.test(new URL(catUrl).pathname)
  ) {
    return catUrl.replace(/(\d+)(\.html)$/i, `$1-${pageNum}$2`)
  }

  // wntheme MacCMS / ZanPian: /vodtype/ID/ → /vodtype/ID-PAGE/
  if (
    (hint.framework === 'maccms' || hint.framework === 'zanpian') &&
    /\/vodtype\/\d+\/?$/.test(new URL(catUrl).pathname)
  ) {
    const base = catUrl.replace(/\/$/, '')
    return `${base}-${pageNum}/`
  }

  // SeaCMS: /type/ID.html → /type/ID-PAGE.html
  if (hint.framework === 'seacms') {
    return catUrl.replace(/(\d+)(\.html)$/i, `$1-${pageNum}$2`)
  }

  // FYFCMS: vod-show-id-ID.html → vod-show-id-ID-p-PAGE.html
  if (hint.framework === 'fyfcms') {
    return catUrl.replace(/(vod-show-id-\d+)(\.html)$/i, `$1-p-${pageNum}$2`)
  }

  // JEECMS / 努努影院: query-param ?page=N
  if (hint.framework === 'jeecms' || hint.framework === 'nnyy') {
    const url = new URL(catUrl)
    url.searchParams.set('page', String(pageNum))
    return url.href
  }

  // Default (classic MacCMS etc.): /path.html → /path/page/PAGE.html
  const catBase = catUrl.replace(/\.html$/i, '')
  return `${catBase}/page/${pageNum}.html`
}

function frameworkSortedCategoryUrl(
  catUrl: string,
  pageNum: number,
  hint: FrameworkHint,
  sortKey: FrameworkSortKey,
): string | null {
  const url = new URL(catUrl)

  if (hint.framework === 'maccms' || hint.framework === 'zanpian') {
    const typeId = extractTrailingTypeId(url.pathname)
    if (!typeId) return null

    const pagePart = pageNum > 1 ? `/page/${pageNum}` : ''
    return `${url.origin}/index.php/vod/show/id/${typeId}/by/${sortKey}/order/desc${pagePart}.html`
  }

  if (hint.framework === 'fyfcms') {
    const typeId = extractFyfcmsTypeId(catUrl)
    if (!typeId) return null
    const by = mapFyfcmsSortKey(sortKey)
    if (!by) return null
    const pagePart = pageNum > 1 ? `-p-${pageNum}` : ''
    return `${url.origin}/index.php?s=/vod-show-id-${typeId}-by-${by}-order-desc${pagePart}.html`
  }

  if (hint.framework === 'seacms') {
    const by = mapSeacmsSortKey(sortKey)
    if (!by) return null
    const sorted = new URL(pageNum > 1 ? catUrl.replace(/(\d+)(\.html)$/i, `$1-${pageNum}$2`) : catUrl)
    sorted.searchParams.set('order', by)
    return sorted.href
  }

  return null
}

function extractTrailingTypeId(pathname: string): string | null {
  return (
    pathname.match(/\/vodtype\/(\d+)(?:-\d+)?(?:\.html)?\/?$/i)?.[1] ??
    pathname.match(/\/vodshow\/(\d+)/i)?.[1] ??
    pathname.match(/\/vod\/type\/id\/(\d+)\.html$/)?.[1] ??
    pathname.match(/\/type\/(\d+)\/?$/)?.[1] ??
    null
  )
}

function extractFyfcmsTypeId(url: string): string | null {
  return (
    url.match(/vod-show-id-(\d+)/i)?.[1] ??
    url.match(/video\/channel\/(\d+)/i)?.[1] ??
    null
  )
}

function mapFyfcmsSortKey(sortKey: FrameworkSortKey): string | null {
  switch (sortKey) {
    case 'time':
    case 'hits':
    case 'score':
      return sortKey
    default:
      return null
  }
}

function mapSeacmsSortKey(sortKey: FrameworkSortKey): string | null {
  switch (sortKey) {
    case 'time':
      return 'time'
    case 'hits':
      return 'hit'
    case 'score':
      return 'score'
    default:
      return null
  }
}

export function frameworkSearchUrl(
  hint: FrameworkHint,
  searchTemplate: string,
  query: string,
  sortKey: FrameworkSortKey = 'default',
): string {
  const encodedQuery = encodeURIComponent(query.trim())
  const baseUrl = searchTemplate.replace('{query}', encodedQuery)

  if (sortKey === 'default') return baseUrl

  if (hint.framework === 'maccms' || hint.framework === 'zanpian') {
    const url = new URL(baseUrl)
    url.searchParams.set('by', sortKey)
    url.searchParams.set('order', 'desc')
    return url.href
  }

  if (hint.framework === 'seacms') {
    const by = mapSeacmsSortKey(sortKey)
    if (!by) return baseUrl
    const url = new URL(baseUrl)
    url.searchParams.set('order', by)
    return url.href
  }

  if (hint.framework === 'fyfcms') {
    const by = mapFyfcmsSortKey(sortKey)
    if (!by) return baseUrl
    return baseUrl.replace(/(\.html)$/i, `-by-${by}-order-desc$1`)
  }

  return baseUrl
}
