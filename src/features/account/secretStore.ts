/**
 * Secret 的运行时保管。
 *
 * Android 上「同步范围内的 Secret」（翻译 API Key、AI Provider Key、代理地址）明文不允许留在
 * `newsnook:preferences` / Capacitor Preferences 里——那是普通 SharedPreferences，
 * 备份与调试工具都能读到。改成：
 *
 *   落盘  -> Keystore 加密（SecureStore）
 *   内存  -> 运行时 Preferences 照旧带明文，翻译/代理调用方零改动
 *   普通存储 -> 一律空串
 *
 * Web 不动：Session 由 HttpOnly Cookie 承担，浏览器里也没有等价的 Keystore，
 * 继续沿用既有的 `localStorage` 行为，保持向后兼容。
 */

import { Capacitor } from '@capacitor/core'

import { log } from '../../lib/logger'
import { loadPreferences, savePreferences } from '../../lib/storage'
import { normalizePreferences, type Preferences } from '../../sources/preferences'
import {
  LEGACY_OPENAI_SECRET_KEY,
  applyLegacyOpenAiSecretFallback,
  applySecrets,
  collectSecrets,
  secretFieldsFor,
  stripSecrets,
} from '../sync/projection'
import { getSecureStore, secureSecretKey, type SecureStore } from './secureStore'

let nativeOverride: boolean | null = null

/** 只有原生壳才做迁移/回填；Web 与 dev server 完全走老路径 */
export function secretsGoToSecureStore(): boolean {
  return nativeOverride ?? Capacitor.isNativePlatform()
}

/** 仅供测试：在 node 里模拟原生壳 */
export function setNativeSecretsForTests(value: boolean | null): void {
  nativeOverride = value
}

let runtimeSecrets: Record<string, string> = {}

/** 冷启动回填出来的明文；只在内存里，永远不落普通存储 */
export function getRuntimeSecrets(): Record<string, string> {
  return runtimeSecrets
}

/** 仅供测试：清掉进程内缓存 */
export function resetRuntimeSecretsForTests(): void {
  runtimeSecrets = {}
}

function legacyOpenAiMirrorValue(prefs: Preferences): string {
  const selected = prefs.translation.ai.providers.find(
    (provider) => provider.id === prefs.translation.ai.translation.providerId,
  )
  return selected?.apiKey ?? ''
}

function collectSecretsWithLegacyMirror(prefs: Preferences): Record<string, string> {
  const values = collectSecrets(prefs)
  const legacyValue = legacyOpenAiMirrorValue(prefs)
  // AI 翻译 Key 是旧 OpenAI secret 的镜像源；有值时覆盖写入，便于降级旧客户端。
  // AI 为空时不要删掉 collectSecrets 已读到的 cloud.openai.apiKey——历史明文迁移与
  // 尚未 normalize 的瞬时态仍靠旧字段进 Keystore。两边都空时该键本就不在 values 里，
  // persistRuntimeSecrets 仍会清掉对应 SecureStore 条目。
  if (legacyValue) values[LEGACY_OPENAI_SECRET_KEY] = legacyValue
  return values
}

/**
 * 历史版本把 API Key 直接写进了普通偏好。冷启动时搬一次家：
 * 读出来 -> 写进 Keystore -> 用空串重写普通偏好（同时镜像回原生 Preferences）。
 * 迁移只在有值时发生，天然幂等：搬完之后普通存储里就没有值可搬了。
 */
export async function migrateLegacyNativeSecretsOnce(
  store: SecureStore = getSecureStore(),
): Promise<void> {
  if (!secretsGoToSecureStore()) return

  const prefs = normalizePreferences(loadPreferences())
  const legacy = collectSecretsWithLegacyMirror(prefs)
  const keys = Object.keys(legacy)
  if (!keys.length) return

  try {
    await Promise.all(keys.map((key) => store.set(secureSecretKey(key), legacy[key]!)))
  } catch (error) {
    // 写不进 Keystore 就别删普通存储里的值，否则用户的密钥直接丢了
    log.account.warn('secret migration failed; keeping legacy values', { error })
    return
  }

  savePreferences(stripSecrets(prefs))
  log.account.info('migrated secrets into secure store', { count: keys.length })
}

/** 冷启动回填：根据已保存的 Provider id 动态读取 Keystore，供 App 挂载时合并进 Preferences */
export async function hydrateRuntimeSecrets(
  store: SecureStore = getSecureStore(),
): Promise<Record<string, string>> {
  if (!secretsGoToSecureStore()) return runtimeSecrets

  const prefs = normalizePreferences(loadPreferences())
  const values: Record<string, string> = {}
  await Promise.all(
    secretFieldsFor(prefs).map(async (field) => {
      const value = await store.get(secureSecretKey(field.key))
      if (value) values[field.key] = value
    }),
  )
  runtimeSecrets = values
  return values
}

/** 供 `usePreferences` 初始化：把回填到的明文合并进运行时偏好 */
export function withRuntimeSecrets(prefs: Preferences): Preferences {
  if (!secretsGoToSecureStore()) return prefs
  return applyLegacyOpenAiSecretFallback(applySecrets(prefs, runtimeSecrets), runtimeSecrets)
}

/**
 * 用户改了密钥、Provider、或同步下发了新值时调用：更新内存副本并写回 Keystore。
 * 清空/删除 Provider 会连带移除旧动态条目。旧 OpenAI secret 同步维护为 AI 翻译镜像，
 * 这样降级到旧客户端时仍能读取当前 AI 翻译 Key。
 */
export async function persistRuntimeSecrets(
  prefs: Preferences,
  store: SecureStore = getSecureStore(),
): Promise<void> {
  if (!secretsGoToSecureStore()) return

  const next = collectSecretsWithLegacyMirror(prefs)
  const keys = new Set([
    ...Object.keys(runtimeSecrets),
    ...secretFieldsFor(prefs).map((field) => field.key),
    LEGACY_OPENAI_SECRET_KEY,
  ])
  const changed: Promise<void>[] = []

  for (const key of keys) {
    const value = next[key] ?? ''
    if (value === (runtimeSecrets[key] ?? '')) continue
    changed.push(
      value ? store.set(secureSecretKey(key), value) : store.remove(secureSecretKey(key)),
    )
  }

  runtimeSecrets = next
  if (!changed.length) return

  try {
    await Promise.all(changed)
  } catch (error) {
    log.account.warn('secret persist failed', { error })
  }
}

/** 落盘前净化：原生上普通存储永远看不到 Secret 明文 */
export function sanitizeForPersistence(prefs: Preferences): Preferences {
  return secretsGoToSecureStore() ? stripSecrets(prefs) : prefs
}
