/**
 * 列表日期不可信/缺失的源，用详情页补全真实发稿时间：
 * 晚点（伪日期）、甲子光年（部分卡片缺日期）、Paul Graham（列表页无日期）。
 * `fetchHtml` 由调用方注入（浏览器走 /api/page，原生直连），避免 parseFeed 依赖 http。
 */

import type { Article } from '../types'
import { parseDate } from './shared'

/**
 * 晚点列表接口 `release_time` 的已知缺陷：把月份写成「日」，
 * 只会出现「06月06日 / 07月07日 / 08月08日」这类月=日字符串，不是真实发稿日。
 * 详情页才有可信值，形如 `release_time = '2026/08/04'`。
 */
export function isBogusLatepostListDate(raw: string): boolean {
  const match = raw.trim().match(/^(\d{1,2})月(\d{1,2})日$/)
  return Boolean(match && match[1] === match[2])
}

/** 从晚点详情页 HTML 取出真实发稿时间 */
export function extractLatepostReleaseTime(html: string): string | undefined {
  const match = html.match(/release_time\s*=\s*'([^']+)'/)
  const value = match?.[1]?.trim()
  return value || undefined
}

/** 用详情页补全晚点列表里被丢弃的日期。 */
export async function enrichLatepostDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractLatepostReleaseTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}

/** 甲子光年详情页主时间：`<div class="time font-12">2026-07-29</div>`，取首次命中 */
export function extractJazzyearPublishTime(html: string): string | undefined {
  const match = html.match(/class="[^"]*time[^"]*"[^>]*>\s*(20\d{2}-\d{2}-\d{2})/)
  return match?.[1]
}

/** 用详情页补全甲子光年列表缺日期的条目。 */
export async function enrichJazzyearDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractJazzyearPublishTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}

const PG_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

/** 正文页标题图后的 `June 2026`；只看页头，避免正文里提到的其它月份串台 */
export function extractPaulGrahamPublishTime(html: string): string | undefined {
  const head = html.slice(0, 12_000)
  const match = head.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  )
  if (!match) return undefined
  const month = PG_MONTHS[match[1].toLowerCase()]
  const year = Number(match[2])
  if (month == null || year < 1990 || year > 2100) return undefined
  return `${year}-${String(month + 1).padStart(2, '0')}-01`
}

/** 列表页无日期；只补最近若干篇，避免每次刷新打满整站随笔 */
const PG_DATE_ENRICH_LIMIT = 40

export async function enrichPaulGrahamDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (index >= PG_DATE_ENRICH_LIMIT) continue
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractPaulGrahamPublishTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}
