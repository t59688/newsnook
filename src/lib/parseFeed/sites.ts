/**
 * 站点定制列表解析器（JSON API / 归档 HTML）：
 * 煎蛋、机器之心、晚点、优设、WordPress REST、果壳、甲子光年、Paul Graham。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { isBogusLatepostListDate } from './dateEnrichment'
import {
  asRecord,
  buildArticle,
  firstImageIn,
  preferHttpsAsset,
  stripTags,
  text,
  toArray,
  type Unknown,
} from './shared'

/**
 * 煎蛋 i.jandan.net JSON API（get_category_posts / get_tag_posts / get_recent_posts）。
 * 列表已含全文 HTML，详情可直接复用 contentHtml。
 */
export function parseJandan(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseJiqizhixin(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseLatepost(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseUisdcTag(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseWordpressRest(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseGuokrList(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parseJazzyear(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
export function parsePaulGraham(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
