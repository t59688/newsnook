import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, BookmarkCheck, ChevronRight, Clock3, Copy,
  Download, Film, Globe2, Home, Images, Laptop, LogOut, ScanText, Share2, Shield,
  MoreHorizontal, Pencil, Play, Plus, RefreshCw, Settings2, ShieldCheck, Trash2, X, BotMessageSquare,
} from 'lucide-react'
import { Share } from '@capacitor/share'
import {createBrowserConfigController} from './agent/browserConfig'
import {downloadUserScriptSource} from './userScriptImport'
import {loadUserScripts,saveUserScripts} from './scripts'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { useStartupBlocker } from '../../hooks/useStartupReadiness'
import { suppressBrowserLogs } from '../../lib/logger'
import { InkVideoPlayer } from '../../components/InkVideoPlayer'
import type { MediaResourceDescriptor } from '../mediaSniffer/types'
import { ScriptManager } from './ScriptManager'
import {
  addBrowserShortcut, compactRecentSites, moveBrowserShortcut, normalizeBrowserHost,
  normalizeBrowserShortcuts, normalizeBrowserVisits, normalizeHiddenBrowserHosts,
  removeSiteHistory, saveBrowserVisit, type BrowserShortcut, type BrowserVisit,
} from './browserHistory'
import { browserMediaResources, browserResourceTitle, browserResourceDetails, browserResourceTracks } from './browserMedia'
import { loadBrowserBookmarks, saveBrowserBookmarks, toggleBrowserBookmark, type BookmarkScope } from './browserBookmarks'
import {
  BROWSER_ENGINES, BROWSER_KEYS, browserHostLabel, readBrowserList, readBrowserPreference,
  resolveBrowserAddress, writeBrowserPreference, loadBrowserPreferences, saveBrowserPreferences, toggleBrowserDesktopMode, type BrowserPreferences, type BrowserSearchChoice,
} from './browserPreferences'
import { useBrowserSession, getBrowserContext, type BrowserCommand, type BrowserRecoverySession } from './useBrowserSession'
import type { BrowserPrivacyCapabilities } from './browserPrivacy'
import { BrowserFindBar } from './BrowserFindBar'
import { BrowserImagesPanel } from './BrowserImagesPanel'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'
import { BrowserIconButton, BrowserLoadingStopIcon, BrowserSheet } from './BrowserPrimitives'
import { BrowserAddressBar, BrowserMediaStrip, browserMediaMatchesPage } from './BrowserAddressBar'
import { BrowserAgentPanel } from './agent/BrowserAgentPanel'
import { BrowserStartPage } from './BrowserStartPage'
import { BrowserSearchPanel } from './BrowserSearchPanel'
import { BrowserPlacesPanel } from './BrowserPlacesPanel'
import { BrowserTabsPanel } from './BrowserTabsPanel'
import { BrowserSettingsPanel } from './BrowserSettingsPanel'
import { BROWSER_OPEN_EVENT, type BrowserOpenDetail } from './browserOpen'

export type { BrowserState } from './useBrowserSession'
type Panel = 'menu' | 'history' | 'bookmarks' | 'settings' | 'scripts' | 'tabs' | 'media' | 'images' | 'site' | null
type PlaceAction = {kind: 'history'; entry: BrowserVisit} | {kind: 'shortcut'; index: number}
type ShortcutDraft = BrowserShortcut & {index?: number}
type Notice = {message: string; error?: boolean}
type Confirmation = {title: string; message: string; confirm: () => boolean | Promise<boolean>; actionLabel?: string; successMessage?: string}
type BrowserPlayback = {resource: MediaResourceDescriptor; resources: MediaResourceDescriptor[]; title: string; selection: number; tabId?: number}

export function BrowserWorkspace({
  onExit,
  recoverySession,
  initialUrl,
}: {
  onExit: () => void
  recoverySession?: BrowserRecoverySession
  initialUrl?: string
}) {
  const workspace = useBrowserDialogFocus<HTMLDivElement>()
  const viewport = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentMinimized, setAgentMinimized] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentOperating, setAgentOperating] = useState(false)
  const agentSheetRef = useRef<HTMLElement>(null)
  const agentConfigRef = useRef<ReturnType<typeof createBrowserConfigController>|null>(null)
  const configApprovalRef = useRef<(reason:string)=>Promise<boolean>>(async()=>false)
  const [placeAction, setPlaceAction] = useState<PlaceAction | null>(null)
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft | null>(null)
  const [draftError, setDraftError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const imageOverlayCloser = useRef<(() => boolean) | null>(null)
  const [preferences, setPreferences] = useState(loadBrowserPreferences)
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const privateMode = preferences.privateMode
  const privateModeRef = useRef(privateMode)
  const privacyLogRelease = useRef<(() => void) | null>(null)
  const workspaceLive = useRef(true)
  const applyPrivacyGuard = useCallback((enabled: boolean) => {
    privateModeRef.current = enabled
    if (enabled && workspaceLive.current) {
      privacyLogRelease.current ??= suppressBrowserLogs()
    } else {
      privacyLogRelease.current?.()
      privacyLogRelease.current = null
    }
  }, [])
  useLayoutEffect(() => {
    workspaceLive.current = true
    applyPrivacyGuard(privateMode)
    return () => {
      workspaceLive.current = false
      privacyLogRelease.current?.()
      privacyLogRelease.current = null
    }
  }, [privateMode, applyPrivacyGuard])
  const [capabilities, setCapabilities] = useState<BrowserPrivacyCapabilities>({privateMode: true, clearSiteData: false, sharedSiteData: true})
  useEffect(() => {
    let live = true
    void getBrowserContext().then(context => {if (live && context.privacyCapabilities) setCapabilities(context.privacyCapabilities)}).catch(() => undefined)
    return () => {live = false}
  }, [])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [playing, setPlaying] = useState<BrowserPlayback | null>(null)
  const [playError, setPlayError] = useState('')
  const playbackSelection = useRef(0)
  const [history, setHistory] = useState(() => normalizeBrowserVisits(readBrowserList(BROWSER_KEYS.history)))
  const [marks, setMarks] = useState(() => loadBrowserBookmarks('normal'))
  const [privateMarks, setPrivateMarks] = useState(() => loadBrowserBookmarks('private'))
  const [hiddenHosts, setHiddenHosts] = useState(() => normalizeHiddenBrowserHosts(readBrowserList(BROWSER_KEYS.hiddenHosts)))
  const [shortcuts, setShortcuts] = useState(() => normalizeBrowserShortcuts(readBrowserList(BROWSER_KEYS.shortcuts)))
  const [hideRecent, setHideRecent] = useState(() => readBrowserPreference(BROWSER_KEYS.hideRecent) === 'true')
  const [bottomAddress, setBottomAddress] = useState(() => readBrowserPreference(BROWSER_KEYS.addressPosition) !== 'top')
  const [search, setSearch] = useState<BrowserSearchChoice>(() => {
    const saved = readBrowserPreference(BROWSER_KEYS.search)
    return saved && Object.prototype.hasOwnProperty.call(BROWSER_ENGINES, saved) ? saved as BrowserSearchChoice : 'bing'
  })
  // Share the resolver's result between startup identity and the native command.
  const initialAddress = useMemo(
    () => initialUrl && /^https?:\/\//i.test(initialUrl) ? resolveBrowserAddress(initialUrl, search) : null,
    [initialUrl, search],
  )
  const searchRef = useRef(search)
  searchRef.current = search
  const bottomAddressRef = useRef(bottomAddress)
  bottomAddressRef.current = bottomAddress
  const historyRef = useRef(history)
  const exiting = useRef(false)
  const uiRevision = useRef(0)
  useEffect(() => {uiRevision.current++}, [panel, searchOpen, placeAction, shortcutDraft, confirmation, playing])

  const persist = useCallback((key: string, value: unknown, apply: () => void, raw = false): boolean => {
    try {
      writeBrowserPreference(key, value, raw)
      apply()
      return true
    } catch (error) {
      setNotice({message: error instanceof Error ? error.message : '保存失败，请重试', error: true})
      return false
    }
  }, [])
  const recordVisit = useCallback((url: string, title: string) => {
    if (privateModeRef.current) return
    const next = saveBrowserVisit(historyRef.current, url, title)
    persist(BROWSER_KEYS.history, next, () => {historyRef.current = next; setHistory(next)})
  }, [persist])
  const covered = Boolean(panel || searchOpen || placeAction || shortcutDraft || confirmation || playing)
  const session = useBrowserSession(viewport, covered, recordVisit, bottomAddress, recoverySession, {
    settings: preferences, initialUrl: initialAddress ?? undefined, agentSheetRef, agentSheetVisible: agentOpen && !agentMinimized && !covered,
    agentOperating: agentOpen && agentOperating,
  })
  useStartupBlocker(!session.initialSessionSettled)
  const current = session.state.url || ''
  const currentUrlRef = useRef(current)
  currentUrlRef.current = current
  const capabilitiesRef = useRef(capabilities)
  capabilitiesRef.current = capabilities
  const clearPageFind = session.clearFind
  useEffect(() => {setFindOpen(false); clearPageFind()}, [current, session.state.tabId, clearPageFind])
  const active = /^https?:\/\//i.test(current)
  const title = session.state.title && session.state.title !== '网页' ? session.state.title : browserHostLabel(current)
  // Scope follows the current recording mode. A private save never changes a public star.
  const marked = (privateMode ? privateMarks : marks).some(item => item.url === current)
  const currentMedia = session.mediaTabs.get(session.state.tabId ?? -1)
  const mediaEntries = useMemo(() => browserMediaResources(currentMedia?.observations ?? [], { includeBlocked: true }), [currentMedia])
  const resources = useMemo(() => mediaEntries.filter(item => !item.isAd && !item.drm), [mediaEntries])
  const blockedResources = active && browserMediaMatchesPage(current, currentMedia?.pageUrl)
    ? mediaEntries.filter(item => item.isAd || item.drm) : []
  const currentResources = active && browserMediaMatchesPage(current, currentMedia?.pageUrl) ? resources : []
  const discoveryCount = playing ? 0 : currentResources.length
  const recent = useMemo(() => compactRecentSites(history, hiddenHosts, 4), [history, hiddenHosts])

  useEffect(() => {
    if (!notice || notice.error) return
    const timer = window.setTimeout(() => setNotice(null), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])
  const closeSession = session.close
  const close = useCallback(() => {
    if (exiting.current) return
    exiting.current = true
    void closeSession().finally(onExit)
  }, [closeSession, onExit])
  const closeFind = () => {setFindOpen(false); session.clearFind()}
  const openFind = () => {
    if (!active) return
    setPanel(null); setSearchOpen(false); setPlaying(null); setFindOpen(true)
  }
  const goHome = () => {
    if (findOpen) closeFind()
    setPanel(null)
    setSearchOpen(false)
    setPlaying(null)
    if (session.ready) void session.command('home')
  }
  const handleBack = () => {
    if (panel === 'images' && imageOverlayCloser.current?.()) return true
    if (confirmation) {setConfirmation(null); return true}
    if (shortcutDraft) {setShortcutDraft(null); return true}
    if (placeAction) {setPlaceAction(null); return true}
    if (searchOpen) {setSearchOpen(false); return true}
    if (panel) {if (panel === 'images') session.invalidateImages(); setPanel(null); return true}
    if (findOpen) {closeFind(); return true}
    if (playing) {setPlaying(null); return true}
    if (agentOpen && !agentMinimized) {setAgentMinimized(true); return true}
    // The first navigation event can precede open's acknowledgement while scripts prepare.
    // Closing bypasses that pending operation, so Back always remains immediately effective.
    if (!session.ready) {close(); return true}
    if (active && session.state.back) {void session.command('back'); return true}
    if (active) {goHome(); return true}
    close()
    return true
  }
  useHardwareBackLayer(true, handleBack)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel !== 'scripts' && !event.defaultPrevented) {event.preventDefault(); handleBack()}
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {event.preventDefault(); showSearch()}
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && active) {event.preventDefault(); openFind()}
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const openResolvedAddress = async (url: string | null): Promise<boolean> => {
    if (!url) {session.setError('请输入有效网址或搜索关键词'); return false}
    const revision = uiRevision.current
    const opened = await session.open(url)
    if (opened) setPlaying(null)
    if (opened && revision === uiRevision.current) {setPanel(null); setPlaceAction(null); setNotice(null)}
    return opened
  }

  const openAddress = (value: string): Promise<boolean> => openResolvedAddress(resolveBrowserAddress(value, search))
  const openResolvedAddressRef = useRef(openResolvedAddress)
  openResolvedAddressRef.current = openResolvedAddress

  const initialOpenedUrl = useRef<string | null>(null)
  useEffect(() => {
    if (!initialUrl || initialOpenedUrl.current === initialUrl || !/^https?:\/\//i.test(initialUrl)) return
    void openResolvedAddressRef.current(initialAddress).then(opened => {
      if (opened) initialOpenedUrl.current = initialUrl
    })
  }, [initialUrl, initialAddress])

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = 'detail' in event ? (event as CustomEvent<BrowserOpenDetail>).detail : undefined
      const url = detail?.url
      if (url && /^https?:\/\//i.test(url)) {
        initialOpenedUrl.current = url
        setFindOpen(false)
        session.clearFind()
        setPanel(null)
        setSearchOpen(false)
        setPlaceAction(null)
        setShortcutDraft(null)
        setConfirmation(null)
        setPlaying(null)
        void openResolvedAddressRef.current(resolveBrowserAddress(url, searchRef.current))
      }
    }
    window.addEventListener(BROWSER_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(BROWSER_OPEN_EVENT, handleOpen)
  }, [session])
  const showSearch = () => {if (findOpen) closeFind(); setAgentMinimized(true); setPanel(null); session.setError(''); setSearchOpen(true)}
  const openPanel = (next: Panel) => {if(next)setAgentMinimized(true);setSearchOpen(false);setPanel(next)}
  const runCommand = (command: BrowserCommand) => {
    setPanel(null)
    void session.command(command).then(ok => {
      if (ok && ['back', 'forward', 'reload', 'desktop', 'new', 'home'].includes(command)) setPlaying(null)
    })
  }
  const finishTabChange = (operation: Promise<boolean>) => {
    const revision = uiRevision.current
    void operation.then(ok => {
      if (ok) setPlaying(null)
      if (ok && revision === uiRevision.current) setPanel(null)
    })
  }
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice({message: '网址已复制'})
    } catch {setNotice({message: '复制失败，请重试', error: true})}
  }
  const saveHistory = (next: BrowserVisit[]) => persist(BROWSER_KEYS.history, next, () => {historyRef.current = next; setHistory(next)})
  const saveMarks = (scope: BookmarkScope, next: BrowserVisit[]): boolean => {
    try {
      const saved = saveBrowserBookmarks(scope, next)
      if (scope === 'private') setPrivateMarks(saved)
      else setMarks(saved)
      return true
    } catch (error) {
      setNotice({message: error instanceof Error ? error.message : '保存失败，请重试', error: true})
      return false
    }
  }
  const saveShortcuts = (next: BrowserShortcut[]) => persist(BROWSER_KEYS.shortcuts, next, () => setShortcuts(next))
  const toggleBookmark = () => {
    if (!active) return
    const scope: BookmarkScope = privateMode ? 'private' : 'normal'
    const currentMarks = privateMode ? privateMarks : marks
    const change = toggleBrowserBookmark(currentMarks, current, title)
    if (change.entries === currentMarks) return
    if (saveMarks(scope, change.entries)) {
      setNotice({message: change.added ? '已添加书签' : '已移除书签'})
    }
  }
  const confirmClear = (kind: 'history' | 'bookmarks' | 'privateBookmarks') => {
    setConfirmation({
      title: kind === 'history' ? '清空浏览历史' : kind === 'privateBookmarks' ? '清空隐私书签' : '清空书签',
      message: kind === 'history' ? '将删除全部浏览记录。'
        : kind === 'privateBookmarks' ? '将删除全部隐私书签，不影响普通书签。'
          : '将删除全部普通书签，不影响隐私书签。',
      confirm: () => kind === 'history' ? saveHistory([]) : saveMarks(kind === 'privateBookmarks' ? 'private' : 'normal', []),
    })
  }
  const editShortcut = (draft: ShortcutDraft) => {
    setDraftError('')
    setPlaceAction(null)
    setShortcutDraft(draft)
  }
  const saveShortcut = () => {
    if (!shortcutDraft) return
    const inputUrl = shortcutDraft.url.trim()
    let url: URL
    try {
      url = new URL(/^https?:\/\//i.test(inputUrl) ? inputUrl : 'https://' + inputUrl)
      if (!normalizeBrowserHost(url.href)) throw new Error()
    } catch {setDraftError('请输入有效的 HTTP 或 HTTPS 网址'); return}
    const name = shortcutDraft.name.trim()
    if (!name) {setDraftError('请输入名称'); return}
    const rest = shortcutDraft.index === undefined ? shortcuts : shortcuts.filter((_, index) => index !== shortcutDraft.index)
    if (rest.some(item => normalizeBrowserHost(item.url) === normalizeBrowserHost(url.href))) {
      setDraftError('此网站已在快捷访问中'); return
    }
    const added = addBrowserShortcut(rest, {name, url: url.href})
    if (added.length === rest.length) {setDraftError('最多添加 8 个快捷方式'); return}
    const next = shortcutDraft.index === undefined ? added : (() => {
      const result = rest.slice()
      result.splice(shortcutDraft.index!, 0, added[added.length - 1])
      return result
    })()
    if (saveShortcuts(next)) {setShortcutDraft(null); setNotice({message: '快捷方式已保存'})}
    else setDraftError('保存失败，请重试')
  }

  const updatePreferences = async (next: BrowserPreferences): Promise<boolean> => {
    const previous = preferencesRef.current
    // Stop recording before the asynchronous native acknowledgement; resume only after persistence.
    applyPrivacyGuard(previous.privateMode || next.privateMode)
    if (!(await session.updateSettings(next))) {
      applyPrivacyGuard(previous.privateMode)
      return false
    }
    try {
      const confirmed = saveBrowserPreferences(next)
      preferencesRef.current = confirmed
      setPreferences(confirmed)
      applyPrivacyGuard(confirmed.privateMode)
      return true
    } catch (error) {
      await session.updateSettings(previous)
      applyPrivacyGuard(previous.privateMode)
      setNotice({message: error instanceof Error ? error.message : '保存失败，请重试', error: true})
      return false
    }
  }
  const toggleDesktop = () => {
    if (session.pending) return
    setPanel(null)
    void updatePreferences(toggleBrowserDesktopMode(preferences))
  }
  const changePrivateMode = (enabled: boolean): Promise<boolean> | boolean =>
    session.pending ? false : updatePreferences({...preferences, privateMode: enabled})
  const saveSearchEngine = (value: BrowserSearchChoice): boolean =>
    persist(BROWSER_KEYS.search, value, () => {searchRef.current=value;setSearch(value)}, true)
  const saveAddressPosition = (value: 'top'|'bottom'): boolean =>
    persist(BROWSER_KEYS.addressPosition,value,()=>{bottomAddressRef.current=value==='bottom';setBottomAddress(value==='bottom')},true)
  const toggleHideRecent = (): boolean =>
    persist(BROWSER_KEYS.hideRecent, !hideRecent ? 'true' : 'false', () => setHideRecent(!hideRecent), true)
  if (!agentConfigRef.current) agentConfigRef.current = createBrowserConfigController({
    getPreferences:()=>preferencesRef.current,
    setPreferences:next=>updatePreferences(next),
    getSearch:()=>searchRef.current,
    setSearch:next=>saveSearchEngine(next as BrowserSearchChoice),
    getAddressPosition:()=>bottomAddressRef.current?'bottom':'top',
    setAddressPosition:saveAddressPosition,
    getScripts:loadUserScripts,
    saveScripts:next=>{saveUserScripts(next);window.dispatchEvent(new window.Event('newsnook:userscripts-changed'))},
    syncScripts:()=>session.updateScripts(),
    getHistoryCount:()=>historyRef.current.length,
    clearHistory:()=>saveHistory([]),
    clearSiteData:async url=>capabilitiesRef.current.clearSiteData?session.clearSiteData(url):false,
    currentUrl:()=>currentUrlRef.current,
    reload:()=>session.command('reload'),
    approve:reason=>configApprovalRef.current(reason),
    download:downloadUserScriptSource,
  })
  const sharePage = async () => {
    if (!active) return
    try {
      await Share.share({title, url: current, dialogTitle: '分享网页'})
    } catch (error) {
      if (!(error instanceof Error && /cancel|取消/i.test(error.message))) setNotice({message:'分享失败，请重试', error:true})
    }
  }
  const showImages = () => {openPanel('images'); void session.scanImages()}
  const closeImages = () => {session.invalidateImages(); setPanel(null)}
  const clearSite = () => {
    const confirmedUrl = current
    setConfirmation({
    title:'清除此网站数据',
    message: capabilities.sharedSiteData
      ? '将清除 ' + browserHostLabel(current) + ' 所属站点及子域名的 Cookie 和存储，并退出 NewsNook 内该站点的登录。'
      : '将清除 ' + browserHostLabel(current) + ' 所属站点及子域名的 Cookie 和存储。',
    confirm: () => session.clearSiteData(confirmedUrl), actionLabel:'清除数据', successMessage:'此网站数据已清除',
    })
  }

  const openMediaPanel = () => {openPanel('media'); if (active) void session.command('scanMedia')}

  const menuItems: {label: string; icon: typeof Bookmark; action: () => void; disabled?: boolean; selected?: boolean; badge?: string}[] = [
    {label: marked ? '已加书签' : '添加书签', icon: marked ? BookmarkCheck : Bookmark, action: toggleBookmark, disabled: !active, selected: marked},
    {label:'书签', icon:Bookmark, action:() => openPanel('bookmarks')},
    {label:'浏览历史', icon:Clock3, action:() => openPanel('history')},
    {label:'下载管理', icon:Download, action:() => runCommand('downloads')},
    {label:'主页', icon:Home, action:goHome, disabled:session.pending},
    {label:'媒体资源', icon:Film, action:openMediaPanel, disabled:!active, badge:currentResources.length ? String(currentResources.length) : undefined},
    {label:'AI 浏览助手', icon:BotMessageSquare, action:()=>{setPanel(null);setAgentMinimized(false);setAgentOpen(true)}},
    {label:'用户脚本', icon:ShieldCheck, action:() => openPanel('scripts'), badge:active ? String(session.state.activeScriptCount ?? 0) : undefined},
    {label:'脚本菜单', icon:Settings2, action:() => runCommand('scriptMenu'), disabled:!active},
    {label:'新建标签', icon:Plus, action:() => runCommand('new'), disabled:session.tabs.length >= 6},
    {label:'桌面网页', icon:Laptop, action:toggleDesktop, disabled:!active || session.pending, selected:preferences.userAgentMode === 'desktop'},
    {label:'添加到主页', icon:Home, action:() => {setPanel(null); editShortcut({name:title, url:current})}, disabled:!active || shortcuts.length >= 8},
    {label:'看图模式', icon:Images, action:showImages, disabled:!active},
    {label:'页内查找', icon:ScanText, action:openFind, disabled:!active},
    {label:'分享网页', icon:Share2, action:() => {void sharePage()}, disabled:!active},
    {label:'隐私模式', icon:Shield, action:() => {void changePrivateMode(!privateMode)}, disabled:session.pending, selected:privateMode},
    {label:'浏览设置', icon:Settings2, action:() => openPanel('settings')},
    {label:'返回有所闻', icon:LogOut, action:close},
  ]

  const toolbar = findOpen ? <BrowserFindBar privateMode={privateMode} result={session.findResult} onFind={session.findInPage} onNext={session.findNext} onClose={closeFind}/> : <nav aria-label="浏览器控制" className="browser-toolbar relative z-10 shrink-0 border-y border-haze bg-ink-raised">
    {bottomAddress && <BrowserMediaStrip count={discoveryCount} open={panel === 'media'} onOpen={openMediaPanel}/>}
    <div className="browser-toolbar-row flex h-14 items-center gap-0.5 px-1.5">
      <BrowserIconButton label="返回有所闻" onClick={close}><LogOut size={20} strokeWidth={1.8}/></BrowserIconButton>
      <BrowserIconButton label="主页" className="browser-toolbar-compact-optional" disabled={session.pending} onClick={goHome}><Home size={20} strokeWidth={1.8}/></BrowserIconButton>
      <BrowserAddressBar active={active} current={current} privateMode={privateMode}
        mediaCount={discoveryCount} mediaTabId={session.state.tabId} mediaPage={currentMedia?.pageUrl}
        mediaPanelOpen={panel === 'media'} onOpenSite={() => openPanel('site')}
        onSearch={showSearch} onOpenMedia={openMediaPanel}/>
      <BrowserIconButton label={session.state.loading ? '停止加载' : '刷新'} disabled={!active || (!session.state.loading && session.pending)} onClick={() => runCommand(session.state.loading ? 'stop' : 'reload')}>
        {session.state.loading ? <BrowserLoadingStopIcon size={20}/> : <RefreshCw size={19} strokeWidth={1.8}/>}
      </BrowserIconButton>
      <BrowserIconButton label="标签页" disabled={session.pending} onClick={() => openPanel('tabs')}>
        <span className="flex size-[18px] items-center justify-center rounded-[4px] border-[1.5px] border-current text-[10.5px] font-bold leading-none tabular-nums select-none">{session.tabs.length || 1}</span>
      </BrowserIconButton>
      <BrowserIconButton label={agentBusy?'AI 浏览助手（任务未结束）':'AI 浏览助手'} className="browser-toolbar-compact-optional" onClick={() => {
        setPanel(null)
        if (!agentOpen) {setAgentOpen(true);setAgentMinimized(false)}
        else setAgentMinimized(value=>!value)
      }} pressed={agentOpen&&!agentMinimized}><span className="relative inline-flex items-center justify-center"><BotMessageSquare size={22} strokeWidth={1.9} aria-hidden="true"/>
          {agentBusy&&<span aria-hidden="true" className="absolute -right-1 -top-1 size-[6px] rounded-full bg-cinnabar"/>}
        </span></BrowserIconButton>
      <BrowserIconButton label="网页工具" onClick={() => openPanel(panel === 'menu' ? null : 'menu')}><MoreHorizontal size={20} strokeWidth={1.8}/></BrowserIconButton>
    </div>
    {!bottomAddress && <BrowserMediaStrip count={discoveryCount} open={panel === 'media'} onOpen={openMediaPanel}/>}
    {session.state.loading && <div role="progressbar" aria-label="网页加载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={session.state.progress ?? 0}
      className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-haze">
      <div className="h-full bg-cinnabar transition-[width] duration-150" style={{width: Math.max(4, session.state.progress ?? 4) + '%'}}/>
    </div>}
  </nav>

  return <div ref={workspace} tabIndex={-1} role="dialog" aria-label="NewsNook 网页浏览器" aria-modal="true"
    data-private-mode={privateMode ? 'true' : undefined}
    className="browser-workspace fixed inset-0 z-[95] flex min-w-0 flex-col overflow-hidden bg-ink text-paper outline-none"
    style={{paddingTop:'var(--sat)', paddingBottom:'var(--sab)'}}>
    {!bottomAddress && toolbar}
    <div ref={viewport} data-browser-viewport className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {!active && !playing && <BrowserStartPage privateMode={privateMode} shortcuts={shortcuts} recent={recent} onSearch={showSearch}
        hideRecent={hideRecent} onToggleHideRecent={toggleHideRecent}
        onOpen={url => {void openAddress(url)}} onAddShortcut={() => editShortcut({name:'',url:''})}
        onShortcutOptions={index => setPlaceAction({kind:'shortcut', index})}
        onHistoryOptions={entry => setPlaceAction({kind:'history', entry})} onPanel={openPanel}/>}
      {active && session.state.error && !playing && <div className="flex h-full flex-col items-center justify-center px-7 text-center">
        <Globe2 size={34} strokeWidth={1.4} className="text-paper-muted"/>
        <h2 className="mt-5 text-[20px] font-semibold">网页加载失败</h2>
        <p className="mt-2 max-w-full truncate text-[14px] text-paper-muted">{browserHostLabel(current)}</p>
        <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-paper-muted">{session.state.error}</p>
        <button type="button" disabled={session.pending} onClick={() => {void session.command('reload')}}
          className="mt-6 flex min-h-11 items-center gap-2 rounded-xl bg-paper px-5 text-[14px] font-medium text-ink disabled:opacity-50"><RefreshCw size={17}/>重新加载</button>
      </div>}
      {playing && <div className="absolute inset-0 z-20 flex flex-col bg-ink">
        <header className="flex min-h-14 items-center gap-2 border-b border-haze px-2">
          <BrowserIconButton label="返回网页" onClick={() => setPlaying(null)}><ArrowLeft size={21}/></BrowserIconButton>
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">网页视频</h2>
          <button type="button" onClick={() => setPanel('media')} className="min-h-11 px-3 text-[14px] text-paper-muted">切换资源</button>
        </header>
        {playError && <p role="alert" className="px-4 py-3 text-[14px] text-paper">{playError}</p>}
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
          <div className="w-full min-w-0">
          <InkVideoPlayer key={playing.selection} src={playing.resource.url} resources={playing.resources} title={playing.title} format={playing.resource.type}
            sourcePage={playing.resource.pageUrl} requestHeaders={playing.resource.requestHeaders} extraUrls={playing.resource.relatedUrls} autoPlay mediaPageHost={false}
            overlayContainer={workspace.current ?? undefined} suppressResourceFab
            onPlaybackError={() => setPlayError('视频播放失败，请选择其他资源')}/>
          </div>
        </div>
      </div>}
    </div>
    {agentOpen && <BrowserAgentPanel tabId={session.state.tabId} loading={session.state.loading} progress={session.state.progress}
      tabs={session.tabs} sheetRef={agentSheetRef} minimized={agentMinimized} onMinimize={()=>setAgentMinimized(true)}
      onNeedAttention={()=>{setPanel(null);setSearchOpen(false);setAgentMinimized(false)}} onBusyChange={setAgentBusy}
      onOperatingChange={setAgentOperating}
      onBrowserConfig={(request,signal,approve)=>{configApprovalRef.current=approve;return agentConfigRef.current!.execute(request,signal)}}
      onSearch={query=>session.open(BROWSER_ENGINES[searchRef.current].url+encodeURIComponent(query),true)}
      searchUrl={query=>BROWSER_ENGINES[searchRef.current].url+encodeURIComponent(query)}
      onNavigate={url=>session.open(url,true)} onBack={()=>session.command('back')} onForward={()=>session.command('forward')}
      onNewTab={async url => (await session.command('new')) && (await session.open(url))}
      onSwitchTab={index => {const tab=session.tabs.find(t=>t.index===index);return tab?session.activate(tab):Promise.resolve(false)}}
      onCloseTab={index => {const tab=session.tabs.find(t=>t.index===index);return tab?session.remove(tab):Promise.resolve(false)}}
      onClose={()=>{setAgentOpen(false);setAgentMinimized(false);setAgentBusy(false)}}/>}
    {bottomAddress && toolbar}

    {searchOpen && <BrowserSearchPanel privateMode={privateMode} current={active ? current : ''} initialValue={active ? current : ''} engine={search} history={history}
      pending={session.pending} error={session.error} onClose={() => {setSearchOpen(false); session.setError('')}}
      onOpen={openAddress} onEngineChange={saveSearchEngine} onCopy={value => {void copy(value)}}/>}

    {panel === 'menu' && <BrowserSheet title="网页工具" onClose={() => setPanel(null)}>
      {active && <p className="mb-2 truncate px-1 text-[13px] text-paper-muted">{browserHostLabel(current)}</p>}
      <div className="mb-3 grid grid-cols-4 border-b border-haze pb-3">
        {([
          {label:'后退', icon:ArrowLeft, command:'back', disabled:!session.state.back},
          {label:'前进', icon:ArrowRight, command:'forward', disabled:!session.state.forward},
          {label:session.state.loading ? '停止' : '刷新', icon:session.state.loading ? BrowserLoadingStopIcon : RefreshCw, command:session.state.loading ? 'stop' : 'reload', disabled:!active},
        ] as const).map(item => <button type="button" key={item.label} disabled={item.disabled || (session.pending && item.command !== 'stop')} onClick={() => runCommand(item.command)}
          className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl text-[13px] text-paper-muted disabled:opacity-30 active:bg-haze"><item.icon size={20}/>{item.label}</button>)}
        <button type="button" disabled={!active} onClick={() => {void copy(current)}} className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl text-[13px] text-paper-muted disabled:opacity-30 active:bg-haze"><Copy size={19}/>复制网址</button>
      </div>
      <div className="browser-tools-grid grid grid-cols-4 gap-x-1 gap-y-1.5">
        {menuItems.map(item => <button key={item.label} type="button" disabled={item.disabled || (session.pending && item.label !== '返回有所闻')}
          aria-pressed={item.selected === undefined ? undefined : item.selected} onClick={item.action}
          className={'relative flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-2 rounded-2xl px-1 py-2 text-center transition-colors active:bg-haze disabled:opacity-30 ' + (item.selected ? 'bg-haze text-paper' : 'text-paper')}>
          <span className="relative"><item.icon size={23} strokeWidth={1.65}/>{item.badge && <span className="absolute -top-2 -right-3 flex min-w-4 items-center justify-center rounded-full bg-paper px-1 text-[10px] font-semibold text-ink">{item.badge}</span>}</span>
          <span className="w-full text-[13px] leading-snug">{item.label}</span>
        </button>)}
      </div>
    </BrowserSheet>}

    {panel === 'tabs' && <BrowserFullPage title="标签页"><BrowserTabsPanel privateMode={privateMode} tabs={session.tabs} pending={session.pending} onBack={() => setPanel(null)}
      onSelect={tab => finishTabChange(session.activate(tab))}
      onRemove={tab => {void session.remove(tab).then(ok => {if (ok && playing?.tabId === tab.id) setPlaying(null)})}}
      onNew={() => finishTabChange(session.command('new'))}/></BrowserFullPage>}
    {(panel === 'history' || panel === 'bookmarks') && <BrowserFullPage title={panel === 'history' ? '浏览历史' : '书签'}><BrowserPlacesPanel privateMode={privateMode} key={panel} kind={panel} entries={panel === 'history' ? history : marks}
      privateEntries={privateMode && panel === 'bookmarks' ? privateMarks : []}
      hiddenHostCount={hiddenHosts.length} onBack={() => setPanel(null)} onOpen={url => {void openAddress(url)}}
      onRemove={url => {if (panel === 'history') saveHistory(history.filter(item => item.url !== url)); else saveMarks('normal', marks.filter(item => item.url !== url))}}
      onClear={() => confirmClear(panel)}
      onPrivateRemove={url => saveMarks('private', privateMarks.filter(item => item.url !== url))}
      onPrivateClear={() => confirmClear('privateBookmarks')}
      onRestoreHidden={() => {if (persist(BROWSER_KEYS.hiddenHosts, [], () => setHiddenHosts([]))) setNotice({message:'首页网站已恢复'})}}
      onHistoryOptions={entry => setPlaceAction({kind:'history', entry})}/></BrowserFullPage>}
    {panel === 'settings' && <BrowserFullPage title="浏览器设置"><BrowserSettingsPanel search={search} bottomAddress={bottomAddress} desktop={session.state.desktop}
      hasPage={active} pending={session.pending} historyCount={history.length} onBack={() => setPanel(null)}
      onSearchChange={saveSearchEngine}
      onAddressPositionChange={value => {saveAddressPosition(value?'bottom':'top')}}
      onDesktopChange={toggleDesktop} onClearHistory={() => confirmClear('history')}
      preferences={preferences} onPreferencesChange={updatePreferences} privateMode={privateMode}
      onPrivateModeChange={changePrivateMode}
      currentSite={active ? browserHostLabel(current) : undefined} onClearSiteData={active && capabilities.clearSiteData ? clearSite : undefined}/></BrowserFullPage>}
    {panel === 'scripts' && <ScriptManager onClose={() => setPanel(null)}
      pageStatus={active ? {url:current, active:session.state.activeScriptCount ?? 0, matched:session.state.matchedScriptCount ?? 0, loading:session.state.loading ?? false} : undefined}
      onReload={active ? async () => {const ok = await session.command('reload'); if (ok) setPanel(null); return ok} : undefined}
      onChanged={async () => {
        if (!(await session.updateScripts())) throw new Error('浏览器脚本同步失败')
      }}/>}

    {panel === 'images' && <BrowserFullPage title="看图模式"><BrowserImagesPanel snapshot={session.images}
      scanning={session.scanningImages} error={session.imageError} onScan={() => {void session.scanImages()}} onClose={closeImages}
      loadImage={session.loadImage} cancelImageRequests={session.cancelImageRequests} overlayCloserRef={imageOverlayCloser}/></BrowserFullPage>}

    {panel === 'site' && <BrowserSheet title="网站信息" onClose={() => setPanel(null)}>
      <div className="flex items-center gap-3 py-3">
        {privateMode ? <Shield size={24} className="text-paper-muted"/> : <Globe2 size={24} className="text-paper-muted"/>}
        <div className="min-w-0"><h3 className="break-words text-[17px] font-semibold">{browserHostLabel(current)}</h3>
          <p className="mt-1 text-[13px] text-paper-muted">{privateMode ? '隐私模式 · ' : ''}{/^https:/i.test(current) ? '连接已加密' : '连接未加密'}</p></div>
      </div>
      <p className="mb-4 break-all text-[13px] leading-relaxed text-paper-muted">{current}</p>
      <div className="divide-y divide-haze">
        <ActionRow icon={Copy} label="复制网址" onClick={() => {void copy(current)}}/>
        <ActionRow icon={Share2} label="分享网页" onClick={() => {void sharePage()}}/>
        {capabilities.clearSiteData && <ActionRow icon={Trash2} label="清除此网站数据" onClick={clearSite}/>}
      </div>
    </BrowserSheet>}

    {panel === 'media' && <BrowserSheet title="媒体资源" onClose={() => setPanel(null)}>
      <div className="mb-3 flex items-center justify-between text-[13px] text-paper-muted">
        <span>{currentResources.length ? '发现 ' + currentResources.length + ' 个资源' : '浏览或播放视频后自动识别'}</span>
        <button type="button" disabled={!active || session.pending} onClick={() => {void session.command('scanMedia')}} className="flex min-h-11 items-center gap-1.5 px-2 disabled:opacity-30"><RefreshCw size={16}/>重新扫描</button>
      </div>
      {currentResources.length ? <ul className="divide-y divide-haze">{currentResources.map(resource => <li key={resource.id || resource.url} className="flex items-center gap-3 py-4">
        <Film size={21} className="shrink-0 text-paper-muted"/>
        <MediaResourceSummary resource={resource}/>
        <button type="button" aria-label={'播放 ' + browserResourceTitle(resource)} onClick={() => {setPlayError(''); setPlaying({resource, resources:currentResources, title, selection:++playbackSelection.current, tabId:session.state.tabId}); setPanel(null)}}
          className="browser-media-play" title="播放"><Play size={20} strokeWidth={1.9} aria-hidden="true"/></button>
      </li>)}</ul> : <div className="flex min-h-40 flex-col items-center justify-center text-paper-muted"><Film size={30} strokeWidth={1.4}/><p className="mt-4 text-[14px]">暂未发现可播放资源</p></div>}
      {!!blockedResources.length && <details className="mt-3 border-t border-haze pt-3 text-[13px] text-paper-muted">
        <summary className="min-h-11 cursor-pointer py-3">已排除 {blockedResources.length} 个疑似广告或受保护资源</summary>
        <p className="mb-2 text-[12px] leading-relaxed">广告标记仅供参考，无法识别所有广告。</p>
        <ul className="divide-y divide-haze">{blockedResources.map(resource => <li key={resource.id || resource.url} className="flex gap-3 py-4"><Film size={21} className="shrink-0"/><MediaResourceSummary resource={resource}/></li>)}</ul>
      </details>}
    </BrowserSheet>}

    {placeAction && <BrowserSheet title={placeAction.kind === 'history' ? browserHostLabel(placeAction.entry.url) : shortcuts[placeAction.index]?.name || '快捷方式'} onClose={() => setPlaceAction(null)}>
      {placeAction.kind === 'history' ? <div className="divide-y divide-haze">
        <ActionRow icon={Globe2} label="打开网页" onClick={() => {void openAddress(placeAction.entry.url)}}/>
        <ActionRow icon={Home} label="从首页隐藏此网站" onClick={() => {
          const next = [...new Set([...hiddenHosts, normalizeBrowserHost(placeAction.entry.url)])]
          if (persist(BROWSER_KEYS.hiddenHosts, next, () => setHiddenHosts(next))) setPlaceAction(null)
        }}/>
        <ActionRow icon={Trash2} label="删除这条记录" onClick={() => {if (saveHistory(history.filter(item => item.url !== placeAction.entry.url))) setPlaceAction(null)}}/>
        <ActionRow icon={Trash2} label="删除该网站全部历史" onClick={() => {
          const host = normalizeBrowserHost(placeAction.entry.url)
          setPlaceAction(null)
          setConfirmation({title:'删除网站历史', message:'将删除 ' + host + ' 的全部浏览记录。', confirm:() => saveHistory(removeSiteHistory(historyRef.current, host))})
        }}/>
      </div> : <div className="divide-y divide-haze">
        <ActionRow icon={Pencil} label="编辑快捷方式" onClick={() => editShortcut({...shortcuts[placeAction.index], index:placeAction.index})}/>
        <ActionRow icon={ArrowUp} label="向前移动" disabled={placeAction.index === 0} onClick={() => {if (saveShortcuts(moveBrowserShortcut(shortcuts, placeAction.index, -1))) setPlaceAction(null)}}/>
        <ActionRow icon={ArrowDown} label="向后移动" disabled={placeAction.index === shortcuts.length - 1} onClick={() => {if (saveShortcuts(moveBrowserShortcut(shortcuts, placeAction.index, 1))) setPlaceAction(null)}}/>
        <ActionRow icon={Trash2} label="删除快捷方式" onClick={() => {if (saveShortcuts(shortcuts.filter((_, index) => index !== placeAction.index))) setPlaceAction(null)}}/>
      </div>}
    </BrowserSheet>}

    {shortcutDraft && <BrowserSheet title={shortcutDraft.index === undefined ? '添加快捷方式' : '编辑快捷方式'} onClose={() => setShortcutDraft(null)}>
      <form onSubmit={event => {event.preventDefault(); saveShortcut()}} className="pb-2">
        <label className="block text-[13px] text-paper-muted">名称<input aria-label="快捷方式名称" autoFocus maxLength={25} value={shortcutDraft.name}
          onChange={event => setShortcutDraft({...shortcutDraft, name:event.target.value})}
          className="mt-2 mb-4 h-12 w-full rounded-xl border border-haze bg-ink px-3 text-[15px] text-paper outline-none focus:border-paper-muted"/></label>
        <label className="block text-[13px] text-paper-muted">网址<input aria-label="快捷方式网址" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={shortcutDraft.url}
          onChange={event => setShortcutDraft({...shortcutDraft, url:event.target.value})}
          className="mt-2 h-12 w-full rounded-xl border border-haze bg-ink px-3 text-[15px] text-paper outline-none focus:border-paper-muted"/></label>
        {draftError && <p role="alert" className="mt-3 text-[14px] text-paper">{draftError}</p>}
        <button type="submit" className="mt-5 min-h-12 w-full rounded-xl bg-paper text-[15px] font-medium text-ink">保存</button>
      </form>
    </BrowserSheet>}

    {confirmation && <BrowserSheet title={confirmation.title} onClose={() => setConfirmation(null)}>
      <p className="py-2 text-[14px] leading-relaxed text-paper-muted">{confirmation.message}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 pb-2">
        <button type="button" onClick={() => setConfirmation(null)} className="min-h-12 rounded-xl border border-haze text-[14px] text-paper-muted transition-colors hover:text-paper">取消</button>
        <button type="button" disabled={confirming} onClick={() => {
          if (confirming) return
          const request = confirmation
          setConfirming(true)
          void Promise.resolve().then(request.confirm).then(ok => {
            if (ok) {setConfirmation(current => current === request ? null : current); setNotice({message:request.successMessage || '已清除'})}
          }).catch(error => {setNotice({message:error instanceof Error ? error.message : '操作失败，请重试', error:true})}).finally(() => setConfirming(false))
        }} className="min-h-12 rounded-xl bg-cinnabar text-[14px] font-semibold text-white shadow-xs transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-50">{confirming ? '正在处理' : confirmation.actionLabel || '确认删除'}</button>
      </div>
    </BrowserSheet>}

    {(notice || (session.error && !searchOpen)) && <div role={notice?.error || session.error ? 'alert' : 'status'}
      className="absolute right-4 left-4 z-[70] mx-auto flex max-w-lg items-center gap-2 rounded-2xl border border-haze bg-ink-raised px-4 py-2 shadow-lg"
      style={{top:'calc(var(--sat) + 12px)'}}>
      <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-paper">{notice?.message || session.error}</span>
      <BrowserIconButton label="关闭提示" onClick={() => {setNotice(null); session.setError('')}}><X size={18}/></BrowserIconButton>
    </div>}
  </div>
}

function BrowserFullPage({title, children}: {title: string; children: ReactNode}) {
  const page = useBrowserDialogFocus<HTMLDivElement>()
  return <div ref={page} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
    className="absolute inset-0 z-30 outline-none">
    {children}
  </div>
}

function ActionRow({icon: Icon, label, onClick, disabled = false}: {icon: typeof Bookmark; label: string; onClick: () => void; disabled?: boolean}) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-14 w-full items-center gap-3 rounded-lg px-1 py-3 text-left text-[14px] text-paper disabled:opacity-30 active:bg-haze">
    <Icon size={19} strokeWidth={1.7} className="text-paper-muted"/><span className="min-w-0 flex-1">{label}</span><ChevronRight size={17} className="text-paper-faint"/>
  </button>
}

function MediaResourceSummary({resource}: {resource: MediaResourceDescriptor}) {
  const tracks = browserResourceTracks(resource)
  return <div className="min-w-0 flex-1">
    <p className="line-clamp-2 break-words text-[14px] font-medium leading-relaxed text-paper">{browserResourceTitle(resource)}</p>
    <p className="mt-1 break-words text-[12px] leading-relaxed text-paper-muted">{browserResourceDetails(resource).join(' · ')}</p>
    {!!tracks.length && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] leading-relaxed text-paper-muted" aria-label={resource.videoTracks.length > 1 ? '同一视频的清晰度选项' : '媒体轨道'}>{tracks.map((detail, index) => <span key={index}>{detail}</span>)}</div>}
  </div>
}
