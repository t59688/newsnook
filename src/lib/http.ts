/**
 * 抓取上游原文与任意 URL。
 * App 走原生 HTTP；浏览器开发态走 Vite 代理。
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { fetchZhihuRecommendText } from '../features/zhihu/service'
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
    if (raw) return normalizeProxyPrefs((JSON.parse(raw) as { proxy?: unknown }).proxy)
  } catch { /* ignore */ }
  return DEFAULT_PROXY_PREFS
})()

function syncDevProxyPrefs(prefs: ProxyPrefs): void {
  if (typeof fetch !== 'function' || Capacitor.isNativePlatform()) return
  if (!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) return
  void fetch('/api/dev-proxy-prefs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs),
  }).catch(() => {})
}
syncDevProxyPrefs(activeProxyPrefs)

export function setRuntimeProxyPrefs(prefs: ProxyPrefs): void { activeProxyPrefs = prefs; syncDevProxyPrefs(prefs) }
export function getRuntimeProxyPrefs(): ProxyPrefs { return activeProxyPrefs }

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 8

export type FetchSourceOptions = {
  url?: string
  page?: number
  requestForm?: Record<string, string | number>
}

function transportFor(targetUrl: string, sourceMeta?: { id?: string; group?: string }) {
  return resolveProxyTransport(targetUrl, sourceMeta, activeProxyPrefs, currentProxyRuntime())
}

export async function fetchSourceText(source: NewsSource, signal?: AbortSignal, options?: FetchSourceOptions): Promise<string> {
  // 知乎主站的 Cookie / ZSE 签名绝不经过 NewsNook 代理。这里是唯一的列表分流点。
  if (source.kind === 'zhihu-main') return fetchZhihuRecommendText(options?.page ?? 0, signal)

  const page = options?.page
  const paged = offsetPageRequest(source, page ?? 0)
  const rawUrl = options?.url ?? paged.url
  const transport = transportFor(rawUrl, { id: source.id, group: source.group })
  const method = source.requestMethod ?? 'GET'
  const form = options?.requestForm ?? paged.requestForm
  const extraHeaders = source.requestHeaders
  const ua = userAgentFor(source)

  if (Capacitor.isNativePlatform()) {
    const url = transport.kind === 'web-wrap' ? transport.requestUrl : rawUrl
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return method === 'POST'
      ? nativePost(url, ua, form, extraHeaders, signal, tunnel)
      : nativeGet(url, ua, signal, extraHeaders, tunnel)
  }

  if (transport.kind === 'web-wrap') {
    const init: RequestInit = { signal, headers: { 'User-Agent': ua, ...(extraHeaders ?? {}) } }
    if (method === 'POST') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': ua, ...(extraHeaders ?? {}) }
      init.body = encodeFormBody(form)
    }
    const response = await fetch(transport.requestUrl, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }

  if (page != null) {
    const init: RequestInit = { signal }
    if (method === 'POST') {
      init.method = 'POST'
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(extraHeaders ?? {}) }
      init.body = encodeFormBody(form)
    }
    const response = await fetch(`${proxyPathFor(source.id)}?page=${page}`, init)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }

  if (source.isCustom || source.id.startsWith('custom_') || (options?.url && options.url !== source.url)) {
    return fetchAbsoluteText(rawUrl, { userAgent: ua, signal, accept: FEED_ACCEPT, headers: { Accept: FEED_ACCEPT } })
  }

  const init: RequestInit = { signal }
  if (method === 'POST') {
    init.method = 'POST'
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(extraHeaders ?? {}) }
    init.body = encodeFormBody(form)
  }
  const response = await fetch(proxyPathFor(source.id), init)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return decodeBrowserResponse(response)
}

function encodeFormBody(form?: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form ?? {})) params.set(key, String(value))
  return params.toString()
}

export async function fetchAbsoluteText(url: string, options?: {
  userAgent?: string
  signal?: AbortSignal
  accept?: string
  headers?: Record<string, string>
}): Promise<string> {
  const ua = options?.userAgent ?? BROWSER_UA
  const transport = transportFor(url)
  const extraHeaders = { ...(options?.accept ? { Accept: options.accept } : {}), ...(options?.headers ?? {}) }

  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return nativeGet(targetUrl, ua, options?.signal, Object.keys(extraHeaders).length ? extraHeaders : undefined, tunnel)
  }
  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, { signal: options?.signal, headers: { 'User-Agent': ua, ...extraHeaders } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return decodeBrowserResponse(response)
  }
  const params = new URLSearchParams({ url, ua })
  if (options?.accept) params.set('accept', options.accept)
  const response = await fetch(`/api/page?${params.toString()}`, { signal: options?.signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await decodeBrowserResponse(response)
  if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status}`)
  return text
}

export async function fetchAbsoluteFormPost(url: string, form: Record<string, string>, options?: {
  userAgent?: string
  signal?: AbortSignal
  headers?: Record<string, string>
}): Promise<string> {
  const ua = options?.userAgent ?? BROWSER_UA
  const extra = options?.headers
  const transport = transportFor(url)
  if (Capacitor.isNativePlatform()) {
    const targetUrl = transport.kind === 'web-wrap' ? transport.requestUrl : url
    const tunnel = transport.kind === 'native-tunnel' ? transport.tunnel : undefined
    return nativePost(targetUrl, ua, form, extra, options?.signal, tunnel)
  }
  if (transport.kind === 'web-wrap') {
    const response = await fetch(transport.requestUrl, {
      method: 'POST', signal: options?.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': ua, ...(extra ?? {}) },
      body: encodeFormBody(form),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await decodeBrowserResponse(response)
    if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status}`)
    return text
  }
  const response = await fetch(`/api/post?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua)}`, {
    method: 'POST', signal: options?.signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...(extra ?? {}) },
    body: encodeFormBody(form),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await decodeBrowserResponse(response)
  if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status}`)
  return text
}

function abortReason(signal: AbortSignal): unknown { return signal.reason ?? new DOMException('The operation was aborted', 'AbortError') }
function abortable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    request.then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}

async function nativeGet(url: string, userAgent: string, signal?: AbortSignal, extraHeaders?: Record<string, string>, tunnel?: NativeTunnelProxy): Promise<string> {
  let lastError: unknown
  for (const candidate of requestUrlCandidates(url)) {
    if (signal?.aborted) throw abortReason(signal)
    try { return await nativeGetFollowingRedirects(candidate, userAgent, signal, extraHeaders, tunnel) }
    catch (error) { if (signal?.aborted) throw abortReason(signal); lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('请求失败')
}

async function nativePost(url: string, userAgent: string, form: Record<string, string | number> | undefined, extraHeaders: Record<string, string> | undefined, signal?: AbortSignal, tunnel?: NativeTunnelProxy): Promise<string> {
  if (signal?.aborted) throw abortReason(signal)
  const headers = {
    'User-Agent': userAgent, Accept: 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    ...(extraHeaders ?? {}),
  }
  const body = encodeFormBody(form)
  const response = tunnel
    ? await abortable(nativeProxiedRequest({ url, method: 'POST', headers, data: body, proxy: tunnel, readTimeout: 25000, connectTimeout: 15000 }), signal)
    : await abortable(CapacitorHttp.post({ url, readTimeout: 25000, connectTimeout: 15000, responseType: 'arraybuffer', headers, data: body }), signal)
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
  const data = tunnel ? decodeBase64ToArrayBuffer((response as { data: string }).data) : (response as { data: unknown }).data
  const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
  if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status || 204}`)
  return text
}

async function nativeGetFollowingRedirects(url: string, userAgent: string, signal?: AbortSignal, extraHeaders?: Record<string, string>, tunnel?: NativeTunnelProxy): Promise<string> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (signal?.aborted) throw abortReason(signal)
    const headers = {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml,application/json,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8', ...(extraHeaders ?? {}),
    }
    const response = tunnel
      ? await abortable(nativeProxiedRequest({ url: current, method: 'GET', headers, proxy: tunnel, readTimeout: 25000, connectTimeout: 15000, followRedirects: false }), signal)
      : await abortable(CapacitorHttp.get({ url: current, readTimeout: 25000, connectTimeout: 15000, responseType: 'arraybuffer', disableRedirects: true, headers }), signal)
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = headerValue(response.headers, 'location')
      if (!location) throw new Error(`HTTP ${response.status}`)
      const next = resolveRedirectUrl(current, location)
      current = requestUrlCandidates(next)[0] ?? next
      continue
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`)
    const data = tunnel ? decodeBase64ToArrayBuffer((response as { data: string }).data) : (response as { data: unknown }).data
    const text = decodeNativeResponse(data, headerValue(response.headers, 'content-type'))
    if (response.status === 204 || !text.trim()) throw new Error(`HTTP ${response.status || 204}`)
    return text
  }
  throw new Error('重定向次数过多')
}

async function decodeBrowserResponse(response: Response): Promise<string> {
  return decodeResponseBytes(await response.arrayBuffer(), response.headers.get('content-type'))
}

export function decodeNativeResponse(data: unknown, contentType?: string): string {
  if (contentType?.toLowerCase().includes('json')) return typeof data === 'string' ? data : JSON.stringify(data)
  if (typeof data === 'string') {
    const binary = atob(data); const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return decodeResponseBytes(bytes, contentType)
  }
  if (data instanceof ArrayBuffer) return decodeResponseBytes(data, contentType)
  if (ArrayBuffer.isView(data)) return decodeResponseBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), contentType)
  return JSON.stringify(data)
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === target) return value
  return undefined
}

export function resolveRedirectUrl(currentUrl: string, location: string): string { return new URL(location, currentUrl).href }
export function requestUrlCandidates(url: string): string[] { return httpsUpgradeCandidates(url) }

export function googleTranslateProxyUrl(url: string, targetLang = 'en'): string | null {
  try {
    const parsed = new URL(url)
    if (!/^https?:$/i.test(parsed.protocol) || parsed.hostname.endsWith('.translate.goog')) return parsed.hostname.endsWith('.translate.goog') ? url : null
    if (parsed.hostname === 'translate.google.com' || parsed.hostname === 'translate.googleapis.com') return null
    if (parsed.hostname === 'news.google.com' || parsed.hostname.endsWith('.google.com')) return null
    const host = parsed.hostname.replace(/\./g, '-')
    const params = new URLSearchParams(parsed.search)
    params.set('_x_tr_sl', 'auto'); params.set('_x_tr_tl', targetLang); params.set('_x_tr_hl', targetLang); params.set('_x_tr_pto', 'wapp')
    return `https://${host}.translate.goog${parsed.pathname}?${params.toString()}`
  } catch { return null }
}

export function httpsUpgradeCandidates(url: string): string[] {
  if (!url.startsWith('http://')) return [url]
  try {
    const parsed = new URL(url); const host = parsed.hostname.toLowerCase(); const path = parsed.pathname.toLowerCase()
    if (host.includes('flv') || path.endsWith('.m3u8') || path.endsWith('.mp4') || path.endsWith('.flv')) return [url]
    const httpsUrl = `https://${url.slice('http://'.length)}`
    const fallback = host.endsWith('163.com') || host.endsWith('126.net') || host.endsWith('126.com') || host.endsWith('netease.com')
    return fallback ? [httpsUrl, url] : [httpsUrl]
  } catch { return [url] }
}

export async function nativeFetchBytes(url: string, headers: Record<string, string>, tunnel?: NativeTunnelProxy, signal?: AbortSignal): Promise<{ data: ArrayBuffer; contentType?: string; status: number; responseHeaders: Record<string, string> }> {
  if (signal?.aborted) throw abortReason(signal)
  if (tunnel) {
    const response = await abortable(nativeProxiedRequest({ url, method: 'GET', headers, proxy: tunnel, readTimeout: 30000, connectTimeout: 15000, followRedirects: true }), signal)
    return { status: response.status, data: decodeBase64ToArrayBuffer(response.data), contentType: headerValue(response.headers, 'content-type'), responseHeaders: response.headers }
  }
  const response = await abortable(CapacitorHttp.get({ url, readTimeout: 30000, connectTimeout: 15000, responseType: 'arraybuffer', headers }), signal)
  const data = response.data
  let buffer: ArrayBuffer
  if (typeof data === 'string') buffer = decodeBase64ToArrayBuffer(data)
  else if (data instanceof ArrayBuffer) buffer = data
  else if (ArrayBuffer.isView(data)) { const copy = new Uint8Array(data.byteLength); copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer = copy.buffer }
  else throw new Error('无法解析响应字节')
  return { status: response.status, data: buffer, contentType: headerValue(response.headers, 'content-type'), responseHeaders: response.headers }
}
