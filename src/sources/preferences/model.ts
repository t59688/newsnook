/**
 * 偏好模型：类型、默认值、选项表与共享校验函数。
 * 叶子模块（不依赖 preferences/ 内其它文件）。
 */

import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_SCHEME,
  type ThemeMode,
  type ThemeScheme,
} from '../../lib/theme'
import type { CustomSchemePrefs } from '../../lib/customScheme'
import { DEFAULT_TRANSLATION_PREFS } from '../../features/translation/config'
import type { TranslationPrefs } from '../../features/translation/types'
import { DEFAULT_READ_ALOUD_PREFS } from '../../features/readAloud/config'
import type { ReadAloudPrefs } from '../../features/readAloud/types'
import { DEFAULT_PROXY_PREFS } from '../../features/proxy/config'
import type { ProxyPrefs } from '../../features/proxy/types'
import { DEFAULT_RSSHUB_INSTANCES, type RssHubInstance } from '../../features/rsshub/instances'
import {
  CATEGORIES,
  CATEGORY_TAXONOMY_VERSION,
  DEFAULT_PRESET_CATEGORY_IDS,
  DEFAULT_PRESET_CATEGORY_SOURCES,
  FAVORITES_CATEGORY_ID,
  RECOMMEND_CATEGORY_ID,
  type CategoryId,
  type NewsCategory,
} from '../categories'
import type { NewsSource } from '../registry'

export type FontFamilyId = 'sans' | 'serif' | 'system'

/** 首页信息流版式：经典单栏保持旧版阅读节奏，cards 为新版双栏编辑卡片。 */
export type HomeFeedLayout = 'classic' | 'cards'

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

export const PRESTORE_PER_SOURCE_OPTIONS = [5, 10, 20, 50, 100] as const

export interface PrestorePrefs {
  enabled: boolean
  perSourceLimit: number
}

export interface CategoryNameOverride {
  label: string
  short: string
}

export const DEFAULT_PRESTORE_PREFS: PrestorePrefs = {
  enabled: false,
  perSourceLimit: 10,
}

export function normalizePrestoreLimit(value: unknown): number {
  return typeof value === 'number' && PRESTORE_PER_SOURCE_OPTIONS.some((option) => option === value)
    ? value
    : DEFAULT_PRESTORE_PREFS.perSourceLimit
}

export function normalizePrestorePrefs(raw: unknown): PrestorePrefs {
  const input = (raw ?? {}) as Partial<PrestorePrefs>
  return {
    enabled: input.enabled === true,
    perSourceLimit: normalizePrestoreLimit(input.perSourceLimit),
  }
}

export interface Preferences {
  /** 内置分类体系版本；用于把旧内置布局一次性物化为用户自定义布局。 */
  categoryTaxonomyVersion: number
  /** 分类展示顺序；未列出的分类按注册表顺序排在后面 */
  categoryOrder: CategoryId[]
  hiddenCategoryIds: CategoryId[]
  /** 分类 → 自定义信源；缺省表示沿用注册表默认 */
  categorySources: Record<CategoryId, string[]>
  /** 内置分类在当前预设内的显示名称覆盖；分类 id 与信源契约保持不变 */
  categoryNames: Record<CategoryId, CategoryNameOverride>
  /** 当前场景预设收藏的信源；由动态「收藏」分类统一展示 */
  favoriteSourceIds: string[]
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
  /** 首页信息流版式。新安装默认 cards；历史偏好缺字段时迁移为 classic。 */
  homeFeedLayout: HomeFeedLayout
  translation: TranslationPrefs
  readAloud: ReadAloudPrefs
  proxy: ProxyPrefs
  /** RSSHub 公共/自定义实例，随偏好、备份与云同步保存。 */
  rsshubInstances: RssHubInstance[]
  /** 切换/滑动到分类页时是否自动刷新（关闭时保留滚动阅读位置） */
  autoRefreshOnCategorySwitch?: boolean
  /**
   * 推荐栏总开关：关闭后所有预设都不显示动态「推荐」分类，普通分类不受影响；
   * 重新打开且预设内阅读仍达标时推荐栏自动恢复。默认开启。
   */
  recommendEnabled?: boolean
  /**
   * 墨水屏模式：关动画/弱化装饰/文章分页。与 theme 正交；默认 false。
   * 关闭后须完整恢复正常模式行为。
   */
  einkMode: boolean
  /** Android：仅 Wi-Fi 下自动加载阅读页图片和视频；默认 false */
  wifiOnlyAutoLoadMedia: boolean
  /** 当前预设的正文预存策略；关闭仅停止更新，不主动删除已预存正文 */
  prestore: PrestorePrefs
}

export const DEFAULT_TYPOGRAPHY: TypographyPrefs = {
  fontScale: 1,
  lineHeight: 1.9,
  paragraphGap: 1.1,
  fontFamily: 'sans',
  firstLineIndent: true,
}

const DEFAULT_VISIBLE = new Set<string>(DEFAULT_PRESET_CATEGORY_IDS)

/** 新装默认使用「中国资讯」预设；其它内置分类保持隐藏。 */
export const DEFAULT_HIDDEN_CATEGORY_IDS: CategoryId[] = CATEGORIES.map(
  (category) => category.id,
).filter((id) => !DEFAULT_VISIBLE.has(id))

export const DEFAULT_PREFERENCES: Preferences = {
  categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
  categoryOrder: [...DEFAULT_PRESET_CATEGORY_IDS],
  hiddenCategoryIds: [...DEFAULT_HIDDEN_CATEGORY_IDS],
  categorySources: { ...DEFAULT_PRESET_CATEGORY_SOURCES },
  categoryNames: {},
  favoriteSourceIds: [],
  customCategories: [],
  customSources: [],
  typography: DEFAULT_TYPOGRAPHY,
  theme: DEFAULT_THEME_MODE,
  scheme: DEFAULT_THEME_SCHEME,
  homeFeedLayout: 'cards',
  translation: DEFAULT_TRANSLATION_PREFS,
  readAloud: DEFAULT_READ_ALOUD_PREFS,
  proxy: DEFAULT_PROXY_PREFS,
  rsshubInstances: [...DEFAULT_RSSHUB_INSTANCES],
  autoRefreshOnCategorySwitch: true,
  recommendEnabled: true,
  einkMode: false,
  wifiOnlyAutoLoadMedia: false,
  prestore: DEFAULT_PRESTORE_PREFS,
}

/** 综合分类跟随「频道」页启用状态，不参与逐分类信源编辑 */
export const FOLLOWS_ENABLED_SOURCES: CategoryId = 'mix'

/**
 * 聚合分类：信源由布局推导而非逐分类编辑（综合=频道启用列表；推荐=预设启用信源并集）。
 * 不接受 categorySources 覆盖，持久化时同样跳过。
 */
export function isAggregateCategoryId(categoryId: CategoryId): boolean {
  return (
    categoryId === FOLLOWS_ENABLED_SOURCES ||
    categoryId === FAVORITES_CATEGORY_ID ||
    categoryId === RECOMMEND_CATEGORY_ID
  )
}

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

export function uniqueValid(ids: unknown, known: Set<string>): string[] {
  if (!Array.isArray(ids)) return []
  const valid = ids.filter((id): id is string => typeof id === 'string' && known.has(id))
  return [...new Set(valid)]
}

export function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
