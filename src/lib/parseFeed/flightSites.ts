/**
 * 无官方 RSS 的 Next.js 站点：文章元数据嵌在 flight payload 里
 * （Arena / Anthropic News，均为 Sanity CMS）。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { buildArticle } from './shared'

const ARENA_SKIP_SLUGS = new Set([
  'about',
  'category',
  'page',
  'tag',
  'rss',
  'feed',
  'leaderboard-changelog',
])

/** 解码 flight / JS 字符串片段里的 \\uXXXX 与转义引号 */
function decodeFlightText(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
  }
}

function nextFlightBlob(html: string): string {
  const chunks: string[] = []
  const re = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g
  for (const match of html.matchAll(re)) {
    chunks.push(decodeFlightText(match[1]))
  }
  return chunks.length ? chunks.join('') : html
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Arena（arena.ai/blog）无官方 RSS。
 * 列表页把 Sanity CMS 文章元数据嵌在 Next.js flight payload 里，从中抽出 slug / 标题 / 发布时间。
 */
export function parseArenaBlog(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const blob = nextFlightBlob(payload)
  const found = new Map<string, { publishedAt: string; title: string }>()

  const pattern =
    /"publishedAt"\s*:\s*"([^"]+)"[\s\S]{0,500}?"slug"\s*:\s*\{[^}]*?"current"\s*:\s*"([^"]+)"[\s\S]{0,900}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/g

  for (const match of blob.matchAll(pattern)) {
    const publishedAt = match[1]
    const slug = match[2]
    const titleRaw = match[3]
    if (!slug || ARENA_SKIP_SLUGS.has(slug)) continue
    const title = decodeFlightText(titleRaw).trim()
    if (!title) continue
    const prev = found.get(slug)
    if (!prev || publishedAt > prev.publishedAt) {
      found.set(slug, { publishedAt, title })
    }
  }

  // 若 flight 解析失败，退回 sitemap 的 loc（标题用 slug 可读化）
  if (!found.size) {
    for (const match of payload.matchAll(
      /<loc>\s*(https:\/\/arena\.ai\/blog\/([a-z0-9-]+)\/?)\s*<\/loc>/gi,
    )) {
      const slug = match[2]
      if (!slug || ARENA_SKIP_SLUGS.has(slug)) continue
      found.set(slug, {
        publishedAt: '',
        title: titleFromSlug(slug),
      })
    }
  }

  const articles: Article[] = []
  for (const [slug, meta] of found) {
    const link = `https://arena.ai/blog/${slug}/`
    const article = buildArticle(
      source,
      {
        title: meta.title,
        link,
        html: '',
        summaryText: meta.title,
        dateRaw: meta.publishedAt,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles.sort((a, b) => b.publishedAt - a.publishedAt)
}

const ANTHROPIC_SKIP_SLUGS = new Set(['press-kit', 'feed', 'tag', 'page', 'category'])

/**
 * Anthropic News（anthropic.com/news）无官方 RSS。
 * 与 Arena 类似：Sanity 元数据嵌在 Next.js flight 里（publishedOn / slug.current / title）。
 */
export function parseAnthropicNews(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const blob = nextFlightBlob(payload)
  const found = new Map<string, { publishedAt: string; title: string; summary: string }>()

  const pattern =
    /"publishedOn"\s*:\s*"([^"]+)"[\s\S]{0,500}?"slug"\s*:\s*\{[^}]*?"current"\s*:\s*"([^"]+)"[\s\S]{0,1200}?"title"\s*:\s*"((?:\\.|[^"\\])*)"/g

  for (const match of blob.matchAll(pattern)) {
    const publishedAt = match[1]
    const slug = match[2]
    const titleRaw = match[3]
    if (!slug || ANTHROPIC_SKIP_SLUGS.has(slug)) continue
    const title = decodeFlightText(titleRaw).trim()
    if (!title) continue
    const window = match[0]
    const summaryMatch = window.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/)
    const summary = summaryMatch ? decodeFlightText(summaryMatch[1]).trim() : ''
    const prev = found.get(slug)
    if (!prev || publishedAt > prev.publishedAt) {
      found.set(slug, { publishedAt, title, summary })
    }
  }

  // flight 失败时退回列表页可见的 /news/<slug> 链接
  if (!found.size) {
    for (const match of payload.matchAll(/href="\/news\/([a-zA-Z0-9-]+)"/g)) {
      const slug = match[1]
      if (!slug || ANTHROPIC_SKIP_SLUGS.has(slug)) continue
      found.set(slug, { publishedAt: '', title: titleFromSlug(slug), summary: '' })
    }
  }

  const articles: Article[] = []
  for (const [slug, meta] of found) {
    const link = `https://www.anthropic.com/news/${slug}`
    const article = buildArticle(
      source,
      {
        title: meta.title,
        link,
        html: '',
        summaryText: meta.summary || meta.title,
        dateRaw: meta.publishedAt,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles.sort((a, b) => b.publishedAt - a.publishedAt)
}
