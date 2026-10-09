import type { Page, ZhihuContentSummary, ZhihuFeedMode, ZhihuRecommendationMode } from '../types'

// v2：v1 可能已经把 19 位知乎 numeric id 经 JSON.parse 四舍五入后缓存成错误字符串。
// 升级时必须主动淘汰，否则网络抖动时仍会从旧缓存打开“内容不存在”的回答。
const CACHE_VERSION = 2
const CACHE_PREFIX = 'newsnook:zhihu:public-feed:v1:'
const MAX_ITEMS = 120
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface ZhihuPublicCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface CacheEnvelope {
  version: number
  savedAt: number
  page: Page<ZhihuContentSummary>
}

function browserStorage(): ZhihuPublicCacheStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function keyFor(mode: ZhihuFeedMode, recommendationMode: ZhihuRecommendationMode): string | null {
  // 关注流属于账号作用域，绝不能进入公共 localStorage 缓存。
  if (mode === 'following') return null
  // 本地/智能模式都包含用户画像衍生排序；智能模式登录后还可能混入关注动态。
  // 两者都不能进入不分账号的“公共 feed cache”。
  if (mode === 'recommended' && (recommendationMode === 'local' || recommendationMode === 'smart')) return null
  return mode === 'recommended'
    ? `${CACHE_PREFIX}${mode}:${recommendationMode}`
    : `${CACHE_PREFIX}${mode}`
}

function looksLikeSummary(value: unknown): value is ZhihuContentSummary {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ZhihuContentSummary>
  return typeof item.title === 'string' && typeof item.excerpt === 'string' && typeof item.url === 'string'
    && Boolean(item.ref && typeof item.ref.id === 'string' && typeof item.ref.kind === 'string')
}

export function loadZhihuPublicFeedCache(
  mode: ZhihuFeedMode,
  storage: ZhihuPublicCacheStorage | null | undefined = browserStorage(),
  now = Date.now(),
  recommendationMode: ZhihuRecommendationMode = 'android',
): Page<ZhihuContentSummary> | null {
  const key = keyFor(mode, recommendationMode)
  if (!key || !storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const envelope = JSON.parse(raw) as Partial<CacheEnvelope>
    if (envelope.version !== CACHE_VERSION || typeof envelope.savedAt !== 'number' || now - envelope.savedAt > MAX_AGE_MS) {
      storage.removeItem(key)
      return null
    }
    const page = envelope.page
    if (!page || !Array.isArray(page.items) || !page.items.every(looksLikeSummary)) {
      storage.removeItem(key)
      return null
    }
    return {
      items: page.items.slice(0, MAX_ITEMS),
      nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : undefined,
      hasMore: page.hasMore === true,
    }
  } catch {
    return null
  }
}

export function saveZhihuPublicFeedCache(
  mode: ZhihuFeedMode,
  page: Page<ZhihuContentSummary>,
  storage: ZhihuPublicCacheStorage | null | undefined = browserStorage(),
  now = Date.now(),
  recommendationMode: ZhihuRecommendationMode = 'android',
): void {
  const key = keyFor(mode, recommendationMode)
  if (!key || !storage) return
  try {
    const envelope: CacheEnvelope = {
      version: CACHE_VERSION,
      savedAt: now,
      page: { ...page, items: page.items.slice(0, MAX_ITEMS) },
    }
    storage.setItem(key, JSON.stringify(envelope))
  } catch {
    // quota/禁用存储不能阻断公开阅读；私有草稿不会复用此容错策略。
  }
}
