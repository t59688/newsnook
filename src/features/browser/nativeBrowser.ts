import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { loadUserScripts } from './scripts'
import type { BrowserPreferences } from './browserPreferences'
import type { BrowserContext } from './browserPrivacy'
import type { BrowserImageSnapshot, BrowserImageLoadRequest, BrowserImageData, BrowserImageCancelRequest } from './browserImages'

export interface BrowserState {
  url: string | null
  tabId?: number
  title?: string
  back: boolean
  forward: boolean
  desktop: boolean
  loading?: boolean
  progress?: number
  error?: string | null
  privateMode?: boolean
  userAgent?: string
  recordHistory?: boolean
  activeScriptCount?: number
  matchedScriptCount?: number
}
export interface BrowserTab {
  index: number
  id: number
  title: string
  url: string
  active: boolean
  loading: boolean
  error?: string
  preview?: string
}
export interface BrowserRecoverySession {
  tabs: {url: string; title: string; desktop: boolean}[]
  activeIndex: number
}
export interface BrowserFindResult {tabId: number; activeMatch: number; count: number; done: boolean}
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'desktop' | 'new' | 'home' | 'scanMedia' | 'downloads' | 'scriptMenu'
interface NativeBrowser {
  open(args: {url: string; scripts: ReturnType<typeof loadUserScripts>; embedded: true; visible: boolean; top: number; bottom: number; occludedBottom: number; palette: Record<string, string>; settings: BrowserPreferences; recoverySession?: BrowserRecoverySession}): Promise<void>
  takeRecoverySession(): Promise<{session: BrowserRecoverySession | null}>
  navigate(args: {action: BrowserCommand | 'url'; url?: string}): Promise<void>
  state(): Promise<BrowserState>
  tabs(): Promise<{tabs: BrowserTab[]}>
  activateTab(args: {index: number}): Promise<void>
  removeTab(args: {index: number}): Promise<void>
  setBounds(args: {top: number; bottom: number; occludedBottom: number; visible: boolean; agentOperating: boolean}): Promise<void>
  updateScripts(args: {scripts: ReturnType<typeof loadUserScripts>}): Promise<void>
  updateSettings(args: {settings: BrowserPreferences}): Promise<void>
  updatePalette(args: {palette: Record<string, string>}): Promise<void>
  getBrowserContext(): Promise<BrowserContext>
  findInPage(args: {query: string; tabId?: number}): Promise<void>
  findNext(args: {forward: boolean; tabId?: number}): Promise<void>
  clearFind(): Promise<void>
  clearSiteData(args: {url: string}): Promise<void>
  scanImages(args: {tabId: number; requestId: string}): Promise<BrowserImageSnapshot>
  loadImage(args: BrowserImageLoadRequest): Promise<BrowserImageData>
  cancelImageRequests(args: BrowserImageCancelRequest): Promise<void>
  close(): Promise<void>
  addListener(event: string, callback: (event: any) => void): Promise<PluginListenerHandle>
}

// Startup recovery and the full workspace share one bridge without loading browser media or agents.
export const nativeBrowser = registerPlugin<NativeBrowser>('NewsNookBrowser')

export async function takeBrowserRecoverySession(): Promise<BrowserRecoverySession | null> {
  if (Capacitor.getPlatform() !== 'android') return null
  const result = await nativeBrowser.takeRecoverySession()
  return result.session
}
