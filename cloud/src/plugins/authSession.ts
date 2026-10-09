/**
 * 认证上下文：所有业务 API 的 `userId` 只从 Better Auth Session 推导，
 * 永远不信任请求体或查询串里客户端自称的 user id。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import type { NewsNookAuth } from '../auth.js'
import { authRequired } from '../errors.js'

export interface SessionContext {
  userId: string
  email: string
  emailVerified: boolean
  name: string | null
  image: string | null
  sessionToken: string
  /** Better Auth 的 session 行 id；设备撤销时据此作废会话，不落 token */
  sessionId: string
}

declare module 'fastify' {
  interface FastifyInstance {
    newsnookAuth: NewsNookAuth
    /** 拿到已验证的 Session；未登录抛 AUTH_REQUIRED */
    requireSession: (request: FastifyRequest) => Promise<SessionContext>
    /** 探测式读取，用于既可匿名又可登录的端点 */
    readSession: (request: FastifyRequest) => Promise<SessionContext | null>
  }
}

/** Fastify 的 headers 是 Node 形状；Better Auth 需要 Web Headers */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
      continue
    }
    headers.set(key, String(value))
  }
  return headers
}

export interface AuthPluginOptions {
  auth: NewsNookAuth
}

export async function registerAuthPlugin(
  app: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  app.decorate('newsnookAuth', options.auth)

  app.decorate('readSession', async (request: FastifyRequest): Promise<SessionContext | null> => {
    const result = await options.auth.api.getSession({ headers: toWebHeaders(request) })
    if (!result?.session || !result.user) return null
    return {
      userId: result.user.id,
      email: result.user.email,
      emailVerified: Boolean(result.user.emailVerified),
      name: result.user.name ?? null,
      image: result.user.image ?? null,
      sessionToken: result.session.token,
      sessionId: result.session.id,
    }
  })

  app.decorate('requireSession', async (request: FastifyRequest): Promise<SessionContext> => {
    const session = await app.readSession(request)
    if (!session) throw authRequired()
    return session
  })
}
