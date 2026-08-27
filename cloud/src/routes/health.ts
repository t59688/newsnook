/**
 * 健康检查：live 只说明进程活着（不碰数据库），ready 才验证依赖可用。
 * 部署流程按 backup -> migration -> deploy -> live -> ready 的顺序检查。
 */

import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

export interface HealthRouteOptions {
  pool: Pool
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  app.get('/health/live', async () => ({ status: 'ok' }))

  app.get('/health/ready', async (request, reply) => {
    try {
      await options.pool.query('SELECT 1')
      return { status: 'ok', database: 'ok' }
    } catch (error) {
      request.log.error({ err: error }, 'readiness probe failed')
      return reply.code(503).send({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database is not reachable',
        requestId: request.id,
      })
    }
  })
}
