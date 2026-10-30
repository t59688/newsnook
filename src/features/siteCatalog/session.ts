import type { NewsSource } from '../../sources/registry'
import { loadCatalogPage, type LoadCatalogOptions } from './service'
import { catalogRequestKey } from './abilities/requestPlan'
import { catalogSearchRequest } from './requests'
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
function nextRequest(page: CatalogPage): CatalogRequest | undefined {
  return page.pagination.nextRequest ?? (page.pagination.nextUrl ? { method: 'GET', url: page.pagination.nextUrl } : undefined)
}
export class CatalogSession {
  snapshot: CatalogSnapshot = { loading: false, exhausted: false, index: -1, history: [] }
  private controller?: AbortController
  private generation = 0
  private retryReset = true
  private retryIndex?: number
  private visited = new Set<string>()
  private listeners = new Set<() => void>()
  private loader: (request: CatalogRequest, signal: AbortSignal) => Promise<CatalogPage>
  constructor(source: NewsSource, loader?: (request: CatalogRequest, signal: AbortSignal) => Promise<CatalogPage>, options: LoadCatalogOptions = {}) {
    this.loader = loader ?? ((request, signal) => loadCatalogPage({ ...source, catalogProfile: this.snapshot.page?.profile ?? source.catalogProfile }, request, signal, options))
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<CatalogSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener() }
  cancel() { this.generation++; this.controller?.abort(); this.update({ loading: false }) }
  async retry() {
    if (this.snapshot.error && this.snapshot.request) return this.fetch(this.snapshot.request, this.retryReset, this.retryIndex)
    if (this.snapshot.page) return this.fetch(this.snapshot.page.request, false, this.snapshot.index)
    if (this.snapshot.request) return this.fetch(this.snapshot.request, true)
  }
  async open(request: CatalogRequest) { return this.fetch(request, true) }
  /** The UI passes identifiers, not a guessed route or stale form payload. */
  async choose(controlId: string, choiceId: string) {
    const control = this.snapshot.page?.capabilities?.controls.find(item => item.id === controlId)
    const choice = control?.choices.find(item => item.id === choiceId)
    if (choice) return this.open(choice.request)
  }
  async search(query: string) {
    const page = this.snapshot.page
    const request = page && catalogSearchRequest(page.capabilities ?? page.profile, query)
    if (request) return this.open(request)
  }
  previous() {
    this.cancel()
    const index = Math.max(0, this.snapshot.index - 1)
    const page = this.snapshot.history[index]
    if (page) this.update({ index, page, request: page.request, exhausted: !nextRequest(page), error: undefined })
  }
  async next() {
    const { page, loading, history, index } = this.snapshot
    if (loading || !page) return
    if (history[index + 1]) {
      const next = history[index + 1]
      this.update({ page: next, request: next.request, index: index + 1, exhausted: !nextRequest(next), error: undefined })
      return
    }
    if (this.snapshot.exhausted) return
    const request = nextRequest(page)
    if (!request || this.visited.has(catalogRequestKey(request)) || history.length >= 30) { this.update({ exhausted: true }); return }
    return this.fetch(request, false)
  }
  private async fetch(request: CatalogRequest, reset: boolean, replaceIndex?: number) {
    this.retryReset = reset
    this.retryIndex = replaceIndex
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const generation = ++this.generation
    this.update({ request, loading: true, error: undefined })
    try {
      const page = await this.loader(request, controller.signal)
      if (controller.signal.aborted || generation !== this.generation) return
      const previous = this.snapshot.page
      if (previous && new URL(previous.url).origin === new URL(page.url).origin && !page.capabilities?.issues.some(issue => issue.kind === 'search')) {
        page.profile = { ...page.profile, search: page.profile.search ?? previous.profile.search }
      }
      // Refresh replaces this entry and invalidates later cached pages. Never
      // append a duplicate page merely because the last action was pagination.
      const old = reset ? [] : replaceIndex != null ? this.snapshot.history.slice(0, replaceIndex) : this.snapshot.history
      const known = new Set(old.flatMap(entry => entry.articles.map(article => article.id)))
      const noNew = !reset && replaceIndex == null && page.articles.every(article => known.has(article.id))
      if (reset || replaceIndex != null) {
        this.visited.clear()
        for (const entry of old) {
          this.visited.add(catalogRequestKey(entry.request))
          this.visited.add(catalogRequestKey({ ...entry.request, url: entry.url }))
        }
      }
      this.visited.add(catalogRequestKey(request))
      this.visited.add(catalogRequestKey({ ...request, url: page.url }))
      const next = nextRequest(page)
      const exhausted = !next || this.visited.has(catalogRequestKey(next)) || noNew
      const history = [...old, page]
      this.update({ page, history, index: history.length - 1, exhausted })
    } catch (error) {
      if (generation === this.generation && !controller.signal.aborted) this.update({ error: error instanceof Error ? error.message : '站点读取失败，请重试' })
    } finally {
      if (generation === this.generation && !controller.signal.aborted) this.update({ loading: false })
    }
  }
}
