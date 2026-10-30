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
const ROUTE_LIMIT = 20
const INSTANCE_LIMIT = 8
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
  const group = preferred && !preferred.builtin ? eligible.filter((item) => !item.builtin) :
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
  const ctl = new AbortController()
  const cancel = () => ctl.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const timer = globalThis.setTimeout(cancel, TOTAL_BUDGET_MS)
  let attempts = 0
  let cursor = 0
  let success: RssHubProbeResult | undefined
  let lastFailure: RssHubProbeResult = { state: 'unavailable', routePath, attempts: 0, detail: '所有尝试均未返回可用的 RSS' }
  const check = async (instance: RssHubInstance) => {
    const url = rssHubFeedUrl(instance, routePath)
    attempts++
    const outcome = await preview(url, { signal: ctl.signal, timeoutMs: SINGLE_ATTEMPT_MS })
    if (ctl.signal.aborted) return
    if (outcome.ok) {
      const family = routePath.split('?')[0].split('/').slice(0, 4).join('/')
      lastGood.set(family, instance.id)
      if (lastGood.size > 300) lastGood.delete(lastGood.keys().next().value!)
      success = { state: 'available', routePath, instanceId: instance.id, feedUrl: url, feed: outcome,
        attempts, detail: outcome.itemCount + ' 篇文章' }
      ctl.abort()
    } else {
      lastFailure = { state: 'unavailable', routePath, attempts,
        failureKind: outcome.kind, detail: outcome.message }
    }
  }
  const worker = async () => {
    while (!ctl.signal.aborted && cursor < candidates.length) await check(candidates[cursor++])
  }
  try {
    // Give a remembered / explicitly selected instance the first chance, then
    // use two bounded workers so slow failures cannot hide later public servers.
    await check(candidates[cursor++])
    if (!ctl.signal.aborted) await Promise.all([worker(), worker()])
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (success) return success
    const detail = ctl.signal.aborted ? '检测超时，请重试或选择服务实例' : lastFailure.detail
    const restrictedPlatform = /^\/twitter\//.test(routePath) ? 'X' : /^\/weibo\//.test(routePath) ? '微博' : null
    return { ...lastFailure, attempts,
      detail: restrictedPlatform && attempts > 1
        ? `已尝试 ${attempts} 个实例，仍无法获取${restrictedPlatform}内容（${detail}）。可能需要 RSSHub 实例配置平台登录凭据或 Cookie`
        : detail,
      ...(ctl.signal.aborted ? { failureKind: 'timeout' as const } : {}),
    }
  } finally {
    globalThis.clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    ctl.abort()
  }
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
  // Each queued wave receives the same per-route budget. A single global
  // sixteen-second deadline otherwise prevents later routes from even starting.
  const timer = globalThis.setTimeout(cancel, TOTAL_BUDGET_MS * Math.max(1, Math.ceil(unique.length / PARALLEL_ROUTES)))
  let cursor = 0
  const reported = new Set<string>()
  const worker = async () => {
    while (!ctl.signal.aborted && cursor < unique.length) {
      const route = unique[cursor++]
      try {
        const result = await probe(route, instances, ctl.signal, preferredId)
        if (!ctl.signal.aborted) { reported.add(route); onResult(result) }
      } catch {
        if (!ctl.signal.aborted) { reported.add(route); onResult({ state: 'unavailable', routePath: route, attempts: 0, detail: '检测失败，请重试' }) }
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
  for (const route of unique) {
    if (!reported.has(route)) onResult({ state: 'unavailable', routePath: route, attempts: 0,
      failureKind: 'timeout', detail: '检测超时，请重试或选择服务实例' })
  }
}
