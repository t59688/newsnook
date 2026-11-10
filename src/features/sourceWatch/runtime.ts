import { fetchSourceText } from '../../lib/http'
import { parseSourceArticles } from '../../lib/sourceArticles'
import type { NewsSource } from '../../sources/registry'
import { loadWatchState, reconcileWatchArticles, saveWatchState } from './store'
import { announceWatchEvents } from './announcements'

let running = false
const MAX_PARALLEL = 2
export async function checkWatchedSources(sources: NewsSource[], force = false): Promise<number> {
  if (running) return 0
  const initial = loadWatchState()
  const watched = sources.filter(source => !source.paused && initial.rules.some(rule => rule.sourceId === source.id && rule.enabled))
  if (!watched.length) return 0
  const now = Date.now()
  const due = watched.filter(source => force || now - (initial.lastChecked[source.id] || 0) >= initial.intervalMinutes * 60000)
  if (!due.length) return 0
  running = true
  let total = 0
  try {
    for (let offset = 0; offset < due.length; offset += MAX_PARALLEL) {
      await Promise.all(due.slice(offset, offset + MAX_PARALLEL).map(async source => {
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
        } catch { /* Offline, source throttling, or unsupported site: retain cursor and retry later. */ }
      }))
    }
  } finally { running = false }
  return total
}
