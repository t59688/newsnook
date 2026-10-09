import { Capacitor } from '@capacitor/core'

import { decodeBase64ToArrayBuffer, nativeProxiedRequest } from '../../proxy/nativeHttp'
import { zhihuOperation } from '../protocol'
import { buildZhihuZseHeaders } from '../crypto/zse96'
import type { ZhihuCredentialStore } from '../session/store'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from './types'

const REQUEST_HOSTS = new Set(['www.zhihu.com', 'api.zhihu.com', 'zhihu-pics-upload.zhimg.com'])
const DEFAULT_ZHIHU_WEB_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

export function assertZhihuAuthenticatedUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !REQUEST_HOSTS.has(url.hostname)) {
    throw new Error('知乎认证请求目标不在允许域内')
  }
  return url
}

export function shouldSignZhihuRequest(
  target: URL,
  signing?: 'web-zse96' | 'none',
): boolean {
  if (signing === 'web-zse96') return true
  if (signing === 'none') return false
  // 参考客户端的 authenticated fetch/postSigned 会同时签 www.zhihu.com 与
  // api.zhihu.com；真正的 Android/mobile API 调用由调用方显式 signing:'none'。
  // 不能仅按 hostname 判断，否则会把 answer.relationship / pin draft / people
  // 等 Web 会话 API 错当成 mobile API，最终触发参数异常或会话态差异。
  return target.hostname === 'www.zhihu.com' || target.hostname === 'api.zhihu.com'
}

function cookieMap(...headers: Array<string | undefined>): Map<string, string> {
  const map = new Map<string, string>()
  for (const header of headers) {
    if (!header) continue
    for (const item of header.split(';')) {
      const separator = item.indexOf('=')
      if (separator <= 0) continue
      const key = item.slice(0, separator).trim()
      const value = item.slice(separator + 1).trim()
      if (key) map.set(key, value)
    }
  }
  return map
}

function mergedCookie(...headers: Array<string | undefined>): string {
  return [...cookieMap(...headers)].map(([key, value]) => `${key}=${value}`).join('; ')
}

export function mergeZhihuRequestCookies(
  wwwCookie: string,
  apiCookie: string,
  targetHostname: string,
): string {
  // CookieManager 会同时返回共享 Domain=.zhihu.com 与 host-only cookie。若同名值
  // 暂时不同，目标 host 自己的 jar 必须最后覆盖共享/另一子域快照，行为与登录桥一致。
  return targetHostname === 'api.zhihu.com'
    ? mergedCookie(wwwCookie, apiCookie)
    : mergedCookie(apiCookie, wwwCookie)
}

function responseHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return entry?.[1]
}

function applySetCookie(header: string, setCookie: string | undefined): string {
  if (!setCookie) return header
  const first = setCookie.split(';', 1)[0]?.trim()
  if (!first) return header
  const separator = first.indexOf('=')
  if (separator <= 0) return header
  const name = first.slice(0, separator).trim()
  const value = first.slice(separator + 1).trim()
  if (!name) return header
  const map = cookieMap(header)
  if (value) map.set(name, value)
  else map.delete(name)
  return [...map].map(([key, item]) => `${key}=${item}`).join('; ')
}

export function applyZhihuResponseCookies(
  wwwCookie: string,
  apiCookie: string,
  responseHostname: string,
  setCookies: readonly string[],
): { wwwCookie: string; apiCookie: string } {
  let nextWww = wwwCookie
  let nextApi = apiCookie
  for (const setCookie of setCookies) {
    const domainShared = /(?:^|;)\s*domain=\.?zhihu\.com(?:;|$)/i.test(setCookie)
    if (domainShared || responseHostname === 'www.zhihu.com') {
      nextWww = applySetCookie(nextWww, setCookie)
    }
    if (domainShared || responseHostname === 'api.zhihu.com') {
      nextApi = applySetCookie(nextApi, setCookie)
    }
  }
  return { wwwCookie: nextWww, apiCookie: nextApi }
}

function decodeUtf8(base64: string): string {
  return new TextDecoder().decode(decodeBase64ToArrayBuffer(base64))
}

/**
 * Android 的认证网络通道复用已验证的 ProxiedHttp 原生 OkHttp 实现；Cookie 从
 * Keystore-backed ZhihuCredentialStore 按 accountId 现取，永远不落普通存储。
 * 非幂等写操作只执行一次，重试策略由 API 层严格控制。
 */
export function createZhihuAndroidTransport(credentials: ZhihuCredentialStore): ZhihuTransport {
  return {
    async request(input: ZhihuRequest, signal?: AbortSignal): Promise<ZhihuResponse> {
      if (!Capacitor.isNativePlatform()) throw new Error('知乎认证 transport 仅可在 Android 原生运行')
      const target = assertZhihuAuthenticatedUrl(input.url)
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      const contract = zhihuOperation(input.operation)
      if (!contract || contract.method !== input.method) {
        throw new Error(`知乎 operation/method 不匹配：${input.operation}`)
      }
      if (contract.status === 'blocked') {
        throw new Error(`知乎操作缺少可执行协议证据：${input.operation}`)
      }

      const stored = input.accountId ? await credentials.loadAccount(input.accountId) : null
      if (contract.auth === 'required' && !stored) {
        throw new Error(`知乎操作缺少账号会话：${input.operation}`)
      }
      const cookies = stored
        ? mergeZhihuRequestCookies(stored.wwwCookie, stored.apiCookie, target.hostname)
        : ''
      const parsedCookies = cookieMap(cookies)
      const headers: Record<string, string> = {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
        Referer: 'https://www.zhihu.com/',
        // Zhihu++ 的账号 HttpClient 始终携带登录会话 UA。部分 members API 会在缺少 UA
        // 时把请求误判成过期/未知客户端并返回 code=10003“请求参数异常，请升级客户端”。
        // 新账号保存认证 WebView 的真实 UA；旧账号无该字段时使用稳定浏览器 UA 兼容迁移。
        'User-Agent': stored?.userAgent?.trim() || DEFAULT_ZHIHU_WEB_USER_AGENT,
        'X-Requested-With': 'fetch',
        ...input.headers,
      }
      if (cookies && target.hostname !== 'zhihu-pics-upload.zhimg.com') headers.Cookie = cookies
      if (input.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
      const dc0 = parsedCookies.get('d_c0')
      if (shouldSignZhihuRequest(target, input.signing) && dc0 && target.hostname !== 'zhihu-pics-upload.zhimg.com') {
        Object.assign(headers, buildZhihuZseHeaders(input.url, dc0, input.body))
      }
      if (input.method !== 'GET' && input.method !== 'DELETE' && target.hostname !== 'zhihu-pics-upload.zhimg.com') {
        const xsrf = parsedCookies.get('_xsrf')
        if (xsrf) headers['x-xsrftoken'] = xsrf
        headers.Origin = 'https://www.zhihu.com'
      }

      const response = await nativeProxiedRequest({
        url: input.url,
        method: input.method,
        headers,
        data: input.bodyBase64 ? undefined : input.body,
        dataBase64: input.bodyBase64,
        followRedirects: false,
        connectTimeout: 15_000,
        readTimeout: 30_000,
      })
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      // 知乎会滚动更新 _xsrf/BEC 等 Cookie。登录时只保存一次快照会让“刚登录能用，
      // 重启/用一阵后偶发失效”越来越明显；响应里如果确实下发了新 Cookie，就把它
      // 合并回 Keystore 会话。共享 Domain=zhihu.com 的 Cookie 同步到 www/api 两份。
      if (stored && target.hostname !== 'zhihu-pics-upload.zhimg.com') {
        // 新版原生桥逐条返回 Set-Cookie；兼容旧版桥时再退回最后一个同名 header。
        // 不能直接把多个 Set-Cookie 用逗号拆，因为 Expires=Wed, ... 本身含逗号。
        const legacySetCookie = responseHeader(response.headers, 'set-cookie')
        const setCookies = response.setCookies?.length
          ? response.setCookies
          : legacySetCookie
            ? [legacySetCookie]
            : []
        if (setCookies.length > 0) {
          const next = applyZhihuResponseCookies(
            stored.wwwCookie,
            stored.apiCookie,
            target.hostname,
            setCookies,
          )
          if (next.wwwCookie !== stored.wwwCookie || next.apiCookie !== stored.apiCookie) {
            await credentials.saveAccount({
              ...stored,
              wwwCookie: next.wwwCookie,
              apiCookie: next.apiCookie,
              updatedAt: Date.now(),
            })
          }
        }
      }

      return {
        status: response.status,
        headers: response.headers,
        body: decodeUtf8(response.data),
      }
    },
  }
}
