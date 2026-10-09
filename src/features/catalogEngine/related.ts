import { extractHeuristicCardCatalog } from './extractors/heuristicCards'
import { extractJsonLdCatalog } from './extractors/jsonLd'
import type { CatalogItem } from './types'

const DEFAULT_MAX_ITEMS = 12

export interface RelatedCatalogOptions {
  excludeUrls?: string[]
  maxItems?: number
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/'
    return parsed.href.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

function filterRelated(
  items: CatalogItem[],
  excluded: Set<string>,
): CatalogItem[] {
  const seen = new Set<string>()
  const result: CatalogItem[] = []
  for (const item of items) {
    const key = canonicalUrl(item.originUrl)
    if (!key || excluded.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function isDetailRelatedItem(item: CatalogItem, pageUrl: string): boolean {
  try {
    const pagePath = new URL(pageUrl).pathname.toLowerCase()
    const itemPath = new URL(item.originUrl).pathname.toLowerCase()
    if (pagePath.includes('/voddetail/')) {
      return /\/voddetail\/\d+\.html$/i.test(itemPath)
    }
    if (/^\/(?:dianying|dianshiju|zongyi|dongman)\/\d+\.html$/i.test(pagePath)) {
      return /^\/(?:dianying|dianshiju|zongyi|dongman)\/\d+\.html$/i.test(itemPath)
    }
  } catch {
    // ignore malformed URLs
  }
  return true
}

/**
 * 详情页上的「猜你喜欢 / 相关阅读」来自上游 HTML，不是客户端推荐算法。
 * 不用 extractCatalog：它会优先 JSON-LD 里的当前条目，把侧栏卡片丢掉。
 */
export function extractRelatedCatalog(
  html: string,
  pageUrl: string,
  options: RelatedCatalogOptions = {},
): CatalogItem[] {
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
  const excluded = new Set<string>([
    canonicalUrl(pageUrl),
    ...(options.excludeUrls ?? []).map(canonicalUrl),
  ])

  const keep = (items: CatalogItem[]) =>
    items.filter((item) => isDetailRelatedItem(item, pageUrl)).slice(0, maxItems)

  const heuristic = filterRelated(extractHeuristicCardCatalog(html, pageUrl), excluded)
  if (heuristic.length >= 2) return keep(heuristic)

  const jsonLd = filterRelated(extractJsonLdCatalog(html, pageUrl), excluded)
  if (jsonLd.length >= 2) return keep(jsonLd)

  const fallback = heuristic.length >= jsonLd.length ? heuristic : jsonLd
  return keep(fallback)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function relatedCatalogHtml(items: CatalogItem[]): string {
  if (!items.length) return ''
  const cards = items
    .map((item) => {
      const href = escapeHtml(item.originUrl)
      const title = escapeHtml(item.title)
      const media = item.image
        ? `<div class="reader-related-card__media" data-reader-role="related-media"><img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-reader-role="related-image"></div>`
        : `<div class="reader-related-card__media reader-related-card__media--empty" data-reader-role="related-media" data-empty="true" aria-hidden="true"></div>`
      return `<a href="${href}" class="reader-related-card" data-reader-role="related-item" data-related-title="${title}">${media}<div class="reader-related-card__body" data-reader-role="related-body"><span class="reader-related-card__title" data-reader-role="related-title">${title}</span></div></a>`
    })
    .join('')
  return `<section data-reader-role="related"><h2>相关内容</h2><div class="reader-related-grid" data-reader-role="related-grid">${cards}</div></section>`
}

export function appendRelatedCatalogHtml(contentHtml: string, items: CatalogItem[]): string {
  if (!items.length) return contentHtml
  return `${contentHtml}${relatedCatalogHtml(items)}`
}
