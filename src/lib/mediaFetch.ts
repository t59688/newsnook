import { Capacitor } from '@capacitor/core'
import type { HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js'

import { getRuntimeProxyPrefs, nativeFetchBytes } from './http'
import { currentProxyRuntime } from '../features/proxy/runtime'
import { resolveProxyTransport } from '../features/proxy/transport'

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

export interface MediaFetchContext {
  sourcePage?: string
  headers?: Record<string, string>
  range?: string
}

function mediaRequestHeaders(url: string, context?: MediaFetchContext): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': BROWSER_UA,
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
  const allowed = new Set(['accept', 'accept-language', 'origin', 'range', 'referer', 'user-agent'])
  for (const [key, value] of Object.entries(context?.headers ?? {})) {
    if (allowed.has(key.toLowerCase()) && value) headers[key] = value
  }
  if (context?.sourcePage && !Object.keys(headers).some((key) => key.toLowerCase() === 'referer')) {
    headers.Referer = context.sourcePage
  } else if (!Object.keys(headers).some((key) => key.toLowerCase() === 'referer')) {
    const fallback = hotlinkFallbackReferer(url)
    if (fallback) headers.Referer = fallback
  }
  if (context?.range) headers.Range = context.range
  return headers
}

/** 网易 / YouTube CDN：浏览器带 localhost Origin 会 403，需代理或原生 HTTP + 站点 Referer */
export function needsMediaHotlinkBypass(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host.endsWith('googlevideo.com') ||
      host.endsWith('bn.netease.com') ||
      host.endsWith('vod.126.net') ||
      (host.includes('flv') && host.includes('netease'))
    )
  } catch {
    return false
  }
}

export function hotlinkFallbackReferer(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('googlevideo.com')) return 'https://www.youtube.com/'
    if (
      host.endsWith('bn.netease.com')
      || host.endsWith('vod.126.net')
      || (host.includes('flv') && host.includes('netease'))
    ) {
      return 'https://3g.163.com/'
    }
  } catch {
    return undefined
  }
  return undefined
}

export function browserMediaProxyUrl(url: string): string {
  return `/api/media?url=${encodeURIComponent(url)}`
}

function emptyStats(): LoaderStats {
  return {
    aborted: false,
    loaded: 0,
    total: 0,
    retry: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: 0, first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  }
}

/**
 * 拉取媒体字节：App 内 CapacitorHttp / ProxiedHttp；
 * 浏览器 Web 反代直连包装 URL，否则走 /api/media。
 */
export async function fetchMediaBytes(
  url: string,
  signal?: AbortSignal,
  context?: MediaFetchContext,
): Promise<{ data: ArrayBuffer; contentType?: string }> {
  const transport = resolveProxyTransport(
    url,
    undefined,
    getRuntimeProxyPrefs(),
    currentProxyRuntime(),
  )

  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    const result = await nativeFetchBytes(
      targetUrl,
      mediaRequestHeaders(url, context),
      tunnel,
      signal,
    )
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`HTTP ${result.status}`)
    }
    const contentRange = Object.entries(result.responseHeaders).find(([name]) => name.toLowerCase() === 'content-range')?.[1]
    return { data: selectRequestedRange(result.data, result.status, context?.range, contentRange), contentType: result.contentType }
  }

  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, { signal, headers: context?.range ? { Range: context.range } : undefined })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return {
      data: selectRequestedRange(await response.arrayBuffer(), response.status, context?.range, response.headers.get('content-range')),
      contentType: response.headers.get('content-type') ?? undefined,
    }
  }

  const response = await fetch(browserMediaProxyUrl(url), { signal, headers: context?.range ? { Range: context.range } : undefined })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return {
    data: selectRequestedRange(await response.arrayBuffer(), response.status, context?.range, response.headers.get('content-range')),
    contentType: response.headers.get('content-type') ?? undefined,
  }
}

function selectRequestedRange(data: ArrayBuffer, status: number, range?: string, contentRange?: string | null): ArrayBuffer {
  const requested = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
  if (!requested) return data
  const start = Number(requested[1])
  const end = Number(requested[2]) + 1
  if (status === 200) {
    if (start >= data.byteLength) throw new Error('Incomplete media byte range')
    return data.slice(start, end)
  }
  const returned = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(contentRange ?? '')
  const expectedEnd = returned && returned[3] !== '*' ? Math.min(end, Number(returned[3])) : end
  if (status !== 206 || !returned || Number(returned[1]) !== start || Number(returned[2]) + 1 !== expectedEnd || data.byteLength !== expectedEnd - start) {
    throw new Error('Unexpected media byte range')
  }
  return data
}

/** hls.js 自定义 loader：绕开网易 CDN 对 localhost Origin 的 403 */
export function createHotlinkHlsLoader(requestContext?: MediaFetchContext): HlsConfig['loader'] {
  return class HotlinkLoader implements Loader<LoaderContext> {
    context: LoaderContext | null = null
    stats: LoaderStats = emptyStats()
    private abortCtrl: AbortController | null = null
    private timeoutId: ReturnType<typeof setTimeout> | null = null

    constructor(_config: HlsConfig) {}

    destroy() {
      this.abort()
    }

    abort() {
      this.stats.aborted = true
      this.abortCtrl?.abort()
      this.abortCtrl = null
      if (this.timeoutId != null) {
        clearTimeout(this.timeoutId)
        this.timeoutId = null
      }
    }

    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ) {
      this.abort()
      this.context = context
      this.stats = emptyStats()
      const controller = new AbortController()
      this.abortCtrl = controller
      const started = performance.now()
      this.stats.loading.start = started

      const timeoutMs = config.loadPolicy?.maxLoadTimeMs || config.timeout || 30000
      this.timeoutId = setTimeout(() => {
        controller.abort()
        this.stats.aborted = true
        callbacks.onTimeout(this.stats, context, null)
      }, timeoutMs)

      const range = Number.isSafeInteger(context.rangeStart) && Number.isSafeInteger(context.rangeEnd)
        && context.rangeStart! >= 0 && context.rangeEnd! > context.rangeStart!
        ? `bytes=${context.rangeStart}-${context.rangeEnd! - 1}` : requestContext?.range
      void fetchMediaBytes(context.url, controller.signal, { ...requestContext, range })
        .then(({ data }) => {
          if (controller.signal.aborted) return
          if (this.timeoutId != null) {
            clearTimeout(this.timeoutId)
            this.timeoutId = null
          }
          const elapsed = performance.now() - started
          this.stats.loaded = data.byteLength
          this.stats.total = data.byteLength
          this.stats.chunkCount = 1
          this.stats.bwEstimate = data.byteLength * (8000 / Math.max(elapsed, 1))
          this.stats.loading.first = started
          this.stats.loading.end = performance.now()
          this.stats.parsing.start = this.stats.loading.end
          this.stats.parsing.end = this.stats.loading.end

          const payload: string | ArrayBuffer =
            context.responseType === 'text' || context.responseType === 'json'
              ? new TextDecoder('utf-8').decode(data)
              : data
          callbacks.onSuccess({ url: context.url, data: payload }, this.stats, context, null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (this.timeoutId != null) {
            clearTimeout(this.timeoutId)
            this.timeoutId = null
          }
          const message = error instanceof Error ? error.message : 'load failed'
          const code = /HTTP\s+(\d+)/.exec(message)
          callbacks.onError(
            { code: code ? Number(code[1]) : 0, text: message },
            context,
            null,
            this.stats,
          )
        })
    }
  }
}
