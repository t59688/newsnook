/**
 * DeepLX 共享节流与 429 退避。
 *
 * 公共 DeepLX 服务（api.deeplx.org 及自建实例的上游 DeepL）按「短时突发频率」
 * 临时封禁 IP / 令牌：一旦触发，封禁期内所有请求（包括单条测试连接）都会 429。
 * 因此所有 DeepLX 请求（阅读器翻译、信息流标题翻译、测试连接）共享同一个
 * 按端点分组的节流门：
 * - 相邻两次请求的「开始时刻」至少间隔 minIntervalMs（跨并发 worker、跨实例生效）；
 * - 收到 429 后整体进入冷却期，冷却结束前所有排队请求一起等待。
 */

/** 服务端限流（HTTP 429 / body code 429）重试耗尽后抛出的错误。 */
export class TranslationRateLimitError extends Error {
  readonly retryAfterMs?: number

  constructor(message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'TranslationRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/** 打包边界可能复制类实现，按 name 判定避免 instanceof 失效。 */
export function isTranslationRateLimitError(
  error: unknown,
): error is TranslationRateLimitError {
  return error instanceof Error && error.name === 'TranslationRateLimitError'
}

export interface DeepLxThrottleConfig {
  /** 相邻两次请求「开始时刻」的最小间隔（毫秒） */
  minIntervalMs: number
  /** 429 退避基准（按 2^重试次数 指数放大） */
  backoffBaseMs: number
  /** 单次退避等待上限 */
  backoffMaxMs: number
  /** 退避随机抖动上限（避免多任务同刻恢复形成齐射） */
  jitterMaxMs: number
  /** 429 最大重试次数（不含首次请求） */
  maxRetries: number
}

const DEFAULT_THROTTLE: DeepLxThrottleConfig = {
  minIntervalMs: 350,
  backoffBaseMs: 1500,
  backoffMaxMs: 15000,
  jitterMaxMs: 250,
  maxRetries: 3,
}

/**
 * 公共共享网关（如 api.deeplx.org）按令牌配额限流：配额烧完后所有请求
 * （包括单条测试连接）都会 429 一段时间。对这类主机采用更保守的档位：
 * 更大的请求间隔压低配额消耗；被限流后只重试一次，避免重试本身继续烧配额。
 */
const PUBLIC_GATEWAY_THROTTLE: DeepLxThrottleConfig = {
  minIntervalMs: 1000,
  backoffBaseMs: 3000,
  backoffMaxMs: 15000,
  jitterMaxMs: 250,
  maxRetries: 1,
}

const PUBLIC_GATEWAY_HOSTS = new Set(['api.deeplx.org'])

let currentConfig: DeepLxThrottleConfig = { ...DEFAULT_THROTTLE }
let publicGatewayConfig: DeepLxThrottleConfig = { ...PUBLIC_GATEWAY_THROTTLE }

/** 端点是否指向已知的公共共享 DeepLX 网关（按令牌配额限流）。 */
export function isPublicDeepLxGateway(endpoint: string): boolean {
  try {
    return PUBLIC_GATEWAY_HOSTS.has(new URL(endpoint).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function deepLxThrottleConfig(endpoint?: string): Readonly<DeepLxThrottleConfig> {
  return endpoint && isPublicDeepLxGateway(endpoint) ? publicGatewayConfig : currentConfig
}

/** 仅供 scripts/ 测试压缩等待时间；生产代码不要调用。 */
export function configureDeepLxThrottleForTests(
  overrides?: Partial<DeepLxThrottleConfig>,
  publicGatewayOverrides?: Partial<DeepLxThrottleConfig>,
): void {
  currentConfig = { ...DEFAULT_THROTTLE, ...overrides }
  publicGatewayConfig = { ...PUBLIC_GATEWAY_THROTTLE, ...publicGatewayOverrides }
}

function abortError(): DOMException {
  return new DOMException('翻译已取消', 'AbortError')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 最小间隔节流门：预约「下一个可用时隙」，把请求开始时刻串行错开。
 * 时隙先占后等：等待中被取消只会浪费一个时隙，行为偏保守是安全的。
 */
export class MinIntervalGate {
  private nextSlotAt = 0
  private readonly endpoint: string

  constructor(endpoint = '') {
    this.endpoint = endpoint
  }

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError()
    const now = Date.now()
    const slot = Math.max(now, this.nextSlotAt)
    this.nextSlotAt = slot + deepLxThrottleConfig(this.endpoint).minIntervalMs
    if (slot > now) await sleep(slot - now, signal)
  }

  /** 收到 429：整体冷却，冷却结束前所有排队请求一起等待。 */
  reportRateLimit(cooldownMs: number): void {
    const resumeAt = Date.now() + Math.max(0, cooldownMs)
    if (resumeAt > this.nextSlotAt) this.nextSlotAt = resumeAt
  }
}

const gates = new Map<string, MinIntervalGate>()

/** 按端点 origin 取共享节流门（同一 DeepLX 服务的所有调用方共用限额）。 */
export function deepLxGate(endpoint: string): MinIntervalGate {
  let key = endpoint
  try {
    key = new URL(endpoint).origin
  } catch {
    // 非法 URL 时退回原始字符串作为 key
  }
  let gate = gates.get(key)
  if (!gate) {
    gate = new MinIntervalGate(key)
    gates.set(key, gate)
  }
  return gate
}

const RETRY_AFTER_CAP_MS = 60_000

/** 解析 Retry-After 响应头（秒数或 HTTP 日期）；非法返回 undefined。 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, RETRY_AFTER_CAP_MS)
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return undefined
  return Math.min(Math.max(0, dateMs - Date.now()), RETRY_AFTER_CAP_MS)
}

/** 第 attempt 次重试前的等待：优先服务端 Retry-After，否则指数退避，再加抖动。 */
export function deepLxBackoffMs(
  attempt: number,
  retryAfterMs?: number,
  endpoint?: string,
): number {
  const config = deepLxThrottleConfig(endpoint)
  const backoff =
    retryAfterMs != null && retryAfterMs > 0
      ? retryAfterMs
      : Math.min(config.backoffBaseMs * 2 ** attempt, config.backoffMaxMs)
  const jitter = config.jitterMaxMs > 0 ? Math.floor(Math.random() * config.jitterMaxMs) : 0
  return backoff + jitter
}
