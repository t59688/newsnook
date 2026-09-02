import { Capacitor } from '@capacitor/core'

import { injectSpeedReadShareFonts } from './fontMirror'

/** 分享卡实际用到的字体规格（与 card.css 对齐） */
const SHARE_FONT_SPECS = [
  '400 15px "Noto Sans SC"',
  '600 15px "Noto Sans SC"',
  '600 17px "Noto Serif SC"',
  '700 17px "Noto Serif SC"',
  '700 31px "Noto Serif SC"',
  '700 36px "Noto Serif SC"',
  '900 21px "Noto Serif SC"',
  '900 13px "Noto Serif SC"',
  '900 36px "Noto Serif SC"',
  '700 31px "LXGW WenKai Screen"',
  '700 17px "LXGW WenKai Screen"',
  '700 15px "LXGW WenKai Screen"',
] as const

const FONT_READY_TIMEOUT_MS = Capacitor.isNativePlatform() ? 6000 : 2200

let shareFontsReady = false

function shareFontsSatisfied(): boolean {
  if (!document.fonts?.check) return shareFontsReady
  return SHARE_FONT_SPECS.every((spec) => document.fonts.check(spec))
}

/** 国内镜像加载 Noto + 文楷，保证分享图字形与模板一致 */
export async function ensureShareFonts(): Promise<void> {
  injectSpeedReadShareFonts()

  if (shareFontsReady || shareFontsSatisfied()) {
    shareFontsReady = true
    return
  }

  const loads = SHARE_FONT_SPECS.map((spec) =>
    document.fonts.load(spec).catch(() => undefined),
  )

  await Promise.race([
    Promise.all(loads),
    document.fonts.ready,
    new Promise<void>((resolve) => setTimeout(resolve, FONT_READY_TIMEOUT_MS)),
  ])

  shareFontsReady = true
}

/** 截图前再等一轮字体，减少 Android WebView 与桌面导出差异 */
export async function waitForShareFontsPaint(): Promise<void> {
  injectSpeedReadShareFonts()
  if (document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, FONT_READY_TIMEOUT_MS)),
    ])
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
