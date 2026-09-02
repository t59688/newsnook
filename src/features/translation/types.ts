export type LocalTranslationProviderId = 'mlkit' | 'bergamot'

export type CloudTranslationProviderId = 'google' | 'azure' | 'deepl' | 'deeplx' | 'openai'

export type TranslationProviderId = LocalTranslationProviderId | CloudTranslationProviderId

export type TranslationDisplayMode = 'compare' | 'replace'

export type TranslationLanguage =
  | 'en'
  | 'zh-Hans'
  | 'zh-Hant'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'

/** 原文语言：`auto` 表示自动检测（云端交给 API；本地先客户端识别）。 */
export type TranslationSourceLanguage = 'auto' | TranslationLanguage

export interface CloudTranslationConfig {
  apiKey: string
  endpoint: string
  /** Azure 多服务或区域资源需要；全局 Translator 资源可留空。 */
  region?: string
  /** OpenAI 兼容提供商必填；其它云端可空。 */
  model?: string
  /** OpenAI 兼容及 DeepLX 单段模式并发；合法 1–10（DeepLX 建议 1–3），缺省 2。 */
  concurrency?: number
}

export interface AiProviderConfig {
  /** 稳定同步标识；用户改名称不会造成 Key 与功能选择错配。 */
  id: string
  name: string
  endpoint: string
  apiKey: string
}

export interface AiModelSelection {
  providerId: string
  model: string
}

export interface AiTranslationSelection extends AiModelSelection {
  concurrency: number
}

export interface AiPrefs {
  providers: AiProviderConfig[]
  translation: AiTranslationSelection
  speedRead: AiModelSelection
}

export interface TranslationPrefs {
  provider: TranslationProviderId
  displayMode: TranslationDisplayMode
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguage
  /** 是否自动翻译信息流（首页及各分类）中的外文标题与摘要 */
  translateFeed?: boolean
  cloud: Record<CloudTranslationProviderId, CloudTranslationConfig>
  /** OpenAI-compatible AI Provider，以及各 AI 功能独立的 Provider/Model 选择。 */
  ai: AiPrefs
}

export interface TranslatedFeedItem {
  articleId: string
  title: string
  summary?: string
  targetLanguage: TranslationLanguage
  translatedAt: number
}

/** AI 翻译文本场景；其它 provider 可忽略 */
export type TranslationTextKind = 'headline' | 'paragraph'

export interface TranslationRequest {
  texts: string[]
  sourceLanguage: TranslationSourceLanguage
  targetLanguage: TranslationLanguage
  /** 与 texts 等长；缺省时 OpenAI 按 paragraph 处理 */
  textKinds?: TranslationTextKind[]
  signal?: AbortSignal
  onBatch?: (batchTranslations: string[], startIndex: number) => void
}

export interface TranslationProvider {
  readonly id: TranslationProviderId
  translate(request: TranslationRequest): Promise<string[]>
}

export interface TranslatedArticleContent {
  title: string
  html: string
  /** 实际用于翻译的原文语言（auto 解析后）；云端 auto 时可能仍为 auto */
  resolvedSourceLanguage?: TranslationSourceLanguage
  /** 本地检测置信不足或不支持时已回退英语 */
  usedFallback?: boolean
}

export interface TranslationProgress {
  completed: number
  total: number
}

export interface TranslateArticleOptions {
  signal?: AbortSignal
  onProgress?: (progress: TranslationProgress) => void
  onPartial?: (content: TranslatedArticleContent) => void
}

export function isLocalTranslationProviderId(
  id: TranslationProviderId,
): id is LocalTranslationProviderId {
  return id === 'mlkit' || id === 'bergamot'
}

