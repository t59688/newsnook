/**
 * 站点专用正文接口：虎嗅视频详情、网易 full.html、知乎、机器之心。
 * 均在通用网页抽取（Readability）之前尝试。
 */

import {
  buildMediaDescriptor,
  bestMediaUrlInPayload,
  bestPosterUrlInPayload,
  mediaFormatFor,
  observeMediaInPayload,
} from '../../features/mediaSniffer/core'
import { resolveZhihuMainArticleBody } from '../../features/zhihu/body'
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
  if (article.sourceId === 'zhihu-main' || article.externalRef?.provider === 'zhihu-main') {
    const resolved = await resolveZhihuMainArticleBody(article, signal)
    return resolved
      ? {
          contentHtml: resolved.contentHtml,
          image: resolved.image,
          title: resolved.title,
          bodySource: 'feed',
        }
      : null
  }

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