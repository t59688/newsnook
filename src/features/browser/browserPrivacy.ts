import type { BrowserPreferences } from './browserPreferences'

export interface BrowserPrivacyCapabilities {
  privateMode: boolean
  clearSiteData: boolean
  sharedSiteData?: boolean
  isolatedProfiles?: boolean
  reason?: string
}

/** Privacy is a persistent browser preference in the ordinary application session. */
export interface BrowserContext {
  privateMode: boolean
  settings?: BrowserPreferences
  privacyCapabilities?: BrowserPrivacyCapabilities
}
