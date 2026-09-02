import type {
  AiModelSelection,
  AiPrefs,
  AiProviderConfig,
  CloudTranslationConfig,
  TranslationPrefs,
} from './types'

export type AiFeatureId = 'translation' | 'speedRead'

export const DEFAULT_AI_PROVIDER_ID = 'openai'
const DEFAULT_AI_ENDPOINT = 'https://api.openai.com/v1'
const DEFAULT_TRANSLATION_CONCURRENCY = 2
const AI_PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export const DEFAULT_AI_PREFS: AiPrefs = {
  providers: [
    {
      id: DEFAULT_AI_PROVIDER_ID,
      name: 'OpenAI',
      endpoint: DEFAULT_AI_ENDPOINT,
      apiKey: '',
    },
  ],
  translation: {
    providerId: DEFAULT_AI_PROVIDER_ID,
    model: '',
    concurrency: DEFAULT_TRANSLATION_CONCURRENCY,
  },
  speedRead: {
    providerId: DEFAULT_AI_PROVIDER_ID,
    model: '',
  },
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeConcurrency(value: unknown, fallback = DEFAULT_TRANSLATION_CONCURRENCY): number {
  const fallbackSafe =
    Number.isInteger(fallback) && fallback >= 1 && fallback <= 10
      ? fallback
      : DEFAULT_TRANSLATION_CONCURRENCY
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    return fallbackSafe
  }
  return parsed
}

function uniqueProviderId(raw: string, index: number, used: Set<string>): string {
  const preferred = AI_PROVIDER_ID_PATTERN.test(raw) ? raw : ''
  if (preferred && !used.has(preferred)) return preferred

  const base = index === 0 ? DEFAULT_AI_PROVIDER_ID : `provider-${index + 1}`
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function normalizeProvider(value: unknown, index: number, used: Set<string>): AiProviderConfig | null {
  const input = asRecord(value)
  const endpoint = text(input.endpoint)
  const rawId = text(input.id)
  const id = uniqueProviderId(rawId, index, used)
  used.add(id)

  const name = text(input.name) || (index === 0 ? 'OpenAI' : `AI 提供商 ${index + 1}`)
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  if (!endpoint && !name && !apiKey) return null
  return { id, name, endpoint, apiKey }
}

function legacyAiPrefs(legacyOpenAi: CloudTranslationConfig): AiPrefs {
  const endpoint = legacyOpenAi.endpoint.trim() || DEFAULT_AI_ENDPOINT
  const model = legacyOpenAi.model?.trim() ?? ''
  return {
    providers: [
      {
        id: DEFAULT_AI_PROVIDER_ID,
        name: 'OpenAI',
        endpoint,
        apiKey: legacyOpenAi.apiKey.trim(),
      },
    ],
    translation: {
      providerId: DEFAULT_AI_PROVIDER_ID,
      model,
      concurrency: normalizeConcurrency(legacyOpenAi.concurrency),
    },
    speedRead: {
      providerId: DEFAULT_AI_PROVIDER_ID,
      model,
    },
  }
}

function normalizeSelection(
  value: unknown,
  providers: AiProviderConfig[],
  fallbackModel: string,
): AiModelSelection {
  const input = asRecord(value)
  const requestedProviderId = text(input.providerId)
  const providerId = providers.some((provider) => provider.id === requestedProviderId)
    ? requestedProviderId
    : providers[0].id
  return {
    providerId,
    model: text(input.model) || fallbackModel,
  }
}

export function normalizeAiPrefs(value: unknown, legacyOpenAi: CloudTranslationConfig): AiPrefs {
  if (!value || typeof value !== 'object') return legacyAiPrefs(legacyOpenAi)

  const input = value as Partial<AiPrefs>
  const used = new Set<string>()
  const providers = Array.isArray(input.providers)
    ? input.providers
        .map((provider, index) => normalizeProvider(provider, index, used))
        .filter((provider): provider is AiProviderConfig => Boolean(provider))
    : []

  if (!providers.length) {
    providers.push({
      id: DEFAULT_AI_PROVIDER_ID,
      name: 'OpenAI',
      endpoint: legacyOpenAi.endpoint.trim() || DEFAULT_AI_ENDPOINT,
      apiKey: legacyOpenAi.apiKey.trim(),
    })
  }

  // Once the new `ai` object exists, its feature models are authoritative, including an
  // intentional empty value. Only configs that predate `ai` use the legacy model migration above.
  const translationBase = normalizeSelection(input.translation, providers, '')
  const translationInput = asRecord(input.translation)
  const speedRead = normalizeSelection(input.speedRead, providers, '')
  const legacyApiKey = legacyOpenAi.apiKey.trim()
  const selected = providers.find((provider) => provider.id === translationBase.providerId)
  if (legacyApiKey && selected && !selected.apiKey) selected.apiKey = legacyApiKey

  return {
    providers,
    translation: {
      ...translationBase,
      concurrency: normalizeConcurrency(
        translationInput.concurrency,
        DEFAULT_TRANSLATION_CONCURRENCY,
      ),
    },
    speedRead,
  }
}

export function aiProviderById(ai: AiPrefs, providerId: string): AiProviderConfig {
  return ai.providers.find((provider) => provider.id === providerId) ?? ai.providers[0]
}

export function resolveAiFeatureConfig(
  prefs: Pick<TranslationPrefs, 'ai'>,
  feature: AiFeatureId,
): CloudTranslationConfig {
  const selection = prefs.ai[feature]
  const provider = aiProviderById(prefs.ai, selection.providerId)
  return {
    endpoint: provider.endpoint,
    apiKey: provider.apiKey,
    model: selection.model,
    ...(feature === 'translation' ? { concurrency: prefs.ai.translation.concurrency } : {}),
  }
}

/**
 * Keep the legacy `cloud.openai` non-secret fields current so downgrade and old sync clients
 * can still use AI translation. The API key remains in the new provider/secret path only.
 */
export function withLegacyOpenAiMirror(prefs: TranslationPrefs): TranslationPrefs {
  const resolved = resolveAiFeatureConfig(prefs, 'translation')
  return {
    ...prefs,
    cloud: {
      ...prefs.cloud,
      openai: {
        ...prefs.cloud.openai,
        endpoint: resolved.endpoint,
        apiKey: '',
        model: resolved.model,
        concurrency: resolved.concurrency,
      },
    },
  }
}

let providerSequence = 0

export function createAiProviderId(existingIds: Iterable<string>): string {
  const existing = new Set(existingIds)
  providerSequence += 1
  const base = `provider-${Date.now().toString(36)}-${providerSequence.toString(36)}`
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
