import { useEffect, useLayoutEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'

import App from './App'
import { StartupReadinessProvider } from './components/StartupReadiness'
import { FloatingVideoProvider } from './features/floatingVideo/FloatingVideoProvider'
import { WebAppDownloadBanner } from './components/WebAppDownloadBanner'
import {
  hydrateRuntimeSecrets,
  migrateLegacyNativeSecretsOnce,
} from './features/account/secretStore'
import { initCompositorWakeListener } from './lib/compositorWake'
import { ANDROID_APP_DOWNLOAD_URL, shouldShowWebAppDownloadBanner } from './lib/appDownload'
import { applyNativeChrome } from './lib/nativeChrome'
import { bootMark, bootMeasure, emitFirstUiFallback } from './lib/startupPerf'
import { log } from './lib/logger'
import {
  hydrateNativeStorage,
  loadPreferences,
} from './lib/storage'
import { applyTheme, applyThemeScheme, themeSurface } from './lib/theme'
import { normalizePreferences } from './sources/preferences'


/**
 * 先恢复原生偏好，再挂载业务界面，避免首页用旧镜像反写原生存储。
 *
 * Secret 的两步必须排在 App 挂载之前：先把历史遗留在普通偏好里的密钥搬进 Keystore，
 * 再把 Keystore 里的明文读回内存，`usePreferences` 初始化时才拿得到完整配置，
 * 翻译与代理不会出现「启动后短暂没有密钥」的窗口。
 */
async function bootstrap(): Promise<void> {
  bootMark('hydrate-start')
  await hydrateNativeStorage()
  bootMark('hydrate-done')
  bootMeasure('hydrate', 'hydrate-start', 'hydrate-done')

  await migrateLegacyNativeSecretsOnce()
  await hydrateRuntimeSecrets()
  bootMark('secrets-done')

  const prefs = normalizePreferences(loadPreferences())
  applyThemeScheme(prefs.scheme, { custom: prefs.customScheme })
  applyTheme(prefs.theme)
  // The Android launch theme already owns white splash system bars. Calling
  // SystemBars here crosses the native bridge, forces dark icons in the wrong
  // direction during the white splash, and blocks the React mount. Apply the
  // saved app theme exactly once in endSplashBoot() as the real UI takes over.
  bootMark('initial-theme-ready')
}

let bootstrapPromise: Promise<void> | undefined

function prepareApp(): Promise<void> {
  bootstrapPromise ??= bootstrap()
  return bootstrapPromise
}

/** Remove the document placeholder only after the first real application commit. */
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

function reportInitialSurfaceFrame(): void {
  bootMark('first-ui-frame')
  try {
    const native = (window as Window & {
      NewsNookNative?: { notifyFirstUiPaint?: () => void }
    }).NewsNookNative
    if (typeof native?.notifyFirstUiPaint === 'function') {
      native.notifyFirstUiPaint()
      return
    }
  } catch {
    // A retired native bridge must not delay React.
  }
  // Some WebView providers install the JS interface after initial navigation.
  if (Capacitor.isNativePlatform()) emitFirstUiFallback()
}

/** Render the actual app as soon as its persisted state and secrets are restored.
 * No artificial launch animation, static splash, or time-based mount delay.
 */
export function BootstrapRoot() {
  const [appReady, setAppReady] = useState(false)
  const [appDownloadDismissed, setAppDownloadDismissed] = useState(false)

  useLayoutEffect(() => {
    bootMark('react-bootstrap')
  }, [])

  // Keep the minimal document background only until the real app is committed.
  useLayoutEffect(() => {
    if (!appReady) return
    clearBootSplashShell()
    bootMark('first-app-commit')
  }, [appReady])

  useEffect(() => {
    const unbindWake = initCompositorWakeListener()
    let active = true
    void prepareApp().then(() => {
      if (!active) return
      setAppReady(true)
      bootMark('app-ready')
      void endSplashBoot()
    }).catch((error) => {
      // Do not mount with stale native preferences/secrets on an initialization failure.
      log.boot.error('bootstrap failed', error)
    })
    return () => {
      active = false
      unbindWake()
    }
  }, [])

  const showAppDownload = appReady && !appDownloadDismissed &&
    shouldShowWebAppDownloadBanner(Capacitor.isNativePlatform())

  // The web-only download hint must never cover navigation after the reader
  // starts using the app. Keep the link actionable until the first app input.
  useEffect(() => {
    if (!showAppDownload) return
    const dismissOnAppInteraction = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-app-download-banner]')) return
      setAppDownloadDismissed(true)
    }
    document.addEventListener('pointerdown', dismissOnAppInteraction, true)
    return () => document.removeEventListener('pointerdown', dismissOnAppInteraction, true)
  }, [showAppDownload])

  return (
    <>
      {appReady && (
        <StartupReadinessProvider onReady={reportInitialSurfaceFrame}>
          <FloatingVideoProvider><App /></FloatingVideoProvider>
        </StartupReadinessProvider>
      )}
      {showAppDownload && (
        <WebAppDownloadBanner
          href={ANDROID_APP_DOWNLOAD_URL}
          onDismiss={() => setAppDownloadDismissed(true)}
        />
      )}
    </>
  )
}
