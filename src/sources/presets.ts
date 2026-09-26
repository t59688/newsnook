/**
 * 场景预设：分类顺序/显隐/自建分类/信源覆盖 + 综合频道启用的完整快照。
 * 运行态仍是 preferences + enabled；本模块负责快照库与互转。
 */

import {
  CATEGORIES,
  CATEGORY_TAXONOMY_VERSION,
  findCategory,
  type CategoryId,
  type NewsCategory,
} from './categories'
import {
  describeSources,
  FOLLOWS_ENABLED_SOURCES,
  isAggregateCategoryId,
  type Preferences,
  type CategoryNameOverride,
} from './preferences'
import { canonicalSourceId, isCustomSourceId, SOURCES } from './registry'
import { legacyBuiltinPresetName, migrateLegacyCategoryLayout } from './taxonomyMigration'

export const MIGRATE_LAYOUT_PRESET_ID = 'user-migrated-layout'
export const USER_DEFAULT_LAYOUT_ID = 'user-default-layout'
export const PRESETS_SCHEMA_VERSION = 2

export const BUILTIN_DEFAULT_ID = 'builtin-v2-cn'
export const BUILTIN_CHINA_ID = BUILTIN_DEFAULT_ID
export const BUILTIN_WORLD_ID = 'builtin-v2-world'
export const BUILTIN_BIZ_ID = 'builtin-v2-biz'
export const BUILTIN_TECH_ID = 'builtin-v2-tech'
export const BUILTIN_AI_ID = 'builtin-v2-ai'
export const BUILTIN_SCIENCE_ID = 'builtin-v2-science'
export const BUILTIN_DEPTH_ID = 'builtin-v2-depth'
export const BUILTIN_LIFE_ID = 'builtin-v2-life'

export interface LayoutSnapshot {
  categoryTaxonomyVersion: number
  categoryOrder: CategoryId[]
  hiddenCategoryIds: CategoryId[]
  categorySources: Record<CategoryId, string[]>
  /** 当前预设的内置分类显示名覆盖；旧快照缺省为空 */
  categoryNames?: Record<CategoryId, CategoryNameOverride>
  customCategories: NewsCategory[]
  enabledSourceIds: string[]
  /** 当前预设收藏的信源；旧快照缺省为空 */
  favoriteSourceIds?: string[]
}

export interface LayoutPreset {
  id: string
  name: string
  description?: string
  builtin: boolean
  /** 应用该内置后衍生的用户副本可标记来源 */
  basedOnBuiltinId?: string
  snapshot: LayoutSnapshot
  updatedAt: number
}

export interface PresetsState {
  schemaVersion: number
  activePresetId: string
  userPresets: LayoutPreset[]
  /** 用户对内置预设的就地修改；与出厂相同则不出现在此表 */
  builtinOverrides: Record<string, LayoutSnapshot>
}

const KNOWN_SOURCE_IDS = new Set(SOURCES.map((source) => source.id))
const BUILTIN_CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id))

function uniqueValid(ids: unknown, known: Set<string>): string[] {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((id): id is string => typeof id === 'string' && known.has(id))
  return [...new Set(valid)]
}

/** 自建源 id 不在内置注册表里，快照仍需保留，否则分类卡片会变成「未选择信源」 */
function uniqueValidSourceIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const valid = ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => (isCustomSourceId(id) ? id : canonicalSourceId(id)))
    .filter((id) => KNOWN_SOURCE_IDS.has(id) || isCustomSourceId(id))
  return [...new Set(valid)]
}

function normalizeCustomCategories(raw: unknown): NewsCategory[] {
  if (!Array.isArray(raw)) return []
  const result: NewsCategory[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Partial<NewsCategory>
    const rawId = typeof record.id === 'string' ? record.id.trim() : ''
    const rawLabel = typeof record.label === 'string' ? record.label.trim() : ''
    const rawShort = typeof record.short === 'string' ? record.short.trim() : ''
    if (!rawId || !rawLabel) continue
    const sourceIds = uniqueValidSourceIds(record.sourceIds)
    if (!sourceIds.length) continue
    result.push({
      id: rawId,
      label: rawLabel,
      short: rawShort || rawLabel.slice(0, 4),
      caption: describeSources(sourceIds),
      sourceIds,
      isCustom: true,
    })
  }
  return result
}

export function normalizeSnapshot(raw: unknown): LayoutSnapshot {
  const migrated = migrateLegacyCategoryLayout(raw).value
  const input = migrated as Partial<LayoutSnapshot>
  const customCategories = normalizeCustomCategories(input.customCategories)
  const allCategoryIds = new Set([
    ...BUILTIN_CATEGORY_IDS,
    ...customCategories.map((category) => category.id),
  ])

  const categorySources: Record<CategoryId, string[]> = {}
  Object.entries(input.categorySources ?? {}).forEach(([categoryId, sourceIds]) => {
    if (!allCategoryIds.has(categoryId) || isAggregateCategoryId(categoryId)) return
    const valid = uniqueValidSourceIds(sourceIds)
    categorySources[categoryId] = valid
  })

  const categoryNames: Record<CategoryId, CategoryNameOverride> = {}
  Object.entries(input.categoryNames ?? {}).forEach(([categoryId, value]) => {
    if (!BUILTIN_CATEGORY_IDS.has(categoryId) || !value || typeof value !== 'object') return
    const override = value as Partial<CategoryNameOverride>
    const label = typeof override.label === 'string' ? override.label.trim().slice(0, 16) : ''
    if (!label) return
    const short =
      typeof override.short === 'string' && override.short.trim()
        ? override.short.trim().slice(0, 6)
        : label.slice(0, 6)
    categoryNames[categoryId] = { label, short }
  })

  // 「推荐」已改为动态栏位（不进注册表）：旧快照中的 recommend id 由 uniqueValid 自然剔除
  const hidden = uniqueValid(input.hiddenCategoryIds, allCategoryIds)
  const categoryOrder = uniqueValid(input.categoryOrder, allCategoryIds)
  return {
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder,
    hiddenCategoryIds: hidden.length >= allCategoryIds.size ? hidden.slice(1) : hidden,
    categorySources,
    categoryNames,
    customCategories,
    enabledSourceIds: uniqueValidSourceIds(input.enabledSourceIds),
    favoriteSourceIds: uniqueValidSourceIds(input.favoriteSourceIds),
  }
}

export function snapshotFromRuntime(
  prefs: Preferences,
  enabledSourceIds: string[],
): LayoutSnapshot {
  return normalizeSnapshot({
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder: prefs.categoryOrder,
    hiddenCategoryIds: prefs.hiddenCategoryIds,
    categorySources: prefs.categorySources,
    categoryNames: prefs.categoryNames ?? {},
    customCategories: prefs.customCategories ?? [],
    enabledSourceIds,
    favoriteSourceIds: prefs.favoriteSourceIds,
  })
}

/** 只改布局四字段，保留 typography / theme / translation */
export function applySnapshotToPrefs(prefs: Preferences, snapshot: LayoutSnapshot): Preferences {
  const normalized = normalizeSnapshot(snapshot)
  return {
    ...prefs,
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder: normalized.categoryOrder,
    hiddenCategoryIds: normalized.hiddenCategoryIds,
    categorySources: normalized.categorySources,
    categoryNames: normalized.categoryNames ?? {},
    customCategories: normalized.customCategories,
    favoriteSourceIds: normalized.favoriteSourceIds ?? [],
  }
}

/** Built-in presets hide every category outside their own preset-local partition. */
function hiddenExcept(visibleIds: CategoryId[]): CategoryId[] {
  const visible = new Set(visibleIds)
  return CATEGORIES.map((category) => category.id).filter((id) => !visible.has(id))
}

/** 只保留仍注册的 id，避免预设常量写死已下线源 */
function pickKnown(...ids: string[]): string[] {
  return ids.filter((id) => KNOWN_SOURCE_IDS.has(id))
}

function builtinPreset(
  id: string,
  name: string,
  description: string,
  snapshot: LayoutSnapshot,
): LayoutPreset {
  return {
    id,
    name,
    description,
    builtin: true,
    snapshot: normalizeSnapshot(snapshot),
    updatedAt: 0,
  }
}

/**
 * 内置场景包原则：
 * - 可见栏顺序即阅读优先级；中文栏整组在前，外刊栏整组在后
 * - **同一预设内，任意分类的 sourceId 互斥**
 * - 内置预设全部隐藏综合，enabledSourceIds 为空；空白自定义预设仍从综合起
 * - 足球/手机/数码/汽车等 solo 轨默认隐藏，由预设 categorySources 并入主题栏
 */

/** 主题分类（非综合）已占用的信源 */
export function themeAssignedSourceIds(
  categorySources: Record<string, string[]>,
): Set<string> {
  const assigned = new Set<string>()
  for (const [categoryId, sourceIds] of Object.entries(categorySources)) {
    if (categoryId === FOLLOWS_ENABLED_SOURCES) continue
    for (const sourceId of sourceIds) assigned.add(sourceId)
  }
  return assigned
}

/** 综合启用列表：去掉已落入主题分类的源，保证与主题栏互斥 */
export function exclusiveEnabledSourceIds(
  categorySources: Record<string, string[]>,
  enabledSourceIds: string[],
): string[] {
  const theme = themeAssignedSourceIds(categorySources)
  return enabledSourceIds.filter((id) => !theme.has(id))
}

/** 检查主题栏信源是否跨分类重复；返回重复的 sourceId（已排序） */
export function duplicateSourcesAcrossCategories(
  categorySources: Record<string, string[]>,
): string[] {
  const seen = new Map<string, string>()
  const dupes = new Set<string>()
  for (const [categoryId, sourceIds] of Object.entries(categorySources)) {
    if (categoryId === FOLLOWS_ENABLED_SOURCES) continue
    for (const sourceId of sourceIds) {
      const prev = seen.get(sourceId)
      if (prev && prev !== categoryId) dupes.add(sourceId)
      else seen.set(sourceId, categoryId)
    }
  }
  return [...dupes].sort()
}

/** 综合启用与主题栏的交集（应为空） */
export function mixThemeOverlap(
  categorySources: Record<string, string[]>,
  enabledSourceIds: string[],
): string[] {
  const theme = themeAssignedSourceIds(categorySources)
  return enabledSourceIds.filter((id) => theme.has(id)).sort()
}

function builtinPresetFromCategories(
  id: string,
  name: string,
  description: string,
  visible: CategoryId[],
): LayoutPreset {
  const categorySources = Object.fromEntries(
    visible.map((categoryId) => [categoryId, pickKnown(...(findCategory(categoryId).sourceIds ?? []))]),
  )
  return builtinPreset(id, name, description, {
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder: visible,
    hiddenCategoryIds: hiddenExcept(visible),
    categorySources,
    customCategories: [],
    enabledSourceIds: [],
    favoriteSourceIds: [],
  })
}

/**
 * Taxonomy v3 built-ins.
 *
 * Each category belongs to exactly one preset. Because category sourceIds are also globally unique,
 * built-in presets form a partition of all non-workspace sources instead of overlapping "modes".
 */
export const BUILTIN_PRESETS: readonly LayoutPreset[] = [
  builtinPresetFromCategories(
    BUILTIN_CHINA_ID,
    '中国资讯',
    '国内要闻、独家精选、公共议题、人物、观点与外部观察',
    ['cn-headlines', 'cn-select', 'cn-public', 'cn-dialogue', 'cn-opinion', 'cn-external'],
  ),
  builtinPresetFromCategories(
    BUILTIN_WORLD_ID,
    '全球视野',
    '中英文公共媒体、报刊通讯、亚太新闻与国际评论',
    ['world-zh', 'world-zh-press', 'world-news', 'world-news-press', 'world-asia', 'world-opinion'],
  ),
  builtinPresetFromCategories(
    BUILTIN_BIZ_ID,
    '财经商业',
    '市场、财经、商业媒体、创业创投、产业评论与全球商业',
    ['biz-market', 'biz-finance', 'biz-company', 'biz-startup', 'biz-industry', 'biz-global'],
  ),
  builtinPresetFromCategories(
    BUILTIN_TECH_ID,
    '科技数码',
    '消费数码、科技产业、技术资讯、软件效率与开发者内容',
    ['tech-digital', 'tech-media', 'tech-news', 'tech-tools', 'tech-dev', 'tech-longform'],
  ),
  builtinPresetFromCategories(
    BUILTIN_AI_ID,
    'AI 前沿',
    '模型实验室、AI 媒体、实践、研究与长期观察',
    [
      'ai-media-cn',
      'ai-thinking',
      'ai-labs',
      'ai-ecosystem',
      'ai-practice',
      'ai-media-en',
      'ai-engineering',
      'ai-watch',
    ],
  ),
  builtinPresetFromCategories(
    BUILTIN_SCIENCE_ID,
    '科学知识',
    '科学、科研、基础科学、地球系统与健康医学',
    ['science-general', 'science-research', 'science-basic', 'science-earth', 'science-health'],
  ),
  builtinPresetFromCategories(
    BUILTIN_DEPTH_ID,
    '深度人文',
    '深度报道、中文精选、海外思想长文与教育历史文化',
    ['depth-reporting', 'depth-books', 'depth-knowledge', 'depth-culture', 'depth-blogs'],
  ),
  builtinPresetFromCategories(
    BUILTIN_LIFE_ID,
    '文体生活',
    '体育、娱乐、游戏、轻松内容与旅行出行',
    [
      'life-sports',
      'life-basketball',
      'life-football',
      'life-running',
      'life-ent',
      'life-games',
      'life-fun',
      'life-travel',
    ],
  ),
]

export function duplicateCategoriesAcrossBuiltins(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const preset of BUILTIN_PRESETS) {
    for (const categoryId of preset.snapshot.categoryOrder) {
      if (preset.snapshot.hiddenCategoryIds.includes(categoryId)) continue
      if (seen.has(categoryId)) duplicates.add(categoryId)
      else seen.add(categoryId)
    }
  }
  return [...duplicates].sort()
}

export function duplicateSourcesAcrossBuiltins(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const preset of BUILTIN_PRESETS) {
    for (const [categoryId, sourceIds] of Object.entries(preset.snapshot.categorySources)) {
      if (preset.snapshot.hiddenCategoryIds.includes(categoryId)) continue
      for (const sourceId of sourceIds) {
        if (seen.has(sourceId)) duplicates.add(sourceId)
        else seen.add(sourceId)
      }
    }
  }
  return [...duplicates].sort()
}

export function unassignedBuiltinPresetSourceIds(): string[] {
  const assigned = new Set<string>()
  for (const preset of BUILTIN_PRESETS) {
    Object.values(preset.snapshot.categorySources).forEach((sourceIds) => {
      sourceIds.forEach((sourceId) => assigned.add(sourceId))
    })
  }
  return SOURCES.filter((source) => !source.workspaceOnly && !assigned.has(source.id))
    .map((source) => source.id)
    .sort()
}

export function findBuiltinPreset(id: string): LayoutPreset | undefined {
  return BUILTIN_PRESETS.find((preset) => preset.id === id)
}

export function snapshotsEqual(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
  const left = normalizeSnapshot(a)
  const right = normalizeSnapshot(b)
  const sortSources = (snapshot: LayoutSnapshot) =>
    Object.fromEntries(
      Object.entries(snapshot.categorySources).sort(([x], [y]) => x.localeCompare(y)),
    )
  return (
    JSON.stringify({ ...left, categorySources: sortSources(left) }) ===
    JSON.stringify({ ...right, categorySources: sortSources(right) })
  )
}

export function emptyLayoutSnapshot(): LayoutSnapshot {
  return normalizeSnapshot({
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder: ['mix'],
    hiddenCategoryIds: hiddenExcept(['mix']),
    categorySources: {},
    customCategories: [],
    enabledSourceIds: [],
    favoriteSourceIds: [],
  })
}

export function emptyPresetsState(): PresetsState {
  return {
    schemaVersion: PRESETS_SCHEMA_VERSION,
    activePresetId: BUILTIN_DEFAULT_ID,
    userPresets: [],
    builtinOverrides: {},
  }
}

function builtinOverridesOf(state: PresetsState): Record<string, LayoutSnapshot> {
  return state.builtinOverrides ?? {}
}

export function isBuiltinOverridden(state: PresetsState, id: string): boolean {
  return Boolean(findBuiltinPreset(id) && builtinOverridesOf(state)[id])
}

export function resolvePreset(state: PresetsState, id: string): LayoutPreset | undefined {
  const builtin = findBuiltinPreset(id)
  if (builtin) {
    const overlay = builtinOverridesOf(state)[id]
    return overlay ? { ...builtin, snapshot: normalizeSnapshot(overlay) } : builtin
  }
  return state.userPresets.find((preset) => preset.id === id)
}

export function listAllPresets(userPresets: LayoutPreset[]): LayoutPreset[] {
  return [...BUILTIN_PRESETS, ...userPresets]
}

export function listResolvedBuiltins(state: PresetsState): LayoutPreset[] {
  return BUILTIN_PRESETS.map((preset) => resolvePreset(state, preset.id) ?? preset)
}

function newUserPresetId(prefix = 'user'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function userPresetFromSnapshot(
  id: string,
  name: string,
  snapshot: LayoutSnapshot,
  extras?: Partial<Pick<LayoutPreset, 'description' | 'basedOnBuiltinId'>>,
): LayoutPreset {
  return {
    id,
    name,
    description: extras?.description,
    basedOnBuiltinId: extras?.basedOnBuiltinId,
    builtin: false,
    snapshot: normalizeSnapshot(snapshot),
    updatedAt: Date.now(),
  }
}

function withOverride(
  state: PresetsState,
  builtinId: string,
  snapshot: LayoutSnapshot,
): PresetsState {
  const factory = findBuiltinPreset(builtinId)
  if (!factory) return state
  const normalized = normalizeSnapshot(snapshot)
  const builtinOverrides = { ...builtinOverridesOf(state) }
  if (snapshotsEqual(normalized, factory.snapshot)) {
    delete builtinOverrides[builtinId]
  } else {
    builtinOverrides[builtinId] = normalized
  }
  return { ...state, builtinOverrides }
}

export function buildMigratedPresetsState(
  prefs: Preferences,
  enabledSourceIds: string[],
): PresetsState {
  const preset = userPresetFromSnapshot(
    MIGRATE_LAYOUT_PRESET_ID,
    '升级前布局',
    snapshotFromRuntime(prefs, enabledSourceIds),
    { description: '升级前正在使用的布局，已完整保留为自定义预设' },
  )
  return {
    schemaVersion: PRESETS_SCHEMA_VERSION,
    activePresetId: preset.id,
    userPresets: [preset],
    builtinOverrides: {},
  }
}

export function buildFreshInstallPresetsState(): PresetsState {
  return emptyPresetsState()
}

export function saveAsUserPreset(
  state: PresetsState,
  snapshot: LayoutSnapshot,
  name: string,
  description?: string,
  basedOnBuiltinId?: string,
): { state: PresetsState; preset: LayoutPreset } {
  const preset = userPresetFromSnapshot(newUserPresetId(), name.trim() || '未命名预设', snapshot, {
    description,
    basedOnBuiltinId,
  })
  return {
    preset,
    state: {
      ...state,
      activePresetId: preset.id,
      userPresets: [...state.userPresets, preset],
    },
  }
}

export function createBlankUserPreset(
  state: PresetsState,
  name: string,
): { state: PresetsState; preset: LayoutPreset } {
  return saveAsUserPreset(state, emptyLayoutSnapshot(), name.trim() || '未命名预设')
}

export function updateUserPresetSnapshot(
  state: PresetsState,
  presetId: string,
  snapshot: LayoutSnapshot,
): PresetsState {
  if (findBuiltinPreset(presetId)) return state
  const index = state.userPresets.findIndex((preset) => preset.id === presetId)
  if (index < 0) return state
  const next = [...state.userPresets]
  next[index] = {
    ...next[index],
    snapshot: normalizeSnapshot(snapshot),
    updatedAt: Date.now(),
  }
  return { ...state, userPresets: next }
}

/** 写回当前激活项：内置走覆盖层，用户预设改 snapshot */
export function updateActiveSnapshot(state: PresetsState, snapshot: LayoutSnapshot): PresetsState {
  if (findBuiltinPreset(state.activePresetId)) {
    return withOverride(state, state.activePresetId, snapshot)
  }
  return updateUserPresetSnapshot(state, state.activePresetId, snapshot)
}

export function renameUserPreset(state: PresetsState, presetId: string, name: string): PresetsState {
  if (findBuiltinPreset(presetId)) return state
  const trimmed = name.trim()
  if (!trimmed) return state
  const index = state.userPresets.findIndex((preset) => preset.id === presetId)
  if (index < 0) return state
  const next = [...state.userPresets]
  next[index] = { ...next[index], name: trimmed, updatedAt: Date.now() }
  return { ...state, userPresets: next }
}

export function deleteUserPreset(state: PresetsState, presetId: string): PresetsState {
  if (findBuiltinPreset(presetId)) return state
  const userPresets = state.userPresets.filter((preset) => preset.id !== presetId)
  if (userPresets.length === state.userPresets.length) return state

  if (state.activePresetId !== presetId) {
    return { ...state, userPresets }
  }

  const fallback = userPresets[0]
  if (fallback) {
    return { ...state, activePresetId: fallback.id, userPresets }
  }

  return { ...state, activePresetId: BUILTIN_DEFAULT_ID, userPresets: [] }
}

export function activatePreset(
  state: PresetsState,
  presetId: string,
): { state: PresetsState; snapshot: LayoutSnapshot } | undefined {
  const preset = resolvePreset(state, presetId)
  if (!preset) return undefined
  return {
    snapshot: normalizeSnapshot(preset.snapshot),
    state: { ...state, activePresetId: preset.id },
  }
}

export function restoreBuiltinFactory(
  state: PresetsState,
  presetId: string,
): { state: PresetsState; snapshot: LayoutSnapshot; applied: boolean } | undefined {
  const builtin = findBuiltinPreset(presetId)
  if (!builtin) return undefined
  const builtinOverrides = { ...builtinOverridesOf(state) }
  delete builtinOverrides[presetId]
  return {
    snapshot: builtin.snapshot,
    applied: state.activePresetId === presetId,
    state: { ...state, builtinOverrides },
  }
}

export function ensureValidActivePreset(state: PresetsState): PresetsState {
  if (resolvePreset(state, state.activePresetId)) {
    return { ...state, builtinOverrides: builtinOverridesOf(state) }
  }
  return { ...state, activePresetId: BUILTIN_DEFAULT_ID, builtinOverrides: builtinOverridesOf(state) }
}

function legacyFoldTarget(preset: LayoutPreset): string | undefined {
  if (!preset.basedOnBuiltinId) return undefined
  const builtin = findBuiltinPreset(preset.basedOnBuiltinId)
  if (builtin && preset.name === builtin.name) return builtin.id
  return undefined
}

/** 把旧版 copy-on-write 副本折进对应内置覆盖层 */
export function foldLegacyWritableCopies(state: PresetsState): PresetsState {
  const foldablesByBuiltin = new Map<string, LayoutPreset[]>()
  const remaining: LayoutPreset[] = []

  for (const preset of state.userPresets) {
    const target = legacyFoldTarget(preset)
    if (!target) {
      remaining.push(preset)
      continue
    }
    const list = foldablesByBuiltin.get(target) ?? []
    list.push(preset)
    foldablesByBuiltin.set(target, list)
  }

  let next: PresetsState = {
    ...state,
    userPresets: remaining,
    builtinOverrides: { ...builtinOverridesOf(state) },
  }

  for (const [builtinId, foldables] of foldablesByBuiltin) {
    const pick =
      foldables.find((preset) => preset.id === state.activePresetId) ??
      foldables.reduce((latest, preset) => (preset.updatedAt >= latest.updatedAt ? preset : latest))
    if (!next.builtinOverrides[builtinId]) {
      next = withOverride(next, builtinId, pick.snapshot)
    }
    if (foldables.some((preset) => preset.id === next.activePresetId)) {
      next = { ...next, activePresetId: builtinId }
    }
  }

  return ensureValidActivePreset(next)
}

function normalizeBuiltinOverrides(raw: unknown): Record<string, LayoutSnapshot> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, LayoutSnapshot> = {}
  for (const [id, snapshot] of Object.entries(raw as Record<string, unknown>)) {
    const factory = findBuiltinPreset(id)
    if (!factory) continue
    const normalized = normalizeSnapshot(snapshot)
    if (!snapshotsEqual(normalized, factory.snapshot)) {
      result[id] = normalized
    }
  }
  return result
}

function migrateLegacyPresetsState(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.schemaVersion === PRESETS_SCHEMA_VERSION) return { ...raw }

  const userPresets = Array.isArray(raw.userPresets)
    ? raw.userPresets.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item
        const record = item as Record<string, unknown>
        return {
          ...record,
          snapshot: migrateLegacyCategoryLayout(record.snapshot).value,
        }
      })
    : []

  const existingIds = new Set(
    userPresets
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      )
      .map((item) => (typeof item.id === 'string' ? item.id : ''))
      .filter(Boolean),
  )

  let activePresetId =
    typeof raw.activePresetId === 'string' && raw.activePresetId
      ? raw.activePresetId
      : BUILTIN_DEFAULT_ID
  const builtinOverrides: Record<string, unknown> = {}
  const rawOverrides =
    raw.builtinOverrides && typeof raw.builtinOverrides === 'object' && !Array.isArray(raw.builtinOverrides)
      ? (raw.builtinOverrides as Record<string, unknown>)
      : {}

  for (const [legacyId, snapshot] of Object.entries(rawOverrides)) {
    const legacyName = legacyBuiltinPresetName(legacyId)
    if (!legacyName) {
      if (findBuiltinPreset(legacyId)) builtinOverrides[legacyId] = snapshot
      continue
    }

    let migratedId = `legacy-override-${legacyId}`
    let suffix = 2
    while (existingIds.has(migratedId)) {
      migratedId = `legacy-override-${legacyId}-${suffix}`
      suffix += 1
    }
    existingIds.add(migratedId)
    userPresets.push({
      id: migratedId,
      name: `旧布局 · ${legacyName}`,
      description: '升级前修改过的内置预设，已保留为自定义布局',
      builtin: false,
      snapshot: migrateLegacyCategoryLayout(snapshot).value,
      updatedAt: 0,
    })
    if (activePresetId === legacyId) activePresetId = migratedId
  }

  // Unmodified legacy built-ins are intentionally replaced by the new taxonomy default.
  if (legacyBuiltinPresetName(activePresetId)) activePresetId = BUILTIN_DEFAULT_ID

  return {
    ...raw,
    schemaVersion: PRESETS_SCHEMA_VERSION,
    activePresetId,
    userPresets,
    builtinOverrides,
  }
}

export function normalizePresetsState(raw: unknown): PresetsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const migrated = migrateLegacyPresetsState(raw as Record<string, unknown>)
  const input = migrated as Partial<PresetsState>
  if (typeof input.activePresetId !== 'string' || !input.activePresetId) return null
  if (!Array.isArray(input.userPresets)) return null

  const userPresets: LayoutPreset[] = []
  for (const item of input.userPresets) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.id !== 'string' || !item.id) continue
    if (typeof item.name !== 'string' || !item.name.trim()) continue
    if (item.builtin) continue
    userPresets.push({
      id: item.id,
      name: item.name.trim(),
      description: typeof item.description === 'string' ? item.description : undefined,
      basedOnBuiltinId:
        typeof item.basedOnBuiltinId === 'string' ? item.basedOnBuiltinId : undefined,
      builtin: false,
      snapshot: normalizeSnapshot(item.snapshot),
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    })
  }

  return foldLegacyWritableCopies({
    schemaVersion: PRESETS_SCHEMA_VERSION,
    activePresetId: input.activePresetId,
    userPresets,
    builtinOverrides: normalizeBuiltinOverrides(input.builtinOverrides),
  })
}
