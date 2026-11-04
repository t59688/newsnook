import assert from 'node:assert/strict'
import { buildCatalogRelease, publishCatalogRelease } from './rss-catalog-release'
const feed = { id: 'a', title: 'A', url: 'https://example.org/rss', category: '科技', language: 'en', region: 'Global', aliases: [], tags: [] }
const source = { schemaVersion: 1, generatedAt: '2026-11-03T00:00:00Z', feeds: [feed] }
const release = buildCatalogRelease(source, '2026.11.03.1')
assert.equal(buildCatalogRelease(source, '2026.11.03.2').payload, release.payload, 'release label does not change content hash')
assert.equal(Buffer.byteLength(release.payload), release.manifest.catalog.size)
assert.throws(() => buildCatalogRelease({ ...source, feeds: [] }, '1'))
assert.throws(() => buildCatalogRelease(source, 'bad\nversion'))
assert.throws(() => buildCatalogRelease({ ...source, feeds: [{ ...feed, nsfw: true }] }, '1'), /NSFW/, 'v1 publication must reject adult-labeled sources')
assert.throws(() => buildCatalogRelease({ ...source, feeds: [{ ...feed, nsfw: 'true' }] }, '1'), /NSFW/, 'v1 publication must fail closed on malformed adult flags')
const operations: string[] = []
let corrupt = true
const store = {
  put: async (key: string, body: string, cache: string) => { operations.push('put:' + key); assert.ok(body); assert.ok(cache) },
  get: async (key: string) => { operations.push('get:' + key); return corrupt ? 'bad' : release.payload },
}
await assert.rejects(publishCatalogRelease(release, store))
assert.equal(operations.some((operation) => operation.endsWith('manifest.json')), false, 'never publish a pointer to an unverified snapshot')
operations.length = 0
corrupt = false
await publishCatalogRelease(release, store)
assert.deepEqual(operations, ['put:' + release.key, 'get:' + release.key, 'put:rss-catalog/v1/manifest.json'])
assert.equal(release.key, `rss-catalog/v1/catalogs/sha256-${release.manifest.catalog.sha256}.json`)
console.log('rss catalog publication: ok')
