import { isVideoDocumentUrl } from '../../lib/videoDocumentUrl'
import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import { isPersonDocumentUrl } from '../catalogEngine/itemSemantics'

export const CATALOG_LIST_VERSION = 'catalog-v4'
export function catalogCacheVersion(source?: NewsSource): string | undefined {
  return source?.kind === 'web-catalog' ? `${CATALOG_LIST_VERSION}:${source.cacheVersion ?? ''}` : source?.cacheVersion
}

/** Correct legacy all-video metadata locally; preserve offline items, IDs and body/read caches. */
export function migrateCatalogCache(_source: NewsSource, items: Article[]): Article[] {
  return items.map((article) => {
    let videoRoute = false
    let articleRoute = false
    try {
      const path = new URL(article.originUrl).pathname
      videoRoute = isVideoDocumentUrl(article.originUrl)
      articleRoute = /\/(?:art\/(?:detail|read)|articles?|posts?|news)\//i.test(path)
    } catch { /* Preserve readable metadata. */ }
    const contentType = articleRoute || isPersonDocumentUrl(article.originUrl) ? 'article' : videoRoute || article.videoUrl ? 'video' : article.contentType ?? 'article'
    return { ...article, contentType }
  })
}
