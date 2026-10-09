import { feedArticleId } from '../../../lib/articleId'
import type { Article } from '../../../lib/types'
import type { ZhihuContentDetail } from '../api/decode'
import { normalizeZhihuContentHtml } from './normalize'

export const ZHIHU_COMMUNITY_SOURCE_ID = 'zhihu-community'

export function toNewsArticle(content: ZhihuContentDetail): Article | null {
  if (!['answer', 'article', 'pin'].includes(content.ref.kind)) return null
  const publishedAt = content.createdAt ? content.createdAt * 1000 : Date.now()
  return {
    id: feedArticleId(ZHIHU_COMMUNITY_SOURCE_ID, content.url),
    title: content.title,
    summary: content.excerpt,
    contentHtml: normalizeZhihuContentHtml(content.contentHtml),
    publishedAt,
    hasRealDate: Boolean(content.createdAt),
    sourceId: ZHIHU_COMMUNITY_SOURCE_ID,
    sourceName: '知乎',
    sourceLabel: '知乎',
    sourceGroup: 'special',
    originUrl: content.url,
  }
}
