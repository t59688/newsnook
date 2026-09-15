import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import type { ZhihuContentType, ZhihuListResult, ZhihuPaging } from './types'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : value == null ? [] : [value] }
function text(value: unknown): string { if (typeof value === 'string') return value.trim(); if (typeof value === 'number') return String(value); return '' }
function integer(value: unknown): number | undefined { const number = typeof value === 'number' ? value : Number(value); return Number.isFinite(number) ? number : undefined }
function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim()
}
/** Server content is already rendered HTML; remove executable surfaces before it enters Article cache. */
function safeBody(value: unknown): string | undefined {
  const html = text(value)
  if (!html) return undefined
  const cleaned = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, '')
    .replace(/\s(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
  return stripHtml(cleaned).length >= 40 ? cleaned : undefined
}
function firstImage(html: string): string | undefined { return html.match(/<img\b[^>]*\b(?:src|data-original|data-actualsrc)=["']([^"']+)["']/i)?.[1] }
function safeImage(...values: unknown[]): string | undefined { for (const value of values) { const candidate = text(value); if (/^https?:\/\//i.test(candidate)) return candidate } return undefined }
function contentTypeOf(target: UnknownRecord): ZhihuContentType | undefined {
  const raw = text(target.type || target.object_type || target.content_type).toLowerCase()
  if (raw === 'answer' || raw === 'article' || raw === 'question' || raw === 'pin') return raw
  if (raw === 'post') return 'article'
  return undefined
}
function unwrapFeedTarget(entry: unknown): UnknownRecord | undefined {
  const node = record(entry); if (!node) return undefined
  const target = record(node.target); if (target) return target
  const object = record(node.object); if (object) return object
  const content = record(node.content)
  if (content) { const nestedObject = record(content.object); if (nestedObject) return nestedObject; const nestedTarget = record(content.target); if (nestedTarget) return nestedTarget }
  return node
}
function articleUrl(type: ZhihuContentType, id: string, parentId?: string): string {
  if (type === 'answer') return parentId ? `https://www.zhihu.com/question/${parentId}/answer/${id}` : `https://www.zhihu.com/answer/${id}`
  if (type === 'article') return `https://zhuanlan.zhihu.com/p/${id}`
  if (type === 'question') return `https://www.zhihu.com/question/${id}`
  return `https://www.zhihu.com/pin/${id}`
}
function titleFor(type: ZhihuContentType, target: UnknownRecord): string {
  const question = record(target.question); const author = record(target.author)
  if (type === 'answer') return text(question?.title) || text(target.title) || `${text(author?.name) || '知乎用户'}的回答`
  if (type === 'pin') return text(target.title) || `${text(author?.name) || '知乎用户'}的想法`
  return text(target.title) || text(question?.title)
}
function summaryFor(target: UnknownRecord): string {
  const raw = text(target.excerpt) || text(target.description) || text(target.detail) || text(target.content) || text(record(target.author)?.headline)
  return stripHtml(raw).slice(0, 220)
}
function publishedAtFor(target: UnknownRecord, fallback: number): { value: number; real: boolean } {
  const seconds = integer(target.created_time ?? target.createdTime ?? target.updated_time ?? target.updatedTime)
  if (seconds && seconds > 0) return { value: seconds > 10_000_000_000 ? seconds : seconds * 1000, real: true }
  return { value: fallback, real: false }
}
function imageFor(target: UnknownRecord): string | undefined {
  const thumbnail = record(target.thumbnail); const cover = record(target.cover); const rawContent = text(target.content)
  return safeImage(target.thumbnail, thumbnail?.url, thumbnail?.original, target.image_url, target.imageUrl, target.cover_url, target.coverUrl, cover?.url, firstImage(rawContent))
}

export function zhihuTargetToArticle(source: NewsSource, rawTarget: unknown, fetchedAt = Date.now()): Article | undefined {
  const target = unwrapFeedTarget(rawTarget); if (!target) return undefined
  const type = contentTypeOf(target); if (!type) return undefined
  const id = text(target.id); if (!id) return undefined
  const question = record(target.question)
  const parentId = type === 'answer' ? text(question?.id) || undefined : undefined
  const title = stripHtml(titleFor(type, target)); if (!title) return undefined
  const url = articleUrl(type, id, parentId); const published = publishedAtFor(target, fetchedAt)
  const contentHtml = safeBody(target.content ?? target.detail)
  return {
    id: `${source.id}:${type}:${id}`,
    title, summary: summaryFor(target), contentHtml, image: imageFor(target), publishedAt: published.value, hasRealDate: published.real,
    sourceId: source.id, sourceName: source.name, sourceLabel: source.label, sourceGroup: source.group, originUrl: url,
    contentType: 'article', externalRef: { provider: 'zhihu-main', type, id, parentId },
  }
}
function pagingOf(payload: UnknownRecord): ZhihuPaging | undefined {
  const paging = record(payload.paging); if (!paging) return undefined
  return { isEnd: typeof paging.is_end === 'boolean' ? paging.is_end : typeof paging.isEnd === 'boolean' ? paging.isEnd : undefined, next: text(paging.next) || undefined, previous: text(paging.previous) || undefined }
}
function payloadEntries(payload: UnknownRecord): unknown[] {
  const direct = array(payload.data); if (direct.length) return direct
  const results = array(payload.results); if (results.length) return results
  return array(payload.items)
}
export function normalizeZhihuList(source: NewsSource, payload: unknown, fetchedAt = Date.now()): ZhihuListResult {
  const root = record(payload); if (!root) return { articles: [] }
  const seen = new Set<string>()
  const articles = payloadEntries(root).flatMap((entry) => {
    const article = zhihuTargetToArticle(source, entry, fetchedAt)
    if (!article || seen.has(article.id)) return []
    seen.add(article.id); return [article]
  })
  return { articles, paging: pagingOf(root) }
}
export function normalizeZhihuListJson(source: NewsSource, payload: string, fetchedAt = Date.now()): ZhihuListResult {
  try { return normalizeZhihuList(source, JSON.parse(payload) as unknown, fetchedAt) } catch { return { articles: [] } }
}
