/** Shared by the offline client and the release script. No runtime dependencies. */
export const CATALOG_BASE = 'https://news-update.aizeek.com/rss-catalog/v1/'
export const MAX_CATALOG_BYTES = 8 * 1024 * 1024
export interface CatalogFeed {
  id: string
  title: string
  url: string
  category: string
  language: string
  region: string
  aliases: string[]
  tags: string[]
  nsfw: boolean
}
export interface RssCatalog { schemaVersion: 1; generatedAt: string; feeds: CatalogFeed[] }
export interface CatalogManifest {
  manifestSchema: 1
  catalog: { version: string; schemaVersion: 1; generatedAt: string; feedCount: number; size: number; sha256: string; url: string }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RSS 目录格式不正确')
  return value as Record<string, unknown>
}
function string(value: unknown, max = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('RSS 目录字段不正确')
  return value.trim()
}
function date(value: unknown): string {
  const result = string(value, 40)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error('RSS 目录日期无效')
  return result
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('RSS 目录关键词无效')
  return value.map((item) => string(item, 100))
}
export function catalogFeedUrl(value: unknown): string {
  const url = new URL(string(value, 2048))
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('RSS 目录地址无效')
  return url.href
}
export function parseCatalog(value: unknown): RssCatalog {
  const root = object(value)
  if (root.schemaVersion !== 1 || !Array.isArray(root.feeds) || !root.feeds.length || root.feeds.length > 50_000) throw new Error('不支持的 RSS 目录结构')
  const ids = new Set<string>()
  const urls = new Set<string>()
  const feeds = root.feeds.map((raw): CatalogFeed => {
    const row = object(raw)
    const id = string(row.id, 100)
    const url = catalogFeedUrl(row.url)
    if (ids.has(id) || urls.has(url)) throw new Error('RSS 目录包含重复来源')
    ids.add(id); urls.add(url)
    if (typeof row.nsfw !== 'boolean') throw new Error('RSS 目录 NSFW 标记无效')
    return { id, url, title: string(row.title), category: string(row.category, 100), language: string(row.language, 35), region: string(row.region, 100), aliases: strings(row.aliases), tags: strings(row.tags), nsfw: row.nsfw }
  })
  return { schemaVersion: 1, generatedAt: date(root.generatedAt), feeds }
}
export function parseManifest(value: unknown): CatalogManifest {
  const root = object(value)
  const row = object(root.catalog)
  if (root.manifestSchema !== 1 || row.schemaVersion !== 1 || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error('不支持的 RSS 目录清单')
  if (!Number.isSafeInteger(row.feedCount) || Number(row.feedCount) < 1 || Number(row.feedCount) > 50_000 || !Number.isSafeInteger(row.size) || Number(row.size) < 1 || Number(row.size) > MAX_CATALOG_BYTES) throw new Error('RSS 目录大小无效')
  // The fixed path also prevents credentials or arbitrary remote endpoints.
  const url = `/rss-catalog/v1/catalogs/sha256-${row.sha256}.json`
  if (row.url !== url) throw new Error('RSS 目录快照路径无效')
  return { manifestSchema: 1, catalog: { schemaVersion: 1, version: string(row.version, 100), generatedAt: date(row.generatedAt), sha256: row.sha256, size: Number(row.size), feedCount: Number(row.feedCount), url } }
}
