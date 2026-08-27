import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

import { log } from './logger'
import type { Article } from './types'

const PREFIX = 'newsnook:'
/** 列表缓存超过这个时长就不再展示，避免弱网时看到过于陈旧的版面 */
const LIST_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 7
const useNativePreferences = Capacitor.isNativePlatform()

export const LIST_CACHE_PREFIX = 'cache:v3:'
const LOCAL_CACHE_PREFIXES = [LIST_CACHE_PREFIX, 'body:']

/**
 * 云同步的本地状态。都要进冷启动镜像：Android 上如果 shadow/outbox 没被还原，
 * 重启后会把已经同步过的配置当成新改动重推一遍。
 * 这些结构里只有指纹与游标，不含 Session、也不含 Secret 明文。
 */
export const SYNC_STATE_KEY = 'sync-state:v1'
export const SYNC_JOURNAL_KEY = 'sync-journal:v1'
export const SYNC_ONBOARDING_KEY = 'sync-onboarding-seen'
/** 首次同步基线选择前的本机快照，只落 localStorage（见 lib/backup.ts） */
export const SYNC_SAFETY_SNAPSHOT_KEY = 'sync-safety-snapshot:v1'

/**
 * 冷启动只镜像这些键。列表/正文缓存已是 localOnly，其余键延后清理即可。
 * 全量 Preferences.keys() + 逐 key get 会明显拖慢 Android 复启。
 */
const BOOTSTRAP_MIRROR_KEYS = [
  'preferences',
  'enabled',
  'presets',
  'splash-seen',
  'tour-seen',
  'later-items',
  'later',
  'read',
  'appUpdate',
  SYNC_STATE_KEY,
  SYNC_JOURNAL_KEY,
  SYNC_ONBOARDING_KEY,
] as const

/** 阅读位置：条目多但每条很小，只落 localStorage，避免每次滚动都写原生 Preferences */
export const READING_POSITION_KEY = 'reading-pos'

function reportNativeStorageError(operation: string, error: unknown): void {
  log.storage.warn(`Native Preferences ${operation} failed`, error)
}

async function cleanupLegacyNativeCacheKeys(): Promise<void> {
  try {
    const { keys } = await Preferences.keys()
    const legacyCacheKeys = keys.filter(
      (key) =>
        key.startsWith(PREFIX) &&
        LOCAL_CACHE_PREFIXES.some((cachePrefix) => key.startsWith(PREFIX + cachePrefix)),
    )
    if (!legacyCacheKeys.length) return
    await Promise.all(
      legacyCacheKeys.map((key) =>
        Preferences.remove({ key }).catch((error: unknown) => {
          reportNativeStorageError('remove legacy cache', error)
        }),
      ),
    )
  } catch (error) {
    reportNativeStorageError('cleanup legacy', error)
  }
}

/**
 * Preferences is the durable native store; localStorage remains a synchronous mirror
 * so the existing React state initialization path stays deterministic.
 */
export async function hydrateNativeStorage(): Promise<void> {
  if (!useNativePreferences) return

  try {
    await Promise.all(
      BOOTSTRAP_MIRROR_KEYS.map(async (key) => {
        const storageKey = PREFIX + key
        try {
          const { value } = await Preferences.get({ key: storageKey })
          if (value === null) return
          localStorage.setItem(storageKey, value)
        } catch (error) {
          reportNativeStorageError(`hydrate ${key}`, error)
        }
      }),
    )

    // 历史误写入 Preferences 的大缓存清理由空闲时段完成，不挡首屏
    const schedule =
      typeof window !== 'undefined' && 'requestIdleCallback' in window
        ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 4000 })
        : (cb: () => void) => window.setTimeout(cb, 1500)
    schedule(() => {
      void cleanupLegacyNativeCacheKeys()
    })
  } catch (error) {
    reportNativeStorageError('hydrate', error)
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

interface WriteOptions {
  /**
   * 只写 localStorage，不镜像到原生 Preferences。
   * 正文缓存体积大且可再生，镜像进 SharedPreferences 会拖慢启动时的 hydrate。
   */
  localOnly?: boolean
}

function mirrorToNative(storageKey: string, serialized: string): Promise<void> | null {
  if (!useNativePreferences) return null
  return Preferences.set({ key: storageKey, value: serialized }).catch((error: unknown) => {
    reportNativeStorageError('write', error)
  })
}

function write(key: string, value: unknown, options?: WriteOptions): void {
  const storageKey = PREFIX + key
  try {
    const serialized = JSON.stringify(value)
    localStorage.setItem(storageKey, serialized)
    if (!options?.localOnly) void mirrorToNative(storageKey, serialized)
  } catch (error) {
    // 存储写满或被禁用时静默降级，不影响阅读
    log.storage.warn('localStorage write failed', error)
  }
}

/** 供正文缓存使用：写入失败时需要感知配额溢出并自行腾空间 */
export function writeRawOrThrow(key: string, serialized: string): void {
  localStorage.setItem(PREFIX + key, serialized)
}

export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

/** 枚举本地已存在的业务键（去掉 newsnook: 前缀） */
export function listKeys(prefix = ''): string[] {
  const full = PREFIX + prefix
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(full)) keys.push(key.slice(PREFIX.length))
  }
  return keys
}

export function removeLocalKeys(keys: string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(PREFIX + key)
    } catch {
      // 忽略单键删除失败，继续清理其余键
    }
  }
}

export function removeKeys(keys: string[]): void {
  removeLocalKeys(keys)
  for (const key of keys) {
    if (useNativePreferences) {
      void Preferences.remove({ key: PREFIX + key }).catch((error: unknown) => {
        reportNativeStorageError('remove', error)
      })
    }
  }
}

/**
 * localStorage 以 UTF-16 计费，用字符数 ×2 估算占用，
 * 统计口径与配额判断保持一致。
 */
function approxBytes(serialized: string): number {
  return serialized.length * 2
}

export function approxStoredBytes(key: string, serialized: string): number {
  return approxBytes(PREFIX + key) + approxBytes(serialized)
}

export function bytesOfKeys(keys: string[]): number {
  return keys.reduce((total, key) => {
    const raw = readRaw(key)
    return raw ? total + approxStoredBytes(key, raw) : total
  }, 0)
}

export function loadEnabledSources(): string[] | undefined {
  const stored = read<string[] | null>('enabled', null)
  return stored ?? undefined
}

export function saveEnabledSources(ids: string[]): void {
  write('enabled', ids)
}

/** 首启动画只完整播放一次，之后启动改用静态启动页 */
export function hasSeenStartupSplash(): boolean {
  return read<boolean>('splash-seen', false)
}

export function markStartupSplashSeen(): void {
  write('splash-seen', true)
}

/** 清除「已看过完整开场」标记，下次冷启动会再播完整动画（播完后仍会重新标记） */
export function clearStartupSplashSeen(): void {
  removeKeys(['splash-seen'])
}

/** 功能引导只自动播放一次；完成或跳过都算看过，「关于」页可随时重看（不清标记） */
export function hasSeenProductTour(): boolean {
  return read<boolean>('tour-seen', false)
}

export function markProductTourSeen(): void {
  write('tour-seen', true)
}

/** 调试用：清除标记后下次冷启动进首页会再次自动引导 */
export function clearProductTourSeen(): void {
  removeKeys(['tour-seen'])
}

export function loadPreferences(): unknown {
  return read<unknown>('preferences', null)
}

export function savePreferences(prefs: unknown): void {
  write('preferences', prefs)
}

export function loadAppUpdatePrefs(): unknown {
  return read('appUpdate', {})
}

export function saveAppUpdatePrefs(prefs: unknown): void {
  write('appUpdate', prefs)
}

export function loadPresetsState(): unknown {
  return read<unknown>('presets', null)
}

export function savePresetsState(state: unknown): void {
  write('presets', state)
}

export function loadSyncState(): unknown {
  return read<unknown>(SYNC_STATE_KEY, null)
}

export function saveSyncState(state: unknown): void {
  write(SYNC_STATE_KEY, state)
}

export function clearSyncState(): void {
  removeKeys([SYNC_STATE_KEY, SYNC_JOURNAL_KEY])
}

export function loadSyncJournal(): unknown {
  return read<unknown>(SYNC_JOURNAL_KEY, null)
}

export function saveSyncJournal(journal: unknown): void {
  write(SYNC_JOURNAL_KEY, journal)
}

export function clearSyncJournal(): void {
  removeKeys([SYNC_JOURNAL_KEY])
}

/**
 * 首次同步前的本机安全快照：只存一份（新的覆盖旧的），只落 localStorage。
 * 它是「云端基线选错了想反悔」的兜底，不参与冷启动镜像，也不进普通备份文件。
 */
export function loadSyncSafetySnapshot(): unknown {
  return read<unknown>(SYNC_SAFETY_SNAPSHOT_KEY, null)
}

export function saveSyncSafetySnapshot(snapshot: unknown): void {
  write(SYNC_SAFETY_SNAPSHOT_KEY, snapshot, { localOnly: true })
}

export function clearSyncSafetySnapshot(): void {
  removeKeys([SYNC_SAFETY_SNAPSHOT_KEY])
}

/** 同步引导只提示一次；「稍后再说」与「去登录」都算已看过 */
export function hasSeenSyncOnboarding(): boolean {
  return read<boolean>(SYNC_ONBOARDING_KEY, false)
}

export function markSyncOnboardingSeen(): void {
  write(SYNC_ONBOARDING_KEY, true)
}

export function loadReadingPositions(): unknown {
  return read<unknown>(READING_POSITION_KEY, null)
}

export function saveReadingPositions(map: unknown): void {
  write(READING_POSITION_KEY, map, { localOnly: true })
}

/**
 * 备份恢复专用：把一组已校验过的业务键整段写回。恢复是整体覆盖语义，不做增量合并。
 *
 * 返回的 Promise 要等原生 Preferences 也落盘才 resolve：调用方随后会重载应用，
 * 不等待的话冷启动的 hydrateNativeStorage 可能拿旧值把刚恢复的配置盖回去。
 */
export async function writeRestoredKeys(entries: [string, unknown][]): Promise<void> {
  const mirrored: Promise<void>[] = []

  entries.forEach(([key, value]) => {
    const storageKey = PREFIX + key
    try {
      const serialized = JSON.stringify(value)
      localStorage.setItem(storageKey, serialized)
      if (key === READING_POSITION_KEY) return
      const pending = mirrorToNative(storageKey, serialized)
      if (pending) mirrored.push(pending)
    } catch (error) {
      log.storage.warn('restore write failed', key, error)
    }
  })

  await Promise.all(mirrored)
}

export interface CachedList {
  items: Article[]
  cachedAt: number
  paging?: CachedPagingMeta
}

export interface CachedPagingMeta {
  page?: number
  cursor?: string
  exhausted?: boolean
}

function compactCachedArticle(article: Article): Article {
  const { contentHtml: _contentHtml, ...metadata } = article
  return metadata
}

/**
 * 弱网优先出内容：只要没超过可用期就返回缓存，同时后台照常尝试刷新。
 */
export function loadCachedList(sourceId: string): CachedList | null {
  const entry = read<{ at: number; items: Article[]; paging?: CachedPagingMeta } | null>(
    `${LIST_CACHE_PREFIX}${sourceId}`,
    null,
  )
  if (!entry?.items?.length) return null

  const age = Date.now() - entry.at
  if (age > LIST_CACHE_MAX_AGE) {
    removeKeys([`${LIST_CACHE_PREFIX}${sourceId}`])
    return null
  }

  // 旧版本会把 Feed 全文一起放进列表缓存。读取时原位压缩，
  // 避免几十个来源的大段 HTML 挤占 Android WebView 的 DOM Storage 配额。
  const items = entry.items.map(compactCachedArticle)
  if (entry.items.some((item) => Boolean(item.contentHtml))) {
    write(
      `${LIST_CACHE_PREFIX}${sourceId}`,
      { at: entry.at, items, paging: entry.paging },
      { localOnly: true },
    )
  }

  return { items, cachedAt: entry.at, paging: entry.paging }
}

const scheduleTask =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
    ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 1500 })
    : (cb: () => void) => window.setTimeout(cb, 50)

export function saveCachedArticles(
  sourceId: string,
  items: Article[],
  paging?: CachedPagingMeta,
): void {
  const compactItems = items.slice(0, 160).map(compactCachedArticle)
  scheduleTask(() => {
    write(
      `${LIST_CACHE_PREFIX}${sourceId}`,
      { at: Date.now(), items: compactItems, paging },
      { localOnly: true },
    )
  })
}

export function loadIdSet(key: 'later' | 'read'): Set<string> {
  return new Set(read<string[]>(key, []))
}

let saveIdSetTimer: ReturnType<typeof setTimeout> | null = null
const pendingIdSets = new Map<string, string[]>()

export function saveIdSet(key: 'later' | 'read', ids: Set<string>): void {
  pendingIdSets.set(key, [...ids].slice(-500))
  if (saveIdSetTimer) return
  saveIdSetTimer = setTimeout(() => {
    saveIdSetTimer = null
    pendingIdSets.forEach((list, k) => {
      write(k, list)
    })
    pendingIdSets.clear()
  }, 250)
}

export function loadLaterArticles(): Article[] {
  const stored = read<Article[]>('later-items', [])
  const items = stored.map(compactCachedArticle)
  if (stored.some((item) => Boolean(item.contentHtml))) write('later-items', items)
  return items
}

export function saveLaterArticles(items: Article[]): void {
  const compactItems = items.slice(0, 100).map(compactCachedArticle)
  scheduleTask(() => {
    write('later-items', compactItems)
  })
}

export function clearListCache(): void {
  removeKeys(listKeys(LIST_CACHE_PREFIX))
}

export function listCacheStats(): { count: number; bytes: number } {
  const keys = listKeys(LIST_CACHE_PREFIX).filter((key) => {
    const raw = readRaw(key)
    if (!raw) return false
    try {
      const entry = JSON.parse(raw) as {
        at?: number
        items?: Article[]
        paging?: CachedPagingMeta
      }
      const valid =
        typeof entry.at === 'number' &&
        Array.isArray(entry.items) &&
        entry.items.length > 0 &&
        Date.now() - entry.at <= LIST_CACHE_MAX_AGE
      if (!valid) {
        removeKeys([key])
      } else if (entry.items!.some((item) => Boolean(item.contentHtml))) {
        write(
          key,
          { at: entry.at, items: entry.items!.map(compactCachedArticle), paging: entry.paging },
          { localOnly: true },
        )
      }
      return valid
    } catch {
      removeKeys([key])
      return false
    }
  })
  return { count: keys.length, bytes: bytesOfKeys(keys) }
}
