import { describeNonFeedPayload, FEED_ACCEPT } from '../../lib/feedPayload'
import { fetchAbsoluteText } from '../../lib/http'
import { parseSourcePayload } from '../../lib/parseFeed'
import { XMLValidator } from 'fast-xml-parser'
import type { NewsSource } from '../../sources/registry'

import { validateFeedUrl } from './routeBuilder'
import type { FeedDiscoveryPreviewFailureKind, FeedDiscoveryPreviewResult } from './types'

const PREVIEW_TIMEOUT_MS = 30_000

function abortReason(signal: AbortSignal): FeedDiscoveryPreviewFailureKind {
  return signal.aborted ? 'aborted' : 'unknown'
}

function classifyError(error: unknown): {
  kind: FeedDiscoveryPreviewFailureKind
  message: string
  retryable: boolean
} {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { kind: 'aborted', message: '已取消检测', retryable: true }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/timeout|超时/i.test(message)) return { kind: 'timeout', message: '请求超时', retryable: true }
  if (/HTTP 403/i.test(message)) return { kind: 'forbidden', message: '上游拒绝访问（403）', retryable: false }
  if (/HTTP 404/i.test(message)) return { kind: 'not-found', message: '订阅地址不存在（404）', retryable: false }
  if (/HTTP 429/i.test(message)) return { kind: 'rate-limited', message: '上游限流（429）', retryable: true }
  if (/network|failed to fetch|load failed|网络/i.test(message)) {
    return { kind: 'network', message: '网络请求失败', retryable: true }
  }
  return { kind: 'unknown', message: message || '检测失败', retryable: true }
}

function validateFeedShape(payload: string): { valid: boolean; verification: boolean; message?: string } {
  const nonFeed = describeNonFeedPayload(payload)
  if (nonFeed) {
    return {
      valid: false,
      verification: /挑战页|登录页|验证/i.test(nonFeed),
      message: nonFeed,
    }
  }

  const trimmed = payload.trim()
  if (!trimmed) return { valid: false, verification: false, message: '返回内容为空' }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const items = parsed.items
      if (Array.isArray(items) && ['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1'].includes(String(parsed.version)) && typeof parsed.title === 'string') return { valid: true, verification: false }
      return { valid: false, verification: false, message: 'JSON 内容不是有效 JSON Feed' }
    } catch {
      return { valid: false, verification: false, message: 'JSON Feed 格式错误' }
    }
  }

  try {
    if (XMLValidator.validate(trimmed) !== true) {
      return { valid: false, verification: false, message: 'XML Feed 格式错误' }
    }
    const parser = new DOMParser()
    const doc = parser.parseFromString(trimmed, 'text/xml')
    if (doc.querySelector('parsererror')) {
      return { valid: false, verification: false, message: 'XML Feed 格式错误' }
    }
    const root = doc.documentElement?.localName?.toLowerCase()
    const valid = (root === 'rss' && Boolean(doc.querySelector('channel'))) ||
      (root === 'feed' && doc.documentElement.getAttribute('xmlns') === 'http://www.w3.org/2005/Atom') ||
      (root === 'rdf' && Boolean(doc.querySelector('channel')))
    return valid
      ? { valid: true, verification: false }
      : { valid: false, verification: false, message: '内容不是 RSS / Atom / RDF Feed' }
  } catch {
    return { valid: false, verification: false, message: '无法识别 Feed 格式' }
  }
}

export async function previewFeed(
  rawUrl: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FeedDiscoveryPreviewResult> {
  const feedUrl = validateFeedUrl(rawUrl)
  const checkedAt = Date.now()
  const controller = new AbortController()
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? PREVIEW_TIMEOUT_MS)
  const timeout = globalThis.setTimeout(() => controller.abort(new DOMException('Preview timeout', 'TimeoutError')), timeoutMs)

  const forwardAbort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', forwardAbort, { once: true })
  if (options.signal?.aborted) forwardAbort()

  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const payload = await fetchAbsoluteText(feedUrl, {
      signal: controller.signal,
      accept: FEED_ACCEPT,
      headers: { Accept: FEED_ACCEPT },
    })
    const shape = validateFeedShape(payload)
    if (!shape.valid) {
      return {
        ok: false,
        feedUrl,
        kind: shape.verification ? 'verification' : 'invalid-feed',
        message: shape.message ?? '返回内容不是有效 Feed',
        retryable: false,
        checkedAt,
      }
    }

    const source: NewsSource = {
      id: 'feed-discovery-preview',
      name: '订阅预览',
      label: '预览',
      group: 'custom',
      kind: 'feed',
      url: feedUrl,
      enabled: true,
      isCustom: true,
    }
    const articles = parseSourcePayload(source, payload)
    return {
      ok: true,
      feedUrl,
      itemCount: articles.length,
      articles: articles.slice(0, 5).map((article) => ({
        title: article.title,
        publishedAt: article.publishedAt,
      })),
      checkedAt,
    }
  } catch (error) {
    const classified = classifyError(error)
    if (controller.signal.aborted && options.signal?.aborted) {
      return {
        ok: false,
        feedUrl,
        kind: abortReason(options.signal),
        message: '已取消检测',
        retryable: true,
        checkedAt,
      }
    }
    if (controller.signal.aborted) {
      return {
        ok: false,
        feedUrl,
        kind: 'timeout',
        message: '请求超时',
        retryable: true,
        checkedAt,
      }
    }
    return { ok: false, feedUrl, ...classified, checkedAt }
  } finally {
    globalThis.clearTimeout(timeout)
    options.signal?.removeEventListener('abort', forwardAbort)
  }
}
