import { fetchAbsoluteText } from '../../lib/http'
import { validateFeedUrl } from './routeBuilder'
import { discoverSiteFeeds } from './siteDiscovery'
import type { FeedDiscoveryEntry } from './types'

export function websiteSearchUrl(query: string): string | null {
  const value = query.trim()
  if (/^https?:\/\//i.test(value)) return validateFeedUrl(value)
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value)) return validateFeedUrl('https://' + value)
  return null
}

/** Query the remote index; retain only these bounded results in the caller's UI state. */
export async function searchOnlineFeeds(query: string, signal?: AbortSignal): Promise<FeedDiscoveryEntry[]> {
  const value = query.trim()
  if (!value) return []
  if (value.length > 300) throw new Error('搜索内容过长，请缩短后重试')
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  if (signal?.aborted) forwardAbort()
  const timer = globalThis.setTimeout(() => controller.abort(), 30_000)
  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const siteUrl = websiteSearchUrl(value)
    if (siteUrl) {
      let entries: FeedDiscoveryEntry[] = []
      try { entries = await discoverSiteFeeds(siteUrl, controller.signal) } catch (error) {
        if (controller.signal.aborted) throw error
        // A direct Feed URL can still be checked when the website discovery service fails.
      }
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      // The entered address is also a candidate: preview, never silently subscribe it.
      return deduplicateEntries([...entries, { providerId: 'direct-discovery', entryId: siteUrl, type: 'direct', title: '检测输入的网址', categories: [], feedUrl: siteUrl, siteUrl }])
    }
    const endpoint = new URL('https://cloud.feedly.com/v3/search/feeds')
    endpoint.searchParams.set('query', value)
    endpoint.searchParams.set('count', '40')
    const payload = await fetchAbsoluteText(endpoint.toString(), { signal: controller.signal, accept: 'application/json' })
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (new TextEncoder().encode(payload).length > 2 * 1024 * 1024) throw new Error('搜索响应过大，请缩小搜索范围')
    const parsed = JSON.parse(payload) as { results?: unknown }
    if (!Array.isArray(parsed.results)) throw new Error('在线搜索返回格式不正确')
    const entries: FeedDiscoveryEntry[] = []
    for (const raw of parsed.results.slice(0, 40)) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const id = typeof row.feedId === 'string' ? row.feedId : row.id
      if (typeof id !== 'string' || !id.startsWith('feed/')) continue
      try {
        const feedUrl = validateFeedUrl(id.slice(5))
        let siteUrl: string | undefined
        try { siteUrl = typeof row.website === 'string' ? validateFeedUrl(row.website) : undefined } catch { /* optional website */ }
        entries.push({ providerId: 'feedly', entryId: feedUrl, type: 'direct', title: typeof row.title === 'string' ? row.title.trim().slice(0, 300) || feedUrl : feedUrl, description: typeof row.description === 'string' ? row.description.slice(0, 1000) : undefined, categories: [], feedUrl, siteUrl, statusNote: '在线搜索命中；订阅前需实际预览' })
      } catch { /* ignore invalid feed URLs */ }
    }
    return deduplicateEntries(entries)
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (controller.signal.aborted) throw new Error('在线搜索超时，请重试')
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function deduplicateEntries(entries: FeedDiscoveryEntry[]): FeedDiscoveryEntry[] {
  const seen = new Set<string>()
  return entries.filter((entry) => {
    if (!entry.feedUrl || seen.has(entry.feedUrl)) return false
    seen.add(entry.feedUrl)
    return true
  }).slice(0, 40)
}
