/**
 * 站点专用正文接口：虎嗅视频详情、网易 full.html、知乎日报、机器之心。
 * 均在通用网页抽取（Readability）之前尝试。
 */

import {
  buildMediaDescriptor,
  bestMediaUrlInPayload,
  bestPosterUrlInPayload,
  mediaFormatFor,
  observeMediaInPayload,
} from '../../features/mediaSniffer/core'
import { fetchAbsoluteFormPost, fetchAbsoluteText } from '../http'
import { sanitizeArticleHtml } from '../sanitize'
import type { Article } from '../types'
import {
  absolutizeHtml,
  escapeHtml,
  httpUrl,
  objectRecord,
  stripTags,
  type ResolvedBody,
} from './shared'
import { buildVideoBody } from './video'

const HUXIU_ARTICLE_DETAIL_API =
  'https://api-web-article.huxiu.com/web/article/detail'

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

export async function resolveHuxiuVideoBody(
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

export async function resolveNetEaseArticleBody(
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

export async function resolveZhihuBody(
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

export async function resolveJiqizhixinBody(
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
