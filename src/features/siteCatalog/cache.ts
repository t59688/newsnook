import { isVideoDocumentUrl } from '../../lib/videoDocumentUrl'
import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import { catalogProfileFor } from './profile'

export const CATALOG_LIST_VERSION = 'catalog-v3'
export function catalogCacheVersion(source?: NewsSource): string | undefined {
  return source?.kind === 'web-catalog' ? `${CATALOG_LIST_VERSION}:${source.cacheVersion ?? ''}` : source?.cacheVersion
}

/** Correct legacy all-video metadata locally; preserve offline items, IDs and body/read caches. */
export function migrateCatalogCache(source: NewsSource, items: Article[]): Article[] {
  const videoEngine = /^(maccms|seacms|fyfcms|zanpian|nnyy)$/.test(catalogProfileFor(source).engine)
  return items.map((article) => {
    let videoRoute = false
    let articleRoute = false
    try {
      const path = new URL(article.originUrl).pathname
      videoRoute = isVideoDocumentUrl(article.originUrl)
      articleRoute = /\/(?:art\/(?:detail|read)|articles?|posts?|news)\//i.test(path)
    } catch { /* Preserve readable metadata. */ }
    const contentType = articleRoute ? 'article' : videoRoute || article.videoUrl ? 'video' : article.contentType === 'article' ? 'article' : videoEngine ? 'video' : 'article'
    return { ...article, contentType }
  })
}
