import { createHash } from 'node:crypto'
import { readFile, writeFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeUpstreamCatalog } from './rss-catalog-import'
import { buildCatalogRelease } from './rss-catalog-release'
import { catalogFeedUrl } from '../src/features/rssCatalog/schema'
import { catalogCreatorIdentity } from '../src/features/rssCatalog/identity'

interface UpstreamFeed extends Record<string, unknown> { id: string; title: string; url: string }
interface Upstream { metadata: { schema_version: number; generated_at: string; total_feeds: number; revision?: number }; feeds: UpstreamFeed[] }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('探测报告结构无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('探测报告字段无效')
  return value.trim()
}
function identity(feed: Record<string, unknown>): string {
  const url = new URL(catalogFeedUrl(feed.url))
  const converted = catalogCreatorIdentity({ url: url.href, rsshubRoute: feed.rsshub_route as string | undefined, platform: feed.platform as string | undefined, creatorId: feed.creator_id as string | undefined })
  const channelId = /^(?:www\.)?youtube\.com$/.test(url.hostname) && url.pathname === '/feeds/videos.xml' ? url.searchParams.get('channel_id') : null
  const platform = feed.platform ?? converted?.platform ?? (channelId ? 'youtube' : undefined)
  const creator = feed.creator_id ?? converted?.creatorId ?? channelId
  if (platform && creator) {
    const content = platform === 'youtube' ? 'videos' : converted?.routePath.replace(/\/[^/]+$/, '') ?? 'native'
    return `${platform}:${creator}:${content}`
  }
  return url.href
}

/** Offline bridge only: audit files are inputs, never a second maintained catalog. */
export function mergeCatalogReport(input: unknown, value: unknown, date: string) {
  const source = structuredClone(input) as Upstream
  normalizeUpstreamCatalog(source)
  const report = object(value)
  if (report.schema_version !== 1 || !Array.isArray(report.records) || !Number.isSafeInteger(report.candidate_count) || Number(report.candidate_count) < report.records.length) throw new Error('不支持的探测报告')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('导入日期无效')
  const counts = object(report.counts)
  const actual = { accept: 0, defer: 0, permanent: 0 }
  const urls = new Set(source.feeds.map(feed => catalogFeedUrl(feed.url)))
  const identities = new Set(source.feeds.map(identity))
  const ids = new Set(source.feeds.map(feed => feed.id))
  const additions: UpstreamFeed[] = []
  let duplicates = 0
  for (const raw of report.records) {
    const record = object(raw)
    if (record.decision !== 'accept' && record.decision !== 'defer' && record.decision !== 'permanent') throw new Error('未知探测决策')
    actual[record.decision]++
    // Permanent failures require human review; this command never removes old entries.
    if (record.decision !== 'accept') continue
    const observed = object(record.observation)
    const feed = object(record.feed)
    const provenance = object(feed.provenance)
    catalogFeedUrl(provenance.url)
    if (!/^[a-f0-9]{64}$/.test(text(provenance.sha256, 64)) || !text(provenance.license, 100)) throw new Error('缺少可信来源记录')
    if (observed.status !== 200 || observed.feed_valid !== true || observed.identity_confirmed !== true || !Number.isFinite(Date.parse(text(observed.checked_at, 40))) || !Array.isArray(observed.attempts)) throw new Error('未通过 Feed 验证的候选不能导入')
    const url = catalogFeedUrl(feed.url)
    const route = feed.rsshub_route
    if (route) {
      const endpoint = new URL(url)
      if (endpoint.pathname + endpoint.search !== route) throw new Error('Feed 地址与逻辑路由不一致')
      const derived = catalogCreatorIdentity({ url, rsshubRoute: text(route, 700) })
      if (!derived || (feed.platform !== undefined && feed.platform !== derived.platform) || (derived.creatorId && feed.creator_id !== undefined && feed.creator_id !== derived.creatorId)) throw new Error('平台身份与路由不一致')
    } else if (feed.platform === 'youtube') {
      const endpoint = new URL(url)
      if (endpoint.searchParams.get('channel_id') !== feed.creator_id) throw new Error('YouTube 频道身份不一致')
    }
    if (!observed.attempts.some(attempt => {
      const checked = object(attempt)
      const checkedUrl = new URL(catalogFeedUrl(checked.url))
      return checked.status === 200 && (route ? checkedUrl.pathname + checkedUrl.search === route : checkedUrl.href === url)
    })) throw new Error('检查地址与候选不匹配')
    const row: UpstreamFeed = { id: '', title: text(feed.title, 300), url, category: text(feed.category, 100), language: text(feed.language ?? 'und', 35), region: null }
    for (const field of ['platform', 'creator_id', 'rsshub_route', 'aliases', 'tags', 'nsfw', 'has_image_in_feed', 'has_video_in_feed']) {
      if (feed[field] !== undefined) row[field] = feed[field]
    }
    const key = identity(row)
    row.id = 'discovered-' + createHash('sha256').update(key).digest('hex').slice(0, 24)
    // Validate even duplicates; a malformed report must not pass by matching an old URL.
    normalizeUpstreamCatalog({ metadata: { schema_version: 1, generated_at: date, total_feeds: 1 }, feeds: [row] })
    if (identities.has(key) || urls.has(url)) { duplicates++; continue }
    if (ids.has(row.id)) throw new Error('新增来源 ID 冲突')
    identities.add(key); urls.add(url); ids.add(row.id)
    additions.push(row)
  }
  for (const key of ['accept', 'defer', 'permanent'] as const) {
    if (counts[key] !== actual[key]) throw new Error('探测报告统计不一致')
  }
  additions.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (additions.length) {
    source.feeds.push(...additions)
    source.metadata.total_feeds = source.feeds.length
    source.metadata.generated_at = date < source.metadata.generated_at ? source.metadata.generated_at : date
    source.metadata.revision = Math.max((source.metadata.revision ?? 0) + 1, Number(date.replaceAll('-', '')) * 1000 + 1)
  }
  const catalog = normalizeUpstreamCatalog(source)
  // Enforce the actual publish byte limit before any write to the authority.
  buildCatalogRelease(catalog, String(source.metadata.revision ?? date))
  return { source, added: additions.length, duplicates, deferred: actual.defer, reviewPermanent: actual.permanent }
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name: string) => argv[argv.indexOf(name) + 1]
  if (!argv.includes('--report') || !arg('--report')) throw new Error('需要 --report 指定独立检查报告')
  const file = resolve('data/rss-catalog/upstream.json')
  const original = await readFile(file, 'utf8')
  const report = JSON.parse(await readFile(resolve(arg('--report')), 'utf8'))
  // User-facing catalog dates follow the project's Asia/Shanghai calendar.
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const result = mergeCatalogReport(JSON.parse(original), report, date)
  const summary = { added: result.added, duplicates: result.duplicates, deferred: result.deferred, reviewPermanent: result.reviewPermanent, total: result.source.feeds.length, revision: result.source.metadata.revision, applied: argv.includes('--apply') }
  if (argv.includes('--apply') && result.added) {
    const pending = file + '.pending'
    await writeFile(pending, JSON.stringify(result.source, null, 2) + '\n', { flag: 'wx' })
    if (await readFile(file, 'utf8') !== original) throw new Error('权威文件已被其他操作修改；保留 pending 供检查，未覆盖原文件')
    await rename(pending, file)
  }
  console.log(JSON.stringify(summary))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error instanceof Error ? error.message : '探测报告导入失败'); process.exitCode = 1 })
