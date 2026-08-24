/**
 * 长文阅读位置记忆：按文章 id 记住上次读到哪里，跨会话恢复。
 *
 * - 滚动阅读记 `scrollTop` 与当时的内容高度，换字号/换设备后按比例回落；
 * - 墨水屏分页记 `pageIndex`，重新分页时仍以比例为准兜底；
 * - 单键 `newsnook:reading-pos` 存整张表，按最近更新时间截断，避免无限增长。
 */

import { log } from './logger'
import { loadReadingPositions, saveReadingPositions } from './storage'

/** 表容量上限：单条约 80 字节，满表仍在 30KB 量级，远低于正文缓存预算 */
export const READING_POSITION_LIMIT = 240

/** 顶部这点距离视作「还没开始读」，不值得下次弹回 */
const MIN_TRACKED_SCROLL_TOP = 120

/** 已经读到结尾就别把人再送回末尾，下次从头开始更符合预期 */
const NEAR_END_RATIO = 0.97

export interface ReadingPosition {
  /** 滚动阅读的像素位置 */
  scrollTop: number
  /** 记录时的可滚动高度（scrollHeight - clientHeight），用于按比例还原 */
  scrollRange?: number
  /** 墨水屏分页模式的页码 */
  pageIndex?: number
  updatedAt: number
}

export type ReadingPositionMap = Record<string, ReadingPosition>

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 读入持久化数据时丢掉脏条目，脏表不应该让整个阅读器失效 */
export function normalizeReadingPositions(raw: unknown): ReadingPositionMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const map: ReadingPositionMap = {}

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== 'object') continue
    const entry = value as Partial<ReadingPosition>
    const scrollTop = isFiniteNumber(entry.scrollTop) ? Math.max(0, Math.round(entry.scrollTop)) : 0
    const pageIndex =
      isFiniteNumber(entry.pageIndex) && entry.pageIndex >= 0
        ? Math.round(entry.pageIndex)
        : undefined
    if (!scrollTop && pageIndex === undefined) continue

    map[id] = {
      scrollTop,
      ...(isFiniteNumber(entry.scrollRange) && entry.scrollRange > 0
        ? { scrollRange: Math.round(entry.scrollRange) }
        : {}),
      ...(pageIndex !== undefined ? { pageIndex } : {}),
      updatedAt: isFiniteNumber(entry.updatedAt) ? entry.updatedAt : 0,
    }
  }

  return prune(map)
}

/** 超出容量时按最近更新时间淘汰，保证常读的文章不会被冷门条目挤掉 */
export function prune(map: ReadingPositionMap, limit = READING_POSITION_LIMIT): ReadingPositionMap {
  const ids = Object.keys(map)
  if (ids.length <= limit) return map

  const kept = ids
    .sort((a, b) => (map[b]?.updatedAt ?? 0) - (map[a]?.updatedAt ?? 0))
    .slice(0, limit)

  const next: ReadingPositionMap = {}
  kept.forEach((id) => {
    next[id] = map[id]!
  })
  return next
}

/**
 * 写入一条位置。返回新表；无实际变化时原样返回，便于调用方跳过持久化。
 * 顶部附近与读到结尾都视为「无需记忆」，会清掉旧记录。
 */
export function withPosition(
  map: ReadingPositionMap,
  articleId: string,
  patch: Omit<ReadingPosition, 'updatedAt'>,
  now = Date.now(),
  limit = READING_POSITION_LIMIT,
): ReadingPositionMap {
  if (!articleId) return map

  const scrollTop = Math.max(0, Math.round(patch.scrollTop))
  const scrollRange =
    isFiniteNumber(patch.scrollRange) && patch.scrollRange > 0
      ? Math.round(patch.scrollRange)
      : undefined
  const nearEnd = scrollRange ? scrollTop / scrollRange >= NEAR_END_RATIO : false
  const trivial = scrollTop < MIN_TRACKED_SCROLL_TOP && !patch.pageIndex

  if (trivial || nearEnd) {
    if (!(articleId in map)) return map
    const next = { ...map }
    delete next[articleId]
    return next
  }

  const previous = map[articleId]
  if (
    previous &&
    previous.scrollTop === scrollTop &&
    previous.scrollRange === scrollRange &&
    previous.pageIndex === patch.pageIndex
  ) {
    return map
  }

  return prune(
    {
      ...map,
      [articleId]: {
        scrollTop,
        ...(scrollRange ? { scrollRange } : {}),
        ...(patch.pageIndex !== undefined ? { pageIndex: patch.pageIndex } : {}),
        updatedAt: now,
      },
    },
    limit,
  )
}

/**
 * 按当前可滚动高度换算目标位置。
 * 记录时的高度与现在不一致（改了字号、换了设备、图片加载完），按比例折算更接近原来读到的段落。
 */
export function resolveScrollTop(position: ReadingPosition, currentRange: number): number {
  if (currentRange <= 0) return 0
  const { scrollTop, scrollRange } = position
  if (!scrollRange || Math.abs(scrollRange - currentRange) <= 8) {
    return Math.min(scrollTop, currentRange)
  }
  return Math.min(Math.round((scrollTop / scrollRange) * currentRange), currentRange)
}

let cache: ReadingPositionMap | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function currentMap(): ReadingPositionMap {
  if (!cache) cache = normalizeReadingPositions(loadReadingPositions())
  return cache
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushReadingPositions()
  }, 800)
}

export function flushReadingPositions(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!cache) return
  try {
    saveReadingPositions(cache)
  } catch (error) {
    log.reader.warn('reading position flush failed', error)
  }
}

export function readingPositionOf(articleId: string): ReadingPosition | null {
  return currentMap()[articleId] ?? null
}

/** 滚动过程中高频调用：只更新内存表，节流后统一落盘 */
export function rememberReadingPosition(
  articleId: string,
  patch: Omit<ReadingPosition, 'updatedAt'>,
): void {
  const next = withPosition(currentMap(), articleId, patch)
  if (next === cache) return
  cache = next
  scheduleFlush()
}

export function forgetReadingPosition(articleId: string): void {
  const map = currentMap()
  if (!(articleId in map)) return
  const next = { ...map }
  delete next[articleId]
  cache = next
  scheduleFlush()
}

/** 备份恢复 / 清空存储后需要丢掉内存副本，下次读取重新从 localStorage 加载 */
export function resetReadingPositionCache(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  cache = null
}
