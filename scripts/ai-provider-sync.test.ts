/**
 * AI Provider 同步：普通设置不含 Key，动态 Secret 使用稳定 Provider id，
 * 翻译与速读的独立 Provider/Model 往返后保持一致。
 * 用法：npm run build:contracts && npx tsx scripts/ai-provider-sync.test.ts
 */
import assert from 'node:assert/strict'

import type { SyncRecord } from '@newsnook/contracts'

import { resolveAiFeatureConfig } from '../src/features/translation/aiConfig'
import { applyRemoteRecords, type LocalRuntimeState } from '../src/features/sync/merge'
import {
  LEGACY_OPENAI_SECRET_KEY,
  SETTING_KEYS,
  aiProviderSecretKey,
  projectLocalState,
} from '../src/features/sync/projection'
import { entityKey } from '../src/features/sync/types'
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/sources/preferences'
import { buildFreshInstallPresetsState } from '../src/sources/presets'

console.log('Testing AI provider sync...')

function stateWithProviders(): LocalRuntimeState {
  const base = normalizePreferences(DEFAULT_PREFERENCES)
  return {
    prefs: normalizePreferences({
      ...base,
      translation: {
        ...base.translation,
        provider: 'openai',
        ai: {
          providers: [
            {
              id: 'translator',
              name: '翻译网关',
              endpoint: 'https://translate.example.test/v1',
              apiKey: 'translation-secret',
            },
            {
              id: 'reader',
              name: '速读网关',
              endpoint: 'https://reader.example.test/v1',
              apiKey: 'reader-secret',
            },
          ],
          translation: { providerId: 'translator', model: 'translation-model', concurrency: 3 },
          speedRead: { providerId: 'reader', model: 'speed-model' },
        },
      },
    }),
    enabledIds: [],
    presets: buildFreshInstallPresetsState(),
  }
}

function recordsFrom(state: LocalRuntimeState): SyncRecord[] {
  return Object.values(projectLocalState(state)).map((entity, index) => ({
    entityType: entity.entityType,
    entityId: entity.entityId,
    revision: index + 1,
    deleted: false,
    updatedAt: 0,
    payload: entity.payload,
  }))
}

const source = stateWithProviders()
const projection = projectLocalState(source)
const setting = projection[entityKey('setting', SETTING_KEYS.translation)]
assert.ok(setting)
const serialized = JSON.stringify(setting.payload)
assert.equal(serialized.includes('translation-secret'), false)
assert.equal(serialized.includes('reader-secret'), false)
assert.ok(serialized.includes('translation-model'))
assert.ok(serialized.includes('speed-model'))

assert.deepEqual(projection[entityKey('secret', aiProviderSecretKey('translator'))]?.payload, {
  value: 'translation-secret',
})
assert.deepEqual(projection[entityKey('secret', aiProviderSecretKey('reader'))]?.payload, {
  value: 'reader-secret',
})
assert.deepEqual(projection[entityKey('secret', LEGACY_OPENAI_SECRET_KEY)]?.payload, {
  value: 'translation-secret',
})

const fresh: LocalRuntimeState = {
  prefs: normalizePreferences(DEFAULT_PREFERENCES),
  enabledIds: [],
  presets: buildFreshInstallPresetsState(),
}
const restored = applyRemoteRecords(fresh, recordsFrom(source))

assert.deepEqual(resolveAiFeatureConfig(restored.prefs.translation, 'translation'), {
  endpoint: 'https://translate.example.test/v1',
  apiKey: 'translation-secret',
  model: 'translation-model',
  concurrency: 3,
})
assert.deepEqual(resolveAiFeatureConfig(restored.prefs.translation, 'speedRead'), {
  endpoint: 'https://reader.example.test/v1',
  apiKey: 'reader-secret',
  model: 'speed-model',
})


const oldClientChanged = applyRemoteRecords(restored, [
  {
    entityType: 'secret',
    entityId: LEGACY_OPENAI_SECRET_KEY,
    revision: 10_000,
    deleted: false,
    updatedAt: 0,
    payload: { value: 'changed-by-old-client' },
  },
])
assert.equal(
  resolveAiFeatureConfig(oldClientChanged.prefs.translation, 'translation').apiKey,
  'changed-by-old-client',
  '旧客户端更新 legacy OpenAI Key 时，新客户端应迁移到当前 AI 翻译 Provider',
)

const oldClientCleared = applyRemoteRecords(oldClientChanged, [
  {
    entityType: 'secret',
    entityId: LEGACY_OPENAI_SECRET_KEY,
    revision: 10_001,
    deleted: true,
    updatedAt: 0,
    payload: {},
  },
])
assert.equal(
  resolveAiFeatureConfig(oldClientCleared.prefs.translation, 'translation').apiKey,
  '',
  '旧客户端清空 legacy OpenAI Key 时，新客户端也应清空当前 AI 翻译 Provider Key',
)

console.log('All AI provider sync tests passed.')
