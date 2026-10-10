import { previewFeed } from '../feedDiscovery/preview'
import type { FeedDiscoveryPreviewFailureKind, FeedDiscoveryPreviewSuccess } from '../feedDiscovery/types'
import { getRssHubCooldown } from './fetch'
import { isSensitiveRssHubRoute, rssHubFeedUrl, validateRssHubRoutePath, type RssHubInstance } from './instances'

export type RssHubProbeState = 'checking' | 'available' | 'unavailable' | 'needs-input'
export interface RssHubProbeResult {
  state: RssHubProbeState
  routePath: string
  instanceId?: string
  feedUrl?: string
  feed?: FeedDiscoveryPreviewSuccess
  attempts: number
  detail?: string
  failureKind?: FeedDiscoveryPreviewFailureKind
}

/** In-memory per-route preference: independently favor successful instances on later searches. */
const lastGood = new Map<string, string>()
const ROUTE_LIMIT = 8
const INSTANCE_LIMIT = 4
const PARALLEL_ROUTES = 3
const TOTAL_BUDGET_MS = 16_000
const SINGLE_ATTEMPT_MS = 6_000

export function selectRssHubProbeInstances(
  routePath: string,
  instances: readonly RssHubInstance[],
  preferredId?: string,
): RssHubInstance[] {
  validateRssHubRoutePath(routePath)
  const eligible = instances.filter((item) => item.enabled)
  const preferred = eligible.find((item) => item.id === preferredId)
  // Only a user explicitly selecting a custom instance may transmit requests to
  // that trust group; a website URL / logical route always discovers with public defaults.
  const group = preferred?.builtin === false ? eligible.filter((item) => !item.builtin) :
    eligible.filter((item) => item.builtin)
  const sensitive = isSensitiveRssHubRoute(routePath)
  if (sensitive) return preferred ? [preferred] : []
  const family = routePath.split('?')[0].split('/').slice(0, 4).join('/')
  const known = group.find((item) => item.id === lastGood.get(family))
  return [known, preferred, ...group]
    .filter((item): item is RssHubInstance => Boolean(item))
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
    .sort((a, b) => Number(getRssHubCooldown(a.id, routePath) > 0) - Number(getRssHubCooldown(b.id, routePath) > 0))
    .slice(0, INSTANCE_LIMIT)
}

export async function probeRssHubRoute(
  routePath: string,
  instances: readonly RssHubInstance[],
  signal: AbortSignal,
  preferredId?: string,
  preview: typeof previewFeed = previewFeed,
): Promise<RssHubProbeResult> {
  const candidates = selectRssHubProbeInstances(routePath, instances, preferredId)
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  if (!candidates.length) return { state: 'unavailable', routePath, attempts: 0,
    detail: isSensitiveRssHubRoute(routePath) ? '私密路由须指定绑定实例，不会发送给公共服务器' : '没有启用的 RSSHub 服务' }
  let lastFailure: RssHubProbeResult = { state: 'unavailable', routePath, attempts: 0, detail: '所有尝试均未返回可用的 RSS' }
  for (const instance of candidates) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const url = rssHubFeedUrl(instance, routePath)
    const outcome = await preview(url, { signal, timeoutMs: SINGLE_ATTEMPT_MS })
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (outcome.ok) {
      const family = routePath.split('?')[0].split('/').slice(0, 4).join('/')
      lastGood.set(family, instance.id)
      if (lastGood.size > 300) lastGood.delete(lastGood.keys().next().value!)
      return { state: 'available', routePath, instanceId: instance.id, feedUrl: url, feed: outcome,
        attempts: lastFailure.attempts + 1, detail: outcome.itemCount + ' 篇文章' }
    }
    lastFailure = { state: 'unavailable', routePath, attempts: lastFailure.attempts + 1,
      failureKind: outcome.kind, detail: outcome.message }
    if (outcome.kind === 'aborted') throw new DOMException('Aborted', 'AbortError')
  }
  return lastFailure
}

/** Fixed-size pool, total time budget and progressive updates. No route×instance request storm. */
export async function probeRssHubRoutes(
  routes: readonly string[],
  instances: readonly RssHubInstance[],
  signal: AbortSignal,
  onResult: (result: RssHubProbeResult) => void,
  preferredId?: string,
  probe: typeof probeRssHubRoute = probeRssHubRoute,
): Promise<void> {
  const unique = [...new Set(routes)].slice(0, ROUTE_LIMIT)
  const ctl = new AbortController()
  const cancel = () => ctl.abort()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = globalThis.setTimeout(cancel, TOTAL_BUDGET_MS)
  let cursor = 0
  const worker = async () => {
    while (!ctl.signal.aborted && cursor < unique.length) {
      const route = unique[cursor++]
      try {
        const result = await probe(route, instances, ctl.signal, preferredId)
        if (!ctl.signal.aborted) onResult(result)
      } catch {
        if (!ctl.signal.aborted) onResult({ state: 'unavailable', routePath: route, attempts: 0, detail: '检测失败，请重试' })
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_ROUTES, unique.length) }, worker))
  } finally {
    globalThis.clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    ctl.abort()
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}
