/**
 * 进程入口：只做「读配置 -> 监听 -> 优雅退出」。
 * 不在这里跑数据库迁移——迁移是显式的部署步骤（见 docs/cloud-deploy.md）。
 */

import { buildApp } from './app.js'
import { loadConfig } from './config.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const { app } = await buildApp({ config })

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down')
    void app
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exit(1)
      })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await app.listen({ port: config.port, host: config.host })
}

void main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
  process.exit(1)
})
