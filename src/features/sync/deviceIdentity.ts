/**
 * 设备身份：本机 deviceId 与展示名。
 *
 * deviceId 单独持久化，避免 sync-state 被清空或重建时向云端登记成「新设备」。
 * 只有换账号冲突（DEVICE_IN_USE）或用户主动撤销后才轮换。
 */

import { Capacitor } from '@capacitor/core'
import type { DevicePlatform } from '@newsnook/contracts'

import { loadPersistedDeviceId, savePersistedDeviceId } from '../../lib/storage'
import { randomUuid } from './ids'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function devicePlatform(): DevicePlatform {
  const platform = Capacitor.getPlatform()
  if (platform === 'android') return 'android'
  if (platform === 'ios') return 'ios'
  if (platform === 'web') {
    if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return 'android'
    return 'web'
  }
  return 'unknown'
}

/** 从 UA 提取 Android 型号；WebView 里通常形如 `… Android 14; 2210132C Build/…` */
export function deviceDisplayName(): string {
  if (typeof navigator === 'undefined') return 'NewsNook'

  const ua = navigator.userAgent
  const androidModel = /Android[^;]*;\s*([^)]+)\)/.exec(ua)?.[1]?.split(' Build')[0]?.trim()
  if (androidModel) return androidModel.slice(0, 60)

  const platform = devicePlatform()
  if (platform === 'web') {
    if (/Mobile/i.test(ua)) return '移动浏览器'
    if (/Windows/i.test(ua)) return 'Windows 浏览器'
    if (/Mac OS X/i.test(ua)) return 'Mac 浏览器'
    return '网页浏览器'
  }

  if (platform === 'android') return 'Android 设备'
  if (platform === 'ios') return 'iPhone / iPad'
  return 'NewsNook'
}

/** 优先 sync-state 里的 id，其次独立持久化键，最后才生成新 UUID。 */
export function resolveDeviceId(syncStateDeviceId?: string | null): string {
  if (syncStateDeviceId && isUuid(syncStateDeviceId)) {
    savePersistedDeviceId(syncStateDeviceId)
    return syncStateDeviceId
  }

  const persisted = loadPersistedDeviceId()
  if (persisted && isUuid(persisted)) return persisted

  const created = randomUuid()
  savePersistedDeviceId(created)
  return created
}

export function assignDeviceId(deviceId: string): void {
  if (!isUuid(deviceId)) return
  savePersistedDeviceId(deviceId)
}

export function readDeviceIdentity(): {
  deviceName: string
  platform: DevicePlatform
  appVersion: string
} {
  return {
    deviceName: deviceDisplayName(),
    platform: devicePlatform(),
    appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
  }
}
