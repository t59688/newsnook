/**
 * 分类偏好：分类解析（顺序/显隐/信源覆盖）查询与不可变更新，
 * 含自建分类的增删改与布局重置。
 */

import {
  CATEGORIES,
  FAVORITES_CATEGORY,
  FAVORITES_CATEGORY_ID,
  findCategory,
  isReservedCategoryLabel,
  DEFAULT_PRESET_CATEGORY_IDS,
  DEFAULT_PRESET_CATEGORY_SOURCES,
  RECOMMEND_CATEGORY,
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
  return [...SOURCES.filter((source) => !source.workspaceOnly), ...(prefs?.customSources ?? [])]
}

/** 自动抓取路径是否应跳过该源。暂停只适用于自建源，内置源始终返回 false。 */
export function isSourcePaused(sourceId: string, prefs: Preferences): boolean {
  return prefs.customSources?.some((source) => source.id === sourceId && source.paused === true) ?? false
}

/** 过滤全局暂停源；分类成员关系本身不被修改。 */
export function automaticSourceIds(sourceIds: readonly string[], prefs: Preferences): string[] {
  return sourceIds.filter((sourceId) => !isSourcePaused(sourceId, prefs))
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
  if (Object.prototype.hasOwnProperty.call(prefs.categorySources, categoryId)) {
    return prefs.categorySources[categoryId] ?? []
  }

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
  return Object.prototype.hasOwnProperty.call(prefs.categorySources, categoryId)
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
  const nameOverride = prefs.categoryNames?.[base.id]
  const namedBase = nameOverride ? { ...base, ...nameOverride } : base
  if (base.id === FOLLOWS_ENABLED_SOURCES) return namedBase

  const sourceIds = categorySourceIds(base.id, prefs)
  return {
    ...namedBase,
    sourceIds,
    caption: hasSourceOverride(base.id, prefs)
      ? describeSources(sourceIds, prefs.customSources)
      : namedBase.caption,
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
 * 「推荐」分类的候选范围：严格取当前预设启用的全部信源——
 * 可见分类的信源并集，综合贡献频道启用列表；不引入未订阅源，也不回落到池外列表。
 * 并集为空（如空白预设）时返回空数组，此时推荐分类不会亮起。
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
    if (category.id === FOLLOWS_ENABLED_SOURCES) {
      automaticSourceIds(enabledIds, prefs).forEach(push)
      continue
    }
    automaticSourceIds(categorySourceIds(category.id, prefs), prefs).forEach(push)
  }
  return ids
}

/**
 * 首页轨道最终列表：推荐达标时插到最前，普通分类顺序不变。
 * 推荐分类不进注册表与偏好，只在展示层拼装。
 */
export function withRecommendCategory(
  categories: NewsCategory[],
  recommendReady: boolean,
): NewsCategory[] {
  if (!recommendReady) return categories
  return [RECOMMEND_CATEGORY, ...categories]
}

/**
 * 默认选中与回退目标：跳过动态「推荐」，永远取第一个普通分类。
 * 进入软件、切换预设或当前分类失效时都以此为准，推荐只能由用户手动选中。
 */
export function withFavoriteCategory(
  categories: NewsCategory[],
  favoriteSourceIds: string[],
): NewsCategory[] {
  if (!favoriteSourceIds.length) return categories
  const favoriteCategory: NewsCategory = {
    ...FAVORITES_CATEGORY,
    caption: `当前预设收藏的 ${favoriteSourceIds.length} 个信源`,
    sourceIds: [...favoriteSourceIds],
  }
  const insertAt = categories[0]?.id === RECOMMEND_CATEGORY_ID ? 1 : 0
  return [...categories.slice(0, insertAt), favoriteCategory, ...categories.slice(insertAt)]
}

export function defaultFeedCategoryId(categories: NewsCategory[]): CategoryId {
  return (
    categories.find(
      (category) =>
        category.id !== RECOMMEND_CATEGORY_ID && category.id !== FAVORITES_CATEGORY_ID,
    )?.id ?? FOLLOWS_ENABLED_SOURCES
  )
}

/**
 * 当前分类的展示成员关系。暂停不会改动分类/综合/收藏成员，因而缓存内容仍可读取；
 * 只有推荐候选天然属于自动计算范围，会排除暂停源。
 */
export function sourceIdsForCategoryWithPrefs(
  categoryId: CategoryId,
  prefs: Preferences,
  enabledIds: string[],
): string[] {
  if (categoryId === FAVORITES_CATEGORY_ID) return prefs.favoriteSourceIds
  if (categoryId === RECOMMEND_CATEGORY_ID) {
    return recommendationScopeSourceIds(prefs, enabledIds)
  }
  if (categoryId === FOLLOWS_ENABLED_SOURCES) return enabledIds
  return categorySourceIds(categoryId, prefs)
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
    return {
      ...prefs,
      hiddenCategoryIds: hidden.filter((id) => id !== categoryId),
    }
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

/** 新闻页长按「移出」允许移除普通分类的最后一个信源。 */
export function removeCategorySource(
  prefs: Preferences,
  categoryId: CategoryId,
  sourceId: string,
): Preferences {
  if (isAggregateCategoryId(categoryId)) return prefs
  const current = categorySourceIds(categoryId, prefs)
  if (!current.includes(sourceId)) return prefs
  return {
    ...prefs,
    categorySources: {
      ...prefs.categorySources,
      [categoryId]: current.filter((id) => id !== sourceId),
    },
  }
}

/** 当前预设内收藏/取消收藏信源。 */
export function toggleFavoriteSource(prefs: Preferences, sourceId: string): Preferences {
  if (!allRegisteredSources(prefs).some((source) => source.id === sourceId)) return prefs
  const current = prefs.favoriteSourceIds
  return {
    ...prefs,
    favoriteSourceIds: current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId],
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
  // 「推荐」是动态栏位保留名：自建分类不得占用（界面同步拦截，此处兜底）
  if (isReservedCategoryLabel(draft.label) || isReservedCategoryLabel(draft.short ?? '')) {
    return { nextPrefs: prefs, newCategoryId: '' }
  }
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
  // 编辑路径同样不得改名为保留名「推荐」
  if (isReservedCategoryLabel(patch.label ?? '') || isReservedCategoryLabel(patch.short ?? '')) {
    return prefs
  }
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

/** 当前预设内重命名分类：内置项写显示覆盖，自建项仍更新自身定义。 */
export function renameCategory(
  prefs: Preferences,
  categoryId: CategoryId,
  name: string,
): Preferences {
  const label = name.trim().slice(0, 16)
  const short = label.slice(0, 6)
  if (!label || isReservedCategoryLabel(label) || isReservedCategoryLabel(short)) return prefs

  if (isCustomCategory(categoryId, prefs)) {
    return updateCustomCategory(prefs, categoryId, { label, short })
  }

  const base = CATEGORIES.find((category) => category.id === categoryId)
  if (!base) return prefs
  if (base.label === label && base.short === short) {
    const categoryNames = { ...(prefs.categoryNames ?? {}) }
    delete categoryNames[categoryId]
    return { ...prefs, categoryNames }
  }
  return {
    ...prefs,
    categoryNames: {
      ...(prefs.categoryNames ?? {}),
      [categoryId]: { label, short },
    },
  }
}

export function deleteCustomCategory(prefs: Preferences, categoryId: CategoryId): Preferences {
  const nextCustom = (prefs.customCategories ?? []).filter((category) => category.id !== categoryId)
  const nextOrder = prefs.categoryOrder.filter((id) => id !== categoryId)
  const nextHidden = prefs.hiddenCategoryIds.filter((id) => id !== categoryId)
  const nextSources = { ...prefs.categorySources }
  delete nextSources[categoryId]
  const nextNames = { ...(prefs.categoryNames ?? {}) }
  delete nextNames[categoryId]

  return {
    ...prefs,
    customCategories: nextCustom,
    categoryOrder: nextOrder,
    hiddenCategoryIds: nextHidden,
    categorySources: nextSources,
    categoryNames: nextNames,
  }
}

export function resetCategoryLayout(
  prefs: Preferences,
  options?: { removeCustom?: boolean },
): Preferences {
  return {
    ...prefs,
    categoryOrder: [...DEFAULT_PRESET_CATEGORY_IDS],
    hiddenCategoryIds: [...DEFAULT_HIDDEN_CATEGORY_IDS],
    categorySources: { ...DEFAULT_PRESET_CATEGORY_SOURCES },
    categoryNames: {},
    customCategories: options?.removeCustom ? [] : (prefs.customCategories ?? []),
  }
}
