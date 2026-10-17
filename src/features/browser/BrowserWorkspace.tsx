import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bookmark, BookmarkCheck, ChevronRight, Clock3, Copy,
  Download, Film, Globe2, Home, Images, Laptop, LockKeyhole, LogOut, ScanText, Share2, Shield,
  MoreHorizontal, Pencil, Play, Plus, RefreshCw, Search, Settings2, ShieldCheck, Square, Trash2, X,
} from 'lucide-react'
import { Share } from '@capacitor/share'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { InkVideoPlayer } from '../../components/InkVideoPlayer'
import type { MediaResourceDescriptor } from '../mediaSniffer/types'
import { ScriptManager } from './ScriptManager'
import { loadUserScripts } from './scripts'
import {
  addBrowserShortcut, compactRecentSites, moveBrowserShortcut, normalizeBrowserHost,
  normalizeBrowserShortcuts, normalizeBrowserVisits, normalizeHiddenBrowserHosts,
  removeSiteHistory, saveBrowserVisit, type BrowserShortcut, type BrowserVisit,
} from './browserHistory'
import { browserMediaResources, browserResourceTitle } from './browserMedia'
import {
  BROWSER_ENGINES, BROWSER_KEYS, browserHostLabel, readBrowserList, readBrowserPreference,
  resolveBrowserAddress, writeBrowserPreference, loadBrowserPreferences, normalizeBrowserPreferences, saveBrowserPreferences, type BrowserPreferences, type BrowserSearchChoice,
} from './browserPreferences'
import { useBrowserSession, getBrowserContext, openPrivateBrowser, browserThemePalette, type BrowserCommand, type BrowserRecoverySession } from './useBrowserSession'
import { captureBrowserAppearance, type BrowserContext, type BrowserPrivacyCapabilities } from './browserPrivacy'
import { BrowserFindBar } from './BrowserFindBar'
import { BrowserImagesPanel } from './BrowserImagesPanel'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'
import { BrowserIconButton, BrowserSheet } from './BrowserPrimitives'
import { BrowserStartPage } from './BrowserStartPage'
import { BrowserSearchPanel } from './BrowserSearchPanel'
import { BrowserPlacesPanel } from './BrowserPlacesPanel'
import { BrowserTabsPanel } from './BrowserTabsPanel'
import { BrowserSettingsPanel } from './BrowserSettingsPanel'

export type { BrowserState } from './useBrowserSession'
type Panel = 'menu' | 'history' | 'bookmarks' | 'settings' | 'scripts' | 'tabs' | 'media' | 'images' | 'site' | null
type PlaceAction = {kind: 'history'; entry: BrowserVisit} | {kind: 'shortcut'; index: number}
type ShortcutDraft = BrowserShortcut & {index?: number}
type Notice = {message: string; error?: boolean}
type Confirmation = {title: string; message: string; confirm: () => boolean | Promise<boolean>; actionLabel?: string; successMessage?: string}
type BrowserPlayback = {resource: MediaResourceDescriptor; resources: MediaResourceDescriptor[]; title: string; selection: number; tabId?: number}

export function BrowserWorkspace({onExit, recoverySession, privateContext}: {onExit: () => void; recoverySession?: BrowserRecoverySession; privateContext?: BrowserContext}) {
  const privateMode = privateContext?.privateMode === true
  const workspace = useBrowserDialogFocus<HTMLDivElement>()
  const viewport = useRef<HTMLDivElement>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [placeAction, setPlaceAction] = useState<PlaceAction | null>(null)
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft | null>(null)
  const [draftError, setDraftError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [launchingPrivate, setLaunchingPrivate] = useState(false)
  const imageOverlayCloser = useRef<(() => boolean) | null>(null)
  const [preferences, setPreferences] = useState(() => privateMode ? normalizeBrowserPreferences(privateContext.settings) : loadBrowserPreferences())
  const [capabilities, setCapabilities] = useState<BrowserPrivacyCapabilities>(privateContext?.privacyCapabilities ?? {privateMode: false, clearSiteData: false})
  useEffect(() => {
    let live = true
    void getBrowserContext().then(context => {if (live && context.privacyCapabilities) setCapabilities(context.privacyCapabilities)}).catch(() => undefined)
    return () => {live = false}
  }, [])
  const [notice, setNotice] = useState<Notice | null>(null)
  const [playing, setPlaying] = useState<BrowserPlayback | null>(null)
  const [playError, setPlayError] = useState('')
  const playbackSelection = useRef(0)
  const [history, setHistory] = useState(() => privateMode ? [] : normalizeBrowserVisits(readBrowserList(BROWSER_KEYS.history)))
  const [marks, setMarks] = useState(() => privateMode ? [] : normalizeBrowserVisits(readBrowserList(BROWSER_KEYS.bookmarks)))
  const [hiddenHosts, setHiddenHosts] = useState(() => privateMode ? [] : normalizeHiddenBrowserHosts(readBrowserList(BROWSER_KEYS.hiddenHosts)))
  const [shortcuts, setShortcuts] = useState(() => privateMode ? [] : normalizeBrowserShortcuts(readBrowserList(BROWSER_KEYS.shortcuts)))
  const [bottomAddress, setBottomAddress] = useState(() => privateMode ? privateContext.ui?.bottomAddress ?? true : readBrowserPreference(BROWSER_KEYS.addressPosition) !== 'top')
  const [search, setSearch] = useState<BrowserSearchChoice>(() => {
    const saved = privateMode ? privateContext.ui?.search : readBrowserPreference(BROWSER_KEYS.search)
    return saved && Object.prototype.hasOwnProperty.call(BROWSER_ENGINES, saved) ? saved as BrowserSearchChoice : 'bing'
  })
  const [scriptCount, setScriptCount] = useState(() => privateMode ? privateContext.scripts?.length ?? 0 : loadUserScripts().filter(script => script.enabled).length)
  const historyRef = useRef(history)
  const exiting = useRef(false)
  const uiRevision = useRef(0)
  useEffect(() => {uiRevision.current++}, [panel, searchOpen, placeAction, shortcutDraft, confirmation, playing])

  const persist = useCallback((key: string, value: unknown, apply: () => void, raw = false): boolean => {
    try {
      if (!privateMode) writeBrowserPreference(key, value, raw)
      apply()
      return true
    } catch (error) {
      setNotice({message: error instanceof Error ? error.message : '保存失败，请重试', error: true})
      return false
    }
  }, [privateMode])
  const recordVisit = useCallback((url: string, title: string) => {
    if (privateMode) return
    const next = saveBrowserVisit(historyRef.current, url, title)
    persist(BROWSER_KEYS.history, next, () => {historyRef.current = next; setHistory(next)})
  }, [persist, privateMode])
  const covered = Boolean(panel || searchOpen || placeAction || shortcutDraft || confirmation || playing)
  const session = useBrowserSession(viewport, covered, recordVisit, bottomAddress, recoverySession, {settings: preferences, privateContext})
  const current = session.state.url || ''
  const lastNonDesktopMode = useRef<BrowserPreferences['userAgentMode']>(preferences.userAgentMode === 'desktop' ? 'system' : preferences.userAgentMode)
  useEffect(() => {if (preferences.userAgentMode !== 'desktop') lastNonDesktopMode.current = preferences.userAgentMode}, [preferences.userAgentMode])
  const clearPageFind = session.clearFind
  useEffect(() => {setFindOpen(false); clearPageFind()}, [current, session.state.tabId, clearPageFind])
  const active = /^https?:\/\//i.test(current)
  const title = session.state.title && session.state.title !== '网页' ? session.state.title : browserHostLabel(current)
  const marked = marks.some(item => item.url === current)
  const currentMedia = session.mediaTabs.get(session.state.tabId ?? -1)
  const resources = useMemo(() => browserMediaResources(currentMedia?.observations ?? []), [currentMedia])
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

  const openAddress = async (value: string): Promise<boolean> => {
    const url = resolveBrowserAddress(value, search)
    if (!url) {session.setError('请输入有效网址或搜索关键词'); return false}
    const revision = uiRevision.current
    const opened = await session.open(url)
    if (opened) setPlaying(null)
    if (opened && revision === uiRevision.current) {setPanel(null); setPlaceAction(null); setNotice(null)}
    return opened
  }
  const showSearch = () => {if (findOpen) closeFind(); setPanel(null); session.setError(''); setSearchOpen(true)}
  const openPanel = (next: Panel) => {setSearchOpen(false); setPanel(next)}
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
  const saveHistory = (next: BrowserVisit[]) => !privateMode && persist(BROWSER_KEYS.history, next, () => {historyRef.current = next; setHistory(next)})
  const saveMarks = (next: BrowserVisit[]) => !privateMode && persist(BROWSER_KEYS.bookmarks, next, () => setMarks(next))
  const saveShortcuts = (next: BrowserShortcut[]) => !privateMode && persist(BROWSER_KEYS.shortcuts, next, () => setShortcuts(next))
  const toggleBookmark = () => {
    if (!active || privateMode) return
    const next = marked ? marks.filter(item => item.url !== current) : [{url: current, title, time: Date.now()}, ...marks].slice(0, 500)
    if (saveMarks(next)) setNotice({message: marked ? '已移除书签' : '已添加书签'})
  }
  const confirmClear = (kind: 'history' | 'bookmarks') => {
    setConfirmation({
      title: kind === 'history' ? '清空浏览历史' : '清空书签',
      message: kind === 'history' ? '将删除全部浏览记录。' : '将删除全部已保存的书签。',
      confirm: () => kind === 'history' ? saveHistory([]) : saveMarks([]),
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
    const previous = preferences
    if (!(await session.updateSettings(next))) return false
    try {
      const confirmed = privateMode ? normalizeBrowserPreferences(next) : saveBrowserPreferences(next)
      setPreferences(confirmed)
      return true
    } catch (error) {
      await session.updateSettings(previous)
      setNotice({message: error instanceof Error ? error.message : '保存失败，请重试', error: true})
      return false
    }
  }
  const toggleDesktop = () => {
    if (session.pending) return
    setPanel(null)
    const userAgentMode = preferences.userAgentMode === 'desktop' ? lastNonDesktopMode.current : 'desktop'
    void updatePreferences({...preferences, userAgentMode})
  }
  const enterPrivate = async () => {
    if (privateMode || launchingPrivate) return
    setLaunchingPrivate(true)
    try {
      await openPrivateBrowser({settings: preferences, scripts: loadUserScripts().filter(script => script.enabled),
        palette: browserThemePalette(), appearance: captureBrowserAppearance(), ui: {search, bottomAddress}})
      setPanel(null)
    } catch (error) {
      setNotice({message: error instanceof Error ? error.message : '无法开启隐私模式', error: true})
    } finally {setLaunchingPrivate(false)}
  }
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
    message: capabilities.sharedSiteData && !privateMode
      ? '将清除 ' + browserHostLabel(current) + ' 所属站点及子域名的 Cookie 和存储，并退出 NewsNook 内该站点的登录。'
      : '将清除 ' + browserHostLabel(current) + ' 所属站点及子域名的 Cookie 和存储。',
    confirm: () => session.clearSiteData(confirmedUrl), actionLabel:'清除数据', successMessage:'此网站数据已清除',
    })
  }

  const menuItems: {label: string; icon: typeof Bookmark; action: () => void; disabled?: boolean; selected?: boolean; badge?: string}[] = [
    {label: marked ? '已加书签' : '添加书签', icon: marked ? BookmarkCheck : Bookmark, action: toggleBookmark, disabled: !active, selected: marked},
    {label:'书签', icon:Bookmark, action:() => openPanel('bookmarks')},
    {label:'浏览历史', icon:Clock3, action:() => openPanel('history')},
    {label:'下载管理', icon:Download, action:() => runCommand('downloads')},
    {label:'媒体资源', icon:Film, action:() => {openPanel('media'); if (active) void session.command('scanMedia')}, disabled:!active, badge:resources.length ? String(resources.length) : undefined},
    {label:'用户脚本', icon:ShieldCheck, action:() => openPanel('scripts'), badge:scriptCount ? String(scriptCount) : undefined},
    {label:'脚本菜单', icon:Settings2, action:() => runCommand('scriptMenu'), disabled:!active},
    {label:'新建标签', icon:Plus, action:() => runCommand('new'), disabled:session.tabs.length >= 6},
    {label:'桌面网页', icon:Laptop, action:toggleDesktop, disabled:!active || session.pending, selected:preferences.userAgentMode === 'desktop'},
    {label:'添加到主页', icon:Home, action:() => {setPanel(null); editShortcut({name:title, url:current})}, disabled:!active || shortcuts.length >= 8},
    {label:'看图模式', icon:Images, action:showImages, disabled:!active},
    {label:'页内查找', icon:ScanText, action:openFind, disabled:!active},
    {label:'分享网页', icon:Share2, action:() => {void sharePage()}, disabled:!active},
    {label:privateMode ? '退出隐私' : '隐私模式', icon:Shield, action:privateMode ? close : () => {void enterPrivate()}, disabled:!privateMode && (!capabilities.privateMode || launchingPrivate), selected:privateMode},
    {label:'浏览设置', icon:Settings2, action:() => openPanel('settings')},
    {label:privateMode ? '结束会话' : '返回有所闻', icon:LogOut, action:close},
  ]

  const hiddenPrivateActions = new Set(['添加书签', '已加书签', '书签', '浏览历史', '下载管理', '用户脚本', '添加到主页', '结束会话'])
  const visibleMenuItems = privateMode ? menuItems.filter(item => !hiddenPrivateActions.has(item.label)) : menuItems

  const toolbar = findOpen ? <BrowserFindBar privateMode={privateMode} result={session.findResult} onFind={session.findInPage} onNext={session.findNext} onClose={closeFind}/> : <nav aria-label="浏览器控制" className="browser-toolbar relative z-10 shrink-0 border-y border-haze bg-ink-raised">
    <div className="browser-toolbar-row flex h-14 items-center gap-0.5 px-1.5">
      <BrowserIconButton label="主页" disabled={session.pending} onClick={goHome}><Home size={21}/></BrowserIconButton>
      <div className={'browser-address flex h-11 min-w-0 flex-1 items-center rounded-xl bg-haze/60 text-paper ' + (privateMode ? 'ring-1 ring-paper-muted/35' : '')}>
        {active ? <button type="button" aria-label={privateMode ? '隐私模式与网站信息' : '网站信息'} onClick={() => openPanel('site')} className="flex h-11 w-10 shrink-0 items-center justify-center rounded-l-xl text-paper-muted">
          {privateMode ? <Shield size={17}/> : /^https:/i.test(current) ? <LockKeyhole size={15}/> : <Globe2 size={17}/>}
        </button> : <span className="flex w-10 shrink-0 justify-center text-paper-muted">{privateMode ? <Shield size={17}/> : <Search size={17}/>}</span>}
        <button type="button" aria-label="搜索或输入网址" onClick={showSearch} className="flex h-11 min-w-0 flex-1 items-center gap-1.5 pr-3 text-left">
          {privateMode && <span className="shrink-0 text-[12px] font-semibold text-paper-muted">隐私</span>}
          <span className="block truncate text-[14px] font-medium">{active ? browserHostLabel(current) : privateMode ? '搜索或网址' : '搜索或输入网址'}</span>
        </button>
      </div>
      <BrowserIconButton label={session.state.loading ? '停止加载' : '刷新'} disabled={!active || (!session.state.loading && session.pending)} onClick={() => runCommand(session.state.loading ? 'stop' : 'reload')}>
        {session.state.loading ? <Square size={18}/> : <RefreshCw size={20}/>}
      </BrowserIconButton>
      <BrowserIconButton label="标签页" disabled={session.pending} onClick={() => openPanel('tabs')}>
        <span className="flex size-[23px] items-center justify-center rounded-md border-[1.6px] border-current text-[12px] font-semibold tabular-nums">{session.tabs.length || 1}</span>
      </BrowserIconButton>
      <BrowserIconButton label="网页工具" onClick={() => openPanel(panel === 'menu' ? null : 'menu')}><MoreHorizontal size={23}/></BrowserIconButton>
    </div>
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
    {bottomAddress && toolbar}

    {searchOpen && <BrowserSearchPanel privateMode={privateMode} current={active ? current : ''} initialValue="" engine={search} history={history}
      pending={session.pending} error={session.error} onClose={() => {setSearchOpen(false); session.setError('')}}
      onOpen={openAddress} onCopy={value => {void copy(value)}}/>}

    {panel === 'menu' && <BrowserSheet title="网页工具" onClose={() => setPanel(null)}>
      {active && <p className="mb-2 truncate px-1 text-[13px] text-paper-muted">{browserHostLabel(current)}</p>}
      <div className="mb-3 grid grid-cols-4 border-b border-haze pb-3">
        {([
          {label:'后退', icon:ArrowLeft, command:'back', disabled:!session.state.back},
          {label:'前进', icon:ArrowRight, command:'forward', disabled:!session.state.forward},
          {label:session.state.loading ? '停止' : '刷新', icon:session.state.loading ? Square : RefreshCw, command:session.state.loading ? 'stop' : 'reload', disabled:!active},
        ] as const).map(item => <button type="button" key={item.label} disabled={item.disabled || (session.pending && item.command !== 'stop')} onClick={() => runCommand(item.command)}
          className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl text-[13px] text-paper-muted disabled:opacity-30 active:bg-haze"><item.icon size={20}/>{item.label}</button>)}
        <button type="button" disabled={!active} onClick={() => {void copy(current)}} className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl text-[13px] text-paper-muted disabled:opacity-30 active:bg-haze"><Copy size={19}/>复制网址</button>
      </div>
      <div className="browser-tools-grid grid grid-cols-4 gap-x-1 gap-y-1.5">
        {visibleMenuItems.map(item => <button key={item.label} type="button" disabled={item.disabled || (session.pending && !['返回有所闻', '退出隐私'].includes(item.label))}
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
      hiddenHostCount={hiddenHosts.length} onBack={() => setPanel(null)} onOpen={url => {void openAddress(url)}}
      onRemove={url => {if (panel === 'history') saveHistory(history.filter(item => item.url !== url)); else saveMarks(marks.filter(item => item.url !== url))}}
      onClear={() => confirmClear(panel)}
      onRestoreHidden={() => {if (persist(BROWSER_KEYS.hiddenHosts, [], () => setHiddenHosts([]))) setNotice({message:'首页网站已恢复'})}}
      onHistoryOptions={entry => setPlaceAction({kind:'history', entry})}/></BrowserFullPage>}
    {panel === 'settings' && <BrowserFullPage title="浏览器设置"><BrowserSettingsPanel search={search} bottomAddress={bottomAddress} desktop={session.state.desktop}
      hasPage={active} pending={session.pending} historyCount={history.length} onBack={() => setPanel(null)}
      onSearchChange={value => {persist(BROWSER_KEYS.search, value, () => setSearch(value), true)}}
      onAddressPositionChange={value => {persist(BROWSER_KEYS.addressPosition, value ? 'bottom' : 'top', () => setBottomAddress(value), true)}}
      onDesktopChange={toggleDesktop} onClearHistory={() => confirmClear('history')}
      preferences={preferences} onPreferencesChange={updatePreferences} privateMode={privateMode}
      onPrivateModeChange={privateMode ? close : capabilities.privateMode ? () => {void enterPrivate()} : undefined}
      currentSite={active ? browserHostLabel(current) : undefined} onClearSiteData={active && capabilities.clearSiteData ? clearSite : undefined}/></BrowserFullPage>}
    {panel === 'scripts' && <ScriptManager onClose={() => setPanel(null)} onChanged={async () => {
      setScriptCount(loadUserScripts().filter(script => script.enabled).length)
      if (!(await session.updateScripts())) throw new Error('浏览器脚本同步失败')
    }}/>}

    {panel === 'images' && <BrowserFullPage title="看图模式"><BrowserImagesPanel snapshot={session.images}
      scanning={session.scanningImages} error={session.imageError} onScan={() => {void session.scanImages()}} onClose={closeImages}
      loadImage={session.loadImage} cancelImageRequests={session.cancelImageRequests} privateMode={privateMode} overlayCloserRef={imageOverlayCloser}/></BrowserFullPage>}

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
        <span>{resources.length ? '发现 ' + resources.length + ' 个资源' : '浏览或播放视频后自动识别'}</span>
        <button type="button" disabled={!active || session.pending} onClick={() => {void session.command('scanMedia')}} className="flex min-h-11 items-center gap-1.5 px-2 disabled:opacity-30"><RefreshCw size={16}/>重新扫描</button>
      </div>
      {resources.length ? <ul className="divide-y divide-haze">{resources.map(resource => <li key={resource.id || resource.url} className="flex items-center gap-3 py-4">
        <Film size={21} className="shrink-0 text-paper-muted"/>
        <div className="min-w-0 flex-1"><p className="text-[14px] font-medium">{browserResourceTitle(resource)}</p><p className="mt-1 truncate text-[12px] text-paper-muted">{browserHostLabel(resource.url) || browserHostLabel(resource.pageUrl || '')}</p></div>
        <button type="button" aria-label={'播放 ' + browserResourceTitle(resource)} onClick={() => {setPlayError(''); setPlaying({resource, resources, title, selection:++playbackSelection.current, tabId:session.state.tabId}); setPanel(null)}}
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-paper px-3 text-[13px] font-medium text-ink"><Play size={16}/>播放</button>
      </li>)}</ul> : <div className="flex min-h-40 flex-col items-center justify-center text-paper-muted"><Film size={30} strokeWidth={1.4}/><p className="mt-4 text-[14px]">暂未发现可播放资源</p></div>}
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
        <button type="button" onClick={() => setConfirmation(null)} className="min-h-12 rounded-xl border border-haze text-[14px]">取消</button>
        <button type="button" disabled={confirming} onClick={() => {
          if (confirming) return
          const request = confirmation
          setConfirming(true)
          void Promise.resolve().then(request.confirm).then(ok => {
            if (ok) {setConfirmation(current => current === request ? null : current); setNotice({message:request.successMessage || '已清除'})}
          }).catch(error => {setNotice({message:error instanceof Error ? error.message : '操作失败，请重试', error:true})}).finally(() => setConfirming(false))
        }} className="min-h-12 rounded-xl bg-paper text-[14px] font-medium text-ink disabled:opacity-50">{confirming ? '正在处理' : confirmation.actionLabel || '确认删除'}</button>
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
