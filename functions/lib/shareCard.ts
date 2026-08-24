/**
 * 分享深链 `/a/<token>` 的社交卡片。
 *
 * 微信、WhatsApp、Telegram 这类客户端是按抓到的 HTML 里的 Open Graph 标签
 * 渲染链接卡片的，而 SPA 回退给出的 `index.html` 只有通用的空壳标签，
 * 于是链接在聊天里就是一串裸地址。
 *
 * 这里的做法仍然是无后端的：token 里已经有原文地址与信源 id，边缘节点
 * 现抓一次原文、只从 `<head>` 里取标题/摘要/首图，拼出一页极简的 OG HTML。
 * 不落库、不建 API，抓不到就退回通用文案。
 *
 * 只有爬虫才会拿到这页；普通浏览器继续走 SPA 回退，阅读路径完全不变。
 */

import {
  SHARE_PATH_PREFIX,
  decodeShareToken,
  shareTokenFromPath,
  type SharePayload,
} from '../../src/lib/shareToken.ts'
import { findSource } from '../../src/sources/registry.ts'

/** 明确以抓取为目的的 UA，命中即认为要卡片而不是要页面 */
const CRAWLER_UA =
  /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|vkShare|W3C_Validator|redditbot|Applebot|PinterestBot|Baiduspider|bingbot|Googlebot|Yisouspider|Sogou\s*web\s*spider/i

/**
 * 微信抓卡片与微信内置浏览器共用同一个 UA，只能靠请求头再分一次：
 * 真实导航会带 Sec-Fetch-*（内置浏览器基于 Chromium），抓取端不带。
 * 判错的代价也只是多一跳——卡片页里的 meta refresh 会把人送回 SPA。
 */
const WECHAT_UA = /MicroMessenger|wxwork/i

/**
 * 卡片页给真人看时的逃生门：带上这个参数即回到 SPA，
 * 避免 meta refresh 指回同一地址后来回打转。
 */
export const SHARE_CARD_BYPASS_PARAM = 'app'

const SITE_NAME = '有所闻 · NewsNook'
const FALLBACK_TITLE = '有所闻分享'
const FALLBACK_DESCRIPTION = '点击在有所闻中阅读全文'

const UPSTREAM_TIMEOUT_MS = 3000
/** 只要 `<head>`，读到这么多字节就够了，免得为一张卡片把整篇正文拉下来 */
const UPSTREAM_READ_LIMIT = 128 * 1024
const MAX_TITLE_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 200

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface PageMeta {
  title?: string
  description?: string
  image?: string
}

/** 这次请求要的是卡片（爬虫），还是页面（真人） */
export function wantsShareCard(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? ''
  if (CRAWLER_UA.test(ua)) return true
  return WECHAT_UA.test(ua) && !request.headers.get('sec-fetch-mode')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

/** 上游标题里常见 `&amp;` `&#8212;` 这类实体，先还原成文本，输出时再统一转义 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

function normalizeText(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const ATTRIBUTE_PATTERN = /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return attributes
}

/**
 * 从 HTML 的 `<head>` 里挑出卡片要用的三样东西。
 * 不上 Readability / DOM 解析：卡片只需要几个 meta，正则足够且在边缘更省时间。
 */
export function extractPageMeta(html: string, baseUrl?: string): PageMeta {
  const head = html.slice(0, UPSTREAM_READ_LIMIT)
  const byKey = new Map<string, string>()

  for (const match of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const key = (attributes.property || attributes.name || attributes.itemprop || '').toLowerCase()
    const content = attributes.content
    if (!key || !content || byKey.has(key)) continue
    byKey.set(key, content)
  }

  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  const title = normalizeText(
    byKey.get('og:title') || byKey.get('twitter:title') || titleTag,
    MAX_TITLE_LENGTH,
  )
  const description = normalizeText(
    byKey.get('og:description') || byKey.get('twitter:description') || byKey.get('description'),
    MAX_DESCRIPTION_LENGTH,
  )
  const image = absoluteHttpUrl(
    byKey.get('og:image') || byKey.get('og:image:url') || byKey.get('twitter:image'),
    baseUrl,
  )

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
  }
}

function absoluteHttpUrl(value: string | undefined, baseUrl?: string): string | undefined {
  const raw = value && decodeEntities(value).trim()
  if (!raw) return undefined
  try {
    const resolved = new URL(raw, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return undefined
    return resolved.href
  } catch {
    return undefined
  }
}

/** 中文站点仍有不少 GBK 页面，`<title>` 解错就成乱码，所以先认一下编码 */
function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const utf8 = new TextDecoder().decode(bytes)
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ||
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(utf8.slice(0, 4096))?.[1]
  const label = declared?.toLowerCase()
  if (!label || label === 'utf-8' || label === 'utf8') return utf8
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return utf8
  }
}

async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()

  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      size += value.length
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  const merged = new Uint8Array(Math.min(size, limit))
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= merged.length) break
    const slice = chunk.subarray(0, merged.length - offset)
    merged.set(slice, offset)
    offset += slice.length
  }
  return merged
}

/** 抓一次原文；超时、非 HTML、上游报错都当作「没抓到」，由调用方退回通用文案 */
async function fetchPageMeta(originUrl: string): Promise<PageMeta> {
  try {
    const target = new URL(originUrl)
    const response = await fetch(originUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: `${target.origin}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return {}

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return {}

    const bytes = await readCapped(response, UPSTREAM_READ_LIMIT)
    return extractPageMeta(decodeHtml(bytes, contentType), response.url || originUrl)
  } catch {
    return {}
  }
}

/** 卡片副标题里的「原文来自 xxx」：认识的信源用注册表里的中文名，否则退回域名 */
function describeSource(payload: SharePayload): string {
  const registered = findSource(payload.sourceId)?.name?.trim()
  if (registered) return registered
  try {
    return new URL(payload.originUrl).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

function composeDescription(base: string | undefined, sourceName: string): string {
  const text = base || FALLBACK_DESCRIPTION
  const suffix = sourceName ? ` · 原文来自 ${sourceName}` : ''
  const room = MAX_DESCRIPTION_LENGTH - suffix.length
  const head = text.length > room ? `${text.slice(0, Math.max(1, room - 1))}…` : text
  return `${head}${suffix}`
}

export function renderShareCard(card: {
  title: string
  description: string
  shareUrl: string
  bounceUrl: string
  image?: string
}): string {
  const title = escapeHtml(card.title)
  const description = escapeHtml(card.description)
  const shareUrl = escapeHtml(card.shareUrl)
  const bounceUrl = escapeHtml(card.bounceUrl)
  const image = card.image ? escapeHtml(card.image) : ''

  return `<!DOCTYPE html><html lang="zh-CN"><head>
<meta charset="utf-8">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${shareUrl}">${
    image ? `\n<meta property="og:image" content="${image}">` : ''
  }
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">${
    image ? `\n<meta name="twitter:image" content="${image}">` : ''
  }
<meta name="description" content="${description}">
<title>${title} - 有所闻</title>
<meta http-equiv="refresh" content="0;url=${bounceUrl}">
</head><body></body></html>
`
}

/**
 * 命中分享深链且请求方是爬虫时返回卡片 HTML；其余情况返回 null，
 * 由 worker 继续走 SPA 回退。
 */
export async function shareCardResponse(request: Request, url: URL): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (!url.pathname.startsWith(SHARE_PATH_PREFIX)) return null
  if (url.searchParams.has(SHARE_CARD_BYPASS_PARAM)) return null
  if (!wantsShareCard(request)) return null

  // 路径不成形（`/a/` 或多段）就不是分享深链，交回 SPA；token 解不出来才给通用卡片
  const token = shareTokenFromPath(url.pathname)
  if (!token) return null

  const payload = decodeShareToken(token)
  const meta = payload ? await fetchPageMeta(payload.originUrl) : {}
  const sourceName = payload ? describeSource(payload) : ''

  const shareUrl = `${url.origin}${url.pathname}`
  const bounceUrl = `${shareUrl}?${SHARE_CARD_BYPASS_PARAM}=1`
  const html = renderShareCard({
    title: meta.title || FALLBACK_TITLE,
    description: composeDescription(meta.description, sourceName),
    shareUrl,
    bounceUrl,
    ...(meta.image ? { image: meta.image } : {}),
  })

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 爬虫常常重复抓同一条链接，短缓存足够挡住抖动，又不会长期钉住旧标题
      'Cache-Control': 'public, max-age=600',
      // 同一地址对真人给的是 SPA，中间缓存不能把卡片复用过去
      Vary: 'User-Agent',
    },
  })
}
