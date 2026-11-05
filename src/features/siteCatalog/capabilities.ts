import { discoverCatalogNavigation, type DiscoveredCatalogNavigation } from './navigation'
import { isPaginationControlLabel } from './navigationRoles'
import { catalogBaseUrl } from '../catalogEngine/extractors/domCards'
import { detectFramework } from '../frameworkDetect/detect'
import { pageContext, siteUrl, searchCapabilityUrl } from './context'
import { discoverPageCapabilities } from './abilities/discover'
import type { CatalogCapabilities } from './abilities/types'
import type { CatalogLink, CatalogProfile } from './types'

/** Backward-compatible, credential-free profile projection; live actions stay on CatalogPage. */
export function discoverCatalogProfile(html: string, pageUrl: string, document?: Document, navigation?: DiscoveredCatalogNavigation, capabilities?: CatalogCapabilities): CatalogProfile {
  const ctx = document ? { document, baseUrl: catalogBaseUrl(document, pageUrl) } : pageContext(html, pageUrl)
  const hint = detectFramework(html, pageUrl, ctx.document)
  const engine = capabilities?.engine ?? hint?.framework ?? 'generic'
  const observed = capabilities ?? discoverPageCapabilities(ctx.document, ctx.baseUrl, engine, { url: pageUrl, method: 'GET' })
  const contextNavigation = navigation ?? discoverCatalogNavigation(ctx.document, ctx.baseUrl, pageUrl)
  const categories = [...contextNavigation.primary]
  const childUrls = new Set(contextNavigation.groups.flatMap(group => group.links.map(link => link.url)))
  const controlUrls = new Set(observed.controls.flatMap(control => control.choices.map(choice => choice.request.url)))
  // Identity adapters may supplement observed navigation, but never create endpoints.
  for (const category of hint?.categories ?? []) {
    const url = siteUrl(category.url, ctx.baseUrl)
    if (url && !childUrls.has(url) && !controlUrls.has(url) && !isPaginationControlLabel(category.title) && !categories.some(item => item.url === url) && categories.length < 100) categories.push({ title: category.title, url })
  }
  const linksFor = (choices: CatalogCapabilities['controls'][number]['choices']): CatalogLink[] => choices.flatMap(choice => {
    if (choice.request.method !== 'GET' || choice.request.fields || choice.request.form) return []
    const url = searchCapabilityUrl(choice.request.url, ctx.baseUrl)
    return url ? [{ title: choice.title, url }] : []
  })
  const sorts = observed.controls.filter(control => control.kind === 'sort').flatMap(control => linksFor(control.choices))
  const filters = observed.controls.filter(control => control.kind === 'filter').map(control => ({ title: control.title, options: linksFor(control.choices) })).filter(group => group.options.length)
  return { version: 1, rulesRevision: 1, siteRoot: new URL('/', pageUrl).href, engine, categories, search: observed.search, sorts: sorts.length ? sorts : undefined, filters: filters.length ? filters : undefined }
}

export { discoverCatalogPagination } from './pagination'
