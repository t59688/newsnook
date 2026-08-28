/**
 * 业务路由装配：Better Auth handler、`/api/v1` 账户与同步接口。
 * 拆成单独模块，方便 health-only 的最小实例跳过认证依赖。
 */

import type { FastifyInstance } from 'fastify'

import { createAuth } from '../auth.js'
import type { CloudConfig } from '../config.js'
import { createSecretCipher } from '../crypto/secrets.js'
import type { CloudPools } from '../db/pools.js'
import { createMailer, type Mailer } from '../mail.js'
import { registerAuthPlugin } from '../plugins/authSession.js'
import { SyncService } from '../sync/service.js'
import { registerAuthRoutes } from './auth.js'
import { deviceIdFromHeader, registerDeviceRoutes } from './devices.js'
import { registerMobileAuthRoutes } from './mobileAuth.js'
import { registerSyncRoutes } from './sync.js'

export interface BusinessRouteOptions {
  config: CloudConfig
  pools: CloudPools
  /** 测试注入内存收件箱；生产用 SMTP */
  mailer?: Mailer
}

export async function registerBusinessRoutes(
  app: FastifyInstance,
  options: BusinessRouteOptions,
): Promise<void> {
  const mailer = options.mailer ?? createMailer(options.config)
  const auth = createAuth({ config: options.config, pool: options.pools.auth, mailer })
  const cipher = createSecretCipher(options.config.dataEncryptionKey)
  const service = new SyncService({ pool: options.pools.app, cipher })

  await registerAuthPlugin(app, { auth })
  await registerAuthRoutes(app, {
    auth,
    config: options.config,
    resolveDevice: async (request, userId) => {
      const deviceId = deviceIdFromHeader(request)
      if (!deviceId) return null
      const devices = await service.listDevices(userId, deviceId)
      const current = devices.find((device) => device.id === deviceId)
      if (!current) return null
      return { id: current.id, platform: current.platform, revoked: current.revokedAt !== null }
    },
  })
  await registerMobileAuthRoutes(app, {
    auth,
    betterAuthUrl: options.config.betterAuthUrl,
    config: options.config,
  })
  await registerDeviceRoutes(app, { service })
  await registerSyncRoutes(app, { service })
}
