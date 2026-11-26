import { rssCatalogService } from './runtime'
import { CatalogSearchEngine, type CatalogQuery } from './searchEngine'

type CatalogRequest =
  | { type: 'query'; id: number; params: CatalogQuery }
  | { type: 'refresh'; id: number }

let engine: CatalogSearchEngine | null = null
let indexedFeeds: readonly unknown[] | null = null
let ready: Promise<CatalogSearchEngine> | null = null

function prepare(): CatalogSearchEngine {
  const feeds = rssCatalogService.snapshot?.catalog.feeds
  if (!feeds) throw new Error('RSS 目录尚未就绪')
  if (indexedFeeds !== feeds) {
    engine = new CatalogSearchEngine(feeds)
    indexedFeeds = feeds
  }
  return engine!
}

function load(): Promise<CatalogSearchEngine> {
  if (engine && indexedFeeds === rssCatalogService.snapshot?.catalog.feeds) return Promise.resolve(engine)
  if (!ready) {
    ready = rssCatalogService.load().then(() => prepare()).finally(() => { ready = null })
  }
  return ready
}

// A new snapshot invalidates the worker's search index; no large arrays are
// ever cloned back to the UI thread.
rssCatalogService.subscribe(() => {
  const feeds = rssCatalogService.snapshot?.catalog.feeds
  if (indexedFeeds && feeds !== indexedFeeds) {
    engine = null
    indexedFeeds = null
    self.postMessage({ type: 'updated' })
  }
})

self.addEventListener('message', (event: MessageEvent<CatalogRequest>) => {
  const request = event.data
  void (async () => {
    try {
      if (request.type === 'query') {
        const current = await load()
        self.postMessage({ type: 'result', id: request.id, result: { ...current.query(request.params), summary: current.summary } })
      } else if (request.type === 'refresh') {
        await rssCatalogService.refresh()
        self.postMessage({ type: 'result', id: request.id, result: null })
      }
    } catch (error) {
      self.postMessage({ type: 'error', id: request.id,
        message: error instanceof Error ? error.message : 'RSS 目录后台处理失败' })
    }
  })()
})
