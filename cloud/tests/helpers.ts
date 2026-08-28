/**
 * 测试基建：真实 PostgreSQL（`TEST_DATABASE_URL`）+ Fastify inject。
 * 没有提供数据库时相关用例显式跳过，本地不装 PostgreSQL 也能跑通纯函数测试。
 */

import { randomUUID } from 'node:crypto'

import type { FastifyInstance } from 'fastify'
import { Pool } from 'pg'

import { buildApp } from '../src/app.js'
import type { CloudConfig } from '../src/config.js'
import { createPools, type CloudPools } from '../src/db/pools.js'
import { runMigrations } from '../src/db/migrate.js'
import { createMemoryMailer, type MemoryMailer } from '../src/mail.js'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? ''
export const databaseAvailable = TEST_DATABASE_URL.length > 0
export const skipWithoutDatabase = databaseAvailable
  ? false
  : 'TEST_DATABASE_URL is not set; skipping PostgreSQL-backed tests'

/** 32 字节全零以外的固定测试密钥；只在测试里出现，不是任何生产值 */
const TEST_ENCRYPTION_KEY = Buffer.from(
  '6e6577736e6f6f6b2d746573742d646174612d6b65792d33322d627974657321',
  'hex',
).toString('base64')

export function testConfig(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: TEST_DATABASE_URL || 'postgres://localhost/unused',
    betterAuthUrl: 'http://127.0.0.1:8787',
    betterAuthSecret: 'test-better-auth-secret-value-0123456789',
    dataEncryptionKey: TEST_ENCRYPTION_KEY,
    clientOrigins: ['http://127.0.0.1:5173'],
    requireEmailVerification: true,
    emailSignUpEnabled: true,
    logLevel: 'silent',
    trustProxy: false,
    ...overrides,
  }
}

let migrated = false

export async function ensureMigrated(): Promise<void> {
  if (migrated || !databaseAvailable) return
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 })
  try {
    await runMigrations(pool)
    migrated = true
  } finally {
    await pool.end()
  }
}

const BUSINESS_TABLES = [
  'sync_conflicts',
  'sync_mutations',
  'sync_heads',
  'subscriptions',
  'categories',
  'user_settings',
  'user_secrets',
  'devices',
]

const AUTH_TABLES = ['auth."session"', 'auth."account"', 'auth."verification"', 'auth."user"']

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`)
  await pool.query(`TRUNCATE ${AUTH_TABLES.join(', ')} CASCADE`)
}

export interface TestCloud {
  app: FastifyInstance
  pools: CloudPools
  mailer: MemoryMailer
  config: CloudConfig
  close: () => Promise<void>
}

export async function startTestCloud(
  overrides: Partial<CloudConfig> = {},
): Promise<TestCloud> {
  await ensureMigrated()
  const config = testConfig(overrides)
  const pools = createPools(config)
  await resetDatabase(pools.app)

  const mailer = createMemoryMailer()
  const { app } = await buildApp({ config, pools, mailer })
  await app.ready()

  return {
    app,
    pools,
    mailer,
    config,
    close: async () => {
      await app.close()
      await pools.close()
    },
  }
}

// ---------------------------------------------------------------- auth 辅助

export interface SignedInUser {
  email: string
  password: string
  userId: string
  cookie: string
  bearerToken: string | null
  deviceId: string
}

function collectCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return ''
  const list = Array.isArray(setCookie) ? setCookie : [setCookie]
  return list.map((entry) => entry.split(';')[0]).join('; ')
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`
}

/** 直接把邮箱标记为已验证：验证链接本身在 auth 测试里单独覆盖 */
export async function markEmailVerified(pools: CloudPools, email: string): Promise<void> {
  await pools.app.query('UPDATE auth."user" SET "emailVerified" = true WHERE email = $1', [email])
}

export async function signUp(
  cloud: TestCloud,
  email: string,
  password = 'correct-horse-battery-staple',
): Promise<void> {
  const response = await cloud.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password, name: email.split('@')[0] },
    headers: { 'content-type': 'application/json' },
  })
  if (response.statusCode >= 400) {
    throw new Error(`sign-up failed: ${response.statusCode} ${response.body}`)
  }
}

export async function signIn(
  cloud: TestCloud,
  email: string,
  password = 'correct-horse-battery-staple',
): Promise<{ cookie: string; bearerToken: string | null; statusCode: number; body: string }> {
  const response = await cloud.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    payload: { email, password },
    headers: { 'content-type': 'application/json' },
  })
  return {
    cookie: collectCookies(response.headers['set-cookie'] as string | string[] | undefined),
    bearerToken: (response.headers['set-auth-token'] as string | undefined) ?? null,
    statusCode: response.statusCode,
    body: response.body,
  }
}

export async function createSignedInUser(
  cloud: TestCloud,
  prefix = 'user',
): Promise<SignedInUser> {
  const email = uniqueEmail(prefix)
  const password = 'correct-horse-battery-staple'
  await signUp(cloud, email, password)
  await markEmailVerified(cloud.pools, email)
  const session = await signIn(cloud, email, password)
  if (session.statusCode >= 400) {
    throw new Error(`sign-in failed: ${session.statusCode} ${session.body}`)
  }

  const { rows } = await cloud.pools.app.query<{ id: string }>(
    'SELECT id FROM auth."user" WHERE email = $1',
    [email],
  )

  return {
    email,
    password,
    userId: rows[0]!.id,
    cookie: session.cookie,
    bearerToken: session.bearerToken,
    deviceId: randomUUID(),
  }
}

export function authHeaders(user: SignedInUser): Record<string, string> {
  return {
    cookie: user.cookie,
    'content-type': 'application/json',
    'x-newsnook-device': user.deviceId,
  }
}
