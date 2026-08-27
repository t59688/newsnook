/**
 * 同步的 Android 通知栏出口。
 *
 * 策略在 `notifier.ts` 的 `mapSyncEventToNotification` 里，这里只负责投递：
 * 非 Android、插件缺席、系统未授权都静默跳过——通知是加分项，缺了不影响同步。
 * 也不会为了同步在冷启动时主动索要 `POST_NOTIFICATIONS`。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

import { log } from '../../lib/logger'
import {
  mapSyncEventToNotification,
  type AppVisibility,
  type SyncNotificationModel,
} from './notifier'
import type { SyncEvent } from './SyncEngine'

export interface SyncNotificationPlugin {
  notify(options: { id: string; title: string; body: string; route: string }): Promise<void>
  cancel(options: { id: string }): Promise<void>
}

const SyncNotificationNative = registerPlugin<SyncNotificationPlugin>('SyncNotification')

function available(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('SyncNotification')
}

export async function postSyncNotification(model: SyncNotificationModel): Promise<boolean> {
  if (!available()) return false
  try {
    await SyncNotificationNative.notify({
      id: model.id,
      title: model.title,
      body: model.body,
      route: model.route,
    })
    return true
  } catch (error: unknown) {
    log.sync.debug('sync notification skipped', { error })
    return false
  }
}

export async function cancelSyncNotification(id: string): Promise<void> {
  if (!available()) return
  try {
    await SyncNotificationNative.cancel({ id })
  } catch (error: unknown) {
    log.sync.debug('sync notification cancel skipped', { error })
  }
}

/** 通知点开后的落地页深链前缀；与 SyncNotificationPlugin 里的 ROUTE_SCHEME 一致 */
const SYNC_ROUTE_PREFIX = 'newsnook://sync/'

/**
 * 通知深链 → 落地页。旧 WebView 对非特殊 scheme 的 `new URL()` 解析不稳，
 * 与 `lib/appDeepLink` 一样手工剥前缀。不是同步通知时返回 null。
 */
export function syncRouteFromAppUrl(url: string): 'account-sync' | null {
  if (!url.toLowerCase().startsWith(SYNC_ROUTE_PREFIX)) return null
  const route = url.slice(SYNC_ROUTE_PREFIX.length).split(/[?#]/)[0]
  return route === 'account-sync' ? 'account-sync' : null
}

/** 引擎事件 → 通知栏；返回是否真的发了通知 */
export async function notifySyncEvent(
  event: SyncEvent,
  visibility: AppVisibility,
): Promise<boolean> {
  const model = mapSyncEventToNotification(event, visibility)
  if (!model) return false
  return postSyncNotification(model)
}
