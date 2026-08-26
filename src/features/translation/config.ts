import type {
  CloudTranslationConfig,
  TranslationDisplayMode,
  TranslationLanguage,
  TranslationPrefs,
  TranslationProviderId,
  TranslationSourceLanguage,
} from './types'

export const TRANSLATION_LANGUAGES: {
  id: TranslationLanguage
  label: string
  shortLabel: string
}[] = [
  { id: 'en', label: '英语', shortLabel: 'EN' },
  { id: 'zh-Hans', label: '简体中文', shortLabel: '简中' },
  { id: 'zh-Hant', label: '繁体中文', shortLabel: '繁中' },
  { id: 'ja', label: '日语', shortLabel: '日本語' },
  { id: 'ko', label: '韩语', shortLabel: '한국어' },
  { id: 'fr', label: '法语', shortLabel: 'FR' },
  { id: 'de', label: '德语', shortLabel: 'DE' },
  { id: 'es', label: '西班牙语', shortLabel: 'ES' },
]

export const TRANSLATION_SOURCE_LANGUAGES: {
  id: TranslationSourceLanguage
  label: string
  shortLabel: string
}[] = [
  { id: 'auto', label: '自动检测', shortLabel: '自动' },
  ...TRANSLATION_LANGUAGES,
]

export const TRANSLATION_PROVIDERS: {
  id: TranslationProviderId
  label: string
  caption: string
}[] = [
  { id: 'mlkit', label: 'Android 本地翻译', caption: '语言包离线，无需密钥' },
  { id: 'bergamot', label: 'Bergamot 离线翻译', caption: '按语对下载，完全离线' },
  { id: 'google', label: 'Google Translate', caption: 'Cloud Translation' },
  { id: 'azure', label: 'Microsoft Translator', caption: 'Azure Translator' },
  { id: 'deepl', label: 'DeepL', caption: 'Free / Pro API' },
  { id: 'deeplx', label: 'DeepLX', caption: '自建服务' },
  { id: 'openai', label: 'AI 翻译', caption: '自备接口与密钥' },
]

const DEFAULT_CLOUD: TranslationPrefs['cloud'] = {
  google: {
    apiKey: '',
    endpoint: 'https://translation.googleapis.com/language/translate/v2',
  },
  azure: {
    apiKey: '',
    endpoint: 'https://api.cognitive.microsofttranslator.com/translate',
    region: '',
  },
  deepl: {
    apiKey: '',
    endpoint: 'https://api-free.deepl.com/v2/translate',
  },
  deeplx: {
    apiKey: '',
    endpoint: '',
    // 公共 DeepLX 服务按突发频率封禁，默认串行最稳妥；自建服务可自行调高
    concurrency: 1,
  },
  openai: {
    apiKey: '',
    endpoint: 'https://api.openai.com/v1',
    model: '',
    concurrency: 2,
  },
}

export const DEFAULT_TRANSLATION_PREFS: TranslationPrefs = {
  provider: 'mlkit',
  displayMode: 'replace',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
  translateFeed: true,
  cloud: DEFAULT_CLOUD,
}

const PROVIDER_IDS = new Set(TRANSLATION_PROVIDERS.map((provider) => provider.id))
const LANGUAGE_IDS = new Set(TRANSLATION_LANGUAGES.map((language) => language.id))
const SOURCE_LANGUAGE_IDS = new Set<TranslationSourceLanguage>([
  'auto',
  ...TRANSLATION_LANGUAGES.map((language) => language.id),
])
const DISPLAY_MODES = new Set<TranslationDisplayMode>(['compare', 'replace'])

function normalizeConcurrency(value: unknown, fallback: number): number {
  const fallbackSafe =
    Number.isInteger(fallback) && fallback >= 1 && fallback <= 10 ? fallback : 2
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return fallbackSafe
  }
  if (value < 1 || value > 10) return fallbackSafe
  return value
}

function normalizeCloud(
  value: unknown,
  fallback: CloudTranslationConfig,
): CloudTranslationConfig {
  const input = (value ?? {}) as Partial<CloudTranslationConfig>
  return {
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : fallback.apiKey,
    endpoint:
      typeof input.endpoint === 'string' && input.endpoint.trim()
        ? input.endpoint.trim()
        : fallback.endpoint,
    region: typeof input.region === 'string' ? input.region.trim() : fallback.region,
    model: typeof input.model === 'string' ? input.model.trim() : (fallback.model ?? ''),
    concurrency: normalizeConcurrency(input.concurrency, fallback.concurrency ?? 2),
  }
}

export function normalizeTranslationPrefs(value: unknown): TranslationPrefs {
  const input = (value ?? {}) as Partial<TranslationPrefs>
  const cloud = (input.cloud ?? {}) as Partial<TranslationPrefs['cloud']>
  const provider = PROVIDER_IDS.has(input.provider as TranslationProviderId)
    ? (input.provider as TranslationProviderId)
    : DEFAULT_TRANSLATION_PREFS.provider
  const sourceLanguage = SOURCE_LANGUAGE_IDS.has(input.sourceLanguage as TranslationSourceLanguage)
    ? (input.sourceLanguage as TranslationSourceLanguage)
    : DEFAULT_TRANSLATION_PREFS.sourceLanguage
  let targetLanguage = LANGUAGE_IDS.has(input.targetLanguage as TranslationLanguage)
    ? (input.targetLanguage as TranslationLanguage)
    : DEFAULT_TRANSLATION_PREFS.targetLanguage
  if (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
    targetLanguage = sourceLanguage === 'en' ? 'zh-Hans' : 'en'
  }
  const translateFeed =
    typeof input.translateFeed === 'boolean'
      ? input.translateFeed
      : DEFAULT_TRANSLATION_PREFS.translateFeed

  return {
    provider,
    displayMode: DISPLAY_MODES.has(input.displayMode as TranslationDisplayMode)
      ? (input.displayMode as TranslationDisplayMode)
      : DEFAULT_TRANSLATION_PREFS.displayMode,
    sourceLanguage,
    targetLanguage,
    translateFeed,
    cloud: {
      google: normalizeCloud(cloud.google, DEFAULT_CLOUD.google),
      azure: normalizeCloud(cloud.azure, DEFAULT_CLOUD.azure),
      deepl: normalizeCloud(cloud.deepl, DEFAULT_CLOUD.deepl),
      deeplx: normalizeCloud(cloud.deeplx, DEFAULT_CLOUD.deeplx),
      openai: normalizeCloud(cloud.openai, DEFAULT_CLOUD.openai),
    },
  }
}

export function translationProviderLabel(id: TranslationProviderId): string {
  return TRANSLATION_PROVIDERS.find((provider) => provider.id === id)?.label ?? id
}

export function translationLanguageLabel(id: TranslationSourceLanguage): string {
  return TRANSLATION_SOURCE_LANGUAGES.find((language) => language.id === id)?.label ?? id
}

export function translationDisplayModeLabel(mode: TranslationDisplayMode): string {
  return mode === 'compare' ? '对比翻译' : '全文替代'
}
