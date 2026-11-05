import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeUpstreamCatalog } from './rss-catalog-import'
import { parseCatalog } from '../src/features/rssCatalog/schema'
import { createCatalogIndex, searchCatalog } from '../src/features/rssCatalog/search'
const source = JSON.parse(readFileSync(new URL('../data/rss-catalog/upstream.json', import.meta.url), 'utf8'))
const catalog = normalizeUpstreamCatalog(source)
const sensitiveSource = source.feeds.filter((feed: { nsfw?: boolean }) => feed.nsfw === true)
assert.ok(source.feeds.filter((feed: { id: string }) => /^rss-\d{5}$/.test(feed.id)).length >= 4500, 'curation retains independently checked foundational catalog sources')
assert.equal(source.feeds.length, source.metadata.total_feeds, 'the authority count includes every verified addition')
assert.ok(sensitiveSource.length >= 60, 'substantive content screening preserves diverse mature content where valid')
assert.equal(catalog.feeds.length, source.feeds.length, 'all sources must reach the searchable catalog')
assert.equal(catalog.feeds.filter((feed) => feed.nsfw).length, sensitiveSource.length)
const newUniversalIds = new Set(Array.from({ length: 126 }, (_, index) => `rss-${String(6662 + index).padStart(5, '0')}`))
const newUniversalSources = catalog.feeds.filter((feed) => newUniversalIds.has(feed.id))
assert.ok(newUniversalSources.length >= 100, 'verified universal feeds remain after content screening')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'SpaceNews' }).some((feed) => feed.title.includes('SpaceNews')), 'new space source is discoverable')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '开源中国' }).some((feed) => feed.title.includes('开源中国')), 'new open source source is discoverable')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'TED Talks' }).some((feed) => feed.title.includes('TED Talks')), 'new video source is discoverable')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '影视飓风' }).some((feed) => feed.title.includes('影视飓风')), 'bilibili video source is discoverable')
const offlineIndex = createCatalogIndex(catalog.feeds)
const creator = catalog.feeds.find((feed) => feed.id === 'rss-06762')!
assert.equal(creator.creatorId, '946974')
assert.equal(creator.rsshubRoute, '/bilibili/user/video/946974')
for (const query of ['影视剧风', '946974', 'MediaStorm', 'yingshijufeng', 'ying shi ju feng']) {
  assert.equal(searchCatalog(offlineIndex, { query })[0]?.id, creator.id, query)
}
const newlyVerified = [
  { id: 'discovered-90eee9d39fd4c7567e0601eb', platform: 'bilibili', keyword: 'B站', route: '/bilibili/user/video/31700507' },
  { id: 'discovered-2e6649a019799dc1af4d207e', platform: 'wechat', keyword: '微信公众号', route: undefined },
  { id: 'discovered-e60b60a6fac1b3a353e4ad70', platform: 'weibo', keyword: '微博', route: '/weibo/user/1140250875' },
] as const
for (const sample of newlyVerified) {
  const feed = catalog.feeds.find((entry) => entry.id === sample.id)
  assert.ok(feed, `missing revalidated creator: ${sample.id}`)
  assert.equal(feed.platform, sample.platform)
  assert.ok(feed.tags.includes(sample.keyword), `missing platform tag: ${sample.id}`)
  assert.ok(feed.tags.length >= 2, `verified creator must have searchable tags: ${sample.id}`)
  assert.equal(feed.rsshubRoute, sample.route)
  assert.equal(feed.nsfw, false)
  assert.ok(feed.url.startsWith('https://'))
  assert.ok(searchCatalog(offlineIndex, { query: sample.keyword }).some((entry) => entry.id === sample.id), `tag search misses ${sample.id}`)
}
assert.ok(searchCatalog(offlineIndex, { query: '微信公众号' }).length >= 100)
assert.ok(searchCatalog(offlineIndex, { query: 'B站' }).length >= 18)
assert.ok(searchCatalog(offlineIndex, { query: '88461692' }).some((feed) => feed.title.includes('3Blue1Brown')))
const nativeYouTube = catalog.feeds.find((feed) => feed.title === '3Blue1Brown' && feed.url.includes('youtube.com/feeds/videos.xml'))!
assert.equal(nativeYouTube.platform, 'youtube', 'native YouTube feeds expose a searchable platform identity')
assert.ok(nativeYouTube.creatorId?.startsWith('UC'))
assert.equal(searchCatalog(offlineIndex, { query: nativeYouTube.creatorId! })[0]?.id, nativeYouTube.id)

assert.equal(catalog.feeds.filter((feed) => feed.id.startsWith('rss-08')).length > 250, true, 'cross-platform creators are bundled without any network request')

assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '罗翔' }).some((feed) => feed.title.includes('罗翔')), 'bilibili education source is discoverable')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '财联社' }).some((feed) => feed.title.includes('财联社')), 'financial telegraph source is discoverable')
const chinesePhotoIds = new Set(Array.from({ length: 20 }, (_, index) => `rss-${String(6642 + index).padStart(5, '0')}`))
const chinesePhotoSources = catalog.feeds.filter((feed) => chinesePhotoIds.has(feed.id))
assert.ok(chinesePhotoSources.length >= 15, 'content-verified Chinese photo/lifestyle feeds remain searchable')
assert.ok(chinesePhotoSources.every((feed) => feed.language === 'zh'))
assert.ok(chinesePhotoSources.filter((feed) => feed.nsfw).length >= 5)
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'cos喵' }).some((feed) => feed.id === 'rss-06643'), 'new photo source is discoverable without an opt-in')
assert.equal(new Set(catalog.feeds.map((feed) => feed.url)).size, source.feeds.length)
// Published offline search results must be usable sources, not raw identity-only
// indexes or opaque labels. Check these invariants without any network access.
const placeholderTitle = /^(?:rss|feed|atom|blog|home|homepage|untitled|unknown|test|news|index)$/i
const normalizedEndpoints = new Set<string>()
const convertedCreatorRoutes = new Set<string>()
for (const feed of source.feeds as Array<{ id: string; title: string; url: string; rsshub_route?: string; platform?: string; creator_id?: string }>) {
  assert.ok(!placeholderTitle.test(feed.title.trim()), `Non-descriptive offline source: ${feed.id}`)
  const endpoint = new URL(feed.url)
  const query = [...endpoint.searchParams.entries()].filter(([key]) => !key.startsWith('utm_') && !['ref', 'source', 'gclid', 'fbclid'].includes(key)).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
  const normalized = endpoint.hostname.toLowerCase().replace(/^www\./, '') + decodeURIComponent(endpoint.pathname).replace(/\/$/, '').toLowerCase() + JSON.stringify(query)
  assert.ok(!normalizedEndpoints.has(normalized), `Duplicated canonical endpoint: ${feed.id}`)
  normalizedEndpoints.add(normalized)
  if (feed.rsshub_route) {
    assert.equal(endpoint.pathname + endpoint.search, feed.rsshub_route, `RSSHub URL and stored route differ: ${feed.id}`)
    if (feed.platform && feed.creator_id) {
      const creatorRoute = [feed.platform, feed.creator_id, feed.rsshub_route].join(':')
      assert.ok(!convertedCreatorRoutes.has(creatorRoute), `Duplicated creator route: ${feed.id}`)
      convertedCreatorRoutes.add(creatorRoute)
    }
  }
}
assert.deepEqual(catalog.feeds.map((feed) => [feed.id, feed.url, feed.language]).sort(), source.feeds.map((feed: { id: string; url: string; language: string }) => [feed.id, new URL(feed.url).href, feed.language]).sort(), 'normalization preserves every source identity, address and language')
assert.deepEqual(parseCatalog(catalog), catalog)
assert.deepEqual(JSON.parse(readFileSync(new URL('../src/features/rssCatalog/seed.json', import.meta.url), 'utf8')), catalog, 'bundled seed must match the checked-in upstream catalog')
assert.equal(catalog.feeds.find((feed) => feed.title === 'AgFunderNews')?.category, '农业')
assert.equal(catalog.feeds.find((feed) => feed.title.includes('GSMArena.com'))?.category, '手机与移动技术', 'general mobile reporting must not be classified as developer-only content')
assert.equal(catalog.feeds.filter((feed) => feed.language === 'zh').length, source.feeds.filter((feed: { language: string }) => feed.language === 'zh').length)
assert.equal(catalog.feeds.filter((feed) => feed.language === 'und').length, source.feeds.filter((feed: { language: string }) => feed.language === 'und').length, 'do not guess missing languages')
assert.equal(catalog.feeds.some((feed) => /^(cn|en)-/.test(feed.category)), false)
assert.ok(catalog.feeds.some((feed) => sensitiveSource.some((adult: { id: string }) => adult.id === feed.id)), 'NSFW feeds must reach the client')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'Couture Boudoir' }).some((feed) => feed.nsfw), 'all sources are directly searchable without a separate filter')
for (const [flag, keyword] of [['has_image_in_feed', '图文'], ['has_video_in_feed', '视频']] as const) {
  const candidate = source.feeds.find((feed: Record<string, unknown>) => feed[flag] === true)
  assert.ok(candidate, `catalog must contain audited ${keyword} feeds`)
  assert.ok(catalog.feeds.find((feed) => feed.id === candidate.id)?.tags.includes(keyword), `${keyword} searchable tag survives normalization`)
}
const index = createCatalogIndex(catalog.feeds)
for (const query of ['农业', '人工智能', '机器学习', '农林', '历史', '汽车', '医学', '前端']) assert.ok(searchCatalog(index, { query }).length > 0, query)
const broken = structuredClone(source)
broken.feeds[0].category = 'unmapped category'
assert.throws(() => normalizeUpstreamCatalog(broken), /分类/)
const invalidFlag = structuredClone(source)
invalidFlag.feeds[0].nsfw = 'true'
assert.throws(() => normalizeUpstreamCatalog(invalidFlag), /NSFW/, 'malformed NSFW flags must fail closed')
const duplicatedAdult = structuredClone(source)
duplicatedAdult.feeds.find((feed: { nsfw?: boolean }) => feed.nsfw === true)!.url = duplicatedAdult.feeds[0].url
assert.throws(() => normalizeUpstreamCatalog(duplicatedAdult), /重复/, 'duplicate URLs across normal and NSFW records must be rejected')
assert.throws(() => normalizeUpstreamCatalog({ ...source, metadata: { ...source.metadata, total_feeds: 1 } }), /数量/)
assert.throws(() => normalizeUpstreamCatalog({ ...source, feeds: [...source.feeds, source.feeds[0]], metadata: { ...source.metadata, total_feeds: source.feeds.length + 1 } }))
console.log(`rss catalog import: ${catalog.feeds.length} feeds, ${new Set(catalog.feeds.map((feed) => feed.category)).size} topics`)
