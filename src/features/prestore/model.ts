import type { Article } from '../../lib/types'
import type { CategoryId } from '../../sources/categories'
import {
  FOLLOWS_ENABLED_SOURCES,
  categorySourceIds,
  visibleCategories,
  type Preferences,
} from '../../sources/preferences'
import { findSource, type NewsSource } from '../../sources/registry'

export interface PrestoreSourceTarget {
  categoryId: CategoryId
  categoryLabel: string
  source: NewsSource
}

export interface PrestorePlan {
  presetId: string
  key: string
  sources: PrestoreSourceTarget[]
}

/**
 * 未跑完一轮时写进清单的断点游标：记录本轮已处理过的信源，
 * 供下次（前台恢复、网络恢复、手动更新）从中断处继续，而不是从 0 重来。
 */
export interface PrestoreSyncCursor {
  planKey: string
  presetId: string
  perSourceLimit: number
  /** 本轮已处理过的信源 id，顺序即计划顺序 */
  visitedSourceIds: string[]
  updatedAt: number
}

/**
 * Resolve the exact source traversal order for the active preset/runtime layout.
 * A source is visited once at its first concrete visible category; mix-only sources are appended last.
 */
export function buildPrestorePlan(
  presetId: string,
  prefs: Preferences,
  enabledIds: string[],
): PrestorePlan {
  const seen = new Set<string>()
  const sources: PrestoreSourceTarget[] = []

  const categories = visibleCategories(prefs)
  const aggregateCategory = categories.find((category) => category.id === FOLLOWS_ENABLED_SOURCES)

  const appendSource = (categoryId: CategoryId, categoryLabel: string, sourceId: string) => {
    if (seen.has(sourceId)) return
    const source = findSource(sourceId, prefs.customSources)
    if (!source) return
    seen.add(sourceId)
    sources.push({ categoryId, categoryLabel, source })
  }

  // mix/综合是全局启用源的聚合视图，不让它在首位把所有真实分类提前“吃掉”。
  // 真实分类按用户顺序先走；最后只补综合独有、此前未出现的启用源。
  for (const category of categories) {
    if (category.id === FOLLOWS_ENABLED_SOURCES) continue
    for (const sourceId of categorySourceIds(category.id, prefs)) {
      appendSource(category.id, category.label, sourceId)
    }
  }

  if (aggregateCategory) {
    for (const sourceId of enabledIds) {
      appendSource(aggregateCategory.id, aggregateCategory.label, sourceId)
    }
  }

  return {
    presetId,
    key: `${presetId}:${sources
      .map((item) => `${item.categoryId}/${item.source.id}@${item.source.kind}:${item.source.url}`)
      .join('|')}`,
    sources,
  }
}

/** 清单里每个信源保留的滚动窗口；与 store 的 PrestoreSourceEntry 同形。 */
export interface PrestoreWindow {
  categoryId: CategoryId
  articleIds: string[]
}

/** 铺底只需要读清单的窗口与条目两张表，正文条目形状由 store 决定。 */
export interface PrestoreWindowSnapshot<Entry> {
  sources: Record<string, PrestoreWindow>
  articles: Record<string, Entry>
}

/**
 * 只有计划、预设与每源篇数完全一致时，上一轮中断的游标才能续传；
 * 任何一项变化都意味着窗口目标变了，必须整轮重来。
 */
export function resumableVisitedSources(
  cursor: PrestoreSyncCursor | null | undefined,
  plan: PrestorePlan,
  perSourceLimit: number,
): Set<string> {
  if (!cursor) return new Set()
  if (cursor.planKey !== plan.key || cursor.presetId !== plan.presetId) return new Set()
  if (cursor.perSourceLimit !== Math.max(1, Math.floor(perSourceLimit))) return new Set()
  const planned = new Set(plan.sources.map((target) => target.source.id))
  return new Set(cursor.visitedSourceIds.filter((sourceId) => planned.has(sourceId)))
}

/**
 * 用上一轮内容按当前计划铺底，作为本轮草稿的初始状态。
 * 有了它，任何一次中途提交都是上一轮的超集：既不会让已有通勤内容消失，
 * 也不会把仍被引用的正文误判成孤儿。计划里已删除的信源不会被带入。
 */
export function seedPrestoreWindows<Entry>(
  plan: PrestorePlan,
  previous: PrestoreWindowSnapshot<Entry> | null | undefined,
  limit: number,
): { sources: Record<string, PrestoreWindow>; articles: Record<string, Entry> } {
  const target = Math.max(1, Math.floor(limit))
  const sources: Record<string, PrestoreWindow> = {}
  const articles: Record<string, Entry> = {}
  if (!previous) return { sources, articles }

  for (const item of plan.sources) {
    const ids = previous.sources[item.source.id]?.articleIds ?? []
    const kept: string[] = []
    for (const id of ids) {
      const entry = previous.articles[id]
      if (!entry) continue
      articles[id] = entry
      kept.push(id)
      if (kept.length >= target) break
    }
    if (kept.length) sources[item.source.id] = { categoryId: item.categoryId, articleIds: kept }
  }
  return { sources, articles }
}

/**
 * Build the next fixed-size rolling window.
 * Fresh successfully stored entries win in remote order; previous stored entries
 * only fill holes caused by body failures or an upstream window shorter than N.
 */
export function mergeRollingWindow(
  successfulFreshIds: readonly string[],
  previousIds: readonly string[],
  limit: number,
): string[] {
  const target = Math.max(0, Math.floor(limit))
  if (target === 0) return []

  const seen = new Set<string>()
  const result: string[] = []
  const append = (id: string) => {
    if (!id || seen.has(id) || result.length >= target) return
    seen.add(id)
    result.push(id)
  }

  successfulFreshIds.forEach(append)
  previousIds.forEach(append)
  return result
}

/** Extra candidates help a fresh pack still reach N when a few bodies fail. */
export function prestoreCandidateLimit(limit: number): number {
  const target = Math.max(1, Math.floor(limit))
  return Math.min(160, Math.max(target, Math.ceil(target * 1.25)))
}

export function compactPrestoreArticle(article: Article): Article {
  const { contentHtml: _contentHtml, ...metadata } = article
  return metadata
}
