import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeCatalogReport } from './rss-catalog-merge'

const upstream = { metadata: { schema_version: 1, generated_at: '2026-11-04', total_feeds: 1, revision: 20261104004 }, feeds: [
  { id: 'rss-existing', title: 'Existing', url: 'https://existing.test/feed', category: 'Personal Blogs', language: 'en', region: null },
] }
const record = { key: 'https://new.test/feed', decision: 'accept', feed: { title: 'Slow writer', url: 'https://new.test/feed', category: 'Personal Blogs', language: 'und', provenance: { url: 'https://directory.test/list', sha256: 'a'.repeat(64), license: 'MIT' } },
  observation: { run_id: 'run-1', checked_at: '2026-11-04T00:00:00Z', status: 200, feed_valid: true, identity_confirmed: true, attempts: [{ url: 'https://new.test/feed', status: 200 }] }, history: [] }
const report = { schema_version: 1, generated_at: '2026-11-04T00:00:00Z', records: [record], candidate_count: 1, counts: { accept: 1, defer: 0, permanent: 0 } }
const result = mergeCatalogReport(upstream, report, '2026-11-04')
assert.equal(result.added, 1)
assert.deepEqual(result.source.feeds[0], upstream.feeds[0], 'preserve original metadata and IDs')
assert.equal(result.source.metadata.revision, 20261104005)
assert.equal(result.source.feeds[1].title, 'Slow writer', 'no freshness gate')
assert.ok(!('provenance' in result.source.feeds[1]), 'audit data never enters runtime catalog')
const again = mergeCatalogReport(result.source, report, '2026-11-04')
assert.equal(again.added, 0)
assert.deepEqual(again.source, result.source, 'repeated merge is byte stable and does not increment revision')
assert.throws(() => mergeCatalogReport(upstream, { ...report, schema_version: 2 }, '2026-11-04'))
assert.throws(() => mergeCatalogReport(upstream, { ...report, counts: { accept: 2, defer: 0, permanent: 0 } }, '2026-11-04'))
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...record, observation: { ...record.observation, feed_valid: false } }] }, '2026-11-04'))
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...record, feed: { ...record.feed, url: 'https://user:secret@private.test/feed' } }] }, '2026-11-04'))
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...record, feed: { ...record.feed, provenance: undefined } }] }, '2026-11-04'))
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...record, feed: { ...record.feed, category: 'unmapped' } }] }, '2026-11-04'))
const defer = { ...record, decision: 'defer', observation: { ...record.observation, status: 403, feed_valid: false } }
const skipped = mergeCatalogReport(upstream, { ...report, counts: { accept: 0, defer: 1, permanent: 0 }, records: [defer] }, '2026-11-04')
assert.deepEqual(skipped.source, upstream, 'temporary failure adds nothing and never deletes existing feeds')
const youtube = { id: 'youtube-existing', title: 'Creator', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012', category: 'Videos', language: 'und', region: null }
const creatorRecord = { ...record, feed: { ...record.feed, url: 'https://rsshub.app/youtube/channel/UC1234567890123456789012', rsshub_route: '/youtube/channel/UC1234567890123456789012', platform: 'youtube', creator_id: 'UC1234567890123456789012' }, observation: { ...record.observation, attempts: [{ url: 'https://rsshub.app/youtube/channel/UC1234567890123456789012', status: 200 }] } }
const existingCreator = { ...upstream, feeds: [youtube] }
assert.equal(mergeCatalogReport(existingCreator, { ...report, records: [creatorRecord] }, '2026-11-04').added, 0, 'native and converted YouTube channel are the same content identity')
const differentCreator = { ...creatorRecord, feed: { ...creatorRecord.feed, platform: 'bilibili', creator_id: '123', url: 'https://rsshub.app/bilibili/user/video/123', rsshub_route: '/bilibili/user/video/123' }, observation: { ...record.observation, attempts: [{ url: 'https://rsshub.app/bilibili/user/video/123', status: 200 }] } }
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...differentCreator, decision: 'index' }], counts: { accept: 0, index: 1, defer: 0, permanent: 0 } }, '2026-11-04'), /决策/, 'identity-only candidates cannot bypass Feed verification')
for (const platform of ['telegram', 'twitter']) {
  const account = (name: string) => {
    const route = `/${platform}/${platform === 'telegram' ? 'channel' : 'user'}/${name}`
    const url = 'https://rsshub.app' + route
    return { ...differentCreator, feed: { ...differentCreator.feed, platform, creator_id: name, rsshub_route: route, url }, observation: { ...record.observation, attempts: [{ url, status: 200 }] } }
  }
  const first = mergeCatalogReport(upstream, { ...report, records: [account('Example_User')] }, '2026-11-04')
  assert.equal(mergeCatalogReport(first.source, { ...report, records: [account('example_user')] }, '2026-11-04').added, 0, `${platform} account names are case-insensitive`)
}
assert.equal(mergeCatalogReport(existingCreator, { ...report, records: [differentCreator] }, '2026-11-04').added, 1, 'same name on another platform is not proof of shared identity')
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...differentCreator, feed: { ...differentCreator.feed, creator_id: '456' } }] }, '2026-11-04'), /身份/, 'route UID and claimed creator UID must agree')
assert.throws(() => mergeCatalogReport(upstream, { ...report, records: [{ ...differentCreator, feed: { ...differentCreator.feed, url: 'https://rsshub.app/bilibili/user/video/456' } }] }, '2026-11-04'), /地址/, 'feed URL and route must describe the same content')
assert.deepEqual(upstream.feeds.map(feed => feed.id), ['rss-existing'], 'merge never mutates input')
mkdirSync(resolve('artifacts'), { recursive: true })
const work = mkdtempSync(resolve('artifacts/rss-catalog-merge-test-'))
mkdirSync(join(work, 'data/rss-catalog'), { recursive: true })
const authority = join(work, 'data/rss-catalog/upstream.json')
const reportFile = join(work, 'report.json')
const original = JSON.stringify(upstream)
writeFileSync(authority, original)
writeFileSync(reportFile, JSON.stringify(report))
const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./rss-catalog-merge.ts', import.meta.url)), '--report', reportFile, ...args], { cwd: work, encoding: 'utf8' })
assert.equal(cli().status, 0)
assert.equal(readFileSync(authority, 'utf8'), original, 'CLI preview must never write the authority')
writeFileSync(reportFile, JSON.stringify({ ...report, counts: {} }))
assert.notEqual(cli('--apply').status, 0)
assert.equal(readFileSync(authority, 'utf8'), original, 'invalid input is rejected before touching the authority')
assert.equal(existsSync(authority + '.pending'), false)
writeFileSync(reportFile, JSON.stringify(report))
const applied = cli('--apply')
assert.equal(applied.status, 0, applied.stderr)
assert.equal(JSON.parse(readFileSync(authority, 'utf8')).feeds.length, 2)
assert.equal(existsSync(authority + '.pending'), false, 'atomic replace leaves no pending authority')
const once = readFileSync(authority, 'utf8')
assert.equal(cli('--apply').status, 0)
assert.equal(readFileSync(authority, 'utf8'), once, 'CLI repeat import is byte-stable')
console.log('rss catalog report merge: verified additions, identity deduplication, idempotence and fail-closed validation')
