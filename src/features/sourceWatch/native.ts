import { Capacitor, registerPlugin } from '@capacitor/core'
import type { WatchEvent } from './store'

interface SourceWatchNativePlugin {
  syncRules(options: { sources: { id: string; name: string; url: string; mode: string; seen?: string[] }[]; intervalMinutes: number; quietHours: boolean; wifiOnly: boolean }): Promise<void>
  drainEvents(): Promise<{ events: { key: string; sourceId: string; sourceName: string; title: string; url: string; discoveredAt: number }[] }>
  acknowledge(options: { keys: string[] }): Promise<void>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  notify(options: { id: string; title: string; body: string; url: string }): Promise<void>
}
const Native = registerPlugin<SourceWatchNativePlugin>('SourceWatch')
export async function syncNativeWatchRules(sources: { id: string; name: string; url: string; mode: string; seen?: string[] }[], intervalMinutes: number, quietHours: boolean, wifiOnly: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return
  await Native.syncRules({ sources, intervalMinutes, quietHours, wifiOnly })
}
export async function notifyWatchEvent(event: WatchEvent, count: number): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return
  await Native.notify({ id: "watch:" + event.sourceId, title: count > 1 ? event.article.sourceName + ' · ' + count + ' 篇更新' : event.article.sourceName + ' 有新内容', body: event.article.title, url: event.article.originUrl })
}

export async function requestWatchNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return true
  const result = await Native.requestNotificationPermission()
  return result.granted
}
export async function importNativeWatchEvents(sources: { id: string; name: string; group: import('../../sources/registry').SourceGroup; label: string }[]): Promise<number> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return 0
  const { events } = await Native.drainEvents()
  if (!events.length) return 0
  const { loadWatchState, saveWatchState } = await import('./store')
  const state = loadWatchState()
  const existing = new Set(state.events.map(item => item.key))
  const sourceMap = new Map(sources.map(source => [source.id, source]))
  const added = events.filter(event => !existing.has(event.key) && state.rules.some(rule => rule.enabled && rule.sourceId === event.sourceId)).map(event => {
    const source = sourceMap.get(event.sourceId)
    return { key: event.key, sourceId: event.sourceId, discoveredAt: event.discoveredAt, read: false, article: {
      id: event.key, title: event.title, summary: '', publishedAt: event.discoveredAt, hasRealDate: false,
      sourceId: event.sourceId, sourceName: source?.name || event.sourceName,
      sourceLabel: source?.label || event.sourceName, sourceGroup: source?.group || 'custom' as const, originUrl: event.url,
    } }
  })
  if (added.length) saveWatchState({ ...state, events: [...added, ...state.events].slice(0, 300) })
  await Native.acknowledge({ keys: events.map(event => event.key) })
  return added.length
}
