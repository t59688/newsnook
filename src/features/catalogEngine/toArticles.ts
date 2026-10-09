import { md5Hex } from '../../lib/hash'
import { cleanSummaryText } from '../../lib/cleanSummary'
import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import { extractCatalog } from './engine'

function hashId(input: string): string {
  return md5Hex(input).slice(0, 12)
}

/** 详情页相关卡片点击：与列表条目使用同一套 id，已读状态可复用。 */
export function articleFromRelatedLink(
  from: Article,
  originUrl: string,
  title: string,
  image?: string,
): Article {
  const trimmed = title.trim() || originUrl
  return {
    id: `${from.sourceId}:${hashId(originUrl)}`,
    title: trimmed,
    summary: trimmed.slice(0, 220),
    image,
    publishedAt: Date.now(),
    hasRealDate: false,
    sourceId: from.sourceId,
    sourceName: from.sourceName,
    sourceLabel: from.sourceLabel,
    sourceGroup: from.sourceGroup,
    originUrl,
    contentType: from.contentType,
  }
}

/** CatalogItem[] → App 信息流 Article[] */
export function catalogHtmlToArticles(
  source: NewsSource,
  html: string,
  fetchedAt: number,
): Article[] {
  const catalog = extractCatalog(html, source.url)
  const articles: Article[] = []

  for (const item of catalog.items) {
    const title = item.title.trim()
    if (!title) continue

    const summary =
      cleanSummaryText(item.summary ?? title, title).slice(0, 220) || title.slice(0, 220)
    const publishedAt = item.publishedAt && item.publishedAt > 0 ? item.publishedAt : fetchedAt

    articles.push({
      id: `${source.id}:${hashId(item.originUrl || item.id)}`,
      title,
      summary,
      image: item.image,
      publishedAt,
      hasRealDate: Boolean(item.publishedAt && item.publishedAt > 0),
      sourceId: source.id,
      sourceName: source.name,
      sourceLabel: source.label,
      sourceGroup: source.group,
      originUrl: item.originUrl,
      contentType: 'video',
    })
  }

  return articles
}
