import { alertableWatchEvents } from './announcements'
import type { WatchEvent, WatchState } from './store'

export interface NativeWatchNotificationGroup {
  id: string
  name: string
  articles: { key: string; title: string; url: string }[]
}

/**
 * Source-level batching avoids creating a system notification for every article.
 * Events are oldest-first within each batch so the native notification shows
 * the newest headline; native storage deduplicates across JobScheduler and JS.
 */
export function groupWatchNotificationEvents(
  events: WatchEvent[],
  state: WatchState,
  now = new Date(),
): NativeWatchNotificationGroup[] {
  const eligible = alertableWatchEvents(events, state, now)
  const groups = new Map<string, NativeWatchNotificationGroup>()
  for (const event of [...eligible].reverse()) {
    let group = groups.get(event.sourceId)
    if (!group) {
      group = { id: event.sourceId, name: event.article.sourceName, articles: [] }
      groups.set(event.sourceId, group)
    }
    group.articles.push({ key: event.key, title: event.article.title, url: event.article.originUrl })
  }
  return [...groups.values()]
}
