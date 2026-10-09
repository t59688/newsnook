import { catalogBaseUrl } from '../catalogEngine/extractors/domCards'
import { detectFramework } from '../frameworkDetect/detect'
import { isUtilityPath } from '../catalogEngine/normalize'
import { pageContext, siteUrl, searchCapabilityUrl, isSensitiveCatalogField, isDisabled } from './context'
import type { CatalogLink, CatalogProfile, CatalogRequest } from './types'

function label(node: Element): string {
  return (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100)
}
function links(nodes: Iterable<Element>, baseUrl: string): CatalogLink[] {
  const found = new Map<string, CatalogLink>()
  for (const node of nodes) {
    if (node.closest('.pager, .pagination, .page-navigator, .pagebar, .dede_pages, .wp-block-query-pagination, .com-content-category-blog__pagination')) continue
    const url = siteUrl(node.getAttribute('href') || '', baseUrl)
    const title = label(node)
    if (!url || !title || isDisabled(node) || isUtilityPath(url) || /^(?:首页|主页|home|index|更多|more|登录|注册|搜索|下一页|上一页|\d+)$/i.test(title)) continue
    if (new URL(url).pathname === '/' && !new URL(url).search) continue
    found.set(url, { title, url })
    if (found.size >= 100) break
  }
  return [...found.values()]
}

function searchForm(document: Document, baseUrl: string): CatalogRequest | undefined {
  for (const form of document.querySelectorAll('form')) {
    const fields = [...form.querySelectorAll('input[name]')]
    const query = fields.find((input) => !/^(hidden|submit|checkbox|radio|password)$/i.test(input.getAttribute('type') ?? '') && (input.getAttribute('type') === 'search' || /^(q|s|wd|keyword|keywords|searchword|search|query|key|keyboard)$/i.test(input.getAttribute('name') ?? '')))
    if (!query) continue
    if (fields.some((input) => !input.hasAttribute('disabled') && (input.getAttribute('type')?.toLowerCase() === 'password' || isSensitiveCatalogField(input.getAttribute('name') || '')))) continue
    const name = query.getAttribute('name')!
    const rewrite = form.getAttribute('data-action')
    if (rewrite?.includes('FFWD')) {
      const url = searchCapabilityUrl(rewrite.replace('FFWD', '{query}'), baseUrl)
      if (url) return { method: 'GET', url: url.replace(/%7Bquery%7D/gi, '{query}') }
    }
    const url = searchCapabilityUrl(form.getAttribute('action') || baseUrl, baseUrl)
    if (!url) continue
    const method = (form.getAttribute('method') || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'POST') continue
    const data: Record<string, string> = {}
    const entries: { name: string; value: string }[] = []
    for (const field of fields) {
      const key = field.getAttribute('name')!
      if (field === query || field.hasAttribute('disabled') || isSensitiveCatalogField(key)) continue
      if (field.getAttribute('type') !== 'hidden') continue
      const value = (field.getAttribute('value') || '').slice(0, 500)
      entries.push({ name: key, value })
      data[key] = value
      if (entries.length >= 20) break
    }
    data[name] = '{query}'
    entries.push({ name, value: '{query}' })
    const repeated = new Set(entries.map((field) => field.name)).size !== entries.length
    return repeated ? { url, method, fields: entries } : { url, method, form: data }
  }
  return undefined
}

export function discoverCatalogProfile(html: string, pageUrl: string, document?: Document): CatalogProfile {
  const ctx = document ? { document, baseUrl: catalogBaseUrl(document, pageUrl) } : pageContext(html, pageUrl)
  const hint = detectFramework(html, pageUrl, ctx.document)
  const engine = hint?.framework ?? 'generic'
  const categoryNodes = ctx.document.querySelectorAll('nav a[href], [role="navigation"] a[href], .navbar a[href], .menu a[href], .panel-heading h3 a[href], .categories a[href], .category-list a[href]')
  const categories = links(categoryNodes, ctx.baseUrl).filter((item) => !/search|vod-search|vodsearch|\/so(?:[/?]|$)/i.test(item.url) && item.url !== pageUrl)
  // Framework route evidence supplements semantic navigation, never invents categories.
  for (const category of hint?.categories ?? []) {
    const url = siteUrl(category.url, ctx.baseUrl)
    if (url && !categories.some((item) => item.url === url) && categories.length < 100) categories.push({ title: category.title, url })
  }
  const sorts = links(ctx.document.querySelectorAll('.sort a[href], .sorting a[href], .sort-list a[href], [data-sort] a[href]'), ctx.baseUrl)
  const filters = [...ctx.document.querySelectorAll('.filter, .filters, .screen-list, .filter-list')].slice(0, 10).map((node) => ({ title: label(node.querySelector('dt, h3, label, .label') ?? node).slice(0, 30) || '筛选', options: links(node.querySelectorAll('a[href]'), ctx.baseUrl) })).filter((group) => group.options.length)
  return { version: 1, rulesRevision: 1, siteRoot: new URL('/', pageUrl).href, engine, categories, search: searchForm(ctx.document, ctx.baseUrl), sorts: sorts.length ? sorts : undefined, filters: filters.length ? filters : undefined }
}

export { discoverCatalogPagination } from './pagination'
