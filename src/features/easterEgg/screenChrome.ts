type NativeBridge = {
  setFullScreen?: (fullScreen: boolean) => void
  setKeepScreenOn?: (keepScreenOn: boolean) => void
}

/** 与历史可用路径一致：直接读 window.NewsNookNative（勿绕 globalThis.window 包装）。 */
export function getNativeBridge(): NativeBridge | undefined {
  if (typeof window !== 'undefined') {
    return (window as any).NewsNookNative as NativeBridge | undefined
  }
  return (globalThis as any).NewsNookNative as NativeBridge | undefined
}

function applyChrome(fullScreen: boolean, keepScreenOn: boolean): void {
  const nativeBridge = getNativeBridge()
  // 与原先 craneGame.html 中可用的判断一致（Android JavascriptInterface 未必是 typeof === 'function'）
  if (nativeBridge && nativeBridge.setFullScreen) {
    nativeBridge.setFullScreen(fullScreen)
    if (nativeBridge.setKeepScreenOn) {
      nativeBridge.setKeepScreenOn(keepScreenOn)
    }
    return
  }

  if (typeof document === 'undefined') return
  if (fullScreen) {
    const el = document.documentElement as any
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen
    if (req) {
      Promise.resolve(req.call(el)).catch(() => {})
    }
  } else {
    const doc = document as any
    if (doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement) {
      const ext = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen
      if (ext) {
        Promise.resolve(ext.call(doc)).catch(() => {})
      }
    }
  }
}

/** 进入彩蛋：沉浸全屏 + 常亮。每次调用都即时解析 bridge。 */
export function enterEasterEggScreenChrome(): void {
  applyChrome(true, true)
}

/**
 * 离开彩蛋：必须在「退出时」重新解析 NewsNookNative。
 * 不能闭包 enter 时的 bridge。
 */
export function exitEasterEggScreenChrome(): void {
  applyChrome(false, false)
}
