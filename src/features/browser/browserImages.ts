export const BROWSER_IMAGE_LIMIT = 240
export const BROWSER_IMAGE_PAGE_SIZE = 24
export const BROWSER_IMAGE_MAX_BYTES = 6 * 1024 * 1024

export type BrowserImageKind = 'img' | 'srcset' | 'lazy' | 'background' | 'svg'
export interface BrowserImageCandidate {
  id: string
  /** The source is metadata, never a shell-WebView image src. */
  sourceUrl: string
  pageUrl: string
  alt: string
  width: number
  height: number
  kinds: BrowserImageKind[]
  content: boolean
  /** data/blob resources must be exported by their owning page. */
  transport: 'http' | 'page'
  requestHeaders?: { Referer?: string; Origin?: string; 'User-Agent'?: string }
}

export interface BrowserImageSnapshot {
  tabId: number
  documentId: string
  requestId: string
  pageUrl: string
  items: BrowserImageCandidate[]
  truncated: boolean
  inaccessibleFrames: number
}

export interface BrowserImageLoadRequest {
  tabId: number
  documentId: string
  requestId: string
  imageId: string
  thumbnail: boolean
  /** Only an explicit save/share requests the original bytes. */
  original?: boolean
}

export interface BrowserImageCancelRequest {
  tabId: number
  documentId?: string
  requestId?: string
}

export interface BrowserImageData {
  tabId: number
  documentId: string
  requestId: string
  imageId: string
  dataUrl: string
  mimeType: string
  byteLength: number
  width: number
  height: number
  reduced: boolean
}

export function isBrowserImageSnapshot(value: unknown): value is BrowserImageSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<BrowserImageSnapshot>
  return Number.isInteger(snapshot.tabId) && (snapshot.tabId ?? 0) > 0
    && typeof snapshot.documentId === 'string' && snapshot.documentId.length > 0
    && typeof snapshot.requestId === 'string' && snapshot.requestId.length > 0
    && typeof snapshot.pageUrl === 'string' && /^https?:\/\//i.test(snapshot.pageUrl)
    && Array.isArray(snapshot.items) && snapshot.items.length <= BROWSER_IMAGE_LIMIT
    && snapshot.items.every(item => item && typeof item.id === 'string'
      && typeof item.sourceUrl === 'string' && typeof item.pageUrl === 'string'
      && typeof item.alt === 'string' && typeof item.content === 'boolean'
      && Number.isFinite(item.width) && Number.isFinite(item.height)
      && Array.isArray(item.kinds) && (item.transport === 'http' || item.transport === 'page'))
}

/** Identity is stronger than a URL: same-address reloads are different documents. */
export function isBrowserImageResponseCurrent(request: BrowserImageLoadRequest, response: BrowserImageData): boolean {
  return response.tabId === request.tabId && response.documentId === request.documentId
    && response.requestId === request.requestId && response.imageId === request.imageId
}

export function browserImageTitle(item: BrowserImageCandidate, index: number): string {
  return item.alt.trim() || `图片 ${index + 1}`
}

export function browserImageSourceLabel(item: BrowserImageCandidate): string {
  if (item.transport === 'page') return item.sourceUrl.startsWith('blob:') ? '网页内存图片' : '内嵌图片'
  try { return new URL(item.sourceUrl).hostname } catch { return '网页图片' }
}

/** All query parameters remain intact, including signatures and size variants. */
export function dedupeBrowserImages(items: readonly BrowserImageCandidate[]): BrowserImageCandidate[] {
  const seen = new Set<string>()
  return items.filter(item => {
    // Page-owned data images have intentionally elided URLs; their native id is authoritative.
    const key = item.sourceUrl === 'data:' ? item.id : item.sourceUrl
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, BROWSER_IMAGE_LIMIT)
}

export function browserImageBlob(data: BrowserImageData): Blob {
  if (!/^image\/(?:png|jpe?g|webp|gif|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/i.test(data.mimeType)
    || !Number.isInteger(data.byteLength) || data.byteLength <= 0 || data.byteLength > BROWSER_IMAGE_MAX_BYTES) {
    throw new Error('图片格式或大小超出查看预算，请返回网页查看')
  }
  const prefix = `data:${data.mimeType};base64,`
  if (!data.dataUrl.startsWith(prefix)) throw new Error('图片数据格式无效，请重新扫描')
  const raw = data.dataUrl.slice(prefix.length)
  if (raw.length > Math.ceil(BROWSER_IMAGE_MAX_BYTES / 3) * 4 + 4) throw new Error('图片过大，请返回网页查看')
  const binary = atob(raw)
  if (binary.length !== data.byteLength) throw new Error('图片数据不完整，请重试')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: data.mimeType })
}

/**
 * A panel owns every object URL. Thumbnails have a small LRU and full images a
 * separate three-item budget; closing the panel invalidates late completions.
 */
export class BrowserImageMemory {
  private urls = new Map<string, { url: string; byteLength: number; thumbnail: boolean }>()
  private disposed = false

  get(key: string): string | undefined {
    const value = this.urls.get(key)
    if (!value) return undefined
    this.urls.delete(key)
    this.urls.set(key, value)
    return value.url
  }

  put(key: string, blob: Blob, thumbnail: boolean): string {
    if (this.disposed) throw new Error('看图模式已关闭')
    this.remove(key)
    const value = { url: URL.createObjectURL(blob), byteLength: blob.size, thumbnail }
    this.urls.set(key, value)
    const budget = thumbnail ? 48 : 3
    const byteBudget = thumbnail ? 4 * 1024 * 1024 : 12 * 1024 * 1024
    let candidates = [...this.urls].filter(([, item]) => item.thumbnail === thumbnail)
    let bytes = candidates.reduce((total, [, item]) => total + item.byteLength, 0)
    while (candidates.length > budget || bytes > byteBudget) {
      const [oldKey, old] = candidates.shift()!
      bytes -= old.byteLength
      this.remove(oldKey)
    }
    return value.url
  }

  remove(key: string): void {
    const value = this.urls.get(key)
    if (value) URL.revokeObjectURL(value.url)
    this.urls.delete(key)
  }

  retainDisplay(keys: ReadonlySet<string>): void {
    for (const [key, value] of this.urls) {
      if (!value.thumbnail && !keys.has(key)) this.remove(key)
    }
  }

  close(): void {
    this.disposed = true
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url)
    this.urls.clear()
  }
}


type ImageJob = {
  key: string
  request: BrowserImageLoadRequest
  original: boolean
  resolve: (value: string | Blob) => void
  reject: (error: Error) => void
  promise: Promise<string | Blob>
  finish?: () => void
}

/** Two requests at a time, a bounded queue, and no side effects after close. */
export class BrowserImageLoader {
  readonly memory = new BrowserImageMemory()
  private jobs = new Map<string, ImageJob>()
  private queue: ImageJob[] = []
  private errors = new Map<string, string>()
  private running = 0
  private serial = 0
  private closed = false

  readonly snapshot: BrowserImageSnapshot
  private loadNative: (request: BrowserImageLoadRequest) => Promise<BrowserImageData>
  private cancelNative: (request: BrowserImageCancelRequest) => Promise<void>
  private changed: () => void

  constructor(
    snapshot: BrowserImageSnapshot,
    loadNative: (request: BrowserImageLoadRequest) => Promise<BrowserImageData>,
    cancelNative: (request: BrowserImageCancelRequest) => Promise<void>,
    changed: () => void,
  ) {
    this.snapshot = snapshot
    this.loadNative = loadNative
    this.cancelNative = cancelNative
    this.changed = changed
  }

  key(item: BrowserImageCandidate, thumbnail: boolean): string { return (thumbnail ? 't:' : 'd:') + item.id }
  cached(item: BrowserImageCandidate, thumbnail: boolean): string | undefined { return this.memory.get(this.key(item, thumbnail)) }
  error(item: BrowserImageCandidate, thumbnail: boolean): string | undefined { return this.errors.get(this.key(item, thumbnail)) }

  load(item: BrowserImageCandidate, thumbnail: boolean, retry = false): Promise<string> {
    const key = this.key(item, thumbnail)
    if (retry) { this.errors.delete(key); this.memory.remove(key) }
    const cached = this.memory.get(key)
    if (cached) return Promise.resolve(cached)
    const error = this.errors.get(key)
    if (error) return Promise.reject(new Error(error))
    return this.enqueue(item, thumbnail, false) as Promise<string>
  }

  original(item: BrowserImageCandidate): Promise<Blob> {
    return this.enqueue(item, false, true) as Promise<Blob>
  }

  displayWindow(items: readonly BrowserImageCandidate[]): void {
    const keys = new Set(items.map(item => this.key(item, false)))
    this.memory.retainDisplay(keys)
    for (const job of [...this.jobs.values()]) {
      if (job.request.thumbnail || job.original || keys.has(job.key)) continue
      this.queue = this.queue.filter(queued => queued !== job)
      if (job.finish) {
        job.finish()
        void this.cancelNative(job.request).catch(() => {})
      } else {
        this.jobs.delete(job.key)
        job.reject(new Error('图片读取已取消'))
      }
    }
    this.pump()
  }

  cancelExports(): void {
    for (const job of [...this.jobs.values()]) {
      if (!job.original) continue
      this.queue = this.queue.filter(queued => queued !== job)
      if (job.finish) {
        job.finish()
        void this.cancelNative(job.request).catch(() => {})
      } else {
        this.jobs.delete(job.key)
        job.reject(new Error('图片读取已取消'))
      }
    }
    this.pump()
  }

  private enqueue(item: BrowserImageCandidate, thumbnail: boolean, original: boolean): Promise<string | Blob> {
    if (this.closed) return Promise.reject(new Error('看图模式已关闭'))
    const key = (original ? 'o:' : thumbnail ? 't:' : 'd:') + item.id
    const existing = this.jobs.get(key)
    if (existing) return existing.promise
    if (this.queue.length >= 32) return Promise.reject(new Error('正在读取其他图片，请稍后重试'))
    const request: BrowserImageLoadRequest = {
      tabId: this.snapshot.tabId, documentId: this.snapshot.documentId,
      imageId: item.id, requestId: 'image-' + Date.now().toString(36) + '-' + (++this.serial).toString(36),
      thumbnail, ...(original ? { original: true } : {}),
    }
    let resolve!: ImageJob['resolve'], reject!: ImageJob['reject']
    const promise = new Promise<string | Blob>((yes, no) => { resolve = yes; reject = no })
    const job = { key, request, original, resolve, reject, promise }
    this.jobs.set(key, job)
    if (thumbnail) this.queue.push(job)
    else this.queue.unshift(job)
    this.pump()
    return promise
  }

  private pump(): void {
    while (!this.closed && this.running < 2 && this.queue.length) {
      const job = this.queue.shift()!
      this.running++
      let complete = false
      const finish = () => {
        if (complete) return false
        complete = true
        clearTimeout(timer)
        this.jobs.delete(job.key)
        this.running--
        return true
      }
      const timer = setTimeout(() => {
        if (!finish()) return
        void this.cancelNative(job.request).catch(() => {})
        const message = '图片读取超时，请重试'
        if (!job.original) this.errors.set(job.key, message)
        job.reject(new Error(message))
        if (!this.closed) { this.changed(); this.pump() }
      }, 20000)
      job.finish = () => { if (finish()) job.reject(new Error('图片读取已取消')) }
      void Promise.resolve().then(() => {
        if (complete || this.closed) throw new Error('图片读取已取消')
        return this.loadNative(job.request)
      }).then(data => {
        if (complete || this.closed) return
        if (!isBrowserImageResponseCurrent(job.request, data)) throw new Error('网页已变化，请重新扫描')
        const blob = browserImageBlob(data)
        const result = job.original ? blob : this.memory.put(job.key, blob, job.request.thumbnail)
        if (!finish()) return
        job.resolve(result)
        this.changed()
        this.pump()
      }).catch(error => {
        if (!finish()) return
        const message = error instanceof Error ? error.message : '图片加载失败，请重试'
        if (!job.original) this.errors.set(job.key, message)
        job.reject(new Error(message))
        if (!this.closed) { this.changed(); this.pump() }
      })
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const job of this.jobs.values()) {
      if (job.finish) {
        job.finish()
        void this.cancelNative(job.request).catch(() => {})
      } else job.reject(new Error('图片读取已取消'))
    }
    this.jobs.clear()
    this.queue = []
    this.memory.close()
    // A replacement scan can already belong to this same document. Cancel
    // only this panel's request ids, never its successor's in-flight work.
    void this.cancelNative({ tabId: this.snapshot.tabId, documentId: this.snapshot.documentId,
      requestId: this.snapshot.requestId }).catch(() => {})
  }
}
