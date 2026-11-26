/**
 * 只在缩略图直连、代理/原生重试均失败后，按需寻找正文替代图。
 * 不改动刷新主路径；限制并发、响应体大小及单篇重试频率。
 */
import { parseHTML } from 'linkedom'

import { firstImageIn, previewImageUrl } from './articlePreview'
import { loadCachedBody } from './bodyCache'
import { fetchAbsoluteText } from './http'
import type { Article } from './types'

const MAX_CONCURRENT = 2
const MAX_PENDING = 24
const MAX_ENTRIES = 128
const CACHE_MS = 5 * 60 * 1000
const MAX_PAGE_BYTES = 2_000_000

const cache = new Map<string, { until: number; result: Promise<string | undefined> }>()
const waiting: Array<() => void> = []
let active = 0

function limited<T>(task: () => Promise<T>): Promise<T | undefined> {
  if (active >= MAX_CONCURRENT && waiting.length >= MAX_PENDING) return Promise.resolve(undefined)
  return new Promise<T | undefined>((resolve) => {
    const run = () => {
      active += 1
      void task().then(resolve, () => resolve(undefined)).finally(() => {
        active -= 1
        waiting.shift()?.()
      })
    }
    if (active < MAX_CONCURRENT) run()
    else waiting.push(run)
  })
}

function alternative(value: unknown, pageUrl: string, brokenUrl: string): string | undefined {
  const image = previewImageUrl(value, pageUrl)
  return image && image !== brokenUrl ? image : undefined
}

function fromArticlePage(html: string, url: string, brokenUrl: string): string | undefined {
  const { document } = parseHTML(html)
  for (const meta of Array.from(document.querySelectorAll(
    'meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[itemprop="image"]',
  ))) {
    const image = alternative(meta.getAttribute('content'), url, brokenUrl)
    if (image) return image
  }
  const content = document.querySelector('article, main, .article-content, .article-body, .post-content')
  return firstImageIn(content?.innerHTML || html, url, brokenUrl)
}

async function findAlternative(article: Article, brokenUrl: string): Promise<string | undefined> {
  const url = article.originUrl
  try {
    const cached = loadCachedBody(article.id)
    const fromCache = cached && (
      alternative(cached.article?.image, url, brokenUrl)
      ?? firstImageIn(cached.html, url, brokenUrl)
    )
    if (fromCache) return fromCache
  } catch {
    // 无本地正文缓存时继续，不能让缓存不可用阻断封面恢复。
  }

  const inFeed = firstImageIn(article.contentHtml || '', url, brokenUrl)
  if (inFeed) return inFeed

  if (article.sourceId === 'jiqizhixin') {
    const id = article.neteaseDocId || url.match(/\/articles\/([^/?#]+)/)?.[1]
    if (id && /^[\w-]{1,128}$/.test(id)) {
      try {
        const json = await fetchAbsoluteText(
          `https://www.jiqizhixin.com/api/article_library/articles/${encodeURIComponent(id)}.json`,
          { accept: 'application/json', maxBytes: MAX_PAGE_BYTES },
        )
        const data = JSON.parse(json) as Record<string, unknown>
        const body = typeof data.content === 'string' ? data.content : ''
        const image = firstImageIn(body, url, brokenUrl)
          ?? alternative(data.coverImageUrl, url, brokenUrl)
          ?? alternative(data.cover_image_url, url, brokenUrl)
        if (image) return image
      } catch {
        // 详情接口失败则尝试公开文章页，不将错误暴露给主信息流。
      }
    }
  }

  try {
    const page = new URL(url)
    if (!['https:', 'http:'].includes(page.protocol)) return undefined
    const html = await fetchAbsoluteText(page.href, {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      maxBytes: MAX_PAGE_BYTES,
    })
    return fromArticlePage(html, url, brokenUrl)
  } catch {
    return undefined
  }
}

/** 只有图片最终报错时才调用；同篇并发共享结果，失败也短时缓存以免刷接口。 */
export function recoverArticleCover(article: Article, brokenUrl: string): Promise<string | undefined> {
  const key = `${article.id}:${brokenUrl}`
  const now = Date.now()
  const existing = cache.get(key)
  if (existing && existing.until > now) return existing.result
  if (existing) cache.delete(key)

  const result = limited(() => findAlternative(article, brokenUrl))
  cache.set(key, { until: now + CACHE_MS, result })
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  return result
}
