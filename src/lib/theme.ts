/**
 * 主题只有「深/浅」两种落地形态，跟随系统在这里解析成其中之一后写入 <html data-theme>，
 * CSS 因此不必处理三态，任何子树也能用同一个属性局部改写（例如图片查看器强制深色）。
 *
 * 风格方案（ThemeScheme）是正交的第二维度，写入 <html data-scheme>：
 * 同一套语义 token（--tone-* / --color-*），不同配色与展示字体，色值全部在 index.css。
 */

import {
  CUSTOM_TOKEN_KEYS,
  DEFAULT_CUSTOM_SCHEME,
  deriveSchemeTokens,
  type CustomSchemePrefs,
} from './customScheme'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_MODES: { id: ThemeMode; label: string; caption: string }[] = [
  { id: 'system', label: '跟随系统', caption: '随系统切换' },
  { id: 'light', label: '昼读', caption: '浅色' },
  { id: 'dark', label: '夜读', caption: '深色' },
]

/** 改动这里时，index.html 里防闪脚本的兜底值也要一起改 */
export const DEFAULT_THEME_MODE: ThemeMode = 'system'

export type ThemeScheme = 'ink' | 'celadon' | 'custom'

/** 外观设置页预览卡取色：必须与 index.css 中对应方案的 --tone-* 保持一致 */
export interface ThemeSchemeSwatch {
  /** --tone-ink 底 */
  ink: string
  /** --tone-ink-raised 浮层 */
  raised: string
  /** --tone-paper 字 */
  paper: string
  /** --tone-cinnabar 强调 */
  accent: string
}

export interface ThemeSchemeMeta {
  id: ThemeScheme
  label: string
  caption: string
  swatch: Record<ResolvedTheme, ThemeSchemeSwatch>
}

export const THEME_SCHEMES: ThemeSchemeMeta[] = [
  {
    id: 'ink',
    label: '墨问',
    caption: '宣纸 · 朱砂 · 默认',
    swatch: {
      light: { ink: '#F6F2E9', raised: '#FFFCF5', paper: '#1A1815', accent: '#B43D26' },
      dark: { ink: '#0E0F12', raised: '#16181D', paper: '#EAE4D8', accent: '#C45C4A' },
    },
  },
  {
    id: 'celadon',
    label: '天青',
    caption: '汝窑 · 单色青釉',
    swatch: {
      light: { ink: '#E6EBE8', raised: '#F0F4F1', paper: '#1F2426', accent: '#3E6663' },
      dark: { ink: '#121817', raised: '#1A2220', paper: '#DEE5DF', accent: '#8FB3AE' },
    },
  },
  {
    id: 'custom',
    label: '自定义',
    caption: '自选底色与强调色',
    swatch: {
      light: { ink: '#F6F2E9', raised: '#FBF9F1', paper: '#1C1915', accent: '#B43D26' },
      dark: { ink: '#0E0F12', raised: '#16181D', paper: '#EAE4D8', accent: '#C45C4A' },
    },
  },
]

/** 改动这里时，index.html 里防闪脚本的方案白名单也要一起改 */
export const DEFAULT_THEME_SCHEME: ThemeScheme = 'ink'

export function isThemeScheme(value: unknown): value is ThemeScheme {
  return value === 'ink' || value === 'celadon' || value === 'custom'
}

/**
 * 各方案「昼/夜」的表面色，与 index.css 中该方案的 --tone-ink 保持一致，
 * 用于系统栏与浏览器地址栏着色；启动页期间始终用墨问夜读（见 syncThemeColorMeta）。
 * custom 方案没有静态色，由 themeSurface 在运行时按自定义配色取值。
 */
export const THEME_SURFACE: Record<Exclude<ThemeScheme, 'custom'>, Record<ResolvedTheme, string>> = {
  ink: { dark: '#0E0F12', light: '#F6F2E9' },
  celadon: { dark: '#121817', light: '#E6EBE8' },
}

/** 运行时自定义配色：由 applyThemeScheme 注入，供 theme-color 等取色 */
let activeCustomScheme: CustomSchemePrefs | undefined

export function themeSurface(scheme: ThemeScheme, resolved: ResolvedTheme): string {
  if (scheme === 'custom') {
    return activeCustomScheme?.[resolved].ink ?? THEME_SURFACE.ink[resolved]
  }
  return THEME_SURFACE[scheme][resolved]
}

/** 首次选择「自定义」时的种子色：从给定方案的 swatch 复制，用户在此基础上微调 */
export function schemeSeedColors(from: ThemeScheme): CustomSchemePrefs {
  const meta = THEME_SCHEMES.find((item) => item.id === from && item.id !== 'custom')
  if (!meta) return DEFAULT_CUSTOM_SCHEME
  return {
    light: { ink: meta.swatch.light.ink.toLowerCase(), accent: meta.swatch.light.accent.toLowerCase() },
    dark: { ink: meta.swatch.dark.ink.toLowerCase(), accent: meta.swatch.dark.accent.toLowerCase() },
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)'
const TRANSITION_CLASS = 'theme-switching'
const TRANSITION_MS = 260

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? systemTheme() : mode
}

/** 深色 UI 用浅色标，浅色 UI 用深色标；favicon 见 public/favicon.svg */
export function brandLogoSrc(resolved: ResolvedTheme): string {
  return resolved === 'dark' ? '/logo-light.svg' : '/logo-dark.svg'
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined

function scheduleTransitionEnd(root: HTMLElement): void {
  root.classList.add(TRANSITION_CLASS)
  clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => root.classList.remove(TRANSITION_CLASS), TRANSITION_MS)
}

function currentScheme(root: HTMLElement): ThemeScheme {
  const value = root.dataset.scheme
  return isThemeScheme(value) ? value : DEFAULT_THEME_SCHEME
}

/** theme-color 跟随方案与明暗；启动页期间强制墨问夜读，避免状态栏区域先闪昼读米白 */
function syncThemeColorMeta(root: HTMLElement, resolved: ResolvedTheme): void {
  const surface =
    root.dataset.boot === 'splash'
      ? THEME_SURFACE.ink.dark
      : themeSurface(currentScheme(root), resolved)
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', surface)
}

/** 首次应用（首屏）不做过渡，避免启动时闪一层颜色动画 */
export function applyTheme(mode: ThemeMode, options?: { animate?: boolean }): ResolvedTheme {
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  if (root.dataset.theme === resolved) return resolved

  if (options?.animate) scheduleTransitionEnd(root)

  root.dataset.theme = resolved
  syncThemeColorMeta(root, resolved)

  return resolved
}

/**
 * 风格方案与明暗正交；明暗未变时表面色也会随方案改变，需要立即重算 theme-color。
 * custom 方案额外把推导出的完整 token 组内联到 <html>（覆盖静态方案块），
 * 切回内置方案时按 CUSTOM_TOKEN_KEYS 移除。无早期返回：调色/明暗切换后需刷新 token。
 */
export function applyThemeScheme(
  scheme: ThemeScheme,
  options?: { animate?: boolean; custom?: CustomSchemePrefs },
): void {
  const root = document.documentElement
  if (options?.custom) activeCustomScheme = options.custom

  if (root.dataset.scheme !== scheme && options?.animate) scheduleTransitionEnd(root)
  root.dataset.scheme = scheme

  const resolved: ResolvedTheme = root.dataset.theme === 'light' ? 'light' : 'dark'
  if (scheme === 'custom' && activeCustomScheme) {
    const tokens = deriveSchemeTokens(activeCustomScheme[resolved], resolved)
    for (const [key, value] of Object.entries(tokens)) {
      root.style.setProperty(key, value)
    }
  } else {
    for (const key of CUSTOM_TOKEN_KEYS) root.style.removeProperty(key)
  }

  syncThemeColorMeta(root, resolved)
}

/** 仅在「跟随系统」时需要订阅；返回取消函数 */
export function watchSystemTheme(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
