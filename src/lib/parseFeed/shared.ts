/**
 * parseFeed 子模块共享工具：XML/JSON 节点取值、日期解析、
 * 媒体/配图提取与统一的 Article 构造。仅供 parseFeed/ 内部使用，
 * 对外公开 API 一律走 lib/parseFeed.ts 入口。
 */

import { collectAudioSrc, isAudioMediaUrl } from '../articleAudio'
import { feedArticleId } from '../articleId'
import { cleanSummaryText } from '../cleanSummary'
import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'

export type Unknown = Record<string, unknown>

export function asRecord(value: unknown): Unknown | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Unknown) : undefined
}

export function toArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/** 节点可能是字符串、带属性的对象或数组，统一取出文本 */
export function text(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = text(entry)
      if (found) return found
    }
    return ''
  }
  const record = asRecord(value)
  if (record && '#text' in record) return text(record['#text'])
  return ''
}

export function pick(node: Unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    if (node[key] != null) return node[key]
  }
  return undefined
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function firstImageIn(html: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1]
}

export function attr(value: unknown, name: string): string | undefined {
  for (const entry of toArray(value)) {
    const record = asRecord(entry)
    const found = record?.[name]
    if (typeof found === 'string' && found) return found
  }
  return undefined
}

export function parseDate(raw: string): number | undefined {
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (!Number.isNaN(parsed)) return parsed

  // 知乎日报等：yyyyMMdd
  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4))
    const month = Number(raw.slice(4, 6)) - 1
    const day = Number(raw.slice(6, 8))
    const time = new Date(year, month, day).getTime()
    return Number.isNaN(time) ? undefined : time
  }

  // 少数源使用 "2026-07-31 09:01:25"
  const normalized = raw.replace(' ', 'T')
  const retry = Date.parse(normalized)
  if (!Number.isNaN(retry)) return retry

  // 晚点等："08月04日" / "2026/08/03 17:24"
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (slash) {
    const year = Number(slash[1])
    const month = Number(slash[2]) - 1
    const day = Number(slash[3])
    const hour = slash[4] ? Number(slash[4]) : 0
    const minute = slash[5] ? Number(slash[5]) : 0
    const time = new Date(year, month, day, hour, minute).getTime()
    return Number.isNaN(time) ? undefined : time
  }

  const md = raw.match(/(\d{1,2})月(\d{1,2})日/)
  if (md) {
    const now = new Date()
    let year = now.getFullYear()
    const month = Number(md[1]) - 1
    const day = Number(md[2])
    let time = new Date(year, month, day).getTime()
    // 省略年份的日期跨年时会落到未来。阈值取 45 天：
    // 预告稿只领先几天，跨年误判则领先数月，两者不会混淆。
    const FUTURE_TOLERANCE_MS = 45 * 24 * 60 * 60 * 1000
    if (time > now.getTime() + FUTURE_TOLERANCE_MS) {
      year -= 1
      time = new Date(year, month, day).getTime()
    }
    return Number.isNaN(time) ? undefined : time
  }

  return undefined
}

export function httpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined
}

function enclosureRecords(node: Unknown): Unknown[] {
  return toArray(node.enclosure).map(asRecord).filter(Boolean) as Unknown[]
}

export function audioUrlFromNode(node: Unknown, html: string): string | undefined {
  for (const rec of enclosureRecords(node)) {
    const url = httpUrl(rec['@_url'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (url && isAudioMediaUrl(url, type)) return url
  }
  for (const raw of toArray(node.link)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const rel = String(rec['@_rel'] || '')
    const href = httpUrl(rec['@_href'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (href && rel === 'enclosure' && isAudioMediaUrl(href, type)) return href
  }
  for (const raw of toArray(node.attachments)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const url = httpUrl(text(rec.url))
    const type = text(rec.mime_type) || text(rec.mimeType)
    if (url && isAudioMediaUrl(url, type)) return url
  }
  return collectAudioSrc(html)
}

export function imageOf(node: Unknown, html: string): string | undefined {
  const candidates: Array<string | undefined> = []
  for (const rec of enclosureRecords(node)) {
    const url = httpUrl(rec['@_url'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (url && !isAudioMediaUrl(url, type) && !/^video\//i.test(type)) {
      candidates.push(url)
    }
  }
  candidates.push(
    attr(node.thumbnail, '@_url'),
    attr(node.content, '@_url'),
    attr(node.image, '@_url'),
    attr(node.image, '@_href'),
    text(asRecord(node.image)?.url),
  )
  for (const raw of toArray(node.attachments)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const url = httpUrl(text(rec.url))
    const type = text(rec.mime_type) || text(rec.mimeType)
    if (
      url &&
      !isAudioMediaUrl(url, type) &&
      (/^image\//i.test(type) || /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i.test(url))
    ) {
      candidates.push(url)
    }
  }
  const direct = candidates.find((value) => httpUrl(value))
  return direct ?? firstImageIn(html)
}

export function buildArticle(
  source: NewsSource,
  raw: {
    title: string
    link: string
    html: string
    summaryText: string
    dateRaw: string
    image?: string
    contentType?: Article['contentType']
    videoUrl?: string
    audioUrl?: string
    neteaseDocId?: string
  },
  fetchedAt: number,
): Article | undefined {
  const title = stripTags(raw.title)
  if (!title) return undefined

  const published = parseDate(raw.dateRaw)
  const cleaned = cleanSummaryText(raw.summaryText, title)
  const summary = (cleaned || raw.summaryText).slice(0, 220)

  return {
    id: feedArticleId(source.id, raw.link || title),
    title,
    summary,
    contentHtml: raw.html && raw.html.includes('<') ? raw.html : undefined,
    image: raw.image,
    publishedAt: published ?? fetchedAt,
    hasRealDate: published != null,
    sourceId: source.id,
    sourceName: source.name,
    sourceLabel: source.label,
    sourceGroup: source.group,
    originUrl: raw.link,
    contentType: raw.contentType ?? 'article',
    videoUrl: raw.videoUrl,
    audioUrl: raw.audioUrl,
    neteaseDocId: raw.neteaseDocId,
  }
}

export function preferHttpsAsset(url: string): string {
  if (!url.startsWith('http://')) return url
  try {
    const host = new URL(url).hostname
    if (
      host.endsWith('126.net') ||
      host.endsWith('163.com') ||
      host.endsWith('netease.com') ||
      host.endsWith('126.com')
    ) {
      return `https://${url.slice('http://'.length)}`
    }
  } catch {
    // keep original
  }
  return url
}
