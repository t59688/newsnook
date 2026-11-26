import { Capacitor, registerPlugin } from '@capacitor/core'
import { announceWatchEvents } from './announcements'
import { groupWatchNotificationEvents } from './notificationBatch'
import type { WatchEvent, WatchState } from './store'

interface SourceWatchNativePlugin {
  syncRules(options: { sources: { id: string; name: string; url: string; mode: string; seen?: string[] }[]; intervalMinutes: number; quietHours: boolean; wifiOnly: boolean }): Promise<void>
  drainEvents(): Promise<{ events: { key: string; sourceId: string; sourceName: string; title: string; url: string; discoveredAt: number }[] }>
  acknowledge(options: { keys: string[] }): Promise<void>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  getNotificationStatus(): Promise<NativeWatchStatus>
  notifyNewArticles(options: {
    sources: { id: string; name: string; articles: { key: string; title: string; url: string }[] }[]
    quietHours: boolean
  }): Promise<{ delivered: number }>
  sendTestNotification(): Promise<{ delivered: boolean }>
  openNotificationSettings(): Promise<void>
  openBatteryOptimizationSettings(): Promise<void>
}
export interface NativeWatchStatus {
  enabled: boolean
  lockscreenVisible?: boolean
  ignoringBatteryOptimizations?: boolean
  scheduled: boolean
  lastJobAt: number
  lastJobChecked: number
  lastJobNew: number
  lastJobNotified: number
  lastJobErrors: number
}

const Native = registerPlugin<SourceWatchNativePlugin>('SourceWatch')
export async function syncNativeWatchRules(sources: { id: string; name: string; url: string; mode: string; seen?: string[] }[], intervalMinutes: number, quietHours: boolean, wifiOnly: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return
  await Native.syncRules({ sources, intervalMinutes, quietHours, wifiOnly })
}
/** Android notification permission/channel status. Web does not have an Android channel. */
export async function getWatchNotificationStatus(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return null
  const result = await Native.getNotificationStatus()
  return result.enabled
}

export async function getNativeWatchStatus(): Promise<NativeWatchStatus | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return null
  return Native.getNotificationStatus()
}

/** Deliver genuine foreground discoveries to the Android notification tray.
 * Quiet hours, source selection, and silent modes are filtered before crossing
 * the native bridge; native dispatch deduplicates against background jobs. */
export async function notifyNativeWatchUpdates(events: WatchEvent[], state: WatchState): Promise<number> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return 0
  const groups = groupWatchNotificationEvents(events, state)
  if (!groups.length) return 0
  const result = await Native.notifyNewArticles({ sources: groups, quietHours: state.quietHours })
  return result.delivered
}

export async function sendWatchTestNotification(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return false
  const result = await Native.sendTestNotification()
  return result.delivered
}

export async function openWatchNotificationSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return
  await Native.openNotificationSettings()
}

export async function openWatchBatterySettings(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return
  await Native.openBatteryOptimizationSettings()
}

export async function requestWatchNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return true
  const result = await Native.requestNotificationPermission()
  return result.granted
}
type WatchSourceIdentity = { id: string; name: string; group: import('../../sources/registry').SourceGroup; label: string }
let nativeImportInFlight: Promise<number> | null = null

export function importNativeWatchEvents(sources: WatchSourceIdentity[]): Promise<number> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SourceWatch')) return Promise.resolve(0)
  if (nativeImportInFlight) return nativeImportInFlight
  const current = importNativeWatchEventsOnce(sources)
  nativeImportInFlight = current
  void current.then(
    () => { if (nativeImportInFlight === current) nativeImportInFlight = null },
    () => { if (nativeImportInFlight === current) nativeImportInFlight = null },
  )
  return current
}

async function importNativeWatchEventsOnce(sources: WatchSourceIdentity[]): Promise<number> {
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
  if (added.length) {
    saveWatchState({ ...state, events: [...added, ...state.events].slice(0, 300) })
    announceWatchEvents(added)
  }
  await Native.acknowledge({ keys: events.map(event => event.key) })
  return added.length
}
