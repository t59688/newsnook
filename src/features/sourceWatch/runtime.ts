import { fetchSourceText } from '../../lib/http'
import { log } from '../../lib/logger'
import { parseSourceArticles } from '../../lib/sourceArticles'
import type { NewsSource } from '../../sources/registry'
import {
  hydrateWatchEventsFromCache,
  loadWatchState,
  reconcileWatchArticles,
  saveWatchState,
} from './store'
import { announceWatchEvents } from './announcements'
import { notifyNativeWatchUpdates } from './native'

let running = false
const MAX_PARALLEL = 2
const STALE_HYDRATE_COOLDOWN_MS = 5 * 60 * 1000
const RECENT_STALE_WINDOW_MS = 12 * 60 * 60 * 1000
const lastStaleHydrateAttempt: Record<string, number> = {}

export async function checkWatchedSources(
  sources: NewsSource[],
  force = false,
  hydrateSourceIds?: ReadonlySet<string>,
): Promise<number> {
  hydrateWatchEventsFromCache()
  if (running) return 0
  const initial = loadWatchState()
  const watched = sources.filter(source => !source.paused && initial.rules.some(rule => rule.sourceId === source.id && rule.enabled))
  if (!watched.length) return 0
  const now = Date.now()
  const staleHydrateSources = new Set(
    initial.events
      .filter(event =>
        !event.article.hasRealDate
        && event.article.id === event.key
        && now - event.discoveredAt < RECENT_STALE_WINDOW_MS)
      .map(event => event.sourceId),
  )
  const due = watched.filter(source => {
    if (force || hydrateSourceIds?.has(source.id)) return true
    const lastChecked = initial.lastChecked[source.id] || 0
    if (now - lastChecked >= initial.intervalMinutes * 60000) return true
    const lastAttempt = Math.max(lastChecked, lastStaleHydrateAttempt[source.id] || 0)
    return staleHydrateSources.has(source.id) && now - lastAttempt >= STALE_HYDRATE_COOLDOWN_MS
  })
  if (!due.length) return 0
  running = true
  let total = 0
  try {
    for (let offset = 0; offset < due.length; offset += MAX_PARALLEL) {
      await Promise.all(due.slice(offset, offset + MAX_PARALLEL).map(async source => {
        if (staleHydrateSources.has(source.id)) {
          lastStaleHydrateAttempt[source.id] = Date.now()
        }
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 18000)
          let articles
          try {
            const payload = await fetchSourceText(source, controller.signal)
            articles = await parseSourceArticles(source, payload, controller.signal)
          } finally { clearTimeout(timer) }
          // Do not advance a cursor on an invalid or empty response.
          if (!articles.length) return
          const current = loadWatchState()
          if (!current.rules.some(rule => rule.sourceId === source.id && rule.enabled)) return
          const { next, added } = reconcileWatchArticles(current, source.id, articles, Date.now())
          saveWatchState(next)
          total += added.length
          announceWatchEvents(added)
          if (added.length) void notifyNativeWatchUpdates(added, next).catch(error => {
            log.feed.warn('Native watch update notification failed', error)
          })
        } catch { /* Offline, source throttling, or unsupported site: retain cursor and retry later. */ }
      }))
    }
  } finally { running = false }
  return total
}
