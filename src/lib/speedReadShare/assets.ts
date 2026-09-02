import { injectSpeedReadShareFonts } from './fontMirror'

const logoCache: { dark?: string; light?: string } = {}
let warmupPromise: Promise<void> | null = null

function absoluteLogoPath(light: boolean): string {
  const path = light ? '/logo-light.svg' : '/logo-dark.svg'
  if (typeof window === 'undefined') return path
  return new URL(path, window.location.origin).href
}

async function fetchLogoDataUrl(light: boolean): Promise<string> {
  const path = light ? '/logo-light.svg' : '/logo-dark.svg'
  const response = await fetch(path)
  if (!response.ok) throw new Error(`logo fetch failed: ${path}`)
  const svg = await response.text()
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** 同步取 logo src：优先用已内联的 data URL，避免截图时重复拉取 */
export function getShareLogoSrc(light: boolean): string {
  const cached = light ? logoCache.light : logoCache.dark
  return cached ?? absoluteLogoPath(light)
}

/** 面板打开或首次导出前预热：国内镜像字体 + logo 内联 */
export function warmupSpeedReadShareAssets(): Promise<void> {
  injectSpeedReadShareFonts()

  if (logoCache.dark && logoCache.light) return Promise.resolve()
  if (!warmupPromise) {
    warmupPromise = Promise.all([
      fetchLogoDataUrl(false).then((url) => {
        logoCache.dark = url
      }),
      fetchLogoDataUrl(true).then((url) => {
        logoCache.light = url
      }),
    ])
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        warmupPromise = null
      })
  }
  return warmupPromise
}
