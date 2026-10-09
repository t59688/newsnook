import { detectNextPageUrl } from '../catalogEngine/pagination'
import {
  mergeOlderPage,
  placeUndatedPageAfterExisting,
  sortArticles,
} from '../../lib/feedPagination'
import { describeNonFeedPayload } from '../../lib/feedPayload'
import { fetchSourceText } from '../../lib/http'
import {
  neteasePageEntryCount,
  parseThePaperCursor,
  thePaperCursor,
  thePaperCursorAdvances,
  thePaperPageRequest,
  zhihuEditionDate,
} from '../../lib/parseFeed'
import { parseSourceArticles } from '../../lib/sourceArticles'
import type { Article } from '../../lib/types'
import {
  maxOffsetPages,
  pagingStrategyOf,
  zhihuBeforeUrl,
  type NewsSource,
} from '../../sources/registry'

const MAX_CURSOR_PAGES = 24
const MAX_CANDIDATES = 160

function requireArticles(payload: string, articles: Article[]): Article[] {
  if (articles.length) return articles
  throw new Error(describeNonFeedPayload(payload) || '返回内容为空')
}

async function fetchOffsetWindow(
  source: NewsSource,
  desired: number,
  signal: AbortSignal,
): Promise<Article[]> {
  const headPayload = await fetchSourceText(source, signal)
  let collected = sortArticles(
    requireArticles(headPayload, await parseSourceArticles(source, headPayload, signal)),
  )
  const maxPages = Math.max(1, maxOffsetPages(source))

  if (source.frameworkHint?.paginationPattern.kind === 'next-link') {
    let currentUrl = source.url
    let nextUrl = detectNextPageUrl(headPayload, currentUrl)
    let page = 1
    while (collected.length < desired && nextUrl && page < maxPages) {
      const payload = await fetchSourceText(source, signal, { url: nextUrl })
      const parsed = await parseSourceArticles(source, payload, signal)
      const historical = placeUndatedPageAfterExisting(collected, parsed)
      collected = mergeOlderPage(collected, historical).merged
      currentUrl = nextUrl
      nextUrl = detectNextPageUrl(payload, currentUrl)
      page += 1
      if (!parsed.length) break
    }
    return collected.slice(0, desired)
  }

  for (let page = 1; page < maxPages && collected.length < desired; page += 1) {
    const payload = await fetchSourceText(source, signal, { page })
    const parsed = await parseSourceArticles(source, payload, signal)
    const rawCount = source.kind === 'netease' ? neteasePageEntryCount(payload) : parsed.length
    if (rawCount === 0) break
    const historical = placeUndatedPageAfterExisting(collected, parsed)
    collected = mergeOlderPage(collected, historical).merged
  }
  return collected.slice(0, desired)
}

async function fetchCursorWindow(
  source: NewsSource,
  desired: number,
  signal: AbortSignal,
): Promise<Article[]> {
  const headPayload = await fetchSourceText(source, signal)
  let collected = sortArticles(
    requireArticles(headPayload, await parseSourceArticles(source, headPayload, signal)),
  )
  let cursor = source.kind === 'thepaper' ? thePaperCursor(headPayload) : zhihuEditionDate(headPayload)
  if (!cursor) {
    throw new Error(source.kind === 'thepaper' ? '澎湃未返回有效分页游标' : '知乎日报未返回有效日期游标')
  }

  for (let page = 1; page < MAX_CURSOR_PAGES && collected.length < desired; page += 1) {
    let payload: string
    let nextCursor: string | undefined
    if (source.kind === 'thepaper') {
      const cursorInfo = parseThePaperCursor(cursor)
      if (!cursorInfo?.hasNext) break
      const requestJson = thePaperPageRequest(source, cursor, page)
      if (!requestJson) break
      payload = await fetchSourceText(source, signal, { requestJson })
      nextCursor = thePaperCursor(payload)
      if (!nextCursor || !thePaperCursorAdvances(cursor, nextCursor)) {
        throw new Error('澎湃返回了未前进的历史分页游标')
      }
    } else {
      payload = await fetchSourceText(source, signal, { url: zhihuBeforeUrl(cursor) })
      nextCursor = zhihuEditionDate(payload)
      if (!nextCursor || nextCursor >= cursor) {
        throw new Error('知乎日报返回了无效的历史日期游标')
      }
    }

    const parsed = await parseSourceArticles(source, payload, signal)
    cursor = nextCursor
    if (!parsed.length) break
    const historical = source.kind === 'thepaper' ? placeUndatedPageAfterExisting(collected, parsed) : parsed
    collected = mergeOlderPage(collected, historical).merged
  }
  return collected.slice(0, desired)
}

/**
 * 为单个信源抓取足够的最新候选文章。跨信源串行由 service 保证；
 * RSS/一次性目录只能返回上游当前暴露的数量，旧预存正文由滚动窗口负责补足。
 */
export async function fetchSourcePrestoreCandidates(
  source: NewsSource,
  desired: number,
  signal: AbortSignal,
): Promise<Article[]> {
  const safeDesired = Math.max(1, Math.min(MAX_CANDIDATES, Math.floor(desired)))
  const strategy = pagingStrategyOf(source)

  if (strategy === 'upstream-offset') {
    return fetchOffsetWindow(source, safeDesired, signal)
  }
  if (strategy === 'upstream-cursor') {
    return fetchCursorWindow(source, safeDesired, signal)
  }

  const payload = await fetchSourceText(source, signal)
  const catalog = requireArticles(payload, await parseSourceArticles(source, payload, signal))
  return sortArticles(catalog).slice(0, safeDesired)
}
