/**
 * 自定义配色推导引擎（原样提取自 src/lib/customScheme.ts）。
 * 用户只选「底色 + 强调色」，其余语义 token 按 WCAG 相对亮度与对比度自动推导。
 */

export interface CustomSchemeColors {
  /** 底色 hex */
  ink: string
  /** 强调色 hex */
  accent: string
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
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

export function deriveSchemeTokens(
  colors: CustomSchemeColors,
  mode: 'light' | 'dark',
): Record<string, string> {
  const light = mode === 'light'
  const ink = colors.ink.toLowerCase()
  const { accent: rawAccent } = colors
  const accent = ensureAccentContrast(ink, rawAccent.toLowerCase()).accent

  const { h, s } = hueSat(ink)
  const paper = hslToHex(h, Math.min(s * 0.3, 0.18), light ? 0.115 : 0.9)
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
    'color-scheme': mode,
  }
}
