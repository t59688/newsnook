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
 * 引导里点选预览：只改 html[data-scheme]，不写偏好、不加全站 transition。
 * 点选若走 React update，会重绘整页列表并落盘，INP 会到数秒。
 */
export function previewThemeScheme(scheme: ThemeScheme, custom?: CustomSchemePrefs): void {
  applyThemeScheme(scheme, { animate: false, custom })
}

let cancelPendingPreview: (() => void) | undefined

/**
 * 点选后的预览分两拍：点击这一帧只让卡片的选中态上屏，整页 data-scheme 改写留到下一帧。
 *
 * 根上的 --tone-* 一变，全文档都要重算样式、重排、整屏重绘（数千节点的列表在慢机上是几百毫秒
 * 到数秒）。若和点击落在同一帧，用户要等整页重排完才看到勾选，INP 被整段拖长。
 * 事件里注册的 rAF 仍在本帧绘制前触发，因此要再嵌一层才真正落到本帧提交之后。
 * 连点多张卡只保留最后一张；关闭或确认前调 cancelScheduledPreview，避免迟到的预览盖掉恢复/落盘结果。
 */
export function schedulePreviewThemeScheme(scheme: ThemeScheme, custom?: CustomSchemePrefs): void {
  cancelScheduledPreview()
  if (typeof requestAnimationFrame !== 'function') {
    previewThemeScheme(scheme, custom)
    return
  }
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      cancelPendingPreview = undefined
      previewThemeScheme(scheme, custom)
    })
  })
  cancelPendingPreview = () => cancelAnimationFrame(frame)
}

export function cancelScheduledPreview(): void {
  cancelPendingPreview?.()
  cancelPendingPreview = undefined
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
