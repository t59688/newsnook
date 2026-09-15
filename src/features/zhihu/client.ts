import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { buildZhihuZse96, ZHIHU_X_ZSE_93 } from './signing'
import { readZhihuSession, serializeCookies } from './session'
import { ZhihuApiError, type ZhihuSession } from './types'

const WEB_BASE = 'https://www.zhihu.com'
const APP_BASE = 'https://api.zhihu.com'
const DEFAULT_ACCEPT = 'application/json, text/plain, */*'

export interface ZhihuRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  referer?: string
  headers?: Record<string, string>
  signed?: boolean
  signal?: AbortSignal
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function abortable<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    request.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function parsePayload(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const source = data.trim()
  if (!source) return null
  try {
    return JSON.parse(source) as unknown
  } catch {
    return source
  }
}

function errorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const root = payload as Record<string, unknown>
  const nested = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : undefined
  const value = nested?.message ?? nested?.description ?? root.message ?? root.error_msg
  return typeof value === 'string' ? value.trim() : ''
}

function errorCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const root = payload as Record<string, unknown>
  const nested = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : undefined
  const value = nested?.code ?? root.code
  return value == null ? '' : String(value)
}

function classifyFailure(status: number, payload: unknown): ZhihuApiError {
  const message = errorMessage(payload)
  const code = errorCode(payload)
  if (status === 401) return new ZhihuApiError('SESSION_EXPIRED', '知乎登录已过期，请重新登录', status)
  if (status === 429) return new ZhihuApiError('RATE_LIMITED', '知乎请求过于频繁，请稍后再试', status)
  if (code === '40362' || /验证|验证码|安全|risk|captcha/i.test(message)) {
    return new ZhihuApiError('RISK_CONTROL_REQUIRED', message || '知乎需要完成安全验证', status)
  }
  if (status === 403 && /zse|signature|签名/i.test(message)) {
    return new ZhihuApiError('SIGNATURE_REJECTED', message || '知乎请求签名已失效', status)
  }
  if (status === 403) return new ZhihuApiError('RISK_CONTROL_REQUIRED', message || '知乎拒绝了当前会话，请重新验证', status)
  return new ZhihuApiError('REQUEST_FAILED', message || `知乎请求失败（HTTP ${status}）`, status)
}

function exactApiPath(url: URL): string {
  return `${url.pathname}${url.search}`
}

function assertOwnedUrl(url: URL): void {
  const host = url.hostname.toLowerCase()
  if (host !== 'www.zhihu.com' && host !== 'api.zhihu.com') {
    throw new ZhihuApiError('REQUEST_FAILED', '拒绝向非知乎域名发送知乎登录态')
  }
  if (url.protocol !== 'https:') throw new ZhihuApiError('REQUEST_FAILED', '知乎 API 必须使用 HTTPS')
}

export async function zhihuRequest<T = unknown>(
  input: string,
  options: ZhihuRequestOptions = {},
): Promise<T> {
  if (!Capacitor.isNativePlatform()) {
    throw new ZhihuApiError('UNSUPPORTED_PLATFORM', '知乎主站登录能力目前仅在 Android App 中启用')
  }

  const session = await readZhihuSession()
  if (!session) throw new ZhihuApiError('AUTH_REQUIRED', '请先登录知乎')
  return zhihuRequestWithSession<T>(session, input, options)
}

export async function zhihuRequestWithSession<T = unknown>(
  session: ZhihuSession,
  input: string,
  options: ZhihuRequestOptions = {},
): Promise<T> {
  const url = new URL(input, WEB_BASE)
  assertOwnedUrl(url)
  const method = options.method ?? 'GET'
  const jsonBody = options.body === undefined ? undefined : JSON.stringify(options.body)
  const shouldSign = options.signed ?? (url.hostname === 'www.zhihu.com' && url.pathname.startsWith('/api/'))
  const headers: Record<string, string> = {
    Accept: DEFAULT_ACCEPT,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'User-Agent': session.userAgent,
    Cookie: serializeCookies(session.cookies),
    Referer: options.referer ?? `${WEB_BASE}/`,
    ...(options.headers ?? {}),
  }

  if (jsonBody !== undefined) {
    headers['Content-Type'] = 'application/json; charset=UTF-8'
    headers.Origin = WEB_BASE
  }

  if (shouldSign) {
    const dC0 = session.cookies.d_c0
    if (!dC0) throw new ZhihuApiError('AUTH_REQUIRED', '知乎登录态缺少 d_c0，请重新登录')
    const path = exactApiPath(url)
    headers['x-zse-93'] = ZHIHU_X_ZSE_93
    headers['x-zse-96'] = buildZhihuZse96(path, dC0, jsonBody)
    headers['x-requested-with'] = 'fetch'
    headers['x-api-version'] = '3.0.91'
    headers['x-app-za'] = 'OS=Web'
  }

  try {
    const response = await abortable(
      CapacitorHttp.request({
        url: url.href,
        method,
        headers,
        data: jsonBody,
        responseType: 'text',
        connectTimeout: 15_000,
        readTimeout: 25_000,
      }),
      options.signal,
    )
    const payload = parsePayload(response.data)
    if (response.status < 200 || response.status >= 300) throw classifyFailure(response.status, payload)
    if (typeof payload === 'string' && /<html|<!doctype/i.test(payload)) {
      throw new ZhihuApiError('RISK_CONTROL_REQUIRED', '知乎返回了验证页面，请重新验证登录态', response.status)
    }
    return payload as T
  } catch (error) {
    if (error instanceof ZhihuApiError || error instanceof DOMException) throw error
    throw new ZhihuApiError('NETWORK_ERROR', error instanceof Error ? error.message : '知乎网络请求失败')
  }
}

export function zhihuWebUrl(path: string): string {
  return new URL(path, WEB_BASE).href
}

export function zhihuAppUrl(path: string): string {
  return new URL(path, APP_BASE).href
}
