import { fetchAbsoluteText } from '../../lib/http'
import { validateFeedUrl } from './routeBuilder'
import { discoverSiteFeeds } from './siteDiscovery'
import { discoverRssHubRadar } from '../rsshub/radar'
import { DEFAULT_RSSHUB_INSTANCES, validateRssHubRoutePath, type RssHubInstance } from '../rsshub/instances'
import type { FeedDiscoveryEntry } from './types'

export function websiteSearchUrl(query: string): string | null {
  const value = query.trim()
  if (/^https?:\/\//i.test(value)) return validateFeedUrl(value)
  if (/^[\w.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value)) return validateFeedUrl('https://' + value)
  return null
}

/** Query the remote index; retain only these bounded results in the caller's UI state. */
export async function searchOnlineFeeds(query: string, signal?: AbortSignal, instances: readonly RssHubInstance[] = DEFAULT_RSSHUB_INSTANCES): Promise<FeedDiscoveryEntry[]> {
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
      // A pasted feed link for a configured RSSHub instance already contains a
      // logical route. Do not download the Radar catalog or probe the service
      // merely to recognize it; preview will validate the actual feed.
      const parsed = new URL(siteUrl)
      const instance = instances.find((item) => item.url === parsed.origin)
      if (instance) {
        let route: string
        try { route = validateRssHubRoutePath(parsed.pathname + parsed.search) } catch {
          throw new Error('输入的 RSSHub 订阅路径无效')
        }
        if (route === '/') throw new Error('请输入完整的 RSSHub 路由，而不是实例主页')
        return [{
          providerId: 'rsshub', entryId: 'rsshub:direct:' + route,
          type: 'rsshub', title: 'RSSHub 订阅 · ' + route.split('/').filter(Boolean).slice(0, 2).join(' / '),
          categories: [], siteUrl, feedUrl: siteUrl,
          routeTemplate: route, routePath: route,
          parameters: {}, missingParameters: [], instanceId: instance.id,
          statusNote: instance.enabled ? '已识别 RSSHub 路由，订阅前仍需实际预览' : '对应实例当前已停用，请先在实例管理中启用',
        }]
      }
      // Remote Feedsearch and RSSHub Radar fail independently. One unavailable
      // service must not hide candidates discovered by the other.
      const [direct, radar] = await Promise.allSettled([
        discoverSiteFeeds(siteUrl, controller.signal),
        discoverRssHubRadar(siteUrl, instances, controller.signal),
      ])
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const entries = direct.status === 'fulfilled' ? direct.value : []
      const converted = radar.status === 'fulfilled' ? radar.value : []
      const radarFailed = radar.status === 'rejected'
      // The entered URL is only a detection candidate: never auto-subscribe HTML.
      return deduplicateEntries([
        ...entries.slice(0, 18), ...converted, {
          providerId: 'direct-discovery', entryId: siteUrl, type: 'direct', title: '检测输入的网址',
          categories: [], feedUrl: siteUrl, siteUrl,
          statusNote: radarFailed ? 'RSSHub 规则服务暂不可用，仍可检测原始网址' : undefined,
        }, ...entries.slice(18),
      ])
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
    const key = entry.type === 'rsshub' ? entry.entryId : entry.feedUrl
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 40)
}
