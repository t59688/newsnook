/**
 * Secret 的安全落盘：历史普通偏好里的密钥迁进 Keystore、普通存储只剩空串、
 * 冷启动回填后运行时仍拿得到明文，Web 行为保持不变。
 * 用法：npx tsx scripts/secure-secret-hydration.test.ts
 */
import assert from 'node:assert/strict'

import {
  createMemorySecureStore,
  secureSecretKey,
} from '../src/features/account/secureStore'
import {
  getRuntimeSecrets,
  hydrateRuntimeSecrets,
  migrateLegacyNativeSecretsOnce,
  persistRuntimeSecrets,
  resetRuntimeSecretsForTests,
  sanitizeForPersistence,
  setNativeSecretsForTests,
  withRuntimeSecrets,
} from '../src/features/account/secretStore'
import {
  PROXY_URL_SECRET_KEY,
  SECRET_FIELDS,
  applySecrets,
  collectSecrets,
  projectLocalState,
  stripSecrets,
  translationSecretKey,
} from '../src/features/sync/projection'
import { loadPreferences, savePreferences } from '../src/lib/storage'
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '../src/sources/preferences'
import { buildFreshInstallPresetsState } from '../src/sources/presets'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory })

console.log('Testing secure secret hydration...')

const OPENAI_KEY = 'sk-live-should-never-touch-disk'
const PROXY_URL = 'socks5://user:pass@proxy.example.test:1080'

function prefsWithSecrets(): Preferences {
  const base = normalizePreferences(DEFAULT_PREFERENCES)
  return {
    ...base,
    translation: {
      ...base.translation,
      cloud: {
        ...base.translation.cloud,
        openai: { ...base.translation.cloud.openai, apiKey: OPENAI_KEY },
      },
    },
    proxy: { ...base.proxy, proxyUrl: PROXY_URL },
  }
}

function reset(): void {
  memory.clear()
  resetRuntimeSecretsForTests()
}

// --- 纯函数：字段表 ----------------------------------------------------------

{
  const prefs = prefsWithSecrets()
  const collected = collectSecrets(prefs)
  assert.equal(collected[translationSecretKey('openai')], OPENAI_KEY)
  assert.equal(collected[PROXY_URL_SECRET_KEY], PROXY_URL)
  assert.equal(Object.keys(collected).length, 2, '空值不进结果')

  const stripped = stripSecrets(prefs)
  assert.equal(stripped.translation.cloud.openai.apiKey, '')
  assert.equal(stripped.proxy.proxyUrl, '')
  assert.equal(
    stripped.translation.cloud.openai.model,
    prefs.translation.cloud.openai.model,
    '净化只动密钥字段',
  )
  assert.equal(JSON.stringify(stripped).includes(OPENAI_KEY), false)

  const restored = applySecrets(stripped, collected)
  assert.deepEqual(restored, prefs, '回填后与原始偏好完全一致')

  const keys = SECRET_FIELDS.map((field) => field.key)
  assert.equal(new Set(keys).size, keys.length, '密钥名不重复')
}

// --- Android：迁移历史明文 ---------------------------------------------------

{
  reset()
  setNativeSecretsForTests(true)
  const store = createMemorySecureStore()

  // 旧版本留下的普通偏好里带着明文
  savePreferences(prefsWithSecrets())
  assert.ok(JSON.stringify(loadPreferences()).includes(OPENAI_KEY), '前置条件：旧数据确实带明文')

  await migrateLegacyNativeSecretsOnce(store)

  const persisted = JSON.stringify(loadPreferences())
  assert.equal(persisted.includes(OPENAI_KEY), false, '普通存储不再有 API Key')
  assert.equal(persisted.includes('proxy.example.test'), false, '普通存储不再有代理地址')
  assert.equal(await store.get(secureSecretKey(translationSecretKey('openai'))), OPENAI_KEY)
  assert.equal(await store.get(secureSecretKey(PROXY_URL_SECRET_KEY)), PROXY_URL)

  // 幂等：再跑一次没有可搬的值，也不会把 Keystore 里的值擦掉
  await migrateLegacyNativeSecretsOnce(store)
  assert.equal(await store.get(secureSecretKey(translationSecretKey('openai'))), OPENAI_KEY)

  // 冷启动回填：运行时偏好重新拿到明文
  await hydrateRuntimeSecrets(store)
  const runtime = withRuntimeSecrets(normalizePreferences(loadPreferences()))
  assert.equal(runtime.translation.cloud.openai.apiKey, OPENAI_KEY, '翻译运行时照常拿到密钥')
  assert.equal(runtime.proxy.proxyUrl, PROXY_URL, '代理运行时照常拿到地址')

  // 之后的每一次普通持久化仍然不带明文
  savePreferences(sanitizeForPersistence(runtime))
  assert.equal(JSON.stringify(loadPreferences()).includes(OPENAI_KEY), false)
}

// --- Keystore 写失败时不能丢用户的密钥 ---------------------------------------

{
  reset()
  setNativeSecretsForTests(true)
  const failing = {
    persistent: true,
    get: async () => null,
    set: async () => {
      throw new Error('keystore unavailable')
    },
    remove: async () => {},
  }

  savePreferences(prefsWithSecrets())
  await migrateLegacyNativeSecretsOnce(failing)
  assert.ok(
    JSON.stringify(loadPreferences()).includes(OPENAI_KEY),
    '搬不进 Keystore 就保留原状，绝不先删后写',
  )
}

// --- 用户新填/清空密钥 -------------------------------------------------------

{
  reset()
  setNativeSecretsForTests(true)
  const store = createMemorySecureStore()
  await hydrateRuntimeSecrets(store)

  const withKey = prefsWithSecrets()
  await persistRuntimeSecrets(withKey, store)
  assert.equal(await store.get(secureSecretKey(translationSecretKey('openai'))), OPENAI_KEY)
  assert.equal(getRuntimeSecrets()[PROXY_URL_SECRET_KEY], PROXY_URL)

  const cleared = stripSecrets(withKey)
  await persistRuntimeSecrets(cleared, store)
  assert.equal(
    await store.get(secureSecretKey(translationSecretKey('openai'))),
    null,
    '清空密钥连带删掉 Keystore 条目',
  )
  assert.deepEqual(getRuntimeSecrets(), {})
}

// --- 同步投影不受影响 --------------------------------------------------------

{
  const prefs = prefsWithSecrets()
  const projection = projectLocalState({
    prefs,
    enabledIds: [],
    presets: buildFreshInstallPresetsState(),
  })

  const translationSetting = projection['setting:translation']
  assert.ok(translationSetting)
  assert.equal(
    JSON.stringify(translationSetting.payload).includes(OPENAI_KEY),
    false,
    '普通设置实体里没有密钥',
  )
  assert.deepEqual(projection[`secret:${translationSecretKey('openai')}`]?.payload, {
    value: OPENAI_KEY,
  })
}

// --- Web：行为完全不变 -------------------------------------------------------

{
  reset()
  setNativeSecretsForTests(false)
  const store = createMemorySecureStore()

  const prefs = prefsWithSecrets()
  savePreferences(sanitizeForPersistence(prefs))
  assert.ok(
    JSON.stringify(loadPreferences()).includes(OPENAI_KEY),
    'Web 沿用既有存储，向后兼容',
  )

  await migrateLegacyNativeSecretsOnce(store)
  assert.equal(await store.get(secureSecretKey(PROXY_URL_SECRET_KEY)), null, 'Web 不做迁移')
  await persistRuntimeSecrets(prefs, store)
  assert.equal(await store.get(secureSecretKey(PROXY_URL_SECRET_KEY)), null, 'Web 不写安全存储')
  assert.deepEqual(withRuntimeSecrets(prefs), prefs, 'Web 不做回填')
}

setNativeSecretsForTests(null)

console.log('All secure secret hydration tests passed.')
