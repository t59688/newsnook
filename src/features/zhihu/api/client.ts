import { canExecuteZhihuOperation, zhihuOperation } from '../protocol'
import { StaleZhihuGenerationError, ZhihuSessionService } from '../session/service'
import type { ZhihuTransport } from '../transport/types'
import { ZhihuApiError } from './errors'
import { parseZhihuJson } from './json'

function looksLikeVerificationPage(body: string): boolean {
  const prefix = body.slice(0, 1200).toLowerCase()
  return prefix.includes('<!doctype html') || prefix.includes('<html') || prefix.includes('captcha') || prefix.includes('验证')
}

interface ZhihuErrorPayload {
  message?: string
  code?: string
  name?: string
  needLogin: boolean
}

function responseErrorPayload(body: string): ZhihuErrorPayload {
  if (!body.trim()) return { needLogin: false }
  try {
    const parsed = parseZhihuJson(body) as Record<string, unknown>
    const error = parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
      ? parsed.error as Record<string, unknown>
      : undefined
    const candidates = [error?.message, parsed.message, parsed.error_description]
    return {
      message: candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim(),
      code: typeof error?.code === 'string' || typeof error?.code === 'number' ? String(error.code) : undefined,
      name: typeof error?.name === 'string' ? error.name : undefined,
      needLogin: error?.need_login === true || error?.needLogin === true || error?.name === 'AuthenticationError',
    }
  } catch {
    return { needLogin: false }
  }
}

function friendlyNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (/connection closed|sslhandshake|eofexception|handshake/i.test(message)) {
    return '知乎网络连接被中断，请检查网络或代理/VPN 后重试'
  }
  if (/timed? ?out|timeout/i.test(message)) {
    return '知乎连接超时，请检查网络后重试'
  }
  if (/unable to resolve host|unknownhost|name or service not known|dns/i.test(message)) {
    return '无法解析知乎服务器地址，请检查 DNS、网络或代理设置'
  }
  return message || '知乎网络请求失败'
}

function isRetryableSafeReadError(error: ZhihuApiError): boolean {
  if (error.code === 'invalid-response') return true
  if (error.code === 'rate-limited') return true
  if (error.code !== 'network') return false
  if (error.status == null) return true
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500
}

async function waitBeforeRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  const delay = attempt === 0 ? 220 : 650
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delay)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class ZhihuApiClient {
  private readonly transport: ZhihuTransport
  private readonly session: ZhihuSessionService

  constructor(
    transport: ZhihuTransport,
    session: ZhihuSessionService,
  ) {
    this.transport = transport
    this.session = session
  }

  async getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'GET', undefined, signal)
  }

  async getJsonWithHeaders(
    operation: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    return this.requestJson(operation, url, 'GET', undefined, signal, { headers, signing: options?.signing })
  }

  async postJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'POST', body, signal)
  }

  async postJsonWithHeaders(
    operation: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    return this.requestJson(operation, url, 'POST', body, signal, { headers, signing: options?.signing })
  }

  async putJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'PUT', body, signal)
  }

  async patchJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'PATCH', body, signal)
  }

  async deleteJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson(operation, url, 'DELETE', body, signal)
  }

  async requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    return this.requestJson(operation, url, method, undefined, signal, { body, headers, signing: options?.signing })
  }

  async requestJson(
    operation: string,
    url: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body?: unknown,
    signal?: AbortSignal,
    raw?: { body?: string; headers?: Record<string, string>; signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    const contract = zhihuOperation(operation)
    if (!contract || contract.method !== method) {
      throw new ZhihuApiError('unsupported', `知乎操作未注册为 ${method}：${operation}`)
    }
    if (contract.status === 'blocked') {
      throw new ZhihuApiError('unsupported', `知乎操作尚无可执行协议证据：${operation}`)
    }
    if (method !== 'GET' && !canExecuteZhihuOperation(operation)) {
      throw new ZhihuApiError('unsupported', `当前知乎接口未开放此操作：${operation}`)
    }
    const snapshot = this.session.getSnapshot()
    if (contract.auth === 'required' && snapshot.auth !== 'authenticated') {
      throw new ZhihuApiError('auth-expired', '此功能需要先登录知乎账号')
    }

    const safeRead = method === 'GET' && contract.retry === 'safe-read'
    const attempts = safeRead ? 3 : 1
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        this.session.assertGeneration(snapshot.generation)
        const response = await this.transport.request({
          operation,
          url,
          method,
          body: raw?.body ?? (body === undefined ? undefined : JSON.stringify(body)),
          headers: raw?.headers,
          signing: raw?.signing,
          accountId: snapshot.account?.id,
          generation: snapshot.generation,
          retry: contract.retry,
        }, signal)
        this.session.assertGeneration(snapshot.generation)

        const upstreamError = responseErrorPayload(response.body)
        if (response.status === 401 || upstreamError.needLogin) {
          if (snapshot.account) this.session.setAuthState('expired')
          throw new ZhihuApiError('auth-expired', upstreamError.message ?? '知乎登录已过期', response.status)
        }
        if (response.status === 403 && upstreamError.code === '40362') {
          this.session.setAuthState('verification-required')
          throw new ZhihuApiError('verification-required', upstreamError.message ?? '知乎要求完成安全验证', 403)
        }
        if (response.status === 403) throw new ZhihuApiError('forbidden', upstreamError.message ?? '知乎拒绝了此请求', 403)
        if (response.status === 429) throw new ZhihuApiError('rate-limited', upstreamError.message ?? '知乎请求过于频繁', 429)
        if (response.status >= 400) throw new ZhihuApiError('network', upstreamError.message ?? `知乎请求失败（${response.status}）`, response.status)
        if (looksLikeVerificationPage(response.body)) {
          this.session.setAuthState('verification-required')
          throw new ZhihuApiError('verification-required', '知乎要求在官方页面完成验证')
        }
        if (response.status === 204 || !response.body.trim()) return null
        try {
          return parseZhihuJson(response.body)
        } catch {
          throw new ZhihuApiError('invalid-response', '知乎返回了无法解析的数据')
        }
      } catch (error) {
        if (error instanceof StaleZhihuGenerationError) {
          throw new ZhihuApiError('stale-generation', error.message)
        }
        if (signal?.aborted) throw error
        if (error instanceof ZhihuApiError) {
          lastError = error
          if (!safeRead || !isRetryableSafeReadError(error) || attempt + 1 >= attempts) throw error
          await waitBeforeRetry(attempt, signal)
          continue
        }
        lastError = error
        // 原生 transport 抛出的连接/TLS/DNS 异常最多只补一次。一次连接超时可能已经
        // 消耗 15 秒，如果和 HTTP 5xx 一样做三次，会把离线页面拖到近一分钟才报错。
        // HTTP 5xx/429/解析异常仍走上面的 ZhihuApiError 分支，可使用完整三次有界重试。
        if (attempt + 1 >= Math.min(attempts, 2)) break
        await waitBeforeRetry(attempt, signal)
      }
    }
    throw new ZhihuApiError('network', friendlyNetworkError(lastError))
  }
}
