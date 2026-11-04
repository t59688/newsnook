import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { CatalogService, type CatalogState } from '../src/features/rssCatalog/service'
import type { RssCatalog } from '../src/features/rssCatalog/schema'

const seed: RssCatalog = { schemaVersion: 1, generatedAt: '2026-11-03T00:00:00Z', feeds: [{ id: 'seed', title: 'Seed', url: 'https://example.org/rss', category: '科技', language: 'en', region: 'Global', aliases: [], tags: [], nsfw: false }] }
const remote: RssCatalog = { ...seed, feeds: [{ ...seed.feeds[0], id: 'new', title: 'New' }] }
const payload = JSON.stringify(remote)
const sha256 = createHash('sha256').update(payload).digest('hex')
const manifest = { manifestSchema: 1, catalog: { version: '1', schemaVersion: 1, generatedAt: remote.generatedAt, feedCount: 1, size: Buffer.byteLength(payload), sha256, url: `/rss-catalog/v1/catalogs/sha256-${sha256}.json` } }
let now = 100_000_000
let saved: CatalogState | null = null
let calls: string[] = []
let badHash = false
let failSave = false
const service = new CatalogService({ seed: async () => seed, now: () => now,
  storage: { read: async () => saved, write: async (next) => { if (failSave) throw new Error('quota'); saved = next } },
  fetch: async (url) => { calls.push(String(url)); return new Response(String(url).endsWith('manifest.json') ? JSON.stringify(manifest) : badHash ? payload.replace('New', 'Bad') : payload) },
})
assert.equal((await service.load()).catalog.feeds[0].id, 'seed')
badHash = true
await assert.rejects(service.refresh())
assert.equal(service.snapshot!.catalog.feeds[0].id, 'seed')
assert.equal(saved, null)
const count = calls.length
await service.refresh()
assert.equal(calls.length, count, 'failed checks have a retry delay')
now += 3_600_001
badHash = false
failSave = true
await assert.rejects(service.refresh())
assert.equal(service.snapshot!.catalog.feeds[0].id, 'seed', 'quota failure preserves the usable snapshot')
failSave = false
now += 3_600_001
calls = []
await Promise.all([service.refresh(), service.refresh()])
assert.equal(calls.length, 2, 'concurrent refreshes share manifest and snapshot requests')
assert.equal(service.snapshot!.catalog.feeds[0].id, 'new')
assert.ok(saved)
now += 3_600_000 - 1
calls = []
await service.refresh()
assert.equal(calls.length, 0, 'successful checks are throttled until one hour has elapsed')
now += 1
await service.refresh()
assert.equal(calls.length, 1, 'matching hash does not redownload the catalog')
const warm = new CatalogService({ seed: async () => { throw new Error('must use cache') }, storage: { read: async () => saved, write: async () => {} } })
assert.equal((await warm.load()).catalog.feeds[0].id, 'new')
const corrupt = new CatalogService({ seed: async () => seed, storage: { read: async () => ({ ...saved!, sha256: 'broken' }), write: async () => {} } })
assert.equal((await corrupt.load()).catalog.feeds[0].id, 'seed')
const obsoletePayload = JSON.stringify({ ...remote, feeds: remote.feeds.map(({ nsfw: _nsfw, ...feed }) => feed) })
const obsolete = new CatalogService({ seed: async () => seed, storage: { read: async () => ({ ...saved!, payload: obsoletePayload, sha256: createHash('sha256').update(obsoletePayload).digest('hex') }), write: async () => {} } })
assert.equal((await obsolete.load()).catalog.feeds[0].id, 'seed', 'an obsolete catalog without NSFW fields cannot override a new bundled seed')
console.log('rss catalog update lifecycle: ok')
