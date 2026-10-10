import assert from 'node:assert/strict'
import { parseRssHubLogicalInput, describeRssHubRoute } from '../src/features/rsshub/input'
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
assert.equal(selectRssHubProbeInstances(plain, instances).length, 4, 'budget four instances per route')
assert.equal(selectRssHubProbeInstances(plain, instances).every((instance) => instance.enabled && instance.builtin), true)
const extended = addRssHubInstance([...instances], 'https://private-syndication.example.org')
const custom = extended.at(-1)!
assert.deepEqual(selectRssHubProbeInstances(plain, extended, custom.id).map((item) => item.id), [custom.id])
assert.equal(selectRssHubProbeInstances('/github/issues/private?token=secret', extended).length, 0)
assert.deepEqual(selectRssHubProbeInstances('/github/issues/private?token=secret', extended, custom.id).map((item) => item.id), [custom.id])

const checked: string[] = []
const good: FeedDiscoveryPreviewResult = { ok: true, feedUrl: 'https://rsshub.cups.moe' + plain, itemCount: 12,
  checkedAt: 123, title: 'UP 投稿', articles: [] }
const preview = async (url: string, { signal }: { signal?: AbortSignal }): Promise<FeedDiscoveryPreviewResult> => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  checked.push(url)
  if (url.startsWith('https://rsshub.cups.moe/')) return { ...good, feedUrl: url }
  return { ok: false, feedUrl: url, kind: 'network', checkedAt: 123, retryable: true, message: '网络失败' }
}
const outcome = await probeRssHubRoute(plain, instances, new AbortController().signal, undefined, preview)
assert.equal(outcome.state, 'available')
assert.equal(outcome.instanceId, 'cups')
assert.equal(outcome.attempts, 2)
assert.equal(outcome.feed?.itemCount, 12)
assert.equal(checked.length, 2)
const checkedAgain: string[] = []
await probeRssHubRoute(plain, instances, new AbortController().signal, undefined, async (url) => {
  checkedAgain.push(url)
  return { ...good, feedUrl: url }
})
assert.ok(checkedAgain[0].startsWith('https://rsshub.cups.moe/'), 'route success informs later searches')

let checks = 0
const collected: string[] = []
const routes = Array.from({ length: 16 }, (_, index) => '/bilibili/user/video/' + index)
await probeRssHubRoutes(routes, instances, new AbortController().signal, (result) => {
  collected.push(result.routePath)
}, undefined, async (route) => {
  checks++
  return { state: 'available', routePath: route, attempts: 1 }
})
assert.equal(checks, 8, 'limits total routes per search')
assert.equal(new Set(collected).size, 8, 'progressively reports one result per attempted route')

const alreadyCancelled = new AbortController()
alreadyCancelled.abort()
await assert.rejects(probeRssHubRoute(plain, instances, alreadyCancelled.signal, undefined, preview), { name: 'AbortError' })
await assert.rejects(probeRssHubRoutes([plain], instances, alreadyCancelled.signal, () => { throw new Error('should not update UI') }), { name: 'AbortError' })
console.log('rsshub logical input and progressive probe: ok')
