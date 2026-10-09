import { fetchAbsoluteText } from '../../../lib/http'
import { canAttemptZhihuRead, zhihuOperation } from '../protocol'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from './types'

const ALLOWED_HOSTS = new Set(['www.zhihu.com', 'api.zhihu.com'])

export function assertZhihuUrl(url: string): URL {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('知乎请求目标不在允许域内')
  }
  return parsed
}

/**
 * 现阶段唯一启用的生产 transport：复用 NewsNook 已验证的 native/proxy GET 链，
 * 但额外做知乎域名和 operation gate。它故意不接 Cookie/write；认证协议实网闭环前不能扩权。
 */
export function createZhihuSafeReadTransport(): ZhihuTransport {
  return {
    async request(input: ZhihuRequest, signal?: AbortSignal): Promise<ZhihuResponse> {
      assertZhihuUrl(input.url)
      const contract = zhihuOperation(input.operation)
      if (!contract || input.method !== 'GET' || !canAttemptZhihuRead(input.operation)) {
        throw new Error(`知乎操作未开放安全只读通道：${input.operation}`)
      }
      if (contract.auth === 'required' || input.accountId) {
        throw new Error(`知乎操作需要独立认证会话：${input.operation}`)
      }

      const extraHeaders = Object.fromEntries(
        Object.entries(input.headers ?? {}).filter(([name]) => name.toLowerCase() !== 'user-agent'),
      )

      const body = await fetchAbsoluteText(input.url, {
        signal,
        accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
        headers: {
          Referer: 'https://www.zhihu.com/',
          'X-Requested-With': 'XMLHttpRequest',
          ...extraHeaders,
        },
      })
      return { status: 200, headers: {}, body }
    },
  }
}
