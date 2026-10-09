import { useCallback, useEffect, useRef, useState } from 'react'

import { applyNativeChrome } from '../lib/nativeChrome'
import {
  persistRuntimeSecrets,
  sanitizeForPersistence,
  withRuntimeSecrets,
} from '../features/account/secretStore'
import {
  isBergamotTranslationAvailable,
  isLocalTranslationAvailable,
} from '../features/translation/native'
import { isLocalTranslationProviderId } from '../features/translation/types'
import { setRuntimeProxyPrefs } from '../lib/http'
import { setRuntimeWifiOnlyAutoLoadMedia } from '../lib/mediaLoadRuntime'
import { loadPreferences, savePreferences } from '../lib/storage'
import { applyEinkMode } from '../lib/eink'
import {
  applyTheme,
  applyThemeScheme,
  resolveTheme,
  watchSystemTheme,
  type ResolvedTheme,
} from '../lib/theme'
import {
  FONT_FAMILY_OPTIONS,
  normalizePreferences,
  type Preferences,
} from '../sources/preferences'

/** 排版偏好落到 CSS 变量，正文样式仍由 index.css 统一定义 */
function applyTypography(prefs: Preferences): void {
  const { style } = document.documentElement
  const { fontScale, lineHeight, paragraphGap, fontFamily, firstLineIndent } = prefs.typography
  const family = FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamily)

  style.setProperty('--reader-font-size', `${(15.5 * fontScale).toFixed(2)}px`)
  style.setProperty('--reader-line-height', String(lineHeight))
  style.setProperty('--reader-paragraph-gap', `${paragraphGap}em`)
  style.setProperty('--reader-font-family', family?.cssVar ?? 'var(--font-reader-sans)')
  style.setProperty('--reader-text-indent', firstLineIndent ? '2em' : '0')
}

export interface PreferencesApi {
  prefs: Preferences
  /** 「跟随系统」解析后的实际明暗，供界面展示当前状态 */
  resolvedTheme: ResolvedTheme
  update: (updater: (prev: Preferences) => Preferences) => void
  /**
   * 云同步专用入口：整包替换偏好。
   * 与 `update` 的区别只在语义——调用方是同步引擎而不是用户操作，
   * 设备本地设置已在 `features/sync/runtimeAdapter` 里保住，这里照常走归一化与持久化。
   */
  replaceFromSync: (next: Preferences) => void
}

function resolveFallbackProvider(prefs: Preferences): Preferences['translation']['provider'] {
  const { cloud } = prefs.translation
  return cloud.deeplx.endpoint
    ? 'deeplx'
    : cloud.openai.apiKey && cloud.openai.model
      ? 'openai'
      : cloud.google.apiKey
        ? 'google'
        : cloud.azure.apiKey
          ? 'azure'
          : cloud.deepl.apiKey
            ? 'deepl'
            : 'deeplx'
}

export function usePreferences(): PreferencesApi {
  const [prefs, setPrefs] = useState<Preferences>(() => {
    // 原生上 Secret 明文来自 Keystore（BootstrapRoot 已在挂载前回填），普通存储里是空串
    const normalized = withRuntimeSecrets(normalizePreferences(loadPreferences()))
    const provider = normalized.translation.provider
    if (!isLocalTranslationProviderId(provider)) {
      return normalized
    }
    if (provider === 'mlkit' && isLocalTranslationAvailable()) return normalized
    if (provider === 'bergamot' && isBergamotTranslationAvailable()) return normalized

    return {
      ...normalized,
      translation: {
        ...normalized.translation,
        provider: resolveFallbackProvider(normalized),
      },
    }
  })
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(prefs.theme))
  // 首屏主题已由 main.tsx 应用，这里只负责后续变更，避免启动时多一次过渡
  const themeApplied = useRef(false)
  const schemeApplied = useRef(false)

  useEffect(() => {
    // 运行时 prefs 仍带明文，翻译/代理调用方不变；落盘的那份在原生上被净化
    savePreferences(sanitizeForPersistence(prefs))
    void persistRuntimeSecrets(prefs)
    applyTypography(prefs)
    setRuntimeProxyPrefs(prefs.proxy)
    setRuntimeWifiOnlyAutoLoadMedia(Boolean(prefs.wifiOnlyAutoLoadMedia))
  }, [prefs])


  useEffect(() => {
    applyEinkMode(Boolean(prefs.einkMode))
  }, [prefs.einkMode])

  useEffect(() => {
    applyThemeScheme(prefs.scheme, {
      animate: schemeApplied.current && !prefs.einkMode,
      custom: prefs.customScheme,
    })
    schemeApplied.current = true
  }, [prefs.scheme, prefs.customScheme, prefs.einkMode, resolvedTheme])

  useEffect(() => {
    const sync = () => {
      const resolved = applyTheme(prefs.theme, {
        animate: themeApplied.current && !prefs.einkMode,
      })
      themeApplied.current = true
      setResolvedTheme(resolved)
      void applyNativeChrome(resolved)
    }

    sync()
    return prefs.theme === 'system' ? watchSystemTheme(sync) : undefined
  }, [prefs.theme, prefs.einkMode])

  const update = useCallback((updater: (prev: Preferences) => Preferences) => {
    setPrefs((prev) => updater(prev))
  }, [])

  const replaceFromSync = useCallback((next: Preferences) => {
    setPrefs(normalizePreferences(next))
  }, [])

  return { prefs, resolvedTheme, update, replaceFromSync }
}
