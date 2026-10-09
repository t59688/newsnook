import { Capacitor } from '@capacitor/core'

import { detectBrowserChallenge } from '../../../lib/browserChallenge'
import { linuxDoEndpoints } from './endpoints'
import { LinuxDoApiError, type LinuxDoSessionSnapshot, type LinuxDoRequestDiagnostics } from '../types'
import { prepareLinuxDoBrowserSession, readLinuxDoSession, requestLinuxDoNative } from '../session/native'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
interface RequestOptions {
  method?: Method
  body?: Record<string, unknown>
  form?: Record<string, string | number | boolean | Array<string | number> | undefined>
  headers?: Record<string, string>
  browserOnly?: boolean
  signal?: AbortSignal
  auth?: 'optional' | 'required'
  csrf?: boolean
  retryRead?: boolean
  expectEmpty?: boolean
}

function formBody(form: RequestOptions['form']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form ?? {})) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item))
    else params.set(key, String(value))
  }
  return params.toString()
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)
  return found?.[1] ?? ''
}

function retryAfterSeconds(headers: Record<string, string> | undefined): number | undefined {
  const raw = headerValue(headers, 'retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined
}

function requestPath(url: string): string {
  try { return new URL(url, linuxDoEndpoints.origin).pathname } catch { return '/' }
}

function diagnostics(url: string, method: Method, status?: number, headers?: Record<string, string>, transport?: string, responseUrl?: string): LinuxDoRequestDiagnostics {
  const path = requestPath(url)
  return {
    stage: /^\/session\/csrf(?:\.json)?$/.test(path) ? 'csrf' : 'request',
    method, path, status,
    transport: transport === 'browser' || transport === 'browser-firstparty' || transport === 'native' || transport === 'web' ? transport : 'unknown',
    responsePath: responseUrl ? requestPath(responseUrl) : undefined,
    contentType: headerValue(headers, 'content-type').slice(0, 100) || undefined,
    cfMitigated: headerValue(headers, 'cf-mitigated').slice(0, 32) || undefined,
    cfRay: headerValue(headers, 'cf-ray').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80) || undefined,
  }
}

function messageFromBody(text: string, fallback: string): string {
  try {
    const payload = JSON.parse(text)
    if (Array.isArray(payload?.errors) && payload.errors[0]) return String(payload.errors[0])
    if (typeof payload?.error === 'string') return payload.error
  } catch { /* Non-JSON responses are never included in diagnostics. */ }
  return fallback
}

function classify(status: number, text: string, headers: Record<string, string> | undefined, context: LinuxDoRequestDiagnostics): LinuxDoApiError {
  const fail = (kind: LinuxDoApiError['kind'], message: string, retry?: number) => new LinuxDoApiError(kind, message, status, retry, context)
  if (detectBrowserChallenge({ status, body: text, headers })) return fail('browser-verification', 'Linux.do 需要浏览器安全验证')
  // Discourse returns this exact JSON array for CSRF rejection. A Cloudflare
  // interstitial, permission error, or failure fetching CSRF is NOT BAD CSRF.
  if (status === 403) {
    try {
      const payload = JSON.parse(text)
      if (Array.isArray(payload) && payload.length === 1 && payload[0] === 'BAD CSRF') return fail('csrf', 'Linux.do 写入会话令牌已失效')
    } catch { /* Not the Discourse BAD CSRF contract. */ }
  }
  if (status === 401) return fail('auth-required', '请先登录 Linux.do')
  if (status === 403) return fail('forbidden', messageFromBody(text, '当前账号没有权限执行此操作'))
  if (status === 404) return fail('not-found', '内容不存在或已被移除')
  if (status === 429) return fail('rate-limited', '请求过于频繁，请稍后再试', retryAfterSeconds(headers))
  if (status >= 400 && status < 500) return fail('validation', messageFromBody(text, '请求参数无效'))
  if (status >= 500) return fail('server', 'Linux.do 服务暂时不可用')
  return fail('unknown', '请求失败')
}

export class LinuxDoApiClient {
  private session: LinuxDoSessionSnapshot = { authenticated: false, authMode: 'none' }
  private sessionGeneration = 0
  private csrfToken = ''
  private csrfBrowserOnly = false
  private csrfFlight?: { generation: number; browserOnly: boolean; promise: Promise<string> }

  async restore(): Promise<LinuxDoSessionSnapshot> {
    const session = await readLinuxDoSession()
    this.setSession(session)
    return session
  }

  setSession(session: LinuxDoSessionSnapshot): void {
    this.session = session
    this.sessionGeneration++
    this.csrfToken = ''
    this.csrfFlight = undefined
  }

  sessionSnapshot(): LinuxDoSessionSnapshot { return this.session }

  async getJson<T>(url: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'GET', retryRead: options?.retryRead ?? true })
  }
  async getText(url: string, options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<string> {
    return this.requestText(url, { ...options, method: 'GET', retryRead: options?.retryRead ?? true })
  }
  async postForm<T>(url: string, form: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'POST', form, csrf: options?.csrf ?? true })
  }

  /** /topics/timings normally returns 200 with an empty body. HTML login pages are not ACKs. */
  async postFormVoid(url: string, form: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<void> {
    const generation = this.sessionGeneration
    const request: RequestOptions = { ...options, method: 'POST', form, csrf: options?.csrf ?? true, expectEmpty: true }
    let recoveredBrowser = false
    let refreshedCsrf = false
    // At most one real browser-session preparation and one BAD CSRF retry.
    // A challenge in the CSRF preflight must never be retried as BAD CSRF.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.requestText(url, request)
        return
      } catch (error) {
        if (error instanceof LinuxDoApiError && error.kind === 'browser-verification'
          && error.diagnostics?.transport !== 'browser-firstparty'
          && !recoveredBrowser && Capacitor.isNativePlatform() && this.session.authMode === 'browser-session') {
          recoveredBrowser = true
          const prepared = await prepareLinuxDoBrowserSession().catch(() => ({ ready: false } as const))
          this.requireCurrentSession(generation)
          // SessionController.current returns an empty 404 when no user is logged in.
          // This is specific to the confirmed first-party current-session probe;
          // a 404 from an arbitrary content API is still an ordinary not-found.
          if ('phase' in prepared && prepared.phase === 'session' && (prepared.status === 401 || prepared.status === 404)) {
            throw new LinuxDoApiError('auth-required', 'Linux.do 浏览器会话已退出，请重新登录后补传阅读记录', prepared.status, undefined, {
              stage: 'session', method: 'GET', path: '/session/current.json', status: prepared.status, transport: 'browser-firstparty',
            })
          }
          if (prepared.ready && 'csrf' in prepared && typeof prepared.csrf === 'string' && prepared.csrf) {
            const user = this.session.currentUser
            if (!user || !('username' in prepared) || !('userId' in prepared)
              || prepared.userId !== user.id || prepared.username?.toLowerCase() !== user.username.toLowerCase()) {
              throw new LinuxDoApiError('auth-required', '浏览器账号与当前 Linux.do 账号不同，已停止同步阅读记录', 401)
            }
            this.csrfToken = prepared.csrf
            this.csrfBrowserOnly = options?.browserOnly === true
            continue
          }
        }
        if (error instanceof LinuxDoApiError && error.status === 403 && error.kind === 'csrf'
          && !refreshedCsrf && error.diagnostics?.stage === 'request' && request.csrf
          && generation === this.sessionGeneration && this.session.authMode === 'browser-session') {
          refreshedCsrf = true
          this.csrfToken = ''
          continue
        }
        throw error
      }
    }
    throw new LinuxDoApiError('unknown', 'Linux.do 未确认阅读记录')
  }

  async putForm<T>(url: string, form: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'PUT', form, csrf: options?.csrf ?? true })
  }
  async deleteJson<T>(url: string, form?: RequestOptions['form'], options?: Omit<RequestOptions, 'method' | 'body' | 'form'>): Promise<T> {
    return this.requestJson<T>(url, { ...options, method: 'DELETE', form, csrf: options?.csrf ?? true })
  }

  async csrf(browserOnly = false): Promise<string> {
    if (this.csrfToken && this.csrfBrowserOnly === browserOnly) return this.csrfToken
    const generation = this.sessionGeneration
    if (this.csrfFlight?.generation === generation && this.csrfFlight.browserOnly === browserOnly) return this.csrfFlight.promise
    const promise = (async () => {
      const payload = await this.requestJson<{ csrf?: string }>(linuxDoEndpoints.csrf, {
        method: 'GET', auth: 'required', retryRead: true,
        headers: { 'Cache-Control': 'no-cache' }, browserOnly,
      })
      this.requireCurrentSession(generation)
      const token = typeof payload?.csrf === 'string' ? payload.csrf.trim() : ''
      if (!token) throw new LinuxDoApiError('auth-required', '无法建立 Linux.do 写入会话', undefined, undefined, diagnostics(linuxDoEndpoints.csrf, 'GET'))
      this.csrfToken = token
      this.csrfBrowserOnly = browserOnly
      return token
    })()
    this.csrfFlight = { generation, browserOnly, promise }
    try { return await promise } finally { if (this.csrfFlight?.promise === promise) this.csrfFlight = undefined }
  }

  private requireCurrentSession(generation: number): void {
    if (generation !== this.sessionGeneration || !this.session.authenticated) throw new LinuxDoApiError('auth-required', 'Linux.do 登录会话已改变，请重新操作', 401)
  }

  private async requestJson<T>(url: string, options: RequestOptions): Promise<T> {
    const text = await this.requestText(url, options)
    try { return JSON.parse(text) as T } catch {
      throw new LinuxDoApiError('unknown', 'Linux.do 返回了无法解析的数据', undefined, undefined, diagnostics(url, options.method ?? 'GET'))
    }
  }

  private async requestText(url: string, options: RequestOptions): Promise<string> {
    const generation = this.sessionGeneration
    if (options.auth === 'required') this.requireCurrentSession(generation)
    const method = options.method ?? 'GET'
    const csrf = options.csrf && this.session.authMode !== 'user-api-key' ? await this.csrf(options.browserOnly === true) : ''
    if (options.auth === 'required') this.requireCurrentSession(generation)
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: linuxDoEndpoints.origin,
      Referer: linuxDoEndpoints.origin + '/',
      ...options.headers,
    }
    if (this.session.authenticated) {
      headers['Discourse-Logged-In'] = 'true'
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') headers['Discourse-Present'] = 'true'
    }
    if (csrf) headers['X-CSRF-Token'] = csrf
    let body: string | undefined
    if (options.form) { headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; body = formBody(options.form) }
    else if (options.body) { headers['Content-Type'] = 'application/json; charset=UTF-8'; body = JSON.stringify(options.body) }

    const consume = (status: number, text: string, responseHeaders: Record<string, string>, transport?: string, responseUrl?: string) => {
      if (options.auth === 'required') this.requireCurrentSession(generation)
      const context = diagnostics(url, method, status, responseHeaders, transport, responseUrl)
      if (status < 200 || status >= 300) throw classify(status, text, responseHeaders, context)
      if (headerValue(responseHeaders, 'discourse-logged-out') || headerValue(responseHeaders, 'discourse-xhr-redirect') || context.responsePath === '/login') {
        throw new LinuxDoApiError('auth-required', 'Linux.do 会话已失效', status, undefined, context)
      }
      if (options.expectEmpty && text.trim()) {
        // A generic 2xx check would otherwise erase unread dots for a redirected
        // login page or a proxy error document without recording any reading.
        let success = false
        try { const value = JSON.parse(text); success = value?.success === true || text.trim() === '{}' } catch { /* Nonempty HTML/text is not success. */ }
        if (!success) throw new LinuxDoApiError('unknown', 'Linux.do 未确认阅读记录（返回了非预期内容）', status, undefined, context)
      }
      return text
    }
    const execute = async () => {
      if (options.auth === 'required') this.requireCurrentSession(generation)
      if (Capacitor.isNativePlatform()) {
        const response = await requestLinuxDoNative({ url, method, headers, body, browserOnly: options.browserOnly })
        const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? {})
        return consume(response.status, text, response.headers ?? {}, response.transport, response.responseUrl)
      }
      if (method !== 'GET') throw new LinuxDoApiError('auth-required', 'Linux.do 登录与互动功能需要在 NewsNook App 中使用')
      const response = await fetch('/api/page?url=' + encodeURIComponent(url) + '&accept=' + encodeURIComponent(headers.Accept), {
        method: 'GET', signal: options.signal, headers: { Accept: headers.Accept },
      })
      return consume(response.status, await response.text(), Object.fromEntries(response.headers.entries()), 'web')
    }
    try { return await execute() } catch (error) {
      if (error instanceof LinuxDoApiError) {
        if (method === 'GET' && options.retryRead && error.kind === 'rate-limited' && (error.retryAfterSeconds ?? 0) <= 2) {
          await new Promise(resolve => setTimeout(resolve, Math.max(500, (error.retryAfterSeconds ?? 1) * 1000)))
          return execute()
        }
        throw error
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new LinuxDoApiError('network', error instanceof Error ? error.message : '网络连接失败', undefined, undefined, diagnostics(url, method))
    }
  }
}
