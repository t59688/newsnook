/**
 * Android Session 交接。
 *
 *   App -> GET /api/v1/auth/mobile/start/:provider（Custom Tab，state Cookie 与回调同上下文）
 *       -> 系统浏览器 -> provider
 *       -> Better Auth callback（浏览器拿到 Cookie）
 *       -> GET /api/v1/auth/mobile/complete
 *       -> generateOneTimeToken(当前 Session)
 *       -> 302 newsnook://auth/callback?ott=<一次性 token>
 *       -> App POST /api/v1/auth/mobile/exchange
 *       -> verifyOneTimeToken -> 返回 session.token -> 存进 Keystore
 *
 * 重点：长期 Session token 绝不出现在深链 URL 里，一次性 token 短时有效且用后即焚；
 * 回跳目标是写死的 `newsnook://auth/callback`，不接受任何客户端指定的跳转地址。
 *
 * 勿在 WebView 里 fetch sign-in/social 再开 Custom Tab：OAuth state Cookie 落在 WebView，
 * 回调在 Chrome Custom Tab，会 state_mismatch 并落到 `/?error=state_mismatch`（根路径 404）。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

import {
  MOBILE_AUTH_CALLBACK_URL,
  mobileExchangeRequestSchema,
  type MobileExchangeResponse,
} from '@newsnook/contracts'

import type { NewsNookAuth } from '../auth.js'
import { listEnabledSocialOAuthProviders, type CloudConfig } from '../config.js'
import { ApiError, authRequired, validationFailed } from '../errors.js'
import { toWebHeaders } from '../plugins/authSession.js'

export interface MobileAuthRouteOptions {
  auth: NewsNookAuth
  betterAuthUrl: string
  config: CloudConfig
}

const MOBILE_RATE_LIMIT = { max: 30, timeWindow: '1 minute' }

function mobileCompleteCallbackUrl(betterAuthUrl: string): string {
  return `${betterAuthUrl.replace(/\/$/, '')}/api/v1/auth/mobile/complete`
}

function forwardSetCookies(response: Response, reply: FastifyReply): void {
  const setCookies = response.headers.getSetCookie?.() ?? []
  for (const cookie of setCookies) reply.header('set-cookie', cookie)
}

async function redirectSocialOAuth(
  auth: NewsNookAuth,
  betterAuthUrl: string,
  authPath: '/api/auth/sign-in/social' | '/api/auth/link-social',
  provider: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const callbackURL = mobileCompleteCallbackUrl(betterAuthUrl)
  const webRequest = new Request(`${betterAuthUrl}${authPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...toWebHeaders(request),
    },
    body: JSON.stringify({ provider, callbackURL, disableRedirect: true }),
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
      const provider = (request.params as { provider: string }).provider
      const enabled = new Set(listEnabledSocialOAuthProviders(options.config))
      if (!enabled.has(provider as 'google' | 'github' | 'linuxdo')) {
        throw validationFailed('Unsupported social provider')
      }
      return redirectSocialOAuth(
        options.auth,
        options.betterAuthUrl,
        '/api/auth/sign-in/social',
        provider,
        request,
        reply,
      )
    },
  )

  app.get(
    '/api/v1/auth/mobile/complete',
    { config: { rateLimit: MOBILE_RATE_LIMIT } },
    async (request, reply) => {
      const session = await app.readSession(request)
      if (!session) {
        // 浏览器没有有效 Cookie：不要 302 回 App，否则 App 会拿到一个无效 ott
        return reply
          .code(401)
          .type('text/html; charset=utf-8')
          .send('<h1>登录未完成</h1><p>请回到「有所闻」重新发起登录。</p>')
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
