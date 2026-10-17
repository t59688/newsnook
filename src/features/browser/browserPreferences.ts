export type BrowserSearchChoice = 'bing' | 'google' | 'baidu' | 'duckduckgo'
export type BrowserUserAgentMode = 'system' | 'desktop' | 'custom'

/** Web-page options are separate from the existing search and layout keys. */
export interface BrowserPreferences {
  userAgentMode: BrowserUserAgentMode
  customUserAgent: string
  textZoom: number
  javaScriptEnabled: boolean
  loadsImagesAutomatically: boolean
  thirdPartyCookiesEnabled: boolean
  mediaPlaybackRequiresUserGesture: boolean
  confirmExternalApps: boolean
}

export const BROWSER_KEYS = {
  history: 'newsnook:browser:history:v1',
  bookmarks: 'newsnook:browser:bookmarks:v1',
  search: 'newsnook:browser:search:v1',
  addressPosition: 'newsnook:browser:address-position:v1',
  hiddenHosts: 'newsnook:browser:hidden-hosts:v1',
  shortcuts: 'newsnook:browser:shortcuts:v1',
  preferences: 'newsnook:browser:preferences:v1',
} as const

export const DEFAULT_BROWSER_PREFERENCES: Readonly<BrowserPreferences> = Object.freeze({
  userAgentMode: 'system',
  customUserAgent: '',
  textZoom: 100,
  javaScriptEnabled: true,
  loadsImagesAutomatically: true,
  thirdPartyCookiesEnabled: false,
  mediaPlaybackRequiresUserGesture: true,
  confirmExternalApps: true,
})

export const BROWSER_ENGINES: Record<BrowserSearchChoice, { name: string; url: string }> = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
}

/** Match the native HTTP header boundary; never accept control characters. */
export function validateBrowserUserAgent(value: string): string | null {
  if (/[^\x20-\x7e]/.test(value)) return '浏览器标识只能包含英文、数字、空格和半角符号'
  const trimmed = value.trim()
  if (!trimmed) return '请输入自定义浏览器标识'
  if (trimmed.length > 512) return '浏览器标识不能超过 512 个字符'
  return null
}

export function normalizeBrowserPreferences(value: unknown): BrowserPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const defaults = DEFAULT_BROWSER_PREFERENCES
  const rawAgent = typeof source.customUserAgent === 'string' ? source.customUserAgent : ''
  const customUserAgent = validateBrowserUserAgent(rawAgent) === null ? rawAgent.trim() : ''
  const userAgentMode = source.userAgentMode === 'desktop' ? 'desktop'
    : source.userAgentMode === 'custom' && customUserAgent ? 'custom' : 'system'
  const boolean = (key: keyof BrowserPreferences): boolean =>
    typeof source[key] === 'boolean' ? source[key] as boolean : defaults[key] as boolean
  return {
    userAgentMode,
    customUserAgent,
    textZoom: typeof source.textZoom === 'number' && Number.isFinite(source.textZoom)
      ? Math.max(75, Math.min(200, Math.round(source.textZoom))) : defaults.textZoom,
    javaScriptEnabled: boolean('javaScriptEnabled'),
    loadsImagesAutomatically: boolean('loadsImagesAutomatically'),
    thirdPartyCookiesEnabled: boolean('thirdPartyCookiesEnabled'),
    mediaPlaybackRequiresUserGesture: boolean('mediaPlaybackRequiresUserGesture'),
    confirmExternalApps: boolean('confirmExternalApps'),
  }
}

export function loadBrowserPreferences(): BrowserPreferences {
  return normalizeBrowserPreferences(readBrowserList(BROWSER_KEYS.preferences))
}

/** One atomic local write. The caller publishes the returned state only on success. */
export function saveBrowserPreferences(value: BrowserPreferences): BrowserPreferences {
  if (value.userAgentMode === 'custom') {
    const error = validateBrowserUserAgent(value.customUserAgent)
    if (error) throw new Error(error)
  }
  const next = normalizeBrowserPreferences(value)
  writeBrowserPreference(BROWSER_KEYS.preferences, next)
  return next
}

export function readBrowserPreference(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function readBrowserList(key: string): unknown {
  try { return JSON.parse(readBrowserPreference(key) || 'null') } catch { return null }
}

/** Write first. Callers only update visible state after persistence succeeds. */
export function writeBrowserPreference(key: string, value: unknown, raw = false): void {
  try {
    localStorage.setItem(key, raw ? String(value) : JSON.stringify(value))
  } catch {
    throw new Error('保存失败，请释放存储空间后重试')
  }
}

export function browserHostLabel(address: string): string {
  if (!address || address === 'about:blank') return '主页'
  try { return new URL(address).hostname.replace(/^www\./, '') } catch { return address }
}

export function resolveBrowserAddress(text: string, engine: BrowserSearchChoice): string | null {
  const input = text.trim()
  if (!input) return null
  const explicitWeb = /^https?:\/\//i.test(input)
  const hostLike = /^(?:localhost|\[[\da-f:]+\]|[^\s/:.]+(?:\.[^\s/:.]+)+)(?::\d+)?(?:[/?#]|$)/iu.test(input)
  if (explicitWeb || hostLike) {
    try {
      const url = new URL(explicitWeb ? input : 'https://' + input)
      return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname && !url.username && !url.password ? url.href : null
    } catch { return null }
  }
  const searchOperator = /^(?:site|intitle|allintitle|inurl|allinurl|intext|allintext|filetype|ext|related|cache|define|before|after):/i.test(input)
  if (!searchOperator && /^[a-z][a-z\d+.-]*:/i.test(input)) return null
  return BROWSER_ENGINES[engine].url + encodeURIComponent(input)
}
