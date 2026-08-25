/**
 * 场景预设：分类顺序/显隐/自建分类/信源覆盖 + 综合频道启用的完整快照。
 * 运行态仍是 preferences + enabled；本模块负责快照库与互转。
 */

import { CATEGORIES, type CategoryId, type NewsCategory, PORTAL_VISIBLE_CATEGORY_IDS } from './categories'
import {
  describeSources,
  FOLLOWS_ENABLED_SOURCES,
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
    if (!allCategoryIds.has(categoryId) || categoryId === FOLLOWS_ENABLED_SOURCES) return
    const valid = uniqueValidSourceIds(sourceIds)
    if (valid.length) categorySources[categoryId] = valid
  })

  const hidden = uniqueValid(input.hiddenCategoryIds, allCategoryIds)
  return {
    categoryOrder: uniqueValid(input.categoryOrder, allCategoryIds),
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
function defaultEnabledIds(): string[] {
  return SOURCES.filter((source) => source.enabled).map((source) => source.id)
}

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
 * - 可见栏 5～10 个，顺序即阅读优先级
 * - 主题栏信源：1 主 + 1～2 辅（含至多 1 个 gnews）
 * - **同一预设内，任意分类的 sourceId 互斥**（主题栏互斥；综合 enabled 也不得与主题栏重复）
 * - 综合启用：仅收录未落入其他可见分类的源；若无独占源则隐藏综合
 * - AI / 游戏 / 深度等留给专题预设，不挤默认门户
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
    const categorySources = {
      hot: pickKnown('netease'),
      ent: pickKnown('netease-ent', 'gnews-ent'),
      sports: pickKnown('netease-sports', 'gnews-sports'),
      tech: pickKnown('netease-tech', 'ithome', 'sspai', 'geekpark'),
      finance: pickKnown(
        'cls-telegraph',
        'latepost',
        'kr36',
        'eastmoney-kx',
        'wscn-live',
        'bbc-business',
      ),
      intl: pickKnown('bbc-zh', 'dw-top', 'scmp-china', 'theinitium', 'gnews-world'),
      health: pickKnown('netease-health', 'gnews-health'),
      science: pickKnown('guokr', 'pansci', 'huanqiukexue', 'gnews-science'),
      fun: pickKnown('netease-fun', 'jandan'),
    }
    return builtinPreset(
      BUILTIN_DEFAULT_ID,
      '全景门户',
      '要闻娱乐 · 科技商业 · 国际科普 · 轻松收尾',
      {
        categoryOrder: [...PORTAL_VISIBLE_CATEGORY_IDS],
        hiddenCategoryIds: hiddenExcept([...PORTAL_VISIBLE_CATEGORY_IDS]),
        categorySources,
        customCategories: [],
        enabledSourceIds: exclusiveEnabledSourceIds(categorySources, defaultEnabledIds()),
      },
    )
  })(),
  (() => {
    /**
     * AI 启用集合刻意压到 10 个（一手 4 + 深度 6），避免默认全开刷屏：
     * - 一手：中文资讯双主力 + 实验室官方样例 + Arena 榜单
     * - 深度：中文解读/实测（含甄选公众号）+ 英文深度双栏
     * 其余 AI 源（OpenAI、周报、PaperWeekly、优设等）留在分类里可一键开启。
     */
    const categorySources = {
      ai: pickKnown('qbitai', 'jiqizhixin', 'anthropic', 'arena'),
      'ai-depth': pickKnown(
        'zhidx',
        'baoyu',
        'xixiaoyao',
        '42zhangjing',
        'oneusefulthing',
        'latent-space',
      ),
      'tech-depth': pickKnown(
        'arstechnica',
        'mittr',
        'quanta',
        'vitalik',
        'fabricated-knowledge',
        'construction-physics',
        'paulgraham',
        'hn',
      ),
      tech: pickKnown(
        'v2ex',
        'sspai',
        'geekpark',
        'solidot',
        'ruanyifeng',
        'appinn',
        'ithome',
      ),
      science: pickKnown('guokr', 'pansci', 'huanqiukexue', 'zhishifenzi'),
    }
    const visible: CategoryId[] = ['ai', 'ai-depth', 'tech-depth', 'tech', 'science']
    return builtinPreset(
      BUILTIN_TECH_ID,
      '极客与 AI',
      'AI 一手快讯 · 深度解读评测 · 极客创造 · 硬核科普',
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
      'tech-depth': pickKnown(
        'quanta',
        'stratechery',
        'vitalik',
        'fabricated-knowledge',
        'construction-physics',
        'paulgraham',
      ),
      intl: pickKnown(
        'foreign-affairs',
        'nyrb',
        'bloomberg-opinion',
        'project-syndicate',
        'sinocism',
        'theinitium',
      ),
      'astral-codex-ten': pickKnown('astral-codex-ten'),
      marginalian: pickKnown('marginalian'),
      aldaily: pickKnown('aldaily'),
      theue: pickKnown('theue'),
      tech: pickKnown('v2ex'),
    }
    const visible: CategoryId[] = [
      'tech-depth',
      'intl',
      'astral-codex-ten',
      'marginalian',
      'aldaily',
      'theue',
      'tech',
    ]
    return builtinPreset(
      BUILTIN_DEPTH_ID,
      '深度智识',
      '思想随笔 · 科技前沿 · 全球宏观 · 独立专栏',
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
        'techcrunch',
        'cls-telegraph',
        'eastmoney-kx',
        'wscn-live',
        'bbc-business',
      ),
      intl: pickKnown('bloomberg-opinion', 'project-syndicate', 'scmp-china', 'theinitium'),
      tech: pickKnown('geekpark', 'sspai', 'ifanr'),
      ai: pickKnown('qbitai', 'aiera', 'venturebeat-ai'),
    }
    return builtinPreset(
      BUILTIN_BIZ_ID,
      '商业创投',
      '深度特写 · 创投产业 · 国际经贸 · 科技观察',
      {
        categoryOrder: ['mix', 'finance', 'intl', 'tech', 'ai'],
        hiddenCategoryIds: hiddenExcept(['mix', 'finance', 'intl', 'tech', 'ai']),
        categorySources,
        customCategories: [],
        enabledSourceIds: exclusiveEnabledSourceIds(
          categorySources,
          pickKnown(
            'eastmoney-news',
            'netease-biz',
            'netease-stock',
            'gnews-business',
            'jiqizhixin',
            'mittr',
            'bbc-zh',
            'dw-top',
            'gnews-world',
          ),
        ),
      },
    )
  })(),
  (() => {
    const categorySources = {
      intl: pickKnown(
        'foreign-affairs',
        'nyrb',
        'sinocism',
        'theinitium',
        'bbc-zh',
        'bbc-world',
        'dw-top',
        'scmp-china',
        'npr',
        'guardian-world',
        'france24',
        'aljazeera',
      ),
      hot: pickKnown('netease'),
      'tech-depth': pickKnown('quanta', 'mittr', 'wired', 'arstechnica'),
      science: pickKnown('huanqiukexue', 'pansci', 'gnews-science'),
    }
    return builtinPreset(
      BUILTIN_WORLD_ID,
      '全球视野',
      '公共广电 · 地缘智库 · 亚洲视角 · 科学深度',
      {
        categoryOrder: ['mix', 'intl', 'hot', 'tech-depth', 'science'],
        hiddenCategoryIds: hiddenExcept(['mix', 'intl', 'hot', 'tech-depth', 'science']),
        categorySources,
        customCategories: [],
        enabledSourceIds: exclusiveEnabledSourceIds(
          categorySources,
          pickKnown(
            'bbc-zh-china',
            'bbc-zh-world',
            'scmp-news',
            'gnews-world',
            'guokr',
            'zhishifenzi',
            'verge',
            'hn',
          ),
        ),
      },
    )
  })(),
  (() => {
    const categorySources = {
      science: pickKnown('guokr', 'pansci', 'huanqiukexue', 'zhishifenzi'),
      tech: pickKnown('sspai', 'ruanyifeng', 'appinn', 'v2ex'),
      theue: pickKnown('theue'),
      zhihu: pickKnown('zhihu-daily'),
      fun: pickKnown('gcores', 'jandan'),
    }
    const visible: CategoryId[] = ['science', 'tech', 'theue', 'zhihu', 'fun']
    return builtinPreset(
      BUILTIN_MINDFUL_ID,
      '慢读知性',
      '科学人文 · 数字生活 · 深度叙事 · 知乎精选 · 文化漫步',
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
      ent: pickKnown('netease-ent', 'gnews-ent'),
      game: pickKnown('netease-game'),
      history: pickKnown('netease-history'),
      zhihu: pickKnown('zhihu-daily'),
    }
    const visible: CategoryId[] = ['fun', 'ent', 'game', 'history', 'zhihu']
    return builtinPreset(
      BUILTIN_FUN_ID,
      '摸鱼消遣',
      '轻松段子 · 娱乐八卦 · 游戏文化 · 历史轶闻 · 知乎闲读',
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
