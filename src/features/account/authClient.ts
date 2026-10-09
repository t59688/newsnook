/**
 * 账户适配器：一份实现覆盖 Web 与 Android，差异只有凭证的存放方式。
 *
 * - Web：Better Auth 的 HttpOnly Cookie Session，请求带 `credentials: 'include'`，
 *   客户端不保管任何长期凭证。
 * - Android：WebView 的 Cookie 不可靠，改用 Better Auth 的 bearer 能力——
 *   登录响应头 `set-auth-token` 里的长期 token 只写进 Keystore-backed SecureStore，
 *   社交登录走系统浏览器 + 一次性 token 深链回流（长期 token 不出现在 URL 里）。
 *
 * 这里不引入 better-auth 客户端 SDK：只需要几条固定路由，直接 fetch 更轻，
 * 也不会把服务端类型拖进 App 包体。
 */

import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import type { MeResponse, MobileExchangeResponse, AuthConfigResponse } from '@newsnook/contracts'

import { log } from '../../lib/logger'
import type { CloudFetch, CloudRequestInit } from '../sync/transport'
import { resolveCloudBaseUrl } from './config'
import { authCallbackFromAppUrl } from './mobileCallback'
import {
  clearStoredSession,
  getSecureStore,
  readStoredSession,
  writeStoredSession,
  type SecureStore,
} from './secureStore'
import { describeOAuthCallbackError } from './oauthErrors'
import {
  AccountError,
  type AccountAdapter,
  type AccountPlatform,
  type AccountSession,
  type SignUpInput,
  type SignUpResult,
  type SocialProvider,
  type SocialSignInMode,
} from './types'

/** Better Auth bearer 插件把长期 token 放在这个响应头里 */
const AUTH_TOKEN_HEADER = 'set-auth-token'

export interface AccountAdapterOptions {
  platform: AccountPlatform
  baseUrl?: string
  secureStore?: SecureStore
  fetchImpl?: typeof fetch
  /** Web：当前页面跳转；Android：系统浏览器 / Custom Tab */
  openExternal: (url: string) => Promise<void> | void
  /** Web 社交登录回跳地址；Android 用固定的 mobile/complete，与此无关 */
  webCallbackUrl?: () => string
}

interface AuthErrorBody {
  code?: string
  message?: string
  error?: string
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

async function toAccountError(response: Response): Promise<AccountError> {
  let code = `HTTP_${response.status}`
  let message = `请求失败（${response.status}）`
  try {
    const body = (await response.json()) as AuthErrorBody
    if (body?.code) code = body.code
    if (body?.message) message = body.message
    else if (body?.error) message = body.error
  } catch {
    // Better Auth 与反代都可能返回非 JSON；保留状态码即可
  }
  return new AccountError(code, message, response.status)
}

export function createAccountAdapter(options: AccountAdapterOptions): AccountAdapter {
  const baseUrl = (options.baseUrl ?? resolveCloudBaseUrl()).replace(/\/+$/, '')
  const platform = options.platform
  const native = platform === 'android'
  const store = options.secureStore ?? getSecureStore()
  const doFetch: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init))

  /** 内存里的 bearer 副本，避免每个请求都读一次 Keystore */
  let bearerToken: string | null = null

  async function loadBearer(): Promise<string | null> {
    if (!native) return null
    if (bearerToken) return bearerToken
    const stored = await readStoredSession(store)
    bearerToken = stored?.token ?? null
    return bearerToken
  }

  async function persistBearer(token: string, userId: string, expiresAt = 0): Promise<void> {
    bearerToken = token
    if (native) await writeStoredSession(store, { token, userId, expiresAt })
  }

  async function dropBearer(): Promise<void> {
    bearerToken = null
    if (native) await clearStoredSession(store)
  }

  /**
   * 所有云端请求的唯一出口：同步引擎、账户接口共用。
   * Android 的响应头里若带了新的 token（Better Auth 会滚动续期），顺手更新 Keystore。
   */
  const fetchCloud: CloudFetch = async (path: string, init?: CloudRequestInit) => {
    const headers: Record<string, string> = { accept: 'application/json', ...init?.headers }
    let body: string | undefined
    if (init?.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.body)
    }

    if (native) {
      const token = await loadBearer()
      if (token) headers.authorization = `Bearer ${token}`
    }

    const response = await doFetch(`${baseUrl}${normalizePath(path)}`, {
      method: init?.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      credentials: native ? 'omit' : 'include',
    })

    if (native) {
      const rotated = response.headers.get(AUTH_TOKEN_HEADER)
      if (rotated && rotated !== bearerToken) {
        bearerToken = rotated
        const existing = await readStoredSession(store)
        await writeStoredSession(store, {
          token: rotated,
          userId: existing?.userId ?? '',
          expiresAt: existing?.expiresAt ?? 0,
        })
      }
    }

    return response
  }

  async function callAuth<T>(path: string, body?: unknown): Promise<{ data: T; response: Response }> {
    let response: Response
    try {
      response = await fetchCloud(path, body === undefined ? undefined : { method: 'POST', body })
    } catch (error) {
      throw new AccountError('NETWORK_ERROR', error instanceof Error ? error.message : '网络请求失败')
    }
    if (!response.ok) throw await toAccountError(response)
    const text = await response.text()
    const data = (text ? JSON.parse(text) : {}) as T
    return { data, response }
  }

  function toSession(me: MeResponse): AccountSession {
    return {
      user: {
        id: me.user.id,
        email: me.user.email,
        name: me.user.name,
        emailVerified: me.user.emailVerified,
        image: me.user.image,
      },
      linkedProviders: me.linkedProviders,
    }
  }

  async function fetchMe(): Promise<AccountSession | null> {
    let response: Response
    try {
      response = await fetchCloud('/api/v1/me')
    } catch (error) {
      // 断网/云端故障不改变登录态：本地照常离线阅读，等下次触发再复核
      log.account.debug('me request failed', { error })
      return null
    }
    if (response.status === 401 || response.status === 403) {
      await dropBearer()
      return null
    }
    if (!response.ok) return null
    return toSession((await response.json()) as MeResponse)
  }

  async function socialUrl(path: string, provider: SocialProvider): Promise<string> {
    const callbackURL = native
      ? `${baseUrl}/api/v1/auth/mobile/complete`
      : (options.webCallbackUrl?.() ?? baseUrl)

    const { data } = await callAuth<{ url?: string; redirect?: boolean }>(path, {
      provider,
      callbackURL,
      // Android 需要拿到 URL 自己丢给系统浏览器；Web 也用同一条路径，跳转由我们发起
      disableRedirect: true,
    })
    if (!data.url) throw new AccountError('OAUTH_URL_MISSING', '无法开始第三方登录，请稍后再试')
    return data.url
  }

  return {
    platform,
    fetchCloud,

    async restore() {
      if (native && !(await loadBearer())) return null
      return fetchMe()
    },

    refresh: fetchMe,

    async signUp(input: SignUpInput): Promise<SignUpResult> {
      const { data } = await callAuth<{ token?: string | null; user?: { id?: string } }>(
        '/api/auth/sign-up/email',
        {
          email: input.email.trim(),
          password: input.password,
          name: input.name?.trim() || input.email.trim().split('@')[0],
        },
      )
      // 开启邮箱验证后不会直接返回 Session，此时必须先去邮箱点链接
      return { verificationRequired: !data?.token }
    },

    async signIn(email: string, password: string): Promise<AccountSession> {
      const { data, response } = await callAuth<{ user?: { id?: string }; token?: string }>(
        '/api/auth/sign-in/email',
        { email: email.trim(), password },
      )

      if (native) {
        const token = response.headers.get(AUTH_TOKEN_HEADER) ?? data.token ?? null
        if (!token) throw new AccountError('SESSION_MISSING', '登录成功但未拿到会话，请重试')
        await persistBearer(token, data.user?.id ?? '')
      }

      const session = await fetchMe()
      if (!session) throw new AccountError('SESSION_MISSING', '登录成功但会话校验失败，请重试')
      log.account.info('signed in', { platform })
      return session
    },

    async requestPasswordReset(email: string): Promise<void> {
      await callAuth('/api/auth/request-password-reset', {
        email: email.trim(),
        redirectTo: options.webCallbackUrl?.() ?? baseUrl,
      })
    },

    async resendVerificationEmail(email: string): Promise<void> {
      await callAuth('/api/auth/send-verification-email', {
        email: email.trim(),
        callbackURL: options.webCallbackUrl?.() ?? baseUrl,
      })
    },

    async startSocialSignIn(provider: SocialProvider): Promise<SocialSignInMode> {
      if (native) {
        // Custom Tab 与 WebView Cookie 不共享；经服务端 GET 启动 OAuth，state 与回调同上下文
        await options.openExternal(`${baseUrl}/api/v1/auth/mobile/start/${provider}`)
        return 'external'
      }
      const url = await socialUrl('/api/auth/sign-in/social', provider)
      await options.openExternal(url)
      return 'redirect'
    },

    async linkSocial(provider: SocialProvider): Promise<SocialSignInMode> {
      if (native) {
        // 与登录同理：state Cookie 必须写在 Custom Tab 上，WebView 里 fetch 出来的必然对不上。
        // 服务端换一枚一次性 token，真正的 link-social 由 Custom Tab 自己发起。
        const { data } = await callAuth<{ url?: string }>(
          `/api/v1/auth/mobile/link/${provider}`,
          {},
        )
        if (!data.url) throw new AccountError('OAUTH_URL_MISSING', '无法开始绑定，请稍后再试')
        await options.openExternal(data.url)
        return 'external'
      }
      const url = await socialUrl('/api/auth/link-social', provider)
      await options.openExternal(url)
      return 'redirect'
    },

    async handleAuthDeepLink(url: string): Promise<AccountSession | null> {
      const params = authCallbackFromAppUrl(url)
      if (!params) return null

      if (params.error) {
        log.account.warn('oauth callback failed', { code: params.error })
        throw new AccountError(params.error, describeOAuthCallbackError(params.error))
      }

      if (params.linked) {
        // 绑定不换会话，本机 bearer 照旧；只要把已绑定列表刷新回来
        log.account.info('linked social account', { provider: params.linked })
        return fetchMe()
      }

      if (!params.ott) return null

      const { data } = await callAuth<MobileExchangeResponse>('/api/v1/auth/mobile/exchange', {
        token: params.ott,
      })
      if (!data?.sessionToken) throw new AccountError('SESSION_MISSING', '登录回流失败，请重新登录')

      await persistBearer(data.sessionToken, data.user.id, data.expiresAt)
      const session = await fetchMe()
      if (session) log.account.info('signed in via deep link', { platform })
      return session
    },

    async signOut(): Promise<void> {
      try {
        await callAuth('/api/auth/sign-out', {})
      } catch (error) {
        // 云端不可达也要退出本机：凭证在本地清干净即可
        log.account.warn('sign out request failed', { error })
      }
      await dropBearer()
    },

    async fetchAuthConfig(): Promise<AuthConfigResponse> {
      const fallback: AuthConfigResponse = { socialSignIn: [], emailSignUp: true }
      try {
        const response = await fetchCloud('/api/v1/auth/config')
        if (!response.ok) return fallback
        return (await response.json()) as AuthConfigResponse
      } catch (error) {
        log.account.debug('auth config request failed', { error })
        return fallback
      }
    },
  }
}

/**
 * 运行环境对应的适配器：Android 用系统浏览器（Custom Tab）跑 OAuth，
 * Web 直接在当前标签页跳转，回来落在原页面。
 */
export function createPlatformAccountAdapter(): AccountAdapter {
  const android = Capacitor.getPlatform() === 'android'
  return createAccountAdapter({
    platform: android ? 'android' : 'web',
    openExternal: async (url) => {
      if (android) {
        await Browser.open({ url })
        return
      }
      window.location.assign(url)
    },
    webCallbackUrl: () =>
      typeof window === 'undefined' ? '' : `${window.location.origin}${window.location.pathname}`,
  })
}
