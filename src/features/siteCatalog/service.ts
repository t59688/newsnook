import { discoverCatalogNavigation } from './navigation'
import { discoverPageCapabilities } from './abilities/discover'
import { detectFramework } from '../frameworkDetect/detect'
import { fetchAbsoluteText, fetchAbsoluteFormPost } from '../../lib/http'
import { catalogItemsToArticles } from '../catalogEngine/toArticles'
import { extractCatalog } from '../catalogEngine/engine'
import type { NewsSource } from '../../sources/registry'
import { catalogRequestOptions, catalogUserAgent } from './requestIdentity'
import type { CatalogSnapshotReader } from './renderedPage'
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
  const previous = catalogProfileFor({ ...source, url: finalUrl })
  const detected = detectFramework(html, finalUrl, ctx.document)?.framework ?? 'generic'
  const engine = detected === 'generic' && detectEngineIdentity(html, ctx.document) !== 'generic' ? previous.engine : detected
  // Controls claim their DOM regions before navigation and content are classified.
  const capabilities = discoverPageCapabilities(ctx.document, ctx.baseUrl, engine, { ...request, url: finalUrl })
  const navigation = discoverCatalogNavigation(ctx.document, ctx.baseUrl, finalUrl)
  const found = discoverCatalogProfile(html, finalUrl, ctx.document, navigation, capabilities)
  const search = found.search ?? (capabilities.issues.some(issue => issue.kind === 'search') ? undefined : previous.search)
  const profile = { ...found, engine, categories: found.categories.length ? found.categories : previous.categories, search }
  if (!capabilities.search && search) {
    capabilities.search = search
    capabilities.searchEvidence = { confidence: 'direct', signals: ['previously-observed-site-search'] }
  }
  const catalog = extractCatalog(html, finalUrl, { minItems: 1, document: ctx.document })
  const canonical = siteUrl(ctx.document.querySelector('link[rel~="canonical"][href]')?.getAttribute('href') || '', ctx.baseUrl)
  let kind: CatalogPageKind = 'catalog'
  const title = ctx.document.querySelector('title')?.textContent || ''
  if (/just a moment|attention required|access denied|verify.*human|安全验证|访问受限|人机验证/i.test(title) || ctx.document.querySelector('#challenge-form, .cf-challenge, #captcha-container')) kind = 'blocked'
  else if (!catalog.items.length) {
    const text = ctx.document.body?.textContent || ''
    if (/暂无|没有找到|未找到|无相关|no results|nothing found|not found/i.test(text)) kind = 'empty'
    else if (navigation.groups.length || capabilities.controls.length || capabilities.search) kind = 'navigation'
    else if (ctx.document.querySelector('script[src]') && text.trim().length < 100) kind = 'dynamic'
    else kind = 'unsupported'
  } else if (ctx.document.querySelector('meta[property="og:type"][content="article"]') && ctx.document.querySelector('main h1, article h1')) kind = 'detail'
  else if (catalog.items.length === 1 && sameContentUrl(catalog.items[0].originUrl, finalUrl)) kind = 'detail'
  else if (catalog.items.length === 1 && canonical && sameContentUrl(catalog.items[0].originUrl, canonical) && ctx.document.querySelector('main h1, article h1, [role="main"] h1')) kind = 'detail'
  const articles = kind === 'catalog' ? catalogItemsToArticles({ ...source, catalogProfile: profile }, catalog.items, Date.now()) : []
  const exclude = new Set([...profile.categories.map(category => category.url), ...navigation.groups.flatMap(group => group.links.map(link => link.url))])
  const filtered = articles.filter((article) => !exclude.has(article.originUrl))
  if (kind === 'catalog' && !filtered.length) kind = navigation.groups.length ? 'navigation' : 'unsupported'
  const pagination = discoverCatalogPagination(html, finalUrl, ctx.document)
  if (!pagination.nextUrl && capabilities.nextRequest) pagination.nextRequest = capabilities.nextRequest
  const itemMetadata: NonNullable<CatalogPage['itemMetadata']> = {}
  for (const item of catalog.items) {
    if (!filtered.some(article => article.originUrl === item.originUrl)) continue
    itemMetadata[item.originUrl] = { entityType: item.entityType ?? item.contentType ?? 'unknown', rank: item.rank, score: item.score }
  }
  return { request, url: finalUrl, profile, capabilities, itemMetadata, navigation: { activePrimaryUrl: navigation.activePrimaryUrl, groups: navigation.groups }, articles: filtered, pagination, kind, truncated: catalog.truncated === true }
}

export interface LoadCatalogOptions {
  /** Opt in only for the interactive site workspace, never implicit RSS/prestore work. */
  allowRendered?: boolean
  renderer?: CatalogSnapshotReader
}

export async function loadCatalogPage(source: NewsSource, request: CatalogRequest, signal?: AbortSignal, behavior: LoadCatalogOptions = {}): Promise<CatalogPage> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('站点读取超时，请稍后重试')), 25000)
  let finalUrl = request.url
  const options = { signal: controller.signal, ...catalogRequestOptions(source.userAgent), maxBytes: MAX_CATALOG_BYTES, onResponse: (metadata: { url?: string }) => { if (metadata.url) finalUrl = metadata.url } }
  try {
    const html = request.method === 'POST'
      ? await fetchAbsoluteFormPost(request.url, request.fields ?? request.form ?? {}, options)
      : await fetchAbsoluteText(request.url, options)
    if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError')
    let page = parseCatalogPage(source, request, html, finalUrl)
    // Only a genuine dynamic shell triggers rendering. HTTP failures and challenges
    // must not be turned into retries in another browser/network identity.
    if (behavior.allowRendered && request.method === 'GET' && page.kind === 'dynamic') {
      const { readRenderedCatalog, acceptsCatalogSnapshotUrl } = await import('./renderedPage')
      const snapshot = await (behavior.renderer ?? readRenderedCatalog)({ url: finalUrl, userAgent: catalogUserAgent(source.userAgent), signal: controller.signal, timeoutMs: 8000, maxBytes: MAX_CATALOG_BYTES })
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError')
      if (snapshot) {
        if (!acceptsCatalogSnapshotUrl(finalUrl, snapshot.url)) throw new Error('动态目录跳转到其他站点，已停止识别')
        page = parseCatalogPage(source, request, snapshot.html, snapshot.url)
        if (page.capabilities) page.capabilities.source = 'rendered'
      }
    }
    if (page.kind === 'blocked') throw new Error('来源站要求验证或限制访问，请稍后重试')
    if (page.kind === 'dynamic') throw new Error('来源站仅返回动态页面，暂未发现可读取的目录')
    if (page.kind === 'unsupported' || page.kind === 'detail') throw new Error('此页面不是可读取的目录，请使用列表或栏目地址')
    return page
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
