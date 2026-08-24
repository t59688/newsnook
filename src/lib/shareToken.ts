/**
 * 分享短链 token 的编解码。
 *
 * 单独成模块的原因：除了 App 自身，边缘 worker（`functions/`）也要解 token
 * 才能给社交爬虫拼出 Open Graph 卡片，而 worker 里不能出现 Capacitor、
 * window 之类的浏览器/原生依赖。这里只留纯函数，浏览器侧的链接组装、
 * Article 还原等仍在 `lib/shareLink`。
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
 * 末   行  可选 salt；以 '~' 开头，解码时忽略
 * ```
 *
 * 校验位存在的理由：紧凑载荷被聊天工具截断后仍可能解出一个「看着合法」的
 * 短地址，那会静默打开错误的页面。校验不过就当损坏处理，弹中文提示。
 *
 * salt 行存在的理由：微信、WhatsApp 都按 URL 缓存链接预览，同一条链接
 * 一旦抓到过旧卡片（例如部署修复前的通用文案），之后怎么发都不刷新。
 * 每次分享时带一个新 salt，token 与 URL 就换了一条，平台被迫重新抓取。
 * salt 不参与打开文章——接收端解码时直接跳过 '~' 行，文章 id 仍由
 * sourceId + 原文地址算出，已读、缓存、稍后读都对得上。
 *
 * 标题打开后由正文抽取补上（在此之前显示占位），信源名从 registry 查。
 * 绝大多数条目的 id 就是 `<sourceId>:<原文地址哈希>`（见 lib/articleId），
 * 接收端能自己算出来，第 4 行因此通常不出现。
 *
 * v1 的 JSON 载荷仍然可解码，旧链接不会失效。
 */

import { feedArticleId, hashId } from './articleId'

/** 深链路径前缀，SPA 回退规则、边缘 worker 与 App 冷启动都按它匹配 */
export const SHARE_PATH_PREFIX = '/a/'

/** 生产 Web 站点 host；App 内分享出去的链接与 Android App Links 都指向这里 */
export const SHARE_LINK_HOST = 'news.aizeek.com'
export const SHARE_LINK_ORIGIN = `https://${SHARE_LINK_HOST}`

const SHARE_TOKEN_VERSION = 2
const LEGACY_TOKEN_VERSION = 1

/** 超出一律视为被篡改或被拼接，直接拒绝；仍按 v1 的宽度留着，旧链接才打得开 */
export const MAX_SHARE_TOKEN_LENGTH = 2048
/** 常见文章（网易 / 公众号 / RSS）编出来的 v2 token 应落在这个长度内 */
export const SHARE_TOKEN_TYPICAL_LIMIT = 120

export const MAX_ID_LENGTH = 256

const MAX_TITLE_LENGTH = 200
const MAX_SUMMARY_LENGTH = 90
const MAX_NAME_LENGTH = 60
const MAX_ORIGIN_URL_LENGTH = 800
/** 算不出来的 id 才写进链接，且必须足够短，否则宁可让接收端自己算 */
const MAX_INLINE_ID_LENGTH = 40
/** 校验位长度：只用来发现截断与手抖改字，不作防篡改用途 */
const CHECKSUM_LENGTH = 4
/** salt 行前缀：以它开头的行在解码时整行跳过 */
const SALT_LINE_PREFIX = '~'
/** salt 只是换 URL 用的随机数，太长白占字符 */
const MAX_SALT_LENGTH = 8

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
  // '~' 开头的行是 salt 的记号，撞上的 id 宁可丢掉让接收端自己算
  if (short.startsWith(SALT_LINE_PREFIX)) return null
  return short.length > MAX_INLINE_ID_LENGTH ? null : short
}

function checksum(body: string): string {
  return hashId(body).slice(0, CHECKSUM_LENGTH)
}

/** 「再次分享换新链接」用的短随机数；不作安全用途，撞了也无妨 */
export function newShareSalt(): string {
  return Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0')
}

/** salt 只允许 base36 字符且限长；不合规的整个丢掉，别让链接变脏 */
function sanitizeSalt(salt: string | undefined): string | null {
  const value = salt?.trim().toLowerCase()
  if (!value || value.length > MAX_SALT_LENGTH) return null
  return /^[0-9a-z]+$/.test(value) ? value : null
}

export function encodeShareToken(payload: SharePayload, options?: { salt?: string }): string {
  const lines = [payload.sourceId, compactOriginUrl(payload.originUrl)]
  const inlineId = compactArticleId(payload)
  if (inlineId) lines.push(inlineId)
  const salt = sanitizeSalt(options?.salt)
  if (salt) lines.push(`${SALT_LINE_PREFIX}${salt}`)
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

  // salt 行只为换 URL 而存在，校验完整性之后就与打开文章无关
  const lines = body.split('\n').filter((line) => !line.startsWith(SALT_LINE_PREFIX))
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

/** 从 pathname 里取出 token；只认 `/a/<token>`，多段路径不接受 */
export function shareTokenFromPath(pathname: string): string | null {
  if (!pathname.startsWith(SHARE_PATH_PREFIX)) return null
  const token = pathname.slice(SHARE_PATH_PREFIX.length).replace(/\/+$/, '')
  if (!token || token.includes('/')) return null
  return token
}
