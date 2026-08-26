/**
 * 偏好归一化：读入持久化数据时剔除已下线的分类与信源，避免脏配置导致空列表。
 */

import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_SCHEME,
  isThemeMode,
  isThemeScheme,
} from '../../lib/theme'
import { DEFAULT_CUSTOM_SCHEME, normalizeCustomScheme } from '../../lib/customScheme'
import { normalizeTranslationPrefs } from '../../features/translation/config'
import { normalizeProxyPrefs } from '../../features/proxy/config'
import { CATEGORIES, type CategoryId, type NewsCategory } from '../categories'
import {
  SOURCES,
  makeCustomSourceId,
  normalizeSourceKind,
  type NewsSource,
  type SourceGroup,
} from '../registry'
import {
  clamp,
  DEFAULT_HIDDEN_CATEGORY_IDS,
  DEFAULT_TYPOGRAPHY,
  isAggregateCategoryId,
  FONT_FAMILY_OPTIONS,
  normalizePrestorePrefs,
  uniqueValid,
  type FontFamilyId,
  type Preferences,
  type TypographyPrefs,
} from './model'
import { describeSources } from './categoryPrefs'

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

      const source: NewsSource = {
        id: rawId,
        name: rawName,
        label: rawLabel || rawName.slice(0, 4),
        group: rawGroup,
        kind: normalizeSourceKind(typeof item.kind === 'string' ? item.kind : undefined),
        url: rawUrl,
        siteUrl: rawSiteUrl,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        isCustom: true,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      }
      if (item.frameworkHint && typeof item.frameworkHint === 'object') {
        source.frameworkHint = item.frameworkHint
      }
      customSources.push(source)
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
    if (!allCategoryIds.has(categoryId) || isAggregateCategoryId(categoryId)) return
    const valid = uniqueValid(sourceIds, knownSourceIds)
    if (valid.length) categorySources[categoryId] = valid
  })

  // 缺省键 → 门户经典默认隐藏；显式 [] 表示用户/旧数据「全部显示」，不强制迁移
  const hidden = Array.isArray(input.hiddenCategoryIds)
    ? uniqueValid(input.hiddenCategoryIds, allCategoryIds)
    : [...DEFAULT_HIDDEN_CATEGORY_IDS]

  // 「推荐」已改为动态栏位（不进注册表）：旧数据中的 recommend id 由 uniqueValid 自然剔除
  const categoryOrder = uniqueValid(input.categoryOrder, allCategoryIds)

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
    categoryOrder,
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
    prestore: normalizePrestorePrefs(input.prestore),
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
