import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { loadUserScripts } from './scripts'
import { reduceBrowserMedia, type BrowserMediaEvent, type BrowserMediaTab } from './browserMedia'
import { DEFAULT_BROWSER_PREFERENCES, type BrowserPreferences } from './browserPreferences'
import { nativeBrowser, type BrowserState, type BrowserTab, type BrowserRecoverySession, type BrowserFindResult, type BrowserCommand } from './nativeBrowser'
import type { BrowserContext } from './browserPrivacy'
import type { BrowserImageSnapshot, BrowserImageLoadRequest, BrowserImageData, BrowserImageCancelRequest } from './browserImages'

export { takeBrowserRecoverySession, type BrowserState, type BrowserTab, type BrowserRecoverySession, type BrowserFindResult, type BrowserCommand } from './nativeBrowser'

const EMPTY: BrowserState = {url: null, back: false, forward: false, desktop: false}
type InitialBrowserEntry = string | BrowserRecoverySession | null

export async function getBrowserContext(): Promise<BrowserContext> {
  if (Capacitor.getPlatform() !== 'android') return {privateMode: false, privacyCapabilities: {privateMode: false, clearSiteData: false}}
  return nativeBrowser.getBrowserContext()
}

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
  options: {settings?: BrowserPreferences; initialUrl?: string; agentSheetRef?: RefObject<HTMLElement | null>; agentSheetVisible?: boolean; agentOperating?: boolean} = {},
) {
  const initialEntry: InitialBrowserEntry = options.initialUrl && /^https?:\/\//i.test(options.initialUrl) ? options.initialUrl
    : recoverySession && !(options.settings ?? DEFAULT_BROWSER_PREFERENCES).privateMode ? recoverySession : null
  const [state, setState] = useState<BrowserState>(EMPTY)
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  const [mediaTabs, setMediaTabs] = useState<ReadonlyMap<number, BrowserMediaTab>>(() => new Map())
  const [ready, setReady] = useState(false)
  const [settledInitialEntry, setSettledInitialEntry] = useState<InitialBrowserEntry>(null)
  const initialSessionSettled = initialEntry === null || settledInitialEntry === initialEntry
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
  const initialSession = useRef({entry: initialEntry, settled: initialEntry === null, commandAcknowledged: false, snapshot: -1, hasTabs: false, visible: null as boolean | null})
  const coveredRef = useRef(covered)
  coveredRef.current = covered
  const imageSequence = useRef(0)
  const imageRequest = useRef<{tabId: number; requestId: string} | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const settingsRef = useRef(options.settings ?? DEFAULT_BROWSER_PREFERENCES)
  settingsRef.current = options.settings ?? DEFAULT_BROWSER_PREFERENCES
  const visit = useRef(onVisit)
  visit.current = onVisit

  useLayoutEffect(() => {
    if (initialSession.current.entry === initialEntry) return
    initialSession.current = {entry: initialEntry, settled: initialEntry === null, commandAcknowledged: false, snapshot: -1, hasTabs: false, visible: null}
  }, [initialEntry])

  const getBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    if (!rect) return {top: 0, bottom: 56, occludedBottom: 0}
    const top = Math.max(0, rect.top)
    const bottom = Math.max(0, window.innerHeight - rect.bottom)
    const sheetTop = options.agentSheetVisible && options.agentSheetRef?.current
      ? options.agentSheetRef.current.getBoundingClientRect().top : rect.bottom
    // The native frame keeps the FULL browser viewport. Its drawing and hit testing
    // are clipped below the floating workbench; DOM geometry and screenshots stay stable.
    const occludedBottom = Math.max(0, rect.bottom - Math.max(top, sheetTop))
    return {top, bottom, occludedBottom}
  }, [viewport, options.agentSheetRef, options.agentSheetVisible])

  const invalidateImages = useCallback(() => {
    ++imageSequence.current
    const request = imageRequest.current
    imageRequest.current = null
    if (request) void nativeBrowser.cancelImageRequests(request).catch(() => undefined)
    setImages(null)
    setScanningImages(false)
    setImageError(null)
  }, [])

  const settleInitialSession = useCallback((entry?: InitialBrowserEntry) => {
    if (!live.current || closing.current || initialSession.current.settled) return
    if (entry !== undefined && entry !== initialSession.current.entry) return
    initialSession.current.settled = true
    setSettledInitialEntry(initialSession.current.entry)
  }, [])
  const checkInitialSession = useCallback(() => {
    const initial = initialSession.current
    if (initial.settled || !initial.commandAcknowledged || pendingCount.current || initial.snapshot !== refreshSequence.current) return
    const expectedVisible = /^https?:\/\//i.test(stateRef.current.url || '') && !stateRef.current.error && !coveredRef.current
    if (initial.hasTabs && initial.visible !== expectedVisible) return
    // An initial session needs a local command acknowledgement, its latest snapshot,
    // and the native visibility acknowledgement. Website loading is independent.
    settleInitialSession()
  }, [settleInitialSession])

  const refresh = useCallback(async () => {
    const request = ++refreshSequence.current
    const generation = epoch.current
    try {
      const [next, result] = await Promise.all([nativeBrowser.state(), nativeBrowser.tabs()])
      if (!live.current || generation !== epoch.current || request !== refreshSequence.current) return
      opened.current = result.tabs.length > 0
      setReady(opened.current)
      if (stateRef.current.tabId !== next.tabId) {invalidateImages(); setFindResult(null)}
      stateRef.current = next
      setState(next)
      setTabs(result.tabs)
      initialSession.current.snapshot = request
      initialSession.current.hasTabs = opened.current
      const ids = new Set(result.tabs.map(tab => tab.id))
      setMediaTabs(previous => {
        if ([...previous.keys()].every(id => ids.has(id))) return previous
        return new Map([...previous].filter(([id]) => ids.has(id)))
      })
      checkInitialSession()
    } catch (failure) {
      // A navigation event can supersede the command's refresh. Its latest local
      // read must still resolve initialization when the bridge reports a failure.
      if (live.current && generation === epoch.current && request === refreshSequence.current && !initialSession.current.settled) {
        setError(failure instanceof Error ? failure.message : '浏览器状态读取失败，请重试')
        settleInitialSession()
      }
      throw failure
    }
  }, [invalidateImages, checkInitialSession, settleInitialSession])

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
        if (!disposed) {
          setError('浏览器连接失败，请返回后重试')
          settleInitialSession()
        }
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
        if (!settingsRef.current.privateMode && !event.privateMode && event.recordHistory !== false && event.url && /^https?:\/\//i.test(event.url) && event.phase === 'end' && !event.error) {
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
        settleInitialSession()
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
  }, [refresh, invalidateImages, settleInitialSession])

  const visible = ready && /^https?:\/\//i.test(state.url || '') && !state.error && !covered
  useLayoutEffect(() => {
    if (!ready) return
    const generation = epoch.current
    type Bounds = {top: number; bottom: number; occludedBottom: number; visible: boolean; agentOperating: boolean}
    const equal = (a: Bounds | null, b: Bounds) =>
      a?.top === b.top && a.bottom === b.bottom && a.occludedBottom === b.occludedBottom && a.visible === b.visible && a.agentOperating === b.agentOperating
    let stopped = false
    let sending = false
    let frame: number | null = null
    let timeoutFrame = false
    let desired: Bounds | null = null
    let lastSent: Bounds | null = null

    // 原生 WebView 更新会触发 Android UI 线程重布局。把连续的 ResizeObserver
    // 更新合并为每帧最新尺寸，且最多只保留一个进行中的桥接请求，避免拖动时积压旧位置。
    const flush = () => {
      if (stopped || sending || !desired) return
      const next = desired
      desired = null
      if (equal(lastSent, next)) return
      lastSent = next
      sending = true
      initialSession.current.visible = null
      void nativeBrowser.setBounds(next).then(() => {
        if (!stopped && live.current && generation === epoch.current && (!desired || equal(next, desired))) {
          initialSession.current.visible = next.visible
          checkInitialSession()
        }
      }).catch(failure => {
        if (lastSent === next) lastSent = null
        if (!stopped && live.current && generation === epoch.current && !initialSession.current.settled) {
          setError(failure instanceof Error ? failure.message : '浏览器显示失败，请重试')
          settleInitialSession()
        }
      }).finally(() => {
        sending = false
        flush()
      })
    }
    const sync = () => {
      if (stopped) return
      const bounds = getBounds()
      desired = {top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), occludedBottom: Math.round(bounds.occludedBottom), visible, agentOperating: Boolean(options.agentOperating)}
      flush()
    }
    const schedule = () => {
      if (stopped || frame !== null) return
      timeoutFrame = typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden'
      frame = timeoutFrame
        ? window.setTimeout(() => { frame = null; sync() }, 16)
        : requestAnimationFrame(() => { frame = null; sync() })
    }
    // 显隐变化必须立即生效，不能因为拖拽节流让不可见 WebView 盖住按钮。
    sync()
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (viewport.current) observer?.observe(viewport.current)
    if (options.agentSheetVisible && options.agentSheetRef?.current) observer?.observe(options.agentSheetRef.current)
    return () => {
      stopped = true
      if (frame !== null) {
        if (timeoutFrame) window.clearTimeout(frame)
        else cancelAnimationFrame(frame)
      }
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [ready, visible, initialEntry, getBounds, viewport, bottomAddress, options.agentSheetVisible, options.agentSheetRef, options.agentOperating, checkInitialSession, settleInitialSession])

  const enqueue = useCallback((operation: () => Promise<void>, throwOnError = false, entry?: InitialBrowserEntry): Promise<boolean> => {
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
        if (live.current && generation === epoch.current) {
          setError(failure instanceof Error ? failure.message : '操作失败，请重试')
          settleInitialSession(entry)
        }
        if (throwOnError) throw failure
        return false
      } finally {
        pendingCount.current = Math.max(0, pendingCount.current - 1)
        if (live.current && generation === epoch.current) {
          setPending(pendingCount.current > 0)
          checkInitialSession()
        }
      }
    })
    queue.current = result
    return result
  }, [refresh, checkInitialSession, settleInitialSession])

  const ensureOpen = useCallback(async (url: string, snapshot?: BrowserRecoverySession) => {
    const generation = epoch.current
    if (Capacitor.getPlatform() !== 'android') throw new Error('请在 Android 应用中打开网页')
    if (opened.current && !snapshot) {
      await nativeBrowser.updateScripts({scripts: loadUserScripts().filter(script => script.enabled)})
      await nativeBrowser.navigate({action: 'url', url})
    } else {
      initialSession.current.visible = null
      await nativeBrowser.open({
        url, scripts: loadUserScripts().filter(script => script.enabled),
        settings: settingsRef.current,
        embedded: true, visible: false, ...getBounds(), palette: browserThemePalette(),
        ...(!settingsRef.current.privateMode && snapshot ? {recoverySession: snapshot} : {}),
      })
      if (live.current && !closing.current && generation === epoch.current) opened.current = true
    }
    if (live.current && !closing.current && generation === epoch.current && initialSession.current.entry === (snapshot ?? url)) {
      initialSession.current.commandAcknowledged = true
    }
  }, [getBounds])

  useEffect(() => {
    if (!recoverySession || settingsRef.current.privateMode || recoveryStarted.current) return
    void enqueue(async () => {
      if (recoveryStarted.current) return
      recoveryStarted.current = true
      const url = recoverySession.tabs[recoverySession.activeIndex]?.url || recoverySession.tabs[0]?.url || 'about:blank'
      await ensureOpen(url, recoverySession)
    }, false, recoverySession)
  }, [enqueue, ensureOpen, recoverySession])

  const open = useCallback((url: string, throwOnError = false) => enqueue(() => ensureOpen(url), throwOnError, url), [enqueue, ensureOpen])
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
      if (action === 'reload' && opened.current) await nativeBrowser.updateScripts({scripts: loadUserScripts().filter(script => script.enabled)})
      if (action === 'downloads' || opened.current) await nativeBrowser.navigate({action})
    })
  }, [enqueue, ensureOpen, refresh])

  const activate = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.activateTab({index: tab.index})), [enqueue])
  const remove = useCallback((tab: BrowserTab) => enqueue(() => nativeBrowser.removeTab({index: tab.index})), [enqueue])
  const updateScripts = useCallback(() => enqueue(async () => {
    if (opened.current) await nativeBrowser.updateScripts({scripts: loadUserScripts().filter(script => script.enabled)})
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

  return {state, tabs, mediaTabs, ready, initialSessionSettled, pending, error, setError, open, command, activate, remove, updateScripts, updateSettings, clearSiteData,
    images, scanningImages, imageError, scanImages, loadImage, cancelImageRequests, invalidateImages, findResult, findInPage, findNext, clearFind, close,
    refreshTabs: refresh}
}
