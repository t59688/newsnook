import type { CatalogFeed } from './schema'
import { catalogCreatorIdentity } from './identity'

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim()

function searchableNames(feed: CatalogFeed): string[] {
  const names = [feed.title, ...feed.aliases]
  return [...new Set(names.flatMap((name) => {
    // A publisher's primary name must be searchable without the platform suffix.
    const primary = name.split(/\s+[·｜|—–]\s+/)[0]
    return [normalize(name), normalize(primary)]
  }).filter((name) => name.length >= 3))]
}

export function createCatalogIndex(feeds: readonly CatalogFeed[]) {
  return feeds.map((feed) => {
    const identity = catalogCreatorIdentity(feed)
    const names = searchableNames(feed)
    const title = normalize(feed.title)
    const terms = normalize([
      feed.title, new URL(feed.url).hostname, feed.category, feed.language, feed.region,
      ...feed.aliases, ...feed.tags, feed.platform ?? identity?.platform ?? '',
      feed.creatorId ?? identity?.creatorId ?? '', ...(feed.nsfw ? ['NSFW', '成人内容'] : []),
    ].join(' '))
    return { feed, title, names, terms }
  })
}

/** Bounded typo tolerance. Only used when exact/substring matches return nothing. */
function oneEditApart(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  let a = 0, b = 0, edits = 0
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue }
    if (++edits > 1) return false
    if (left.length > right.length) a++
    else if (right.length > left.length) b++
    else if (left[a] === right[b + 1] && left[a + 1] === right[b]) { a += 2; b += 2 }
    else { a++; b++ }
  }
  return edits + Number(a < left.length || b < right.length) <= 1
}

export interface CatalogSearch { query?: string; category?: string; language?: string }
export function searchCatalog(index: ReturnType<typeof createCatalogIndex>, { query = '', category = '', language = '' }: CatalogSearch): CatalogFeed[] {
  const text = normalize(query).slice(0, 300)
  const tokens = text.split(/\s+/).filter(Boolean)
  const eligible = index.filter(({ feed }) => (!category || feed.category === category) && (!language || feed.language === language))
  const exact = eligible.filter(({ terms }) => tokens.every((token) => terms.includes(token)))
  if (exact.length || !text || tokens.length !== 1 || text.length < 3 || text.length > 24 || /^\d+$/.test(text)) {
    return exact.map((row) => ({
      ...row,
      score: !text ? 0 : row.names.includes(text) ? 5 : row.names.some((name) => name.startsWith(text)) ? 4
        : row.title.includes(text) ? 3 : row.names.some((name) => name.includes(text)) ? 2 : 1,
    })).sort((a, b) => b.score - a.score || a.feed.title.localeCompare(b.feed.title, 'zh-CN') || a.feed.id.localeCompare(b.feed.id))
      .map(({ feed }) => feed)
  }
  // Avoid unrelated category/keyword matches: typo correction only considers source names
  // sharing the first characters. No fuzzy search for one- or two-character terms.
  return eligible.filter(({ names }) => names.some((name) =>
    (name.startsWith(text.slice(0, 2)) || name.endsWith(text.slice(-2))) &&
    oneEditApart(text, name.slice(0, text.length)) && name.length >= text.length,
  )).sort((a, b) => {
    const inTitle = (row: (typeof eligible)[number]) =>
      row.title.startsWith(text.slice(0, 2)) && oneEditApart(text, row.title.slice(0, text.length))
    // A misspelled primary publisher name should outrank a coincidental alias
    // match from an unrelated creator as the directory grows.
    return Number(inTitle(b)) - Number(inTitle(a)) ||
      a.feed.title.localeCompare(b.feed.title, 'zh-CN') || a.feed.id.localeCompare(b.feed.id)
  }).slice(0, 30).map(({ feed }) => feed)
}
