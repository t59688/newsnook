import type { CustomSchemePrefs } from './customScheme'
import { applyThemeScheme, THEME_SCHEMES, type ThemeScheme, type ThemeSchemeMeta } from './theme'

/**
 * 升级到本版后出现一次的风格选择。
 * 只列内置方案：自定义仍走「我的 → 外观」，不塞进这次引导。
 */
export function schemeOnboardingOptions(): ThemeSchemeMeta[] {
  return THEME_SCHEMES.filter((item) => item.id !== 'custom')
}

/**
 * 引导里点选预览：同步改 html[data-scheme]，不写偏好、不加全站 transition。
 * 点选若走 React update，会重绘整页列表并落盘，INP 会到数秒。
 *
 * 打开期间 App 把 <main>（今日列表）搁起。遮罩用不透明 bg-ink，上面铺一页固定 DOM 的
 * 模拟正文（不是真实列表）：预览时只重画这一页和底部弹层，切换保持即时。
 */
export function previewThemeScheme(scheme: ThemeScheme, custom?: CustomSchemePrefs): void {
  applyThemeScheme(scheme, { animate: false, custom })
}

export function shouldShowSchemeOnboarding(input: {
  seen: boolean
  tab: string
  reading: boolean
  settingsOpen: boolean
  sourceFocused: boolean
  eggOpen: boolean
  deepLinkError: boolean
}): boolean {
  return (
    !input.seen &&
    input.tab === 'today' &&
    !input.reading &&
    !input.settingsOpen &&
    !input.sourceFocused &&
    !input.eggOpen &&
    !input.deepLinkError
  )
}
