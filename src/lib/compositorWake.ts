import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'

/**
 * 唤醒 Web 容器与子渲染树（如虚拟列表、Canvas）：
 * 1. 更新 documentElement 的 data-wake 标记并读取 offsetHeight 触发无害排版计算；
 * 2. 派发 resize 事件，通知可能处于挂起状态的视图容器重新计算尺寸；
 * 3. 避免给 <html> 施加 translateZ(0)（防止产生空的 3D 合成层）与脆弱的嵌套 rAF。
 */
export function wakeWebViewCompositor(): void {
  const root = document.documentElement
  if (root) {
    root.setAttribute('data-wake', String(Date.now()))
    void root.offsetHeight
  }

  const notify = () => {
    window.dispatchEvent(new Event('resize'))
  }

  notify()
  // 双轨延时调度，兜底部分机型在 Surface 完全就绪后的容器重排
  window.setTimeout(notify, 60)
}

/**
 * 监听 App 从后台切回前台的全部生命周期事件，自动激活渲染流水线，
 * 避免 Android WebView 在 onResume 后由于没有用户输入而保持白屏/未上色状态。
 */
export function initCompositorWakeListener(): () => void {
  let disposed = false
  let appStateHandle: PluginListenerHandle | undefined

  const onWake = () => {
    if (disposed) return
    wakeWebViewCompositor()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      onWake()
    }
  }

  if (Capacitor.isNativePlatform()) {
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        onWake()
      }
    }).then((handle) => {
      if (disposed) {
        void handle.remove()
      } else {
        appStateHandle = handle
      }
    })
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pageshow', onWake)
  window.addEventListener('focus', onWake)

  return () => {
    disposed = true
    if (appStateHandle) {
      void appStateHandle.remove()
    }
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pageshow', onWake)
    window.removeEventListener('focus', onWake)
  }
}
