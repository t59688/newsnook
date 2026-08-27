/**
 * 环境解析：安全相关的值缺失或过短一律拒绝启动，不给「默认密钥」这种后门。
 */

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  password?: string
  from: string
}

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
}

export interface CloudConfig {
  port: number
  host: string
  databaseUrl: string
  betterAuthUrl: string
  betterAuthSecret: string
  /** base64 或 hex 编码的 32 字节数据加密主密钥，只用于 user_secrets */
  dataEncryptionKey: string
  clientOrigins: string[]
  google?: OAuthProviderConfig
  github?: OAuthProviderConfig
  smtp?: SmtpConfig
  /** 是否强制邮箱验证后才允许登录 */
  requireEmailVerification: boolean
  logLevel: string
  trustProxy: boolean
}

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>

function required(env: Env, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new ConfigError(`Missing required environment variable ${key}`)
  return value
}

function optional(env: Env, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function boolFlag(env: Env, key: string, fallback: boolean): boolean {
  const value = optional(env, key)
  if (value === undefined) return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function parsePort(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined) return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`${key} must be a valid TCP port`)
  }
  return port
}

/**
 * 主密钥必须正好 32 字节（AES-256）。支持 base64 与 hex 两种书写，
 * 这里只校验长度，实际解码在 crypto/secrets.ts。
 */
export function decodeEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim()
  const candidates: Buffer[] = []
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) candidates.push(Buffer.from(trimmed, 'hex'))
  try {
    candidates.push(Buffer.from(trimmed, 'base64'))
  } catch {
    // base64 解析失败时只剩 hex 候选
  }
  const key = candidates.find((buffer) => buffer.length === 32)
  if (!key) {
    throw new ConfigError(
      'NEWSNOOK_DATA_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)',
    )
  }
  return key
}

function parseOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  if (!origins.length) throw new ConfigError('CLIENT_ORIGINS must list at least one origin')
  for (const origin of origins) {
    if (origin === '*') throw new ConfigError('CLIENT_ORIGINS must not contain a wildcard')
    try {
      const url = new URL(origin)
      if (url.pathname !== '/' || url.search || url.hash) {
        throw new ConfigError(`CLIENT_ORIGINS entry ${origin} must be a bare origin`)
      }
    } catch (error) {
      if (error instanceof ConfigError) throw error
      throw new ConfigError(`CLIENT_ORIGINS entry ${origin} is not a valid origin URL`)
    }
  }
  return origins
}

function parseProvider(
  env: Env,
  idKey: string,
  secretKey: string,
): OAuthProviderConfig | undefined {
  const clientId = optional(env, idKey)
  const clientSecret = optional(env, secretKey)
  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) {
    throw new ConfigError(`${idKey} and ${secretKey} must be provided together`)
  }
  return { clientId, clientSecret }
}

function parseSmtp(env: Env): SmtpConfig | undefined {
  const host = optional(env, 'SMTP_HOST')
  if (!host) return undefined
  const from = optional(env, 'SMTP_FROM')
  if (!from) throw new ConfigError('SMTP_FROM is required when SMTP_HOST is set')
  const port = parsePort(optional(env, 'SMTP_PORT'), 587, 'SMTP_PORT')
  return {
    host,
    port,
    secure: boolFlag(env, 'SMTP_SECURE', port === 465),
    user: optional(env, 'SMTP_USER'),
    password: optional(env, 'SMTP_PASSWORD'),
    from,
  }
}

export function loadConfig(env: Env = process.env): CloudConfig {
  const betterAuthSecret = required(env, 'BETTER_AUTH_SECRET')
  if (betterAuthSecret.length < 32) {
    throw new ConfigError('BETTER_AUTH_SECRET must be at least 32 characters')
  }

  const dataEncryptionKey = required(env, 'NEWSNOOK_DATA_ENCRYPTION_KEY')
  decodeEncryptionKey(dataEncryptionKey)

  if (dataEncryptionKey.trim() === betterAuthSecret) {
    throw new ConfigError('NEWSNOOK_DATA_ENCRYPTION_KEY must differ from BETTER_AUTH_SECRET')
  }

  const betterAuthUrl = required(env, 'BETTER_AUTH_URL')
  try {
    // eslint-disable-next-line no-new
    new URL(betterAuthUrl)
  } catch {
    throw new ConfigError('BETTER_AUTH_URL must be an absolute URL')
  }

  return {
    port: parsePort(optional(env, 'PORT'), 8787, 'PORT'),
    host: optional(env, 'HOST') ?? '0.0.0.0',
    databaseUrl: required(env, 'DATABASE_URL'),
    betterAuthUrl,
    betterAuthSecret,
    dataEncryptionKey,
    clientOrigins: parseOrigins(required(env, 'CLIENT_ORIGINS')),
    google: parseProvider(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    github: parseProvider(env, 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'),
    smtp: parseSmtp(env),
    requireEmailVerification: boolFlag(env, 'REQUIRE_EMAIL_VERIFICATION', true),
    logLevel: optional(env, 'LOG_LEVEL') ?? 'info',
    trustProxy: boolFlag(env, 'TRUST_PROXY', true),
  }
}
