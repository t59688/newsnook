/**
 * 分类偏好：分类解析（顺序/显隐/信源覆盖）查询与不可变更新，
 * 含自建分类的增删改与布局重置。
 */

import {
  CATEGORIES,
  findCategory,
  PORTAL_VISIBLE_CATEGORY_IDS,
  RECOMMEND_CATEGORY_ID,
  type CategoryId,
  type NewsCategory,
} from '../categories'
import { SOURCES, findSource, type NewsSource } from '../registry'
import {
  DEFAULT_HIDDEN_CATEGORY_IDS,
  FOLLOWS_ENABLED_SOURCES,
  isAggregateCategoryId,
  uniqueValid,
  type Preferences,
} from './model'

/** 获取全部可用信源（内置 + 用户自建） */
export function allRegisteredSources(prefs?: Preferences): NewsSource[] {
  return [...SOURCES, ...(prefs?.customSources ?? [])]
}

/** 获取全部可用分类（内置 + 用户自建） */
export function allRegisteredCategories(prefs: Preferences): NewsCategory[] {
  return [...CATEGORIES, ...(prefs.customCategories ?? [])]
}

export function isCustomCategory(categoryId: CategoryId, prefs: Preferences): boolean {
  return Boolean(prefs.customCategories?.some((category) => category.id === categoryId))
}

/** 把信源 id 折成一句出处摘要 */
export function describeSources(sourceIds: string[], extraSources?: NewsSource[]): string {
  const labels = sourceIds
    .map((id) => findSource(id, extraSources)?.label)
    .filter((label): label is string => Boolean(label))
  if (!labels.length) return '未选择信源'
  const head = labels.slice(0, 4).join(' · ')
  return labels.length > 4 ? `${head} 等 ${labels.length} 个` : head
}

/** 分类的实际信源：用户覆盖优先，否则用分类自身默认 */
export function categorySourceIds(categoryId: CategoryId, prefs: Preferences): string[] {
  const override = prefs.categorySources[categoryId]
  if (override?.length) return override

  const custom = prefs.customCategories?.find((category) => category.id === categoryId)
  if (custom?.sourceIds?.length) return custom.sourceIds

  return findCategory(categoryId).sourceIds ?? []
}

/** sourceId → 同场景其他可见分类的 label（排除 excludeCategoryId 与 mix） */
export function sourceUsageByOtherCategories(
  prefs: Preferences,
  excludeCategoryId?: CategoryId,
): Record<string, string[]> {
  const usage: Record<string, string[]> = {}
  const seenIds: Record<string, Set<CategoryId>> = {}

  for (const category of visibleCategories(prefs)) {
    if (category.id === FOLLOWS_ENABLED_SOURCES) continue
    if (excludeCategoryId && category.id === excludeCategoryId) continue

    for (const sourceId of categorySourceIds(category.id, prefs)) {
      const ids = seenIds[sourceId] ?? (seenIds[sourceId] = new Set())
      if (ids.has(category.id)) continue
      ids.add(category.id)
      ;(usage[sourceId] ??= []).push(category.label)
    }
  }

  return usage
}

export function hasSourceOverride(categoryId: CategoryId, prefs: Preferences): boolean {
  return Boolean(prefs.categorySources[categoryId]?.length)
}

/**
 * 分类的最终形态：信源与说明文案都按偏好解析。
 * 用户改过信源后，注册表里手写的 caption 会失真，这里换成实时出处摘要。
 */
export function resolveCategory(categoryId: CategoryId, prefs: Preferences): NewsCategory {
  const custom = prefs.customCategories?.find((category) => category.id === categoryId)
  if (custom) {
    const sourceIds = categorySourceIds(categoryId, prefs)
    return {
      ...custom,
      sourceIds,
      caption: describeSources(sourceIds, prefs.customSources),
      isCustom: true,
    }
  }

  const base = findCategory(categoryId)
  if (base.id === FOLLOWS_ENABLED_SOURCES) return base

  const sourceIds = categorySourceIds(base.id, prefs)
  return {
    ...base,
    sourceIds,
    caption: hasSourceOverride(base.id, prefs)
      ? describeSources(sourceIds, prefs.customSources)
      : base.caption,
  }
}

/** 首页轨道用：按用户顺序排列并解析后的可见分类 */
export function orderedCategories(prefs: Preferences): NewsCategory[] {
  const all = allRegisteredCategories(prefs)
  const byId = new Map(all.map((category) => [category.id, category]))
  const ordered: NewsCategory[] = []
  const seen = new Set<CategoryId>()

  prefs.categoryOrder.forEach((id) => {
    const category = byId.get(id)
    if (category && !seen.has(id)) {
      ordered.push(category)
      seen.add(id)
    }
  })

  all.forEach((category) => {
    if (!seen.has(category.id)) {
      ordered.push(category)
      seen.add(category.id)
    }
  })

  return ordered.map((category) => resolveCategory(category.id, prefs))
}

export function visibleCategories(prefs: Preferences): NewsCategory[] {
  return orderedCategories(prefs).filter(
    (category) => !prefs.hiddenCategoryIds.includes(category.id),
  )
}

/** 设置页使用稳定分组：启用分类在前，停用分类在后；组内保留用户轨道顺序。 */
export function settingsCategories(prefs: Preferences): NewsCategory[] {
  const ordered = orderedCategories(prefs)
  const visible: NewsCategory[] = []
  const hidden: NewsCategory[] = []

  ordered.forEach((category) => {
    if (isCategoryVisible(category.id, prefs)) visible.push(category)
    else hidden.push(category)
  })

  return [...visible, ...hidden]
}

export function isCategoryVisible(categoryId: CategoryId, prefs: Preferences): boolean {
  return !prefs.hiddenCategoryIds.includes(categoryId)
}

/**
 * 「推荐」分类的候选范围：当前布局全部可见分类的信源并集（综合贡献频道启用列表）。
 * 只覆盖用户在本预设里订阅的源，不引入未订阅源；布局里没有其它可见分类时回落到频道启用列表。
 */
export function recommendationScopeSourceIds(
  prefs: Preferences,
  enabledIds: string[],
): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (sourceId: string) => {
    if (seen.has(sourceId)) return
    seen.add(sourceId)
    ids.push(sourceId)
  }
  for (const category of visibleCategories(prefs)) {
    if (category.id === RECOMMEND_CATEGORY_ID) continue
    if (category.id === FOLLOWS_ENABLED_SOURCES) {
      enabledIds.forEach(push)
      continue
    }
    categorySourceIds(category.id, prefs).forEach(push)
  }
  return ids.length ? ids : enabledIds
}

/** 当前分类要拉取的信源；综合回落到频道启用列表，推荐取可见分类信源并集 */
export function sourceIdsForCategoryWithPrefs(
  categoryId: CategoryId,
  prefs: Preferences,
  enabledIds: string[],
): string[] {
  if (categoryId === RECOMMEND_CATEGORY_ID) {
    return recommendationScopeSourceIds(prefs, enabledIds)
  }
  const ids = categorySourceIds(categoryId, prefs)
  return ids.length ? ids : enabledIds
}

// —— 以下为不可变更新函数，供设置界面调用 ——

function currentOrder(prefs: Preferences): CategoryId[] {
  return orderedCategories(prefs).map((category) => category.id)
}

export function moveCategory(
  prefs: Preferences,
  categoryId: CategoryId,
  direction: -1 | 1,
): Preferences {
  const order = currentOrder(prefs)
  const index = order.indexOf(categoryId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= order.length) return prefs

  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return { ...prefs, categoryOrder: next }
}

/** 拖拽排序：把 fromId 抽出来插入到 toId 的位置 */
export function reorderCategories(
  prefs: Preferences,
  fromId: CategoryId,
  toId: CategoryId,
): Preferences {
  if (fromId === toId) return prefs
  const order = currentOrder(prefs)
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0) return prefs

  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return { ...prefs, categoryOrder: next }
}

export function setCategoryOrder(prefs: Preferences, order: CategoryId[]): Preferences {
  const all = allRegisteredCategories(prefs)
  const known = new Set(all.map((category) => category.id))
  const cleaned = [...new Set(order.filter((id) => known.has(id)))]
  all.forEach((category) => {
    if (!cleaned.includes(category.id)) cleaned.push(category.id)
  })
  return { ...prefs, categoryOrder: cleaned }
}

export function toggleCategoryVisible(prefs: Preferences, categoryId: CategoryId): Preferences {
  const all = allRegisteredCategories(prefs)
  const hidden = prefs.hiddenCategoryIds
  if (hidden.includes(categoryId)) {
    const next: Preferences = {
      ...prefs,
      hiddenCategoryIds: hidden.filter((id) => id !== categoryId),
    }
    // 「推荐」以是否收录进 categoryOrder 区分「显式开启」与旧数据缺省：
    // 解除隐藏时落一份全量顺序，避免归一化迁移在重启后把它重新藏起来
    if (categoryId === RECOMMEND_CATEGORY_ID && !prefs.categoryOrder.includes(categoryId)) {
      next.categoryOrder = currentOrder(prefs)
    }
    return next
  }
  // 全部隐藏会让首页无处可去
  if (hidden.length + 1 >= all.length) return prefs
  return { ...prefs, hiddenCategoryIds: [...hidden, categoryId] }
}

export function toggleCategorySource(
  prefs: Preferences,
  categoryId: CategoryId,
  sourceId: string,
): Preferences {
  if (isAggregateCategoryId(categoryId)) return prefs

  const current = categorySourceIds(categoryId, prefs)
  const removing = current.includes(sourceId)
  // 分类至少保留一个信源，否则该 Tab 会永远空着
  if (removing && current.length <= 1) return prefs

  const next = removing ? current.filter((id) => id !== sourceId) : [...current, sourceId]
  return {
    ...prefs,
    categorySources: { ...prefs.categorySources, [categoryId]: next },
  }
}

export function resetCategorySources(prefs: Preferences, categoryId: CategoryId): Preferences {
  if (!(categoryId in prefs.categorySources)) return prefs
  const next = { ...prefs.categorySources }
  delete next[categoryId]
  return { ...prefs, categorySources: next }
}

export function addCustomCategory(
  prefs: Preferences,
  draft: { label: string; short?: string; sourceIds: string[] },
): { nextPrefs: Preferences; newCategoryId: CategoryId } {
  const knownSourceIds = new Set(allRegisteredSources(prefs).map((s) => s.id))
  const validSourceIds = uniqueValid(draft.sourceIds, knownSourceIds)
  const label = draft.label.trim() || '自定义分类'
  const short = (draft.short?.trim() || label.slice(0, 4)) || '分类'
  const id: CategoryId = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const newCategory: NewsCategory = {
    id,
    label,
    short,
    caption: describeSources(validSourceIds, prefs.customSources),
    sourceIds: validSourceIds,
    isCustom: true,
  }

  const customCategories = [...(prefs.customCategories ?? []), newCategory]

  // 将新分类放在可见分类中：如果当前有 categoryOrder，则将其放到当前可见项的后面
  const currentOrdered = orderedCategories(prefs)
  const lastVisibleIndex = currentOrdered.findIndex((category) => prefs.hiddenCategoryIds.includes(category.id))
  const currentOrderList = currentOrdered.map((category) => category.id)

  const newOrder = [...currentOrderList]
  if (lastVisibleIndex > 0) {
    newOrder.splice(lastVisibleIndex, 0, id)
  } else {
    newOrder.push(id)
  }

  return {
    nextPrefs: {
      ...prefs,
      customCategories,
      categoryOrder: newOrder,
      hiddenCategoryIds: prefs.hiddenCategoryIds.filter((hiddenId) => hiddenId !== id),
    },
    newCategoryId: id,
  }
}

export function updateCustomCategory(
  prefs: Preferences,
  categoryId: CategoryId,
  patch: { label?: string; short?: string; sourceIds?: string[] },
): Preferences {
  const list = prefs.customCategories ?? []
  const index = list.findIndex((category) => category.id === categoryId)
  if (index < 0) return prefs

  const knownSourceIds = new Set(allRegisteredSources(prefs).map((s) => s.id))
  const current = list[index]
  const label = patch.label !== undefined ? (patch.label.trim() || current.label) : current.label
  const short = patch.short !== undefined ? (patch.short.trim() || label.slice(0, 4)) : current.short
  const sourceIds =
    patch.sourceIds !== undefined
      ? uniqueValid(patch.sourceIds, knownSourceIds)
      : (current.sourceIds ?? [])

  if (!sourceIds.length) return prefs

  const updated: NewsCategory = {
    ...current,
    label,
    short,
    sourceIds,
    caption: describeSources(sourceIds, prefs.customSources),
    isCustom: true,
  }

  const nextCustom = [...list]
  nextCustom[index] = updated

  // 同步清理/更新 categorySources 中的覆盖
  const nextSources = { ...prefs.categorySources }
  if (categoryId in nextSources) {
    nextSources[categoryId] = sourceIds
  }

  return {
    ...prefs,
    customCategories: nextCustom,
    categorySources: nextSources,
  }
}

export function deleteCustomCategory(prefs: Preferences, categoryId: CategoryId): Preferences {
  const nextCustom = (prefs.customCategories ?? []).filter((category) => category.id !== categoryId)
  const nextOrder = prefs.categoryOrder.filter((id) => id !== categoryId)
  const nextHidden = prefs.hiddenCategoryIds.filter((id) => id !== categoryId)
  const nextSources = { ...prefs.categorySources }
  delete nextSources[categoryId]

  return {
    ...prefs,
    customCategories: nextCustom,
    categoryOrder: nextOrder,
    hiddenCategoryIds: nextHidden,
    categorySources: nextSources,
  }
}

export function resetCategoryLayout(
  prefs: Preferences,
  options?: { removeCustom?: boolean },
): Preferences {
  return {
    ...prefs,
    categoryOrder: [...PORTAL_VISIBLE_CATEGORY_IDS],
    hiddenCategoryIds: [...DEFAULT_HIDDEN_CATEGORY_IDS],
    categorySources: {},
    customCategories: options?.removeCustom ? [] : (prefs.customCategories ?? []),
  }
}
