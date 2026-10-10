import { Capacitor } from '@capacitor/core'
import { BROWSER_UA } from '../../sources/registry/model'

/**
 * Native HTML parsing must use the same request identity for detection and
 * subsequent catalog pages. A device's WebView UA is newer than the fallback
 * UA and is the nearest available approximation of its installed browser.
 */
export function normalizeCatalogWebViewAgent(raw: string): string | undefined {
  if (!raw || raw.length > 512 || !/Android(?:\s|;)/i.test(raw) ||
      !/AppleWebKit\//i.test(raw) || !/Chrome\/\d+/i.test(raw)) return undefined
  return raw.replace(/;\s*wv(?=[;)])/gi, '').replace(/\s+Version\/\d+(?:\.\d+)*/gi, '').trim()
}

export function catalogUserAgent(configuredUserAgent?: string): string {
  if (configuredUserAgent != null) return configuredUserAgent
  if (Capacitor.isNativePlatform() && typeof navigator !== 'undefined') {
    const browserLike = normalizeCatalogWebViewAgent(navigator.userAgent)
    if (browserLike) return browserLike
  }
  return BROWSER_UA
}

/** Keep probing, catalog navigation and detail requests on one native client. */
export function catalogRequestOptions(configuredUserAgent?: string) {
  return { userAgent: catalogUserAgent(configuredUserAgent), nativeTransport: 'okhttp' as const }
}
