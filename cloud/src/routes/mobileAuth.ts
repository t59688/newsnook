/**
 * Android Session 交接。
 *
 * 登录：
 *   App -> GET /api/v1/auth/mobile/start/:provider（Custom Tab，state Cookie 与回调同上下文）
 *       -> 系统浏览器 -> provider
 *       -> Better Auth callback（浏览器拿到 Cookie）
 *       -> GET /api/v1/auth/mobile/complete
 *       -> generateOneTimeToken(当前 Session)
 *       -> 302 newsnook://auth/callback?ott=<一次性 token>
 *       -> App POST /api/v1/auth/mobile/exchange
 *       -> verifyOneTimeToken -> 返回 session.token -> 存进 Keystore
 *
 * 绑定（已登录再挂一个第三方身份）：
 *   App -> POST /api/v1/auth/mobile/link/:provider（WebView，bearer 认证）
 *       -> generateOneTimeToken(当前 Session) -> 返回启动 URL
 *       -> Custom Tab GET /api/v1/auth/mobile/link/:provider?ott=<一次性 token>
 *       -> verifyOneTimeToken -> 以 bearer 调 link-social -> state Cookie 落在 Custom Tab
 *       -> 系统浏览器 -> provider -> Better Auth callback（同一浏览器，state 对得上）
 *       -> 302 newsnook://auth/callback?linked=<provider> -> App 刷新 /api/v1/me
 *
 * 重点：长期 Session token 绝不出现在深链 URL 里，一次性 token 短时有效且用后即焚；
 * 回跳目标是写死的 `newsnook://auth/callback`，不接受任何客户端指定的跳转地址。
 *
 * 勿在 WebView 里 fetch sign-in/social 或 link-social 再开 Custom Tab：OAuth state Cookie
 * 落在 WebView（Android 上请求还是 `credentials: 'omit'`，压根不会存），回调却在 Chrome
 * Custom Tab，必然 state_mismatch 并落到 `/?error=state_mismatch`（根路径 400）。
 * 两条流程都必须由 Custom Tab 自己发起，Session 靠一次性 token 交接。
 */

import type { FastifyInstance, FastifyReply } from 'fastify'

import {
  MOBILE_AUTH_CALLBACK_URL,
  mobileExchangeRequestSchema,
  type MobileExchangeResponse,
} from '@newsnook/contracts'

import type { NewsNookAuth } from '../auth.js'
import {
  listEnabledSocialOAuthProviders,
  type CloudConfig,
  type SocialOAuthProviderId,
} from '../config.js'
import { ApiError, authRequired, validationFailed } from '../errors.js'
import { toWebHeaders } from '../plugins/authSession.js'

export interface MobileAuthRouteOptions {
  auth: NewsNookAuth
  betterAuthUrl: string
  config: CloudConfig
}

const MOBILE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' }

function trimUrl(betterAuthUrl: string): string {
  return betterAuthUrl.replace(/\/$/, '')
}

function mobileCompleteCallbackUrl(betterAuthUrl: string): string {
  return `${trimUrl(betterAuthUrl)}/api/v1/auth/mobile/complete`
}

/** 绑定成功后的固定回跳；App 据此刷新已绑定列表，不需要新的 Session */
function mobileLinkedCallbackUrl(provider: string): string {
  const target = new URL(MOBILE_AUTH_CALLBACK_URL)
  target.searchParams.set('linked', provider)
  return target.toString()
}

function assertEnabledProvider(config: CloudConfig, provider: string): SocialOAuthProviderId {
  const enabled = new Set(listEnabledSocialOAuthProviders(config))
  if (!enabled.has(provider as SocialOAuthProviderId)) {
    throw validationFailed('Unsupported social provider')
  }
  return provider as SocialOAuthProviderId
}

function forwardSetCookies(response: Response, reply: FastifyReply): void {
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) reply.header('set-cookie', cookie)
}

/** Custom Tab 里出错时给人看的页面：这里没有 App 壳，JSON 只会显示成乱码 */
function browserNotice(reply: FastifyReply, status: number, detail: string): FastifyReply {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .send(`<h1>登录未完成</h1><p>${detail}</p>`)
}

interface StartOAuthOptions {
  auth: NewsNookAuth
  betterAuthUrl: string
  authPath: '/api/auth/sign-in/social' | '/api/auth/link-social'
  provider: string
  callbackURL: string
  errorCallbackURL?: string
  /** 绑定流程必须带：link-social 需要已登录的调用者，浏览器里没有 Cookie 只能走 bearer */
  sessionToken?: string
  reply: FastifyReply
}

/**
 * 在**当前浏览器上下文**发起 OAuth：把 Better Auth 写的 state Cookie 原样转给调用方，
 * 再 302 到 provider。调用方必须是最终要接住回调的那个浏览器。
 */
async function startOAuthInBrowser(options: StartOAuthOptions): Promise<void> {
  const { auth, betterAuthUrl, authPath, provider, reply } = options

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.sessionToken) headers.authorization = `Bearer ${options.sessionToken}`

  const webRequest = new Request(`${trimUrl(betterAuthUrl)}${authPath}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider,
      callbackURL: options.callbackURL,
      errorCallbackURL: options.errorCallbackURL,
      disableRedirect: true,
    }),
  })

  const response = await auth.handler(webRequest)
  const text = await response.text()

  if (!response.ok) {
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') return
      reply.header(key, value)
    })
    forwardSetCookies(response, reply)
    return reply.send(text.length ? text : null)
  }

  forwardSetCookies(response, reply)

  let data: { url?: string }
  try {
    data = JSON.parse(text) as { url?: string }
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'Failed to start OAuth')
  }

  if (!data.url) throw new ApiError('INTERNAL_ERROR', 'Failed to start OAuth')
  return reply.redirect(data.url, 302)
}

interface VerifiedOneTimeToken {
  session: { token: string; expiresAt: Date | string }
  user: { id: string; email: string; name?: string | null }
}

export async function registerMobileAuthRoutes(
  app: FastifyInstance,
  options: MobileAuthRouteOptions,
): Promise<void> {
  app.get('/', async (request, reply) => {
    const error = (request.query as { error?: string }).error
    if (typeof error === 'string' && error.length > 0) {
      const safe = error.replace(/[<>&]/g, '')
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(
          `<h1>登录未完成</h1><p>原因：${safe}</p><p>请关闭此页，回到「有所闻」重新发起登录。</p>`,
        )
    }
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found', requestId: request.id })
  })

  app.get(
    '/api/v1/auth/mobile/start/:provider',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request, reply) => {
      const provider = assertEnabledProvider(
        options.config,
        (request.params as { provider: string }).provider,
      )
      return startOAuthInBrowser({
        auth: options.auth,
        betterAuthUrl: options.betterAuthUrl,
        authPath: '/api/auth/sign-in/social',
        provider,
        callbackURL: mobileCompleteCallbackUrl(options.betterAuthUrl),
        reply,
      })
    },
  )

  /**
   * 绑定第一步（App WebView，bearer 认证）：只换一个一次性 token，
   * 真正的 OAuth 启动留给 Custom Tab，state Cookie 才会落对地方。
   */
  app.post(
    '/api/v1/auth/mobile/link/:provider',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request): Promise<{ url: string }> => {
      const provider = assertEnabledProvider(
        options.config,
        (request.params as { provider: string }).provider,
      )
      await app.requireSession(request)

      const generated = (await options.auth.api.generateOneTimeToken({
        headers: toWebHeaders(request),
      })) as { token: string } | null

      if (!generated?.token) throw new ApiError('INTERNAL_ERROR', 'Failed to issue handoff token')

      const url = new URL(`${trimUrl(options.betterAuthUrl)}/api/v1/auth/mobile/link/${provider}`)
      url.searchParams.set('ott', generated.token)
      return { url: url.toString() }
    },
  )

  /** 绑定第二步（Custom Tab）：一次性 token 换出 Session，再在这个浏览器里发起 OAuth */
  app.get(
    '/api/v1/auth/mobile/link/:provider',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request, reply) => {
      const provider = assertEnabledProvider(
        options.config,
        (request.params as { provider: string }).provider,
      )
      const ott = (request.query as { ott?: string }).ott
      if (!ott) {
        return browserNotice(reply, 400, '请回到「有所闻」重新发起绑定。')
      }

      let verified: VerifiedOneTimeToken | null = null
      try {
        verified = (await options.auth.api.verifyOneTimeToken({
          body: { token: ott },
        })) as VerifiedOneTimeToken | null
      } catch {
        // 过期 / 已用过 / 伪造：一律当作未认证，不泄漏具体原因
        verified = null
      }

      if (!verified?.session?.token) {
        return browserNotice(reply, 401, '绑定链接已失效，请回到「有所闻」重新发起绑定。')
      }

      return startOAuthInBrowser({
        auth: options.auth,
        betterAuthUrl: options.betterAuthUrl,
        authPath: '/api/auth/link-social',
        provider,
        callbackURL: mobileLinkedCallbackUrl(provider),
        // 出错也要把人送回 App，否则用户停在 API 域名的错误页上
        errorCallbackURL: MOBILE_AUTH_CALLBACK_URL,
        sessionToken: verified.session.token,
        reply,
      })
    },
  )

  app.get(
    '/api/v1/auth/mobile/complete',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request, reply) => {
      const session = await app.readSession(request)
      if (!session) {
        // 浏览器没有有效 Cookie：不要 302 回 App，否则 App 会拿到一个无效 ott
        return browserNotice(reply, 401, '请回到「有所闻」重新发起登录。')
      }

      const generated = (await options.auth.api.generateOneTimeToken({
        headers: toWebHeaders(request),
      })) as { token: string } | null

      if (!generated?.token) throw new ApiError('INTERNAL_ERROR', 'Failed to issue handoff token')

      const target = new URL(MOBILE_AUTH_CALLBACK_URL)
      target.searchParams.set('ott', generated.token)
      return reply.redirect(target.toString(), 302)
    },
  )

  app.post(
    '/api/v1/auth/mobile/exchange',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request): Promise<MobileExchangeResponse> => {
      const parsed = mobileExchangeRequestSchema.safeParse(request.body)
      if (!parsed.success) throw validationFailed('A handoff token is required')

      let verified: VerifiedOneTimeToken | null = null
      try {
        verified = (await options.auth.api.verifyOneTimeToken({
          body: { token: parsed.data.token },
        })) as VerifiedOneTimeToken | null
      } catch {
        // 过期 / 已用过 / 伪造：一律当作未认证，不泄漏具体原因
        throw authRequired()
      }

      if (!verified?.session?.token) throw authRequired()

      const expiresAt = new Date(verified.session.expiresAt).getTime()
      return {
        sessionToken: verified.session.token,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
        user: {
          id: verified.user.id,
          email: verified.user.email,
          name: verified.user.name ?? null,
        },
      }
    },
  )
}
