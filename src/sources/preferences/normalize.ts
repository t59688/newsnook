import { normalizeCatalogProfile, normalizeFrameworkHint, preserveFutureCatalogProfile } from '../../features/siteCatalog/profile'
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
import { normalizeReadAloudPrefs } from '../../features/readAloud/config'
import { normalizeProxyPrefs } from '../../features/proxy/config'
import { normalizeRssHubInstances } from '../../features/rsshub/instances'
import {
  CATEGORIES,
  CATEGORY_TAXONOMY_VERSION,
  DEFAULT_PRESET_CATEGORY_SOURCES,
  isReservedCategoryLabel,
  type CategoryId,
  type NewsCategory,
} from '../categories'
import {
  SOURCES,
  canonicalSourceId,
  makeCustomSourceId,
  normalizeSourceKind,
  type NewsSource,
  type SourceDiscoveryMetadata,
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
  type CategoryNameOverride,
  type Preferences,
  type TypographyPrefs,
} from './model'
import { describeSources } from './categoryPrefs'
import { migrateLegacyCategoryLayout } from '../taxonomyMigration'

function normalizeDiscoveryMetadata(raw: unknown): SourceDiscoveryMetadata | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Partial<SourceDiscoveryMetadata>
  const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : ''
  const entryId = typeof input.entryId === 'string' ? input.entryId.trim() : ''
  const generator = input.generator
  if (!providerId || !entryId || !['rsshub', 'rss-bridge', 'feed', 'opml'].includes(String(generator))) {
    return undefined
  }
  const params: Record<string, string | number | boolean> = {}
  if (input.params && typeof input.params === 'object') {
    Object.entries(input.params).forEach(([key, value]) => {
      if (!key || key.length > 120) return
      // Authorization must never be duplicated into ordinary synced discovery metadata.
      if (generator === 'rsshub' && /(?:token|secret|password|passwd|cookie|api.?key|auth|credential)/i.test(key)) return
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        params[key] = value
      }
    })
  }
  return {
    providerId,
    entryId,
    generator: generator as SourceDiscoveryMetadata['generator'],
    instanceId: typeof input.instanceId === 'string' && input.instanceId.trim() ? input.instanceId.trim() : undefined,
    routeKey: typeof input.routeKey === 'string' && input.routeKey.trim() ? input.routeKey.trim() : undefined,
    params: Object.keys(params).length ? params : undefined,
    verification:
      input.verification && typeof input.verification === 'object' &&
      (input.verification.status === 'verified' || input.verification.status === 'unverified')
        ? {
            status: input.verification.status,
            checkedAt:
              typeof input.verification.checkedAt === 'number'
                ? input.verification.checkedAt
                : undefined,
          }
        : undefined,
  }
}

function uniqueValidSourceIds(raw: unknown, knownSourceIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return []
  const valid = raw
    .filter((id): id is string => typeof id === 'string')
    .map(canonicalSourceId)
    .filter((id) => knownSourceIds.has(id))
  return [...new Set(valid)]
}

/** 读入持久化数据时剔除已下线的分类与信源，避免脏配置导致空列表 */
export function normalizePreferences(raw: unknown): Preferences {
  const isFreshInstall = raw == null
  const migrated = isFreshInstall ? (raw ?? {}) : migrateLegacyCategoryLayout(raw).value
  const input = migrated as Partial<Preferences>
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
      const kind = normalizeSourceKind(typeof item.kind === 'string' ? item.kind : undefined)
      if (kind === 'web-catalog') {
        try {
          const url = new URL(rawUrl)
          if (!/^https?:$/.test(url.protocol) || url.username || url.password) return
        } catch { return }
      }

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
        kind,
        url: rawUrl,
        siteUrl: rawSiteUrl,
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        isCustom: true,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        paused: item.paused === true,
        discovery: normalizeDiscoveryMetadata(item.discovery),
      }
      source.catalogProfileOpaque = preserveFutureCatalogProfile(item.catalogProfile ?? item.catalogProfileOpaque, source.url)
      source.catalogProfile = normalizeCatalogProfile(item.catalogProfile, source.url)
      source.frameworkHint = normalizeFrameworkHint(item.frameworkHint, source.url)

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

      const sourceIds = uniqueValidSourceIds(item.sourceIds, knownSourceIds)
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
  if (input.categorySources == null) {
    Object.assign(categorySources, DEFAULT_PRESET_CATEGORY_SOURCES)
  } else {
    Object.entries(input.categorySources).forEach(([categoryId, sourceIds]) => {
      if (!allCategoryIds.has(categoryId) || isAggregateCategoryId(categoryId)) return
      const valid = uniqueValidSourceIds(sourceIds, knownSourceIds)
      categorySources[categoryId] = valid
    })
  }

  const categoryNames: Record<CategoryId, CategoryNameOverride> = {}
  if (input.categoryNames && typeof input.categoryNames === 'object') {
    const builtinIds = new Set(CATEGORIES.map((category) => category.id))
    Object.entries(input.categoryNames).forEach(([categoryId, value]) => {
      if (!builtinIds.has(categoryId) || !value || typeof value !== 'object') return
      const override = value as Partial<CategoryNameOverride>
      const label = typeof override.label === 'string' ? override.label.trim().slice(0, 16) : ''
      if (!label || isReservedCategoryLabel(label)) return
      const short =
        typeof override.short === 'string' && override.short.trim()
          ? override.short.trim().slice(0, 6)
          : label.slice(0, 6)
      if (isReservedCategoryLabel(short)) return
      categoryNames[categoryId] = { label, short }
    })
  }

  // 缺省键 → 当前 taxonomy 默认预设隐藏策略；显式 [] 表示当前布局选择「全部显示」。
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
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder,
    // 至少保留一个可见分类，否则首页无内容可选
    hiddenCategoryIds: hidden.length >= allCategoryIds.size ? hidden.slice(1) : hidden,
    categorySources,
    categoryNames,
    favoriteSourceIds: uniqueValidSourceIds(input.favoriteSourceIds, knownSourceIds),
    customCategories,
    customSources,
    theme: isThemeMode(input.theme) ? input.theme : DEFAULT_THEME_MODE,
    scheme,
    customScheme,
    // 新装没有任何持久化偏好时启用新版双栏；旧安装/旧备份缺字段时保持经典单栏，避免升级后突变。
    homeFeedLayout:
      input.homeFeedLayout === 'classic' || input.homeFeedLayout === 'cards'
        ? input.homeFeedLayout
        : isFreshInstall
          ? 'cards'
          : 'classic',
    translation: normalizeTranslationPrefs(input.translation),
    readAloud: normalizeReadAloudPrefs(input.readAloud),
    proxy: normalizeProxyPrefs(input.proxy),
    rsshubInstances: normalizeRssHubInstances(input.rsshubInstances),
    autoRefreshOnCategorySwitch:
      typeof input.autoRefreshOnCategorySwitch === 'boolean'
        ? input.autoRefreshOnCategorySwitch
        : true,
    // 旧数据无此字段（含旧备份导入）时默认开启推荐栏
    recommendEnabled:
      typeof input.recommendEnabled === 'boolean' ? input.recommendEnabled : true,
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
