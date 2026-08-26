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
import { DEFAULT_PROXY_PREFS } from '../../features/proxy/config'
import type { ProxyPrefs } from '../../features/proxy/types'
import {
  PORTAL_VISIBLE_CATEGORY_IDS,
  RECOMMEND_CATEGORY_ID,
  type CategoryId,
  type NewsCategory,
} from '../categories'
import type { NewsSource } from '../registry'

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

export const PRESTORE_PER_SOURCE_OPTIONS = [5, 10, 20, 50, 100] as const

export interface PrestorePrefs {
  enabled: boolean
  perSourceLimit: number
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

/**
 * 门户经典默认栏之外的分类；新装 / 重置布局时隐藏。
 * 可见栏与 presets.PORTAL_VISIBLE_CATEGORY_IDS 对齐：
 * 综合 / 热点 / 娱乐 / 体育 / 科技 / 商业 / 国际 / 健康 / 科普 / 轻松。
 * AI、游戏、深度与冷门细分留给场景预设或分类管理。
 */
export const DEFAULT_HIDDEN_CATEGORY_IDS: CategoryId[] = [
  'recommend',
  'ai-openai',
  'ai-claude',
  'ai',
  'ai-media',
  'ai-depth',
  'ai-community',
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
  prestore: DEFAULT_PRESTORE_PREFS,
}

/** 综合分类跟随「频道」页启用状态，不参与逐分类信源编辑 */
export const FOLLOWS_ENABLED_SOURCES: CategoryId = 'mix'

/**
 * 聚合分类：信源由布局推导而非逐分类编辑（综合=频道启用列表；推荐=可见分类并集）。
 * 不接受 categorySources 覆盖，持久化时同样跳过。
 */
export function isAggregateCategoryId(categoryId: CategoryId): boolean {
  return categoryId === FOLLOWS_ENABLED_SOURCES || categoryId === RECOMMEND_CATEGORY_ID
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
