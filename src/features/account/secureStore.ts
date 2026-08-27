/**
 * 安全存储边界。
 *
 * Android：AndroidKeyStore AES-GCM 加密后落私有 SharedPreferences，
 * 长期 Session token 与同步下来的 Secret 明文都只走这里，
 * 绝不写进 `newsnook:` 前缀的普通存储或 Capacitor Preferences。
 *
 * Web：Session 由 HttpOnly Cookie 承担，没有需要客户端保管的长期凭证，
 * 因此退化成进程内内存实现——宁可刷新后重新走一次 Cookie 校验，
 * 也不把凭证写进 `localStorage`。
 */

import { log } from '../../lib/logger'
import { SecureStoreNative, isSecureStoreAvailable } from './native'

export interface SecureStore {
  /** 是否落盘：内存实现为 false，调用方据此决定要不要做迁移/回填 */
  readonly persistent: boolean
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** SecureStore 里的键；`secret.` 前缀留给同步下来的 Secret 明文 */
export const SECURE_KEYS = {
  session: 'account.session',
  secretPrefix: 'secret.',
} as const

export function secureSecretKey(secretKey: string): string {
  return `${SECURE_KEYS.secretPrefix}${secretKey}`
}

export function createMemorySecureStore(): SecureStore {
  const entries = new Map<string, string>()
  return {
    persistent: false,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => {
      entries.set(key, value)
    },
    remove: async (key) => {
      entries.delete(key)
    },
  }
}

function createNativeSecureStore(): SecureStore {
  return {
    persistent: true,
    get: async (key) => {
      try {
        const result = await SecureStoreNative.get({ key })
        return result?.value ?? null
      } catch (error) {
        // Keystore 可能因系统升级/生物识别变更而失效：当作没有值，让用户重新登录
        log.account.warn('secure store read failed', { key, error })
        return null
      }
    },
    set: async (key, value) => {
      await SecureStoreNative.set({ key, value })
    },
    remove: async (key) => {
      try {
        await SecureStoreNative.remove({ key })
      } catch (error) {
        log.account.warn('secure store remove failed', { key, error })
      }
    },
  }
}

let shared: SecureStore | null = null

export function getSecureStore(): SecureStore {
  if (!shared) shared = isSecureStoreAvailable() ? createNativeSecureStore() : createMemorySecureStore()
  return shared
}

/** 仅供测试：重置进程内单例 */
export function resetSecureStoreForTests(store: SecureStore | null = null): void {
  shared = store
}

export interface StoredSession {
  token: string
  /** 服务端给出的过期时间戳；0 表示未知，仍然尝试使用 */
  expiresAt: number
  userId: string
}

export async function readStoredSession(store: SecureStore): Promise<StoredSession | null> {
  const raw = await store.get(SECURE_KEYS.session)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>
    if (typeof parsed?.token !== 'string' || !parsed.token) return null
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0
    if (expiresAt > 0 && expiresAt <= Date.now()) return null
    return { token: parsed.token, expiresAt, userId: typeof parsed.userId === 'string' ? parsed.userId : '' }
  } catch {
    return null
  }
}

export async function writeStoredSession(store: SecureStore, session: StoredSession): Promise<void> {
  await store.set(SECURE_KEYS.session, JSON.stringify(session))
}

export async function clearStoredSession(store: SecureStore): Promise<void> {
  await store.remove(SECURE_KEYS.session)
}
