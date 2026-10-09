import {
  approxStoredBytes,
  listKeys,
  readRaw,
  removeLocalKeys,
  writeRawOrThrow,
} from './storage'
import { isPartialFeedTeaser, type BodySource } from './resolveBody'
import { hasEmbedNoise } from './sanitize'
import { hasBrokenTextEncoding } from './textEncoding'
import type { Article } from './types'

export const BODY_CACHE_PREFIX = 'body:v1:'
const INDEX_KEY = 'body:index'

/**
 * Capacitor Android 的 WebView DOM Storage 与列表、偏好共享配额。
 * 列表已压缩为元数据，正文仍主动限制在约 3MB，遇到真实配额不足时继续按 LRU 腾挪。
 */
const BODY_BUDGET_BYTES = 3 * 1024 * 1024

export interface CachedBody {
  html: string
  bodySource: BodySource
  /** v1 早期缓存没有该字段，读取时仍兼容，但不会出现在最近阅读中 */
  article?: Article
  savedAt: number
}

interface IndexEntry {
  bytes: number
  savedAt: number
  /** 最后一次读取时间，淘汰按此升序 */
  usedAt: number
  /** 稍后读等显式离线内容，淘汰时最后才动 */
  pinned?: boolean
}

type BodyIndex = Record<string, IndexEntry>

export interface CachedArticleEntry {
  article: Article
  savedAt: number
  usedAt: number
  pinned: boolean
  bytes: number
}

export interface BodyCacheStats {
  count: number
  bytes: number
  pinned: number
  pinnedBytes: number
}

function keyOf(articleId: string): string {
  return `${BODY_CACHE_PREFIX}${articleId}`
}

function parseBody(raw: string): CachedBody | null {
  try {
    const body = JSON.parse(raw) as CachedBody
    if (!body?.html || typeof body.html !== 'string') return null
    return hasBrokenTextEncoding(body.html) ? null : body
  } catch {
    return null
  }
}

function loadIndex(): BodyIndex {
  const raw = readRaw(INDEX_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as BodyIndex
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveIndex(index: BodyIndex): boolean {
  try {
    writeRawOrThrow(INDEX_KEY, JSON.stringify(index))
    return true
  } catch {
    return false
  }
}

/**
 * 索引不是正文是否存在的唯一真相。每次管理缓存前都以真实正文键为准：
 * - 移除损坏正文；
 * - 删除悬空索引；
 * - 为索引写入失败后遗留的正文补录体积。
 */
function reconcile(index: BodyIndex): BodyIndex {
  const next: BodyIndex = {}
  const invalidKeys: string[] = []
  const now = Date.now()

  for (const key of listKeys(BODY_CACHE_PREFIX)) {
    const articleId = key.slice(BODY_CACHE_PREFIX.length)
    const raw = readRaw(key)
    const body = raw ? parseBody(raw) : null
    if (!raw || !body) {
      invalidKeys.push(key)
      continue
    }

    const previous = index[articleId]
    next[articleId] = {
      bytes: approxStoredBytes(key, raw),
      savedAt: previous?.savedAt ?? body.savedAt ?? now,
      usedAt: previous?.usedAt ?? body.savedAt ?? now,
      ...(previous?.pinned ? { pinned: true } : {}),
    }
  }

  if (invalidKeys.length) removeLocalKeys(invalidKeys)
  return next
}

function loadReconciledIndex(): BodyIndex {
  const before = loadIndex()
  const next = reconcile(before)
  if (JSON.stringify(before) !== JSON.stringify(next)) saveIndex(next)
  return next
}

function totalBytes(index: BodyIndex): number {
  return Object.values(index).reduce((sum, entry) => sum + entry.bytes, 0)
}

/**
 * 腾出 needed 字节：先淘汰未固定的最久未读，仍不够时才动固定项。
 * preserveIds 用于更新当前正文时避免配额重试把刚写入目标选为牺牲项。
 */
function evict(index: BodyIndex, needed: number, preserveIds = new Set<string>()): BodyIndex {
  if (needed <= 0) return index

  const next = { ...index }
  const byPriority = Object.entries(next)
    .filter(([id]) => !preserveIds.has(id))
    .sort(([, a], [, b]) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? 1 : -1
      return a.usedAt - b.usedAt
    })

  let freed = 0
  const doomed: string[] = []
  for (const [id, entry] of byPriority) {
    if (freed >= needed) break
    doomed.push(id)
    freed += entry.bytes
    delete next[id]
  }

  if (doomed.length) removeLocalKeys(doomed.map(keyOf))
  return next
}

export function loadCachedBody(articleId: string): CachedBody | null {
  const key = keyOf(articleId)
  const raw = readRaw(key)
  if (!raw) return null

  const body = parseBody(raw)
  // 旧摘要 Feed / YouTube 占位文案 / 误判付费墙兜底缓存，丢弃后重新抽取
  const stale =
    Boolean(body) &&
    ((body!.bodySource === 'feed' && isPartialFeedTeaser(body!.html)) ||
      body!.bodySource === 'blocked' ||
      hasEmbedNoise(body!.html) ||
      /站内无法嵌入\s*YouTube/i.test(body!.html) ||
      /原站暂不支持站内阅读/i.test(body!.html))
  if (!body || stale) {
    removeLocalKeys([key])
    const index = loadIndex()
    if (index[articleId]) {
      delete index[articleId]
      saveIndex(index)
    }
    return null
  }

  const index = loadReconciledIndex()
  const entry = index[articleId]
  if (entry) {
    saveIndex({ ...index, [articleId]: { ...entry, usedAt: Date.now() } })
  }

  return body
}

export function saveCachedBody(
  article: Article,
  body: Omit<CachedBody, 'article' | 'savedAt'>,
  options?: { pinned?: boolean },
): boolean {
  if (hasBrokenTextEncoding(body.html)) return false

  const now = Date.now()
  const payload: CachedBody = { ...body, article, savedAt: now }
  const serialized = JSON.stringify(payload)
  const key = keyOf(article.id)
  const bytes = approxStoredBytes(key, serialized)

  // 单篇就超预算说明内容异常（例如整页 base64），不缓存。
  if (bytes > BODY_BUDGET_BYTES / 2) return false

  let index = loadReconciledIndex()
  const previous = index[article.id]
  const previousRaw = readRaw(key)
  const pinned = options?.pinned ?? previous?.pinned ?? false

  const projected = totalBytes(index) - (previous?.bytes ?? 0) + bytes
  if (projected > BODY_BUDGET_BYTES) {
    delete index[article.id]
    index = evict(index, projected - BODY_BUDGET_BYTES)
  }

  try {
    writeRawOrThrow(key, serialized)
  } catch {
    // 实际 WebView 配额可能小于名义预算，再腾四分之一预算后重试。
    index = evict(index, Math.max(BODY_BUDGET_BYTES / 4, bytes), new Set([article.id]))
    try {
      writeRawOrThrow(key, serialized)
    } catch {
      if (previous) index[article.id] = previous
      saveIndex(index)
      return false
    }
  }

  const nextIndex = {
    ...index,
    [article.id]: {
      bytes,
      savedAt: now,
      usedAt: now,
      ...(pinned ? { pinned: true } : {}),
    },
  }

  if (saveIndex(nextIndex)) return true

  // 索引无法落盘时回滚当前正文，避免制造不受预算控制的孤立缓存。
  try {
    if (previousRaw) writeRawOrThrow(key, previousRaw)
    else removeLocalKeys([key])
  } catch {
    removeLocalKeys([key])
  }
  if (previous) index[article.id] = previous
  saveIndex(index)
  return false
}

/** 稍后读集合变化时以业务状态为准，修复异步预取或旧版本留下的固定标记。 */
export function syncBodyPins(articleIds: Set<string>): void {
  const index = loadReconciledIndex()
  let changed = false
  const next: BodyIndex = {}

  for (const [id, entry] of Object.entries(index)) {
    const pinned = articleIds.has(id)
    if (Boolean(entry.pinned) !== pinned) changed = true
    next[id] = { ...entry, ...(pinned ? { pinned: true } : {}) }
    if (!pinned) delete next[id].pinned
  }

  if (changed) saveIndex(next)
}

/** 稍后读加入 / 移出时切换固定状态，控制淘汰优先级。 */
export function setBodyPinned(articleId: string, pinned: boolean): void {
  const index = loadReconciledIndex()
  const entry = index[articleId]
  if (!entry) return

  const next = { ...entry, ...(pinned ? { pinned: true } : {}) }
  if (!pinned) delete next.pinned
  saveIndex({ ...index, [articleId]: next })
}

export function hasCachedBody(articleId: string): boolean {
  const key = keyOf(articleId)
  const raw = readRaw(key)
  if (!raw) return false
  if (parseBody(raw)) return true
  removeLocalKeys([key])
  return false
}

export function listCachedArticles(limit = 30): CachedArticleEntry[] {
  const index = loadReconciledIndex()
  return Object.entries(index)
    .sort(([, a], [, b]) => b.usedAt - a.usedAt)
    .flatMap(([id, entry]) => {
      const raw = readRaw(keyOf(id))
      const body = raw ? parseBody(raw) : null
      if (!body?.article) return []
      return [
        {
          article: body.article,
          savedAt: entry.savedAt,
          usedAt: entry.usedAt,
          pinned: Boolean(entry.pinned),
          bytes: entry.bytes,
        },
      ]
    })
    .slice(0, limit)
}

export function bodyCacheStats(): BodyCacheStats {
  const index = loadReconciledIndex()
  const entries = Object.values(index)
  const pinnedEntries = entries.filter((entry) => entry.pinned)
  return {
    count: entries.length,
    bytes: totalBytes(index),
    pinned: pinnedEntries.length,
    pinnedBytes: pinnedEntries.reduce((sum, entry) => sum + entry.bytes, 0),
  }
}

export function clearBodyCache(options?: { includePinned?: boolean }): void {
  const includePinned = options?.includePinned ?? true
  const index = loadReconciledIndex()

  if (includePinned) {
    removeLocalKeys([...listKeys(BODY_CACHE_PREFIX), INDEX_KEY])
    return
  }

  const removable = Object.entries(index)
    .filter(([, entry]) => !entry.pinned)
    .map(([id]) => id)
  if (!removable.length) return

  removeLocalKeys(removable.map(keyOf))
  const next = { ...index }
  removable.forEach((id) => delete next[id])
  saveIndex(next)
}
