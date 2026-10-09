import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { mapConcurrent as sharedMapConcurrent } from '../../lib/asyncPool'
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
import type {
  CloudTranslationConfig,
  CloudTranslationProviderId,
  TranslationLanguage,
  TranslationProvider,
  TranslationProviderId,
  TranslationRequest,
  TranslationSourceLanguage,
  TranslationTextKind,
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
}

interface PostJsonOptions {
  readTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_READ_TIMEOUT_MS = 45_000
const OPENAI_READ_TIMEOUT_MS = 120_000
const OPENAI_MAX_ATTEMPTS = 2
const OPENAI_RETRY_DELAY_MS = 600

function abortError(message = '翻译已取消'): DOMException {
  return new DOMException(message, 'AbortError')
}

function timeoutError(timeoutMs: number): DOMException {
  return new DOMException(`请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回`, 'TimeoutError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) throw abortError()

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
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
  options?: PostJsonOptions,
): Promise<JsonResponse> {
  if (signal?.aborted) throw abortError()
  const readTimeoutMs = options?.readTimeoutMs

  if (Capacitor.isNativePlatform()) {
    const response = await raceAbort(
      CapacitorHttp.post({
        url,
        headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
        data: body,
        connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
        readTimeout: readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
      }),
      signal,
    )
    return { status: response.status, data: coerceHttpJsonData(response.data) }
  }

  if (readTimeoutMs == null) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
      body: JSON.stringify(body),
      signal,
    })
    const data = (await response.json().catch(() => null)) as unknown
    return { status: response.status, data: coerceHttpJsonData(data) }
  }

  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, readTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const data = (await response.json().catch(() => null)) as unknown
    return { status: response.status, data: coerceHttpJsonData(data) }
  } catch (error) {
    if (signal?.aborted) throw abortError()
    if (timedOut) throw timeoutError(readTimeoutMs)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
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

function normalizeDeepLxConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return 2
  if (value < 1 || value > 5) return 2
  return value
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('翻译已取消', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new DOMException('翻译已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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

interface ConcurrentFailure {
  index: number
  error: unknown
}

/**
 * AI 长文翻译专用：单段失败不打断其它 worker，尽量完成剩余段落后再汇总报错。
 * 已成功项仍通过 onItemDone 逐段提交，因此 Reader 可以保留已完成译文。
 */
async function mapConcurrentBestEffort<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  onItemDone?: (result: R, index: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const failures: ConcurrentFailure[] = []
  let nextIndex = 0
  const limit = Math.max(1, concurrency)

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) return
      const currentIndex = nextIndex++
      try {
        const result = await fn(items[currentIndex], currentIndex)
        results[currentIndex] = result
        onItemDone?.(result, currentIndex)
      } catch (error) {
        if (isAbortError(error) || signal?.aborted) return
        failures.push({ index: currentIndex, error })
      }
    }
  })

  await Promise.all(workers)
  if (signal?.aborted) throw abortError()

  if (failures.length > 0) {
    failures.sort((a, b) => a.index - b.index)
    const first = failures[0].error
    const detail = first instanceof Error ? first.message : 'AI 翻译请求失败'
    const completed = items.length - failures.length
    throw new Error(
      `${detail}（已完成 ${completed}/${items.length} 段，${failures.length} 段失败；已完成内容已保留。）`,
    )
  }

  return results
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

function deepLxUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/translate'
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

/**
 * DeepLX 的免费端点与 DeepL 官方 API 不是同一协议：
 * `/translate` 一次接收一个字符串并从 `data` 返回译文；
 * `/v2/translate` 则兼容官方的数组请求与 `translations` 响应。
 */
export class DeepLXProvider extends CloudProvider {
  readonly id = 'deeplx' as const

  async translate(request: TranslationRequest): Promise<string[]> {
    assertCloudConfig(this.config, { apiKeyOptional: true })
    const url = deepLxUrl(this.config.endpoint)
    const usesV2 = /\/v2\/translate\/?$/i.test(url.pathname)
    const sourceLang = cloudSourceLanguage(this.id, request.sourceLanguage)

    if (usesV2) {
      return inBatches(
        request.texts,
        DEFAULT_BATCH_ITEMS,
        DEFAULT_BATCH_CHARS,
        async (texts) => {
          const response = await postJson(
            url.toString(),
            {
              text: texts,
              ...(sourceLang ? { source_lang: sourceLang } : {}),
              target_lang: language(this.id, request.targetLanguage),
            },
            deepLxHeaders(this.config.apiKey),
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

    // 单段请求接口模式（/translate）：以滚动窗口按配置并发（1~5，默认 2）处理，配合错峰节流与 429 退避重试
    const concurrency = normalizeDeepLxConcurrency(this.config.concurrency)
    // 同一次调用内相同文本只发一次请求（正文里重复的 caption/短语共享在途结果）
    const inflightByText = new Map<string, Promise<string>>()
    const translateSingle = async (text: string, index: number): Promise<string> => {
      // 请求前平滑错峰：错开并发请求（每段间隔 120ms）
      if (index > 0) {
        await sleep(120, request.signal)
      }

      const sendSingleRequest = async (): Promise<{ is429: boolean; text?: string; error?: Error }> => {
        const response = await postJson(
          url.toString(),
          {
            text,
            ...(sourceLang ? { source_lang: sourceLang } : {}),
            target_lang: language(this.id, request.targetLanguage),
          },
          deepLxHeaders(this.config.apiKey),
          request.signal,
        )
        if (response.status === 429) {
          return {
            is429: true,
            error: new Error('DeepLX：触发速率限制（429 Too Many Requests），请求过于频繁，请稍候重试或在设置中降低并发。'),
          }
        }
        if (response.status < 200 || response.status >= 300) throw errorMessage('DeepLX', response)
        const data = response.data as DeepLxResponse
        if (typeof data.code === 'number' && data.code !== 200) {
          if (data.code === 429) {
            return {
              is429: true,
              error: new Error('DeepLX：触发速率限制（429 Too Many Requests），请求过于频繁，请稍候重试或在设置中降低并发。'),
            }
          }
          throw new Error(`DeepLX：${data.message ?? `服务返回错误码 ${data.code}`}`)
        }
        if (typeof data.data === 'string') return { is429: false, text: data.data }
        const officialText = data.translations?.[0]?.text
        if (officialText) return { is429: false, text: officialText }
        throw new Error('DeepLX 返回的数据格式不正确')
      }

      let res = await sendSingleRequest()
      if (res.is429) {
        // 遭遇 429 速率限制时，自动等待 1.2 秒进行一次退避重试
        await sleep(1200, request.signal)
        res = await sendSingleRequest()
        if (res.is429) {
          throw res.error ?? new Error('DeepLX：触发速率限制（429 Too Many Requests）')
        }
      }
      return res.text ?? ''
    }

    return mapConcurrent(
      request.texts,
      concurrency,
      (text, index) => {
        let pending = inflightByText.get(text)
        if (!pending) {
          pending = translateSingle(text, index)
          inflightByText.set(text, pending)
        }
        return pending
      },
      request.signal,
      (singleTranslated, index) => {
        request.onBatch?.([singleTranslated], index)
      },
    )
  }
}

/** 单个 OpenAiProvider 实例最多记住多少段成功译文（约两篇长文） */
const OPENAI_COMPLETED_CACHE_LIMIT = 256

export class OpenAiProvider extends CloudProvider {
  readonly id = 'openai' as const
  /**
   * 本实例已成功的段落译文。长文里个别段落失败后用户点「重试」，
   * 只需补失败段，不必把整篇再发一遍。Reader 复用同一实例；
   * 设置页「测试 AI 翻译」每次新建实例，不受影响。
   */
  private readonly completed = new Map<string, string>()

  private remember(key: string, value: string): void {
    this.completed.delete(key)
    this.completed.set(key, value)
    if (this.completed.size > OPENAI_COMPLETED_CACHE_LIMIT) {
      const oldest = this.completed.keys().next().value
      if (oldest !== undefined) this.completed.delete(oldest)
    }
  }

  async translate(request: TranslationRequest): Promise<string[]> {
    const base = assertOpenAiConfig(this.config)
    const model = this.config.model!.trim()
    const url = `${base}/chat/completions`
    const concurrency = normalizeOpenAiConcurrency(this.config.concurrency)

    if (request.textKinds != null && request.textKinds.length !== request.texts.length) {
      throw new Error('AI 翻译：textKinds 与 texts 长度不一致')
    }

    // 同一次调用内「语向 + 场景 + 文本」相同的段落只发一次请求，重复段共享在途结果
    const inflightByKey = new Map<string, Promise<string>>()
    const cacheKey = (text: string, kind: TranslationTextKind) =>
      `${request.sourceLanguage}\u0000${request.targetLanguage}\u0000${kind}\u0000${text}`
    const translateSingle = async (text: string, kind: TranslationTextKind): Promise<string> => {
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

      let lastError: unknown
      for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
        let response: JsonResponse
        try {
          response = await postJson(
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
            { readTimeoutMs: OPENAI_READ_TIMEOUT_MS },
          )
        } catch (error) {
          if (isAbortError(error) || request.signal?.aborted) throw abortError()
          lastError = error
          if (attempt >= OPENAI_MAX_ATTEMPTS) throw error
          await sleep(OPENAI_RETRY_DELAY_MS * attempt, request.signal)
          continue
        }

        if (response.status < 200 || response.status >= 300) {
          const error = errorMessage('AI 翻译', response)
          const retryable = response.status === 429 || response.status >= 500
          if (retryable && attempt < OPENAI_MAX_ATTEMPTS) {
            lastError = error
            await sleep(OPENAI_RETRY_DELAY_MS * attempt, request.signal)
            continue
          }
          throw error
        }

        const content = extractOpenAiChatContent(response.data)
        if (typeof content !== 'string' || !content.trim()) {
          const error = new Error('AI 翻译：返回内容为空')
          lastError = error
          if (attempt < OPENAI_MAX_ATTEMPTS) {
            await sleep(OPENAI_RETRY_DELAY_MS * attempt, request.signal)
            continue
          }
          throw error
        }
        return cleanOpenAiTranslation(content)
      }

      if (lastError instanceof Error) throw lastError
      throw new Error('AI 翻译请求失败')
    }

    return mapConcurrentBestEffort(
      request.texts,
      concurrency,
      (text, index) => {
        const kind = request.textKinds?.[index] ?? 'paragraph'
        const key = cacheKey(text, kind)
        const done = this.completed.get(key)
        if (done !== undefined) return Promise.resolve(done)
        let pending = inflightByKey.get(key)
        if (!pending) {
          pending = translateSingle(text, kind).then((translated) => {
            this.remember(key, translated)
            return translated
          })
          inflightByKey.set(key, pending)
        }
        return pending
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
