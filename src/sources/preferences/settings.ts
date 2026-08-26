/**
 * 外观与阅读行为 setter：主题/配色、墨水屏、Wi-Fi 媒体、预存、排版与代理。
 */

import { schemeSeedColors, type ResolvedTheme, type ThemeMode, type ThemeScheme } from '../../lib/theme'
import { DEFAULT_CUSTOM_SCHEME, type CustomSchemeColors } from '../../lib/customScheme'
import { DEFAULT_PROXY_PREFS, normalizeProxyPrefs } from '../../features/proxy/config'
import type { ProxyPrefs } from '../../features/proxy/types'
import {
  DEFAULT_TYPOGRAPHY,
  normalizePrestoreLimit,
  type Preferences,
  type TypographyPrefs,
} from './model'

export function setThemeMode(prefs: Preferences, theme: ThemeMode): Preferences {
  return prefs.theme === theme ? prefs : { ...prefs, theme }
}

export function setThemeScheme(prefs: Preferences, scheme: ThemeScheme): Preferences {
  return prefs.scheme === scheme ? prefs : { ...prefs, scheme }
}

/**
 * 选择方案；首次选「自定义」时从当前方案复制种子色，让编辑器有可见的起点。
 * （外观页与编辑器都走这个入口）
 */
export function selectThemeScheme(prefs: Preferences, scheme: ThemeScheme): Preferences {
  if (scheme === 'custom' && !prefs.customScheme) {
    return { ...setThemeScheme(prefs, scheme), customScheme: schemeSeedColors(prefs.scheme) }
  }
  return setThemeScheme(prefs, scheme)
}

/** 更新自定义配色中某一档（昼/夜）的底色与强调色 */
export function setCustomSchemeColors(
  prefs: Preferences,
  mode: ResolvedTheme,
  colors: CustomSchemeColors,
): Preferences {
  const current = prefs.customScheme ?? {
    light: { ...DEFAULT_CUSTOM_SCHEME.light },
    dark: { ...DEFAULT_CUSTOM_SCHEME.dark },
  }
  const existing = current[mode]
  if (existing.ink === colors.ink && existing.accent === colors.accent) return prefs
  return { ...prefs, customScheme: { ...current, [mode]: colors } }
}

export function setEinkMode(prefs: Preferences, enabled: boolean): Preferences {
  return prefs.einkMode === enabled ? prefs : { ...prefs, einkMode: enabled }
}

export function setWifiOnlyAutoLoadMedia(prefs: Preferences, enabled: boolean): Preferences {
  return prefs.wifiOnlyAutoLoadMedia === enabled
    ? prefs
    : { ...prefs, wifiOnlyAutoLoadMedia: enabled }
}

export function setPrestoreEnabled(prefs: Preferences, enabled: boolean): Preferences {
  if (prefs.prestore.enabled === enabled) return prefs
  return { ...prefs, prestore: { ...prefs.prestore, enabled } }
}

export function setPrestorePerSourceLimit(prefs: Preferences, perSourceLimit: number): Preferences {
  const normalized = normalizePrestoreLimit(perSourceLimit)
  if (prefs.prestore.perSourceLimit === normalized) return prefs
  return { ...prefs, prestore: { ...prefs.prestore, perSourceLimit: normalized } }
}

export function updateTypography(
  prefs: Preferences,
  patch: Partial<TypographyPrefs>,
): Preferences {
  return { ...prefs, typography: { ...prefs.typography, ...patch } }
}

export function resetTypography(prefs: Preferences): Preferences {
  return { ...prefs, typography: DEFAULT_TYPOGRAPHY }
}

export function updateProxyPrefs(
  prefs: Preferences,
  patch: Partial<ProxyPrefs>,
): Preferences {
  return { ...prefs, proxy: normalizeProxyPrefs({ ...prefs.proxy, ...patch }) }
}

export function resetProxyPrefs(prefs: Preferences): Preferences {
  return { ...prefs, proxy: DEFAULT_PROXY_PREFS }
}

export function setAutoRefreshOnCategorySwitch(
  prefs: Preferences,
  enabled: boolean,
): Preferences {
  return prefs.autoRefreshOnCategorySwitch === enabled
    ? prefs
    : { ...prefs, autoRefreshOnCategorySwitch: enabled }
}

/** 推荐栏总开关：关闭立即隐藏所有预设的「推荐」分类，重新打开且阅读达标后自动恢复 */
export function setRecommendEnabled(prefs: Preferences, enabled: boolean): Preferences {
  return prefs.recommendEnabled === enabled ? prefs : { ...prefs, recommendEnabled: enabled }
}
