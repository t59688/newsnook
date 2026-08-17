/**
 * 自定义配色：用户只选「底色 + 强调色」（昼/夜各一组），
 * 其余语义 token 由这里按对比度推导，保证可读性底线。
 *
 * 推导结果通过 <html> 内联自定义属性覆盖静态方案块（内联优先级高于样式表），
 * 因此 index.css 无需为 custom 方案准备静态变量块。
 */

import type { ResolvedTheme } from './theme'

export interface CustomSchemeColors {
  /** --tone-ink 底色 */
  ink: string
  /** --tone-cinnabar 强调色 */
  accent: string
}

export type CustomSchemePrefs = Record<ResolvedTheme, CustomSchemeColors>

/** 首次进入自定义时的起点：与墨问一致，用户在此基础上微调 */
export const DEFAULT_CUSTOM_SCHEME: CustomSchemePrefs = {
  light: { ink: '#f6f2e9', accent: '#b43d26' },
  dark: { ink: '#0e0f12', accent: '#c45c4a' },
}

// —— 颜色基础工具（RGB 空间混合 + WCAG 相对亮度，足够配色推导使用） ——

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

/** 规范化为 6 位小写 hex；非法输入返回 undefined（input[type=color] 只认 6 位） */
export function normalizeHexColor(value: unknown): string | undefined {
  if (!isHexColor(value)) return undefined
  const rgb = parseHexColor(value)
  return rgb ? rgbToHex(rgb) : undefined
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseHexColor(value: string): Rgb | undefined {
  if (!isHexColor(value)) return undefined
  let hex = value.trim().slice(1)
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  const num = Number.parseInt(hex, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** t=0 取 a，t=1 取 b */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHexColor(a)
  const cb = parseHexColor(b)
  if (!ca || !cb) return a
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t,
  })
}

/** WCAG 相对亮度（0–1） */
export function relativeLuminance(hex: string): number {
  const rgb = parseHexColor(hex)
  if (!rgb) return 0
  const channel = (n: number) => {
    const c = n / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** 取 hex 的色相与饱和度（HSL），用于派生与底色同系的文字色 */
function hueSat(hex: string): { h: number; s: number } {
  const { r, g, b } = parseHexColor(hex) ?? { r: 0, g: 0, b: 0 }
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0 }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  let h: number
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6)
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2)
  else h = 60 * ((rn - gn) / delta + 4)
  return { h: (h + 360) % 360, s }
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 })
}

function triplet(hex: string): string {
  const { r, g, b } = parseHexColor(hex) ?? { r: 0, g: 0, b: 0 }
  return `${r} ${g} ${b}`
}

/**
 * 强调色可读性兜底：与底色对比度不足时，向黑/白中对比更高的一端靠拢。
 * 方向只看实际底色，不依赖用户把它放在昼读还是夜读档；因此反常明暗也能达标。
 * 返回满足阈值的最小混合量与是否动过；编辑器据此提供一键修正。
 */
export function ensureAccentContrast(
  ink: string,
  accent: string,
): { accent: string; adjusted: boolean } {
  const MIN_RATIO = 3.2
  if (contrastRatio(accent, ink) >= MIN_RATIO) return { accent, adjusted: false }

  const darkTarget = '#000000'
  const lightTarget = '#ffffff'
  const target =
    contrastRatio(darkTarget, ink) >= contrastRatio(lightTarget, ink)
      ? darkTarget
      : lightTarget

  // target 必然至少达到 WCAG 4.5:1；二分找到仍满足阈值的最小改变量，尽量保留原色相。
  let low = 0
  let high = 1
  let next = target
  for (let step = 0; step < 12; step += 1) {
    const amount = (low + high) / 2
    const candidate = mixHex(accent, target, amount)
    if (contrastRatio(candidate, ink) >= MIN_RATIO) {
      next = candidate
      high = amount
    } else {
      low = amount
    }
  }

  return { accent: next, adjusted: next.toLowerCase() !== accent.toLowerCase() }
}

/**
 * 由「底色 + 强调色」推导完整 token 组（内联到 <html> 的全部自定义属性）。
 * 层次方向按昼/夜区分：昼读浮层更亮、凹陷更暗；夜读反之。
 */
export function deriveSchemeTokens(
  colors: CustomSchemeColors,
  mode: ResolvedTheme,
): Record<string, string> {
  const light = mode === 'light'
  const ink = colors.ink.toLowerCase()
  const { accent: rawAccent } = colors
  const accent = ensureAccentContrast(ink, rawAccent.toLowerCase()).accent

  // 文字色与底色同色系，避免「灰字浮在彩底上」的脏感
  const { h, s } = hueSat(ink)
  const paper = hslToHex(h, Math.min(s * 0.3, 0.18), light ? 0.115 : 0.9)
  // 底色与档位明暗气质相反（例如把黑色选进昼读档）时，退回与底色对比更强的中性纸色
  const safePaper =
    contrastRatio(paper, ink) >= 7
      ? paper
      : ['#1a1815', '#eae4d8'].reduce((best, candidate) =>
          contrastRatio(candidate, ink) > contrastRatio(best, ink) ? candidate : best,
        )

  const raised = light ? mixHex(ink, '#ffffff', 0.55) : mixHex(ink, safePaper, 0.06)
  const deep = light ? mixHex(ink, safePaper, 0.08) : mixHex(ink, '#000000', 0.45)
  const muted = mixHex(safePaper, ink, light ? 0.27 : 0.3)
  const faint = mixHex(safePaper, ink, light ? 0.42 : 0.52)
  const accentSoft = light ? mixHex(accent, '#ffffff', 0.12) : mixHex(accent, safePaper, 0.2)

  const paperRgb = triplet(safePaper)
  const inkRgb = triplet(ink)

  return {
    '--tone-paper-rgb': paperRgb,
    '--tone-ink-rgb': inkRgb,
    '--tone-ink-raised-rgb': triplet(raised),
    '--tone-ink-deep-rgb': triplet(deep),
    '--tone-paper-muted-rgb': triplet(muted),
    '--tone-paper-faint-rgb': triplet(faint),
    '--tone-cinnabar-rgb': triplet(accent),
    '--tone-cinnabar-soft-rgb': triplet(accentSoft),

    '--tone-ink': ink,
    '--tone-ink-raised': raised,
    '--tone-ink-deep': deep,
    '--tone-paper': safePaper,
    '--tone-paper-muted': muted,
    '--tone-paper-faint': faint,
    '--tone-cinnabar': accent,
    '--tone-cinnabar-soft': accentSoft,
    '--tone-haze': `rgb(${paperRgb} / ${light ? 0.11 : 0.08})`,

    '--tone-body-text': light ? mixHex(safePaper, ink, 0.05) : `rgb(${paperRgb} / 0.87)`,
    '--tone-quote-text': light ? mixHex(safePaper, ink, 0.3) : `rgb(${paperRgb} / 0.72)`,
    '--lead-veil': `rgb(${inkRgb} / ${light ? 0.86 : 0.55})`,
    '--shadow-lift': light
      ? `0 14px 34px -18px rgb(${paperRgb} / 0.35)`
      : '0 12px 40px -16px rgb(0 0 0 / 0.85)',
    '--dim-hidden': light ? 'contrast(0.78) saturate(0.5)' : 'brightness(0.72)',
    'color-scheme': mode,
  }
}

/** 自定义方案内联到 <html> 的全部属性名；切回内置方案时按此清单移除 */
export const CUSTOM_TOKEN_KEYS = [
  '--tone-paper-rgb',
  '--tone-ink-rgb',
  '--tone-ink-raised-rgb',
  '--tone-ink-deep-rgb',
  '--tone-paper-muted-rgb',
  '--tone-paper-faint-rgb',
  '--tone-cinnabar-rgb',
  '--tone-cinnabar-soft-rgb',
  '--tone-ink',
  '--tone-ink-raised',
  '--tone-ink-deep',
  '--tone-paper',
  '--tone-paper-muted',
  '--tone-paper-faint',
  '--tone-cinnabar',
  '--tone-cinnabar-soft',
  '--tone-haze',
  '--tone-body-text',
  '--tone-quote-text',
  '--lead-veil',
  '--shadow-lift',
  '--dim-hidden',
  'color-scheme',
] as const

/** 读入持久化数据时的校验：逐档校验 hex，缺档/脏值回落默认 */
export function normalizeCustomScheme(raw: unknown): CustomSchemePrefs | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Partial<Record<ResolvedTheme, Partial<CustomSchemeColors>>>
  const normalizeOne = (
    value: Partial<CustomSchemeColors> | undefined,
    fallback: CustomSchemeColors,
  ): CustomSchemeColors => ({
    ink: isHexColor(value?.ink) ? value!.ink.trim().toLowerCase() : fallback.ink,
    accent: isHexColor(value?.accent) ? value!.accent.trim().toLowerCase() : fallback.accent,
  })
  return {
    light: normalizeOne(input.light, DEFAULT_CUSTOM_SCHEME.light),
    dark: normalizeOne(input.dark, DEFAULT_CUSTOM_SCHEME.dark),
  }
}
