/**
 * resolveBody 子模块共享工具与类型：正文清洗、HTML 转义、
 * 图片绝对化 + 代理 + 消毒的统一准备流程。
 * 对外公开 API 一律走 lib/resolveBody.ts 入口。
 */

import { Capacitor } from '@capacitor/core'

import { hydrateNativeTunnelImages } from '../../features/proxy/hydrateImages'
import { currentProxyRuntime } from '../../features/proxy/runtime'
import { resolveProxyTransport } from '../../features/proxy/transport'
import { getRuntimeProxyPrefs } from '../http'
import { normalizeContentImages } from '../normalizeImages'
import { sanitizeArticleHtml } from '../sanitize'

export type BodySource = 'feed' | 'readability' | 'netease' | 'video' | 'blocked'

export interface ResolvedBody {
  contentHtml: string
  title?: string
  image?: string
  bodySource: BodySource
  /** Google News 等解码后的出版社 URL；外开浏览器优先用 */
  resolvedOriginUrl?: string
}

/**
 * 媒体地址探测完成后的增量更新。
 * 正文抽取不应等待播放器嗅探；阅读器可以先展示正文，再接收这次更新。
 */
export type MediaResolvedHandler = (resolved: ResolvedBody) => void

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function imageUrlTransform(url: string): string | null {
  const transport = resolveProxyTransport(
    url,
    undefined,
    getRuntimeProxyPrefs(),
    currentProxyRuntime(),
  )
  if (transport.kind === 'web-wrap') return transport.requestUrl
  return null
}

async function prepareHtml(html: string, baseUrl: string): Promise<string> {
  const normalized = normalizeContentImages(html, baseUrl, {
    // 浏览器开发态走图片代理；原生 App 直连（隧道图稍后 hydrate 成 blob）
    proxyImages: !Capacitor.isNativePlatform(),
    transformUrl: imageUrlTransform,
  })
  const sanitized = sanitizeArticleHtml(normalized)
  return hydrateNativeTunnelImages(sanitized)
}

export async function absolutizeHtml(html: string, baseUrl: string): Promise<string> {
  return prepareHtml(html, baseUrl)
}

export function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

export function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : undefined
  } catch {
    return undefined
  }
}
