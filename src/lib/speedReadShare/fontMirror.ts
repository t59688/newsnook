import {
  SHARE_NOTO_CSS,
  SHARE_NOTO_FALLBACK_CSS,
  SHARE_WENKAI_CSS,
  SHARE_WENKAI_FALLBACK_CSS,
} from '../cnFontMirror'

let shareFontLinksInjected = false

function appendStylesheet(id: string, href: string, fallback?: string): void {
  if (document.querySelector(`link[data-speed-read-font="${id}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute('data-speed-read-font', id)
  if (fallback) {
    link.addEventListener('error', () => {
      if (document.querySelector(`link[data-speed-read-font="${id}-fb"]`)) return
      const fb = document.createElement('link')
      fb.rel = 'stylesheet'
      fb.href = fallback
      fb.setAttribute('data-speed-read-font', `${id}-fb`)
      document.head.appendChild(fb)
    })
  }
  document.head.appendChild(link)
}

/** 从国内镜像注入分享卡专用字体（Noto 900 + LXGW 文楷），失败时自动切备用源 */
export function injectSpeedReadShareFonts(): void {
  if (shareFontLinksInjected || typeof document === 'undefined') return
  shareFontLinksInjected = true
  appendStylesheet('noto', SHARE_NOTO_CSS, SHARE_NOTO_FALLBACK_CSS)
  appendStylesheet('wenkai', SHARE_WENKAI_CSS, SHARE_WENKAI_FALLBACK_CSS)
}
