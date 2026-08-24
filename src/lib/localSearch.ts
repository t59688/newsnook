/**
 * 本地离线搜索：只在本机已有的数据里找，零网络、零后端。
 *
 * 语料来自当前列表缓存、稍后读与最近阅读（正文缓存里的元数据），
 * 与「站内搜索」（web-catalog 源的 searchTemplate，需要联网请求站点）是两件事。
 *
 * 中文没有词边界，这里不做分词：按空格切成若干片段，每个片段都要在
 * 标题 / 摘要 / 信源名里命中（AND），子串匹配对中英文都成立。
 */

import { LIST_CACHE_PREFIX, listKeys, loadCachedList } from './storage'
import type { Article } from './types'

export type LocalSearchOrigin = 'feed' | 'later' | 'history'

export const LOCAL_SEARCH_ORIGIN_LABELS: Record<LocalSearchOrigin, string> = {
  feed: '列表缓存',
  later: '稍后读',
  history: '最近阅读',
}

export interface LocalSearchEntry {
  article: Article
  origin: LocalSearchOrigin
}

export interface LocalSearchResult extends LocalSearchEntry {
  score: number
  /** 命中位置，用于结果里给出「标题命中 / 摘要命中」这类提示 */
  matchedTitle: boolean
  matchedSummary: boolean
  matchedSource: boolean
}

export interface LocalSearchOptions {
  limit?: number
  /** 只看某几个来源分区 */
  origins?: LocalSearchOrigin[]
}

/** 结果上限：手机上再多也翻不完，且能压住大语料下的排序开销 */
export const LOCAL_SEARCH_LIMIT = 80

/** 短于这个长度不检索，避免单字符把整个语料倒出来 */
export const LOCAL_SEARCH_MIN_LENGTH = 1

/** 稍后读 / 最近阅读优先于泛列表：同名文章更可能是用户主动存过的那条 */
const ORIGIN_PRIORITY: Record<LocalSearchOrigin, number> = {
  later: 3,
  history: 2,
  feed: 1,
}

/**
 * 读出本机所有信源的列表缓存，不限于当前预设与分类。
 * 过期条目由 loadCachedList 自行淘汰，这里只负责摊平。
 */
export function loadCachedListArticles(): Article[] {
  const articles: Article[] = []
  listKeys(LIST_CACHE_PREFIX).forEach((key) => {
    const cached = loadCachedList(key.slice(LIST_CACHE_PREFIX.length))
    if (cached) articles.push(...cached.items)
  })
  return articles
}

/**
 * 合并多个本地来源，按文章 id 去重。
 * 同一篇出现在多处时保留优先级更高的来源标记。
 */
export function buildLocalSearchCorpus(groups: {
  feed?: Article[]
  later?: Article[]
  history?: Article[]
}): LocalSearchEntry[] {
  const byId = new Map<string, LocalSearchEntry>()

  const absorb = (articles: Article[] | undefined, origin: LocalSearchOrigin) => {
    articles?.forEach((article) => {
      if (!article?.id) return
      const existing = byId.get(article.id)
      if (existing && ORIGIN_PRIORITY[existing.origin] >= ORIGIN_PRIORITY[origin]) return
      byId.set(article.id, { article, origin })
    })
  }

  absorb(groups.feed, 'feed')
  absorb(groups.history, 'history')
  absorb(groups.later, 'later')

  return [...byId.values()]
}

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

function tokenize(query: string): string[] {
  const normalized = normalizeSearchQuery(query)
  if (normalized.length < LOCAL_SEARCH_MIN_LENGTH) return []
  return normalized.split(' ').filter(Boolean)
}

/** 越靠前命中越像用户要找的东西 */
function positionBonus(index: number): number {
  if (index < 0) return 0
  return index === 0 ? 6 : index < 12 ? 4 : 2
}

export function searchLocalArticles(
  corpus: LocalSearchEntry[],
  query: string,
  options?: LocalSearchOptions,
): LocalSearchResult[] {
  const tokens = tokenize(query)
  if (!tokens.length) return []

  const limit = options?.limit ?? LOCAL_SEARCH_LIMIT
  const originFilter = options?.origins?.length ? new Set(options.origins) : null
  const results: LocalSearchResult[] = []

  for (const entry of corpus) {
    if (originFilter && !originFilter.has(entry.origin)) continue

    const { article } = entry
    const title = article.title?.toLowerCase() ?? ''
    const summary = article.summary?.toLowerCase() ?? ''
    const sourceName = `${article.sourceName ?? ''} ${article.sourceLabel ?? ''}`.toLowerCase()

    let score = 0
    let matchedTitle = false
    let matchedSummary = false
    let matchedSource = false
    let allMatched = true

    for (const token of tokens) {
      const titleIndex = title.indexOf(token)
      const summaryIndex = summary.indexOf(token)
      const sourceIndex = sourceName.indexOf(token)

      if (titleIndex < 0 && summaryIndex < 0 && sourceIndex < 0) {
        allMatched = false
        break
      }

      if (titleIndex >= 0) {
        matchedTitle = true
        score += 20 + positionBonus(titleIndex)
      }
      if (summaryIndex >= 0) {
        matchedSummary = true
        score += 6 + positionBonus(summaryIndex) / 2
      }
      if (sourceIndex >= 0) {
        matchedSource = true
        score += 4
      }
    }

    if (!allMatched) continue

    // 整串连续命中标题，通常就是用户心里那一篇
    if (tokens.length > 1 && title.includes(normalizeSearchQuery(query))) score += 12
    score += ORIGIN_PRIORITY[entry.origin]

    results.push({ ...entry, score, matchedTitle, matchedSummary, matchedSource })
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return (b.article.publishedAt ?? 0) - (a.article.publishedAt ?? 0)
  })

  return results.slice(0, limit)
}
