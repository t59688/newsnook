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
  encodeShareToken,
  shareTokenFromPath,
  type SharePayload,
} from '../../src/lib/shareToken.ts'
import { findSource } from '../../src/sources/registry.ts'

/** 明确以抓取为目的的 UA，命中即认为要卡片而不是要页面 */
const CRAWLER_UA =
  /facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot|vkShare|W3C_Validator|redditbot|Applebot|PinterestBot|Baiduspider|bingbot|Googlebot|Yisouspider|Sogou\s*web\s*spider/i

/**
 * 微信这类聊天 App 抓卡片与内置浏览器共用同一个 UA，只能靠请求头再分一次：
 * 真实导航会带 Sec-Fetch-*（内置浏览器基于 Chromium），抓取端不带。
 * 判错的代价也只是多一跳——卡片页里的 meta refresh 会把人送回 SPA。
 *
 * 微信侧的 UA 变体不止 `MicroMessenger`：企业微信是 `wxwork`，
 * 部分抓取链路上报 `WeChat` / `Weixin`。微博 / QQ / 钉钉的内置浏览器
 * 同样带各自的 App 标识，一并按 Sec-Fetch 分流。
 */
const CHAT_APP_UA = /MicroMessenger|wxwork|WeChat|Weixin|Weibo|DingTalk|\bQQ\//i

/**
 * 卡片页给真人看时的逃生门：带上这个参数即回到 SPA，
 * 避免 meta refresh 指回同一地址后来回打转。
 */
export const SHARE_CARD_BYPASS_PARAM = 'app'

const SITE_NAME = '有所闻'
const FALLBACK_TITLE = '有所闻分享'
/** token 可解但抓不到真标题时的「文章位」：观感仍是一篇文章，不是站点广告 */
const FALLBACK_ARTICLE_TITLE = '一篇文章'
const FALLBACK_DESCRIPTION = '点击在有所闻中阅读全文'

/** 品牌兜底图：上游没有首图时也必须有图，否则微信不出大图卡 */
export const OG_DEFAULT_IMAGE_PATH = '/og-default.png'
export const OG_DEFAULT_IMAGE_WIDTH = 1200
export const OG_DEFAULT_IMAGE_HEIGHT = 630
/** 卡片首图的同域端点后缀：`/a/<token>/og.png`，与卡片同在 /a/* 路径下 */
const OG_IMAGE_SUFFIX = '/og.png'
/** og.png 端点转发上游首图时的原始地址参数 */
const OG_IMAGE_SRC_PARAM = 'src'

const UPSTREAM_TIMEOUT_MS = 3000
/** 只要 `<head>`，读到这么多字节就够了，免得为一张卡片把整篇正文拉下来 */
const UPSTREAM_READ_LIMIT = 128 * 1024
const MAX_TITLE_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 200

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
/**
 * 第二把钥匙：InfoQ 这类站点对陌生 UA 出拦截页，但通常放行搜索引擎爬虫。
 * 第一次用浏览器 UA + Referer 没拿到标题时，换这个 UA 再试一次。
 */
const SEARCHBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

/** 上游抓取的两套请求头，按序尝试，拿到标题即停 */
const FETCH_PROFILES: Array<{ userAgent: string; sendReferer: boolean }> = [
  { userAgent: BROWSER_UA, sendReferer: true },
  { userAgent: SEARCHBOT_UA, sendReferer: false },
]

/**
 * 反爬质询页的标题不能当文章标题写进卡片，
 * 否则聊天里会出现「Just a moment...」这种莫名其妙的预览。
 */
const CHALLENGE_TITLE =
  /^(just a moment|attention required|access denied|please verify|security check|checking your browser|请稍候|安全验证|访问验证|验证码|人机验证)/i

interface PageMeta {
  title?: string
  description?: string
  image?: string
  imageWidth?: number
  imageHeight?: number
}

/** 这次请求要的是卡片（爬虫），还是页面（真人） */
export function wantsShareCard(request: Request): boolean {
  const ua = request.headers.get('user-agent') ?? ''
  if (CRAWLER_UA.test(ua)) return true
  return CHAT_APP_UA.test(ua) && !request.headers.get('sec-fetch-mode')
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
  // 微信很认尺寸标注：上游声明过就跟着带上，让平台直接按大图卡排版
  const imageWidth = imageDimension(byKey.get('og:image:width'))
  const imageHeight = imageDimension(byKey.get('og:image:height'))

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(image && imageWidth ? { imageWidth } : {}),
    ...(image && imageHeight ? { imageHeight } : {}),
  }
}

function imageDimension(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10000 ? parsed : undefined
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

/** 单次抓取；超时、非 HTML、上游报错、质询页都当作「没抓到」 */
async function fetchPageMetaOnce(
  originUrl: string,
  profile: { userAgent: string; sendReferer: boolean },
): Promise<PageMeta> {
  try {
    const target = new URL(originUrl)
    const response = await fetch(originUrl, {
      headers: {
        'User-Agent': profile.userAgent,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(profile.sendReferer ? { Referer: `${target.origin}/` } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return {}

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) return {}

    const bytes = await readCapped(response, UPSTREAM_READ_LIMIT)
    const meta = extractPageMeta(decodeHtml(bytes, contentType), response.url || originUrl)
    // 质询页整页都是拦截器吐的，摘要与首图同样不可信，一起丢掉
    if (meta.title && CHALLENGE_TITLE.test(meta.title)) return {}
    return meta
  } catch {
    return {}
  }
}

/** 抓原文：浏览器 UA 拿不到标题就换搜索引擎 UA 重试；两把都失败由调用方退回兜底文案 */
async function fetchPageMeta(originUrl: string): Promise<PageMeta> {
  let partial: PageMeta = {}
  for (const profile of FETCH_PROFILES) {
    const meta = await fetchPageMetaOnce(originUrl, profile)
    if (meta.title) return { ...partial, ...meta }
    partial = { ...meta, ...partial }
  }
  return partial
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
  /** 必填：没有 og:image 时微信几乎不出大图卡，兜底也要给品牌图 */
  image: string
  imageWidth?: number
  imageHeight?: number
}): string {
  const title = escapeHtml(card.title)
  const description = escapeHtml(card.description)
  const shareUrl = escapeHtml(card.shareUrl)
  const bounceUrl = escapeHtml(card.bounceUrl)
  const image = escapeHtml(card.image)
  const dimensions =
    card.imageWidth && card.imageHeight
      ? `\n<meta property="og:image:width" content="${card.imageWidth}">\n<meta property="og:image:height" content="${card.imageHeight}">`
      : ''

  // itemprop 三件套是微信抓卡片的旧协议，与 OG 并存输出，两代抓取端都认
  return `<!DOCTYPE html><html lang="zh-CN" itemscope itemtype="https://schema.org/Article"><head>
<meta charset="utf-8">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${shareUrl}">
<meta property="og:image" content="${image}">${dimensions}
<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${image}">
<meta itemprop="name" content="${title}">
<meta itemprop="description" content="${description}">
<meta itemprop="image" content="${image}">
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

  // og:url 用不带 salt 的规范 token：salt 只为换 URL 打破平台预览缓存，
  // 规范地址才是这篇文章的稳定身份，平台按 og:url 归并时不会把缓存键打散。
  const canonicalToken = payload ? encodeShareToken(payload) : token
  const shareUrl = `${url.origin}${SHARE_PATH_PREFIX}${canonicalToken}`
  // 逃生门要回到用户实际点开的地址（可能带 salt），token 在 pathname 上原样保留
  const bounceUrl = `${url.origin}${url.pathname}?${SHARE_CARD_BYPASS_PARAM}=1`

  // og:image 必须存在且是同域 https 绝对地址：上游首图经 /a/<token>/og.png
  // 转发（防盗链、http 图、失效图都在端点内兜底），没有首图直接指品牌图。
  // 图片与卡片同在 /a/* 路径下，WAF 的按路径 Skip 规则一并覆盖。
  const image = payload
    ? `${url.origin}${SHARE_PATH_PREFIX}${canonicalToken}${OG_IMAGE_SUFFIX}${
        meta.image ? `?${OG_IMAGE_SRC_PARAM}=${encodeURIComponent(meta.image)}` : ''
      }`
    : `${url.origin}${OG_DEFAULT_IMAGE_PATH}`
  const dimensions = meta.image
    ? meta.imageWidth && meta.imageHeight
      ? { imageWidth: meta.imageWidth, imageHeight: meta.imageHeight }
      : {}
    : { imageWidth: OG_DEFAULT_IMAGE_WIDTH, imageHeight: OG_DEFAULT_IMAGE_HEIGHT }

  // 抓到文章标题才算「文章卡」；抓不到时兜底标题也要长得像一篇文章：
  // 「<信源名> · <v1 链接里的短标题或“一篇文章”>」，不能只剩一句站点空话
  const articleTitle = meta.title
  const fallbackTitle = payload
    ? `${sourceName ? `${sourceName} · ` : ''}${
        normalizeText(payload.title, MAX_TITLE_LENGTH) ?? FALLBACK_ARTICLE_TITLE
      }`
    : FALLBACK_TITLE
  const html = renderShareCard({
    title: articleTitle || fallbackTitle,
    description: composeDescription(meta.description, sourceName),
    shareUrl,
    bounceUrl,
    image,
    ...dimensions,
  })

  return new Response(request.method === 'HEAD' ? null : html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 文章卡可以多缓存一会儿（标题不会变）；兜底卡不缓存，
      // 上游恢复后爬虫重抓立即能拿到文章级卡片，失败态不该被钉住十分钟
      'Cache-Control': articleTitle ? 'public, max-age=3600' : 'public, max-age=0, must-revalidate',
      ...(articleTitle ? {} : { 'CDN-Cache-Control': 'no-store' }),
      // 同一地址对真人给的是 SPA，中间缓存不能把卡片复用过去
      Vary: 'User-Agent',
    },
  })
}

/** 首图转发比抓 head 更宽裕些：图片体积大、CDN 链路多一跳很常见 */
const IMAGE_TIMEOUT_MS = 5000
const IMAGE_CACHE_CONTROL = 'public, max-age=86400'

interface AssetsBinding {
  ASSETS?: { fetch: (request: Request | string, init?: RequestInit) => Promise<Response> }
}

/** src 只认 http(s)，挡掉 javascript: / data: 这类注入面 */
function safeImageSrc(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

/** 转发上游首图：跟随重定向、只接受 image/*，任何失败都返回 null 交给品牌图 */
async function fetchUpstreamImage(src: string, method: string): Promise<Response | null> {
  try {
    const target = new URL(src)
    const upstream = await fetch(src, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: `${target.origin}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    const contentType = upstream.headers.get('content-type') ?? ''
    if (!upstream.ok || !/^image\//i.test(contentType)) return null
    return new Response(method === 'HEAD' ? null : upstream.body, {
      status: 200,
      headers: { 'Content-Type': contentType, 'Cache-Control': IMAGE_CACHE_CONTROL },
    })
  } catch {
    return null
  }
}

/**
 * 分享卡片首图端点 `GET /a/<token>/og.png`。
 *
 * 微信对跨域、防盗链、http 明文的 og:image 经常直接放弃渲染大图卡，
 * 所以卡片里的首图一律指到同域：带 `?src=` 时转发上游首图，
 * 抓不到（防盗链 / 失效 / 非图片）或没有首图时回落到品牌兜底图。
 * 路径不匹配返回 null，由 worker 继续走 SPA / 静态资产。
 */
export async function shareImageResponse(
  request: Request,
  url: URL,
  env?: AssetsBinding,
): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  if (!url.pathname.startsWith(SHARE_PATH_PREFIX) || !url.pathname.endsWith(OG_IMAGE_SUFFIX)) {
    return null
  }
  const token = url.pathname.slice(SHARE_PATH_PREFIX.length, -OG_IMAGE_SUFFIX.length)
  if (!token || token.includes('/')) return null

  // token 必须可解才代转上游图，避免这个端点被当成任意图片代理滥用
  const src = decodeShareToken(token) ? safeImageSrc(url.searchParams.get(OG_IMAGE_SRC_PARAM)) : null
  if (src) {
    const upstream = await fetchUpstreamImage(src, request.method)
    if (upstream) return upstream
  }

  if (!env?.ASSETS) {
    return Response.redirect(`${url.origin}${OG_DEFAULT_IMAGE_PATH}`, 302)
  }
  const fallback = await env.ASSETS.fetch(new Request(`${url.origin}${OG_DEFAULT_IMAGE_PATH}`))
  return new Response(request.method === 'HEAD' ? null : fallback.body, {
    status: fallback.status,
    headers: {
      'Content-Type': fallback.headers.get('content-type') ?? 'image/png',
      'Cache-Control': IMAGE_CACHE_CONTROL,
    },
  })
}
