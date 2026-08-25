import { XMLParser } from 'fast-xml-parser'

import {
  bestMediaUrlInPayload,
  bestPosterUrlInPayload,
} from '../features/mediaSniffer/core'
import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
import { collectAudioSrc, isAudioMediaUrl } from './articleAudio'
import { feedArticleId } from './articleId'
import { cleanSummaryText } from './cleanSummary'
import type { NewsSource, SourceKind } from '../sources/registry'
import type { Article } from './types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // 去掉命名空间，dc:date / content:encoded / media:thumbnail 都会被拍平
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
})

type Unknown = Record<string, unknown>

function asRecord(value: unknown): Unknown | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Unknown) : undefined
}

function toArray(value: unknown): unknown[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/** 节点可能是字符串、带属性的对象或数组，统一取出文本 */
function text(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = text(entry)
      if (found) return found
    }
    return ''
  }
  const record = asRecord(value)
  if (record && '#text' in record) return text(record['#text'])
  return ''
}

function pick(node: Unknown, ...keys: string[]): unknown {
  for (const key of keys) {
    if (node[key] != null) return node[key]
  }
  return undefined
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstImageIn(html: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1]
}

function attr(value: unknown, name: string): string | undefined {
  for (const entry of toArray(value)) {
    const record = asRecord(entry)
    const found = record?.[name]
    if (typeof found === 'string' && found) return found
  }
  return undefined
}

function parseDate(raw: string): number | undefined {
  if (!raw) return undefined
  const parsed = Date.parse(raw)
  if (!Number.isNaN(parsed)) return parsed

  // 知乎日报等：yyyyMMdd
  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4))
    const month = Number(raw.slice(4, 6)) - 1
    const day = Number(raw.slice(6, 8))
    const time = new Date(year, month, day).getTime()
    return Number.isNaN(time) ? undefined : time
  }

  // 少数源使用 "2026-07-31 09:01:25"
  const normalized = raw.replace(' ', 'T')
  const retry = Date.parse(normalized)
  if (!Number.isNaN(retry)) return retry

  // 晚点等："08月04日" / "2026/08/03 17:24"
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
  if (slash) {
    const year = Number(slash[1])
    const month = Number(slash[2]) - 1
    const day = Number(slash[3])
    const hour = slash[4] ? Number(slash[4]) : 0
    const minute = slash[5] ? Number(slash[5]) : 0
    const time = new Date(year, month, day, hour, minute).getTime()
    return Number.isNaN(time) ? undefined : time
  }

  const md = raw.match(/(\d{1,2})月(\d{1,2})日/)
  if (md) {
    const now = new Date()
    let year = now.getFullYear()
    const month = Number(md[1]) - 1
    const day = Number(md[2])
    let time = new Date(year, month, day).getTime()
    // 省略年份的日期跨年时会落到未来。阈值取 45 天：
    // 预告稿只领先几天，跨年误判则领先数月，两者不会混淆。
    const FUTURE_TOLERANCE_MS = 45 * 24 * 60 * 60 * 1000
    if (time > now.getTime() + FUTURE_TOLERANCE_MS) {
      year -= 1
      time = new Date(year, month, day).getTime()
    }
    return Number.isNaN(time) ? undefined : time
  }

  return undefined
}

/**
 * 晚点列表接口 `release_time` 的已知缺陷：把月份写成「日」，
 * 只会出现「06月06日 / 07月07日 / 08月08日」这类月=日字符串，不是真实发稿日。
 * 详情页才有可信值，形如 `release_time = '2026/08/04'`。
 */
export function isBogusLatepostListDate(raw: string): boolean {
  const match = raw.trim().match(/^(\d{1,2})月(\d{1,2})日$/)
  return Boolean(match && match[1] === match[2])
}

/** 从晚点详情页 HTML 取出真实发稿时间 */
export function extractLatepostReleaseTime(html: string): string | undefined {
  const match = html.match(/release_time\s*=\s*'([^']+)'/)
  const value = match?.[1]?.trim()
  return value || undefined
}

/**
 * 用详情页补全晚点列表里被丢弃的日期。
 * `fetchHtml` 由调用方注入（浏览器走 /api/page，原生直连），避免 parseFeed 依赖 http。
 */
export async function enrichLatepostDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractLatepostReleaseTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}

/** 甲子光年详情页主时间：`<div class="time font-12">2026-07-29</div>`，取首次命中 */
export function extractJazzyearPublishTime(html: string): string | undefined {
  const match = html.match(/class="[^"]*time[^"]*"[^>]*>\s*(20\d{2}-\d{2}-\d{2})/)
  return match?.[1]
}

/**
 * 用详情页补全甲子光年列表缺日期的条目。
 * `fetchHtml` 由调用方注入，避免 parseFeed 依赖 http。
 */
export async function enrichJazzyearDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractJazzyearPublishTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}

const PG_MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

/** 正文页标题图后的 `June 2026`；只看页头，避免正文里提到的其它月份串台 */
export function extractPaulGrahamPublishTime(html: string): string | undefined {
  const head = html.slice(0, 12_000)
  const match = head.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i,
  )
  if (!match) return undefined
  const month = PG_MONTHS[match[1].toLowerCase()]
  const year = Number(match[2])
  if (month == null || year < 1990 || year > 2100) return undefined
  return `${year}-${String(month + 1).padStart(2, '0')}-01`
}

/** 列表页无日期；只补最近若干篇，避免每次刷新打满整站随笔 */
const PG_DATE_ENRICH_LIMIT = 40

export async function enrichPaulGrahamDates(
  articles: Article[],
  fetchHtml: (url: string, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
  options?: { concurrency?: number },
): Promise<Article[]> {
  const concurrency = Math.max(1, options?.concurrency ?? 5)
  const next = articles.slice()
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < next.length) {
      if (signal?.aborted) return
      const index = cursor
      cursor += 1
      const article = next[index]
      if (index >= PG_DATE_ENRICH_LIMIT) continue
      if (!article || article.hasRealDate || !article.originUrl) continue
      try {
        const html = await fetchHtml(article.originUrl, signal)
        if (signal?.aborted) return
        const published = parseDate(extractPaulGrahamPublishTime(html) ?? '')
        if (published == null) continue
        next[index] = { ...article, publishedAt: published, hasRealDate: true }
      } catch {
        // 单条详情失败不影响整页列表
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, next.length) }, () => worker())
  await Promise.all(workers)
  return next
}

function linkOfAtomEntry(node: Unknown): string {
  const links = toArray(node.link)
  const records = links.map(asRecord).filter(Boolean) as Unknown[]
  const alternate = records.find((item) => {
    const rel = item['@_rel']
    return (rel === undefined || rel === 'alternate') && typeof item['@_href'] === 'string'
  })
  if (alternate) return String(alternate['@_href'])
  const anyHref = records.find((item) => typeof item['@_href'] === 'string')
  if (anyHref) return String(anyHref['@_href'])
  return text(node.link)
}

function httpUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined
}

function enclosureRecords(node: Unknown): Unknown[] {
  return toArray(node.enclosure).map(asRecord).filter(Boolean) as Unknown[]
}

function audioUrlFromNode(node: Unknown, html: string): string | undefined {
  for (const rec of enclosureRecords(node)) {
    const url = httpUrl(rec['@_url'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (url && isAudioMediaUrl(url, type)) return url
  }
  for (const raw of toArray(node.link)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const rel = String(rec['@_rel'] || '')
    const href = httpUrl(rec['@_href'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (href && rel === 'enclosure' && isAudioMediaUrl(href, type)) return href
  }
  for (const raw of toArray(node.attachments)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const url = httpUrl(text(rec.url))
    const type = text(rec.mime_type) || text(rec.mimeType)
    if (url && isAudioMediaUrl(url, type)) return url
  }
  return collectAudioSrc(html)
}

function imageOf(node: Unknown, html: string): string | undefined {
  const candidates: Array<string | undefined> = []
  for (const rec of enclosureRecords(node)) {
    const url = httpUrl(rec['@_url'])
    const type = typeof rec['@_type'] === 'string' ? rec['@_type'] : ''
    if (url && !isAudioMediaUrl(url, type) && !/^video\//i.test(type)) {
      candidates.push(url)
    }
  }
  candidates.push(
    attr(node.thumbnail, '@_url'),
    attr(node.content, '@_url'),
    attr(node.image, '@_url'),
    attr(node.image, '@_href'),
    text(asRecord(node.image)?.url),
  )
  for (const raw of toArray(node.attachments)) {
    const rec = asRecord(raw)
    if (!rec) continue
    const url = httpUrl(text(rec.url))
    const type = text(rec.mime_type) || text(rec.mimeType)
    if (
      url &&
      !isAudioMediaUrl(url, type) &&
      (/^image\//i.test(type) || /\.(?:png|jpe?g|gif|webp)(?:$|[?#])/i.test(url))
    ) {
      candidates.push(url)
    }
  }
  const direct = candidates.find((value) => httpUrl(value))
  return direct ?? firstImageIn(html)
}

function buildArticle(
  source: NewsSource,
  raw: {
    title: string
    link: string
    html: string
    summaryText: string
    dateRaw: string
    image?: string
    contentType?: Article['contentType']
    videoUrl?: string
    audioUrl?: string
    neteaseDocId?: string
  },
  fetchedAt: number,
): Article | undefined {
  const title = stripTags(raw.title)
  if (!title) return undefined

  const published = parseDate(raw.dateRaw)
  const cleaned = cleanSummaryText(raw.summaryText, title)
  const summary = (cleaned || raw.summaryText).slice(0, 220)

  return {
    id: feedArticleId(source.id, raw.link || title),
    title,
    summary,
    contentHtml: raw.html && raw.html.includes('<') ? raw.html : undefined,
    image: raw.image,
    publishedAt: published ?? fetchedAt,
    hasRealDate: published != null,
    sourceId: source.id,
    sourceName: source.name,
    sourceLabel: source.label,
    sourceGroup: source.group,
    originUrl: raw.link,
    contentType: raw.contentType ?? 'article',
    videoUrl: raw.videoUrl,
    audioUrl: raw.audioUrl,
    neteaseDocId: raw.neteaseDocId,
  }
}

function parseJsonFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const data = JSON.parse(payload) as Unknown
  const items = toArray(data.items)
  const articles: Article[] = []

  for (const raw of items) {
    const node = asRecord(raw)
    if (!node) continue
    const html =
      text(node.content_html) ||
      (text(node.content_text) ? `<p>${text(node.content_text)}</p>` : '')
    const summaryText =
      text(node.summary) ||
      text(node.content_text) ||
      stripTags(html)
    const link = text(node.url) || text(node.external_url) || text(node.id)
    const image = text(node.image) || imageOf(node, html)

    const article = buildArticle(
      source,
      {
        title: text(node.title),
        link,
        html,
        summaryText,
        dateRaw: text(node.date_published) || text(node.date_modified),
        image,
        audioUrl: audioUrlFromNode(node, html),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

function looksLikeJsonFeed(payload: string): boolean {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const data = JSON.parse(trimmed) as Unknown
    return Array.isArray(data.items) && (typeof data.version === 'string' || Boolean(data.title))
  } catch {
    return false
  }
}

function parseGenericFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  if (looksLikeJsonFeed(payload)) {
    return parseJsonFeed(source, payload, fetchedAt)
  }
  return parseXmlFeed(source, payload, fetchedAt)
}

function parseXmlFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const document = parser.parse(payload) as Unknown
  const articles: Article[] = []

  const rss = asRecord(document.rss)
  const channel = asRecord(rss?.channel)
  const atom = asRecord(document.feed)
  const rdf = asRecord(document.RDF)

  const nodes: Unknown[] = []
  let isAtom = false

  if (channel) {
    nodes.push(...(toArray(channel.item).map(asRecord).filter(Boolean) as Unknown[]))
  } else if (atom) {
    isAtom = true
    nodes.push(...(toArray(atom.entry).map(asRecord).filter(Boolean) as Unknown[]))
  } else if (rdf) {
    nodes.push(...(toArray(rdf.item).map(asRecord).filter(Boolean) as Unknown[]))
  }

  for (const node of nodes) {
    const html = text(pick(node, 'encoded', 'content', 'description', 'summary'))
    const descriptionText = stripTags(
      text(pick(node, 'description', 'summary')) || html,
    )
    const link = isAtom ? linkOfAtomEntry(node) : text(node.link) || text(node.guid)
    const dateRaw = text(pick(node, 'pubDate', 'published', 'updated', 'date'))
    // 虎嗅官方 RSS 用自定义 <type>video_article</type> 标识视频稿，
    // description 只有一句导语，视频地址需要在打开正文时从详情接口补齐。
    const contentType =
      source.id === 'huxiu' && text(node.type).toLowerCase() === 'video_article'
        ? 'video'
        : undefined

    const article = buildArticle(
      source,
      {
        title: text(node.title),
        link,
        html,
        summaryText: descriptionText,
        dateRaw,
        image: imageOf(node, html),
        audioUrl: audioUrlFromNode(node, html),
        contentType,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

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

function stableNeteaseDocId(raw: string): string | undefined {
  // 正常稿件 docid，如 L35E0QFF00019B3E；排除视频拼接脏串
  if (/^[A-Z0-9]{8,24}$/i.test(raw)) return raw
  return undefined
}

/** 整条是网易号短视频卡片（非「文章正文里带了视频」）。 */
function isNeteaseHaoShortVideoCard(entry: Unknown, videoinfo: Unknown | undefined): boolean {
  const boardid = text(entry.boardid)
  const docid = text(entry.docid)
  const videosource = text(entry.videosource) || text(videoinfo?.videosource)
  if (boardid === 'video_bbs') return true
  if (/updateDoc$/i.test(docid)) return true
  return videosource === '新媒体' || videosource === '其他'
}

function parseNetease(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const data = JSON.parse(payload) as Record<string, unknown>
  // 汽车等频道顶层为 list；普通频道为动态 TID 数组键
  const listKey =
    (Array.isArray(data.list) ? 'list' : undefined) ||
    Object.keys(data).find((key) => Array.isArray(data[key]))
  if (!listKey) return []

  const entries = (data[listKey] as unknown[]).map(asRecord).filter(Boolean) as Unknown[]

  return entries.flatMap((entry) => {
    const title = text(entry.title)
    if (!title) return []

    const skipType = text(entry.skipType)
    // 图集 / 专题本期不做站内展开，避免点开后必失败
    if (skipType === 'photoset' || skipType === 'special') return []

    const videoinfo = asRecord(entry.videoinfo)
    const isVideo = skipType === 'video' || Boolean(videoinfo) || Boolean(text(entry.videoID))
    // 丢掉灌进频道的网易号短视频卡片；正文内嵌视频的文章条目不走这条分支
    if (isVideo && isNeteaseHaoShortVideoCard(entry, videoinfo)) return []

    if (isVideo) {
      const vid = text(entry.videoID) || text(entry.skipID) || text(videoinfo?.vid)
      if (!vid) return []
      const description =
        stripTags(text(videoinfo?.description)) ||
        stripTags(text(entry.digest)) ||
        title
      const link = `https://3g.163.com/news/video/${vid}.html`
      const cover = bestPosterUrlInPayload(
        { videoinfo, image: entry.imgsrc },
        link,
      )
      const coverHttps = cover ? preferHttpsAsset(cover) : undefined
      const videoUrl = bestMediaUrlInPayload(videoinfo, link)

      const article = buildArticle(
        source,
        {
          title,
          link,
          html: '',
          summaryText: description,
          dateRaw: text(entry.ptime) || text(videoinfo?.ptime),
          image: coverHttps,
          contentType: 'video',
          videoUrl,
          neteaseDocId: stableNeteaseDocId(text(entry.postid)) || vid,
        },
        fetchedAt,
      )
      return article ? [article] : []
    }

    const docid =
      stableNeteaseDocId(text(entry.docid)) ||
      stableNeteaseDocId(text(entry.postid)) ||
      undefined

    // 独家/网易号等列表常给 url_3w=news.163.com，实测大量 404；
    // m 站与 dy 站才是真实落地页。优先 https 移动站，再退回 docid 拼链。
    const mobileUrl = text(entry.url)
    const desktopUrl = text(entry.url_3w)
    const link =
      (mobileUrl.startsWith('http') ? mobileUrl : '') ||
      (docid ? `https://m.163.com/news/article/${docid}.html` : '') ||
      (desktopUrl.startsWith('http') ? desktopUrl : '')

    if (!link) return []

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: stripTags(text(entry.digest)),
        dateRaw: text(entry.ptime),
        image: text(entry.imgsrc) ? preferHttpsAsset(text(entry.imgsrc)) : undefined,
        contentType: 'article',
        neteaseDocId: docid,
      },
      fetchedAt,
    )
    return article ? [article] : []
  })
}

/** Raw page size before unsupported photosets/specials are filtered out. */
export function neteasePageEntryCount(payload: string): number {
  try {
    const data = JSON.parse(payload) as Record<string, unknown>
    if (Array.isArray(data.list)) return data.list.length
    const list = Object.values(data).find(Array.isArray)
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

function parseZhihuDaily(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const data = JSON.parse(payload) as Unknown
  const dateRaw = text(data.date)
  const stories = [
    ...toArray(data.top_stories),
    ...toArray(data.stories),
  ]
    .map(asRecord)
    .filter(Boolean) as Unknown[]

  return stories.flatMap((story, storyIndex) => {
    const id = text(story.id)
    const title = text(story.title)
    if (!id || !title) return []

    const images = toArray(story.images).map(text).filter(Boolean)
    const image = text(story.image) || images[0] || undefined
    const link = `https://daily.zhihu.com/story/${id}`

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: stripTags(text(story.hint) || text(story.title)),
        dateRaw,
        image,
        contentType: 'article',
        neteaseDocId: id,
      },
      fetchedAt,
    )
    // The API provides one edition date for the whole page. Preserve editorial
    // order deterministically instead of leaving every story on the same timestamp.
    return article ? [{ ...article, publishedAt: article.publishedAt - storyIndex }] : []
  })
}

/** 知乎日报 JSON 的 edition date（yyyyMMdd），用于 before 分页 */
export function zhihuEditionDate(payload: string): string | undefined {
  try {
    const data = JSON.parse(payload) as { date?: unknown }
    const date = typeof data.date === 'string' ? data.date.trim() : ''
    return /^\d{8}$/.test(date) ? date : undefined
  } catch {
    return undefined
  }
}

const ARENA_SKIP_SLUGS = new Set([
  'about',
  'category',
  'page',
  'tag',
  'rss',
  'feed',
  'leaderboard-changelog',
])

/** 解码 flight / JS 字符串片段里的 \\uXXXX 与转义引号 */
function decodeFlightText(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
  }
}

function nextFlightBlob(html: string): string {
  const chunks: string[] = []
  const re = /self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)/g
  for (const match of html.matchAll(re)) {
    chunks.push(decodeFlightText(match[1]))
  }
  return chunks.length ? chunks.join('') : html
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Arena（arena.ai/blog）无官方 RSS。
 * 列表页把 Sanity CMS 文章元数据嵌在 Next.js flight payload 里，从中抽出 slug / 标题 / 发布时间。
 */
function parseArenaBlog(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const blob = nextFlightBlob(payload)
  const found = new Map<string, { publishedAt: string; title: string }>()

  const pattern =
    /"publishedAt"\s*:\s*"([^"]+)"[\s\S]{0,500}?"slug"\s*:\s*\{[^}]*?"current"\s*:\s*"([^"]+)"[\s\S]{0,900}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/g

  for (const match of blob.matchAll(pattern)) {
    const publishedAt = match[1]
    const slug = match[2]
    const titleRaw = match[3]
    if (!slug || ARENA_SKIP_SLUGS.has(slug)) continue
    const title = decodeFlightText(titleRaw).trim()
    if (!title) continue
    const prev = found.get(slug)
    if (!prev || publishedAt > prev.publishedAt) {
      found.set(slug, { publishedAt, title })
    }
  }

  // 若 flight 解析失败，退回 sitemap 的 loc（标题用 slug 可读化）
  if (!found.size) {
    for (const match of payload.matchAll(
      /<loc>\s*(https:\/\/arena\.ai\/blog\/([a-z0-9-]+)\/?)\s*<\/loc>/gi,
    )) {
      const slug = match[2]
      if (!slug || ARENA_SKIP_SLUGS.has(slug)) continue
      found.set(slug, {
        publishedAt: '',
        title: titleFromSlug(slug),
      })
    }
  }

  const articles: Article[] = []
  for (const [slug, meta] of found) {
    const link = `https://arena.ai/blog/${slug}/`
    const article = buildArticle(
      source,
      {
        title: meta.title,
        link,
        html: '',
        summaryText: meta.title,
        dateRaw: meta.publishedAt,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles.sort((a, b) => b.publishedAt - a.publishedAt)
}

const ANTHROPIC_SKIP_SLUGS = new Set(['press-kit', 'feed', 'tag', 'page', 'category'])

/**
 * Anthropic News（anthropic.com/news）无官方 RSS。
 * 与 Arena 类似：Sanity 元数据嵌在 Next.js flight 里（publishedOn / slug.current / title）。
 */
function parseAnthropicNews(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const blob = nextFlightBlob(payload)
  const found = new Map<string, { publishedAt: string; title: string; summary: string }>()

  const pattern =
    /"publishedOn"\s*:\s*"([^"]+)"[\s\S]{0,500}?"slug"\s*:\s*\{[^}]*?"current"\s*:\s*"([^"]+)"[\s\S]{0,1200}?"title"\s*:\s*"((?:\\.|[^"\\])*)"/g

  for (const match of blob.matchAll(pattern)) {
    const publishedAt = match[1]
    const slug = match[2]
    const titleRaw = match[3]
    if (!slug || ANTHROPIC_SKIP_SLUGS.has(slug)) continue
    const title = decodeFlightText(titleRaw).trim()
    if (!title) continue
    const window = match[0]
    const summaryMatch = window.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/)
    const summary = summaryMatch ? decodeFlightText(summaryMatch[1]).trim() : ''
    const prev = found.get(slug)
    if (!prev || publishedAt > prev.publishedAt) {
      found.set(slug, { publishedAt, title, summary })
    }
  }

  // flight 失败时退回列表页可见的 /news/<slug> 链接
  if (!found.size) {
    for (const match of payload.matchAll(/href="\/news\/([a-zA-Z0-9-]+)"/g)) {
      const slug = match[1]
      if (!slug || ANTHROPIC_SKIP_SLUGS.has(slug)) continue
      found.set(slug, { publishedAt: '', title: titleFromSlug(slug), summary: '' })
    }
  }

  const articles: Article[] = []
  for (const [slug, meta] of found) {
    const link = `https://www.anthropic.com/news/${slug}`
    const article = buildArticle(
      source,
      {
        title: meta.title,
        link,
        html: '',
        summaryText: meta.summary || meta.title,
        dateRaw: meta.publishedAt,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles.sort((a, b) => b.publishedAt - a.publishedAt)
}

/**
 * 煎蛋 i.jandan.net JSON API（get_category_posts / get_tag_posts / get_recent_posts）。
 * 列表已含全文 HTML，详情可直接复用 contentHtml。
 */
function parseJandan(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  if (text(data.status) && text(data.status) !== 'ok') return []

  const posts = toArray(data.posts).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []

  for (const post of posts) {
    const title = text(post.title_plain) || text(post.title)
    const id = text(post.id)
    const apiUrl = text(post.url)
    const link =
      (id ? `https://jandan.net/p/${id}` : '') ||
      (apiUrl.startsWith('http') ? apiUrl.replace('://i.jandan.net/', '://jandan.net/') : '')
    if (!title || !link) continue

    const html = typeof post.content === 'string' ? post.content : text(post.content)
    const excerpt = stripTags(typeof post.excerpt === 'string' ? post.excerpt : text(post.excerpt))
    const imageRaw =
      text(post.thumbnail) ||
      text(asRecord(post.thumbnail_images)?.full) ||
      text(asRecord(post.thumbnail_images)?.large) ||
      firstImageIn(html)
    const image = imageRaw
      ? preferHttpsAsset(imageRaw.startsWith('//') ? `https:${imageRaw}` : imageRaw)
      : undefined

    const article = buildArticle(
      source,
      {
        title,
        link,
        html,
        summaryText: excerpt || stripTags(html),
        dateRaw: text(post.date) || text(post.modified),
        image,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 机器之心文章库 JSON（/api/article_library/articles.json）。
 * 列表 content 多为摘要；全文走详情 JSON（resolveBody）。
 */
function parseJiqizhixin(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  if (data.success === false) return []

  const posts = toArray(data.articles).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []

  for (const post of posts) {
    const title = text(post.title)
    const id = text(post.id)
    const slug = text(post.slug)
    if (!title || !id) continue

    const link = `https://www.jiqizhixin.com/articles/${slug || id}`
    const summary = text(post.content) || text(post.description)
    const imageRaw = text(post.coverImageUrl) || text(post.cover_image_url)
    const image = imageRaw ? preferHttpsAsset(imageRaw) : undefined

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: summary,
        dateRaw: text(post.publishedAt) || text(post.published_at),
        image,
        // 复用字段传递详情 id，供 resolveBody 拉全文 JSON
        neteaseDocId: id,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 晚点 LatePost：POST /site/index 返回 JSON 列表。
 * 列表 `release_time` 常为「08月08日」这类月=日伪日期，不可直接用；
 * 真实发稿日在详情页 `release_time = '2026/08/04'`，由 enrichLatepostDates 补全。
 * 正文在详情页 HTML，走 Readability。
 */
function parseLatepost(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  if (Number(data.code) !== 1 && text(data.code) !== '1') return []

  const posts = toArray(data.data).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []

  for (const post of posts) {
    const title = text(post.title)
    const id = text(post.id)
    const detailPath = text(post.detail_url) || (id ? `/news/dj_detail?id=${id}` : '')
    if (!title || !detailPath) continue

    const link = detailPath.startsWith('http')
      ? detailPath
      : `https://www.latepost.com${detailPath.startsWith('/') ? '' : '/'}${detailPath}`
    const cover = text(post.cover)
    const image = cover
      ? preferHttpsAsset(cover.startsWith('http') ? cover : `https://www.latepost.com${cover}`)
      : undefined

    const releaseTime = text(post.release_time)
    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: text(post.abstract) || text(post.intro),
        // 列表「08月08日」不可信，留给 enrichLatepostDates 用详情页补全
        dateRaw: isBogusLatepostListDate(releaseTime) ? '' : releaseTime,
        image,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 公众号正文的已知模板噪声（wechat2rss 镜像 feed 与 mp.weixin.qq.com 页面共用）：
 * - 头部「原创 <作者> <YYYY-MM-DD HH:MM> <地点>」meta 行（镜像模板）
 * - 尾部「跳转微信打开」link-proxy 链接（镜像模板）
 * - 隐藏的 <mp-style-type> 排版标记（微信编辑器产物，原文页里也有）
 */
export function cleanWechatArticleHtml(html: string): string {
  let out = html

  const lead = out.match(/^\s*<p\b[^>]*>([\s\S]{0,600}?)<\/p>/)
  if (lead) {
    const leadText = stripTags(lead[1])
    // meta 行很短且必含「YYYY-MM-DD HH:MM」发布时间；正文首段不会同时满足
    if (leadText.length <= 80 && /\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(leadText)) {
      out = out.slice((lead.index ?? 0) + lead[0].length)
    }
  }

  return out
    .replace(/<p\b[^>]*>\s*<mp-style-type\b[^>]*>[\s\S]*?<\/mp-style-type>\s*<\/p>/gi, '')
    .replace(/<mp-style-type\b[^>]*>[\s\S]*?<\/mp-style-type>/gi, '')
    .replace(/<p\b[^>]*>\s*<a\b[^>]*>\s*跳转微信打开\s*<\/a>\s*<\/p>\s*$/i, '')
    .trim()
}

/**
 * 公众号镜像 feed（wechat2rss，过渡列表数据源）：标准 RSS + content:encoded 全文
 * （占 feed 体积 98–99%，实测 0.7–2.9MB/20 条）。信息流与正文分离：全文只用来派生
 * 摘要与封面，不进列表条目；正文由 resolveBody 按需直连 mp.weixin.qq.com 文章页
 * 抽取（extractWechatBodyHtml），bodyCache 承接已读缓存。
 * 调研与取舍见 docs/superpowers/specs/2026-08-25-wechat-account-stream-research.md。
 */
function parseWechatMirrorFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  return parseXmlFeed(source, payload, fetchedAt).map((article) => {
    if (!article.contentHtml) return article
    const cleaned = cleanWechatArticleHtml(article.contentHtml)
    // 清洗后没剩标签说明全文形态异常，仍从原始全文取摘要素材
    const summarySource = cleaned.includes('<') ? cleaned : article.contentHtml

    const summaryText = stripTags(summarySource)
    const cleanedSummary = cleanSummaryText(summaryText, article.title)
    return {
      ...article,
      contentHtml: undefined,
      summary: (cleanedSummary || summaryText).slice(0, 220),
      image: article.image ?? firstImageIn(summarySource),
    }
  })
}

/**
 * 公众号公开合集（mp.weixin.qq.com/mp/appmsgalbum + f=json）：
 * getalbum_resp.article_list 携带标题 / 原文链接 / 秒级时间戳 / 封面，正文不随列表下发，
 * 打开条目时由 resolveBody 直连文章页抽取。ret 非 0（参数错误 / 合集不可见）返回空列表。
 */
function parseWechatAlbum(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  const baseResp = asRecord(data.base_resp)
  if (baseResp && Number(text(baseResp.ret) || '0') !== 0) return []

  const resp = asRecord(data.getalbum_resp)
  if (!resp) return []

  const articles: Article[] = []
  for (const raw of toArray(resp.article_list)) {
    const node = asRecord(raw)
    if (!node) continue
    const title = text(node.title)
    const link = text(node.url).replace(/^http:\/\//i, 'https://')
    if (!title || !link.startsWith('https://')) continue

    // create_time 为 unix 秒；缺失时留空走 fetchedAt
    const createTime = Number(text(node.create_time))
    const dateRaw =
      Number.isFinite(createTime) && createTime > 0
        ? new Date(createTime * 1000).toISOString()
        : ''

    const cover =
      text(node.cover_img_1_1) ||
      text(node.cover_img_url_1_1) ||
      text(node.cover_img_url) ||
      text(node.cover_url)

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: '',
        dateRaw,
        image: cover.replace(/^http:\/\//i, 'https://') || undefined,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 公众号解析器（kind `wechat`）：按响应载荷分流——
 * JSON 视为公开合集接口，其余按镜像 RSS 解析。
 */
function parseWechatSource(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  if (payload.trim().startsWith('{')) {
    return parseWechatAlbum(source, payload, fetchedAt)
  }
  return parseWechatMirrorFeed(source, payload, fetchedAt)
}

/** 优设列表卡片里的站内功能页（非文章落地页） */
const UISDC_SKIP_PATH_RE =
  /^\/(?:tag|category|u|a|zt|news|hunter|hunters|members|about|tip|contribution|archives|procenter|similarsites|ajax)(?:\/|$)/i

/** 优设近一周内的卡片用「刚刚 / N分钟前 / N小时前 / N天前」相对日期，先归一成绝对时刻 */
function uisdcAbsoluteDate(raw: string, fetchedAt: number): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (/^刚刚$/.test(trimmed) || /^\d+\s*秒前$/.test(trimmed)) {
    return new Date(fetchedAt).toISOString()
  }
  const relative = trimmed.match(/^(\d+)\s*(分钟|小时|天|周|个月)前$/)
  if (!relative) return trimmed
  const unitMs: Record<string, number> = {
    分钟: 60_000,
    小时: 3_600_000,
    天: 86_400_000,
    周: 7 * 86_400_000,
    个月: 30 * 86_400_000,
  }
  const offset = Number(relative[1]) * unitMs[relative[2]]
  return new Date(fetchedAt - offset).toISOString()
}

/**
 * 优设（uisdc.com）tag 列表页。/feed 返回首页 HTML、tag feed 与 WP REST 均 404，
 * 只能解析归档 HTML：卡片在 <div class="item-wrap">，标题链接在 h2.item-title，
 * 发布日期在 i.meta-time（YYYY/MM/DD）。正文由 resolveBody 的优设专用抽取
 * （`extractUisdcBodyHtml`）处理 group 图集与长文，不再依赖裸 Readability。
 */
function parseUisdcTag(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const seen = new Set<string>()
  const articles: Article[] = []

  for (const block of payload.split('<div class="item-wrap">').slice(1)) {
    const titleMatch = block.match(
      /<h2 class="item-title">\s*<a\b[^>]*href="(https?:\/\/www\.uisdc\.com\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/,
    )
    if (!titleMatch) continue

    const link = titleMatch[1]
    const title = stripTags(titleMatch[2])
    if (!title || seen.has(link)) continue

    let pathname = ''
    try {
      pathname = new URL(link).pathname
    } catch {
      continue
    }
    if (UISDC_SKIP_PATH_RE.test(pathname)) continue

    const dateRaw = block.match(/class="meta-time">\s*([^<]+)/)?.[1]?.trim() ?? ''
    const image = block.match(/<img\b[^>]+src="(https?:\/\/[^"]+)"/)?.[1]
    const author = stripTags(block.match(/class="u-name">([\s\S]*?)<\/i>/)?.[1] ?? '')

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: author ? `${title}（${author}）` : title,
        dateRaw: uisdcAbsoluteDate(dateRaw, fetchedAt),
        image,
      },
      fetchedAt,
    )
    if (article) {
      seen.add(link)
      articles.push(article)
    }
  }

  return articles
}

function wpFeaturedImage(post: Unknown): string | undefined {
  const media = toArray(asRecord(post._embedded)?.['wp:featuredmedia'])
    .map(asRecord)
    .filter(Boolean) as Unknown[]
  for (const item of media) {
    const src = text(item.source_url)
    if (src) return src
  }
  return undefined
}

/**
 * WordPress REST API（/wp-json/wp/v2/posts?_embed=1）。
 * 适用于关掉 /feed 但保留 REST 的 WP 站（新智元等）。
 */
function parseWordpressRest(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const articles: Article[] = []
  for (const entry of data) {
    const post = asRecord(entry)
    if (!post) continue

    const title = text(asRecord(post.title)?.rendered)
    const link = text(post.link)
    if (!title || !link) continue

    const html = text(asRecord(post.content)?.rendered)
    const excerpt = stripTags(text(asRecord(post.excerpt)?.rendered))
    // date 无时区，date_gmt 才能稳定还原时刻
    const gmt = text(post.date_gmt)
    const article = buildArticle(
      source,
      {
        title,
        link,
        html,
        summaryText: excerpt || stripTags(html),
        dateRaw: gmt ? `${gmt}Z` : text(post.date),
        image: wpFeaturedImage(post) ?? firstImageIn(html),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/** 果壳列表用「今天 17:15 / 昨天 20:15」相对日期，先归一成绝对时刻 */
function absoluteCnDate(raw: string, fetchedAt: number): string {
  const relative = raw.match(/^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})$/)
  if (!relative) return raw

  const offsetDays = relative[1] === '今天' ? 0 : relative[1] === '昨天' ? 1 : 2
  const date = new Date(fetchedAt)
  date.setDate(date.getDate() - offsetDays)
  date.setHours(Number(relative[2]), Number(relative[3]), 0, 0)
  return date.toISOString()
}

/**
 * 果壳「科学人」列表页（无官方 RSS，旧 miniserver JSON API 已下线）。
 * 每条包在 <div class="article"> 里，标题 / 时间 / 配图都在固定 class 上。
 */
function parseGuokrList(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const articles: Article[] = []

  for (const block of payload.split('<div class="article">').slice(1)) {
    const titleMatch = block.match(
      /<a[^>]*class="article-title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    )
    if (!titleMatch) continue

    const title = stripTags(titleMatch[2])
    // 站内链接仍是 http，升 https 避免 WebView 混合内容被拦
    const link = titleMatch[1].replace(/^http:\/\//, 'https://')
    if (!title || !link) continue

    const dateRaw = block.match(/<span class="split">\|<\/span>\s*([^<]+)/)?.[1]?.trim() ?? ''
    const summary = stripTags(
      block.match(/<p class="article-summary">([\s\S]*?)<\/p>/)?.[1] ?? '',
    )
    const image = block.match(/<img[^>]+src="(https?:\/\/[^"]+)"/)?.[1]

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: summary || title,
        dateRaw: absoluteCnDate(dateRaw, fetchedAt),
        image: image ? preferHttpsAsset(image) : undefined,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 甲子光年首页（无 RSS，/feed 与 /rss.xml 都 302 到 404 页）。
 * 卡片有两种排版：「最新文章」用 .title，头图位用 .article-title > p；
 * 部分卡片带 class="time">YYYY-MM-DD；缺日期的由 enrichJazzyearDates 用详情页补全。
 */
function parseJazzyear(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const found = new Map<string, { title: string; image?: string; dateRaw: string }>()

  for (const match of payload.matchAll(
    /article_info\.html\?id=(\d+)"([\s\S]{0,1500}?)<\/a>/g,
  )) {
    const id = match[1]
    const block = match[2]
    if (found.has(id)) continue

    const title =
      stripTags(block.match(/class="title[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '') ||
      stripTags(block.match(/class="article-title"[^>]*>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? '')
    if (!title) continue

    const image = block
      .match(/background-image:\s*url\(([^)]+)\)/)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '')

    const dateRaw =
      block.match(/class="[^"]*time[^"]*"[^>]*>\s*(20\d{2}-\d{2}-\d{2})/)?.[1] ??
      block.match(/(20\d{2}-\d{2}-\d{2})/)?.[1] ??
      ''

    found.set(id, { title, image: image || undefined, dateRaw })
  }

  const articles: Article[] = []
  for (const [id, meta] of found) {
    const article = buildArticle(
      source,
      {
        title: meta.title,
        link: `https://www.jazzyear.com/article_info.html?id=${id}`,
        html: '',
        summaryText: meta.title,
        dateRaw: meta.dateRaw,
        image: meta.image,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

function escapePlainAsHtml(textValue: string): string {
  return textValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function flashHtml(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.includes('<')) return trimmed
  return `<p>${escapePlainAsHtml(trimmed)}</p>`
}

function titleFromFlash(brief: string, content: string): string {
  const fromBrief = stripTags(brief)
  if (fromBrief) return fromBrief.slice(0, 120)
  const plain = stripTags(content)
  const bracket = plain.match(/^【([^】]+)】/)
  if (bracket?.[1]) return bracket[1].slice(0, 120)
  return plain.slice(0, 80) || '快讯'
}

/** 财联社电报：列表 JSON 自带正文 */
function parseClsTelegraph(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  const roll = toArray(asRecord(data.data)?.roll_data).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of roll) {
    const id = text(item.id)
    const content = text(item.content) || text(item.brief)
    if (!id || !content) continue
    const title = titleFromFlash(text(item.brief), content)
    const ctime = Number(item.ctime)
    const dateRaw =
      Number.isFinite(ctime) && ctime > 0 ? new Date(ctime * 1000).toISOString() : ''
    const article = buildArticle(
      source,
      {
        title,
        link: `https://www.cls.cn/telegraph/${id}`,
        html: flashHtml(content),
        summaryText: stripTags(content),
        dateRaw,
        neteaseDocId: id,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 东方财富 7×24：JSONP `var ajaxResult=...` */
function parseEastmoneyKx(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const match = payload.match(/var\s+ajaxResult\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)
  if (!match?.[1]) return []
  let data: Unknown
  try {
    data = JSON.parse(match[1]) as Unknown
  } catch {
    return []
  }
  const list = toArray(data.LivesList).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of list) {
    const newsid = text(item.newsid)
    const title = text(item.title)
    const digest = text(item.digest) || title
    if (!newsid || !title) continue
    const article = buildArticle(
      source,
      {
        title,
        link: `https://finance.eastmoney.com/a/${newsid}.html`,
        html: flashHtml(digest),
        summaryText: stripTags(digest),
        dateRaw: text(item.showtime),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 东方财富专栏新闻列表（摘要；正文走 Readability） */
function parseEastmoneyNews(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  if (text(data.code) !== '1' && Number(data.code) !== 1) return []
  const list = toArray(asRecord(data.data)?.list).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of list) {
    const title = text(item.title)
    const link = text(item.url) || text(item.articleUrl) || text(item.code_url)
    if (!title || !link) continue
    const summary = text(item.summary) || text(item.digest)
    const article = buildArticle(
      source,
      {
        title,
        link: preferHttpsAsset(link) ?? link,
        html: '',
        summaryText: summary,
        dateRaw: text(item.showTime) || text(item.publishTime) || text(item.showtime),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 华尔街见闻快讯：lives JSON */
function parseWscnLive(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  const items = toArray(asRecord(data.data)?.items).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of items) {
    const id = text(item.id)
    const contentText = text(item.content_text) || stripTags(text(item.content))
    const htmlRaw = text(item.content) || contentText
    if (!id || !contentText) continue
    const title = titleFromFlash(text(item.title), contentText)
    const ts = Number(item.display_time) || Number(item.created_at)
    const dateRaw = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : ''
    const link = text(item.uri) || `https://wallstreetcn.com/livenews/${id}`
    const article = buildArticle(
      source,
      {
        title,
        link,
        html: flashHtml(htmlRaw),
        summaryText: contentText,
        dateRaw,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

const PG_SKIP_HREFS = new Set([
  'index.html',
  'articles.html',
  'rss.html',
  'rss.xml',
  'books.html',
  'sep.html',
  'bio.html',
  'twitter.html',
  'faq.html',
  'quo.html',
  'talks.html',
  'admin.html',
  'bel.html',
  'item',
])

/**
 * Paul Graham Essays (paulgraham.com/articles.html 无官方 RSS)。
 * 列表页只有标题链接、没有日期；递减 publishedAt 仅用于源内顺序，不得标成真实发稿时间。
 * 真实月份在随笔页标题下（如 June 2026），由 enrichPaulGrahamDates 补全。
 */
function parsePaulGraham(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const seenHrefs = new Set<string>()
  const regex = /<a\s+[^>]*href=["']([^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  const items: Array<{ href: string; title: string }> = []
  while ((match = regex.exec(payload)) !== null) {
    const rawHref = match[1]?.trim() ?? ''
    const cleanHref = rawHref.replace(/^https?:\/\/(?:www\.)?paulgraham\.com\//i, '').replace(/^\.?\//, '')
    if (!cleanHref || PG_SKIP_HREFS.has(cleanHref.toLowerCase()) || cleanHref.includes('/') || seenHrefs.has(cleanHref)) {
      continue
    }

    const title = stripTags(match[2]).trim()
    if (!title || title.length < 2) continue

    seenHrefs.add(cleanHref)
    items.push({ href: cleanHref, title })
  }

  const articles: Article[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const link = `https://www.paulgraham.com/${item.href}`
    const article = buildArticle(
      source,
      {
        title: item.title,
        link,
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

function parseWebCatalog(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  return catalogHtmlToArticles(source, payload, fetchedAt)
}

type SourceParser = (source: NewsSource, payload: string, fetchedAt: number) => Article[]

/**
 * kind → 解析器。
 * 用 Record 而非条件分派：新增 SourceKind 时缺失解析器会在编译期报错。
 */
const PARSERS: Record<SourceKind, SourceParser> = {
  feed: parseGenericFeed,
  'google-news': parseXmlFeed,
  netease: parseNetease,
  zhihu: parseZhihuDaily,
  arena: parseArenaBlog,
  anthropic: parseAnthropicNews,
  jandan: parseJandan,
  jiqizhixin: parseJiqizhixin,
  latepost: parseLatepost,
  wordpress: parseWordpressRest,
  guokr: parseGuokrList,
  jazzyear: parseJazzyear,
  cls: parseClsTelegraph,
  'eastmoney-kx': parseEastmoneyKx,
  'eastmoney-news': parseEastmoneyNews,
  'wscn-live': parseWscnLive,
  paulgraham: parsePaulGraham,
  wechat: parseWechatSource,
  uisdc: parseUisdcTag,
  'web-catalog': parseWebCatalog,
}

export function parseSourcePayload(source: NewsSource, payload: string): Article[] {
  const fetchedAt = Date.now()
  const articles = (PARSERS[source.kind] ?? parseXmlFeed)(source, payload, fetchedAt)

  // 上游偶尔重复推送同一条，按 id 去重
  const seen = new Set<string>()
  return articles.filter((article) => {
    if (seen.has(article.id)) return false
    seen.add(article.id)
    return true
  })
}
