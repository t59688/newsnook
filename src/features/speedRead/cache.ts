import type { CloudTranslationConfig } from '../translation/types'

const STORAGE_KEY = 'newsnook:speed-read:v1'
const MAX_ENTRIES = 32
const PROMPT_VERSION = 'speed-read-v1'

interface CacheEntry {
  key: string
  markdown: string
  updatedAt: number
}

function hashString(value: string): string {
  // FNV-1a 32-bit: deterministic, tiny, and supported by old Android WebViews.
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function speedReadCacheKey(
  articleId: string,
  title: string,
  html: string,
  config: Pick<CloudTranslationConfig, 'endpoint' | 'model'>,
): string {
  return `${articleId}:${hashString(
    `${PROMPT_VERSION}\u0000${config.endpoint}\u0000${config.model || ''}\u0000${title}\u0000${html}`,
  )}`
}

function readEntries(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is CacheEntry => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<CacheEntry>
      return (
        typeof candidate.key === 'string' &&
        typeof candidate.markdown === 'string' &&
        typeof candidate.updatedAt === 'number'
      )
    })
  } catch {
    return []
  }
}

export function loadSpeedReadCache(key: string): string | null {
  if (typeof localStorage === 'undefined') return null
  const entry = readEntries().find((item) => item.key === key)
  return entry?.markdown || null
}

export function saveSpeedReadCache(key: string, markdown: string): void {
  if (typeof localStorage === 'undefined' || !markdown.trim()) return
  try {
    const entries = readEntries().filter((item) => item.key !== key)
    entries.unshift({ key, markdown: markdown.trim(), updatedAt: Date.now() })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Cache is an optimization only; private/incognito storage failures must not break reading.
  }
}
