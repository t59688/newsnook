/**
 * 自定义订阅源：单个增删改、批量删除与 OPML 批量导入。
 */

import { CATEGORIES, type CategoryId, type NewsCategory } from '../categories'
import {
  isWechatAlbumUrl,
  makeCustomSourceId,
  normalizeSourceKind,
  normalizeWechatAlbumUrl,
  type NewsSource,
  type SourceGroup,
} from '../registry'
import type { Preferences } from './model'
import { categorySourceIds, describeSources, isCustomCategory } from './categoryPrefs'
import { normalizePreferences } from './normalize'

/** 添加单个自定义 RSS / 网页目录信源 */
export function addCustomSource(
  prefs: Preferences,
  draft: {
    name: string
    url: string
    label?: string
    siteUrl?: string
    group?: SourceGroup
    kind?: NewsSource['kind']
    frameworkHint?: import('../../features/frameworkDetect/types').FrameworkHint
  },
  targetCategoryId?: CategoryId,
): { nextPrefs: Preferences; newSourceId: string } {
  // 公众号合集分享链接：归一成 JSON 列表入口并走公众号解析器
  const wechatAlbum = !draft.kind && isWechatAlbumUrl(draft.url.trim())
  const url = wechatAlbum ? normalizeWechatAlbumUrl(draft.url.trim()) : draft.url.trim()
  const name = draft.name.trim() || '自定义订阅'
  const label = draft.label?.trim() || name.slice(0, 4)
  const id = makeCustomSourceId(url)
  const group = draft.group || 'custom'

  const existingList = prefs.customSources ?? []
  const existingIndex = existingList.findIndex((s) => s.id === id || s.url === url)

  const newSource: NewsSource = {
    id,
    name,
    label,
    group,
    kind: draft.kind ?? (wechatAlbum ? 'wechat' : 'feed'),
    url,
    siteUrl: draft.siteUrl?.trim() || undefined,
    enabled: true,
    isCustom: true,
    createdAt: Date.now(),
    ...(draft.frameworkHint ? { frameworkHint: draft.frameworkHint } : {}),
  }

  let nextSources: NewsSource[]
  if (existingIndex >= 0) {
    nextSources = [...existingList]
    nextSources[existingIndex] = { ...existingList[existingIndex], ...newSource }
  } else {
    nextSources = [...existingList, newSource]
  }

  let nextCategorySources = { ...prefs.categorySources }
  let nextCustomCategories = prefs.customCategories ? [...prefs.customCategories] : []

  if (targetCategoryId) {
    if (isCustomCategory(targetCategoryId, prefs)) {
      nextCustomCategories = nextCustomCategories.map((cat) => {
        if (cat.id === targetCategoryId) {
          const currentIds = cat.sourceIds ?? []
          return {
            ...cat,
            sourceIds: currentIds.includes(id) ? currentIds : [...currentIds, id],
          }
        }
        return cat
      })
    } else {
      const currentIds = categorySourceIds(targetCategoryId, prefs)
      if (!currentIds.includes(id)) {
        nextCategorySources[targetCategoryId] = [...currentIds, id]
      }
    }
  }

  return {
    nextPrefs: {
      ...prefs,
      customSources: nextSources,
      categorySources: nextCategorySources,
      customCategories: nextCustomCategories,
    },
    newSourceId: id,
  }
}

/** 修改自定义 RSS 信源信息 */
export function updateCustomSource(
  prefs: Preferences,
  sourceId: string,
  patch: Partial<Pick<NewsSource, 'name' | 'label' | 'url' | 'siteUrl' | 'group' | 'kind'>>,
): Preferences {
  const list = prefs.customSources ?? []
  const index = list.findIndex((s) => s.id === sourceId)
  if (index < 0) return prefs

  const current = list[index]
  const name = patch.name !== undefined ? (patch.name.trim() || current.name) : current.name
  const label = patch.label !== undefined ? (patch.label.trim() || name.slice(0, 4)) : current.label
  const url = patch.url !== undefined ? (patch.url.trim() || current.url) : current.url
  const siteUrl = patch.siteUrl !== undefined ? (patch.siteUrl.trim() || undefined) : current.siteUrl
  const group = patch.group ?? current.group
  const kind = patch.kind !== undefined ? normalizeSourceKind(patch.kind) : current.kind

  const updated: NewsSource = {
    ...current,
    name,
    label,
    url,
    siteUrl,
    group,
    kind,
  }

  const nextList = [...list]
  nextList[index] = updated

  return {
    ...prefs,
    customSources: nextList,
  }
}

/**
 * 批量删除自定义 RSS / 网页目录信源，并一次性清理关联分类。
 * 批量管理必须走单次不可变更新，避免循环删除触发重复持久化与中间态。
 */
export function deleteCustomSources(
  prefs: Preferences,
  sourceIds: readonly string[],
): Preferences {
  const requestedIds = new Set(sourceIds)
  if (!requestedIds.size) return prefs

  const customSources = prefs.customSources ?? []
  const deletedIds = new Set(
    customSources
      .filter((source) => requestedIds.has(source.id))
      .map((source) => source.id),
  )
  if (!deletedIds.size) return prefs

  const nextCustomSources = customSources.filter((source) => !deletedIds.has(source.id))

  // 自定义分类直接持有 sourceIds；删除后同步更新摘要，并移除已无信源的分类。
  const nextCustomCategories = (prefs.customCategories ?? [])
    .map((category) => {
      const nextSourceIds = (category.sourceIds ?? []).filter((id) => !deletedIds.has(id))
      return {
        ...category,
        sourceIds: nextSourceIds,
        caption: describeSources(nextSourceIds, nextCustomSources),
      }
    })
    .filter((category) => (category.sourceIds ?? []).length > 0)

  const validCategoryIds = new Set([
    ...CATEGORIES.map((category) => category.id),
    ...nextCustomCategories.map((category) => category.id),
  ])

  // 清理分类覆盖；自定义分类若因删除变空，也一并去掉其残留覆盖。
  const nextCategorySources: Record<CategoryId, string[]> = {}
  Object.entries(prefs.categorySources).forEach(([categoryId, ids]) => {
    if (!validCategoryIds.has(categoryId)) return
    const filtered = ids.filter((id) => !deletedIds.has(id))
    if (filtered.length) {
      nextCategorySources[categoryId] = filtered
    }
  })

  return {
    ...prefs,
    customSources: nextCustomSources,
    categorySources: nextCategorySources,
    customCategories: nextCustomCategories,
    categoryOrder: prefs.categoryOrder.filter((id) => validCategoryIds.has(id)),
    hiddenCategoryIds: prefs.hiddenCategoryIds.filter((id) => validCategoryIds.has(id)),
  }
}

/** 删除单个自定义信源；与批量删除共享同一套关联清理语义。 */
export function deleteCustomSource(prefs: Preferences, sourceId: string): Preferences {
  return deleteCustomSources(prefs, [sourceId])
}

/** 批量导入信源与分类（支持 OPML 导入） */
export function batchImportSourcesAndCategories(
  prefs: Preferences,
  payloadOrSources:
    | {
        sources: NewsSource[]
        categories?: NewsCategory[]
        categorySources?: Record<CategoryId, string[]>
      }
    | NewsSource[],
  categoriesOrMode?: NewsCategory[] | 'merge' | 'replace',
  categorySourcesArg?: Record<CategoryId, string[]>,
  modeArg: 'merge' | 'replace' = 'merge',
): Preferences {
  let sources: NewsSource[] = []
  let categories: NewsCategory[] | undefined
  let categorySources: Record<CategoryId, string[]> | undefined
  let mode: 'merge' | 'replace' = 'merge'

  if (Array.isArray(payloadOrSources)) {
    sources = payloadOrSources
    if (Array.isArray(categoriesOrMode)) {
      categories = categoriesOrMode
      categorySources = categorySourcesArg
      mode = modeArg
    } else if (categoriesOrMode === 'merge' || categoriesOrMode === 'replace') {
      mode = categoriesOrMode
    }
  } else {
    sources = payloadOrSources.sources ?? []
    categories = payloadOrSources.categories
    categorySources = payloadOrSources.categorySources
    if (typeof categoriesOrMode === 'string') {
      mode = categoriesOrMode
    }
  }

  let nextSources = mode === 'replace' ? [] : [...(prefs.customSources ?? [])]
  const sourceIdMap = new Map(nextSources.map((s) => [s.id, s]))

  sources.forEach((s) => {
    sourceIdMap.set(s.id, s)
  })
  nextSources = Array.from(sourceIdMap.values())

  let nextCustomCategories = mode === 'replace' ? [] : [...(prefs.customCategories ?? [])]
  if (categories?.length) {
    const catMap = new Map(nextCustomCategories.map((c) => [c.id, c]))
    categories.forEach((c) => {
      catMap.set(c.id, c)
    })
    nextCustomCategories = Array.from(catMap.values())
  }

  let nextCategorySources = mode === 'replace' ? {} : { ...prefs.categorySources }
  if (categorySources) {
    Object.entries(categorySources).forEach(([catId, ids]) => {
      const existing = nextCategorySources[catId] ?? []
      nextCategorySources[catId] = [...new Set([...existing, ...ids])]
    })
  }

  return normalizePreferences({
    ...prefs,
    customSources: nextSources,
    customCategories: nextCustomCategories,
    categorySources: nextCategorySources,
  })
}
