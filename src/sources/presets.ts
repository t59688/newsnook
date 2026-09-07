/**
 * 场景预设：分类顺序/显隐/自建分类/信源覆盖 + 综合频道启用的完整快照。
 * 运行态仍是 preferences + enabled；本模块负责快照库与互转。
 */

import {
  CATEGORIES,
  PORTAL_CATEGORY_SOURCES,
  PORTAL_VISIBLE_CATEGORY_IDS,
  type CategoryId,
  type NewsCategory,
} from './categories'
import {
  describeSources,
  FOLLOWS_ENABLED_SOURCES,
  isAggregateCategoryId,
  type Preferences,
} from './preferences'
import { isCustomSourceId, SOURCES } from './registry'

export const MIGRATE_LAYOUT_PRESET_ID = 'user-migrated-layout'
export const USER_DEFAULT_LAYOUT_ID = 'user-default-layout'

export const BUILTIN_DEFAULT_ID = 'builtin-default'
export const BUILTIN_TECH_ID = 'builtin-tech'
export const BUILTIN_BIZ_ID = 'builtin-biz'
export const BUILTIN_WORLD_ID = 'builtin-world'
export const BUILTIN_DEPTH_ID = 'builtin-depth'
export const BUILTIN_MINDFUL_ID = 'builtin-mindful'
export const BUILTIN_FUN_ID = 'builtin-fun'

export interface LayoutSnapshot {
  categoryOrder: CategoryId[]
  hiddenCategoryIds: CategoryId[]
  categorySources: Record<CategoryId, string[]>
  customCategories: NewsCategory[]
  enabledSourceIds: string[]
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
  const valid = ids.filter(
    (id): id is string =>
      typeof id === 'string' && (KNOWN_SOURCE_IDS.has(id) || isCustomSourceId(id)),
  )
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
  const input = (raw ?? {}) as Partial<LayoutSnapshot>
  const customCategories = normalizeCustomCategories(input.customCategories)
  const allCategoryIds = new Set([
    ...BUILTIN_CATEGORY_IDS,
    ...customCategories.map((category) => category.id),
  ])

  const categorySources: Record<CategoryId, string[]> = {}
  Object.entries(input.categorySources ?? {}).forEach(([categoryId, sourceIds]) => {
    if (!allCategoryIds.has(categoryId) || isAggregateCategoryId(categoryId)) return
    const valid = uniqueValidSourceIds(sourceIds)
    if (valid.length) categorySources[categoryId] = valid
  })

  // 「推荐」已改为动态栏位（不进注册表）：旧快照中的 recommend id 由 uniqueValid 自然剔除
  const hidden = uniqueValid(input.hiddenCategoryIds, allCategoryIds)
  const categoryOrder = uniqueValid(input.categoryOrder, allCategoryIds)
  return {
    categoryOrder,
    hiddenCategoryIds: hidden.length >= allCategoryIds.size ? hidden.slice(1) : hidden,
    categorySources,
    customCategories,
    enabledSourceIds: uniqueValidSourceIds(input.enabledSourceIds),
  }
}

export function snapshotFromRuntime(
  prefs: Preferences,
  enabledSourceIds: string[],
): LayoutSnapshot {
  return normalizeSnapshot({
    categoryOrder: prefs.categoryOrder,
    hiddenCategoryIds: prefs.hiddenCategoryIds,
    categorySources: prefs.categorySources,
    customCategories: prefs.customCategories ?? [],
    enabledSourceIds,
  })
}

/** 只改布局四字段，保留 typography / theme / translation */
export function applySnapshotToPrefs(prefs: Preferences, snapshot: LayoutSnapshot): Preferences {
  const normalized = normalizeSnapshot(snapshot)
  return {
    ...prefs,
    categoryOrder: normalized.categoryOrder,
    hiddenCategoryIds: normalized.hiddenCategoryIds,
    categorySources: normalized.categorySources,
    customCategories: normalized.customCategories,
  }
}

/**
 * 门户经典可见栏顺序见 categories.PORTAL_VISIBLE_CATEGORY_IDS。
 */
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

export const BUILTIN_PRESETS: readonly LayoutPreset[] = [
  (() => {
    const categorySources = Object.fromEntries(
      Object.entries(PORTAL_CATEGORY_SOURCES).map(([id, sourceIds]) => [id, pickKnown(...sourceIds)]),
    )
    const visible: CategoryId[] = [...PORTAL_VISIBLE_CATEGORY_IDS]
    return builtinPreset(
      BUILTIN_DEFAULT_ID,
      '全景门户',
      '中文要闻在前 · 外刊分栏靠后 · 无综合',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      'ai-media': pickKnown('qbitai', 'jiqizhixin', 'aiera', 'leiphone'),
      'ai-depth': pickKnown('zhidx', 'baoyu', 'xixiaoyao', '42zhangjing'),
      'ai-community': pickKnown('uisdc-aigc', 'v2ex', 'paperweekly', 'woshipm-ai'),
      tech: pickKnown(
        'sspai',
        'geekpark',
        'ithome',
        'solidot',
        'ruanyifeng',
        'appinn',
        'netease-phone',
        'netease-digital',
      ),
      science: pickKnown(
        'guokr',
        'pansci',
        'huanqiukexue',
        'zhishifenzi',
        'netease-fanpu',
        'netease-wuli',
        'swarma',
      ),
      'tech-depth': pickKnown('qianhei', 'ifanr', 'infoq-cn'),
      'ai-media-world': pickKnown(
        'mittr-ai',
        'verge-ai',
        'ieee-ai',
        'venturebeat-ai',
        'synced',
        'marktechpost',
      ),
      'ai-depth-world': pickKnown(
        'oneusefulthing',
        'latent-space',
        'understandingai',
        'thezvi',
        'lastweek-ai',
        'import-ai',
        'simonw',
        'interconnects',
        'lil-log',
        'ahead-of-ai',
      ),
      'ai-community-world': pickKnown('hn'),
      'tech-depth-world': pickKnown(
        'arstechnica',
        'mittr',
        'quanta',
        'stratechery',
        'vitalik',
        'paulgraham',
        'fabricated-knowledge',
        'construction-physics',
        'wired',
        'verge',
      ),
      'ai-openai': pickKnown('openai-news', 'openai-cookbook'),
      'ai-claude': pickKnown(
        'anthropic',
        'claude-blog',
        'claude-customers',
        'claude-academy-use-cases',
        'claude-academy-tutorials',
      ),
      ai: pickKnown('google-ai', 'deepmind', 'huggingface', 'pytorch', 'arena'),
    }
    const visible: CategoryId[] = [
      'ai-media',
      'ai-depth',
      'ai-community',
      'tech',
      'science',
      'tech-depth',
      'ai-media-world',
      'ai-depth-world',
      'ai-community-world',
      'tech-depth-world',
      'ai-openai',
      'ai-claude',
      'ai',
    ]
    return builtinPreset(
      BUILTIN_TECH_ID,
      '极客与 AI',
      '中文业界深读在前 · 外刊与官方实验室靠后',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      theue: pickKnown('theue'),
      intl: pickKnown('theinitium', 'bbc-zh', 'dw-top'),
      tech: pickKnown('v2ex', 'ruanyifeng', 'qianhei'),
      science: pickKnown('guokr', 'zhishifenzi', 'netease-fanpu', 'swarma'),
      'intl-world': pickKnown(
        'foreign-affairs',
        'nyrb',
        'bloomberg-opinion',
        'project-syndicate',
        'sinocism',
        'scmp-china',
      ),
      'tech-depth-world': pickKnown(
        'quanta',
        'stratechery',
        'vitalik',
        'paulgraham',
        'fabricated-knowledge',
        'construction-physics',
        'mittr',
      ),
      'astral-codex-ten': pickKnown('astral-codex-ten'),
      marginalian: pickKnown('marginalian'),
      aldaily: pickKnown('aldaily'),
    }
    const visible: CategoryId[] = [
      'theue',
      'intl',
      'tech',
      'science',
      'intl-world',
      'tech-depth-world',
      'astral-codex-ten',
      'marginalian',
      'aldaily',
    ]
    return builtinPreset(
      BUILTIN_DEPTH_ID,
      '深度智识',
      '中文深度叙事在前 · 思想外刊与专栏靠后',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      finance: pickKnown(
        'latepost',
        'jazzyear',
        'kr36',
        'huxiu',
        'tmtpost',
        'cls-telegraph',
        'eastmoney-kx',
        'wscn-live',
        'netease-biz',
        'netease-stock',
        'eastmoney-news',
      ),
      intl: pickKnown('theinitium', 'bbc-zh', 'dw-top'),
      tech: pickKnown('geekpark', 'sspai', 'ifanr', 'netease-auto'),
      'ai-media': pickKnown('qbitai', 'aiera', 'jiqizhixin'),
      'finance-world': pickKnown('techcrunch', 'bbc-business', 'gnews-business', 'stratechery'),
      'intl-world': pickKnown(
        'bloomberg-opinion',
        'project-syndicate',
        'scmp-china',
        'sinocism',
      ),
      'ai-media-world': pickKnown('venturebeat-ai', 'mittr-ai'),
    }
    const visible: CategoryId[] = [
      'finance',
      'intl',
      'tech',
      'ai-media',
      'finance-world',
      'intl-world',
      'ai-media-world',
    ]
    return builtinPreset(
      BUILTIN_BIZ_ID,
      '商业创投',
      '中文创投产业在前 · 外刊靠后 · 无综合',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      intl: pickKnown('theinitium', 'bbc-zh', 'dw-top', 'bbc-zh-world', 'bbc-zh-china'),
      hot: pickKnown('netease'),
      science: pickKnown('huanqiukexue', 'pansci', 'guokr', 'zhishifenzi'),
      'intl-world': pickKnown(
        'bbc-world',
        'npr',
        'guardian-world',
        'france24',
        'aljazeera',
        'scmp-china',
        'scmp-news',
        'foreign-affairs',
        'nyrb',
        'sinocism',
        'gnews-world',
      ),
      'tech-depth-world': pickKnown('quanta', 'mittr', 'wired', 'arstechnica', 'verge'),
      'science-world': pickKnown('gnews-science'),
    }
    const visible: CategoryId[] = [
      'intl',
      'hot',
      'science',
      'intl-world',
      'tech-depth-world',
      'science-world',
    ]
    return builtinPreset(
      BUILTIN_WORLD_ID,
      '全球视野',
      '中文国际科普在前 · 外刊广电智库靠后 · 无综合',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      science: pickKnown(
        'guokr',
        'pansci',
        'huanqiukexue',
        'zhishifenzi',
        'netease-fanpu',
        'netease-diqiu',
        'swarma',
      ),
      tech: pickKnown('sspai', 'ruanyifeng', 'appinn', 'v2ex', 'qianhei'),
      edu: pickKnown('netease-edu'),
      theue: pickKnown('theue'),
      zhihu: pickKnown('zhihu-daily'),
      blog: pickKnown('netease-blog'),
      fun: pickKnown('gcores', 'jandan'),
    }
    const visible: CategoryId[] = ['science', 'tech', 'edu', 'theue', 'zhihu', 'blog', 'fun']
    return builtinPreset(
      BUILTIN_MINDFUL_ID,
      '慢读知性',
      '科学人文 · 教育博客 · 全中文慢读',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
  (() => {
    const categorySources = {
      fun: pickKnown('netease-fun', 'jandan', 'gcores'),
      ent: pickKnown('netease-ent'),
      game: pickKnown('netease-game'),
      history: pickKnown('netease-history'),
      travel: pickKnown('netease-travel'),
      zhihu: pickKnown('zhihu-daily'),
      'ent-world': pickKnown('gnews-ent'),
    }
    const visible: CategoryId[] = ['fun', 'ent', 'game', 'history', 'travel', 'zhihu', 'ent-world']
    return builtinPreset(
      BUILTIN_FUN_ID,
      '摸鱼消遣',
      '轻松娱乐 · 游戏历史旅游 · 娱乐外刊靠后',
      {
        categoryOrder: visible,
        hiddenCategoryIds: hiddenExcept(visible),
        categorySources,
        customCategories: [],
        enabledSourceIds: [],
      },
    )
  })(),
]

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
    categoryOrder: ['mix'],
    hiddenCategoryIds: hiddenExcept(['mix']),
    categorySources: {},
    customCategories: [],
    enabledSourceIds: [],
  })
}

export function emptyPresetsState(): PresetsState {
  return { activePresetId: BUILTIN_DEFAULT_ID, userPresets: [], builtinOverrides: {} }
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
  return withOverride(
    emptyPresetsState(),
    BUILTIN_DEFAULT_ID,
    snapshotFromRuntime(prefs, enabledSourceIds),
  )
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
  if (preset.id === MIGRATE_LAYOUT_PRESET_ID || preset.id === USER_DEFAULT_LAYOUT_ID) {
    return BUILTIN_DEFAULT_ID
  }
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

export function normalizePresetsState(raw: unknown): PresetsState | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Partial<PresetsState>
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
    activePresetId: input.activePresetId,
    userPresets,
    builtinOverrides: normalizeBuiltinOverrides(input.builtinOverrides),
  })
}
