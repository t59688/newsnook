/**
 * 站内分享短链：`https://news.aizeek.com/a/<token>`。
 *
 * token 用 URL-safe base64 携带「打开阅读器所需的最小信息」，
 * 接收方由 Web 客户端本地解码后走既有 resolveBody 全文链路，
 * 不落任何服务端存储、不建业务 API——链接本身即全部数据。
 * 载荷格式与编解码见 `lib/shareToken`（边缘 worker 也复用那一份）。
 *
 * 与「打开原文」的区别：这里的主链接始终指向站内阅读，
 * 出版社地址只作为 payload 里的字段，用于抽取正文与用户主动核对。
 */

import { Capacitor } from '@capacitor/core'

import { findSource, type NewsSource } from '../sources/registry'
import { feedArticleId } from './articleId'
import {
  MAX_ID_LENGTH,
  SHARE_LINK_ORIGIN,
  SHARE_PATH_PREFIX,
  decodeShareToken,
  encodeShareToken,
  shareTokenFromPath,
  type SharePayload,
} from './shareToken'
import type { Article } from './types'

export {
  MAX_SHARE_TOKEN_LENGTH,
  MAX_TOKEN_SUMMARY_LENGTH,
  MAX_TOKEN_TITLE_LENGTH,
  SHARE_LINK_HOST,
  SHARE_LINK_ORIGIN,
  SHARE_PATH_PREFIX,
  SHARE_TOKEN_TYPICAL_LIMIT,
  decodeShareToken,
  encodeShareToken,
  newShareSalt,
  shareTokenFromPath,
} from './shareToken'
export type { SharePayload } from './shareToken'
/** 链接没带标题时（旧链接 / 超长标题），正文抽取补回真标题前先用这个占位 */
export const SHARE_PENDING_TITLE = '加载中…'
/** 正文抽取失败时的标题兜底，免得「加载中…」一直挂在顶上 */
export const SHARE_FALLBACK_TITLE = '分享的文章'

function isDev(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
}

function clip(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

/** 导语只取正文开头一小段，整篇 HTML 没必要全扫一遍 */
const LEAD_SCAN_LIMIT = 4000

const LEAD_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
}

/**
 * 把摘要或正文片段压成一行纯文本导语：去标签、还原常见实体、折叠空白。
 * 列表摘要通常已是纯文本，正文 HTML 则要先剥一层标签才拿得到「【IT之家】…」这样的开头。
 */
export function shareLeadText(input?: string): string | undefined {
  if (!input) return undefined
  const text = input
    .slice(0, LEAD_SCAN_LIMIT)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    // 段落级标签换成空格（否则相邻段落会黏成一个词），行内标签直接去掉，
    // 免得中文句子里被塞进「界面 新闻」这样的空隙
    .replace(/<\/?(?:p|br|div|li|tr|h[1-6]|section|article|blockquote|figcaption)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match: string, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match
      }
      return LEAD_ENTITIES[body.toLowerCase()] ?? match
    })
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}

/**
 * 从当前文章取出可分享的最小字段。
 * 标题与导语也带上：聊天预览卡靠它们显示「这是哪一篇、大概讲什么」，
 * 边缘抓不到原文时不至于退回通用文案（占位标题不算真标题，
 * 超长标题由 encodeShareToken 自行丢弃，导语则按上限截断）。
 *
 * `bodyHtml` 是可选的正文兜底：分享深链打开的文章列表摘要为空，
 * 这时从已抽好的正文开头取一段，卡片小字才不会落回「点击在有所闻中阅读全文」。
 */
export function sharePayloadFromArticle(
  article: Article,
  options?: { bodyHtml?: string },
): SharePayload {
  const id = clip(article.id, MAX_ID_LENGTH)
  const title = usableShareTitle(article.title)
  const summary = shareLeadText(article.summary) ?? shareLeadText(options?.bodyHtml)
  return {
    originUrl: article.originUrl,
    sourceId: clip(article.sourceId, MAX_ID_LENGTH),
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  }
}

/**
 * 生成分享链接的站点根：
 * 开发态用当前 origin 方便本机验证深链，其余（含 Android 原生壳）固定生产 host。
 */
export function resolveShareOrigin(): string {
  if (Capacitor.isNativePlatform()) return SHARE_LINK_ORIGIN
  if (typeof window === 'undefined' || !isDev()) return SHARE_LINK_ORIGIN
  const { origin, protocol } = window.location
  if (protocol !== 'http:' && protocol !== 'https:') return SHARE_LINK_ORIGIN
  return origin
}

/**
 * 组装站内短链。`salt` 用于「再次分享换一条新 URL」：
 * 微信、WhatsApp 按 URL 缓存预览，旧链接的卡片刷不动，只有换 URL 才会重抓。
 * salt 编进 token 的 '~' 行，接收端解码时忽略，打开的仍是同一篇。
 */
export function buildShareUrl(
  payload: SharePayload,
  options?: { origin?: string; salt?: string },
): string {
  const origin = (options?.origin ?? resolveShareOrigin()).replace(/\/+$/, '')
  return `${origin}${SHARE_PATH_PREFIX}${encodeShareToken(payload, { salt: options?.salt })}`
}

/** 展示用短链：去掉协议，卡片上一行放得下 */
export function shareUrlDisplay(url: string, maxLength = 42): string {
  const bare = url.replace(/^https?:\/\//, '')
  return bare.length > maxLength ? `${bare.slice(0, maxLength - 1)}…` : bare
}

export function parseShareUrl(url: string): SharePayload | null {
  try {
    const token = shareTokenFromPath(new URL(url).pathname)
    return token ? decodeShareToken(token) : null
  } catch {
    return null
  }
}

/** 冷启动入口：当前地址是分享深链时返回 payload，路径不匹配返回 undefined */
export function shareTargetFromLocation(pathname?: string): SharePayload | null | undefined {
  const path = pathname ?? (typeof window === 'undefined' ? '' : window.location.pathname)
  const token = shareTokenFromPath(path)
  if (!token) return undefined
  return decodeShareToken(token)
}

/** 阅读器关掉后把深链换回站点根，避免之后刷新又被拉回同一篇 */
export function clearShareLocation(): void {
  if (typeof window === 'undefined') return
  if (!shareTokenFromPath(window.location.pathname)) return
  window.history.replaceState(null, '', '/')
}

/**
 * 把 payload 还原成 Article：本机认识该信源时以注册表为准（名称/分组/标签更完整），
 * 不认识就退回链接里带的信源名，正文仍走通用 Readability 抽取。
 *
 * 链接不带标题时先给占位值；正文抽取就绪后由 withResolvedShareTitle 补齐。时间同理不入链。
 */
export function articleFromSharePayload(
  payload: SharePayload,
  extraSources?: NewsSource[],
): Article {
  const source = findSource(payload.sourceId, extraSources)
  const name = source?.name || payload.sourceName || '分享来源'
  return {
    id: payload.id || feedArticleId(payload.sourceId, payload.originUrl),
    title: payload.title || SHARE_PENDING_TITLE,
    summary: payload.summary ?? '',
    publishedAt: payload.publishedAt ?? Date.now(),
    hasRealDate: payload.publishedAt != null,
    sourceId: payload.sourceId,
    sourceName: name,
    sourceLabel: source?.label || name,
    sourceGroup: source?.group ?? 'custom',
    originUrl: payload.originUrl,
  }
}

export function isPendingShareTitle(title: string): boolean {
  return title === SHARE_PENDING_TITLE
}

/** 缓存里存的标题若不是占位，就能拿来回填分享深链打开的这一篇 */
export function usableShareTitle(title?: string): string | undefined {
  const value = title?.trim()
  if (!value || value === SHARE_PENDING_TITLE || value === SHARE_FALLBACK_TITLE) return undefined
  return value
}

/** 正文抽取拿到真标题后，用它替换占位标题；正文缓存、稍后读都存补齐后的这份 */
export function withResolvedShareTitle(article: Article, title?: string): Article {
  const resolved = title?.trim()
  if (!resolved || !isPendingShareTitle(article.title)) return article
  return { ...article, title: resolved }
}
