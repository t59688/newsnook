import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { mapConcurrent as sharedMapConcurrent } from '../../lib/asyncPool'
import { log } from '../../lib/logger'
import {
  BergamotTranslation,
  isBergamotTranslationAvailable,
  isLocalTranslationAvailable,
  MlKitTranslation,
} from './native'
import {
  assertOpenAiConfig,
  cleanOpenAiTranslation,
  extractOpenAiChatContent,
  OPENAI_TRANSLATION_STOP,
} from './openai'
import { openAiTranslationSystemPrompt, openAiTranslationUserPrompt } from './prompts'
import {
  deepLxBackoffMs,
  deepLxGate,
  deepLxThrottleConfig,
  parseRetryAfterMs,
  TranslationRateLimitError,
} from './rateLimit'
import type {
  CloudTranslationConfig,
  CloudTranslationProviderId,
  TranslationLanguage,
  TranslationProvider,
  TranslationProviderId,
  TranslationRequest,
  TranslationSourceLanguage,
} from './types'

const LANGUAGE_MAP: Record<
  TranslationProviderId,
  Record<TranslationLanguage, string>
> = {
  mlkit: {
    en: 'en',
    'zh-Hans': 'zh',
    'zh-Hant': 'zh',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
  },
  bergamot: {
    en: 'en',
    'zh-Hans': 'zh',
    'zh-Hant': 'zh',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
  },
  google: {
    en: 'en',
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
  },
  azure: {
    en: 'en',
    'zh-Hans': 'zh-Hans',
    'zh-Hant': 'zh-Hant',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
  },
  deepl: {
    en: 'EN',
    'zh-Hans': 'ZH-HANS',
    'zh-Hant': 'ZH-HANT',
    ja: 'JA',
    ko: 'KO',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
  },
  deeplx: {
    en: 'EN',
    'zh-Hans': 'ZH',
    'zh-Hant': 'ZH',
    ja: 'JA',
    ko: 'KO',
    fr: 'FR',
    de: 'DE',
    es: 'ES',
  },
  openai: {
    en: 'en',
    'zh-Hans': 'zh-CN',
    'zh-Hant': 'zh-TW',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
  },
}

function language(provider: TranslationProviderId, code: TranslationLanguage): string {
  return LANGUAGE_MAP[provider][code]
}

function requireConcreteSource(
  provider: TranslationProviderId,
  sourceLanguage: TranslationSourceLanguage,
): TranslationLanguage {
  if (sourceLanguage === 'auto') {
    throw new Error(`${provider} 需要具体原文语言，请先完成自动检测`)
  }
  return sourceLanguage
}

/** 云端 auto：省略原文语言字段，交给服务商识别。 */
function cloudSourceLanguage(
  provider: CloudTranslationProviderId,
  sourceLanguage: TranslationSourceLanguage,
): string | undefined {
  if (sourceLanguage === 'auto') return undefined
  return language(provider, sourceLanguage)
}

export function mlKitLanguage(code: TranslationLanguage): TranslationLanguage {
  return language('mlkit', code) as TranslationLanguage
}

function assertCloudConfig(
  config: CloudTranslationConfig,
  options?: { apiKeyOptional?: boolean },
): void {
  if (!options?.apiKeyOptional && !config.apiKey.trim()) throw new Error('请先填写 API Key')
  if (!config.endpoint.trim()) throw new Error('请先填写 API 地址')
  let parsed: URL
  try {
    parsed = new URL(config.endpoint)
  } catch {
    throw new Error('API 地址格式不正确')
  }
  if (parsed.protocol !== 'https:') throw new Error('为保护 API Key，API 地址必须使用 HTTPS')
}

function decodeHtmlEntities(value: string): string {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

interface JsonResponse {
  status: number
  data: unknown
  /** 响应头（键已转小写），用于读取 Retry-After 等限流提示 */
  headers: Record<string, string>
}

function lowercaseHeaderKeys(headers: Record<string, string> | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = String(value)
  }
  return result
}

/** CapacitorHttp 在部分 Content-Type 下把 JSON 当字符串返回；Web fetch 则已 parse。 */
export function coerceHttpJsonData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  const trimmed = data.trim()
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return data
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return data
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<JsonResponse> {
  if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
      data: body,
      connectTimeout: 15000,
      readTimeout: 45000,
    })
    return {
      status: response.status,
      data: coerceHttpJsonData(response.data),
      headers: lowercaseHeaderKeys(response.headers),
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
    body: JSON.stringify(body),
    signal,
  })
  const data = (await response.json().catch(() => null)) as unknown
  const responseHeaders: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value
  })
  return { status: response.status, data: coerceHttpJsonData(data), headers: responseHeaders }
}

function errorMessage(provider: string, response: JsonResponse): Error {
  const data = response.data as {
    error?: { message?: string; code?: string | number }
    message?: string
  } | null
  const detail = data?.error?.message ?? data?.message
  if (detail) {
    return new Error(`${provider}：${detail}`)
  }
  if (response.status === 429) {
    return new Error(
      `${provider}：触发速率限制（429 Too Many Requests），请求过于频繁，请稍候重试或在设置中降低并发。`,
    )
  }
  return new Error(`${provider} 请求失败（HTTP ${response.status}）`)
}

/**
 * 默认每批请求的最大段落数（设为 10 段，兼顾首屏快速响应、请求开销与逐段流式滚动）
 */
const DEFAULT_BATCH_ITEMS = 10

/**
 * 默认每批请求的最大字符数（避免单个超长文本撑大请求体）
 */
const DEFAULT_BATCH_CHARS = 6000

function normalizeOpenAiConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return 2
  if (value < 1 || value > 10) return 2
  return value
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  onItemDone?: (result: R, index: number) => void,
): Promise<R[]> {
  try {
    return await sharedMapConcurrent(items, concurrency, fn, signal, onItemDone)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DOMException('翻译已取消', 'AbortError')
    }
    throw error
  }
}

async function inBatches(
  texts: string[],
  maxItems: number,
  maxChars: number,
  translateBatch: (batch: string[]) => Promise<string[]>,
  signal?: AbortSignal,
  onBatch?: (batchTranslations: string[], startIndex: number) => void,
): Promise<string[]> {
  const result: string[] = []
  let batch: string[] = []
  let chars = 0

  const flush = async () => {
    if (!batch.length) return
    if (signal?.aborted) throw new DOMException('翻译已取消', 'AbortError')
    const currentStartIndex = result.length
    const currentBatch = batch
    batch = []
    chars = 0

    const translated = await translateBatch(currentBatch)
    if (translated.length !== currentBatch.length) throw new Error('翻译服务返回的段落数量不匹配')
    result.push(...translated)
    onBatch?.(translated, currentStartIndex)
  }

  for (const text of texts) {
    if (batch.length && (batch.length >= maxItems || chars + text.length > maxChars)) await flush()
    batch.push(text)
    chars += text.length
  }
  await flush()
  return result
}

export class MlKitProvider implements TranslationProvider {
  readonly id = 'mlkit' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    if (!isLocalTranslationAvailable()) throw new Error('当前安装包不包含 ML Kit 本地翻译')
    const sourceLanguage = requireConcreteSource(this.id, request.sourceLanguage)
    const response = await inBatches(
      request.texts,
      DEFAULT_BATCH_ITEMS,
      DEFAULT_BATCH_CHARS,
      async (texts) =>
        (
          await MlKitTranslation.translate({
            texts,
            sourceLanguage: language(this.id, sourceLanguage) as TranslationLanguage,
            targetLanguage: language(this.id, request.targetLanguage) as TranslationLanguage,
          })
        ).translations,
      request.signal,
      request.onBatch,
    )
    return response
  }
}

export class BergamotProvider implements TranslationProvider {
  readonly id = 'bergamot' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    if (!isBergamotTranslationAvailable()) {
      throw new Error('当前安装包不包含 Bergamot 离线翻译')
    }
    const engine = await BergamotTranslation.getEngineState()
    if (!engine.engineReady) {
      throw new Error(engine.engineError ?? 'Bergamot 引擎未就绪')
    }
    const sourceLanguage = requireConcreteSource(this.id, request.sourceLanguage)
    const response = await inBatches(
      request.texts,
      4,
      3000,
      async (texts) =>
        (
          await BergamotTranslation.translate({
            texts,
            sourceLanguage: language(this.id, sourceLanguage) as TranslationLanguage,
            targetLanguage: language(this.id, request.targetLanguage) as TranslationLanguage,
          })
        ).translations,
      request.signal,
      request.onBatch,
    )
    return response
  }
}

abstract class CloudProvider implements TranslationProvider {
  abstract readonly id: CloudTranslationProviderId
  protected readonly config: CloudTranslationConfig

  constructor(config: CloudTranslationConfig) {
    this.config = config
  }
  abstract translate(request: TranslationRequest): Promise<string[]>
}

export class GoogleProvider extends CloudProvider {
  readonly id = 'google' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    assertCloudConfig(this.config)
    const source = cloudSourceLanguage(this.id, request.sourceLanguage)
    return inBatches(
      request.texts,
      DEFAULT_BATCH_ITEMS,
      DEFAULT_BATCH_CHARS,
      async (texts) => {
        const response = await postJson(
          this.config.endpoint,
          {
            q: texts,
            ...(source ? { source } : {}),
            target: language(this.id, request.targetLanguage),
            format: 'text',
          },
          { 'X-Goog-Api-Key': this.config.apiKey.trim() },
          request.signal,
        )
        if (response.status < 200 || response.status >= 300) throw errorMessage('Google Translate', response)
        const data = response.data as { data?: { translations?: { translatedText?: string }[] } }
        return (data.data?.translations ?? []).map((item) =>
          decodeHtmlEntities(item.translatedText ?? ''),
        )
      },
      request.signal,
      request.onBatch,
    )
  }
}

export class AzureProvider extends CloudProvider {
  readonly id = 'azure' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    assertCloudConfig(this.config)
    const url = new URL(this.config.endpoint)
    url.searchParams.set('api-version', '3.0')
    const source = cloudSourceLanguage(this.id, request.sourceLanguage)
    if (source) url.searchParams.set('from', source)
    url.searchParams.set('to', language(this.id, request.targetLanguage))
    return inBatches(
      request.texts,
      DEFAULT_BATCH_ITEMS,
      DEFAULT_BATCH_CHARS,
      async (texts) => {
        const headers: Record<string, string> = {
          'Ocp-Apim-Subscription-Key': this.config.apiKey.trim(),
        }
        if (this.config.region?.trim()) {
          headers['Ocp-Apim-Subscription-Region'] = this.config.region.trim()
        }
        const response = await postJson(
          url.toString(),
          texts.map((text) => ({ Text: text })),
          headers,
          request.signal,
        )
        if (response.status < 200 || response.status >= 300) throw errorMessage('Microsoft Translator', response)
        const data = response.data as { translations?: { text?: string }[] }[]
        return Array.isArray(data)
          ? data.map((item) => item.translations?.[0]?.text ?? '')
          : []
      },
      request.signal,
      request.onBatch,
    )
  }
}

export class DeepLProvider extends CloudProvider {
  readonly id = 'deepl' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    assertCloudConfig(this.config)
    const sourceLang = cloudSourceLanguage(this.id, request.sourceLanguage)
    return inBatches(
      request.texts,
      DEFAULT_BATCH_ITEMS,
      DEFAULT_BATCH_CHARS,
      async (texts) => {
        const response = await postJson(
          this.config.endpoint,
          {
            text: texts,
            ...(sourceLang ? { source_lang: sourceLang } : {}),
            target_lang: language(this.id, request.targetLanguage),
          },
          { Authorization: `DeepL-Auth-Key ${this.config.apiKey.trim()}` },
          request.signal,
        )
        if (response.status < 200 || response.status >= 300) throw errorMessage('DeepL', response)
        const data = response.data as { translations?: { text?: string }[] }
        return (data.translations ?? []).map((item) => item.text ?? '')
      },
      request.signal,
      request.onBatch,
    )
  }
}

/**
 * 归一化 DeepLX 端点：路径未以 /translate 结尾时自动补全，
 * 兼容「https://api.deeplx.org/<token>」这类漏写 /translate 的路径令牌配置
 * （/v1/translate、/v2/translate 都以 /translate 结尾，不受影响）。
 */
function deepLxUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = /\/translate$/i.test(path) ? path : `${path}/translate`
  return url
}

function deepLxHeaders(apiKey: string): Record<string, string> {
  const token = apiKey.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

interface DeepLxResponse {
  code?: number
  data?: string
  message?: string
  translations?: { text?: string }[]
}

const DEEPLX_RATE_LIMIT_MESSAGE =
  'DeepLX：触发速率限制（429 Too Many Requests），已自动降速重试仍被限流。公共服务按令牌/IP 限频，请稍候再试；若频繁出现，可关闭「自动翻译外文标题」或改用自建服务。'

/**
 * /translate 单段模式的合并批上限。上游 DeepL 匿名接口对单次请求有约
 * 1500 字符的硬上限（新版 DeepLX 服务端直接 413 拒绝），留余量取 1200。
 */
const DEEPLX_JOIN_ITEMS = 10
const DEEPLX_JOIN_CHARS = 1200

/** 段内换行在 HTML 渲染中等价于空格；压平后才能用换行作为合并批的段落分隔符。 */
function flattenLineBreaks(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ')
}

/**
 * DeepLX 的免费端点与 DeepL 官方 API 不是同一协议：
 * `/translate` 一次接收一个字符串并从 `data` 返回译文；
 * `/v2/translate` 则兼容官方的数组请求与 `translations` 响应。
 *
 * 公共 DeepLX 网关按令牌配额限流、自建实例的上游按突发频率封 IP，
 * 请求「数量」比间隔更致命。因此 `/translate` 模式将多段文本按换行合并成
 * 一个请求（DeepLX 服务端整体透传给上游、换行结构原样保留，与主流客户端
 * 的批量方式一致），并且所有请求经过共享节流门；429 时退避重试并尊重
 * Retry-After，已知公共网关采用更保守的档位（更慢起步、更少重试）。
 */
export class DeepLXProvider extends CloudProvider {
  readonly id = 'deeplx' as const

  private async postThrottled(
    url: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<JsonResponse> {
    const gate = deepLxGate(url)
    const { maxRetries } = deepLxThrottleConfig(url)
    for (let attempt = 0; ; attempt += 1) {
      await gate.acquire(signal)
      const response = await postJson(url, body, deepLxHeaders(this.config.apiKey), signal)
      const data = response.data as DeepLxResponse | null
      const rateLimited =
        response.status === 429 ||
        (typeof data === 'object' && data !== null && data.code === 429)
      if (!rateLimited) return response
      const retryAfterMs = parseRetryAfterMs(response.headers['retry-after'])
      // 即便重试耗尽也上报冷却，让后续其它请求（信息流/测试连接）继续等待而非齐射
      gate.reportRateLimit(deepLxBackoffMs(attempt, retryAfterMs, url))
      if (attempt >= maxRetries) {
        throw new TranslationRateLimitError(DEEPLX_RATE_LIMIT_MESSAGE, retryAfterMs)
      }
    }
  }

  /** /translate 模式的单请求：一个字符串进、一个字符串出。 */
  private async translateSingle(
    url: string,
    text: string,
    sourceLang: string | undefined,
    targetLang: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.postThrottled(
      url,
      {
        text,
        ...(sourceLang ? { source_lang: sourceLang } : {}),
        target_lang: targetLang,
      },
      signal,
    )
    if (response.status < 200 || response.status >= 300) throw errorMessage('DeepLX', response)
    const data = response.data as DeepLxResponse
    if (typeof data.code === 'number' && data.code !== 200) {
      throw new Error(`DeepLX：${data.message ?? `服务返回错误码 ${data.code}`}`)
    }
    if (typeof data.data === 'string') return data.data
    const officialText = data.translations?.[0]?.text
    if (officialText) return officialText
    throw new Error('DeepLX 返回的数据格式不正确')
  }

  /**
   * 把一批文本按换行合并成一个 /translate 请求；译文按换行拆回。
   * 行数对不上时（上游偶发合并/拆分段落）回退为逐段请求，保证结果对齐。
   */
  private async translateJoinedBatch(
    url: string,
    texts: string[],
    sourceLang: string | undefined,
    targetLang: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const results = new Array<string>(texts.length).fill('')
    const sendIndexes: number[] = []
    const sendTexts: string[] = []
    texts.forEach((text, index) => {
      const flattened = flattenLineBreaks(text).trim()
      if (flattened) {
        sendIndexes.push(index)
        sendTexts.push(flattened)
      }
    })
    if (!sendTexts.length) return results

    if (sendTexts.length === 1) {
      results[sendIndexes[0]] = await this.translateSingle(
        url,
        sendTexts[0],
        sourceLang,
        targetLang,
        signal,
      )
      return results
    }

    const joined = await this.translateSingle(
      url,
      sendTexts.join('\n'),
      sourceLang,
      targetLang,
      signal,
    )
    let parts: string[] | null = joined.split('\n').map((part) => part.trim())
    if (parts.length !== sendTexts.length) {
      const nonEmpty = parts.filter((part) => part)
      parts = nonEmpty.length === sendTexts.length ? nonEmpty : null
    }
    if (parts) {
      parts.forEach((part, i) => {
        results[sendIndexes[i]] = part
      })
      return results
    }

    // 行数不匹配：逐段回退（仍经共享节流门限速）
    log.translation.warn('DeepLX joined batch line count mismatch, falling back to per-text requests')
    for (let i = 0; i < sendTexts.length; i += 1) {
      results[sendIndexes[i]] = await this.translateSingle(
        url,
        sendTexts[i],
        sourceLang,
        targetLang,
        signal,
      )
    }
    return results
  }

  async translate(request: TranslationRequest): Promise<string[]> {
    assertCloudConfig(this.config, { apiKeyOptional: true })
    const url = deepLxUrl(this.config.endpoint)
    const usesV2 = /\/v2\/translate\/?$/i.test(url.pathname)
    const sourceLang = cloudSourceLanguage(this.id, request.sourceLanguage)
    const targetLang = language(this.id, request.targetLanguage)

    if (usesV2) {
      return inBatches(
        request.texts,
        DEFAULT_BATCH_ITEMS,
        DEFAULT_BATCH_CHARS,
        async (texts) => {
          const response = await this.postThrottled(
            url.toString(),
            {
              text: texts,
              ...(sourceLang ? { source_lang: sourceLang } : {}),
              target_lang: targetLang,
            },
            request.signal,
          )
          if (response.status < 200 || response.status >= 300) throw errorMessage('DeepLX', response)
          const data = response.data as DeepLxResponse
          if (typeof data.code === 'number' && data.code !== 200) {
            throw new Error(`DeepLX：${data.message ?? `服务返回错误码 ${data.code}`}`)
          }
          return (data.translations ?? []).map((item) => item.text ?? '')
        },
        request.signal,
        request.onBatch,
      )
    }

    // 单段接口模式（/translate）：按换行把多段合并成一个请求、按批串行推进，
    // 请求数从「每段一发」降到「每批一发」，适配公共网关的令牌配额
    return inBatches(
      request.texts,
      DEEPLX_JOIN_ITEMS,
      DEEPLX_JOIN_CHARS,
      async (texts) =>
        this.translateJoinedBatch(url.toString(), texts, sourceLang, targetLang, request.signal),
      request.signal,
      request.onBatch,
    )
  }
}

export class OpenAiProvider extends CloudProvider {
  readonly id = 'openai' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    const base = assertOpenAiConfig(this.config)
    const model = this.config.model!.trim()
    const url = `${base}/chat/completions`
    const concurrency = normalizeOpenAiConcurrency(this.config.concurrency)

    if (request.textKinds != null && request.textKinds.length !== request.texts.length) {
      throw new Error('AI 翻译：textKinds 与 texts 长度不一致')
    }

    return mapConcurrent(
      request.texts,
      concurrency,
      async (text, index) => {
        const kind = request.textKinds?.[index] ?? 'paragraph'
        const system = openAiTranslationSystemPrompt(
          request.sourceLanguage,
          request.targetLanguage,
          kind,
          model,
        )
        const userPrompt = openAiTranslationUserPrompt(text, request.targetLanguage, kind, model)
        const messages: { role: 'system' | 'user'; content: string }[] = []
        if (system) messages.push({ role: 'system', content: system })
        messages.push({ role: 'user', content: userPrompt })
        const response = await postJson(
          url,
          {
            model,
            // Mid-low: fluent news prose without inventing proper-noun transliterations.
            temperature: 0.6,
            stream: false,
            stop: OPENAI_TRANSLATION_STOP,
            messages,
          },
          { Authorization: `Bearer ${this.config.apiKey.trim()}` },
          request.signal,
        )
        if (response.status < 200 || response.status >= 300) {
          throw errorMessage('AI 翻译', response)
        }
        const content = extractOpenAiChatContent(response.data)
        if (typeof content !== 'string' || !content.trim()) {
          throw new Error('AI 翻译：返回内容为空')
        }
        return cleanOpenAiTranslation(content)
      },
      request.signal,
      (singleTranslated, index) => {
        request.onBatch?.([singleTranslated], index)
      },
    )
  }
}

export function createTranslationProvider(
  providerId: TranslationProviderId,
  config?: CloudTranslationConfig,
): TranslationProvider {
  if (providerId === 'mlkit') return new MlKitProvider()
  if (providerId === 'bergamot') return new BergamotProvider()
  if (!config) throw new Error('翻译服务配置缺失')
  if (providerId === 'google') return new GoogleProvider(config)
  if (providerId === 'azure') return new AzureProvider(config)
  if (providerId === 'deepl') return new DeepLProvider(config)
  if (providerId === 'openai') return new OpenAiProvider(config)
  return new DeepLXProvider(config)
}
