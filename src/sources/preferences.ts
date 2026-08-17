/**
 * 用户偏好：叠加在静态分类注册表之上的一层覆盖。
 *
 * 注册表（categories.ts / registry.ts）始终是默认值来源，这里只保存「用户改过什么」，
 * 因此后续增删分类或信源时，旧偏好不会失效，也不需要写迁移脚本。
 */

import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_SCHEME,
  isThemeMode,
  isThemeScheme,
  schemeSeedColors,
  type ThemeMode,
  type ThemeScheme,
} from '../lib/theme'
import {
  DEFAULT_CUSTOM_SCHEME,
  normalizeCustomScheme,
  type CustomSchemeColors,
  type CustomSchemePrefs,
} from '../lib/customScheme'
import type { ResolvedTheme } from '../lib/theme'
import {
  DEFAULT_TRANSLATION_PREFS,
  normalizeTranslationPrefs,
} from '../features/translation/config'
import type { TranslationPrefs } from '../features/translation/types'
import {
  DEFAULT_PROXY_PREFS,
  normalizeProxyPrefs,
} from '../features/proxy/config'
import type { ProxyPrefs } from '../features/proxy/types'
import { CATEGORIES, findCategory, PORTAL_VISIBLE_CATEGORY_IDS, type CategoryId, type NewsCategory } from './categories'
import {
  SOURCES,
  findSource,
  makeCustomSourceId,
  type NewsSource,
  type SourceGroup,
} from './registry'

export type FontFamilyId = 'sans' | 'serif' | 'system'

export interface TypographyPrefs {
  /** 正文字号倍率，基准 15.5px */
  fontScale: number
  lineHeight: number
  /** 段落间距，单位 em */
  paragraphGap: number
  fontFamily: FontFamilyId
  /** 正文段落首行缩进两字符（2em） */
  firstLineIndent: boolean
}

export interface Preferences {
  /** 分类展示顺序；未列出的分类按注册表顺序排在后面 */
  categoryOrder: CategoryId[]
  hiddenCategoryIds: CategoryId[]
  /** 分类 → 自定义信源；缺省表示沿用注册表默认 */
  categorySources: Record<CategoryId, string[]>
  /** 用户自建的自定义分类列表 */
  customCategories?: NewsCategory[]
  /** 用户自建或导入的自定义订阅源 */
  customSources?: NewsSource[]
  typography: TypographyPrefs
  theme: ThemeMode
  /** 风格方案：与明暗正交的配色主题，见 lib/theme.ts */
  scheme: ThemeScheme
  /** 自定义配色（scheme === 'custom' 时生效）：昼/夜各一组底色与强调色 */
  customScheme?: CustomSchemePrefs
  translation: TranslationPrefs
  proxy: ProxyPrefs
  /** 切换/滑动到分类页时是否自动刷新（关闭时保留滚动阅读位置） */
  autoRefreshOnCategorySwitch?: boolean
  /**
   * 墨水屏模式：关动画/弱化装饰/文章分页。与 theme 正交；默认 false。
   * 关闭后须完整恢复正常模式行为。
   */
  einkMode: boolean
  /** Android：仅 Wi-Fi 下自动加载阅读页图片和视频；默认 false */
  wifiOnlyAutoLoadMedia: boolean
}

export const DEFAULT_TYPOGRAPHY: TypographyPrefs = {
  fontScale: 1,
  lineHeight: 1.9,
  paragraphGap: 1.1,
  fontFamily: 'sans',
  firstLineIndent: true,
}

/**
 * 门户经典默认栏之外的分类；新装 / 重置布局时隐藏。
 * 可见栏与 presets.PORTAL_VISIBLE_CATEGORY_IDS 对齐：
 * 综合 / 热点 / 娱乐 / 体育 / 科技 / 商业 / 国际 / 健康 / 科普 / 轻松。
 * AI、游戏、深度与冷门细分留给场景预设或分类管理。
 */
export const DEFAULT_HIDDEN_CATEGORY_IDS: CategoryId[] = [
  'ai',
  'game',
  'exclusive',
  'politics',
  'edu',
  'auto',
  'travel',
  'history',
  'phone',
  'digital',
  'antique',
  'run',
  'blog',
  'select',
  'nba',
  'football',
  'cba',
  'cn-football',
  'zhihu',
  'astral-codex-ten',
  'marginalian',
  'aldaily',
  'theue',
  'tech-depth',
]

export const DEFAULT_PREFERENCES: Preferences = {
  categoryOrder: [...PORTAL_VISIBLE_CATEGORY_IDS],
  hiddenCategoryIds: [...DEFAULT_HIDDEN_CATEGORY_IDS],
  categorySources: {},
  customCategories: [],
  customSources: [],
  typography: DEFAULT_TYPOGRAPHY,
  theme: DEFAULT_THEME_MODE,
  scheme: DEFAULT_THEME_SCHEME,
  translation: DEFAULT_TRANSLATION_PREFS,
  proxy: DEFAULT_PROXY_PREFS,
  autoRefreshOnCategorySwitch: true,
  einkMode: false,
  wifiOnlyAutoLoadMedia: false,
}

/** 综合分类跟随「频道」页启用状态，不参与逐分类信源编辑 */
export const FOLLOWS_ENABLED_SOURCES: CategoryId = 'mix'

export const FONT_FAMILY_OPTIONS: { id: FontFamilyId; label: string; cssVar: string }[] = [
  { id: 'sans', label: '黑体', cssVar: 'var(--font-reader-sans)' },
  { id: 'serif', label: '宋体', cssVar: 'var(--font-reader-serif)' },
  { id: 'system', label: '系统', cssVar: 'var(--font-reader-system)' },
]

export const FONT_SCALE_OPTIONS: { label: string; value: number }[] = [
  { label: '小', value: 0.88 },
  { label: '较小', value: 0.94 },
  { label: '标准', value: 1 },
  { label: '较大', value: 1.1 },
  { label: '大', value: 1.22 },
]

export const LINE_HEIGHT_OPTIONS: { label: string; value: number }[] = [
  { label: '紧凑', value: 1.65 },
  { label: '标准', value: 1.9 },
  { label: '舒展', value: 2.15 },
]

export const PARAGRAPH_GAP_OPTIONS: { label: string; value: number }[] = [
  { label: '紧凑', value: 0.8 },
  { label: '标准', value: 1.1 },
  { label: '宽松', value: 1.5 },
]

function uniqueValid(ids: unknown, known: Set<string>): string[] {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((id): id is string => typeof id === 'string' && known.has(id))
  return [...new Set(valid)]
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

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

/** 读入持久化数据时剔除已下线的分类与信源，避免脏配置导致空列表 */
export function normalizePreferences(raw: unknown): Preferences {
  const input = (raw ?? {}) as Partial<Preferences>
  const typography = (input.typography ?? {}) as Partial<TypographyPrefs>

  // 1. 规范化自建订阅源列表
  const customSources: NewsSource[] = []
  const seenSourceIds = new Set(SOURCES.map((s) => s.id))

  if (Array.isArray(input.customSources)) {
    input.customSources.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const rawUrl = typeof item.url === 'string' ? item.url.trim() : ''
      const rawName = typeof item.name === 'string' ? item.name.trim() : ''
      if (!rawUrl || !rawName) return

      const rawId =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : makeCustomSourceId(rawUrl)
      if (seenSourceIds.has(rawId)) return
      seenSourceIds.add(rawId)

      const rawLabel = typeof item.label === 'string' ? item.label.trim() : ''
      const rawSiteUrl = typeof item.siteUrl === 'string' ? item.siteUrl.trim() : undefined
      const rawGroup =
        typeof item.group === 'string' && ['cn', 'intl', 'tech', 'ai', 'special', 'custom'].includes(item.group)
          ? (item.group as SourceGroup)
          : 'custom'

      customSources.push({
        id: rawId,
        name: rawName,
        label: rawLabel || rawName.slice(0, 4),
        group: rawGroup,
        kind: 'feed',
        url: rawUrl,
        siteUrl: rawSiteUrl,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        isCustom: true,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      })
    })
  }

  const knownSourceIds = new Set([...SOURCES.map((s) => s.id), ...customSources.map((s) => s.id)])

  // 2. 规范化自建分类列表
  const customCategories: NewsCategory[] = []
  if (Array.isArray(input.customCategories)) {
    input.customCategories.forEach((item) => {
      if (!item || typeof item !== 'object') return
      const rawId = typeof item.id === 'string' ? item.id.trim() : ''
      const rawLabel = typeof item.label === 'string' ? item.label.trim() : ''
      const rawShort = typeof item.short === 'string' ? item.short.trim() : ''
      if (!rawId || !rawLabel) return

      const sourceIds = uniqueValid(item.sourceIds, knownSourceIds)
      if (!sourceIds.length) return

      customCategories.push({
        id: rawId,
        label: rawLabel,
        short: rawShort || rawLabel.slice(0, 4),
        caption: describeSources(sourceIds, customSources),
        sourceIds,
        isCustom: true,
      })
    })
  }

  const allCategoryIds = new Set([
    ...CATEGORIES.map((category) => category.id),
    ...customCategories.map((category) => category.id),
  ])

  const categorySources: Record<CategoryId, string[]> = {}
  Object.entries(input.categorySources ?? {}).forEach(([categoryId, sourceIds]) => {
    if (!allCategoryIds.has(categoryId) || categoryId === FOLLOWS_ENABLED_SOURCES) return
    const valid = uniqueValid(sourceIds, knownSourceIds)
    if (valid.length) categorySources[categoryId] = valid
  })

  // 缺省键 → 门户经典默认隐藏；显式 [] 表示用户/旧数据「全部显示」，不强制迁移
  const hidden = Array.isArray(input.hiddenCategoryIds)
    ? uniqueValid(input.hiddenCategoryIds, allCategoryIds)
    : [...DEFAULT_HIDDEN_CATEGORY_IDS]

  const scheme = isThemeScheme(input.scheme) ? input.scheme : DEFAULT_THEME_SCHEME
  let customScheme = normalizeCustomScheme(input.customScheme)
  // 选了自定义但还没有配色数据（例如同步来的旧偏好）：从墨问种子起步
  if (scheme === 'custom' && !customScheme) {
    customScheme = {
      light: { ...DEFAULT_CUSTOM_SCHEME.light },
      dark: { ...DEFAULT_CUSTOM_SCHEME.dark },
    }
  }

  return {
    categoryOrder: uniqueValid(input.categoryOrder, allCategoryIds),
    // 至少保留一个可见分类，否则首页无内容可选
    hiddenCategoryIds: hidden.length >= allCategoryIds.size ? hidden.slice(1) : hidden,
    categorySources,
    customCategories,
    customSources,
    theme: isThemeMode(input.theme) ? input.theme : DEFAULT_THEME_MODE,
    scheme,
    customScheme,
    translation: normalizeTranslationPrefs(input.translation),
    proxy: normalizeProxyPrefs(input.proxy),
    autoRefreshOnCategorySwitch:
      typeof input.autoRefreshOnCategorySwitch === 'boolean'
        ? input.autoRefreshOnCategorySwitch
        : true,
    einkMode: typeof input.einkMode === 'boolean' ? input.einkMode : false,
    wifiOnlyAutoLoadMedia:
      typeof input.wifiOnlyAutoLoadMedia === 'boolean' ? input.wifiOnlyAutoLoadMedia : false,
    typography: {
      fontScale: clamp(typography.fontScale, DEFAULT_TYPOGRAPHY.fontScale, 0.8, 1.4),
      lineHeight: clamp(typography.lineHeight, DEFAULT_TYPOGRAPHY.lineHeight, 1.4, 2.4),
      paragraphGap: clamp(typography.paragraphGap, DEFAULT_TYPOGRAPHY.paragraphGap, 0.4, 2),
      fontFamily: FONT_FAMILY_OPTIONS.some((option) => option.id === typography.fontFamily)
        ? (typography.fontFamily as FontFamilyId)
        : DEFAULT_TYPOGRAPHY.fontFamily,
      // 旧偏好无此字段时默认开启，贴近中文阅读习惯
      firstLineIndent:
        typeof typography.firstLineIndent === 'boolean'
          ? typography.firstLineIndent
          : DEFAULT_TYPOGRAPHY.firstLineIndent,
    },
  }
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

/** 当前分类要拉取的信源；综合分类回落到频道页启用列表 */
export function sourceIdsForCategoryWithPrefs(
  categoryId: CategoryId,
  prefs: Preferences,
  enabledIds: string[],
): string[] {
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
    return { ...prefs, hiddenCategoryIds: hidden.filter((id) => id !== categoryId) }
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
  if (categoryId === FOLLOWS_ENABLED_SOURCES) return prefs

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

/** 添加单个自定义 RSS 信源 */
export function addCustomSource(
  prefs: Preferences,
  draft: {
    name: string
    url: string
    label?: string
    siteUrl?: string
    group?: SourceGroup
  },
  targetCategoryId?: CategoryId,
): { nextPrefs: Preferences; newSourceId: string } {
  const url = draft.url.trim()
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
    kind: 'feed',
    url,
    siteUrl: draft.siteUrl?.trim() || undefined,
    enabled: true,
    isCustom: true,
    createdAt: Date.now(),
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
  patch: Partial<Pick<NewsSource, 'name' | 'label' | 'url' | 'siteUrl' | 'group'>>,
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

  const updated: NewsSource = {
    ...current,
    name,
    label,
    url,
    siteUrl,
    group,
  }

  const nextList = [...list]
  nextList[index] = updated

  return {
    ...prefs,
    customSources: nextList,
  }
}

/** 删除自定义 RSS 信源，并自动从相关分类中移除 */
export function deleteCustomSource(prefs: Preferences, sourceId: string): Preferences {
  const nextCustomSources = (prefs.customSources ?? []).filter((s) => s.id !== sourceId)

  // 清理 categorySources
  const nextCategorySources: Record<CategoryId, string[]> = {}
  Object.entries(prefs.categorySources).forEach(([catId, ids]) => {
    const filtered = ids.filter((id) => id !== sourceId)
    if (filtered.length) {
      nextCategorySources[catId] = filtered
    }
  })

  // 清理 customCategories
  const nextCustomCategories = (prefs.customCategories ?? []).map((cat) => ({
    ...cat,
    sourceIds: (cat.sourceIds ?? []).filter((id) => id !== sourceId),
  })).filter((cat) => (cat.sourceIds ?? []).length > 0)

  // 清理分类排序
  const validCategoryIds = new Set([
    ...CATEGORIES.map((c) => c.id),
    ...nextCustomCategories.map((c) => c.id),
  ])
  const nextOrder = prefs.categoryOrder.filter((id) => validCategoryIds.has(id))
  const nextHidden = prefs.hiddenCategoryIds.filter((id) => validCategoryIds.has(id))

  return {
    ...prefs,
    customSources: nextCustomSources,
    categorySources: nextCategorySources,
    customCategories: nextCustomCategories,
    categoryOrder: nextOrder,
    hiddenCategoryIds: nextHidden,
  }
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

export function setThemeMode(prefs: Preferences, theme: ThemeMode): Preferences {
  return prefs.theme === theme ? prefs : { ...prefs, theme }
}

export function setThemeScheme(prefs: Preferences, scheme: ThemeScheme): Preferences {
  return prefs.scheme === scheme ? prefs : { ...prefs, scheme }
}

/**
 * 选择方案；首次选「自定义」时从当前方案复制种子色，让编辑器有可见的起点。
 * （外观页与编辑器都走这个入口）
 */
export function selectThemeScheme(prefs: Preferences, scheme: ThemeScheme): Preferences {
  if (scheme === 'custom' && !prefs.customScheme) {
    return { ...setThemeScheme(prefs, scheme), customScheme: schemeSeedColors(prefs.scheme) }
  }
  return setThemeScheme(prefs, scheme)
}

/** 更新自定义配色中某一档（昼/夜）的底色与强调色 */
export function setCustomSchemeColors(
  prefs: Preferences,
  mode: ResolvedTheme,
  colors: CustomSchemeColors,
): Preferences {
  const current = prefs.customScheme ?? {
    light: { ...DEFAULT_CUSTOM_SCHEME.light },
    dark: { ...DEFAULT_CUSTOM_SCHEME.dark },
  }
  const existing = current[mode]
  if (existing.ink === colors.ink && existing.accent === colors.accent) return prefs
  return { ...prefs, customScheme: { ...current, [mode]: colors } }
}

export function setEinkMode(prefs: Preferences, enabled: boolean): Preferences {
  return prefs.einkMode === enabled ? prefs : { ...prefs, einkMode: enabled }
}

export function setWifiOnlyAutoLoadMedia(prefs: Preferences, enabled: boolean): Preferences {
  return prefs.wifiOnlyAutoLoadMedia === enabled
    ? prefs
    : { ...prefs, wifiOnlyAutoLoadMedia: enabled }
}

export function updateTypography(
  prefs: Preferences,
  patch: Partial<TypographyPrefs>,
): Preferences {
  return { ...prefs, typography: { ...prefs.typography, ...patch } }
}

export function resetTypography(prefs: Preferences): Preferences {
  return { ...prefs, typography: DEFAULT_TYPOGRAPHY }
}

export function updateProxyPrefs(
  prefs: Preferences,
  patch: Partial<ProxyPrefs>,
): Preferences {
  return { ...prefs, proxy: normalizeProxyPrefs({ ...prefs.proxy, ...patch }) }
}

export function resetProxyPrefs(prefs: Preferences): Preferences {
  return { ...prefs, proxy: DEFAULT_PROXY_PREFS }
}

export function setAutoRefreshOnCategorySwitch(
  prefs: Preferences,
  enabled: boolean,
): Preferences {
  return prefs.autoRefreshOnCategorySwitch === enabled
    ? prefs
    : { ...prefs, autoRefreshOnCategorySwitch: enabled }
}

