import assert from 'node:assert/strict'
import { parseRssHubLogicalInput, describeRssHubRoute } from '../src/features/rsshub/input'
import { twitterProfileRssHubRoute } from '../src/features/rsshub/twitter'
import { DEFAULT_RSSHUB_INSTANCES, addRssHubInstance } from '../src/features/rsshub/instances'
import { probeRssHubRoute, probeRssHubRoutes, selectRssHubProbeInstances } from '../src/features/rsshub/probe'
import type { FeedDiscoveryPreviewResult } from '../src/features/feedDiscovery/types'

const logical = parseRssHubLogicalInput('rsshub://bilibili/user/video/946974')
assert.equal(logical?.routePath, '/bilibili/user/video/946974')
assert.equal(describeRssHubRoute(logical!.routePath), 'UP 主投稿视频')
assert.equal(parseRssHubLogicalInput('https://space.bilibili.com/946974'), null)
for (const invalid of ['rsshub://', 'rsshub://bilibili', 'rsshub://evil@bilibili/user', 'rsshub://bilibili/../secret', 'rsshub://bilibili/%2e%2e/hot', 'rsshub://bilibili/route#secret']) {
  assert.throws(() => parseRssHubLogicalInput(invalid), undefined, invalid)
}

const instances = DEFAULT_RSSHUB_INSTANCES
const plain = '/bilibili/user/video/946974'
assert.ok(selectRssHubProbeInstances(plain, instances).length <= 8, 'bounded instances per route')
assert.equal(selectRssHubProbeInstances(plain, instances).every((instance) => instance.enabled && instance.builtin), true)
const extended = addRssHubInstance([...instances], 'https://private-syndication.example.org')
const custom = extended.at(-1)!
assert.deepEqual(selectRssHubProbeInstances(plain, extended, custom.id).map((item) => item.id), [custom.id])
assert.equal(selectRssHubProbeInstances('/github/issues/private?token=secret', extended).length, 0)
assert.deepEqual(selectRssHubProbeInstances('/github/issues/private?token=secret', extended, custom.id).map((item) => item.id), [custom.id])

const checked: string[] = []
const good: FeedDiscoveryPreviewResult = { ok: true, feedUrl: 'https://rsshub.cups.moe' + plain, itemCount: 12,
  checkedAt: 123, title: 'UP 投稿', articles: [] }
const laterInstance = await probeRssHubRoute('/bilibili/user/coin/88461692', instances, new AbortController().signal, undefined, async (url) =>
  url.startsWith('https://rsshub-balancer.virworks.moe/')
    ? { ...good, feedUrl: url }
    : { ok: false, feedUrl: url, kind: 'unknown', checkedAt: 123, retryable: true, message: 'HTTP 503' })
assert.equal(laterInstance.state, 'available', 'a working fifth instance must not be hidden by four failing servers')
assert.equal(laterInstance.instanceId, 'virworks')
const preview = async (url: string, { signal }: { signal?: AbortSignal }): Promise<FeedDiscoveryPreviewResult> => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  checked.push(url)
  if (url.startsWith('https://rsshub.cups.moe/')) return { ...good, feedUrl: url }
  return { ok: false, feedUrl: url, kind: 'network', checkedAt: 123, retryable: true, message: '网络失败' }
}
const outcome = await probeRssHubRoute(plain, instances, new AbortController().signal, undefined, preview)
assert.equal(outcome.state, 'available')
assert.equal(outcome.instanceId, 'cups')
assert.ok(outcome.attempts >= 2 && outcome.attempts <= 8, 'instance probing stops after a bounded set of candidates')
assert.equal(outcome.feed?.itemCount, 12)
assert.equal(checked.length, outcome.attempts)
const checkedAgain: string[] = []
await probeRssHubRoute(plain, instances, new AbortController().signal, undefined, async (url) => {
  checkedAgain.push(url)
  return { ...good, feedUrl: url }
})
assert.ok(checkedAgain[0].startsWith('https://rsshub.cups.moe/'), 'route success informs later searches')

let checks = 0
const collected: string[] = []
const routes = Array.from({ length: 25 }, (_, index) => '/example/channel/' + index)
await probeRssHubRoutes(routes, instances, new AbortController().signal, (result) => {
  collected.push(result.routePath)
}, undefined, async (route) => {
  checks++
  return { state: 'available', routePath: route, attempts: 1 }
})
assert.equal(checks, 20, 'covers the full bounded Radar result set for any site')
assert.equal(new Set(collected).size, 20, 'progressively reports one result per attempted route')
assert.ok(collected.includes('/example/channel/8'), 'the ninth route must be probed without a site-specific priority rule')

let active = 0
let peak = 0
let stopped = 0
const concurrent = await probeRssHubRoute('/bilibili/user/like/88461692', instances, new AbortController().signal, undefined,
  async (url, { signal }) => {
    active++
    peak = Math.max(peak, active)
    try {
      if (url.startsWith('https://rsshub.cups.moe/')) {
        await new Promise<void>((resolve) => signal!.addEventListener('abort', () => { stopped++; resolve() }, { once: true }))
        return { ok: false, feedUrl: url, kind: 'aborted', checkedAt: 123, retryable: true, message: '已取消' }
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
      return url.startsWith('https://rsshub-balancer.virworks.moe/') ? { ...good, feedUrl: url }
        : { ok: false, feedUrl: url, kind: 'unknown', checkedAt: 123, retryable: true, message: 'HTTP 503' }
    } finally { active-- }
  })
assert.equal(concurrent.instanceId, 'virworks', 'a stalled server must not prevent reaching later instances')
assert.equal(peak, 2, 'instance concurrency stays bounded')
assert.equal(stopped, 1, 'successful probe cancels the losing request')
assert.equal(active, 0)

const realSetTimeout = globalThis.setTimeout
try {
  // Scale the real search budget while retaining the ordering of slow waves.
  globalThis.setTimeout = ((callback, delay, ...args) => realSetTimeout(callback, Number(delay) >= 16_000 ? Number(delay) / 100 : delay, ...args)) as typeof setTimeout
  let runningRoutes = 0
  let peakRoutes = 0
  const slowResults: Array<{ routePath: string; state: string }> = []
  await probeRssHubRoutes(routes.slice(0, 9), instances, new AbortController().signal, (result) => slowResults.push(result), undefined,
    async (routePath, _instances, signal) => {
      runningRoutes++
      peakRoutes = Math.max(peakRoutes, runningRoutes)
      try {
        await new Promise<void>((resolve) => realSetTimeout(resolve, 80))
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return { state: 'available', routePath, attempts: 1 }
      } finally { runningRoutes-- }
    })
  assert.equal(slowResults.find((result) => result.routePath === '/example/channel/8')?.state, 'available',
    'later waves retain their budget even when earlier routes are slow')
  assert.equal(peakRoutes, 3, 'covering more routes must not increase concurrency')
} finally { globalThis.setTimeout = realSetTimeout }
try {
  // Advance only the production total budget; no sixteen-second wall-clock wait.
  globalThis.setTimeout = ((callback, delay, ...args) => realSetTimeout(callback, Number(delay) >= 16_000 ? 10 : delay, ...args)) as typeof setTimeout
  const timedOut: Array<{ state: string; failureKind?: string }> = []
  await probeRssHubRoutes(routes, instances, new AbortController().signal, (result) => timedOut.push(result), undefined,
    async (routePath, _instances, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw new DOMException(routePath, 'AbortError')
    })
  assert.equal(timedOut.length, 20, 'budget expiry reports every pending route instead of leaving checking state')
  assert.ok(timedOut.every((result) => result.state === 'unavailable' && result.failureKind === 'timeout'))
} finally { globalThis.setTimeout = realSetTimeout }

const alreadyCancelled = new AbortController()
alreadyCancelled.abort()
await assert.rejects(probeRssHubRoute(plain, instances, alreadyCancelled.signal, undefined, preview), { name: 'AbortError' })
await assert.rejects(probeRssHubRoutes([plain], instances, alreadyCancelled.signal, () => { throw new Error('should not update UI') }), { name: 'AbortError' })
console.log('rsshub logical input and progressive probe: ok')

for (const url of ['https://x.com/Swang1', 'https://twitter.com/Swang1', 'https://mobile.x.com/Swang1']) {
  assert.equal(twitterProfileRssHubRoute(url)?.routePath, '/twitter/user/Swang1')
}
for (const url of ['https://x.com/home', 'https://x.com/Swang1/status/123456', 'https://evilx.com/Swang1', 'https://x.com/i/bookmarks', 'https://x.com/some-long-handle-exceeding-limit']) {
  assert.equal(twitterProfileRssHubRoute(url), null, url)
}
const failedTwitter = await probeRssHubRoute('/twitter/user/Swang1', instances, new AbortController().signal, undefined, async (url) => ({
  ok: false, feedUrl: url, kind: 'unknown', message: 'HTTP 503', retryable: true, checkedAt: 123,
}))
assert.equal(failedTwitter.state, 'unavailable')
assert.match(failedTwitter.detail ?? '', /多个实例|已尝试/)
assert.match(failedTwitter.detail ?? '', /登录凭据/)
const failedWeibo = await probeRssHubRoute('/weibo/user/7270676547', instances, new AbortController().signal, undefined, async (url) => ({
  ok: false, feedUrl: url, kind: 'unknown', message: 'HTTP 503', retryable: true, checkedAt: 123,
}))
assert.match(failedWeibo.detail ?? '', /微博内容/)
assert.match(failedWeibo.detail ?? '', /登录凭据或 Cookie/)
