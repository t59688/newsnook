import type { NewsSource } from '../../sources/registry'
import { loadCatalogPage } from './service'
import type { CatalogPage, CatalogRequest } from './types'

export interface CatalogSnapshot {
  request?: CatalogRequest
  page?: CatalogPage
  loading: boolean
  error?: string
  exhausted: boolean
  index: number
  history: CatalogPage[]
}
export class CatalogSession {
  snapshot: CatalogSnapshot = { loading: false, exhausted: false, index: -1, history: [] }
  private controller?: AbortController
  private generation = 0
  private retryReset = true
  private visited = new Set<string>()
  private listeners = new Set<() => void>()
  private loader: (request: CatalogRequest, signal: AbortSignal) => Promise<CatalogPage>
  constructor(source: NewsSource, loader?: (request: CatalogRequest, signal: AbortSignal) => Promise<CatalogPage>) {
    this.loader = loader ?? ((request, signal) => loadCatalogPage({ ...source, catalogProfile: this.snapshot.page?.profile ?? source.catalogProfile }, request, signal))
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<CatalogSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener() }
  cancel() { this.generation++; this.controller?.abort(); this.update({ loading: false }) }
  async retry() { if (this.snapshot.request) return this.fetch(this.snapshot.request, this.retryReset) }
  async open(request: CatalogRequest) { return this.fetch(request, true) }
  previous() {
    this.cancel()
    const index = Math.max(0, this.snapshot.index - 1)
    const page = this.snapshot.history[index]
    if (page) this.update({ index, page, request: page.request, exhausted: !page.pagination.nextUrl, error: undefined })
  }
  async next() {
    const { page, loading, history, index } = this.snapshot
    if (loading || !page) return
    if (history[index + 1]) { const next = history[index + 1]; this.update({ page: next, request: next.request, index: index + 1, exhausted: !next.pagination.nextUrl }); return }
    if (this.snapshot.exhausted) return
    const url = page.pagination.nextUrl
    if (!url || this.visited.has(url) || history.length >= 30) { this.update({ exhausted: true }); return }
    return this.fetch({ method: 'GET', url }, false)
  }
  private async fetch(request: CatalogRequest, reset: boolean) {
    this.retryReset = reset
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const generation = ++this.generation
    this.update({ request, loading: true, error: undefined })
    try {
      const page = await this.loader(request, controller.signal)
      if (controller.signal.aborted || generation !== this.generation) return
      const previous = this.snapshot.page
      if (previous && new URL(previous.url).origin === new URL(page.url).origin) {
        page.profile = { ...page.profile, categories: [...new Map([...previous.profile.categories, ...page.profile.categories].map((category) => [category.url, category])).values()].slice(0, 100), search: page.profile.search ?? previous.profile.search }
      }
      const old = reset ? [] : this.snapshot.history
      const known = new Set(old.flatMap((entry) => entry.articles.map((article) => article.id)))
      const noNew = !reset && page.articles.every((article) => known.has(article.id))
      if (reset) this.visited.clear()
      this.visited.add(request.url)
      this.visited.add(page.url)
      const exhausted = !page.pagination.nextUrl || this.visited.has(page.pagination.nextUrl) || noNew
      const history = [...old, page]
      this.update({ page, history, index: history.length - 1, exhausted })
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.update({ error: error instanceof Error ? error.message : '站点读取失败，请重试' })
    } finally {
      if (generation === this.generation && !controller.signal.aborted) this.update({ loading: false })
    }
  }
}
