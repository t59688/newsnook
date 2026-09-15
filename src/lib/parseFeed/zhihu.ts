/**
 * 知乎 JSON 解析：旧日报与主站协议分离，避免评论/分页/正文互相串台。
 */

import { normalizeZhihuListJson } from '../../features/zhihu/normalize'
import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { asRecord, buildArticle, stripTags, text, toArray, type Unknown } from './shared'

export function parseZhihuMain(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  return normalizeZhihuListJson(source, payload, fetchedAt).articles
}

export function parseZhihuDaily(source: NewsSource, payload: string, fetchedAt: number): Article[] {
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
