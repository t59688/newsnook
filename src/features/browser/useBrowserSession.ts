import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { loadUserScripts } from './scripts'
import { reduceBrowserMedia, type BrowserMediaEvent, type BrowserMediaTab } from './browserMedia'
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from './browserPreferences'
import type { BrowserContext, BrowserPrivateLaunch } from './browserPrivacy'
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
}
export interface BrowserTab {
  index: number
  id: number
  title: string
  url: string
  active: boolean
  loading: boolean
  error?: string
}
export interface BrowserRecoverySession {
  tabs: {url: string; title: string; desktop: boolean}[]
  activeIndex: number
}
export interface BrowserFindResult {tabId: number; activeMatch: number; count: number; done: boolean}
export type BrowserCommand = 'back' | 'forward' | 'reload' | 'stop' | 'desktop' | 'new' | 'home' | 'scanMedia' | 'downloads' | 'scriptMenu'
interface NativeBrowser {
  open(args: {url: string; scripts: ReturnType<typeof loadUserScripts>; embedded: true; visible: boolean; top: number; bottom: number; palette: Record<string, string>; settings: BrowserPreferences; recoverySession?: BrowserRecoverySession}): Promise<void>
  takeRecoverySession(): Promise<{session: BrowserRecoverySession | null}>
  navigate(args: {action: BrowserCommand | 'url'; url?: string}): Promise<void>
  state(): Promise<BrowserState>
  tabs(): Promise<{tabs: BrowserTab[]}>
  activateTab(args: {index: number}): Promise<void>
  removeTab(args: {index: number}): Promise<void>
  setBounds(args: {top: number; bottom: number; visible: boolean}): Promise<void>
  updateScripts(args: {scripts: ReturnType<typeof loadUserScripts>}): Promise<void>
  updateSettings(args: {settings: BrowserPreferences}): Promise<void>
  getBrowserContext(): Promise<BrowserContext>
  openPrivate(args: BrowserPrivateLaunch): Promise<void>
  closePrivate(): Promise<void>
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
const nativeBrowser = registerPlugin<NativeBrowser>('NewsNookBrowser')
const EMPTY: BrowserState = {url: null, back: false, forward: false, desktop: false}

export async function takeBrowserRecoverySession(): Promise<BrowserRecoverySession | null> {
  if (Capacitor.getPlatform() !== 'android') return null
  const result = await nativeBrowser.takeRecoverySession()
  return result.session
}
export async function getBrowserContext(): Promise<BrowserContext> {
  if (Capacitor.getPlatform() !== 'android') return {privateMode: false, privacyCapabilities: {privateMode: false, clearSiteData: false}}
  return nativeBrowser.getBrowserContext()
}
export function openPrivateBrowser(args: BrowserPrivateLaunch): Promise<void> { return nativeBrowser.openPrivate(args) }
export function closePrivateBrowser(): Promise<void> { return nativeBrowser.closePrivate() }

export function browserThemePalette(): Record<string, string> {
  const css = getComputedStyle(document.documentElement)
  const tones: Record<string, string> = {ink: 'ink', surface: 'ink-raised', paper: 'paper', muted: 'paper-muted', accent: 'cinnabar', outline: 'paper-faint'}
  const palette: Record<string, string> = {}
  for (const [key, tone] of Object.entries(tones)) palette[key] = css.getPropertyValue('--tone-' + tone).trim()
  return palette
}

/** Owns the native session. UI overlays never recreate a website or its script context. */
export function useBrowserSession(
  viewport: RefObject<HTMLDivElement | null>,
  covered: boolean,
  onVisit: (url: string, title: string) => void,
  bottomAddress: boolean,
  recoverySession?: BrowserRecoverySession,
  options: {settings?: BrowserPreferences; privateContext?: BrowserContext} = {},
) {
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [mediaTabs, setMediaTabs] = useState<ReadonlyMap<number, BrowserMediaTab>>(() => new Map())
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [images, setImages] = useState<BrowserImageSnapshot | null>(null)
  const [scanningImages, setScanningImages] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [findResult, setFindResult] = useState<BrowserFindResult | null>(null)
  const live = useRef(false)
  const epoch = useRef(0)
  const opened = useRef(false)
  const recoveryStarted = useRef(false)
  const closing = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pendingCount = useRef(0)
  const refreshSequence = useRef(0)
  const imageSequence = useRef(0)
  const imageRequest = useRef<{tabId: number; requestId: string} | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const settingsRef = useRef(options.settings ?? DEFAULT_BROWSER_PREFERENCES)
  settingsRef.current = options.settings ?? DEFAULT_BROWSER_PREFERENCES
  const contextRef = useRef(options.privateContext)
  contextRef.current = options.privateContext
  const visit = useRef(onVisit)
  visit.current = onVisit

  const getBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect ? {top: Math.max(0, rect.top), bottom: Math.max(0, window.innerHeight - rect.bottom)} : {top: 0, bottom: 56}
  }, [viewport])

  const invalidateImages = useCallback(() => {
    ++imageSequence.current
    const request = imageRequest.current
    imageRequest.current = null
    if (request) void nativeBrowser.cancelImageRequests(request).catch(() => undefined)
    setImages(null)
    setScanningImages(false)
    setImageError(null)
  }, [])

  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current
    const generation = epoch.current
    const [next, result] = await Promise.all([nativeBrowser.state(), nativeBrowser.tabs()])
    if (!live.current || generation !== epoch.current || request !== refreshSequence.current) return
    opened.current = result.tabs.length > 0
    setReady(opened.current)
    if (stateRef.current.tabId !== next.tabId) {invalidateImages(); setFindResult(null)}
    stateRef.current = next
    setState(next)
    setTabs(result.tabs)
    const ids = new Set(result.tabs.map(tab => tab.id))
    setMediaTabs(previous => {
      if ([...previous.keys()].every(id => ids.has(id))) return previous
      return new Map([...previous].filter(([id]) => ids.has(id)))
    })
  }, [invalidateImages])

  useEffect(() => {
    live.current = true
    closing.current = false
    ++epoch.current
    const handles: PluginListenerHandle[] = []
    let disposed = false
    const listen = (name: string, callback: (event: any) => void) => {
      void nativeBrowser.addListener(name, event => {
        if (!disposed && live.current) callback(event)
      }).then(handle => {
        if (disposed) void handle.remove()
        else handles.push(handle)
      }).catch(() => {
        if (!disposed) setError('浏览器连接失败，请返回后重试')
      })
    }
    if (Capacitor.getPlatform() === 'android') {
      listen('navigation', (event: BrowserState & {phase?: string}) => {
        ++refreshSequence.current
        if (event.phase === 'start' || (event.tabId != null && event.tabId !== stateRef.current.tabId)) {
          invalidateImages()
          setFindResult(null)
        }
        setState(previous => {
          const next = {...previous, ...event, loading: event.loading ?? event.phase === 'start'}
          stateRef.current = next
          return next
        })
        if (!contextRef.current?.privateMode && !event.privateMode && event.url && /^https?:\/\//i.test(event.url) && event.phase === 'end' && !event.error) {
          visit.current(event.url, event.title || event.url)
        }
        if (opened.current) void refresh().catch(() => undefined)
      })
      listen('mediaEvent', (event: BrowserMediaEvent) => setMediaTabs(previous => reduceBrowserMedia(previous, event)))
      listen('findResult', (event: BrowserFindResult) => {
        if (event.tabId === stateRef.current.tabId) setFindResult(event)
      })
      listen('browserError', (event: {tabId?: number; message?: string; url?: string}) => {
        setState(previous => previous.tabId === event.tabId
          ? {...previous, loading: false, error: event.message || '网页加载失败，请刷新重试'} : previous)
        void refresh().catch(() => undefined)
      })
      listen('closed', () => {
        if (!opened.current) return
        opened.current = false
        setReady(false)
        stateRef.current = EMPTY
        setState(EMPTY)
        setTabs([])
        setMediaTabs(new Map())
        invalidateImages()
        setFindResult(null)
      })
    }
    return () => {
      disposed = true
      live.current = false
      // These are lifetime counters, not DOM refs: cleanup must invalidate the latest work.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++epoch.current
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++imageSequence.current
      const request = imageRequest.current
      if (request) void nativeBrowser.cancelImageRequests(request).catch(() => undefined)
      opened.current = false
      handles.forEach(handle => { void handle.remove().catch(() => undefined) })
      if (!closing.current) void nativeBrowser.close().catch(() => undefined)
    }
  }, [refresh, invalidateImages])

  const visible = ready && /^https?:\/\//i.test(state.url || '') && !state.error && !covered
  useLayoutEffect(() => {
    if (!ready) return
    const sync = () => { void nativeBrowser.setBounds({...getBounds(), visible}).catch(() => undefined) }
    sync()
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    if (viewport.current) observer?.observe(viewport.current)
    return () => {
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      observer?.disconnect()
    }
  }, [ready, visible, getBounds, viewport, bottomAddress])

  const enqueue = useCallback((operation: () => Promise<void>): Promise<boolean> => {
    const generation = epoch.current
    pendingCount.current++
    setPending(true)
    const result = queue.current.catch(() => undefined).then(async () => {
      try {
        if (!live.current || closing.current || generation !== epoch.current) return false
        setError('')
        await operation()
        if (!live.current || generation !== epoch.current) return false
        await refresh()
        return true
      } catch (failure) {
        if (live.current && generation === epoch.current) setError(failure instanceof Error ? failure.message : '操作失败，请重试')
        return false
      } finally {
        pendingCount.current = Math.max(0, pendingCount.current - 1)
        if (live.current && generation === epoch.current) setPending(pendingCount.current > 0)
      }
    })
    queue.current = result
    return result
  }, [refresh])

  const ensureOpen = useCallback(async (url: string, snapshot?: BrowserRecoverySession) => {
    const generation = epoch.current
    if (Capacitor.getPlatform() !== 'android') throw new Error('请在 Android 应用中打开网页')
    if (opened.current && !snapshot) {
      await nativeBrowser.navigate({action: 'url', url})
    } else {
      const context = contextRef.current
      await nativeBrowser.open({
        url, scripts: context?.privateMode ? context.scripts ?? [] : loadUserScripts().filter(script => script.enabled),
        settings: settingsRef.current,
        embedded: true, visible: false, ...getBounds(), palette: context?.palette ?? browserThemePalette(),
        ...(!context?.privateMode && snapshot ? {recoverySession: snapshot} : {}),
      })
      if (live.current && !closing.current && generation === epoch.current) opened.current = true
    }
  }, [getBounds])

  useEffect(() => {
    if (!recoverySession || contextRef.current?.privateMode || recoveryStarted.current) return
    void enqueue(async () => {
      if (recoveryStarted.current) return
      recoveryStarted.current = true
      const url = recoverySession.tabs[recoverySession.activeIndex]?.url || recoverySession.tabs[0]?.url || 'about:blank'
      await ensureOpen(url, recoverySession)
    })
  }, [enqueue, ensureOpen, recoverySession])

  const open = useCallback((url: string) => enqueue(() => ensureOpen(url)), [enqueue, ensureOpen])
  const command = useCallback((action: BrowserCommand): Promise<boolean> => {
    if (action === 'stop') {
      const generation = epoch.current
      if (!live.current || closing.current) return Promise.resolve(false)
      return nativeBrowser.navigate({action}).then(async () => {
        if (!live.current || generation !== epoch.current) return false
        await refresh()
        return true
      }).catch(failure => {
        if (live.current && generation === epoch.current) setError(failure instanceof Error ? failure.message : '停止加载失败，请重试')
        return false
      })
    }
    return enqueue(async () => {
      if (action === 'new' && !opened.current) { await ensureOpen('about:blank'); return }
      if (action === 'downloads' || opened.current) await nativeBrowser.navigate({action})
    })
  }, [enqueue, ensureOpen, refresh])

  const activate = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.activateTab({index: tab.index})), [enqueue])
  const remove = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.removeTab({index: tab.index})), [enqueue])
  const updateScripts = useCallback(() => enqueue(async () => {
    if (opened.current && !contextRef.current?.privateMode) await nativeBrowser.updateScripts({scripts: loadUserScripts().filter(script => script.enabled)})
  }), [enqueue])
  const updateSettings = useCallback((settings: BrowserPreferences) => enqueue(async () => {
    await nativeBrowser.updateSettings({settings})
  }), [enqueue])
  const clearSiteData = useCallback((url: string) => enqueue(async () => {
    if (!url) throw new Error('请先打开需要清理的网站')
    await nativeBrowser.clearSiteData({url})
  }), [enqueue])

  const scanImages = useCallback(async () => {
    const tabId = stateRef.current.tabId
    if (tabId == null) return
    const sequence = ++imageSequence.current
    const generation = epoch.current
    const previous = imageRequest.current
    if (previous) void nativeBrowser.cancelImageRequests(previous).catch(() => undefined)
    const request = {tabId, requestId: String(sequence) + '-' + Date.now()}
    imageRequest.current = request
    setImageError(null)
    setScanningImages(true)
    try {
      const snapshot = await nativeBrowser.scanImages(request)
      if (!live.current || generation !== epoch.current || sequence !== imageSequence.current || tabId !== stateRef.current.tabId) return
      if (snapshot.tabId !== tabId || snapshot.requestId !== request.requestId) throw new Error('网页已变化，请重新扫描')
      setImages(snapshot)
    } catch (failure) {
      if (live.current && generation === epoch.current && sequence === imageSequence.current) setImageError(failure instanceof Error ? failure.message : '图片扫描失败，请重试')
    } finally {
      if (live.current && generation === epoch.current && sequence === imageSequence.current) setScanningImages(false)
    }
  }, [])
  const loadImage = useCallback(async (request: BrowserImageLoadRequest): Promise<BrowserImageData> => {
    if (!live.current || closing.current || request.tabId !== stateRef.current.tabId) throw new Error('网页已变化，请重新扫描')
    const generation = epoch.current
    const sequence = imageSequence.current
    const image = await nativeBrowser.loadImage(request)
    if (!live.current || generation !== epoch.current || sequence !== imageSequence.current || request.tabId !== stateRef.current.tabId) throw new Error('图片请求已取消')
    return image
  }, [])
  const cancelImageRequests = useCallback((request: BrowserImageCancelRequest) => nativeBrowser.cancelImageRequests(request).catch(() => undefined), [])
  const findInPage = useCallback((query: string) => {
    setFindResult(null)
    return nativeBrowser.findInPage({query, tabId: stateRef.current.tabId}).catch(() => { if (live.current) setError('查找失败，请重试') })
  }, [])
  const findNext = useCallback((forward: boolean) => nativeBrowser.findNext({forward, tabId: stateRef.current.tabId}).catch(() => undefined), [])
  const clearFind = useCallback(() => {
    setFindResult(null)
    void nativeBrowser.clearFind().catch(() => undefined)
  }, [])
  const close = useCallback(async () => {
    if (closing.current) return
    closing.current = true
    ++epoch.current
    ++imageSequence.current
    opened.current = false
    await nativeBrowser.close().catch(() => undefined)
  }, [])

  return {state, tabs, mediaTabs, ready, pending, error, setError, open, command, activate, remove, updateScripts, updateSettings, clearSiteData,
    images, scanningImages, imageError, scanImages, loadImage, cancelImageRequests, invalidateImages, findResult, findInPage, findNext, clearFind, close}
}
