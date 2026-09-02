/**
 * 国内字体镜像（2026-03 实测：CSS + 字体文件均可 200）
 *
 * Google Fonts：fonts.googleapis.cn → fonts.gstatic.cn（官方中国节点）
 * 文楷：registry.npmmirror.com 直链 lxgwwenkaiscreen.css（含 woff2 子集）
 *
 * 不可用（勿用）：fonts.lug.ustc.edu.cn、cdn.jsdmirror.com、fonts.yite.net
 */

/** Google Fonts 中国官方加速（CSS 与 woff2/ttf 均走 *.gstatic.cn） */
export const CN_GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.cn'

export const CN_GOOGLE_FONTS_STATIC = 'https://fonts.gstatic.cn'

/** 阿里 npmmirror：LXGW WenKai Screen 子集 CSS */
export const CN_NPM_MIRROR_ORIGIN = 'https://registry.npmmirror.com'

export function cnGoogleFontsCss(query: string): string {
  return `${CN_GOOGLE_FONTS_ORIGIN}/css2?${query}&display=swap`
}

const NOTO_QUERY =
  'family=Noto+Serif+SC:wght@400;500;600;700;900&family=Noto+Sans+SC:wght@300;400;500;600;700'

/** App 全局：Noto + JetBrains Mono（含 Serif 900，分享卡大标题用） */
export const APP_FONT_CSS = cnGoogleFontsCss(
  `${NOTO_QUERY}&family=JetBrains+Mono:wght@400;500;600`,
)

/** 分享卡：Noto 全套（与 App 共用同源，避免重复拉取） */
export const SHARE_NOTO_CSS = cnGoogleFontsCss(NOTO_QUERY)

/**
 * 手账拼贴 v4：与原型相同，加载完整 style.css（4 个子集 @import）
 * font-family: 'LXGW WenKai Screen'
 */
export const SHARE_WENKAI_CSS = `${CN_NPM_MIRROR_ORIGIN}/lxgw-wenkai-screen-webfont/1.7.0/files/style.css`

/** 备用：jsDelivr 主站（与原型 CDN 同源） */
export const SHARE_WENKAI_FALLBACK_CSS =
  'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/style.css'

/** 备用：geekzu CSS（字体文件仍走 gstatic.com，仅作兜底） */
export const SHARE_NOTO_FALLBACK_CSS = `https://fonts.geekzu.org/css2?${NOTO_QUERY}&display=swap`
