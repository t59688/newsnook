import { withCachedBodyPreview } from '../../lib/bodyCache'
import { previewImageUrl } from '../../lib/articlePreview'
import { loadCachedList } from '../../lib/storage'
import type { Article } from '../../lib/types'

export type WatchMode = 'instant' | 'digest' | 'inbox'
export interface WatchRule { sourceId: string; mode: WatchMode; enabled: boolean }
export interface WatchEvent { key: string; sourceId: string; article: Article; discoveredAt: number; read: boolean }
export interface WatchState { rules: WatchRule[]; events: WatchEvent[]; cursors: Record<string, string[]>; lastChecked: Record<string, number>; intervalMinutes: number; quietHours: boolean; wifiOnly: boolean }
export const WATCH_INTERVAL_CHOICES = [5, 10, 15, 30, 60] as const

export function normalizeWatchInterval(value: unknown): number {
  return typeof value === 'number' && WATCH_INTERVAL_CHOICES.some(choice => choice === value) ? value : 60
}

const KEY = 'newsnook:source-watch:v1'
const DEFAULT: WatchState = { rules: [], events: [], cursors: {}, lastChecked: {}, intervalMinutes: 60, quietHours: true, wifiOnly: false }
export function loadWatchState(): WatchState {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<WatchState> | null
    return data && Array.isArray(data.rules) ? { ...DEFAULT, ...data, intervalMinutes: normalizeWatchInterval(data.intervalMinutes), rules: data.rules.filter(rule => typeof rule.sourceId === 'string' && ['instant','digest','inbox'].includes(rule.mode)), events: Array.isArray(data.events) ? data.events : [], cursors: data.cursors || {}, lastChecked: data.lastChecked || {} } : { ...DEFAULT }
  } catch { return { ...DEFAULT } }
}
export function saveWatchState(state: WatchState): void {
  localStorage.setItem(KEY, JSON.stringify({ ...state, events: state.events.slice(0, 300) }))
  window.dispatchEvent(new Event('newsnook:source-watch-changed'))
}
export function watchArticleKey(article: Article): string {
  return article.sourceId + ':' + (article.originUrl || article.id).trim().replace(/#.*$/, '').replace(/\/$/, '')
}

function safeEnrichFromBody(article: Article): Article {
  try {
    return withCachedBodyPreview(article)
  } catch {
    return article
  }
}

function articleChanged(before: Article, after: Article): boolean {
  return after.id !== before.id
    || after.title !== before.title
    || after.summary !== before.summary
    || after.image !== before.image
    || after.publishedAt !== before.publishedAt
    || after.hasRealDate !== before.hasRealDate
    || after.contentType !== before.contentType
    || after.videoUrl !== before.videoUrl
    || after.audioUrl !== before.audioUrl
}

function mergeWatchArticle(
  before: Article,
  incoming: Article,
  options: { preferIncomingImage?: boolean; preserveExistingId?: boolean } = {},
): Article {
  const safeIncomingImage = incoming.image
    ? previewImageUrl(incoming.image, incoming.originUrl || before.originUrl)
    : undefined
  const nextImage = options.preferIncomingImage
    ? (safeIncomingImage || incoming.image || before.image)
    : (before.image || safeIncomingImage || incoming.image)

  return {
    ...before,
    id: options.preserveExistingId ? before.id : (incoming.id || before.id),
    title: incoming.title || before.title,
    summary: incoming.summary || before.summary,
    image: nextImage,
    publishedAt: incoming.hasRealDate ? incoming.publishedAt : before.publishedAt,
    hasRealDate: incoming.hasRealDate || before.hasRealDate,
    contentType: incoming.contentType || before.contentType,
    videoUrl: incoming.videoUrl || before.videoUrl,
    audioUrl: incoming.audioUrl || before.audioUrl,
  }
}

export function reconcileWatchArticles(state: WatchState, sourceId: string, articles: Article[], timestamp: number): { next: WatchState; added: WatchEvent[] } {
  const known = state.cursors[sourceId]
  const items = articles.slice(0, 50).map(safeEnrichFromBody)
  const keys = [...new Set(items.map(watchArticleKey))]
  const old = new Set(known || [])
  // First successful scan only establishes a baseline. It must not flood notifications.
  const existing = new Set(state.events.map(item => item.key))
  const added = known ? items.filter(a => !old.has(watchArticleKey(a)) && !existing.has(watchArticleKey(a))).slice(0, 10).map(a => ({ key: watchArticleKey(a), sourceId, article: a, discoveredAt: timestamp, read: false })) : []

  // Android's background RSS scanner stores only the title and URL. When the
  // WebView next parses that *watched* source, enrich its pending inbox entries
  // with the exact same cover/summary/real date used by the home feed. Do not
  // treat hydration as a new update or change an existing unread flag.
  const articlesByKey = new Map(items.map(article => [watchArticleKey(article), article]))
  const events = state.events.map(event => {
    if (event.sourceId !== sourceId) return event
    const fresh = articlesByKey.get(event.key)
    const before = event.article
    const hydrated = fresh
      ? safeEnrichFromBody(mergeWatchArticle(before, fresh, { preferIncomingImage: true }))
      : safeEnrichFromBody(before)
    return articleChanged(before, hydrated) ? { ...event, article: hydrated } : event
  })
  const next: WatchState = { ...state, events: [...added, ...events].slice(0, 300), cursors: { ...state.cursors, [sourceId]: [...new Set([...keys, ...(known || [])])].slice(0, 150) }, lastChecked: { ...state.lastChecked, [sourceId]: timestamp } }
  return { next, added }
}

/** 从本地首页列表缓存与正文缓存补全关注条目（封面图、摘要与真实发布时间），不触发网络请求。 */
export function hydrateWatchEventsFromCache(): boolean {
  const state = loadWatchState()
  if (!state.events.length) return false

  const cachedBySource = new Map<string, Map<string, Article>>()
  const listArticlesFor = (sourceId: string) => {
    let map = cachedBySource.get(sourceId)
    if (map) return map
    map = new Map<string, Article>()
    try {
      const cached = loadCachedList(sourceId)
      for (const item of cached?.items || []) {
        map.set(watchArticleKey(item), item)
      }
    } catch {
      // 忽略损坏或不完整的列表缓存，继续用正文缓存补全
    }
    cachedBySource.set(sourceId, map)
    return map
  }

  let changed = false
  const events = state.events.map(event => {
    const before = event.article
    const fromList = listArticlesFor(event.sourceId).get(event.key)
    const merged = fromList
      ? mergeWatchArticle(before, fromList, { preferIncomingImage: true })
      : before
    const hydrated = safeEnrichFromBody(merged)
    if (!articleChanged(before, hydrated)) return event
    changed = true
    return { ...event, article: hydrated }
  })

  if (!changed) return false
  saveWatchState({ ...state, events })
  return true
}

/** 将正文缓存/封面补救结果同步回关注条目，避免已找到的封面图仅停留在首页缓存中。 */
export function updateWatchArticlePreview(
  article: Article,
  options: { replaceImage?: boolean } = {},
): boolean {
  const state = loadWatchState()
  if (!state.events.length) return false

  const targetKey = watchArticleKey(article)
  const safeImage = article.image ? previewImageUrl(article.image, article.originUrl) : undefined
  const incoming = safeImage !== article.image ? { ...article, image: safeImage } : article

  let changed = false
  const events = state.events.map(event => {
    if (event.key !== targetKey && event.article.id !== article.id) return event
    const before = event.article
    const canUpgradeSkeletonId = before.id === event.key && !before.hasRealDate && incoming.hasRealDate
    const hydrated = mergeWatchArticle(before, incoming, {
      preferIncomingImage: Boolean(options.replaceImage),
      preserveExistingId: !canUpgradeSkeletonId,
    })
    if (!articleChanged(before, hydrated)) return event
    changed = true
    return { ...event, article: hydrated }
  })

  if (!changed) return false
  saveWatchState({ ...state, events })
  return true
}

/** Read a watched article anywhere in NewsNook: clear the matching inbox item. */
export function markWatchArticleRead(article: Article): boolean {
  const key = watchArticleKey(article)
  const state = loadWatchState()
  if (!state.events.some(event => event.key === key && !event.read)) return false
  saveWatchState({ ...state, events: state.events.map(event => event.key === key ? { ...event, read: true } : event) })
  return true
}
