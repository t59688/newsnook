import type { CatalogFeed } from './schema'

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()
export function createCatalogIndex(feeds: readonly CatalogFeed[]) {
  return feeds.map((feed) => ({ feed, title: normalize(feed.title), terms: normalize([feed.title, new URL(feed.url).hostname, feed.category, feed.language, feed.region, ...feed.aliases, ...feed.tags, ...(feed.nsfw ? ['NSFW', '成人内容'] : [])].join(' ')) }))
}
export interface CatalogSearch { query?: string; category?: string; language?: string; includeNsfw?: boolean }
export function searchCatalog(index: ReturnType<typeof createCatalogIndex>, { query = '', category = '', language = '', includeNsfw = false }: CatalogSearch): CatalogFeed[] {
  const text = normalize(query).slice(0, 300)
  const tokens = text.split(/\s+/).filter(Boolean)
  return index.filter(({ feed, terms }) => (includeNsfw || !feed.nsfw) && (!category || feed.category === category) && (!language || feed.language === language) && tokens.every((token) => terms.includes(token)))
    .map((row) => ({ ...row, score: !text ? 0 : row.title === text ? 4 : row.title.startsWith(text) ? 3 : row.title.includes(text) ? 2 : 1 }))
    .sort((a, b) => b.score - a.score || a.feed.title.localeCompare(b.feed.title, 'zh-CN') || a.feed.id.localeCompare(b.feed.id))
    .map(({ feed }) => feed)
}
