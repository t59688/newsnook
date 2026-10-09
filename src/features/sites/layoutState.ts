import { isSiteId } from '../../sources/registry/sites'
import type { SiteId } from './types'

export const ACTIVE_SITE_STORAGE_KEY = 'newsnook:layout:active-site:v1'

export interface LayoutStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultStorage(): LayoutStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadActiveSiteId(storage: LayoutStorage | null = defaultStorage()): SiteId | null {
  if (!storage) return null
  try {
    const value = storage.getItem(ACTIVE_SITE_STORAGE_KEY)
    return isSiteId(value) ? value : null
  } catch {
    return null
  }
}

export function saveActiveSiteId(
  siteId: SiteId | null,
  storage: LayoutStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    if (siteId) storage.setItem(ACTIVE_SITE_STORAGE_KEY, siteId)
    else storage.removeItem(ACTIVE_SITE_STORAGE_KEY)
  } catch {
    // 布局切换不能因浏览器禁用存储而阻断；当前内存态仍然有效。
  }
}
