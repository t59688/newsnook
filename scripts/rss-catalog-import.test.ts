import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeUpstreamCatalog } from './rss-catalog-import'
import { parseCatalog } from '../src/features/rssCatalog/schema'
import { createCatalogIndex, searchCatalog } from '../src/features/rssCatalog/search'
const source = JSON.parse(readFileSync(new URL('../data/rss-catalog/upstream.json', import.meta.url), 'utf8'))
const catalog = normalizeUpstreamCatalog(source)
const sensitiveSource = source.feeds.filter((feed: { nsfw?: boolean }) => feed.nsfw === true)
assert.equal(source.feeds.filter((feed: { id: string }) => /^rss-\d{5}$/.test(feed.id)).length, 6509, 'all original regular and NSFW feeds survive automated additions')
assert.equal(source.feeds.length, source.metadata.total_feeds, 'the authority count includes every verified addition')
assert.equal(sensitiveSource.length, 104)
assert.equal(catalog.feeds.length, source.feeds.length, 'all sources must reach the searchable catalog')
assert.equal(catalog.feeds.filter((feed) => feed.nsfw).length, sensitiveSource.length)
const newUniversalIds = new Set(Array.from({ length: 126 }, (_, index) => `rss-${String(6662 + index).padStart(5, '0')}`))
const newUniversalSources = catalog.feeds.filter((feed) => newUniversalIds.has(feed.id))
assert.equal(newUniversalSources.length, 126, 'verified universal feeds across all domains are included')
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
assert.ok(searchCatalog(offlineIndex, { query: '微信公众号' }).length >= 290)
assert.ok(searchCatalog(offlineIndex, { query: 'B站' }).length >= 18)
assert.ok(searchCatalog(offlineIndex, { query: '88461692' }).some((feed) => feed.title.includes('3Blue1Brown')))
const nativeYouTube = catalog.feeds.find((feed) => feed.title === '3Blue1Brown' && feed.url.includes('youtube.com/feeds/videos.xml'))!
assert.equal(nativeYouTube.platform, 'youtube', 'native YouTube feeds expose a searchable platform identity')
assert.ok(nativeYouTube.creatorId?.startsWith('UC'))
assert.equal(searchCatalog(offlineIndex, { query: nativeYouTube.creatorId! })[0]?.id, nativeYouTube.id)

assert.equal(catalog.feeds.filter((feed) => feed.id.startsWith('rss-08')).length > 400, true, 'cross-platform creators are bundled without any network request')

assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '罗翔' }).some((feed) => feed.title.includes('罗翔')), 'bilibili education source is discoverable')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: '财联社' }).some((feed) => feed.title.includes('财联社')), 'financial telegraph source is discoverable')
const chinesePhotoIds = new Set(Array.from({ length: 20 }, (_, index) => `rss-${String(6642 + index).padStart(5, '0')}`))
const chinesePhotoSources = catalog.feeds.filter((feed) => chinesePhotoIds.has(feed.id))
assert.equal(chinesePhotoSources.length, 20, 'verified Chinese photo/lifestyle feeds are included')
assert.ok(chinesePhotoSources.every((feed) => feed.language === 'zh'))
assert.equal(chinesePhotoSources.filter((feed) => feed.nsfw).length, 7)
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'cos喵' }).some((feed) => feed.id === 'rss-06643'), 'new photo source is discoverable without an opt-in')
assert.equal(new Set(catalog.feeds.map((feed) => feed.url)).size, source.feeds.length)
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
