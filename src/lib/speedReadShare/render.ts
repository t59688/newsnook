import { toBlob } from 'html-to-image'

import { ensureShareFonts } from './fonts'
import { warmupSpeedReadShareAssets } from './assets'
import cardCss from './card.css?inline'
import { buildCardHtml } from './buildCardHtml'
import { loadSpeedReadShareStyle } from './prefs'
import { SPEED_READ_SHARE_STYLES } from './styles'
import type { SpeedReadImageInput, SpeedReadShareStyle } from './types'

/** 与模板原型一致：720 CSS 像素宽；1.5x 导出，清晰度与性能折中 */
const CARD_WIDTH = 720
const EXPORT_PIXEL_RATIO = 1.5

let cardStylesMounted = false

function mountCardStylesOnce(): void {
  if (cardStylesMounted || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.setAttribute('data-speed-read-share', 'true')
  style.textContent = cardCss
  document.head.appendChild(style)
  cardStylesMounted = true
}

async function waitForPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function preloadImage(src: string): Promise<void> {
  if (src.startsWith('data:')) return
  await new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

function createCaptureHost(html: string): HTMLDivElement {
  mountCardStylesOnce()
  const host = document.createElement('div')
  host.setAttribute('data-speed-read-capture', 'true')
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;width:720px;z-index:-1;pointer-events:none;opacity:1'
  host.innerHTML = html
  document.body.appendChild(host)
  return host
}

export async function renderSpeedReadImageBlob(
  input: SpeedReadImageInput,
  style: SpeedReadShareStyle = loadSpeedReadShareStyle(),
): Promise<Blob> {
  await warmupSpeedReadShareAssets()

  const html = buildCardHtml(input, style)
  const host = createCaptureHost(html)

  try {
    const card = host.querySelector('.card') as HTMLElement | null
    if (!card) throw new Error('无法构建分享卡片')

    await ensureShareFonts()
    await waitForPaint()

    const logos = host.querySelectorAll<HTMLImageElement>('img')
    await Promise.all([...logos].map((img) => preloadImage(img.src)))

    const blob = await toBlob(card, {
      width: CARD_WIDTH,
      pixelRatio: EXPORT_PIXEL_RATIO,
      skipAutoScale: true,
      skipFonts: true,
    })
    if (!blob) throw new Error('图片生成失败')
    return blob
  } finally {
    host.remove()
  }
}

function sanitizeImageFileStem(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function speedReadImageFileName(
  articleTitle: string,
  style?: SpeedReadShareStyle,
  options?: { unique?: boolean },
): string {
  const base = sanitizeImageFileStem(articleTitle).slice(0, 40) || 'newsnook'
  const styleLabel = style
    ? sanitizeImageFileStem(SPEED_READ_SHARE_STYLES.find((item) => item.id === style)?.label ?? style)
    : ''
  const uniqueSuffix = options?.unique ? `-${Date.now()}` : ''
  if (styleLabel) return `有所闻-速读-${styleLabel}-${base}${uniqueSuffix}.png`
  return `有所闻-速读-${base}${uniqueSuffix}.png`
}
