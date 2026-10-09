/**
 * 把 `/api/auth/*` 原样转交给 Better Auth 的 handler，包括 Cookie 与
 * `set-auth-token`（Android 的 bearer 交接）。这里不重实现任何认证细节。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { AuthConfigResponse, MeResponse } from '@newsnook/contracts'

import type { NewsNookAuth } from '../auth.js'
import type { CloudConfig } from '../config.js'
import { listEnabledSocialOAuthProviders } from '../config.js'
import { toWebHeaders } from '../plugins/authSession.js'

export interface AuthRouteOptions {
  auth: NewsNookAuth
  config: CloudConfig
  /** 请求头带了设备 id 时补上该设备的状态；同步模块提供实现 */
  resolveDevice?: (
    request: FastifyRequest,
    userId: string,
  ) => Promise<MeResponse['device']>
}

/** 认证端点比同步端点更值得严格限流：撞库与验证码轰炸都打这里 */
const AUTH_RATE_LIMIT = { max: 30, timeWindow: '1 minute' }

function requestUrl(request: FastifyRequest): string {
  const host = request.headers.host ?? 'localhost'
  return `${request.protocol}://${host}${request.url}`
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions,
): Promise<void> {
  await app.register(async (scope) => {
    // Better Auth 需要原始 body；在这个封装作用域内关掉继承来的 JSON 解析
    scope.removeContentTypeParser(['application/json', 'text/plain'])
    scope.addContentTypeParser(
      ['application/json', 'application/x-www-form-urlencoded', 'text/plain'],
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, body)
      },
    )

    scope.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      config: { rateLimit: AUTH_RATE_LIMIT },
      handler: async (request, reply) => {
        const hasBody = request.method !== 'GET' && typeof request.body === 'string'
        const webRequest = new Request(requestUrl(request), {
          method: request.method,
          headers: toWebHeaders(request),
          body: hasBody ? (request.body as string) : undefined,
        })

        const response = await options.auth.handler(webRequest)

        reply.status(response.status)
        const setCookies = response.headers.getSetCookie?.() ?? []
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') return
          reply.header(key, value)
        })
        for (const cookie of setCookies) reply.header('set-cookie', cookie)

        const text = await response.text()
        return reply.send(text.length ? text : null)
      },
    })
  })

  app.get(
    '/api/v1/auth/config',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (): Promise<AuthConfigResponse> => ({
      socialSignIn: listEnabledSocialOAuthProviders(options.config),
      emailSignUp: options.config.emailSignUpEnabled,
    }),
  )

  app.get(
    '/api/v1/me',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request): Promise<MeResponse> => {
      const session = await app.requireSession(request)
      const accounts = await options.auth.api.listUserAccounts({
        headers: toWebHeaders(request),
      })

      return {
        user: {
          id: session.userId,
          email: session.email,
          name: session.name,
          emailVerified: session.emailVerified,
          image: session.image,
        },
        linkedProviders: (accounts ?? []).map((account) => account.providerId),
        device: (await options.resolveDevice?.(request, session.userId)) ?? null,
      }
    },
  )
}
