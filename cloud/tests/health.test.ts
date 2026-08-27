/**
 * 健康检查：live 不依赖数据库；ready 反映真实依赖状态。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { Pool } from 'pg'

import { buildApp } from '../src/app.js'
import type { CloudPools } from '../src/db/pools.js'
import { loadConfig, ConfigError } from '../src/config.js'
import { testConfig } from './helpers.js'

function fakePools(query: () => Promise<unknown>): CloudPools {
  const pool = { query } as unknown as Pool
  return { app: pool, auth: pool, close: async () => {} }
}

describe('health routes', () => {
  it('reports live without touching the database', async () => {
    const { app } = await buildApp({
      config: testConfig(),
      pools: fakePools(async () => {
        throw new Error('database must not be touched by the liveness probe')
      }),
      registerBusinessRoutes: false,
    })

    const response = await app.inject({ method: 'GET', url: '/health/live' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().status, 'ok')
    await app.close()
  })

  it('reports ready when the database answers', async () => {
    const { app } = await buildApp({
      config: testConfig(),
      pools: fakePools(async () => ({ rows: [{ '?column?': 1 }] })),
      registerBusinessRoutes: false,
    })

    const response = await app.inject({ method: 'GET', url: '/health/ready' })
    assert.equal(response.statusCode, 200)
    assert.equal(response.json().database, 'ok')
    await app.close()
  })

  it('returns 503 with a stable code when the database is down', async () => {
    const { app } = await buildApp({
      config: testConfig(),
      pools: fakePools(async () => {
        throw new Error('connection refused')
      }),
      registerBusinessRoutes: false,
    })

    const response = await app.inject({ method: 'GET', url: '/health/ready' })
    assert.equal(response.statusCode, 503)
    assert.equal(response.json().code, 'SERVICE_UNAVAILABLE')
    assert.ok(response.json().requestId, '错误体必须带 requestId')
    await app.close()
  })

  it('answers unknown routes with the shared error shape', async () => {
    const { app } = await buildApp({
      config: testConfig(),
      pools: fakePools(async () => ({ rows: [] })),
      registerBusinessRoutes: false,
    })

    const response = await app.inject({ method: 'GET', url: '/nope' })
    assert.equal(response.statusCode, 404)
    assert.equal(response.json().code, 'NOT_FOUND')
    assert.ok(response.json().requestId)
    await app.close()
  })
})

describe('config parsing', () => {
  const base = {
    DATABASE_URL: 'postgres://localhost/newsnook',
    BETTER_AUTH_URL: 'http://127.0.0.1:8787',
    BETTER_AUTH_SECRET: 'a'.repeat(40),
    NEWSNOOK_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    CLIENT_ORIGINS: 'http://127.0.0.1:5173,https://news.example.test',
  }

  it('accepts a complete environment', () => {
    const config = loadConfig(base)
    assert.equal(config.clientOrigins.length, 2)
    assert.equal(config.requireEmailVerification, true)
  })

  it('rejects a short auth secret', () => {
    assert.throws(() => loadConfig({ ...base, BETTER_AUTH_SECRET: 'short' }), ConfigError)
  })

  it('rejects an encryption key that is not 32 bytes', () => {
    assert.throws(
      () =>
        loadConfig({
          ...base,
          NEWSNOOK_DATA_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
        }),
      ConfigError,
    )
  })

  it('refuses to reuse the auth secret as the data encryption key', () => {
    const shared = Buffer.alloc(32, 3).toString('base64')
    assert.throws(
      () =>
        loadConfig({
          ...base,
          BETTER_AUTH_SECRET: shared.padEnd(32, 'x'),
          NEWSNOOK_DATA_ENCRYPTION_KEY: shared.padEnd(32, 'x'),
        }),
      ConfigError,
    )
  })

  it('rejects a wildcard origin allowlist', () => {
    assert.throws(() => loadConfig({ ...base, CLIENT_ORIGINS: '*' }), ConfigError)
  })

  it('requires OAuth id and secret together', () => {
    assert.throws(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: 'only-id' }), ConfigError)
    assert.throws(() => loadConfig({ ...base, LINUXDO_CLIENT_ID: 'only-id' }), ConfigError)
  })

  it('accepts Linux DO Connect credentials', () => {
    const config = loadConfig({
      ...base,
      LINUXDO_CLIENT_ID: 'ld-id',
      LINUXDO_CLIENT_SECRET: 'ld-secret',
    })
    assert.deepEqual(config.linuxdo, { clientId: 'ld-id', clientSecret: 'ld-secret' })
  })
})
