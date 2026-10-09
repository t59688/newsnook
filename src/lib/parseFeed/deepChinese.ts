/**
 * 中文深度媒体定制列表解析：
 * - 澎湃：公开内容 API（JSON）
 * - 南方周末：公开频道 HTML
 *
 * 只处理公开列表元数据。正文仍交给 resolveBody -> 原站 Readability，
 * 不绕过登录、会员、付费墙或其它访问控制。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { asRecord, buildArticle, stripTags, text, toArray, type Unknown } from './shared'

function absoluteRelativeCnDate(raw: string, fetchedAt: number): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^刚刚$/.test(value)) return new Date(fetchedAt).toISOString()

  const relative = value.match(/^(\d+)\s*(分钟|小时|天|周|个月)前$/)
  if (relative) {
    const units: Record<string, number> = {
      分钟: 60_000,
      小时: 3_600_000,
      天: 86_400_000,
      周: 7 * 86_400_000,
      个月: 30 * 86_400_000,
    }
    return new Date(fetchedAt - Number(relative[1]) * units[relative[2]]).toISOString()
  }

  // 南周历史列表省略年份（09-16）。按抓取时间推断，跨年时回落上一年。
  const short = value.match(/^(\d{1,2})-(\d{1,2})$/)
  if (short) {
    const now = new Date(fetchedAt)
    let year = now.getFullYear()
    const month = Number(short[1])
    const day = Number(short[2])
    let time = new Date(year, month - 1, day).getTime()
    const futureTolerance = 45 * 24 * 60 * 60 * 1000
    if (time > fetchedAt + futureTolerance) {
      year -= 1
      time = new Date(year, month - 1, day).getTime()
    }
    return Number.isNaN(time) ? '' : new Date(time).toISOString()
  }

  return value
}

function infzmDateFromMeta(spans: string[], fetchedAt: number): string {
  const candidate = spans.find((value) =>
    /^(?:刚刚|\d+\s*(?:分钟|小时|天|周|个月)前|\d{1,2}-\d{1,2}|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/.test(value),
  )
  return candidate ? absoluteRelativeCnDate(candidate, fetchedAt) : ''
}

export type ThePaperCursor = {
  startTime: number
  excludeContIds?: Array<string | number>
  hasNext: boolean
}

/** 从澎湃列表响应提取下一页游标。序列化为字符串可复用现有分页缓存模型。 */
export function thePaperCursor(payload: string): string | undefined {
  try {
    const root = JSON.parse(payload) as Unknown
    if (Number(root.code) !== 200) return undefined
    const data = asRecord(root.data)
    const startTime = Number(data?.startTime)
    if (!Number.isFinite(startTime) || startTime <= 0) return undefined
    const excludeContIds = Array.isArray(data?.excludeContIds)
      ? data.excludeContIds.filter((value) => typeof value === 'string' || typeof value === 'number')
      : undefined
    return JSON.stringify({
      startTime,
      ...(excludeContIds?.length ? { excludeContIds } : {}),
      hasNext: data?.hasNext !== false,
    } satisfies ThePaperCursor)
  } catch {
    return undefined
  }
}

export function parseThePaperCursor(cursor: string | undefined): ThePaperCursor | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(cursor) as Partial<ThePaperCursor>
    if (!Number.isFinite(value.startTime) || Number(value.startTime) <= 0) return undefined
    const excludeContIds = Array.isArray(value.excludeContIds)
      ? value.excludeContIds.filter((entry) => typeof entry === 'string' || typeof entry === 'number')
      : undefined
    return {
      startTime: Number(value.startTime),
      ...(excludeContIds?.length ? { excludeContIds } : {}),
      hasNext: value.hasNext !== false,
    }
  } catch {
    return undefined
  }
}

export function thePaperCursorAdvances(previous: string, next: string): boolean {
  const before = parseThePaperCursor(previous)
  const after = parseThePaperCursor(next)
  if (!before || !after) return false
  // 官网 load-more 每次用上一响应 startTime 作为下一请求快照，历史页应严格向过去推进。
  return after.startTime < before.startTime
}

export function thePaperPageRequest(
  source: NewsSource,
  cursor: string,
  page: number,
): Record<string, unknown> | undefined {
  const parsed = parseThePaperCursor(cursor)
  if (!parsed?.hasNext) return undefined
  return {
    ...(source.requestJson ?? {}),
    pageNum: Math.max(2, Math.floor(page) + 1),
    startTime: parsed.startTime,
    ...(parsed.excludeContIds?.length ? { excludeContIds: parsed.excludeContIds } : {}),
  }
}

/** 澎湃公开 nodeCont API。 */
export function parseThePaper(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let root: Unknown
  try {
    root = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  if (Number(root.code) !== 200) return []
  const data = asRecord(root.data)
  const list = toArray(data?.list).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []

  for (const item of list) {
    const id = text(item.contId) || text(item.originalContId)
    const title = text(item.name)
    if (!id || !title) continue

    const outLink = text(item.link)
    const link =
      /^https?:\/\//i.test(outLink) && String(item.isOutForward ?? item.isOutForword) === '1'
        ? outLink
        : `https://www.thepaper.cn/newsDetail_forward_${id}`

    const image = text(item.pic) || text(item.smallPic) || text(item.sharePic)
    const timestamp = Number(item.pubTimeLong ?? item.trackPublishTime)
    const timestampDate =
      Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : ''
    const dateRaw =
      text(item.publishTime) ||
      timestampDate ||
      absoluteRelativeCnDate(text(item.pubTimeNew) || text(item.pubTime), fetchedAt)

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: title,
        dateRaw,
        image: image || undefined,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function httpsAsset(url: string): string {
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('http://images.infzm.com/')) return `https://${url.slice('http://'.length)}`
  return url
}

/** 南方周末公开频道 HTML。 */
export function parseInfzm(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const articles: Article[] = []
  const seen = new Set<string>()

  // 每个内容卡片都在 li 中。以 /contents/{id} 为稳定锚点，避免依赖 CSS hash。
  const itemRe = /<li[^>]*>([\s\S]*?<a\b[^>]*href=["']\/contents\/(\d+)(?:\?[^"']*)?["'][\s\S]*?)<\/li>/gi
  let match: RegExpExecArray | null

  while ((match = itemRe.exec(payload)) !== null) {
    const block = match[1]
    const id = match[2]
    if (seen.has(id)) continue

    const titleHtml =
      block.match(/<header[^>]*class=["'][^"']*nfzm-content-item__title[^"']*["'][^>]*>[\s\S]*?<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1] ??
      block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i)?.[1] ??
      ''
    const title = stripTags(titleHtml)
    if (!title) continue

    const descriptionHtml =
      block.match(/<div[^>]*class=["'][^"']*nfzm-content-item__description[^"']*["'][^>]*>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
      ''
    const summary = stripTags(descriptionHtml)

    const imageRaw =
      block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] ??
      block.match(/data-src=["']([^"']+)["']/i)?.[1] ??
      ''

    const meta =
      block.match(/<footer[^>]*class=["'][^"']*nfzm-content-item__meta[^"']*["'][^>]*>([\s\S]*?)<\/footer>/i)?.[1] ??
      ''
    const spans = [...meta.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((m) => stripTags(m[1]))
      .filter(Boolean)
    const dateRaw = infzmDateFromMeta(spans, fetchedAt)

    const link = `https://www.infzm.com/contents/${id}`
    const article = buildArticle(
      source,
      {
        title: decodeHtmlEntities(title),
        link,
        html: '',
        summaryText: decodeHtmlEntities(summary || title),
        dateRaw,
        image: imageRaw ? httpsAsset(decodeHtmlEntities(imageRaw)) : undefined,
      },
      fetchedAt,
    )
    if (article) {
      seen.add(id)
      articles.push(article)
    }
  }

  return articles
}
