/**
 * RSSHub fetch selection, scoped failure cooldown and bounded fallback.
 * Reading uses the same HTTP transport and Feed parser as all other NewsNook sources.
 */
import type { NewsSource } from '../../sources/registry'
import {
  DEFAULT_RSSHUB_INSTANCES,
  isSensitiveRssHubRoute,
  normalizeRssHubInstances,
  rssHubFeedUrl,
  validateRssHubRoutePath,
  type RssHubInstance,
} from './instances'

const INSTANCE_TIMEOUT_MS = 8_000
const COOLDOWN_MS = 3 * 60_000
const MAX_ATTEMPTS = 2
const cooldown = new Map<string, number>()
const sticky = new Map<string, string>()

let runtimeInstances: RssHubInstance[] = normalizeRssHubInstances(DEFAULT_RSSHUB_INSTANCES)

export function setRuntimeRssHubInstances(instances: RssHubInstance[]): void {
  runtimeInstances = normalizeRssHubInstances(instances)
}

export function getRuntimeRssHubInstances(): readonly RssHubInstance[] {
  return runtimeInstances
}

export function getRssHubCooldown(instanceId: string, routePath?: string): number {
  if (routePath !== undefined) {
    return Math.max(0, (cooldown.get(cooldownKey(instanceId, routePath)) ?? 0) - Date.now())
  }
  let until = 0
  for (const [key, expiry] of cooldown) {
    if (key.startsWith(instanceId + ':')) until = Math.max(until, expiry)
  }
  return Math.max(0, until - Date.now())
}

function routeFamily(routePath: string): string {
  return routePath.split('/').slice(0, 3).join('/')
}
function cooldownKey(instanceId: string, routePath: string): string {
  return instanceId + ':' + routeFamily(routePath)
}
function timeoutSignal(parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const ctl = new AbortController()
  const onAbort = () => ctl.abort(parent?.reason)
  parent?.addEventListener('abort', onAbort, { once: true })
  if (parent?.aborted) onAbort()
  const timer = globalThis.setTimeout(() => ctl.abort(new DOMException('RSSHub timeout', 'TimeoutError')), INSTANCE_TIMEOUT_MS)
  return { signal: ctl.signal, dispose: () => { globalThis.clearTimeout(timer); parent?.removeEventListener('abort', onAbort) } }
}

export function isRssHubFeedPayload(payload: string): boolean {
  const head = payload.slice(0, 1000).replace(/^\uFEFF/, '').trim()
  if (/^(?:<\?xml\b[^>]*>\s*)?(?:<rss\b|<feed\b|<(?:rdf:)?RDF\b)/i.test(head)) return true
  if (!head.startsWith('{')) return false
  try {
    const doc: unknown = JSON.parse(payload)
    return Boolean(doc && typeof doc === 'object' && !Array.isArray(doc) &&
      Array.isArray((doc as { items?: unknown }).items) &&
      typeof (doc as { version?: unknown }).version === 'string')
  } catch { return false }
}

function isRetryableError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  const code = /HTTP\s+(\d{3})/.exec(text)
  if (code) {
    const number = Number(code[1])
    return [403, 404, 408, 429].includes(number) || number >= 500
  }
  return /(?:timeout|timed out|network|fetch|连接|网络|超时|DNS|非有效 RSS|不是 RSS)/i.test(text) ||
    error instanceof DOMException && error.name === 'AbortError'
}

export async function fetchRssHubSourceText(
  source: NewsSource,
  signal: AbortSignal | undefined,
  fetcher: (url: string, signal: AbortSignal) => Promise<string>,
): Promise<string> {
  const routePath = source.discovery?.routeKey
  if (source.discovery?.generator !== 'rsshub' || !routePath) {
    const ctl = timeoutSignal(signal)
    try { return await fetcher(source.url, ctl.signal) } finally { ctl.dispose() }
  }
  try { validateRssHubRoutePath(routePath) } catch { throw new Error('RSSHub 订阅路由格式无效') }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

  // Trust boundaries: built-in public servers can fail over to other built-ins;
  // private user-configured servers can only fail over to other configured
  // private servers. Never silently forward a private route to a public host.
  const savedUrl = new URL(source.url)
  const configured = runtimeInstances.find((item) => item.url === savedUrl.origin)
  const allowFallback = Boolean(configured) &&
    !isSensitiveRssHubRoute(routePath) && !isSensitiveRssHubRoute(source.url)
  const trustGroup = runtimeInstances.filter((item) => item.enabled &&
    item.builtin === configured?.builtin)
  const hinted = sticky.get((configured?.builtin ? 'public:' : 'custom:') + routePath)
  const preferred = trustGroup.find((item) => item.id === hinted)
  const ordered = [preferred, configured?.enabled ? configured : undefined, ...trustGroup]
    .filter((item): item is RssHubInstance => Boolean(item))
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
    .filter((item) => getRssHubCooldown(item.id, routePath) === 0)
  let targetUrls: Array<{ id: string; url: string }> = []
  if (allowFallback) {
    targetUrls = ordered.map((item) => ({ id: item.id, url: rssHubFeedUrl(item, routePath) }))
  } else if (!configured || configured.enabled) {
    // Keep imported / legacy single-instance subscriptions operational. Do
    // not attempt to "repair" their origin with a public third-party server.
    targetUrls = [{ id: configured?.id ?? 'saved-instance', url: source.url }]
  }
  if (!targetUrls.length) {
    throw new Error(configured && !configured.enabled && !allowFallback
      ? 'RSSHub 绑定实例已停用，请在服务管理中启用或更换'
      : 'RSSHub 当前没有可用实例，请稍后重试')
  }

  let lastError: unknown
  for (const target of targetUrls.slice(0, allowFallback ? MAX_ATTEMPTS : 1)) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const ctl = timeoutSignal(signal)
    try {
      const payload = await fetcher(target.url, ctl.signal)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!isRssHubFeedPayload(payload)) throw new Error('RSSHub 返回的内容不是有效 RSS/Atom/JSON Feed')
      cooldown.delete(cooldownKey(target.id, routePath))
      if (allowFallback) {
        sticky.set((configured?.builtin ? 'public:' : 'custom:') + routePath, target.id)
        if (sticky.size > 500) sticky.delete(sticky.keys().next().value!)
      }
      return payload
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      lastError = error
      if (!isRetryableError(error)) break
      cooldown.set(cooldownKey(target.id, routePath), Date.now() + COOLDOWN_MS)
      // Bound process-lifetime metadata even after thousands of distinct route families.
      if (cooldown.size > 500) {
        const now = Date.now()
        for (const [key, expiry] of cooldown) if (expiry <= now) cooldown.delete(key)
        if (cooldown.size > 500) cooldown.delete(cooldown.keys().next().value!)
      }
    } finally {
      ctl.dispose()
    }
  }
  throw lastError instanceof Error ? lastError : new Error('RSSHub 当前实例无法获取订阅内容')
}

export function resetRssHubHealthForTest(): void {
  cooldown.clear()
  sticky.clear()
  setRuntimeRssHubInstances([...DEFAULT_RSSHUB_INSTANCES])
}
