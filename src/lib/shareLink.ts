/**
 * 站内分享短链：`https://news.aizeek.com/a/<token>`。
 *
 * token 用 URL-safe base64 携带「打开阅读器所需的最小信息」，
 * 接收方由 Web 客户端本地解码后走既有 resolveBody 全文链路，
 * 不落任何服务端存储、不建业务 API——链接本身即全部数据。
 *
 * 与「打开原文」的区别：这里的主链接始终指向站内阅读，
 * 出版社地址只作为 payload 里的字段，用于抽取正文与用户主动核对。
 *
 * ## v2 载荷（当前版本）
 *
 * 中文标题、摘要、信源名在 UTF-8 + base64 下膨胀到三倍，v1 的 JSON 载荷
 * 动辄 400～600 字符，粘进聊天工具容易被折行或截断。v2 只留「能打开这篇」
 * 的两个必需字段，明文改成换行分隔的紧凑格式（比 JSON 再省掉键名与引号）：
 *
 * ```text
 * 第 1 行  "2.<校验位>"：版本号 + 其余内容的短哈希
 * 第 2 行  sourceId
 * 第 3 行  原文地址，https:// 前缀省略不写
 * 第 4 行  可选 id；以 ':' 开头表示补回 `<sourceId>:` 前缀
 * ```
 *
 * 校验位存在的理由：紧凑载荷被聊天工具截断后仍可能解出一个「看着合法」的
 * 短地址，那会静默打开错误的页面。校验不过就当损坏处理，弹中文提示。
 *
 * 标题打开后由正文抽取补上（在此之前显示占位），信源名从 registry 查。
 * 绝大多数条目的 id 就是 `<sourceId>:<原文地址哈希>`（见 lib/articleId），
 * 接收端能自己算出来，第 4 行因此通常不出现。
 *
 * v1 的 JSON 载荷仍然可解码，旧链接不会失效。
 */

import { Capacitor } from '@capacitor/core'

import { findSource, type NewsSource } from '../sources/registry'
import { feedArticleId, hashId } from './articleId'
import type { Article } from './types'

/** 生产 Web 站点 host；App 内分享出去的链接一律指向这里 */
export const SHARE_LINK_HOST = 'news.aizeek.com'
export const SHARE_LINK_ORIGIN = `https://${SHARE_LINK_HOST}`
/** 深链路径前缀，SPA 回退规则与 App 冷启动都按它匹配 */
export const SHARE_PATH_PREFIX = '/a/'

const SHARE_TOKEN_VERSION = 2
const LEGACY_TOKEN_VERSION = 1

/** 超出一律视为被篡改或被拼接，直接拒绝；仍按 v1 的宽度留着，旧链接才打得开 */
export const MAX_SHARE_TOKEN_LENGTH = 2048
/** 常见文章（网易 / 公众号 / RSS）编出来的 v2 token 应落在这个长度内 */
export const SHARE_TOKEN_TYPICAL_LIMIT = 120
/** v2 不带标题；正文抽取补回真标题前，阅读器与列表先用这个占位 */
export const SHARE_PENDING_TITLE = '加载中…'
/** 正文抽取失败时的标题兜底，免得「加载中…」一直挂在顶上 */
export const SHARE_FALLBACK_TITLE = '分享的文章'

const MAX_TITLE_LENGTH = 200
const MAX_SUMMARY_LENGTH = 90
const MAX_ID_LENGTH = 256
const MAX_NAME_LENGTH = 60
const MAX_ORIGIN_URL_LENGTH = 800
/** 算不出来的 id 才写进链接，且必须足够短，否则宁可让接收端自己算 */
const MAX_INLINE_ID_LENGTH = 40
/** 校验位长度：只用来发现截断与手抖改字，不作防篡改用途 */
const CHECKSUM_LENGTH = 4

/**
 * 分享 token 里可能出现的字段。
 * v2 只保证 `originUrl` 与 `sourceId`；其余都是 v1 链接的遗留信息。
 */
export interface SharePayload {
  /** 出版社地址：接收方抽取正文与「浏览器核对原文」都用它 */
  originUrl: string
  sourceId: string
  /** 无法由 sourceId + 原文地址推出时才带 */
  id?: string
  title?: string
  sourceName?: string
  summary?: string
  publishedAt?: number
}

/** v1 线上格式：短键 JSON */
interface LegacyShareWire {
  v: number
  i: string
  t: string
  u: string
  s: string
  n: string
  d?: string
  p?: number
}

function isDev(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV)
}

function clip(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(token: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null
  const padded = token.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (padded.length % 4)) % 4
  try {
    const binary = atob(padded + '='.repeat(padding))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/**
 * 只认 http/https，挡掉 javascript: / data: 之类的注入面。
 * 校验通过后原样返回：归一化会改动哈希输入，导致接收端算不出发送端的 id。
 */
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ORIGIN_URL_LENGTH) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}

function nonEmptyString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

/** https 是绝大多数情况，前缀省掉能少占 11 个 base64 字符 */
function compactOriginUrl(url: string): string {
  return url.startsWith('https://') ? url.slice('https://'.length) : url
}

function expandOriginUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

/** id 能由 sourceId + 原文地址算出来就不写进链接；写的话也去掉冗余的 `<sourceId>:` 前缀 */
function compactArticleId(payload: SharePayload): string | null {
  const id = payload.id?.trim()
  if (!id) return null
  if (id === feedArticleId(payload.sourceId, payload.originUrl)) return null
  const prefix = `${payload.sourceId}:`
  const short = id.startsWith(prefix) ? `:${id.slice(prefix.length)}` : id
  return short.length > MAX_INLINE_ID_LENGTH ? null : short
}

/** 从当前文章取出可分享的最小字段 */
export function sharePayloadFromArticle(article: Article): SharePayload {
  const id = clip(article.id, MAX_ID_LENGTH)
  return {
    originUrl: article.originUrl,
    sourceId: clip(article.sourceId, MAX_ID_LENGTH),
    ...(id ? { id } : {}),
  }
}

function checksum(body: string): string {
  return hashId(body).slice(0, CHECKSUM_LENGTH)
}

export function encodeShareToken(payload: SharePayload): string {
  const lines = [payload.sourceId, compactOriginUrl(payload.originUrl)]
  const inlineId = compactArticleId(payload)
  if (inlineId) lines.push(inlineId)
  const body = lines.join('\n')
  return toBase64Url(
    new TextEncoder().encode(`${SHARE_TOKEN_VERSION}.${checksum(body)}\n${body}`),
  )
}

function decodeV2(text: string): SharePayload | null {
  const headerEnd = text.indexOf('\n')
  if (headerEnd < 0) return null
  const body = text.slice(headerEnd + 1)
  if (text.slice(1, headerEnd) !== `.${checksum(body)}`) return null

  const lines = body.split('\n')
  const sourceId = nonEmptyString(lines[0], MAX_ID_LENGTH)
  const originUrl = safeHttpUrl(expandOriginUrl((lines[1] ?? '').trim()))
  if (!sourceId || !originUrl) return null

  const rawId = lines[2]?.trim()
  const id = rawId ? (rawId.startsWith(':') ? `${sourceId}${rawId}` : rawId) : ''
  return {
    originUrl,
    sourceId,
    ...(id && id.length <= MAX_ID_LENGTH ? { id } : {}),
  }
}

function decodeV1(text: string): SharePayload | null {
  let wire: unknown
  try {
    wire = JSON.parse(text)
  } catch {
    return null
  }
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return null

  const raw = wire as Partial<LegacyShareWire>
  if (raw.v !== LEGACY_TOKEN_VERSION) return null

  const id = nonEmptyString(raw.i, MAX_ID_LENGTH)
  const title = nonEmptyString(raw.t, MAX_TITLE_LENGTH)
  const originUrl = safeHttpUrl(raw.u)
  const sourceId = nonEmptyString(raw.s, MAX_ID_LENGTH)
  if (!id || !title || !originUrl || !sourceId) return null

  const sourceName = nonEmptyString(raw.n, MAX_NAME_LENGTH)
  const summary = nonEmptyString(raw.d, MAX_SUMMARY_LENGTH)
  const publishedAt =
    typeof raw.p === 'number' && Number.isFinite(raw.p) && raw.p > 0 ? Math.round(raw.p) : undefined

  return {
    originUrl,
    sourceId,
    id,
    title,
    sourceName: sourceName ?? '',
    ...(summary ? { summary } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  }
}

/** 解码失败一律返回 null，由调用方给中文提示并降级，不抛异常打断冷启动 */
export function decodeShareToken(token: string): SharePayload | null {
  const trimmed = token.trim()
  if (!trimmed || trimmed.length > MAX_SHARE_TOKEN_LENGTH) return null
  const bytes = fromBase64Url(trimmed)
  if (!bytes) return null

  const text = new TextDecoder().decode(bytes)
  if (text.startsWith(`${SHARE_TOKEN_VERSION}.`)) return decodeV2(text)
  return decodeV1(text)
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

export function buildShareUrl(payload: SharePayload, options?: { origin?: string }): string {
  const origin = (options?.origin ?? resolveShareOrigin()).replace(/\/+$/, '')
  return `${origin}${SHARE_PATH_PREFIX}${encodeShareToken(payload)}`
}

/** 展示用短链：去掉协议，卡片上一行放得下 */
export function shareUrlDisplay(url: string, maxLength = 42): string {
  const bare = url.replace(/^https?:\/\//, '')
  return bare.length > maxLength ? `${bare.slice(0, maxLength - 1)}…` : bare
}

/** 从 pathname 里取出 token；只认 `/a/<token>`，多段路径不接受 */
export function shareTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith(SHARE_PATH_PREFIX)) return null
  const token = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '')
  if (!token || token.includes('/')) return null
  return token
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
 * v2 链接不带标题与时间，先给占位值；正文抽取就绪后由 withResolvedShareTitle 补齐。
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
