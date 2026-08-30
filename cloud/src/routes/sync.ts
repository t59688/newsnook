/**
 * 同步 HTTP 边界。所有 handler 的 `userId` 都来自 Session；
 * 请求体一律先过共享 contracts 的 Zod schema，再进 service。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  syncBootstrapReplaceRequestSchema,
  syncConflictBatchResolveRequestSchema,
  syncConflictResolveRequestSchema,
  syncPullQuerySchema,
  syncPushRequestSchema,
  uuidSchema,
  type SyncConflictListResponse,
} from '@newsnook/contracts'

import { protocolUnsupported, validationFailed } from '../errors.js'
import type { SyncService } from '../sync/service.js'
import { deviceContextFromRequest, deviceIdFromHeader } from './devices.js'

export interface SyncRouteOptions {
  service: SyncService
}

const SYNC_RATE_LIMIT = { max: 120, timeWindow: '1 minute' }

/** 协议版本不兼容要给出可执行的信号（去升级），不能混在通用校验失败里 */
function assertProtocolVersion(body: unknown): void {
  const version = (body as { protocolVersion?: unknown } | null)?.protocolVersion
  if (version !== undefined && version !== SYNC_PROTOCOL_VERSION) throw protocolUnsupported()
}

/**
 * 每条同步路由都必须自报设备。设备是访问主体：没有它就无法把会话绑到设备上，
 * 「撤销设备」也就拦不住换了 deviceId 的同一个 token。
 * 请求体里另带 deviceId 时两者必须一致，避免一边登记 A、一边以 B 的名义写入。
 */
function requireDeviceId(request: FastifyRequest, fromBody?: string): string {
  const fromHeader = deviceIdFromHeader(request)
  if (!fromHeader) throw validationFailed('同步请求需要设备标识')
  if (fromBody && fromBody !== fromHeader) throw validationFailed('设备标识与请求头不一致')
  return fromHeader
}

export async function registerSyncRoutes(
  app: FastifyInstance,
  options: SyncRouteOptions,
): Promise<void> {
  const { service } = options

  app.get(
    '/api/v1/sync/bootstrap',
    { config: { rateLimit: SYNC_RATE_LIMIT } },
    async (request) => {
      const session = await app.requireSession(request)
      const deviceId = requireDeviceId(request)
      await service.ensureDevice(
        session.userId,
        deviceContextFromRequest(request, deviceId),
        session.sessionId,
      )
      return service.bootstrap(session.userId)
    },
  )

  app.post(
    '/api/v1/sync/bootstrap/replace',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request) => {
      const session = await app.requireSession(request)
      assertProtocolVersion(request.body)
      const parsed = syncBootstrapReplaceRequestSchema.safeParse(request.body)
      if (!parsed.success) throw validationFailed('首次同步请求无效')

      const deviceId = requireDeviceId(request, parsed.data.deviceId)
      await service.ensureDevice(
        session.userId,
        deviceContextFromRequest(request, deviceId),
        session.sessionId,
      )
      return service.bootstrapReplace(session.userId, deviceId, parsed.data.entities)
    },
  )

  app.post(
    '/api/v1/sync/push',
    {
      bodyLimit: SYNC_LIMITS.maxPushBodyBytes,
      config: { rateLimit: SYNC_RATE_LIMIT },
    },
    async (request) => {
      const session = await app.requireSession(request)
      assertProtocolVersion(request.body)
      const parsed = syncPushRequestSchema.safeParse(request.body)
      if (!parsed.success) {
        throw validationFailed(
          '同步推送内容无效',
          parsed.error.issues.map((issue) => issue.path.join('.')).join(','),
        )
      }

      const deviceId = requireDeviceId(request, parsed.data.deviceId)
      const headerContext = deviceContextFromRequest(request, deviceId)
      await service.ensureDevice(
        session.userId,
        {
          deviceId,
          deviceName: parsed.data.deviceName ?? headerContext.deviceName,
          platform: parsed.data.platform ?? headerContext.platform,
          appVersion: parsed.data.appVersion ?? headerContext.appVersion,
        },
        session.sessionId,
      )

      const startedAt = Date.now()
      const { response, summary } = await service.push(session.userId, parsed.data)
      request.log.info(
        {
          requestId: request.id,
          operation: 'sync.push',
          userId: summary.userId,
          deviceId: summary.deviceId,
          mutationCount: summary.mutationCount,
          acceptedCount: summary.acceptedCount,
          conflictCount: summary.conflictCount,
          noopCount: summary.noopCount,
          replayedCount: summary.replayedCount,
          fromRevision: summary.fromRevision,
          toRevision: summary.toRevision,
          durationMs: Date.now() - startedAt,
        },
        'sync push',
      )
      return response
    },
  )

  app.get('/api/v1/sync/pull', { config: { rateLimit: SYNC_RATE_LIMIT } }, async (request) => {
    const session = await app.requireSession(request)
    const parsed = syncPullQuerySchema.safeParse(request.query)
    if (!parsed.success) throw validationFailed('同步拉取参数无效')

    const deviceId = requireDeviceId(request)
    await service.ensureDevice(
      session.userId,
      deviceContextFromRequest(request, deviceId),
      session.sessionId,
    )

    const startedAt = Date.now()
    const result = await service.pull(session.userId, parsed.data.since, parsed.data.limit)
    request.log.info(
      {
        requestId: request.id,
        operation: 'sync.pull',
        userId: session.userId,
        deviceId,
        fromRevision: parsed.data.since,
        toRevision: result.cursor,
        recordCount: result.records.length,
        hasMore: result.hasMore,
        durationMs: Date.now() - startedAt,
      },
      'sync pull',
    )
    return result
  })

  app.get(
    '/api/v1/sync/conflicts',
    { config: { rateLimit: SYNC_RATE_LIMIT } },
    async (request): Promise<SyncConflictListResponse> => {
      const session = await app.requireSession(request)
      const deviceId = requireDeviceId(request)
      await service.ensureDevice(
        session.userId,
        deviceContextFromRequest(request, deviceId),
        session.sessionId,
      )
      return { conflicts: await service.listConflicts(session.userId) }
    },
  )

  // 必须先于 /:id/resolve 注册，否则 path 里的 "resolve" 会被当成 id
  app.post('/api/v1/sync/conflicts/resolve', { config: { rateLimit: SYNC_RATE_LIMIT } }, async (request) => {
    const session = await app.requireSession(request)
    assertProtocolVersion(request.body)

    const parsed = syncConflictBatchResolveRequestSchema.safeParse(request.body)
    if (!parsed.success) throw validationFailed('冲突批量处理请求无效')

    const deviceId = requireDeviceId(request, parsed.data.deviceId)
    await service.ensureDevice(
      session.userId,
      deviceContextFromRequest(request, deviceId),
      session.sessionId,
    )

    const result = await service.resolveConflicts(session.userId, parsed.data.decisions, deviceId)
    return {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      resolved: result.resolved,
      currentRevision: result.currentRevision,
    }
  })

  app.post<{ Params: { id: string } }>(
    '/api/v1/sync/conflicts/:id/resolve',
    { config: { rateLimit: SYNC_RATE_LIMIT } },
    async (request) => {
      const session = await app.requireSession(request)
      assertProtocolVersion(request.body)
      const conflictId = uuidSchema.safeParse(request.params.id)
      if (!conflictId.success) throw validationFailed('冲突标识无效')

      const parsed = syncConflictResolveRequestSchema.safeParse(request.body)
      if (!parsed.success) throw validationFailed('冲突处理请求无效')

      const deviceId = requireDeviceId(request, parsed.data.deviceId)
      await service.ensureDevice(
        session.userId,
        deviceContextFromRequest(request, deviceId),
        session.sessionId,
      )

      const result = await service.resolveConflict(
        session.userId,
        conflictId.data,
        parsed.data.resolution,
        deviceId,
      )
      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        resolved: result.resolved,
        currentRevision: result.currentRevision,
      }
    },
  )
}
