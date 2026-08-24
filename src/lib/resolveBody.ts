import { Capacitor } from '@capacitor/core'
import { parseHTML } from 'linkedom'

import { hydrateNativeTunnelImages } from '../features/proxy/hydrateImages'
import {
  buildMediaDescriptor,
  bestMediaUrlInPayload,
  bestPosterUrlInPayload,
  mediaFormatFor,
  observeMediaInPayload,
} from '../features/mediaSniffer/core'
import {
  discoverMediaDescriptor,
  mediaDescriptorHtml,
} from '../features/mediaSniffer/service'
import { shouldUseOriginPlayerSurface } from '../features/mediaSniffer/originPlayerGate'
import { currentProxyRuntime } from '../features/proxy/runtime'
import { resolveProxyTransport } from '../features/proxy/transport'
import { appendRelatedCatalogHtml, extractRelatedCatalog } from '../features/catalogEngine/related'
import { extractWebCatalogDetailMeta } from '../features/catalogEngine/detailMeta'
import { normalizeCatalogTitle } from '../features/catalogEngine/normalize'
import { nnyyListingUrlForDetail } from '../features/frameworkDetect/adapters/nnyy'
import { findSource, userAgentFor, type NewsSource } from '../sources/registry'
import { cleanSummaryText } from './cleanSummary'
import { collectAudioSrc, ensureArticleAudioHtml } from './articleAudio'
import {
  fetchAbsoluteFormPost,
  fetchAbsoluteText,
  getRuntimeProxyPrefs,
  googleTranslateProxyUrl,
} from './http'
import { decodeGoogleNewsUrl, isGoogleNewsArticleUrl } from './googleNewsDecode'
import { normalizeContentImages } from './normalizeImages'
import { buildPageLeadHtml, isSoftNotFoundHtml } from './pageLead'
import { sanitizeArticleHtml } from './sanitize'
import type { Article } from './types'
import { hasBrokenTextEncoding } from './textEncoding'

export type BodySource = 'feed' | 'readability' | 'netease' | 'video' | 'blocked'

export interface ResolvedBody {
  contentHtml: string
  title?: string
  image?: string
  bodySource: BodySource
  /** Google News 等解码后的出版社 URL；外开浏览器优先用 */
  resolvedOriginUrl?: string
}

/**
 * 媒体地址探测完成后的增量更新。
 * 正文抽取不应等待播放器嗅探；阅读器可以先展示正文，再接收这次更新。
 */
export type MediaResolvedHandler = (resolved: ResolvedBody) => void

/** 正文抓取使用的 UA：优先自定义/额外源表，找不到则 undefined（走 http 默认 UA） */
export function pageUserAgentForArticle(
  article: Article,
  extraSources?: NewsSource[],
): string | undefined {
  const source = findSource(article.sourceId, extraSources)
  return source ? userAgentFor(source) : undefined
}

function relatedExcludeUrls(source: NewsSource | undefined): string[] {
  return source?.frameworkHint?.categories?.map((item) => item.url) ?? []
}

/** 自定义 CMS 详情页：把上游已有的相关卡片接到正文后，不做客户端推荐。 */
async function withRelatedFromPage(
  resolved: ResolvedBody,
  pageHtml: string | undefined,
  pageUrl: string,
  article: Article,
  extraSources?: NewsSource[],
  signal?: AbortSignal,
): Promise<ResolvedBody> {
  if (!pageHtml) return resolved
  const source = findSource(article.sourceId, extraSources)
  if (!source || source.kind !== 'web-catalog') return resolved

  const meta = extractWebCatalogDetailMeta(pageHtml)
  let items = extractRelatedCatalog(pageHtml, pageUrl, {
    excludeUrls: relatedExcludeUrls(source),
  })

  if (items.length < 2 && source.frameworkHint?.framework === 'nnyy') {
    const listingUrl = nnyyListingUrlForDetail(pageUrl)
    if (listingUrl) {
      const listingHtml = await fetchAbsoluteText(listingUrl, {
        signal,
        userAgent: pageUserAgentForArticle(article, extraSources),
      }).catch(() => undefined)
      if (listingHtml) {
        items = extractRelatedCatalog(listingHtml, listingUrl, {
          excludeUrls: [...relatedExcludeUrls(source), pageUrl],
          maxItems: 12,
        })
      }
    }
  }

  let contentHtml = resolved.contentHtml
  if (resolved.bodySource === 'video') {
    const synopsis =
      meta.synopsis ||
      normalizeCatalogTitle(cleanSummaryText(article.summary, meta.title || article.title))
    if (synopsis && synopsis.length >= 12) {
      const clipped = synopsis.length > 220 ? `${synopsis.slice(0, 217)}…` : synopsis
      contentHtml = contentHtml.replace(
        /<p>[\s\S]*?<\/p>\s*$/i,
        `<p>${escapeHtml(clipped)}</p>`,
      )
    }
  }

  if (items.length) {
    contentHtml = appendRelatedCatalogHtml(contentHtml, items)
  }

  return {
    ...resolved,
    title: meta.title || resolved.title,
    contentHtml: sanitizeArticleHtml(contentHtml),
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 出版社对普通浏览器 UA 常回 401/403 挑战页，却为了社交分享卡片对爬虫 UA
 * 放行完整 HTML（Reuters 只认 Discordbot、ESPN/Yahoo 认 facebook/twitter）。
 * 直连失败后按此顺序换 UA 重试原文页。
 */
export const CRAWLER_FALLBACK_UAS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Twitterbot/1.0',
  'Googlebot-News',
] as const

/**
 * NYT 等站对爬虫 UA 返回 200，但正文由前端渲染，HTML 里只剩一段
 * 「禁止自动化抓取」声明——字数够长会被误当正文。
 */
export function isScrapeNoticeBody(html: string): boolean {
  const text = stripTags(html)
  // NYT 声明页经 Readability 约 750 字；正常正文普遍在 1200 字以上
  if (text.length > 1200) return false
  return /data\s+mine\s+or\s+scrape\s+the\s+content|prohibited\s+without\s+prior\s+written\s+permission/i.test(
    text,
  )
}

/** 付费墙 / 反爬挑战页 / 翻译镜像拒绝页：不可当正文 */
export function isBlockedPublisherHtml(html: string): boolean {
  const head = html.slice(0, 8000)
  if (/<title[^>]*>\s*Simple Page\s*<\/title>/i.test(head)) return true
  if (/please enable js and disable any ad blocker/i.test(head)) return true
  if (/can'?t translate this page/i.test(head)) return true
  if (/just a moment\.\.\./i.test(head) && /cf-browser-verification|challenge-platform/i.test(head)) {
    return true
  }
  // 36kr 等站裸域常见：无 <title> 的 JS 挑战壳（浏览器能过，站内 fetch 不行）
  if (
    !/<title[\s>]/i.test(head) &&
    /_0x[0-9a-f]{3,}\s*\(/i.test(head) &&
    /spinner|conic-gradient/i.test(head)
  ) {
    return true
  }
  return false
}

/**
 * 部分站点裸域对无 JS 客户端返回反爬壳，www 才有正文/RSS。
 * 正文抓取前先规范化，避免误判成「付费墙」。
 */
export function preferPublisherFetchUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === '36kr.com') {
      parsed.hostname = 'www.36kr.com'
      return parsed.toString()
    }
  } catch {
    // 非法 URL 保持原样
  }
  return url
}

function buildBlockedPublisherFallback(
  article: Article,
  resolvedOriginUrl?: string,
): ResolvedBody {
  const summary = article.summary?.trim()
  const note =
    '<p><strong>原站暂不支持站内阅读</strong>（付费墙或反爬拦截）。完整正文请点右上角在浏览器打开。</p>'
  const summaryHtml =
    summary && summary.length >= 40
      ? `<p>${escapeHtmlText(summary)}</p>`
      : '<p class="text-paper-muted">订阅源未提供可用摘要。</p>'
  return {
    contentHtml: `${note}${summaryHtml}`,
    bodySource: 'blocked',
    resolvedOriginUrl,
  }
}

/** 测试导出：付费墙/反爬软降级正文 */
export function buildBlockedPublisherFallbackForTest(
  article: Article,
  resolvedOriginUrl?: string,
): ResolvedBody {
  return buildBlockedPublisherFallback(article, resolvedOriginUrl)
}

/**
 * 英文站 RSS 常见「摘要 + 阅读全文」尾巴。命中则绝不当作站内全文，
 * 否则会跳过 Readability，只显示两段 teaser（如 Ars / Verge）。
 */
const PARTIAL_FEED_CTA =
  /read\s+(?:the\s+)?full\s+(?:story|article|post)|continue\s+reading|view\s+(?:the\s+)?full\s+article|阅读全文|查看全文|点击查看全文/i

/** 是否像「摘要 Feed」（带阅读全文 CTA），用于丢弃误缓存 */
export function isPartialFeedTeaser(html?: string): boolean {
  if (!html) return false
  return PARTIAL_FEED_CTA.test(stripTags(html))
}

/** Feed 自带内容是否已足够作为站内全文 */
export function isSubstantialHtml(html?: string): boolean {
  if (!html) return false
  const text = stripTags(html)
  if (!text) return false
  if (isPartialFeedTeaser(html)) return false
  // 纯文本与 HTML 统一看字数；不能仅凭「≥2 个 <p>」判定——摘要 Feed 也常有两三段
  return text.length >= 800
}

const INLINE_FLASH_KINDS = new Set(['cls', 'eastmoney-kx', 'wscn-live'])

/** 财经快讯：列表已带正文，即使短于 substantial 阈值也直接渲染 */
export function isInlineFlashBody(html: string | undefined, sourceId: string): boolean {
  if (!html) return false
  const source = findSource(sourceId)
  if (!source || !INLINE_FLASH_KINDS.has(source.kind)) return false
  return stripTags(html).length >= 12
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function imageUrlTransform(url: string): string | null {
  const transport = resolveProxyTransport(
    url,
    undefined,
    getRuntimeProxyPrefs(),
    currentProxyRuntime(),
  )
  if (transport.kind === 'web-wrap') return transport.requestUrl
  return null
}

async function prepareHtml(html: string, baseUrl: string): Promise<string> {
  const normalized = normalizeContentImages(html, baseUrl, {
    // 浏览器开发态走图片代理；原生 App 直连（隧道图稍后 hydrate 成 blob）
    proxyImages: !Capacitor.isNativePlatform(),
    transformUrl: imageUrlTransform,
  })
  const sanitized = sanitizeArticleHtml(normalized)
  return hydrateNativeTunnelImages(sanitized)
}

async function absolutizeHtml(html: string, baseUrl: string): Promise<string> {
  return prepareHtml(html, baseUrl)
}

function removeEmbedChrome(document: Document): void {
  document
    .querySelectorAll(
      [
        '.o-em-consent',
        '.o-em-adblock',
        '[class*="em-consent"]',
        '[class*="em-adblock"]',
        // France 24 SPA 壳里常驻的软 404 / loader，去掉后才不会被 Readability 当成正文
        '.a-loader-wrapper',
        '.a-loader-error',
        '[data-loader-wrapper]',
      ].join(', '),
    )
    .forEach((node) => node.remove())
}

function isLikelyVideoPageUrl(pageUrl: string): boolean {
  return /\/(?:video|videos|watch|embed|player)(?:\/|[?#]|$)/i.test(pageUrl)
}

function videoFallbackBody(pageHtml: string, title?: string): ResolvedBody {
  const lead = buildPageLeadHtml(pageHtml)
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  const note = embeds
    ? ''
    : '<p>本条主要为视频内容，未能解析到可嵌入的播放器，请打开原文观看。</p>'
  return {
    contentHtml: sanitizeArticleHtml(`${lead}${embeds}${note}`),
    title,
    bodySource: 'readability',
  }
}

/** 原样收集页面中的 YouTube embed，不做转码/二次封装 */
function collectYoutubeEmbedHtml(pageHtml: string): string {
  const matches = pageHtml.match(
    /<iframe\b[^>]*\bsrc=["']https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/[^"']+["'][^>]*>[\s\S]*?<\/iframe>/gi,
  )
  if (!matches?.length) return ''
  const unique = [...new Set(matches)]
  return unique.join('')
}

/**
 * Readability 搞不定的现代博客（如 Arena Next.js）：
 * 正文常在 streaming 槽（#S:*）里，空的 <main> 没有段落，故扫整个 body。
 * YouTube 用原站 iframe，不改 src、不二次封装。
 */
async function extractMainContentFallback(
  pageHtml: string,
  pageUrl: string,
  title?: string,
): Promise<ResolvedBody | undefined> {
  const { document } = parseHTML(pageHtml)
  const root = document.body
  if (!root) return undefined

  root
    .querySelectorAll('header, footer, nav, form, script, style, noscript')
    .forEach((node) => node.remove())

  // 相关文章卡片（Read Article）会污染正文
  root.querySelectorAll('a').forEach((anchor) => {
    const label = (anchor.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (label === 'read article' || label === 'see all articles') {
      const card = anchor.closest('article') || anchor.parentElement
      card?.remove()
    }
  })

  const blocks: string[] = []
  // 直接从原始 HTML 收 embed，避免 streaming 槽解析差异
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  if (embeds) blocks.push(embeds)

  const seen = new Set<string>()
  root.querySelectorAll('h1, h2, h3, p, li, blockquote, pre, figcaption').forEach((node) => {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length < 24) return
    if (seen.has(text)) return
    // 跳过明显导航/页脚/订阅
    if (/^(back to|subscribe|follow|terms|privacy|cookies|try arena|insights at the frontier)/i.test(text)) {
      return
    }
    if (/^©\s*\d{4}/i.test(text)) return
    if (/^(leaderboard rankings|use cases|company|legal)$/i.test(text)) return
    seen.add(text)
    const tag = node.tagName.toLowerCase()
    if (tag === 'li') {
      blocks.push(`<li>${escapeHtml(text)}</li>`)
      return
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push(`<${tag}>${escapeHtml(text)}</${tag}>`)
      return
    }
    blocks.push(`<p>${escapeHtml(text)}</p>`)
  })

  // 把连续 li 包进 ul
  let html = blocks.join('\n')
  html = html.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (chunk) => `<ul>${chunk}</ul>`)

  const textLen = stripTags(html).length
  if (textLen < 200 && !embeds) return undefined

  return {
    contentHtml: await absolutizeHtml(html, pageUrl),
    title,
    bodySource: 'readability',
  }
}

async function extractWithReadability(
  pageHtml: string,
  pageUrl: string,
): Promise<ResolvedBody> {
  const { Readability } = await import('@mozilla/readability')
  const { document } = parseHTML(pageHtml)
  removeEmbedChrome(document as unknown as Document)
  const reader = new Readability(document as unknown as Document, {
    charThreshold: 80,
  })
  const article = reader.parse()
  // 仅 URL 像视频频道时才走「视频兜底」；正文里夹带 YouTube ≠ 整页只有视频
  const isVideoPage = isLikelyVideoPageUrl(pageUrl)

  if (!article?.content || stripTags(article.content).length < 80) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article?.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article?.title ?? undefined)
    throw new Error('无法从原文页抽取正文')
  }

  if (isSoftNotFoundHtml(article.content)) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article.title ?? undefined)
    const lead = buildPageLeadHtml(pageHtml)
    if (lead) {
      return {
        contentHtml: await absolutizeHtml(lead, pageUrl),
        title: article.title || undefined,
        bodySource: 'readability',
      }
    }
    throw new Error('无法从原文页抽取正文')
  }

  // Readability 常丢掉 iframe：把原站 YouTube embed 补回正文前部
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  const merged = embeds && !/youtube\.com\/embed|youtube-nocookie\.com\/embed/i.test(article.content)
    ? `${embeds}${article.content}`
    : article.content

  const absolute = await absolutizeHtml(merged, pageUrl)
  if (stripTags(absolute).length < 80 || isSoftNotFoundHtml(absolute)) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article.title ?? undefined)
    throw new Error('无法从原文页抽取正文')
  }
  return {
    contentHtml: absolute,
    title: article.title || undefined,
    bodySource: 'readability',
  }
}

function buildVideoBody(
  article: Article,
  pending: 'sniffing' | 'failed' = 'sniffing',
): ResolvedBody {
  const paragraphs = (article.summary || article.title)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')

  if (article.videoUrl) {
    return {
      contentHtml: sanitizeArticleHtml(paragraphs),
      bodySource: 'video',
    }
  }

  const attrs = [
    `data-media-pending="${pending}"`,
    `title="${escapeHtml(article.title)}"`,
    'playsinline',
  ]
  if (article.image) attrs.push(`poster="${escapeHtml(article.image)}"`)
  return {
    contentHtml: sanitizeArticleHtml(`<video ${attrs.join(' ')}></video>${paragraphs}`),
    bodySource: 'video',
  }
}

const HUXIU_ARTICLE_DETAIL_API =
  'https://api-web-article.huxiu.com/web/article/detail'

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.href
      : undefined
  } catch {
    return undefined
  }
}

function huxiuArticleId(article: Article): string | undefined {
  if (article.sourceId !== 'huxiu') return undefined
  try {
    return new URL(article.originUrl).pathname.match(/^\/article\/(\d+)\.html$/)?.[1]
  } catch {
    return undefined
  }
}

/** 详情接口仅负责补充结构化正文；媒体地址由通用候选评分器发现。 */
function buildHuxiuVideoBody(
  article: Article,
  payload: unknown,
): ResolvedBody | null {
  const root = objectRecord(payload)
  if (!root || root.success === false) return null
  const data = objectRecord(root.data)
  if (!data) return null

  const expectedAid = huxiuArticleId(article)
  if (expectedAid && data.aid != null && String(data.aid) !== expectedAid) return null

  const descriptor = buildMediaDescriptor(
    observeMediaInPayload(data, article.originUrl),
  )
  if (!descriptor || descriptor.drm) return null

  const poster =
    bestPosterUrlInPayload(data, article.originUrl) ||
    httpUrl(article.image)
  const title =
    typeof data.title === 'string' && data.title.trim()
      ? data.title.trim()
      : article.title
  const content =
    typeof data.content === 'string' && stripTags(data.content).length >= 10
      ? data.content
      : article.summary
        ? `<p>${escapeHtml(article.summary)}</p>`
        : ''
  const attrs = [
    `src="${escapeHtml(descriptor.url)}"`,
    'controls',
    'playsinline',
    'preload="metadata"',
    `title="${escapeHtml(title)}"`,
    `data-media-format="${descriptor.type}"`,
    `data-source-page="${escapeHtml(article.originUrl)}"`,
  ]
  if (poster) attrs.push(`poster="${escapeHtml(poster)}"`)

  return {
    contentHtml: sanitizeArticleHtml(`<video ${attrs.join(' ')}></video>${content}`),
    title,
    image: poster,
    bodySource: 'video',
  }
}

/** 测试导出：将虎嗅详情响应转换为可播放正文。 */
export function buildHuxiuVideoBodyForTest(
  article: Article,
  payload: unknown,
): ResolvedBody | null {
  return buildHuxiuVideoBody(article, payload)
}

async function resolveHuxiuVideoBody(
  article: Article,
  signal?: AbortSignal,
): Promise<ResolvedBody | null> {
  const aid = huxiuArticleId(article)
  if (!aid) return null

  const payload = await fetchAbsoluteFormPost(
    HUXIU_ARTICLE_DETAIL_API,
    { platform: 'www', aid },
    { signal },
  )
  return buildHuxiuVideoBody(article, JSON.parse(payload) as unknown)
}

function isNeteaseHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === '163.com' ||
    host.endsWith('.163.com') ||
    host.endsWith('.netease.com') ||
    host.endsWith('.126.net') ||
    host.endsWith('.126.com')
  )
}

/**
 * 网易正文候选 id。
 * 注意：虎嗅等站也是 `/article/{数字}.html`，绝不能从非网易域名抠 id，
 * 否则会先去抓 m.163.com / dy 站，Readability 抽到网易首页页脚（备案号）。
 */
export function candidateNeteaseIds(article: Article): string[] {
  const ids: string[] = []
  if (article.neteaseDocId) ids.push(article.neteaseDocId)

  try {
    const host = new URL(article.originUrl).hostname
    if (isNeteaseHost(host)) {
      const fromUrl =
        article.originUrl.match(/\/article\/([A-Z0-9]+)\.html/i)?.[1] ||
        article.originUrl.match(/\/video\/([A-Z0-9]+)\.html/i)?.[1]
      if (fromUrl) ids.push(fromUrl)
    }
  } catch {
    // originUrl 非法时只保留显式 neteaseDocId
  }

  return [...new Set(ids.filter((id) => /^[A-Z0-9]+$/i.test(id)))]
}

/** 网易正文常用 http CDN；图片站大多支持 https，优先升格避免 WebView 混合内容被拦 */
function preferHttpsAsset(url: string): string {
  if (!url.startsWith('http://')) return url
  try {
    const host = new URL(url).hostname
    if (
      host.endsWith('126.net') ||
      host.endsWith('163.com') ||
      host.endsWith('netease.com') ||
      host.endsWith('126.com')
    ) {
      return `https://${url.slice('http://'.length)}`
    }
  } catch {
    // keep original
  }
  return url
}

/**
 * 网易 full.html 正文不直接内嵌 <img>，而是 <!--IMG#0--> / <!--VIDEO#0--> 占位，
 * 真实地址在旁路 img / video 数组。轻松一刻等栏目几乎全靠这套机制。
 */
function expandNeteaseMediaPlaceholders(
  body: string,
  node: Record<string, unknown>,
  pageUrl: string,
): string {
  let html = body

  const images = Array.isArray(node.img) ? node.img : []
  for (const item of images) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const ref = typeof entry.ref === 'string' ? entry.ref : ''
    const src = typeof entry.src === 'string' ? preferHttpsAsset(entry.src) : ''
    if (!ref || !src || !html.includes(ref)) continue
    const alt =
      typeof entry.alt === 'string' && entry.alt.trim()
        ? escapeHtml(entry.alt.trim())
        : ''
    const tag = `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    html = html.split(ref).join(tag)
  }

  const videos = Array.isArray(node.video) ? node.video : []
  for (const item of videos) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const ref = typeof entry.ref === 'string' ? entry.ref : ''
    if (!ref || !html.includes(ref)) continue

    const poster =
      typeof entry.cover === 'string' ? preferHttpsAsset(entry.cover) : ''
    const src = bestMediaUrlInPayload(entry, pageUrl) || ''
    const alt =
      typeof entry.alt === 'string' && entry.alt.trim()
        ? escapeHtml(entry.alt.trim())
        : '视频'

    let tag: string
    if (src) {
      const attrs = [
        `src="${escapeHtml(src)}"`,
        'controls',
        'playsinline',
        'preload="metadata"',
        `data-media-format="${mediaFormatFor(src)}"`,
        `data-source-page="${escapeHtml(pageUrl)}"`,
      ]
      if (poster) attrs.push(`poster="${escapeHtml(poster)}"`)
      tag = `<video ${attrs.join(' ')}></video>`
      if (alt) tag += `<p><em>${alt}</em></p>`
    } else if (poster) {
      tag = `<figure><img src="${escapeHtml(poster)}" alt="${alt}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /><figcaption>${alt}</figcaption></figure>`
    } else {
      tag = ''
    }
    html = html.split(ref).join(tag)
  }

  // 未匹配到资源的占位直接清掉，避免正文残留注释噪声
  html = html.replace(/<!--(?:IMG|VIDEO)#\d+-->/g, '')
  return html
}

async function resolveNetEaseArticleBody(
  article: Article,
  signal?: AbortSignal,
): Promise<ResolvedBody | null> {
  if (!article.sourceId.startsWith('netease')) return null
  if (article.contentType === 'video') return buildVideoBody(article)

  for (const docid of candidateNeteaseIds(article)) {
    const api = `https://c.m.163.com/nc/article/${docid}/full.html`
    try {
      const payload = await fetchAbsoluteText(api, {
        userAgent: 'NewsApp',
        signal,
      })
      if (!payload.trim()) continue
      const data = JSON.parse(payload) as Record<string, unknown>
      const node = data[docid]
      if (!node || typeof node !== 'object') continue
      const record = node as Record<string, unknown>
      const rawBody = String(record.body ?? '')
      if (!rawBody || stripTags(rawBody).length < 40) continue

      const body = expandNeteaseMediaPlaceholders(rawBody, record, article.originUrl || api)
      return {
        contentHtml: await absolutizeHtml(body, article.originUrl || api),
        bodySource: 'netease',
        // 分享短链不带标题，靠这里把接口给的标题回填进阅读器
        title: typeof record.title === 'string' ? record.title : undefined,
      }
    } catch {
      // 尝试下一个候选 id
    }
  }

  return null
}

async function resolveZhihuBody(
  article: Article,
  signal?: AbortSignal,
): Promise<ResolvedBody | null> {
  if (article.sourceId !== 'zhihu-daily') return null
  const id =
    article.neteaseDocId ||
    article.originUrl.match(/story\/(\d+)/)?.[1]
  if (!id) return null

  const api = `https://news-at.zhihu.com/api/4/news/${id}`
  const payload = await fetchAbsoluteText(api, { signal })
  const data = JSON.parse(payload) as Record<string, unknown>
  const body = String(data.body ?? '')
  if (!body || stripTags(body).length < 40) return null

  // 知乎正文是片段 HTML，补一层容器便于排版
  const wrapped = `<div class="zhihu-entry">${body}</div>`
  return {
    contentHtml: await absolutizeHtml(wrapped, article.originUrl || 'https://daily.zhihu.com/'),
    image: typeof data.image === 'string' ? data.image : undefined,
    bodySource: 'feed',
    title: typeof data.title === 'string' ? data.title : undefined,
  }
}

async function resolveJiqizhixinBody(
  article: Article,
  signal?: AbortSignal,
): Promise<ResolvedBody | null> {
  if (article.sourceId !== 'jiqizhixin') return null
  const id =
    article.neteaseDocId ||
    article.originUrl.match(
      /\/articles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    )?.[1] ||
    article.originUrl.match(/\/articles\/([^/?#]+)/)?.[1]
  if (!id) return null

  const api = `https://www.jiqizhixin.com/api/article_library/articles/${id}.json`
  const payload = await fetchAbsoluteText(api, { signal })
  const data = JSON.parse(payload) as Record<string, unknown>
  const body = String(data.content ?? '')
  if (!body || stripTags(body).length < 40) return null

  return {
    contentHtml: await absolutizeHtml(body, article.originUrl || 'https://www.jiqizhixin.com/'),
    image:
      typeof data.cover_image_url === 'string'
        ? data.cover_image_url
        : typeof data.coverImageUrl === 'string'
          ? data.coverImageUrl
          : undefined,
    bodySource: 'feed',
    title: typeof data.title === 'string' ? data.title : undefined,
  }
}

function withArticleAudio(
  resolved: ResolvedBody,
  article: Article,
  pageHtml?: string,
): ResolvedBody {
  if (resolved.bodySource === 'video' || resolved.bodySource === 'blocked') return resolved
  const audioUrl =
    article.audioUrl || collectAudioSrc(resolved.contentHtml) || collectAudioSrc(pageHtml)
  if (!audioUrl) return resolved
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(ensureArticleAudioHtml(resolved.contentHtml, audioUrl)),
  }
}

/** 测试导出：视频稿在嗅探前/失败时都必须保留 video 占位节点。 */
export function buildVideoBodyForTest(
  article: Article,
  pending: 'sniffing' | 'failed' = 'sniffing',
): ResolvedBody {
  return buildVideoBody(article, pending)
}

function stripVideoDiscoveryPlaceholder(html: string): string {
  return html
    .replace(/<video\b[^>]*\bdata-media-pending\b[^>]*>\s*<\/video>/gi, '')
    .replace(/<div\b[^>]*data-newsnook-video-placeholder=["']true["'][^>]*>[\s\S]*?<\/div>/gi, '')
}

function withVideoDiscoveryFailed(resolved: ResolvedBody): ResolvedBody {
  if (!/data-media-pending=["']sniffing["']/i.test(resolved.contentHtml)) return resolved
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(
      resolved.contentHtml.replace(
        /data-media-pending=["']sniffing["']/gi,
        'data-media-pending="failed"',
      ),
    ),
  }
}

function applyMediaDescriptor(
  resolved: ResolvedBody,
  descriptor: Awaited<ReturnType<typeof discoverMediaDescriptor>>,
  title: string,
  poster?: string,
): ResolvedBody | null {
  if (!descriptor) return null
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(
      mediaDescriptorHtml(descriptor, {
        title,
        poster,
        contentHtml: stripVideoDiscoveryPlaceholder(resolved.contentHtml),
      }),
    ),
  }
}

function scheduleMediaDiscovery(
  options: Parameters<typeof discoverMediaDescriptor>[0],
  resolved: ResolvedBody,
  title: string,
  poster: string | undefined,
  onMediaResolved: MediaResolvedHandler | undefined,
  incremental = true,
): void {
  if (!onMediaResolved) return
  const publish = (descriptor: Awaited<ReturnType<typeof discoverMediaDescriptor>>) => {
    const enriched = descriptor
      ? applyMediaDescriptor(resolved, descriptor, title, poster)
      : withVideoDiscoveryFailed(resolved)
    if (enriched) onMediaResolved(enriched)
  }
  // A direct video article starts from a pending placeholder. Do not publish
  // the first static candidate before runtime sniffing has captured the
  // session headers: replacing the HTML tears down the player, and the
  // header-less attempt is exactly what causes the error/flicker/retry path.
  const discoveryOptions = incremental ? { ...options, onDescriptor: publish } : options
  void discoverMediaDescriptor(discoveryOptions)
    .then((descriptor) => {
      if (!incremental) publish(descriptor)
    })
    .catch(() => {
      onMediaResolved(withVideoDiscoveryFailed(resolved))
    })
}

/**
 * 保证详情页拿到可渲染全文。
 * 优先级：视频稿 → Feed 充足全文 → 网易正文接口 → 原文 HTML + Readability。
 */
export async function resolveArticleBody(
  article: Article,
  signal?: AbortSignal,
  extraSources?: NewsSource[],
  onMediaResolved?: MediaResolvedHandler,
): Promise<ResolvedBody> {
  if (
    article.contentType !== 'video' &&
    (isInlineFlashBody(article.contentHtml, article.sourceId) ||
      (isSubstantialHtml(article.contentHtml) && !hasBrokenTextEncoding(article.contentHtml!)))
  ) {
    let contentHtml = await absolutizeHtml(
      article.contentHtml!,
      article.originUrl || 'https://local.invalid/',
    )
    const embeddedFrames = article.contentHtml!.match(/<iframe\b[^>]*>/gi) || []
    const hasNonYoutubeEmbed = embeddedFrames.some(
      (frame) => !/youtube(?:-nocookie)?\.com\/embed\//i.test(frame),
    )
    if (hasNonYoutubeEmbed && article.originUrl) {
      const mediaOptions = {
        pageUrl: article.originUrl,
        html: article.contentHtml,
        runtime: true,
        timeoutMs: 6000,
        signal,
      } as const
      if (onMediaResolved) {
        scheduleMediaDiscovery(
          mediaOptions,
          { contentHtml, bodySource: 'feed' },
          article.title,
          article.image,
          (resolved) => onMediaResolved(withArticleAudio(resolved, article)),
        )
      } else {
        const descriptor = await discoverMediaDescriptor(mediaOptions).catch(() => null)
        const enriched = applyMediaDescriptor(
          { contentHtml, bodySource: 'feed' },
          descriptor,
          article.title,
          article.image,
        )
        if (enriched) contentHtml = enriched.contentHtml
      }
    }
    return withArticleAudio(
      {
        contentHtml,
        bodySource: 'feed',
      },
      article,
    )
  }

  // 新 RSS 视频稿带 contentType；旧列表缓存没有该字段，但正文同样很短。
  // 两种情况都在通用网页抽取前查一次详情 API，普通 RSS 全文已在上方直接返回。
  const huxiu = await resolveHuxiuVideoBody(article, signal).catch(() => null)
  if (huxiu) return huxiu

  if (article.contentType === 'video') {
    if (article.videoUrl) return buildVideoBody(article)
    if (!article.originUrl) return buildVideoBody(article, 'failed')

    // Android 自建源：原站可见表面 + 持续旁路，不走短时隐藏嗅探自动换 <video>
    if (
      shouldUseOriginPlayerSurface({
        sourceId: article.sourceId,
        contentType: article.contentType,
      })
    ) {
      const base: ResolvedBody = {
        contentHtml: sanitizeArticleHtml(
          (article.summary || article.title)
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join(''),
        ),
        bodySource: 'video',
      }
      if (onMediaResolved) {
        void fetchAbsoluteText(article.originUrl, {
          signal,
          userAgent: pageUserAgentForArticle(article, extraSources),
        })
          .then(async (pageHtml) => {
            onMediaResolved(
              await withRelatedFromPage(
                base,
                pageHtml,
                article.originUrl,
                article,
                extraSources,
                signal,
              ),
            )
          })
          .catch(() => onMediaResolved(base))
        return base
      }
      const pageHtml = await fetchAbsoluteText(article.originUrl, {
        signal,
        userAgent: pageUserAgentForArticle(article, extraSources),
      }).catch(() => undefined)
      return await withRelatedFromPage(
        base,
        pageHtml,
        article.originUrl,
        article,
        extraSources,
        signal,
      )
    }

    if (onMediaResolved) {
      const base = buildVideoBody(article)
      void fetchAbsoluteText(article.originUrl, {
        signal,
        userAgent: pageUserAgentForArticle(article, extraSources),
      })
        .then(async (pageHtml) => {
          const withRelated = await withRelatedFromPage(
            base,
            pageHtml,
            article.originUrl,
            article,
            extraSources,
            signal,
          )
          onMediaResolved(withRelated)
          scheduleMediaDiscovery(
            {
              pageUrl: article.originUrl,
              html: pageHtml,
              runtime: true,
              // 视频页需要完整加载播放器并触发媒体请求；预告片后才出正片时 9s 不够
              timeoutMs: 12000,
              signal,
          },
          withRelated,
          article.title,
          article.image,
          onMediaResolved,
          false,
        )
        })
        .catch(() => {
          onMediaResolved(withVideoDiscoveryFailed(base))
        })
      return base
    }

    const pageHtml = await fetchAbsoluteText(article.originUrl, {
      signal,
      userAgent: pageUserAgentForArticle(article, extraSources),
    }).catch(() => undefined)
    const descriptor = await discoverMediaDescriptor({
      pageUrl: article.originUrl,
      html: pageHtml,
      runtime: true,
      timeoutMs: 12000,
      signal,
    }).catch(() => null)
    if (!descriptor) {
      return await withRelatedFromPage(
        buildVideoBody(article, 'failed'),
        pageHtml,
        article.originUrl,
        article,
        extraSources,
        signal,
      )
    }
    const content = article.summary
      ? `<p>${escapeHtml(article.summary)}</p>`
      : ''
    return await withRelatedFromPage(
      {
        contentHtml: sanitizeArticleHtml(
          mediaDescriptorHtml(descriptor, {
            title: article.title,
            poster: article.image,
            contentHtml: content,
          }),
        ),
        image: article.image,
        bodySource: 'video',
      },
      pageHtml,
      article.originUrl,
      article,
      extraSources,
      signal,
    )
  }

  const netease = await resolveNetEaseArticleBody(article, signal).catch(() => null)
  if (netease) return netease

  const zhihu = await resolveZhihuBody(article, signal).catch(() => null)
  if (zhihu) return zhihu

  const jiqizhixin = await resolveJiqizhixinBody(article, signal).catch(() => null)
  if (jiqizhixin) return jiqizhixin

  if (!article.originUrl) {
    throw new Error('缺少原文地址，无法抽取正文')
  }

  let originUrl = preferPublisherFetchUrl(article.originUrl)
  let resolvedOriginUrl: string | undefined

  if (isGoogleNewsArticleUrl(originUrl)) {
    try {
      originUrl = await decodeGoogleNewsUrl(
        originUrl,
        {
          getText: (url, sig) => fetchAbsoluteText(url, { signal: sig }),
          postForm: (url, form, sig) =>
            fetchAbsoluteFormPost(url, form, {
              signal: sig,
              headers: { Referer: 'https://news.google.com/' },
            }),
        },
        signal,
      )
      originUrl = preferPublisherFetchUrl(originUrl)
      resolvedOriginUrl = originUrl
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `无法跳转到原网站：${error.message}`
          : '无法跳转到原网站',
      )
    }
  }

  // 视频页也可走 Readability 兜底
  const candidates: string[] = []
  // 网易：full.html 偶发 204、news.163.com 常 404；优先移动站与网易号落地页
  for (const docid of candidateNeteaseIds(article)) {
    candidates.push(
      `https://m.163.com/news/article/${docid}.html`,
      `https://www.163.com/dy/article/${docid}.html`,
    )
  }
  candidates.push(originUrl)
  // 历史缓存可能仍是裸域链接；www 优先已由 preferPublisherFetchUrl 处理，再兜底试一次裸域无意义
  if (originUrl.includes('/trad')) {
    candidates.push(originUrl.replace('/trad', '/simp'))
  }
  if (originUrl.includes('/simp')) {
    candidates.push(originUrl.replace('/simp', '/trad'))
  }

  const tried = new Set<string>()
  let lastError: unknown
  const pageUa = pageUserAgentForArticle(article, extraSources)

  const tryExtract = async (pageUrl: string, userAgent = pageUa): Promise<ResolvedBody> => {
    const pageHtml = await fetchAbsoluteText(pageUrl, {
      signal,
      userAgent,
    })
    if (!pageHtml.trim() || pageHtml.length < 200) {
      throw new Error('原文页为空')
    }
    if (isBlockedPublisherHtml(pageHtml)) {
      throw new Error('原站拒绝抓取')
    }
    if (hasBrokenTextEncoding(pageHtml)) {
      throw new Error('原文字符集解析失败')
    }
    let extracted = await extractWithReadability(pageHtml, pageUrl)
    let mediaBase: ResolvedBody | undefined
    let mediaOptions: Parameters<typeof discoverMediaDescriptor>[0] | undefined
    if (hasBrokenTextEncoding(extracted.contentHtml)) {
      throw new Error('正文字符集解析失败')
    }
    if (!/<video\b/i.test(extracted.contentHtml)) {
      const mayContainMedia = isLikelyVideoPageUrl(pageUrl) || /<(?:video|source|iframe)\b|VideoObject|\.m3u8(?:[?"'])|\.mpd(?:[?"'])|\.mp4(?:[?"'])/i.test(pageHtml)
      if (mayContainMedia) {
        const options = {
          pageUrl,
          html: pageHtml,
          runtime: true,
          timeoutMs: 4500,
          signal,
        } as const
        if (onMediaResolved) {
          const base = withArticleAudio({ ...extracted, resolvedOriginUrl }, article, pageHtml)
          mediaBase = base
          mediaOptions = options
        } else {
          const descriptor = await discoverMediaDescriptor(options).catch(() => null)
          const enriched = applyMediaDescriptor(
            extracted,
            descriptor,
            extracted.title || article.title,
            extracted.image || article.image,
          )
          if (enriched) extracted = enriched
        }
      }
    }
    if (stripTags(extracted.contentHtml).length < 80 && !/<video\b/i.test(extracted.contentHtml)) {
      throw new Error('抽取正文过短')
    }
    if (isScrapeNoticeBody(extracted.contentHtml)) {
      throw new Error('原站仅返回反爬声明')
    }
    const resolved = await withRelatedFromPage(
      mediaBase || withArticleAudio({ ...extracted, resolvedOriginUrl }, article, pageHtml),
      pageHtml,
      pageUrl,
      article,
      extraSources,
      signal,
    )
    if (mediaBase && mediaOptions) {
      scheduleMediaDiscovery(
        mediaOptions,
        resolved,
        extracted.title || article.title,
        extracted.image || article.image,
        onMediaResolved,
      )
    }
    return resolved
  }

  for (const pageUrl of candidates) {
    if (!pageUrl || tried.has(pageUrl)) continue
    tried.add(pageUrl)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await tryExtract(pageUrl)
      } catch (error) {
        lastError = error
      }
    }
  }

  // 被反爬拦下时先换爬虫 UA 直连原文页，比走镜像更完整
  for (const ua of CRAWLER_FALLBACK_UAS) {
    try {
      return await tryExtract(originUrl, ua)
    } catch (error) {
      lastError = error
    }
  }

  // 出版社反爬时，经 Google 翻译镜像再试（英文 / 中文各一）
  const translateLangs = /[\u4e00-\u9fff]/.test(`${article.title}\n${article.summary}`)
    ? (['zh-CN', 'en'] as const)
    : (['en', 'zh-CN'] as const)
  for (const tl of translateLangs) {
    const translateUrl = googleTranslateProxyUrl(originUrl, tl)
    if (!translateUrl || tried.has(translateUrl)) continue
    tried.add(translateUrl)
    try {
      return await tryExtract(translateUrl)
    } catch (error) {
      lastError = error
    }
  }

  // NYT / WSJ / Reuters 等硬拦截：至少给出摘要 + 引导外开，避免只剩 HTTP 状态码
  if (resolvedOriginUrl || article.summary?.trim()) {
    return buildBlockedPublisherFallback(article, resolvedOriginUrl)
  }

  throw lastError instanceof Error ? lastError : new Error('正文抽取失败')
}
