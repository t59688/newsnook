import { log } from '../../lib/logger'
import { CATALOG_BASE, MAX_CATALOG_BYTES, parseCatalog, parseManifest, type RssCatalog } from './schema'

export interface CatalogState { catalog: RssCatalog; payload: string; sha256: string; version: string; checkedAt: number }
export interface CatalogStorage { read(): Promise<CatalogState | null>; write(state: CatalogState): Promise<void> }
interface Options {
  seed(): Promise<unknown>
  storage: CatalogStorage
  fetch?: typeof fetch
  now?: () => number
}
/** Newer full snapshots win; catalog revision disambiguates releases on the same date.
 * Feed count is only the last tie-breaker, never a replacement for versioning. */
function compareCatalog(a: RssCatalog, b: RssCatalog): number {
  const dateDifference = Date.parse(a.generatedAt) - Date.parse(b.generatedAt)
  if (dateDifference) return Math.sign(dateDifference)
  if ((a.revision ?? 0) !== (b.revision ?? 0)) return Math.sign((a.revision ?? 0) - (b.revision ?? 0))
  return Math.sign(a.feeds.length - b.feeds.length)
}

/** Published versions like 2026.11.04.3 are comparable with the bundled numeric revision. */
function publicationRevision(version: string): number | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})\.(\d{1,3})$/.exec(version)
  return match ? Number(match[1] + match[2] + match[3]) * 1000 + Number(match[4]) : null
}

export async function catalogHash(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
/** Limit decompressed bytes while streaming; content-length may describe compression. */
async function readBounded(response: Response, limit: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error('RSS 目录暂时无法更新')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('RSS 目录响应过大')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
export class CatalogService {
  snapshot: CatalogState | null = null
  private loading: Promise<CatalogState> | null = null
  private updating: Promise<void> | null = null
  private retryAt = 0
  private listeners = new Set<() => void>()
  private options: Options
  constructor(options: Options) { this.options = options }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: CatalogState) { this.snapshot = state; for (const listener of this.listeners) listener() }
  load(): Promise<CatalogState> {
    if (this.snapshot) return Promise.resolve(this.snapshot)
    if (this.loading) return this.loading
    this.loading = this.loadLocal().finally(() => { this.loading = null })
    return this.loading
  }
  private async loadLocal(): Promise<CatalogState> {
    let cachedState: CatalogState | null = null
    try {
      const cached = await this.options.storage.read()
      if (cached) {
        if (typeof cached.payload !== 'string' || new TextEncoder().encode(cached.payload).length > MAX_CATALOG_BYTES || !/^[a-f0-9]{64}$/.test(cached.sha256) || await catalogHash(cached.payload) !== cached.sha256 || !Number.isFinite(cached.checkedAt) || cached.checkedAt < 0) throw new Error('缓存无效')
        cachedState = { ...cached, catalog: parseCatalog(JSON.parse(cached.payload)) }
      }
    } catch { log.storage.warn('RSS catalog cache unavailable; trying bundled seed') }
    let bundled: RssCatalog
    try { bundled = parseCatalog(await this.options.seed()) }
    catch (error) {
      if (!cachedState) throw error
      this.publish(cachedState)
      return cachedState
    }
    if (cachedState && compareCatalog(cachedState.catalog, bundled) >= 0) {
      this.publish(cachedState)
      return cachedState
    }
    const payload = JSON.stringify(bundled)
    const state = { catalog: bundled, payload, sha256: await catalogHash(payload), version: 'bundled', checkedAt: 0 }
    this.publish(state)
    return state
  }
  refresh(): Promise<void> {
    if (this.updating) return this.updating
    this.updating = this.update().finally(() => { this.updating = null })
    return this.updating
  }
  private async update(): Promise<void> {
    const local = await this.load()
    const now = (this.options.now ?? Date.now)()
    if (now < this.retryAt || (local.checkedAt > 0 && now >= local.checkedAt && now - local.checkedAt < 3_600_000)) return
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), 30_000)
    const get = async (url: string, limit: number) => readBounded(await (this.options.fetch ?? fetch)(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache', redirect: 'error' }), limit)
    try {
      const manifest = parseManifest(JSON.parse(await get(CATALOG_BASE + 'manifest.json', 16_384))).catalog
      let next = local
      const advertisedRevision = publicationRevision(manifest.version)
      const obsoleteManifest = manifest.generatedAt < local.catalog.generatedAt ||
        manifest.generatedAt === local.catalog.generatedAt && advertisedRevision !== null &&
        advertisedRevision < (local.catalog.revision ?? 0)
      if (!obsoleteManifest && manifest.sha256 !== local.sha256) {
        const payload = await get(new URL(manifest.url, CATALOG_BASE).href, MAX_CATALOG_BYTES)
        if (new TextEncoder().encode(payload).length !== manifest.size || await catalogHash(payload) !== manifest.sha256) throw new Error('RSS 目录完整性校验失败')
        const catalog = parseCatalog(JSON.parse(payload))
        if (catalog.feeds.length !== manifest.feedCount || catalog.generatedAt !== manifest.generatedAt) throw new Error('RSS 目录与清单不一致')
        if (compareCatalog(catalog, local.catalog) >= 0) next = { catalog, payload, sha256: manifest.sha256, version: manifest.version, checkedAt: now }
      }
      next = { ...next, checkedAt: now }
      await this.options.storage.write(next)
      this.publish(next)
      this.retryAt = 0
    } catch (error) { this.retryAt = now + 3_600_000; throw error }
    finally { globalThis.clearTimeout(timer) }
  }
}
