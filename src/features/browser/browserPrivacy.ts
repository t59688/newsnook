import type { BrowserPreferences, BrowserSearchChoice } from './browserPreferences'
import type { UserScript } from './scripts'

export interface BrowserPrivacyCapabilities {
  privateMode: boolean
  clearSiteData: boolean
  sharedSiteData?: boolean
  reason?: string
}

export interface BrowserAppearance {
  theme: 'light' | 'dark'
  scheme: string
  eink: boolean
  cssVariables: Record<string, string>
}

/** Only native activity identity authorizes a private session; a URL flag selects its UI. */
export interface BrowserContext {
  privateMode: boolean
  settings?: BrowserPreferences
  scripts?: UserScript[]
  palette?: Record<string, string>
  appearance?: BrowserAppearance
  ui?: {search: BrowserSearchChoice; bottomAddress: boolean}
  url?: string
  privacyCapabilities?: BrowserPrivacyCapabilities
}

export interface BrowserPrivateLaunch {
  settings: BrowserPreferences
  scripts: UserScript[]
  palette: Record<string, string>
  appearance: BrowserAppearance
  ui: {search: BrowserSearchChoice; bottomAddress: boolean}
}

const APPEARANCE_VARIABLE = /^--(?:tone-|font-|ease-|shadow-|radius-|tracking-|leading-)/

export function captureBrowserAppearance(): BrowserAppearance {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const cssVariables: Record<string, string> = {}
  for (let index = 0; index < styles.length; index++) {
    const name = styles.item(index)
    if (APPEARANCE_VARIABLE.test(name)) cssVariables[name] = styles.getPropertyValue(name).trim()
  }
  return {
    theme: root.dataset.theme === 'light' ? 'light' : 'dark',
    scheme: root.dataset.scheme || 'ink',
    eink: root.hasAttribute('data-eink'),
    cssVariables,
  }
}

export function applyBrowserAppearance(appearance?: BrowserAppearance): void {
  const root = document.documentElement
  if (!appearance) return
  root.dataset.theme = appearance.theme === 'light' ? 'light' : 'dark'
  if (/^[a-z][a-z-]{0,30}$/.test(appearance.scheme)) root.dataset.scheme = appearance.scheme
  root.toggleAttribute('data-eink', appearance.eink)
  for (const [name, value] of Object.entries(appearance.cssVariables || {})) {
    if (APPEARANCE_VARIABLE.test(name) && typeof value === 'string' && value.length <= 1024) root.style.setProperty(name, value)
  }
}
