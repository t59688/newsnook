import { fetchAbsoluteText } from './http'
import {
  enrichJazzyearDates,
  enrichLatepostDates,
  enrichPaulGrahamDates,
  parseSourcePayload,
} from './parseFeed'
import type { Article } from './types'
import type { NewsSource } from '../sources/registry'

/**
 * Parse one source payload using the same normalization rules as the feed hook.
 * Detail-date enrichment is awaited here because callers such as offline prestore
 * need a stable newest-to-oldest window before deciding which bodies to retain.
 */
export async function parseSourceArticles(
  source: NewsSource,
  payload: string,
  signal?: AbortSignal,
): Promise<Article[]> {
  const articles = parseSourcePayload(source, payload)
  if (!articles.length) return articles
  if (source.kind === 'latepost') {
    return enrichLatepostDates(
      articles,
      (url, fetchSignal) => fetchAbsoluteText(url, { signal: fetchSignal }),
      signal,
    )
  }
  if (source.kind === 'jazzyear') {
    return enrichJazzyearDates(
      articles,
      (url, fetchSignal) => fetchAbsoluteText(url, { signal: fetchSignal }),
      signal,
    )
  }
  if (source.kind === 'paulgraham') {
    return enrichPaulGrahamDates(
      articles,
      (url, fetchSignal) => fetchAbsoluteText(url, { signal: fetchSignal }),
      signal,
    )
  }
  if (source.frameworkHint?.categories?.length) {
    const categoryUrls = new Set(source.frameworkHint.categories.map((category) => category.url))
    return articles.filter((article) => !categoryUrls.has(article.originUrl))
  }
  return articles
}
