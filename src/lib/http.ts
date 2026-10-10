/**
 * 抓取上游原文与任意 URL。
 *
 * App：CapacitorHttp 或 ProxiedHttp（用户 HTTP/SOCKS 隧道）。
 * 浏览器开发态：Vite `/api/*`（可跟用户代理）；Web 反代则直连包装 URL。
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { offsetPageRequest, proxyPathFor, userAgentFor, type NewsSource } from '../sources/registry'
import { DEFAULT_PROXY_PREFS, normalizeProxyPrefs } from '../features/proxy/config'
import { decodeBase64ToArrayBuffer, nativeProxiedRequest } from '../features/proxy/nativeHttp'
import { currentProxyRuntime } from '../features/proxy/runtime'
import { resolveProxyTransport, type NativeTunnelProxy } from '../features/proxy/transport'
import type { ProxyPrefs } from '../features/proxy/types'
import { FEED_ACCEPT } from './feedPayload'
import { fetchRssHubSourceText } from '../features/rsshub/fetch'
import { decodeResponseBytes } from './textEncoding'

let activeProxyPrefs: ProxyPrefs = (() => {
  try {
    const raw = localStorage.getItem('newsnook:preferences')
    if (raw) {
      const parsed = JSON.parse(raw) as { proxy?: unknown }
      return normalizeProxyPrefs(parsed.proxy)
    }
  } catch {
    // 忽略解析异常
  }
  return DEFAULT_PROXY_PREFS
})()

function syncDevProxyPrefs(prefs: ProxyPrefs): void {
  if (typeof fetch !== 'function') return
  if (Capacitor.isNativePlatform()) return
  if (!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) return
  void fetch('/api/dev-proxy-prefs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  }).catch(() => {
    // 开发服务器未起或已关时忽略
  })
}

// 启动时把已持久化的偏好同步到 Vite（若在开发态）
syncDevProxyPrefs(activeProxyPrefs)

export function setRuntimeProxyPrefs(prefs: ProxyPrefs): void {
  activeProxyPrefs = prefs
  syncDevProxyPrefs(prefs)
}

export function getRuntimeProxyPrefs(): ProxyPrefs {
  return activeProxyPrefs
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 8

export type FetchSourceOptions = {
  /** 覆盖默认 URL（如网易历史页）；与 page 二选一优先 url */
  url?: string
  /** 0-based 上游页码；开发态走 `/api/feed/{id}?page=`，原生直连 offsetPageRequest */
  page?: number
  requestForm?: Record<string, string | number>
  requestJson?: Record<string, unknown>
}

function transportFor(
  targetUrl: string,
  sourceMeta?: { id?: string; group?: string },
) {
  return resolveProxyTransport(targetUrl, sourceMeta, activeProxyPrefs, currentProxyRuntime())
}

/**
 * 抓取上游原文。
 */
export async function fetchSourceText(
  source: NewsSource,
  signal?: AbortSignal,
  options?: FetchSourceOptions,
): Promise<string> {
  // Resolve RSSHub fallback only for ordinary head refresh, not for pagination or
  // arbitrary caller overrides. Both Android and Web continue through the shared transport.
  if (source.discovery?.generator === 'rsshub' && source.discovery.routeKey && options?.page == null && !options?.url) {
    return fetchRssHubSourceText(source, signal, (url, requestSignal) =>
      fetchAbsoluteText(url, { signal: requestSignal, accept: FEED_ACCEPT }),
    )
  }
  const page = options?.page
  const paged = offsetPageRequest(source, page ?? 0)
  const rawUrl = options?.url ?? paged.url
  const transport = transportFor(rawUrl, { id: source.id, group: source.group })
  const method = source.requestMethod ?? 'GET'
  const form = options?.requestForm ?? paged.requestForm
  const json = options?.requestJson ?? paged.requestJson ?? source.requestJson
  const bodyType = source.requestBodyType ?? 'form'
  const extraHeaders = source.requestHeaders
  const ua = userAgentFor(source)

  if (Capacitor.isNativePlatform()) {
    const url = transport.kind === 'web-wrap' ? transport.requestUrl : rawUrl
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    if (method === 'POST') {
      return nativePost(url, ua, bodyType, form, json, extraHeaders, signal, tunnel)
    }
    return nativeGet(url, ua, signal, extraHeaders, tunnel)
  }

  // 浏览器 + Web 反代：直连包装 URL（保留 POST body）
  if (transport.kind === 'web-wrap') {
    if (method === 'POST') {
      const response = await fetch(transport.requestUrl, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': bodyType === 'json' ? 'application/json; charset=UTF-8' : 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': ua,
          ...(extraHeaders ?? {}),
        },
        body: bodyType === 'json' ? JSON.stringify(json ?? {}) : encodeFormBody(form),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return decodeBrowserResponse(response)
    }
    const response = await fetch(transport.requestUrl, {
      signal,
      headers: { 'User-Agent': ua, ...(extraHeaders ?? {}) },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }

  // 浏览器：带 page 的请求统一走 feed 代理（dev-vite / direct / unsupported）
  if (page != null) {
    const init: RequestInit = { signal }
    if (method === 'POST') {
      init.method = 'POST'
      init.headers = {
        'Content-Type': bodyType === 'json' ? 'application/json; charset=UTF-8' : 'application/x-www-form-urlencoded; charset=UTF-8',
        ...(extraHeaders ?? {}),
      }
      init.body = bodyType === 'json' ? JSON.stringify(json ?? {}) : encodeFormBody(form)
    }
    const response = await fetch(`${proxyPathFor(source.id)}?page=${page}`, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }

  if (
    source.isCustom ||
    source.id.startsWith('custom_') ||
    (options?.url && options.url !== source.url)
  ) {
    return fetchAbsoluteText(rawUrl, {
      userAgent: ua,
      signal,
      accept: FEED_ACCEPT,
      headers: { Accept: FEED_ACCEPT },
    })
  }

  const init: RequestInit = { signal }
  if (method === 'POST') {
    init.method = 'POST'
    init.headers = {
      'Content-Type': bodyType === 'json' ? 'application/json; charset=UTF-8' : 'application/x-www-form-urlencoded; charset=UTF-8',
      ...(extraHeaders ?? {}),
    }
    init.body = bodyType === 'json' ? JSON.stringify(json ?? {}) : encodeFormBody(form)
  }

  const response = await fetch(proxyPathFor(source.id), init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return decodeBrowserResponse(response)
}

type FormFields = readonly { name: string; value: string }[]

function encodeFormBody(form?: Record<string, string | number> | FormFields): string {
  const params = new URLSearchParams()
  const entries = Array.isArray(form) ? form.map((field) => [field.name, field.value]) : Object.entries(form ?? {})
  for (const [key, value] of entries) params.append(key, String(value))
  return params.toString()
}

export interface PageResponseOptions {
  /** CMS pages use the existing OkHttp bridge even without a user tunnel. */
  nativeTransport?: 'okhttp'
  maxBytes?: number
  onResponse?: (metadata: { url?: string }) => void
}

function pageMetadata(response: Response, options?: PageResponseOptions) {
  const raw = response.headers.get('X-NewsNook-Upstream-Url')
  let url: string | undefined
  try { const parsed = raw && new URL(raw); if (parsed && /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password) url = parsed.href } catch { /* Unknown final URL. */ }
  options?.onResponse?.({ url })
}

/** 拉取任意绝对 URL（用于详情页全文抽取） */
export async function fetchAbsoluteText(
  url: string,
  options?: {
    userAgent?: string
    signal?: AbortSignal
    /** 传给边缘/开发代理的 Accept；原生则写入请求头 */
    accept?: string
    headers?: Record<string, string>
  } & PageResponseOptions,
): Promise<string> {
  const ua = options?.userAgent ?? BROWSER_UA
  const transport = transportFor(url)
  const extraHeaders = {
    ...(options?.accept ? { Accept: options.accept } : {}),
    ...(options?.headers ?? {}),
  }

  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return nativeGet(
      targetUrl,
      ua,
      options?.signal,
      Object.keys(extraHeaders).length ? extraHeaders : undefined,
      tunnel,
      transport.kind === 'web-wrap' ? { ...options, onResponse: undefined } : options,
    )
  }

  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, {
      signal: options?.signal,
      headers: { 'User-Agent': ua, ...extraHeaders },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    pageMetadata(response, options)
    return decodeBrowserResponse(response, options?.maxBytes)
  }

  // direct / dev-vite / unsupported → 开发态 CORS 代理（unsupported 不宣称已走用户 SOCKS）
  const params = new URLSearchParams({ url, ua })
  if (options?.accept) params.set('accept', options.accept)
  const proxy = `/api/page?${params.toString()}`
  const response = await fetch(proxy, { signal: options?.signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  pageMetadata(response, options)
  const text = await decodeBrowserResponse(response, options?.maxBytes)
  if (response.status === 204 || !text.trim()) {
    throw new Error(`HTTP ${response.status}`)
  }
  return text
}

/** 对任意绝对 URL 发 application/x-www-form-urlencoded POST（Google News 解码等） */
export async function fetchAbsoluteFormPost(
  url: string,
  form: Record<string, string> | FormFields,
  options?: {
    userAgent?: string
    signal?: AbortSignal
    headers?: Record<string, string>
  } & PageResponseOptions,
): Promise<string> {
  const ua = options?.userAgent ?? BROWSER_UA
  const extra = options?.headers
  const transport = transportFor(url)

  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return nativePost(targetUrl, ua, 'form', form, undefined, extra, options?.signal, tunnel, transport.kind === 'web-wrap' ? { ...options, onResponse: undefined } : options)
  }

  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': ua,
        ...(extra ?? {}),
      },
      body: encodeFormBody(form),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    pageMetadata(response, options)
    const text = await decodeBrowserResponse(response, options?.maxBytes)
    if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status}`)
    return text
  }

  const proxy = `/api/post?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua)}`
  const response = await fetch(proxy, {
    method: 'POST',
    signal: options?.signal,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      ...(extra ?? {}),
    },
    body: encodeFormBody(form),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  pageMetadata(response, options)
  const text = await decodeBrowserResponse(response, options?.maxBytes)
  if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status}`)
  return text
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

/** CapacitorHttp has no AbortSignal option, so stop awaiting its bridge result. */
function abortable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request
  if (signal.aborted) return Promise.reject(abortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(abortReason(signal))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    request.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function nativeGet(
  url: string,
  userAgent: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
  tunnel?: NativeTunnelProxy,
  pageOptions?: PageResponseOptions,
): Promise<string> {
  const candidates = requestUrlCandidates(url)
  let lastError: unknown

  for (const candidate of candidates) {
    if (signal?.aborted) throw abortReason(signal)
    try {
      return await nativeGetFollowingRedirects(candidate, userAgent, signal, extraHeaders, tunnel, pageOptions)
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal)
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('请求失败')
}

async function nativePost(
  url: string,
  userAgent: string,
  bodyType: 'form' | 'json',
  form: Record<string, string | number> | FormFields | undefined,
  json: Record<string, unknown> | undefined,
  extraHeaders: Record<string, string> | undefined,
  signal?: AbortSignal,
  tunnel?: NativeTunnelProxy,
  pageOptions?: PageResponseOptions,
  redirectsLeft = MAX_REDIRECTS,
): Promise<string> {
  if (signal?.aborted) throw abortReason(signal)

  const headers = {
    'User-Agent': userAgent,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Content-Type': bodyType === 'json' ? 'application/json; charset=UTF-8' : 'application/x-www-form-urlencoded; charset=UTF-8',
    ...(extraHeaders ?? {}),
  }
  const body = bodyType === 'json' ? JSON.stringify(json ?? {}) : encodeFormBody(form)

  const useOkHttp = !!tunnel || pageOptions?.nativeTransport === 'okhttp'
  const response = useOkHttp
    ? await abortable(
        nativeProxiedRequest({
          url,
          method: 'POST',
          webViewCookies: pageOptions?.nativeTransport === 'okhttp',
          followRedirects: false,
          headers,
          data: body,
          proxy: tunnel,
          readTimeout: 25000,
          connectTimeout: 15000,
        }),
        signal,
      )
    : await abortable(
        CapacitorHttp.post({
          url,
          readTimeout: 25000,
          connectTimeout: 15000,
          responseType: 'arraybuffer',
          disableRedirects: true,
          headers,
          data: body,
        }),
        signal,
      )

  if (REDIRECT_STATUSES.has(response.status)) {
    const location = headerValue(response.headers, 'location')
    if (!location) throw new Error(`HTTP ${response.status}`)
    if (redirectsLeft <= 0) throw new Error('重定向次数过多')
    const next = resolveRedirectUrl(url, location)
    const nextHeaders = new URL(next).origin === new URL(url).origin ? extraHeaders : undefined
    if (response.status === 307 || response.status === 308) return nativePost(next, userAgent, bodyType, form, json, nextHeaders, signal, tunnel, pageOptions, redirectsLeft - 1)
    return nativeGetFollowingRedirects(next, userAgent, signal, nextHeaders, tunnel, pageOptions, redirectsLeft - 1)
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }

  const data = useOkHttp
    ? decodeBase64ToArrayBuffer((response as { data: string }).data)
    : (response as { data: unknown }).data

  const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
  if (response.status === 204 || !text.trim()) {
    throw new Error(`HTTP ${response.status || 204}`)
  }
  checkPageSize(text, pageOptions?.maxBytes)
  pageOptions?.onResponse?.({ url: 'url' in response && typeof response.url === 'string' ? response.url : url })
  return text
}

/**
 * Capacitor 原生层偶发不跟随 301/302（或把最终跳转状态抛回），
 * 这里主动跟随 Location。
 */
async function nativeGetFollowingRedirects(
  url: string,
  userAgent: string,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>,
  tunnel?: NativeTunnelProxy,
  pageOptions?: PageResponseOptions,
  redirectsLeft = MAX_REDIRECTS,
): Promise<string> {
  let current = url
  const useOkHttp = !!tunnel || pageOptions?.nativeTransport === 'okhttp'

  for (let hop = 0; hop <= redirectsLeft; hop += 1) {
    if (signal?.aborted) throw abortReason(signal)

    const headers = {
      'User-Agent': userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml,application/json,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(extraHeaders ?? {}),
    }

    const response = useOkHttp
      ? await abortable(
          nativeProxiedRequest({
            url: current,
            method: 'GET',
            webViewCookies: pageOptions?.nativeTransport === 'okhttp',
            headers,
            proxy: tunnel,
            readTimeout: 25000,
            connectTimeout: 15000,
            followRedirects: false,
          }),
          signal,
        )
      : await abortable(
          CapacitorHttp.get({
            url: current,
            readTimeout: 25000,
            connectTimeout: 15000,
            responseType: 'arraybuffer',
            disableRedirects: true,
            headers,
          }),
          signal,
        )

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = headerValue(response.headers, 'location')
      if (!location) throw new Error(`HTTP ${response.status}`)
      // Honor the server's Location, including an intentional HTTPS -> HTTP
      // redirect. Upgrading this hop can address a different virtual host.
      current = resolveRedirectUrl(current, location)
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = useOkHttp
      ? decodeBase64ToArrayBuffer((response as { data: string }).data)
      : (response as { data: unknown }).data

    const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
    if (response.status === 204 || !text.trim()) {
      throw new Error(`HTTP ${response.status || 204}`)
    }
    checkPageSize(text, pageOptions?.maxBytes)
    pageOptions?.onResponse?.({ url: current })
    return text
  }

  throw new Error('重定向次数过多')
}

function checkPageSize(text: string, maxBytes?: number) {
  if (maxBytes && new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('目录页面过大，请使用更具体的栏目地址')
}

async function decodeBrowserResponse(response: Response, maxBytes?: number): Promise<string> {
  if (!maxBytes || !response.body) {
    const bytes = await response.arrayBuffer()
    if (maxBytes && bytes.byteLength > maxBytes) throw new Error('目录页面过大，请使用更具体的栏目地址')
    return decodeResponseBytes(bytes, response.headers.get('content-type'))
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) { await reader.cancel(); throw new Error('目录页面过大，请使用更具体的栏目地址') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return decodeResponseBytes(bytes, response.headers.get('content-type'))
}

export function decodeNativeResponse(data: unknown, contentType?: string): string {
  if (contentType?.toLowerCase().includes('json')) {
    return typeof data === 'string' ? data : JSON.stringify(data)
  }

  if (typeof data === 'string') {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return decodeResponseBytes(bytes, contentType)
  }
  if (data instanceof ArrayBuffer) return decodeResponseBytes(data, contentType)
  if (ArrayBuffer.isView(data)) {
    return decodeResponseBytes(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      contentType,
    )
  }

  return JSON.stringify(data)
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}

export function resolveRedirectUrl(currentUrl: string, location: string): string {
  const next = new URL(location, currentUrl)
  if (next.protocol !== 'https:' && next.protocol !== 'http:') throw new Error('不支持的重定向协议')
  return next.href
}

/** 请求前候选：目前仅做 https 升格（信源地址以 registry 配置为准，不做域名改写）。 */
export function requestUrlCandidates(url: string): string[] {
  return httpsUpgradeCandidates(url)
}

/**
 * Google 网页翻译镜像：部分出版社对直接抓取返回 403/挑战页时，
 * 经 `*.translate.goog` 常能拿到可 Readability 的 HTML。
 */
export function googleTranslateProxyUrl(url: string, targetLang = 'en'): string | null {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/i.test(parsed.protocol)) return null
    if (parsed.hostname.endsWith('.translate.goog')) return url
    if (parsed.hostname === 'translate.google.com' || parsed.hostname === 'translate.googleapis.com') {
      return null
    }
    if (parsed.hostname === 'news.google.com' || parsed.hostname.endsWith('.google.com')) {
      return null
    }
    const host = parsed.hostname.replace(/\./g, '-')
    const params = new URLSearchParams(parsed.search)
    params.set('_x_tr_sl', 'auto')
    params.set('_x_tr_tl', targetLang)
    params.set('_x_tr_hl', targetLang)
    params.set('_x_tr_pto', 'wapp')
    return `https://${host}.translate.goog${parsed.pathname}?${params.toString()}`
  } catch {
    return null
  }
}

/** 优先尝试 https；但显式非默认端口代表用户指定的具体服务端点，不能只改协议不改端口。
 * 视频 CDN 等明确需要明文 HTTP 的资源也保留原始地址。 */
export function httpsUpgradeCandidates(url: string): string[] {
  if (!url.startsWith('http://')) return [url]
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname.toLowerCase()
    const keepHttp =
      Boolean(parsed.port) ||
      host.includes('flv') ||
      path.endsWith('.m3u8') ||
      path.endsWith('.mp4') ||
      path.endsWith('.flv')
    if (keepHttp) return [url]

    const httpsUrl = `https://${url.slice('http://'.length)}`
    const cleartextFallbackAllowed =
      host.endsWith('163.com') ||
      host.endsWith('126.net') ||
      host.endsWith('126.com') ||
      host.endsWith('netease.com')
    return cleartextFallbackAllowed ? [httpsUrl, url] : [httpsUrl]
  } catch {
    // ignore
  }
  return [url]
}

/** 原生隧道下拉任意字节（媒体 / 图片 blob） */
export async function nativeFetchBytes(
  url: string,
  headers: Record<string, string>,
  tunnel?: NativeTunnelProxy,
  signal?: AbortSignal,
): Promise<{ data: ArrayBuffer; contentType?: string; status: number; responseHeaders: Record<string, string> }> {
  if (signal?.aborted) throw abortReason(signal)

  if (tunnel) {
    const response = await abortable(
      nativeProxiedRequest({
        url,
        method: 'GET',
        headers,
        proxy: tunnel,
        readTimeout: 30000,
        connectTimeout: 15000,
        followRedirects: true,
      }),
      signal,
    )
    return {
      status: response.status,
      data: decodeBase64ToArrayBuffer(response.data),
      contentType: headerValue(response.headers, 'content-type'),
      responseHeaders: response.headers,
    }
  }

  const response = await abortable(
    CapacitorHttp.get({
      url,
      readTimeout: 30000,
      connectTimeout: 15000,
      responseType: 'arraybuffer',
      headers,
    }),
    signal,
  )
  const data = response.data
  let buffer: ArrayBuffer
  if (typeof data === 'string') {
    buffer = decodeBase64ToArrayBuffer(data)
  } else if (data instanceof ArrayBuffer) {
    buffer = data
  } else if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength)
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    buffer = copy.buffer
  } else {
    throw new Error('无法解析响应字节')
  }
  return {
    status: response.status,
    data: buffer,
    contentType: headerValue(response.headers, 'content-type'),
    responseHeaders: response.headers,
  }
}
