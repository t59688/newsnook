import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { resolveContentSubscriptionTarget, extractPageAuthorUrls } from '../src/features/feedDiscovery/contentLink'
import { searchOnlineFeeds } from '../src/features/feedDiscovery/onlineSearch'
import { clearRssHubRadarCacheForTest } from '../src/features/rsshub/radar'

const sourcePost = 'https://weibo.com/7270676547/RoTHkdXwd'
const weibo = resolveContentSubscriptionTarget(sourcePost)
assert.equal(weibo?.routePath, '/weibo/user/7270676547')
assert.equal(weibo?.profileUrl, 'https://weibo.com/u/7270676547')
assert.equal(weibo?.source, 'post')
for (const url of [
  'https://www.weibo.com/7270676547/RoTHkdXwd?ref=share',
  'https://weibo.com/u/7270676547',
  'https://m.weibo.cn/u/7270676547',
  'https://m.weibo.cn/profile/7270676547',
]) assert.equal(resolveContentSubscriptionTarget(url)?.routePath, '/weibo/user/7270676547', url)
for (const url of [
  'https://x.com/Swang1/status/1234567890',
  'https://www.twitter.com/Swang1/status/1234567890/photo/1',
  'https://mobile.x.com/Swang1/status/1234567890/video/1',
  'https://twitter.com/Swang1',
]) assert.equal(resolveContentSubscriptionTarget(url)?.routePath, '/twitter/user/Swang1', url)
for (const url of [
  'https://evilweibo.com/7270676547/RoTHkdXwd',
  'https://weibo.com.evil.org/7270676547/RoTHkdXwd',
  'https://weibo.com/7270676547/not-a-post',
  'https://weibo.com/7270676547/123',
  'https://weibo.com/123456789/a/b',
  'https://weibo.com/i/status/1234567890',
  'https://x.com/i/status/1234567890',
  'https://x.com/home/status/1234567890',
  'https://x.com/about',
  'https://x.com/Swang1/status/not-a-status',
  'https://x.com/Swang1/status/123/unknown/1',
  'https://x.com.evil.net/Swang1/status/1234567890',
  'https://space.bilibili.com/946974/video/BV1abc',
  'https://www.bilibili.com/video/BV1abc',
  'https://www.zhihu.com/question/1234567/answer/8888888',
  'https://weibo.com@attacker.example/7270676547/RoTHkdXwd',
  'javascript:https://weibo.com/7270676547/RoTHkdXwd',
]) assert.equal(resolveContentSubscriptionTarget(url), null, 'must not fabricate creator: ' + url)

const { window } = parseHTML('<html><head></head><body></body></html>')
Object.assign(globalThis, { DOMParser: window.DOMParser })
const html = `<html><head>
  <link rel="author" href="https://space.bilibili.com/946974">
  <link rel="author" href="https://space.bilibili.com.evil.org/12345">
  <meta property="article:author" content="https://other.example.com/unknown">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","author":{"@type":"Person","url":"https://space.bilibili.com/946974"}}</script>
</head></html>`
assert.deepEqual(extractPageAuthorUrls(html, 'https://www.bilibili.com/video/BVabc'), ['https://space.bilibili.com/946974'],
  'only trusted explicit author URLs may be used, duplicates removed')
assert.deepEqual(extractPageAuthorUrls(`<html><head><script type="application/ld+json">
{"@type":"Article","author":{"url":"https://www.zhihu.com/people/a-writer"}}</script></head></html>`,
'https://www.zhihu.com/question/123/answer/456'), ['https://www.zhihu.com/people/a-writer'])
assert.deepEqual(extractPageAuthorUrls(`<script type="application/ld+json">
{"@type":"QAPage","mainEntity":{"@type":"Question","acceptedAnswer":{"@type":"https://schema.org/Answer","author":{"url":"https://www.zhihu.com/people/answer-author"}}}}</script>`,
  'https://www.zhihu.com/question/123/answer/456'), ['https://www.zhihu.com/people/answer-author'],
  'nested Q&A structured data can identify the answer author')
assert.deepEqual(extractPageAuthorUrls(`<a rel="author" href="https://evil.example.net/hacker"></a>`,
  'https://news.example.com/article/1'), [], 'cross-domain links never turn into creator probes')
assert.deepEqual(extractPageAuthorUrls(`<a rel="author" href="http://127.0.0.1/private"></a>`,
  'https://news.example.com/article/1'), [])
assert.deepEqual(extractPageAuthorUrls(`<a rel="author" href="http://127.0.0.1/author"></a>`,
  'http://127.0.0.1/article/1'), [], 'metadata never expands private-host discovery')
assert.deepEqual(extractPageAuthorUrls(`<a rel="author" href="/author/jane?token=private"></a>`,
  'https://news.example.com/article/1'), [], 'never forward metadata query credentials')
assert.deepEqual(extractPageAuthorUrls('<script type="application/ld+json">{bad</script>',
  'https://news.example.com/article/1'), [], 'malformed structured data must not break discovery')

const originalFetch = globalThis.fetch
const calls: string[] = []
const radar = {
  ...Object.fromEntries(Array.from({ length: 110 }, (_, i) => ['sample-' + i + '.org', { _name: 'Sample ' + i }])),
  'bilibili.com': { _name: 'Bilibili', space: [
    { title: 'UP 主动态', source: ['/:uid'], target: '/bilibili/user/dynamic/:uid' },
  ] },
  'example.com': { _name: 'News', news: [
    { title: 'Article', source: ['/post/:id'], target: '/example/post/:id' },
  ] },
}
const xml = '<rss version="2.0"><channel><title>示例源</title><item><title>新内容</title><link>https://example.com/1</link></item></channel></rss>'
try {
  globalThis.fetch = async (input) => { calls.push(String(input)); throw new Error('no remote HTTP expected') }
  const automatic = await searchOnlineFeeds(sourcePost)
  assert.equal(automatic[0].routePath, '/weibo/user/7270676547')
  assert.equal(automatic[0].discoveryContext, 'author-from-content')
  assert.equal(automatic[1].type, 'direct', 'original-page inspection remains available')
  assert.equal(calls.length, 0, 'known-author content link must resolve fully offline')
  assert.equal((await searchOnlineFeeds('https://x.com/Swang1/status/1234567890'))[0].routePath, '/twitter/user/Swang1')
  assert.equal((await searchOnlineFeeds('https://x.com/Swang1')).length, 1, 'profile discovery remains one result')
  const alreadyCancelled = new AbortController()
  alreadyCancelled.abort()
  await assert.rejects(searchOnlineFeeds(sourcePost, alreadyCancelled.signal), { name: 'AbortError' })

  clearRssHubRadarCacheForTest()
  globalThis.fetch = async (input) => {
    const raw = String(input)
    const wrapped = new URL(raw, 'https://news.example.net')
    const target = wrapped.searchParams.get('url') ?? raw
    calls.push(target)
    if (target.includes('radar-rules.json')) return new Response(JSON.stringify(radar))
    if (target.startsWith('https://www.bilibili.com/video/')) return new Response(html)
    if (target.includes('origin.feedsearch.dev')) return new Response('[]')
    if (target === 'https://rsshub.isrss.com/bilibili/user/dynamic/946974') return new Response(xml)
    throw new Error('Unexpected URL ' + target)
  }
  const discovered = await searchOnlineFeeds('https://www.bilibili.com/video/BV123456')
  assert.equal(discovered[0].routePath, '/bilibili/user/dynamic/946974')
  assert.equal(discovered[0].discoveryContext, 'author-from-content')
  assert.ok(!discovered.some((entry) => entry.routePath?.includes('BV123456')), 'content IDs are not creator IDs')
  assert.equal(discovered.filter((entry) => entry.routePath === '/bilibili/user/dynamic/946974').length, 1)
  assert.equal(calls.filter((url) => url.includes('www.bilibili.com/video/')).length, 1, 'metadata reuses the original HTML GET')
  assert.equal(calls.filter((url) => url.includes('radar-rules.json')).length, 1, 'one bounded Radar catalog request')

  clearRssHubRadarCacheForTest()
  globalThis.fetch = async (input) => {
    const raw = String(input)
    const wrapped = new URL(raw, 'https://news.example.net')
    const target = wrapped.searchParams.get('url') ?? raw
    if (target.includes('radar-rules.json') || target.includes('/api/radar/rules')) throw new Error('Radar is down')
    if (target.startsWith('https://m.weibo.cn/status/')) return new Response(
      '<html><head><meta property="article:author" content="https://weibo.com/u/7270676547"></head></html>')
    if (target.includes('origin.feedsearch.dev')) throw new Error('Feedsearch is down')
    throw new Error('Unexpected URL ' + target)
  }
  const graceful = await searchOnlineFeeds('https://m.weibo.cn/status/123456789')
  assert.equal(graceful[0].routePath, '/weibo/user/7270676547', 'author metadata still works if Radar and Feedsearch both fail')

  globalThis.fetch = async (input) => {
    const raw = String(input)
    const wrapped = new URL(raw, 'https://news.example.net')
    const target = wrapped.searchParams.get('url') ?? raw
    if (target.startsWith('https://news.example.com/post/')) return new Response(
      '<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>')
    if (target.includes('radar-rules.json') || target.includes('/api/radar/rules')) throw new Error('Radar unavailable')
    throw new Error('Unexpected URL ' + target)
  }
  const ordinary = await searchOnlineFeeds('https://news.example.com/post/1')
  assert.ok(ordinary.some((entry) => entry.type === 'direct' && entry.feedUrl === 'https://news.example.com/feed.xml'),
    'native RSS discovery remains intact when Radar is down')
} finally {
  globalThis.fetch = originalFetch
  clearRssHubRadarCacheForTest()
}
console.log('content-link author discovery: ok')
