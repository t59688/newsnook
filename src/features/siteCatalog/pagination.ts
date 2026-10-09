import { catalogBaseUrl } from '../catalogEngine/extractors/domCards'
import { pageContext, siteUrl, isDisabled } from './context'
import type { CatalogPagination } from './types'
function label(node: Element): string { return (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim() }
export function discoverCatalogPagination(html: string, pageUrl: string, document?: Document): CatalogPagination {
  const ctx = document ? { document, baseUrl: catalogBaseUrl(document, pageUrl) } : pageContext(html, pageUrl)
  let nextUrl: string | undefined
  const pages: { page: number; url: string }[] = []
  for (const node of ctx.document.querySelectorAll('a[href], link[rel][href]')) {
    if (isDisabled(node)) continue
    const url = siteUrl(node.getAttribute('href') || '', ctx.baseUrl)
    if (!url || url === pageUrl) continue
    const text = label(node)
    const nextControl = node.matches('.page-navigator .next a, .pager__item--next a, a.next.page-numbers, .wp-block-query-pagination-next, .pagination .next a')
    const relNext = node.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('next')
    if (relNext || nextControl || /^(?:下一页|下页|后一页|后页|next(?:\s+page)?)(?:\s*[›»>→])?$|^[›»>→]$/i.test(text)) nextUrl ??= url
    if (/^\d{1,5}$/.test(text) && node.closest('.pagination, .pages, .page, .page-nav, .page-number, .page_numbers, .page-navigator, .pagebar, .pager, .dede_pages, [role="navigation"]')) pages.push({ page: Number(text), url })
  }
  // Numeric pager evidence handles pages that have no next button.
  if (!nextUrl && pages.length) {
    const active = ctx.document.querySelector('.pagination .active, .pages .current, .page-navigator .current, .pagebar .current, .pager .is-active, [aria-current="page"]')?.textContent?.trim()
    const current = active && /^\d+$/.test(active) ? Number(active) : undefined
    if (current != null) nextUrl = pages.find((page) => page.page === current + 1)?.url
  }
  return { kind: nextUrl || pages.length ? 'next-link' : 'none', nextUrl, pages: pages.length ? pages.slice(0, 100) : undefined }
}
