import assert from 'node:assert/strict'
import { parseCatalog, parseManifest } from '../src/features/rssCatalog/schema'
import { createCatalogIndex, searchCatalog } from '../src/features/rssCatalog/search'

const feed = { id: 'ai', title: 'AI Research', url: 'https://example.org/rss', category: '人工智能', language: 'en', region: 'Global', aliases: ['机器学习'], tags: ['科研'], nsfw: false }
const catalog = { schemaVersion: 1, generatedAt: '2026-11-03T00:00:00Z', feeds: [feed] }
assert.equal(parseCatalog(catalog).feeds.length, 1)
assert.throws(() => parseCatalog({ ...catalog, schemaVersion: 2 }))
assert.throws(() => parseCatalog({ ...catalog, feeds: [feed, feed] }))
assert.throws(() => parseCatalog({ ...catalog, feeds: [{ ...feed, nsfw: undefined }] }), /NSFW/)
assert.throws(() => parseCatalog({ ...catalog, feeds: [{ ...feed, nsfw: 'true' }] }), /NSFW/)
assert.throws(() => parseCatalog({ ...catalog, feeds: [{ ...feed, url: 'javascript:alert(1)' }] }))
assert.throws(() => parseCatalog({ ...catalog, feeds: [{ ...feed, url: 'https://user:password@example.org/' }] }))
const sha256 = 'a'.repeat(64)
const manifest = { manifestSchema: 1, catalog: { version: '2026.11.03', schemaVersion: 1, generatedAt: catalog.generatedAt, feedCount: 1, size: 100, sha256, url: `/rss-catalog/v1/catalogs/sha256-${sha256}.json` } }
assert.equal(parseManifest(manifest).catalog.sha256, sha256)
assert.throws(() => parseManifest({ ...manifest, catalog: { ...manifest.catalog, url: 'https://other.example/a.json' } }))
assert.throws(() => parseManifest({ ...manifest, catalog: { ...manifest.catalog, size: 9 * 1024 * 1024 } }))
const index = createCatalogIndex([feed, { ...feed, id: 'zh', title: '科研', language: 'zh', url: 'https://example.cn/rss' }])
assert.equal(searchCatalog(index, { query: '机器学习' }).length, 2)
assert.equal(searchCatalog(index, { query: 'ＡＩ' })[0].id, 'ai')
assert.equal(searchCatalog(index, { query: '科研', language: 'zh' })[0].id, 'zh')
assert.equal(searchCatalog(index, { query: 'AI 不存在' }).length, 0)
assert.equal(searchCatalog(index, { category: '不存在' }).length, 0)
const adult = { ...feed, id: 'adult', url: 'https://example.org/adult', title: 'Portrait Studio', nsfw: true }
const mixed = createCatalogIndex([feed, adult])
assert.equal(searchCatalog(mixed, {}).length, 2, 'all sources are searchable without a visibility filter')
assert.equal(searchCatalog(mixed, { query: 'Portrait Studio' })[0].id, 'adult')
assert.equal(searchCatalog(mixed, { query: 'nsfw' })[0].id, 'adult', 'source metadata remains searchable')
assert.equal(searchCatalog(mixed, { query: '成人内容' })[0].id, 'adult')

const upgraded = { ...feed, id: 'creator', url: 'https://rsshub-balancer.virworks.moe/bilibili/user/video/946974',
  title: '影视飓风 · Bilibili 空间', aliases: ['MediaStorm', 'ying shi ju feng', 'yingshijufeng'],
  platform: 'bilibili', creatorId: '946974', rsshubRoute: '/bilibili/user/video/946974' }
assert.deepEqual(parseCatalog({ ...catalog, revision: 20261104004, feeds: [upgraded] }).feeds[0], upgraded)
assert.throws(() => parseCatalog({ ...catalog, feeds: [{ ...upgraded, rsshubRoute: '/../private' }] }))
assert.throws(() => parseCatalog({ ...catalog, revision: -1 }))
const sourceIndex = createCatalogIndex([upgraded, { ...feed, id: 'other', title: '影视工作室', url: 'https://example.org/film' }])
for (const term of ['影视飓风', '影视剧风', '946974', 'MediaStorm', 'yingshijufeng']) {
  assert.equal(searchCatalog(sourceIndex, { query: term })[0]?.id, 'creator', term)
}
assert.equal(searchCatalog(sourceIndex, { query: '电影' }).length, 0, 'unrelated fuzzy suggestions must not appear')
console.log('rss catalog schema/search: ok')
