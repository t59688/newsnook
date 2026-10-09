import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

import { type ResolvedTheme } from './theme'

type NativeChromeBridge = {
  setFullScreen?: (fullScreen: boolean) => void
  setSystemTheme?: (theme: string) => void
}

function isSplashBoot(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.boot === 'splash'
}

function nativeChromeBridge(): NativeChromeBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as any).NewsNookNative as NativeChromeBridge | undefined
  }
  return (globalThis as any).NewsNookNative as NativeChromeBridge | undefined
}

/**
 * 隐藏/恢复系统状态栏与导航栏。
 *
 * Capacitor 8 已内置 SystemBars，优先用它控制现代 edge-to-edge Window；
 * NewsNookNative 同步维护 MainActivity 的沉浸态与 OEM 自愈逻辑。两条路径
 * 最终都落到 WindowInsetsControllerCompat，重复调用是幂等的。
 */
export async function setNativeFullScreen(fullScreen: boolean): Promise<void> {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('is-video-fullscreen', fullScreen)
  }

  // 保留项目已有桥：除了立即藏栏，它还会记录 videoFullscreenActive，
  // 让旋转、重新获焦、Insets 重新分发时继续自愈。JavascriptInterface
  // 未必能用 typeof === 'function' 判断，因此仍只做真值判断。
  const bridge = nativeChromeBridge()
  try {
    if (bridge?.setFullScreen) bridge.setFullScreen(fullScreen)
  } catch {
    // SystemBars below remains the authoritative Capacitor path.
  }

  if (!Capacitor.isNativePlatform()) return

  try {
    if (fullScreen) await SystemBars.hide()
    else await SystemBars.show()
  } catch {
    // 旧安装包或异常原生环境仍由 NewsNookNative 兜底，不打断播放器切换。
  }
}

/**
 * 真机系统栏：边到边 + 透明栏，底色由 Web（splash / AppShell safe-area 条）提供。
 *
 * 边到边与透明栏在 MainActivity.onCreate 建立；这里只负责图标颜色跟随主题。
 * 使用 Capacitor 8 内置 SystemBars，而不是旧的 @capacitor/status-bar。
 */
export async function applyNativeChrome(theme: ResolvedTheme): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  const effective: ResolvedTheme = isSplashBoot() ? 'dark' : theme

  try {
    await SystemBars.setStyle({
      style: effective === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark,
    })
  } catch {
    // 继续走项目自带桥，兼容未同步原生工程的旧安装包。
  }

  try {
    const bridge = nativeChromeBridge()
    if (bridge?.setSystemTheme) {
      bridge.setSystemTheme(effective)
    }
  } catch {
    // ignore
  }
}
