import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeUpstreamCatalog } from './rss-catalog-import'
import { parseCatalog } from '../src/features/rssCatalog/schema'
import { createCatalogIndex, searchCatalog } from '../src/features/rssCatalog/search'
const source = JSON.parse(readFileSync(new URL('../data/rss-catalog/upstream.json', import.meta.url), 'utf8'))
const catalog = normalizeUpstreamCatalog(source)
const sensitiveSource = source.feeds.filter((feed: { nsfw?: boolean }) => feed.nsfw === true)
assert.equal(source.feeds.length, 4645, 'one authoritative source contains both regular and NSFW feeds')
assert.equal(sensitiveSource.length, 97)
assert.equal(catalog.feeds.length, source.feeds.length, 'all records must reach the client; visibility is a search setting')
assert.equal(catalog.feeds.filter((feed) => feed.nsfw).length, sensitiveSource.length)
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
assert.ok(catalog.feeds.filter((feed) => feed.nsfw).every((feed) => !searchCatalog(createCatalogIndex(catalog.feeds), { query: feed.title }).some((entry) => entry.id === feed.id)), 'default search hides NSFW sources')
assert.ok(searchCatalog(createCatalogIndex(catalog.feeds), { query: 'Couture Boudoir', includeNsfw: true }).some((feed) => feed.nsfw), 'explicit opt-in reveals NSFW sources')
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
