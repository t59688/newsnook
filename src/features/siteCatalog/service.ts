import { fetchAbsoluteText, fetchAbsoluteFormPost } from '../../lib/http'
import { catalogItemsToArticles } from '../catalogEngine/toArticles'
import { extractCatalog } from '../catalogEngine/engine'
import { userAgentFor, type NewsSource } from '../../sources/registry'
import { discoverCatalogPagination, discoverCatalogProfile } from './capabilities'
import { catalogProfileFor } from './profile'
import { detectEngineIdentity } from './detection'
import { MAX_CATALOG_BYTES, pageContext, siteUrl } from './context'
import type { CatalogPage, CatalogPageKind, CatalogRequest } from './types'

function sameContentUrl(left: string, right: string): boolean {
  const normalize = (raw: string) => {
    const url = new URL(raw)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key)
    return url.href
  }
  return normalize(left) === normalize(right)
}

export function parseCatalogPage(source: NewsSource, request: CatalogRequest, html: string, finalUrl = request.url): CatalogPage {
  const ctx = pageContext(html, finalUrl)
  const found = discoverCatalogProfile(html, finalUrl, ctx.document)
  const previous = catalogProfileFor({ ...source, url: finalUrl })
  const engine = found.engine === 'generic' && detectEngineIdentity(html, ctx.document) !== 'generic' ? previous.engine : found.engine
  const profile = { ...found, engine, categories: found.categories.length ? found.categories : previous.categories, search: found.search ?? previous.search }
  const catalog = extractCatalog(html, finalUrl, { minItems: 1, document: ctx.document })
  const canonical = siteUrl(ctx.document.querySelector('link[rel~="canonical"][href]')?.getAttribute('href') || '', ctx.baseUrl)
  let kind: CatalogPageKind = 'catalog'
  const title = ctx.document.querySelector('title')?.textContent || ''
  if (/just a moment|attention required|access denied|verify.*human|安全验证|访问受限|人机验证/i.test(title) || ctx.document.querySelector('#challenge-form, .cf-challenge, #captcha-container')) kind = 'blocked'
  else if (!catalog.items.length) {
    const text = ctx.document.body?.textContent || ''
    if (/暂无|没有找到|未找到|无相关|no results|nothing found|not found/i.test(text)) kind = 'empty'
    else if (ctx.document.querySelector('script[src]') && text.trim().length < 100) kind = 'dynamic'
    else kind = 'unsupported'
  } else if (ctx.document.querySelector('meta[property="og:type"][content="article"]') && ctx.document.querySelector('main h1, article h1')) kind = 'detail'
  else if (catalog.items.length === 1 && sameContentUrl(catalog.items[0].originUrl, finalUrl)) kind = 'detail'
  else if (catalog.items.length === 1 && canonical && sameContentUrl(catalog.items[0].originUrl, canonical) && ctx.document.querySelector('main h1, article h1, [role="main"] h1')) kind = 'detail'
  const articles = kind === 'catalog' ? catalogItemsToArticles({ ...source, catalogProfile: profile }, catalog.items, Date.now()) : []
  const exclude = new Set(profile.categories.map((category) => category.url))
  const filtered = articles.filter((article) => !exclude.has(article.originUrl))
  if (kind === 'catalog' && !filtered.length) kind = 'unsupported'
  return { request, url: finalUrl, profile, articles: filtered, pagination: discoverCatalogPagination(html, finalUrl, ctx.document), kind, truncated: catalog.truncated === true }
}

export async function loadCatalogPage(source: NewsSource, request: CatalogRequest, signal?: AbortSignal): Promise<CatalogPage> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('站点读取超时，请稍后重试')), 25000)
  let finalUrl = request.url
  const options = { signal: controller.signal, userAgent: userAgentFor(source), maxBytes: MAX_CATALOG_BYTES, onResponse: (metadata: { url?: string }) => { if (metadata.url) finalUrl = metadata.url } }
  let html: string
  try {
    html = request.method === 'POST' ? await fetchAbsoluteFormPost(request.url, request.fields ?? request.form ?? {}, options) : await fetchAbsoluteText(request.url, options)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  const page = parseCatalogPage(source, request, html, finalUrl)
  if (page.kind === 'blocked') throw new Error('来源站要求验证或限制访问，请稍后重试')
  if (page.kind === 'dynamic') throw new Error('来源站仅返回动态页面，暂未发现可读取的目录')
  if (page.kind === 'unsupported' || page.kind === 'detail') throw new Error('此页面不是可读取的目录，请使用列表或栏目地址')
  return page
}
