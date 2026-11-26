import type { WatchEvent, WatchState } from './store'

type Listener = (events: WatchEvent[]) => void
const listeners = new Set<Listener>()
let mutedUntil = 0

/** A system notification already took the user to its destination. Do not
 * overlay the opened article with a second banner for the same native batch. */
export function muteWatchBannersForNotificationOpen(): void {
  mutedUntil = Date.now() + 8_000
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('newsnook:source-watch-dismiss-banner'))
}

/**
 * Only newly discovered articles are announced. Persisted unread articles are
 * reflected by the bell badge, not replayed as a banner on every mount.
 */
export function subscribeWatchAnnouncements(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function announceWatchEvents(events: WatchEvent[]): void {
  if (!events.length || Date.now() < mutedUntil) return
  for (const listener of listeners) listener(events)
}

export function alertableWatchEvents(events: WatchEvent[], state: WatchState, now = new Date()): WatchEvent[] {
  const hour = now.getHours()
  if (state.quietHours && (hour >= 23 || hour < 8)) return []
  const instantIds = new Set(state.rules.filter(rule => rule.enabled && rule.mode === 'instant').map(rule => rule.sourceId))
  return events.filter(event => !event.read && instantIds.has(event.sourceId))
}
