import { fetchZhihuCommentsRaw } from '../../zhihu/service'
import type { CommentItem, CommentProvider, CommentQuote, CommentsQueryResult } from '../types'

type UnknownRecord = Record<string, unknown>
function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value == null ? '' : String(value) }
function number(value: unknown): number { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0 }
function cleanHtml(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim()
}
function formattedTime(seconds: number): string {
  if (!seconds) return '刚刚'
  const diff = Math.max(0, Date.now() - seconds * 1000)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}天前`
  const date = new Date(seconds * 1000)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
function contentRef(article: { sourceId?: string; originUrl?: string }): { type: string; id: string } | undefined {
  if (article.sourceId !== 'zhihu-main') return undefined
  const url = article.originUrl || ''
  let match = url.match(/\/question\/\d+\/answer\/(\d+)/)
  if (match?.[1]) return { type: 'answer', id: match[1] }
  match = url.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/)
  if (match?.[1]) return { type: 'article', id: match[1] }
  match = url.match(/\/question\/(\d+)/)
  if (match?.[1]) return { type: 'question', id: match[1] }
  match = url.match(/\/pin\/(\d+)/)
  if (match?.[1]) return { type: 'pin', id: match[1] }
  return undefined
}
function parseComment(raw: unknown): CommentItem | undefined {
  const item = record(raw); if (!item) return undefined
  const id = text(item.id); if (!id) return undefined
  const author = record(item.author); const member = record(author?.member) ?? author
  const reply = record(item.reply_to_author ?? item.replyToAuthor ?? item.reply_to)
  const quotes: CommentQuote[] = []
  if (reply) {
    const quoteAuthor = text(record(reply.member)?.name ?? reply.name ?? reply.author)
    const quoteContent = cleanHtml(text(reply.content))
    if (quoteAuthor || quoteContent) quotes.push({ id: text(reply.id) || `${id}-reply`, author: quoteAuthor || '知乎用户', content: quoteContent })
  }
  const votes = number(item.vote_count ?? item.voteCount ?? item.like_count ?? item.likeCount)
  return {
    id,
    author: text(member?.name) || '知乎用户',
    avatar: text(member?.avatar_url ?? member?.avatarUrl) || undefined,
    content: cleanHtml(text(item.content)),
    createTimeFormatted: formattedTime(number(item.created_time ?? item.createdTime)),
    voteCount: votes,
    quotes: quotes.length ? quotes : undefined,
    isHot: votes >= 20,
  }
}
async function queryComments(article: { id: string; sourceId?: string; originUrl?: string }, offset: number | string, signal?: AbortSignal): Promise<CommentsQueryResult> {
  const ref = contentRef(article)
  if (!ref) return { comments: [], totalCount: 0, availableTabs: [], hasMore: false }
  const nextUrl = typeof offset === 'string' && /^https:\/\/www\.zhihu\.com\/api\//.test(offset) ? offset : undefined
  const payload = await fetchZhihuCommentsRaw(ref.type, ref.id, nextUrl, signal)
  const list = Array.isArray(payload.data) ? payload.data : []
  const comments = list.flatMap((raw) => { const parsed = parseComment(raw); return parsed ? [parsed] : [] })
  const paging = record(payload.paging)
  const next = text(paging?.next)
  const isEnd = paging?.is_end === true || paging?.isEnd === true
  return {
    comments,
    totalCount: number(payload.count ?? payload.comment_count ?? payload.commentCount) || comments.length,
    availableTabs: [{ id: 'latest', label: '评论' }],
    hasMore: Boolean(next && !isEnd),
    nextOffset: next || undefined,
  }
}

export const zhihuMainCommentProvider: CommentProvider = {
  canHandle(article) { return article.sourceId === 'zhihu-main' && Boolean(contentRef(article)) },
  async getComments(article, _tab, offset = 0, signal) { return queryComments(article, offset, signal) },
  async getSummaryCount(article, signal) { return (await queryComments(article, 0, signal)).totalCount },
}
