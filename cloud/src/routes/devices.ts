/**
 * 设备管理：列出账户下的设备、撤销某台设备的云端访问。
 * 撤销不删除该设备曾经同步上来的数据（设计 §25）。
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'

import { uuidSchema, type DeviceListResponse } from '@newsnook/contracts'

import { validationFailed } from '../errors.js'
import type { SyncService } from '../sync/service.js'

export const DEVICE_HEADER = 'x-newsnook-device'

export interface DeviceRouteOptions {
  service: SyncService
}

/** 当前设备 id 走请求头，GET 与 POST 用同一个来源 */
export function deviceIdFromHeader(request: FastifyRequest): string | null {
  const raw = request.headers[DEVICE_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  return uuidSchema.safeParse(value).success ? value : null
}

export async function registerDeviceRoutes(
  app: FastifyInstance,
  options: DeviceRouteOptions,
): Promise<void> {
  app.get(
    '/api/v1/devices',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request): Promise<DeviceListResponse> => {
      const session = await app.requireSession(request)
      const devices = await options.service.listDevices(
        session.userId,
        deviceIdFromHeader(request),
      )
      return { devices }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/v1/devices/:id/revoke',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const session = await app.requireSession(request)
      const parsed = uuidSchema.safeParse(request.params.id)
      if (!parsed.success) throw validationFailed('设备标识无效')
      const { revokedSessions } = await options.service.revokeDevice(
        session.userId,
        parsed.data,
        session.sessionId,
      )
      request.log.info(
        {
          requestId: request.id,
          operation: 'device.revoke',
          userId: session.userId,
          deviceId: parsed.data,
          revokedSessions,
        },
        'device revoked',
      )
      return { revoked: true }
    },
  )
}
