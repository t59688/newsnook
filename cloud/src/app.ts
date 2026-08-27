/**
 * Fastify 组装：CORS、体积上限、限流、结构化日志、健康检查与统一错误响应。
 * 监听与优雅退出在 server.ts；这里保持可测试（可注入 pool / config）。
 */

import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'

import { SYNC_LIMITS } from '@newsnook/contracts'

import type { CloudConfig } from './config.js'
import { createPools, type CloudPools } from './db/pools.js'
import { ApiError, apiErrorBody } from './errors.js'
import type { Mailer } from './mail.js'
import { registerHealthRoutes } from './routes/health.js'

export interface BuildAppOptions {
  config: CloudConfig
  /** 测试可注入自己的池；缺省按 config 建两个池 */
  pools?: CloudPools
  /** 只想验证某一层时可以关掉认证与同步路由 */
  registerBusinessRoutes?: boolean
  /** 测试注入内存收件箱；生产走 SMTP */
  mailer?: Mailer
}

export interface CloudApp {
  app: FastifyInstance
  pools: CloudPools
  config: CloudConfig
}

/** 全局请求体上限；push 路由另有更严格的限制 */
const GLOBAL_BODY_LIMIT = 2 * 1024 * 1024

interface HttpishError {
  code?: string
  statusCode?: number
  message?: string
}

function isBodyTooLarge(error: HttpishError): boolean {
  return error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.statusCode === 413
}

export async function buildApp(options: BuildAppOptions): Promise<CloudApp> {
  const { config } = options
  const pools = options.pools ?? createPools(config)
  const ownsPools = !options.pools

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // 同步日志只允许出现这些字段；Token / Secret / 完整 payload 一律不记
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'res.headers["set-auth-token"]',
        ],
        censor: '[redacted]',
      },
    },
    bodyLimit: GLOBAL_BODY_LIMIT,
    trustProxy: config.trustProxy,
    disableRequestLogging: false,
  })

  await app.register(cors, {
    origin: config.clientOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-newsnook-device'],
    // Android 通过这个响应头拿到 bearer token；不额外暴露其它头
    exposedHeaders: ['set-auth-token'],
    maxAge: 600,
  })

  await app.register(rateLimit, {
    global: false,
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
  })

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send(apiErrorBody('NOT_FOUND', 'Route not found', request.id)),
  )

  app.setErrorHandler(async (raw: unknown, request, reply) => {
    const error = raw as HttpishError & Error
    if (error instanceof ApiError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error, code: error.code, detail: error.detail }, 'request failed')
      } else {
        request.log.info({ code: error.code, detail: error.detail }, 'request rejected')
      }
      return reply.code(error.statusCode).send(apiErrorBody(error.code, error.message, request.id))
    }

    if (isBodyTooLarge(error)) {
      return reply
        .code(413)
        .send(apiErrorBody('PAYLOAD_TOO_LARGE', 'Request body is too large', request.id))
    }

    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(apiErrorBody('RATE_LIMITED', 'Too many requests, retry later', request.id))
    }

    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send(apiErrorBody('VALIDATION_FAILED', error.message, request.id))
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply
      .code(500)
      .send(apiErrorBody('INTERNAL_ERROR', 'Unexpected server error', request.id))
  })

  await registerHealthRoutes(app, { pool: pools.app })

  if (options.registerBusinessRoutes !== false) {
    const { registerBusinessRoutes } = await import('./routes/index.js')
    await registerBusinessRoutes(app, { config, pools, mailer: options.mailer })
  }

  app.addHook('onClose', async () => {
    if (ownsPools) await pools.close()
  })

  return { app, pools, config }
}

export const PUSH_BODY_LIMIT = SYNC_LIMITS.maxPushBodyBytes
