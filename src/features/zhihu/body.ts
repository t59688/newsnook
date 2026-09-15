import { sanitizeArticleHtml } from '../../lib/sanitize'
import type { Article } from '../../lib/types'
import { fetchZhihuContentDetail } from './service'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Normalize Zhihu lazy assets while keeping normal img/video tags for NewsNook media components. */
export function normalizeZhihuContentHtml(raw: string): string {
  if (!raw.trim()) return ''
  const container = document.createElement('div')
  container.innerHTML = raw

  container.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const lazy = image.getAttribute('data-original') || image.getAttribute('data-actualsrc') || image.getAttribute('data-src')
    if (lazy && /^https?:\/\//i.test(lazy)) image.src = lazy
    image.removeAttribute('srcset')
    image.loading = 'lazy'
    image.decoding = 'async'
    image.referrerPolicy = 'no-referrer'
  })

  container.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
    video.controls = true
    video.setAttribute('playsinline', '')
    video.preload = 'metadata'
  })

  container.querySelectorAll<HTMLIFrameElement>('iframe').forEach((frame) => {
    frame.loading = 'lazy'
    frame.referrerPolicy = 'no-referrer'
  })

  return sanitizeArticleHtml(container.innerHTML)
}

export interface ZhihuResolvedBody {
  contentHtml: string
  title?: string
  image?: string
}

export async function resolveZhihuMainArticleBody(
  article: Article,
  signal?: AbortSignal,
): Promise<ZhihuResolvedBody | null> {
  if (article.externalRef?.provider !== 'zhihu-main') return null
  const detail = await fetchZhihuContentDetail(article, signal)
  const type = article.externalRef.type

  if (type === 'question') {
    const description = record(detail.detail)?.content ?? detail.detail ?? detail.description
    const html = normalizeZhihuContentHtml(text(description))
    if (!html) return null
    return { contentHtml: html, title: text(detail.title) || article.title }
  }

  const html = normalizeZhihuContentHtml(text(detail.content))
  if (!html) return null
  const question = record(detail.question)
  const title = type === 'answer'
    ? text(question?.title) || article.title
    : text(detail.title) || article.title
  const image = text(detail.image_url ?? detail.imageUrl ?? detail.title_image) || article.image
  return { contentHtml: html, title, image }
}
