/**
 * 站内分享短链：`https://news.aizeek.com/a/<token>`。
 *
 * token 用 URL-safe base64 携带「打开阅读器所需的最小信息」，
 * 接收方由 Web 客户端本地解码后走既有 resolveBody 全文链路，
 * 不落任何服务端存储、不建业务 API——链接本身即全部数据。
 *
 * 与「打开原文」的区别：这里的主链接始终指向站内阅读，
 * 出版社地址只作为 payload 里的字段，用于抽取正文与用户主动核对。
 */

import { Capacitor } from '@capacitor/core'

import { findSource, type NewsSource } from '../sources/registry'
import type { Article } from './types'

/** 生产 Web 站点 host；App 内分享出去的链接一律指向这里 */
export const SHARE_LINK_HOST = 'news.aizeek.com'
export const SHARE_LINK_ORIGIN = `https://${SHARE_LINK_HOST}`
/** 深链路径前缀，SPA 回退规则与 App 冷启动都按它匹配 */
export const SHARE_PATH_PREFIX = '/a/'

const SHARE_TOKEN_VERSION = 1

/** 正常中文标题编完在 600 字符内；超出一律视为被篡改或被拼接，直接拒绝 */
export const MAX_SHARE_TOKEN_LENGTH = 2048
const MAX_TITLE_LENGTH = 200
const MAX_SUMMARY_LENGTH = 90
const MAX_ID_LENGTH = 256
const MAX_NAME_LENGTH = 60
const MAX_ORIGIN_URL_LENGTH = 800

/** 分享 token 里真正被编码的字段 */
export interface SharePayload {
  id: string
  title: string
  /** 出版社地址：接收方抽取正文与「浏览器核对原文」都用它 */
  originUrl: string
  sourceId: string
  sourceName: string
  summary?: string
  publishedAt?: number
}

/** 线上格式用短键，避免中文标题之外再多出无谓字节 */
interface ShareWire {
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

/** 只认 http/https，挡掉 javascript: / data: 之类的注入面 */
function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ORIGIN_URL_LENGTH) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
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

/** 从当前文章取出可分享的最小字段；标题允许传入译文等界面上真正显示的那一版 */
export function sharePayloadFromArticle(
  article: Article,
  options?: { title?: string },
): SharePayload {
  const title = clip(options?.title || article.title, MAX_TITLE_LENGTH) || '一篇文章'
  const summary = clip(article.summary ?? '', MAX_SUMMARY_LENGTH)
  return {
    id: clip(article.id, MAX_ID_LENGTH),
    title,
    originUrl: article.originUrl,
    sourceId: clip(article.sourceId, MAX_ID_LENGTH),
    sourceName: clip(article.sourceName || article.sourceLabel || '', MAX_NAME_LENGTH),
    ...(summary ? { summary } : {}),
    ...(article.publishedAt ? { publishedAt: Math.round(article.publishedAt) } : {}),
  }
}

export function encodeShareToken(payload: SharePayload): string {
  const wire: ShareWire = {
    v: SHARE_TOKEN_VERSION,
    i: payload.id,
    t: payload.title,
    u: payload.originUrl,
    s: payload.sourceId,
    n: payload.sourceName,
    ...(payload.summary ? { d: payload.summary } : {}),
    ...(payload.publishedAt ? { p: payload.publishedAt } : {}),
  }
  return toBase64Url(new TextEncoder().encode(JSON.stringify(wire)))
}

/** 解码失败一律返回 null，由调用方给中文提示并降级，不抛异常打断冷启动 */
export function decodeShareToken(token: string): SharePayload | null {
  if (!token || token.length > MAX_SHARE_TOKEN_LENGTH) return null
  const bytes = fromBase64Url(token)
  if (!bytes) return null

  let wire: unknown
  try {
    wire = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return null

  const raw = wire as Partial<ShareWire>
  if (raw.v !== SHARE_TOKEN_VERSION) return null

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
    id,
    title,
    originUrl,
    sourceId,
    sourceName: sourceName ?? '',
    ...(summary ? { summary } : {}),
    ...(publishedAt ? { publishedAt } : {}),
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
 */
export function articleFromSharePayload(
  payload: SharePayload,
  extraSources?: NewsSource[],
): Article {
  const source = findSource(payload.sourceId, extraSources)
  const name = source?.name || payload.sourceName || '分享来源'
  return {
    id: payload.id,
    title: payload.title,
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
