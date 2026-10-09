/**
 * 两个连接池：业务表用 `public`，Better Auth 自己的表放 `auth` schema。
 * 路由层不允许自行 new Pool()，全部从这里取。
 */

import { Pool } from 'pg'

import type { CloudConfig } from '../config.js'

export interface CloudPools {
  /** NewsNook 业务表（devices / sync_* / subscriptions / ...） */
  app: Pool
  /** Better Auth 表；search_path 固定在 auth schema */
  auth: Pool
  close: () => Promise<void>
}

export const AUTH_SCHEMA = 'auth'

export function createPools(config: Pick<CloudConfig, 'databaseUrl'>): CloudPools {
  const app = new Pool({ connectionString: config.databaseUrl, max: 10 })
  const auth = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    options: `-c search_path=${AUTH_SCHEMA},public`,
  })

  return {
    app,
    auth,
    close: async () => {
      await Promise.allSettled([app.end(), auth.end()])
    },
  }
}
