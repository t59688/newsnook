/**
 * 知乎日报 JSON 解析：整页共用 edition date，按编辑顺序递减保持稳定排序。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { asRecord, buildArticle, stripTags, text, toArray, type Unknown } from './shared'

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
