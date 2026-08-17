import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

import App from './App'
import { StartupSplash, type SplashMode } from './components/StartupSplash'
import { initCompositorWakeListener } from './lib/compositorWake'
import { applyNativeChrome } from './lib/nativeChrome'
import { bootMark, bootMeasure } from './lib/startupPerf'
import {
  hasSeenStartupSplash,
  hydrateNativeStorage,
  loadPreferences,
  markStartupSplashSeen,
} from './lib/storage'
import { applyTheme, applyThemeScheme, themeSurface } from './lib/theme'
import { normalizePreferences } from './sources/preferences'

const SPLASH_ENABLED = Capacitor.getPlatform() === 'android' || import.meta.env.DEV
/** 启动页淡出时长，与 StartupSplash.css 的 --splash-exit 保持一致 */
const SPLASH_EXIT_MS = 320

/** 先恢复原生偏好，再挂载业务界面，避免首页用旧镜像反写原生存储。 */
async function bootstrap(): Promise<void> {
  bootMark('hydrate-start')
  await hydrateNativeStorage()
  bootMark('hydrate-done')
  bootMeasure('hydrate', 'hydrate-start', 'hydrate-done')
  const prefs = normalizePreferences(loadPreferences())
  applyThemeScheme(prefs.scheme, { custom: prefs.customScheme })
  const theme = applyTheme(prefs.theme)
  await applyNativeChrome(theme)
  bootMark('chrome-done')
}

let bootstrapPromise: Promise<void> | undefined

function prepareApp(): Promise<void> {
  bootstrapPromise ??= bootstrap()
  return bootstrapPromise
}

/** 摘掉 HTML 深色壳；保留 data-boot=splash，直到 React 启动页交还后再改系统栏颜色 */
function clearBootSplashShell(): void {
  document.getElementById('boot-splash')?.remove()
  delete document.documentElement.dataset.bootSplash
}

/** 启动页结束：允许按真实主题着色状态栏 / theme-color */
async function endSplashBoot(): Promise<void> {
  delete document.documentElement.dataset.boot
  const prefs = normalizePreferences(loadPreferences())
  applyThemeScheme(prefs.scheme, { custom: prefs.customScheme })
  const theme = applyTheme(prefs.theme)
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', themeSurface(prefs.scheme, theme))
  await applyNativeChrome(theme)
}

export function BootstrapRoot() {
  const [appReady, setAppReady] = useState(false)
  const [splashComplete, setSplashComplete] = useState(false)
  const [splashDetached, setSplashDetached] = useState(false)
  const [splashMode] = useState<SplashMode>(() =>
    hasSeenStartupSplash() ? 'static' : 'full',
  )
  // 启动页放完时 App 可能仍在恢复原生偏好，此时撤掉启动页只会露出空屏
  const splashLeaving = splashComplete && appReady
  const showSplash = SPLASH_ENABLED && !splashDetached

  // React 启动页（含静态竖排）一旦进入 DOM，立刻摘掉 HTML 深色壳（仍保留 data-boot）
  useLayoutEffect(() => {
    bootMark('react-splash')
    if (!SPLASH_ENABLED) {
      clearBootSplashShell()
      void endSplashBoot()
      setSplashComplete(true)
      setSplashDetached(true)
      return
    }
    clearBootSplashShell()
  }, [])

  useEffect(() => {
    if (!splashLeaving) return

    bootMark('splash-leaving')
    const timer = window.setTimeout(() => {
      setSplashDetached(true)
      bootMark('splash-detached')
      void endSplashBoot()
    }, SPLASH_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [splashLeaving])

  useEffect(() => {
    if (SPLASH_ENABLED) markStartupSplashSeen()

    const unbindWake = initCompositorWakeListener()
    let active = true
    let delayTimer = 0

    void prepareApp().finally(() => {
      if (!active) return

      if (splashMode === 'full') {
        // 首次完整动效：前 2.4 秒是高强度的粒子公转与吸入渲染，
        // 错峰将 App 后台挂载与大批量网络请求延后至平静整理阶段启动，彻底消除 JS 主线程争抢导致的动画掉帧
        delayTimer = window.setTimeout(() => {
          if (active) {
            setAppReady(true)
            bootMark('app-ready')
          }
        }, 2400)
      } else {
        setAppReady(true)
        bootMark('app-ready')
      }
    })

    return () => {
      active = false
      if (delayTimer) window.clearTimeout(delayTimer)
      unbindWake()
    }
  }, [splashMode])

  const finishSplash = useCallback(() => {
    bootMark('splash-complete')
    setSplashComplete(true)
  }, [])

  return (
    <>
      {appReady && <App />}
      {showSplash && (
        <StartupSplash
          mode={splashMode}
          leaving={splashLeaving}
          onComplete={finishSplash}
        />
      )}
    </>
  )
}
