import type { CatalogFeed } from './schema'
import { createCatalogIndex, searchCatalog, type CatalogSearch } from './search'

export interface CatalogQuery extends CatalogSearch { limit?: number }
export interface CatalogSummary {
  count: number
  categories: Array<[string, number]>
  languages: string[]
}
export interface CatalogWindow { total: number; feeds: CatalogFeed[] }

/** Search and sorting run in the catalog worker. Only a bounded page crosses to UI. */
export class CatalogSearchEngine {
  readonly summary: CatalogSummary
  private readonly index
  private readonly allSorted: CatalogFeed[]
  private lastKey = ''
  private lastResult: CatalogFeed[] = []

  constructor(feeds: readonly CatalogFeed[]) {
    this.index = createCatalogIndex(feeds)
    // Exact same no-query sort as searchCatalog, but do it once per catalog revision.
    this.allSorted = searchCatalog(this.index, {})
    const counts = new Map<string, number>()
    const languages = new Set<string>()
    for (const feed of feeds) {
      counts.set(feed.category, (counts.get(feed.category) ?? 0) + 1)
      languages.add(feed.language)
    }
    this.summary = {
      count: feeds.length,
      categories: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')),
      languages: [...languages].sort(),
    }
  }

  query({ query = '', category = '', language = '', limit = 30 }: CatalogQuery): CatalogWindow {
    const key = JSON.stringify([query, category, language])
    if (key !== this.lastKey) {
      this.lastKey = key
      this.lastResult = !query.trim()
        ? this.allSorted.filter((feed) =>
          (!category || feed.category === category) && (!language || feed.language === language))
        : searchCatalog(this.index, { query, category, language })
    }
    // The UI never receives the 38k full index or the unbounded result set.
    const count = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 0), this.summary.count) : 30
    return { total: this.lastResult.length, feeds: this.lastResult.slice(0, count) }
  }
}
