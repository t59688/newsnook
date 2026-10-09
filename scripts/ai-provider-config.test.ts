/**
 * AI Provider 配置：旧 OpenAI 配置迁移、多 Provider、翻译/速读独立模型解析。
 * 用法：npx tsx scripts/ai-provider-config.test.ts
 */
import assert from 'node:assert/strict'

import { resolveAiFeatureConfig } from '../src/features/translation/aiConfig'
import { normalizeTranslationPrefs } from '../src/features/translation/config'

console.log('Testing AI provider configuration...')

{
  const migrated = normalizeTranslationPrefs({
    provider: 'openai',
    cloud: {
      openai: {
        endpoint: 'https://legacy.example.test/v1',
        apiKey: 'legacy-key',
        model: 'legacy-model',
        concurrency: 4,
      },
    },
  })

  assert.equal(migrated.ai.providers.length, 1)
  assert.equal(migrated.ai.providers[0].endpoint, 'https://legacy.example.test/v1')
  assert.equal(migrated.ai.providers[0].apiKey, 'legacy-key')
  assert.equal(migrated.ai.translation.model, 'legacy-model')
  assert.equal(migrated.ai.translation.concurrency, 4)
  assert.equal(migrated.ai.speedRead.model, 'legacy-model')
  assert.equal(migrated.cloud.openai.apiKey, '', '旧 API Key 已迁到 AI Provider，不再双写普通配置')
}


{
  const hybrid = normalizeTranslationPrefs({
    cloud: {
      openai: {
        endpoint: 'https://legacy.example.test/v1',
        apiKey: 'legacy-key',
        model: 'legacy-translation-model',
      },
    },
    ai: {
      providers: [
        {
          id: 'translator',
          name: 'Translator',
          endpoint: 'https://translate.example.test/v1',
          apiKey: '',
        },
        {
          id: 'reader',
          name: 'Reader',
          endpoint: 'https://reader.example.test/v1',
          apiKey: 'reader-key',
        },
      ],
      translation: { providerId: 'translator', model: '', concurrency: 2 },
      speedRead: { providerId: 'reader', model: '' },
    },
  })

  assert.equal(hybrid.ai.providers[0].apiKey, 'legacy-key', '混合版本把旧 Key 兜底迁到当前 AI 翻译 Provider')
  assert.equal(hybrid.ai.translation.model, '', '新结构中的空翻译模型不能被旧镜像反灌')
  assert.equal(hybrid.ai.speedRead.model, '', 'AI 速读模型保持独立，不能被旧翻译模型覆盖')
}

{
  const prefs = normalizeTranslationPrefs({
    provider: 'openai',
    ai: {
      providers: [
        {
          id: 'translator',
          name: '翻译网关',
          endpoint: 'https://translate.example.test/v1',
          apiKey: 'translation-key',
        },
        {
          id: 'reader',
          name: '速读网关',
          endpoint: 'https://reader.example.test/v1',
          apiKey: 'reader-key',
        },
      ],
      translation: { providerId: 'translator', model: 'translation-model', concurrency: 3 },
      speedRead: { providerId: 'reader', model: 'speed-model' },
    },
  })

  assert.deepEqual(resolveAiFeatureConfig(prefs, 'translation'), {
    endpoint: 'https://translate.example.test/v1',
    apiKey: 'translation-key',
    model: 'translation-model',
    concurrency: 3,
  })
  assert.deepEqual(resolveAiFeatureConfig(prefs, 'speedRead'), {
    endpoint: 'https://reader.example.test/v1',
    apiKey: 'reader-key',
    model: 'speed-model',
  })
  assert.equal(prefs.cloud.openai.endpoint, 'https://translate.example.test/v1')
  assert.equal(prefs.cloud.openai.model, 'translation-model')
  assert.equal(prefs.cloud.openai.apiKey, '')
}

{
  const normalized = normalizeTranslationPrefs({
    ai: {
      providers: [
        { id: 'primary', name: 'Primary', endpoint: 'https://primary.example.test/v1', apiKey: '' },
      ],
      translation: { providerId: 'missing', model: 't', concurrency: 99 },
      speedRead: { providerId: 'missing', model: 's' },
    },
  })
  assert.equal(normalized.ai.translation.providerId, 'primary')
  assert.equal(normalized.ai.speedRead.providerId, 'primary')
  assert.equal(normalized.ai.translation.concurrency, 2, '非法并发回退默认值')
}

console.log('All AI provider configuration tests passed.')
