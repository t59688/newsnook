import type { NewsSource } from '../../sources/registry'
import { loadCatalogPage, parseCatalogPage } from './service'
import type { CatalogPage, CatalogRequest } from './types'

/** At most three observed category links; no guessed CMS endpoints or directory scans. */
export async function probeCatalog(
  source: NewsSource,
  html: string,
  signal?: AbortSignal,
  loader: (source: NewsSource, request: CatalogRequest, signal?: AbortSignal) => Promise<CatalogPage> = loadCatalogPage,
): Promise<CatalogPage> {
  const initial = parseCatalogPage(source, { method: 'GET', url: source.url }, html)
  if (initial.kind === 'catalog' || initial.kind === 'empty' || initial.kind === 'blocked' || initial.kind === 'dynamic' || initial.kind === 'detail') return initial
  for (const category of initial.profile.categories.slice(0, 3)) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    try {
      const page = await loader(source, { method: 'GET', url: category.url }, signal)
      if (page.kind === 'catalog' && page.articles.length) {
        page.profile = { ...page.profile, engine: initial.profile.engine === 'generic' ? page.profile.engine : initial.profile.engine, categories: initial.profile.categories, search: page.profile.search ?? initial.profile.search }
        return page
      }
    } catch (error) { if (signal?.aborted) throw error }
  }
  return initial
}
