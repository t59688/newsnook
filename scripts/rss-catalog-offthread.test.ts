import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseCatalog } from '../src/features/rssCatalog/schema'
import { createCatalogIndex, searchCatalog } from '../src/features/rssCatalog/search'
import { CatalogSearchEngine } from '../src/features/rssCatalog/searchEngine'

const full = parseCatalog(JSON.parse(readFileSync('src/features/rssCatalog/seed.json', 'utf8')))
const index = createCatalogIndex(full.feeds)
const engine = new CatalogSearchEngine(full.feeds)
const base = searchCatalog(index, {})
assert.equal(base.length, 38957, 'use the current production-sized catalog')
const first = engine.query({ query: '', category: '', language: '', limit: 30 })
assert.equal(first.total, base.length)
assert.deepEqual(first.feeds.map((f) => f.id), base.slice(0, 30).map((f) => f.id),
  'first 30 records retain the exact original ordering')
assert.equal(first.feeds.length, 30, 'worker never posts the complete catalog to the UI')
assert.deepEqual(engine.query({limit: 60}).feeds.map((f) => f.id), base.slice(0,60).map((f) => f.id),
  'load-more returns a stable prefix, with no resort on the UI thread')

for (const args of [
  { query: '影视飓风' }, { query: '影视剧风' }, { query: '人工智能' },
  { query: '微博', language: 'zh' }, { query: '', category: '科技' },
  { query: '', language: 'en' }, { query: 'nsfw' }, { query: 'name-absent' },
]) {
  const expected = searchCatalog(index, args)
  const actual = engine.query({ ...args, limit: 30 })
  assert.equal(actual.total, expected.length, JSON.stringify(args))
  assert.deepEqual(actual.feeds.map((f) => f.id), expected.slice(0, 30).map((f) => f.id),
    'query returns the same matches and rank order as the current search')
}
assert.ok(engine.summary.categories.length >= 60)
assert.equal(engine.summary.count, full.feeds.length)
assert.ok(engine.summary.languages.includes('zh'))
console.log('RSS catalog off-thread search window and 38,957-entry parity: ok')
