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
 * 能同步写的前提是引导期间 App 已把 <main> 搁起（.content-parked → content-visibility: hidden）：
 * 下层数千条列表不参与样式重算与绘制，一次切换只剩弹层和壳要重画，和「我的 → 外观」一样轻。
 * 曾试过把整页改写推到下一帧（嵌套 rAF），但整页重排本身没变少，预览照样要等，已撤掉。
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
