/**
 * AI 一手官方站点列表解析器（均无官方 RSS，解析服务端渲染 HTML）：
 * - claude.com（Webflow CMS 集合列表：/blog 与 /customers）
 * - academy.claude.com（TanStack 静态卡片：/use-cases 与 /tutorials，列表无日期）
 * - developers.openai.com/cookbook（Astro 列表行：标题 + 日期）
 * 正文均走 resolveBody 的通用 Readability 路径；探测记录见 docs/news-sources.md §7。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { buildArticle, stripTags } from './shared'

/** 数字字符引用（&#x27; / &#8217; 等）；命名实体由 buildArticle 内的 stripTags 兜底 */
function decodeNumericEntities(raw: string): string {
  return raw
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
}

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 源 URL 的 origin 与去尾斜杠的列表路径（如 https://claude.com + /blog） */
function sourceBase(source: NewsSource): { origin: string; basePath: string } | undefined {
  try {
    const url = new URL(source.url)
    return { origin: url.origin, basePath: url.pathname.replace(/\/+$/, '') }
  } catch {
    return undefined
  }
}

/** 英文日期文本（"August 18, 2026" / "Aug 18, 2026"），供无 fs-list-field 的跑马灯条目兜底 */
const EN_DATE_RE =
  />\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})\s*</

type ListedEntry = { title: string; dateRaw: string; image?: string }

/** 同一条目在页面多处渲染（网格 / 跑马灯 / Featured）时，优先保留带日期的版本 */
function upsertListedEntry(found: Map<string, ListedEntry>, path: string, entry: ListedEntry): void {
  const prev = found.get(path)
  if (!prev || (!prev.dateRaw && entry.dateRaw)) {
    found.set(path, { ...entry, image: entry.image ?? prev?.image })
  }
}

/**
 * claude.com Webflow CMS 集合列表（/blog、/customers）。
 * 条目包在 <div role="listitem" class="*_cms_*item w-dyn-item"> 里（博客网格
 * blog_cms_item、客户案例 stories_cms_item、首页跑马灯 marquee_cms_blog_list_item）；
 * 网格条目带 fs-list-field="heading|title|client" 与 fs-list-field="date" 隐藏元数据，
 * 跑马灯条目只有 <h2> 标题与英文日期文本。
 */
export function parseClaudeWebflow(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const base = sourceBase(source)
  if (!base) return []

  const linkRe = new RegExp(`href="(${escapeRegExp(base.basePath)}/([a-z0-9-]+))"`)
  const found = new Map<string, ListedEntry>()

  for (const block of payload.split(
    /<div role="listitem" class="[a-z0-9_-]*_cms_[a-z0-9_-]*item w-dyn-item">/,
  ).slice(1)) {
    const linkMatch = block.match(linkRe)
    if (!linkMatch) continue
    const path = linkMatch[1]

    // 博客网格用 heading；客户案例用 title（故事标题）；跑马灯用 h2/h3；最后退回 client（客户名）
    const titleRaw =
      block.match(/fs-list-field="heading"[^>]*>([^<]+)</)?.[1] ??
      block.match(/fs-list-field="title"[^>]*>([^<]+)</)?.[1] ??
      block.match(/<h[23][^>]*>([^<]+)<\/h[23]>/)?.[1] ??
      block.match(/fs-list-field="client"[^>]*>([^<]+)</)?.[1] ??
      ''
    const title = stripTags(decodeNumericEntities(titleRaw))
    if (!title) continue

    const dateRaw =
      block.match(/fs-list-field="date"[^>]*>([^<]+)</)?.[1]?.trim() ??
      block.match(EN_DATE_RE)?.[1]?.trim() ??
      ''
    const image = block.match(/<img\b[^>]+src="(https?:\/\/[^"]+)"/)?.[1]

    upsertListedEntry(found, path, { title, dateRaw, image })
  }

  // Webflow 集合结构变化时退回可见链接（标题用 slug 可读化，不带日期）
  if (!found.size) {
    const fallbackRe = new RegExp(`href="(${escapeRegExp(base.basePath)}/([a-z0-9-]+))"`, 'g')
    for (const match of payload.matchAll(fallbackRe)) {
      if (!found.has(match[1])) {
        found.set(match[1], { title: titleFromSlug(match[2]), dateRaw: '' })
      }
    }
  }

  const articles: Article[] = []
  for (const [path, entry] of found) {
    const article = buildArticle(
      source,
      {
        title: entry.title,
        link: `${base.origin}${path}`,
        html: '',
        summaryText: entry.title,
        dateRaw: entry.dateRaw,
        image: entry.image,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * academy.claude.com 卡片列表（/use-cases、/tutorials）。
 * 卡片是 <a href="/<prefix>/<slug>">…<h3>标题</h3>…</a>，列表与详情都无日期；
 * 递减 publishedAt 仅用于源内顺序，不得标成真实发稿时间（同 paulgraham）。
 */
export function parseClaudeAcademy(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const base = sourceBase(source)
  if (!base) return []

  const anchorRe = new RegExp(`<a\\b[^>]*href="(${escapeRegExp(base.basePath)}/([a-z0-9-]+))"[^>]*>`, 'g')
  const items: Array<{ path: string; title: string }> = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(payload)) !== null) {
    const path = match[1]
    if (seen.has(path)) continue

    const contentEnd = payload.indexOf('</a>', anchorRe.lastIndex)
    const content = contentEnd < 0 ? '' : payload.slice(anchorRe.lastIndex, contentEnd)
    const title =
      stripTags(decodeNumericEntities(content.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] ?? '')) ||
      titleFromSlug(match[2])

    seen.add(path)
    items.push({ path, title })
  }

  const articles: Article[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const article = buildArticle(
      source,
      {
        title: item.title,
        link: `${base.origin}${item.path}`,
        html: '',
        summaryText: item.title,
        dateRaw: '',
      },
      fetchedAt,
    )
    if (article) {
      articles.push({
        ...article,
        publishedAt: fetchedAt - i * 3600_000,
        hasRealDate: false,
      })
    }
  }

  return articles
}

/**
 * OpenAI Cookbook（developers.openai.com/cookbook）列表。
 * 站级 /rss.xml 混入 YouTube 与平台文档链接，不适合做列表源；
 * 解析 Astro 服务端渲染的列表行：行内标题在 line-clamp-1 节点，日期在 text-right 节点。
 */
export function parseOpenaiCookbook(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const base = sourceBase(source)
  if (!base) return []

  const anchorRe = /<a\b[^>]*href="(\/cookbook\/[^"#?]+)"[^>]*>/g
  const found = new Map<string, ListedEntry>()

  let match: RegExpExecArray | null
  while ((match = anchorRe.exec(payload)) !== null) {
    const path = match[1].replace(/\/+$/, '')

    const contentEnd = payload.indexOf('</a>', anchorRe.lastIndex)
    const content = contentEnd < 0 ? '' : payload.slice(anchorRe.lastIndex, contentEnd)
    const titleRaw = content.match(/class="[^"]*line-clamp-1[^"]*"[^>]*>([^<]+)</)?.[1] ?? ''
    const title = stripTags(decodeNumericEntities(titleRaw))
    // 非列表行（导航 / Featured 卡片等）没有 line-clamp 标题节点，跳过
    if (!title) continue

    const dateRaw = content.match(/class="[^"]*text-right[^"]*"[^>]*>([^<]+)</)?.[1]?.trim() ?? ''
    // 同一篇可能同时出现在无日期的 Featured 区与带日期的 Latest 列表，保留带日期版本
    upsertListedEntry(found, path, { title, dateRaw })
  }

  // 列表结构变化时退回文章链接（标题用 slug 可读化，不带日期）
  if (!found.size) {
    for (const m of payload.matchAll(/href="(\/cookbook\/(?:examples|articles)\/[^"#?]+)"/g)) {
      const path = m[1].replace(/\/+$/, '')
      if (!found.has(path)) {
        found.set(path, { title: titleFromSlug(path.split('/').pop() ?? ''), dateRaw: '' })
      }
    }
  }

  const articles: Article[] = []
  for (const [path, entry] of found) {
    const article = buildArticle(
      source,
      {
        title: entry.title,
        link: `${base.origin}${path}`,
        html: '',
        summaryText: entry.title,
        dateRaw: entry.dateRaw,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}
