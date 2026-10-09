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

function encodeFormBody(form?: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form ?? {})) {
    params.set(key, String(value))
  }
  return params.toString()
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
  },
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
    )
  }

  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, {
      signal: options?.signal,
      headers: { 'User-Agent': ua, ...extraHeaders },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }

  // direct / dev-vite / unsupported → 开发态 CORS 代理（unsupported 不宣称已走用户 SOCKS）
  const params = new URLSearchParams({ url, ua })
  if (options?.accept) params.set('accept', options.accept)
  const proxy = `/api/page?${params.toString()}`
  const response = await fetch(proxy, { signal: options?.signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const text = await decodeBrowserResponse(response)
  if (response.status === 204 || !text.trim()) {
    throw new Error(`HTTP ${response.status}`)
  }
  return text
}

/** 对任意绝对 URL 发 application/x-www-form-urlencoded POST（Google News 解码等） */
export async function fetchAbsoluteFormPost(
  url: string,
  form: Record<string, string>,
  options?: {
    userAgent?: string
    signal?: AbortSignal
    headers?: Record<string, string>
  },
): Promise<string> {
  const ua = options?.userAgent ?? BROWSER_UA
  const extra = options?.headers
  const transport = transportFor(url)

  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return nativePost(targetUrl, ua, 'form', form, undefined, extra, options?.signal, tunnel)
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
    const text = await decodeBrowserResponse(response)
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
  const text = await decodeBrowserResponse(response)
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
): Promise<string> {
  const candidates = requestUrlCandidates(url)
  let lastError: unknown

  for (const candidate of candidates) {
    if (signal?.aborted) throw abortReason(signal)
    try {
      return await nativeGetFollowingRedirects(candidate, userAgent, signal, extraHeaders, tunnel)
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
  form: Record<string, string | number> | undefined,
  json: Record<string, unknown> | undefined,
  extraHeaders: Record<string, string> | undefined,
  signal?: AbortSignal,
  tunnel?: NativeTunnelProxy,
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

  const response = tunnel
    ? await abortable(
        nativeProxiedRequest({
          url,
          method: 'POST',
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
          headers,
          data: body,
        }),
        signal,
      )

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }

  const data = tunnel
    ? decodeBase64ToArrayBuffer((response as { data: string }).data)
    : (response as { data: unknown }).data

  const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
  if (response.status === 204 || !text.trim()) {
    throw new Error(`HTTP ${response.status || 204}`)
  }
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
): Promise<string> {
  let current = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (signal?.aborted) throw abortReason(signal)

    const headers = {
      'User-Agent': userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml,application/json,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(extraHeaders ?? {}),
    }

    const response = tunnel
      ? await abortable(
          nativeProxiedRequest({
            url: current,
            method: 'GET',
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
      const next = resolveRedirectUrl(current, location)
      current = requestUrlCandidates(next)[0] ?? next
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`HTTP ${response.status}`)
    }

    const data = tunnel
      ? decodeBase64ToArrayBuffer((response as { data: string }).data)
      : (response as { data: unknown }).data

    const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
    if (response.status === 204 || !text.trim()) {
      throw new Error(`HTTP ${response.status || 204}`)
    }
    return text
  }

  throw new Error('重定向次数过多')
}

async function decodeBrowserResponse(response: Response): Promise<string> {
  const bytes = await response.arrayBuffer()
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
  return new URL(location, currentUrl).href
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
