import assert from 'node:assert/strict'
import {
  DEFAULT_RSSHUB_INSTANCES,
  addRssHubInstance,
  changeRssHubInstanceEnabled,
  isSensitiveRssHubRoute,
  normalizeRssHubInstanceUrl,
  normalizeRssHubInstances,
  removeRssHubInstance,
  rssHubFeedUrl,
} from '../src/features/rsshub/instances'
import {
  matchRssHubRadar,
  resolveRssHubRadarTarget,
  loadRssHubRadarCatalog,
  clearRssHubRadarCacheForTest,
} from '../src/features/rsshub/radar'
import {
  fetchRssHubSourceText,
  isRssHubFeedPayload,
  setRuntimeRssHubInstances,
  resetRssHubHealthForTest,
} from '../src/features/rsshub/fetch'
import type { NewsSource } from '../src/sources/registry'
import { normalizePreferences, DEFAULT_PREFERENCES } from '../src/sources/preferences'
import { searchOnlineFeeds } from '../src/features/feedDiscovery/onlineSearch'

const enabled = normalizeRssHubInstances(DEFAULT_RSSHUB_INSTANCES)
assert.equal(enabled.length, 8)
assert.equal(enabled.filter((item) => item.enabled).length, 7)
assert.equal(enabled.find((item) => item.id === 'official-demo')?.enabled, false)
for (const url of ['http://example.org', 'https://localhost', 'https://192.168.1.1', 'https://10.0.0.1',
  'https://example.org:8443', 'https://example.org@127.0.0.1', 'https://user:pass@example.org',
  'https://example.org/admin', 'https://example.org?key=1', 'javascript:alert(1)']) {
  assert.throws(() => normalizeRssHubInstanceUrl(url), undefined, 'unsafe instance: ' + url)
}
const custom = addRssHubInstance(enabled, 'https://feeds.example.org', '私有服务')
assert.equal(custom.length, enabled.length + 1)
assert.equal(custom.at(-1)?.name, '私有服务')
assert.throws(() => addRssHubInstance(custom, 'https://feeds.example.org'))
assert.equal(removeRssHubInstance(custom, custom.at(-1)!.id).length, enabled.length)
assert.equal(changeRssHubInstanceEnabled(enabled, 'isrss', false)[0].enabled, false)
assert.ok(!normalizeRssHubInstances([{ id: 'custom:hack', name: 'internal', url: 'http://127.0.0.1', enabled: true }]).some((item) => item.id === 'custom:hack'))
assert.equal(rssHubFeedUrl(enabled[0], '/bilibili/user/dynamic/123?format=rss'), 'https://rsshub.isrss.com/bilibili/user/dynamic/123?format=rss')
assert.throws(() => rssHubFeedUrl(enabled[0], '//evil.example.net'))
assert.throws(() => rssHubFeedUrl(enabled[0], '/../../admin'))
assert.throws(() => rssHubFeedUrl(enabled[0], '/foo/%2e%2e/admin'))
assert.throws(() => rssHubFeedUrl(enabled[0], '/foo/%2Fbar'))
assert.throws(() => rssHubFeedUrl(enabled[0], '/script/${eval}'))
assert.equal(isSensitiveRssHubRoute('/github/issue/foo/bar?token=abc'), true)
assert.equal(isSensitiveRssHubRoute('/github/issue/foo/bar?format=rss'), false)
assert.equal(isSensitiveRssHubRoute('/github/issue/foo/bar?private=maybe-secret'), true, 'unknown query keys are treated as sensitive')

const radar = {
  'bilibili.com': {
    _name: 'Bilibili',
    space: [
      { title: 'UP 主动态', source: ['/:uid'], target: '/bilibili/user/dynamic/:uid' },
      { title: '执行函数', source: ['/:uid'], target: '/bilibili/params=>{danger()}' },
    ],
  },
  'github.com': {
    _name: 'GitHub',
    '.': [{ title: 'Repository issues', source: ['/:user/:repo/issues', '/:user/:repo'], target: '/github/issue/:user/:repo' }],
  },
  'douban.com': {
    _name: 'Douban',
    movie: [{ title: 'Upcoming', source: ['/coming'], target: '/douban/movie/coming' }],
  },
  '163.com': {
    _name: 'NetEase Music',
    music: [{ title: 'Dynamic user', source: ['/user/event'], target: '/163/music/user/events/:id' }],
  },
  'news.example.org': {
    _name: 'News',
    '.': [
      { title: 'Article', source: ['/article?id=:id'], target: '/news/article/:id?format=rss' },
      { title: 'Chinese category', source: ['/分类/:category'], target: '/news/category/:category' },
    ],
  },
}

const bili = matchRssHubRadar('https://space.bilibili.com/1161918898', radar, enabled)
assert.equal(bili.length, 1, 'function targets must never execute or appear as candidates')
assert.equal(bili[0].routePath, '/bilibili/user/dynamic/1161918898')
assert.equal(bili[0].feedUrl, 'https://rsshub.isrss.com/bilibili/user/dynamic/1161918898')
assert.deepEqual(bili[0].parameters, { uid: '1161918898' })
assert.equal(matchRssHubRadar('https://evilbilibili.com/1161918898', radar, enabled).length, 0)
assert.equal(matchRssHubRadar('https://space.bilibili.com/1161918898/extra', radar, enabled).length, 0)
assert.equal(matchRssHubRadar('https://github.com/t59688/newsnook/issues', radar, enabled)[0].routePath, '/github/issue/t59688/newsnook')
assert.equal(matchRssHubRadar('https://movie.douban.com/coming', radar, enabled)[0].routePath, '/douban/movie/coming')
const missing = matchRssHubRadar('https://music.163.com/user/event', radar, enabled)[0]
assert.deepEqual(missing.missingParameters, ['id'])
assert.equal(missing.feedUrl, undefined, 'route needs a parameter: no HTTP request yet')
assert.equal(resolveRssHubRadarTarget(missing.routeTemplate, { id: '1987' }).path, '/163/music/user/events/1987')
assert.equal(resolveRssHubRadarTarget(missing.routeTemplate, { id: 'space slash' }).path, '/163/music/user/events/space%20slash')
assert.equal(resolveRssHubRadarTarget(missing.routeTemplate, {}).path, undefined)
assert.equal(matchRssHubRadar('https://news.example.org/article?id=42', radar, enabled)[0].routePath, '/news/article/42?format=rss')
assert.equal(matchRssHubRadar('https://news.example.org/分类/科技', radar, enabled)[0].routePath, '/news/category/%E7%A7%91%E6%8A%80')

clearRssHubRadarCacheForTest()
let fetchCount = 0
const manyDomains = Object.fromEntries(Array.from({ length: 110 }, (_, i) => ['site-' + i + '.org', { _name: 'Site ' + i }]))
const remote = async (_url: string, _opts: unknown) => { fetchCount++; return JSON.stringify(manyDomains) }
const result = await loadRssHubRadarCatalog(undefined, remote as typeof import('../src/lib/http').fetchAbsoluteText)
assert.ok(result['site-3.org'])
await loadRssHubRadarCatalog(undefined, remote as typeof import('../src/lib/http').fetchAbsoluteText)
assert.equal(fetchCount, 1, 'repeated URL matching reuses cached catalog')
clearRssHubRadarCacheForTest()

const source: NewsSource = {
  id: 'custom-stable', name: 'Bilibili', label: 'Bili', group: 'custom', kind: 'feed',
  enabled: true, isCustom: true,
  url: 'https://rsshub.isrss.com/bilibili/user/dynamic/123',
  discovery: { providerId: 'rsshub', entryId: 'bili', generator: 'rsshub',
    instanceId: 'isrss', routeKey: '/bilibili/user/dynamic/123' },
}
const xml = '<rss version="2.0"><channel><title>test</title><item><title>Updated</title><link>https://bilibili.com/1</link></item></channel></rss>'
assert.equal(isRssHubFeedPayload(xml), true)
assert.equal(isRssHubFeedPayload('<html>RSSHub Error</html>'), false)
resetRssHubHealthForTest()
const tried: string[] = []
const output = await fetchRssHubSourceText(source, undefined, async (url) => {
  tried.push(url)
  if (url.startsWith('https://rsshub.isrss.com/')) throw new Error('HTTP 503')
  return xml
})
assert.equal(output, xml)
assert.equal(tried.length, 2)
assert.ok(tried[1].includes('/bilibili/user/dynamic/123'))
const triedAgain: string[] = []
await fetchRssHubSourceText(source, undefined, async (url) => { triedAgain.push(url); return xml })
assert.equal(triedAgain[0], tried[1], 'healthy instance sticks; failing instance remains on cooldown')
const protectedSource: NewsSource = {
  ...source, id: 'credential-route',
  url: 'https://rsshub.isrss.com/bilibili/user/dynamic/123?token=hidden',
  discovery: { ...source.discovery!, routeKey: '/bilibili/user/dynamic/123?token=hidden' },
}
let sensitiveCalls = 0
await assert.rejects(
  fetchRssHubSourceText(protectedSource, undefined, async () => { sensitiveCalls++; throw new Error('HTTP 503') }),
)
assert.equal(sensitiveCalls, 1, 'authorization must never be relayed to another public instance')
resetRssHubHealthForTest()
let allFail = 0
await assert.rejects(
  fetchRssHubSourceText(source, undefined, async () => { allFail++; throw new Error('HTTP 503') }),
)
assert.equal(allFail, 2, 'bounded fallback: no unbounded public-server traffic')
resetRssHubHealthForTest()
setRuntimeRssHubInstances(changeRssHubInstanceEnabled(changeRssHubInstanceEnabled(enabled, 'cups', false), 'slarker', false))
const used: string[] = []
await fetchRssHubSourceText(source, undefined, async (url) => { used.push(url); return xml })
assert.equal(used.length, 1)
assert.ok(!used.some((url) => url.startsWith('https://rsshub.cups.moe')))
const cancelled = new AbortController()
cancelled.abort()
await assert.rejects(fetchRssHubSourceText(source, cancelled.signal, async () => xml))
resetRssHubHealthForTest()

// A disabled public host must never be called, but other public instances remain eligible.
setRuntimeRssHubInstances(changeRssHubInstanceEnabled(enabled, 'isrss', false))
const otherPublic: string[] = []
await fetchRssHubSourceText(source, undefined, async (url) => { otherPublic.push(url); return xml })
assert.ok(otherPublic.length === 1 && !otherPublic[0].startsWith('https://rsshub.isrss.com/'))
resetRssHubHealthForTest()

// A private custom endpoint may only retry other explicitly configured custom hosts.
const customSource: NewsSource = {
  ...source, id: 'custom-rsshub',
  url: 'https://feeds.example.org/bilibili/user/dynamic/123',
  discovery: { ...source.discovery!, instanceId: custom.at(-1)!.id },
}
const secondCustom = addRssHubInstance(custom, 'https://second-feeds.example.org')
setRuntimeRssHubInstances(secondCustom)
const privateCalls: string[] = []
await fetchRssHubSourceText(customSource, undefined, async (url) => {
  privateCalls.push(url)
  if (url.startsWith('https://feeds.example.org/')) throw new Error('HTTP 503')
  return xml
})
assert.deepEqual(privateCalls.map((url) => new URL(url).hostname), ['feeds.example.org', 'second-feeds.example.org'])
resetRssHubHealthForTest()

// Complete, pasted RSSHub URLs are recognized offline without a second Radar request.
const pasted = await searchOnlineFeeds('https://rsshub.isrss.com/github/issue/t59688/newsnook?format=rss')
assert.equal(pasted.length, 1)
assert.equal(pasted[0].type, 'rsshub')
assert.equal(pasted[0].routePath, '/github/issue/t59688/newsnook?format=rss')
assert.equal(pasted[0].instanceId, 'isrss')

const restored = normalizePreferences({
  ...DEFAULT_PREFERENCES,
  rsshubInstances: custom,
  customSources: [source],
})
assert.equal(restored.customSources?.[0]?.id, source.id)
assert.equal(restored.customSources?.[0]?.discovery?.routeKey, source.discovery?.routeKey)
assert.equal(restored.rsshubInstances.length, custom.length)
console.log('rsshub discovery, persistence and failover: ok')
