import { catalogBaseUrl } from '../catalogEngine/extractors/domCards'
import { pageContext, siteUrl, isDisabled } from './context'
import { isPaginationNode, isNextPageLabel, paginationLabel, paginationNumber } from './navigationRoles'
import type { CatalogPagination } from './types'

export function discoverCatalogPagination(html: string, pageUrl: string, document?: Document): CatalogPagination {
  const ctx = document ? { document, baseUrl: catalogBaseUrl(document, pageUrl) } : pageContext(html, pageUrl)
  let nextUrl: string | undefined
  let currentPage: number | undefined
  const pages: { page: number; url: string }[] = []
  for (const node of ctx.document.querySelectorAll('a[href], link[rel][href]')) {
    if (isDisabled(node)) continue
    const url = siteUrl(node.getAttribute('href') || '', ctx.baseUrl)
    if (!url) continue
    const text = paginationLabel(node)
    const inPager = isPaginationNode(node)
    const number = paginationNumber(text)
    if (inPager && number != null && (node.hasAttribute('aria-current') || node.matches('.current, .active') || node.parentElement?.matches('.current, .active'))) currentPage = number
    if (url === pageUrl) continue
    const nextControl = node.matches('.page-navigator .next a, .pager__item--next a, a.next.page-numbers, .wp-block-query-pagination-next, .pagination .next a')
    const relNext = node.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('next')
    if (relNext || nextControl || isNextPageLabel(text) && (!/^[▶►]$/.test(text) || inPager)) nextUrl ??= url
    if (number != null && (inPager || node.closest('.pages, .page, [role="navigation"]')) && !pages.some(page => page.page === number && page.url === url)) pages.push({ page: number, url })
  }
  // Numeric pager evidence handles pages that have no next button.
  if (!nextUrl && pages.length) {
    const active = ctx.document.querySelector('.pagination .active, .pages .current, .page-navigator .current, .pagebar .current, .pager .is-active, [aria-current="page"]')?.textContent?.trim()
    const current = currentPage ?? (active && /^\d+$/.test(active) ? Number(active) : undefined)
    if (current != null) nextUrl = pages.find(page => page.page === current + 1)?.url
  }
  return { kind: nextUrl || pages.length ? 'next-link' : 'none', nextUrl, pages: pages.length ? pages.slice(0, 100) : undefined }
}
