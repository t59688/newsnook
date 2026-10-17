import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import {
  ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, ChevronLeft, Clock3,
  Globe2, Home, Laptop, LoaderCircle, MoreHorizontal, Plus,
  Settings2, ShieldCheck, Smartphone, Trash2, X, Play, Film, Search, Download, PanelBottom, PanelTop, Copy,
} from 'lucide-react'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { ScriptManager } from './ScriptManager'
import { loadUserScripts } from './scripts'
import { InkVideoPlayer } from '../../components/InkVideoPlayer'
import { browserSearchProviders, browserSearchDestination, type BrowserSearchCategory } from './browserSearchCatalog'
import { normalizeBrowserHost, compactRecentSites, saveBrowserVisit, removeSiteHistory, DEFAULT_BROWSER_SHORTCUTS, addBrowserShortcut, moveBrowserShortcut, shortcutFaviconUrl, type BrowserShortcut } from './browserHistory'
import { browserMediaResources, browserResourceTitle, reduceBrowserMedia, type BrowserMediaTab, type BrowserMediaEvent } from './browserMedia'
import type { MediaResourceDescriptor } from '../mediaSniffer/types'

export interface BrowserState { url: string | null; tabId?: number; back: boolean; forward: boolean; desktop: boolean }
type BrowserOp = 'back' | 'forward' | 'reload' | 'desktop' | 'url' | 'new' | 'tabs' | 'scriptMenu' | 'home' | 'scanMedia' | 'downloads'
type NativeTab = {index: number; id: number; title: string; url: string; active: boolean; loading: boolean}
type BrowserNative = {
  open: (args: { url: string; scripts: ReturnType<typeof loadUserScripts>; embedded: true; top: number; bottom: number }) => Promise<void>
  navigate: (args: { action: BrowserOp; url?: string }) => Promise<void>
  state: () => Promise<BrowserState>
  tabs: () => Promise<{tabs: NativeTab[]}>
  activateTab: (args: {index: number}) => Promise<void>
  removeTab: (args: {index: number}) => Promise<void>
  setBounds: (args: { top: number; bottom: number; visible: boolean }) => Promise<void>
  close: () => Promise<void>
  addListener: (event: 'navigation' | 'mediaEvent', callback: (event: any) => void) => Promise<PluginListenerHandle>
}
const nativeBrowser = registerPlugin<BrowserNative>('NewsNookBrowser')

import type { BrowserVisit as SavedVisit } from './browserHistory'
type SearchChoice = 'bing' | 'google' | 'baidu' | 'duckduckgo'
const HISTORY_KEY = 'newsnook:browser:history:v1'
const MARKS_KEY = 'newsnook:browser:bookmarks:v1'
const SEARCH_KEY = 'newsnook:browser:search:v1'
const ADDRESS_POSITION_KEY = 'newsnook:browser:address-position:v1'
const HIDDEN_KEY = 'newsnook:browser:hidden-hosts:v1'
const SHORTCUT_KEY = 'newsnook:browser:shortcuts:v1'
const engines: Record<SearchChoice, { name: string; url: string }> = {
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
}
function loadList(key: string): SavedVisit[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(list) ? list.filter((entry): entry is SavedVisit => entry && typeof entry.url === 'string' && typeof entry.time === 'number').slice(0, 500) : []
  } catch { return [] }
}
function resolveAddress(text: string, engine: SearchChoice): string | null {
  const input = text.trim()
  if (!input) return null
  try {
    const guessed = /^https?:\/\//i.test(input) ? input : /^[\w\-.]+\.[a-z]{2,}(?:[:/]|$)/i.test(input) && !/\s/.test(input) ? `https://${input}` : null
    if (guessed) {
      const url = new URL(guessed)
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null
    }
    return engines[engine].url + encodeURIComponent(input)
  } catch { return null }
}
function titleOf(address: string): string {
  try { return new URL(address).hostname.replace(/^www\./, '') } catch { return address }
}
function Button({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted transition-colors hover:bg-haze hover:text-paper active:scale-95 disabled:opacity-30">
    {children}
  </button>
}

export function BrowserWorkspace({ onExit }: { onExit: () => void }) {
  const viewport = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const holdTimer = useRef<number | null>(null)
  const heldHistory = useRef<string | null>(null)
  const loaded = useRef(false)
  const busy = useRef(false)
  const [address, setAddress] = useState('')
  const [current, setCurrent] = useState('')
  const [nativeState, setNativeState] = useState<BrowserState>({ url: null, back: false, forward: false, desktop: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'menu' | 'history' | 'bookmarks' | 'settings' | 'scripts' | 'tabs' | 'media' | null>(null)
  const [mediaTabs, setMediaTabs] = useState<ReadonlyMap<number, BrowserMediaTab>>(() => new Map())
  const [playing, setPlaying] = useState<MediaResourceDescriptor | null>(null)
  const [playError, setPlayError] = useState('')
  const [bottomAddress, setBottomAddress] = useState(() => localStorage.getItem(ADDRESS_POSITION_KEY) !== 'top')
  const [suggestions, setSuggestions] = useState(false)
  const [searchCategory, setSearchCategory] = useState<BrowserSearchCategory>('常用')
  const [hiddenHosts, setHiddenHosts] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]') } catch { return [] } })
  const [shortcuts, setShortcuts] = useState<BrowserShortcut[]>(() => { try { return JSON.parse(localStorage.getItem(SHORTCUT_KEY) || 'null') || DEFAULT_BROWSER_SHORTCUTS } catch { return DEFAULT_BROWSER_SHORTCUTS } })
  const [historyAction, setHistoryAction] = useState<SavedVisit | null>(null)
  const [shortcutAction, setShortcutAction] = useState<number | null>(null)
  const [faviconFailed, setFaviconFailed] = useState<string[]>([])
  const [playPending, setPlayPending] = useState(false)
  const [tabs, setTabs] = useState<NativeTab[]>([])
  const [history, setHistory] = useState(() => loadList(HISTORY_KEY))
  const [marks, setMarks] = useState(() => loadList(MARKS_KEY))
  const [search, setSearch] = useState<SearchChoice>(() => {
    const saved = localStorage.getItem(SEARCH_KEY)
    return saved && saved in engines ? saved as SearchChoice : 'bing'
  })
  const [scriptCount, setScriptCount] = useState(() => loadUserScripts().filter(s => s.enabled).length)
  const isAndroid = Capacitor.getPlatform() === 'android'
  const active = /^https?:\/\//i.test(current)
  const currentMedia = mediaTabs.get(nativeState.tabId ?? -1)
  const mediaResources = useMemo(() => browserMediaResources(currentMedia?.observations ?? []), [currentMedia])
  const recentSites = useMemo(() => compactRecentSites(history, hiddenHosts), [history, hiddenHosts])
  const activeTabIds = useMemo(() => new Set(tabs.map(tab => tab.id)), [tabs])
  const marked = marks.some(item => item.url === current)
  const pageTitle = useMemo(() => titleOf(current), [current])
  const closing = useRef(false)

  const startHistoryHold = (item: SavedVisit) => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    heldHistory.current = null
    holdTimer.current = window.setTimeout(() => { heldHistory.current = item.url; setHistoryAction(item); holdTimer.current = null }, 520)
  }
  const cancelHistoryHold = () => { if (holdTimer.current !== null) window.clearTimeout(holdTimer.current); holdTimer.current = null }
  const saveVisit = useCallback((url: string) => {
    if (!/^https?:\/\//.test(url)) return
    setHistory(prev => {
      const next = saveBrowserVisit(prev, url, titleOf(url))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const updateNativeState = useCallback(() => {
    if (loaded.current) {
      void nativeBrowser.state().then(setNativeState).catch(() => undefined)
      void nativeBrowser.tabs().then(result => setTabs(result.tabs)).catch(() => undefined)
    }
  }, [])
  const getBounds = useCallback(() => {
    const rect = viewport.current?.getBoundingClientRect()
    return rect ? { top: Math.max(0, rect.top), bottom: Math.max(0, window.innerHeight - rect.bottom) } : { top: 116, bottom: 80 }
  }, [])
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    loaded.current = false
    void nativeBrowser.close().catch(() => undefined).finally(onExit)
  }, [onExit])
  useHardwareBackLayer(true, () => {
    if (playing) { setPlaying(null); return true }
    if (suggestions) { setSuggestions(false); input.current?.blur(); return true }
    if (panel) { setPanel(null); return true }
    if (loaded.current && nativeState.back) { void nativeBrowser.navigate({ action: 'back' }); return true }
    close()
    return true
  })
  useEffect(() => {
    let disposed = false
    let handle: PluginListenerHandle | undefined
    let mediaHandle: PluginListenerHandle | undefined
    if (isAndroid) {
      void nativeBrowser.addListener('mediaEvent', (event: BrowserMediaEvent) => {
        if (!disposed) setMediaTabs(prev => reduceBrowserMedia(prev, event))
      }).then(h => { if (disposed) void h.remove(); else mediaHandle = h })
      void nativeBrowser.addListener('navigation', event => {
        if (disposed) return
        setCurrent(event.url)
        setAddress(event.url)
        setLoading(event.phase === 'start')
        if (event.phase === 'start') saveVisit(event.url)
        updateNativeState()
      }).then(h => { if (disposed) void h.remove(); else handle = h })
    }
    return () => {
      disposed = true
      void handle?.remove()
      void mediaHandle?.remove()
      loaded.current = false
      void nativeBrowser.close().catch(() => undefined)
    }
  }, [isAndroid, saveVisit, updateNativeState])
  useEffect(() => {
    if (!loaded.current) return
    const sync = () => { void nativeBrowser.setBounds({ ...getBounds(), visible: active && !panel && !playing }).catch(() => undefined) }
    sync()
    window.addEventListener('resize', sync)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    if (viewport.current) observer?.observe(viewport.current)
    return () => { window.removeEventListener('resize', sync); observer?.disconnect() }
  }, [current, active, panel, playing, getBounds])
  const openAddress = useCallback(async (value: string) => {
    const url = resolveAddress(value, search)
    if (!url) { setError('地址无效，请输入网址或关键词'); return }
    if (!isAndroid) { setError('原生网页浏览器目前支持 Android'); return }
    if (busy.current) return
    busy.current = true
    setError(''); setPanel(null); setSuggestions(false); setLoading(true)
    setAddress(url)
    try {
      if (loaded.current) {
        await nativeBrowser.setBounds({ ...getBounds(), visible: true })
        await nativeBrowser.navigate({ action: 'url', url })
      } else {
        await nativeBrowser.open({ url, scripts: loadUserScripts().filter(s => s.enabled), embedded: true, ...getBounds() })
        loaded.current = true
      }
      setCurrent(url)
      saveVisit(url)
      updateNativeState()
    } catch (err) { setError(err instanceof Error ? err.message : '页面打开失败'); setLoading(false) }
    finally { busy.current = false }
  }, [getBounds, isAndroid, saveVisit, search, updateNativeState])
  const action = (name: BrowserOp) => {
    if (!loaded.current) return
    void nativeBrowser.navigate({ action: name }).then(updateNativeState).catch(err => setError(String(err)))
  }
  const setPanelVisible = (next: typeof panel) => {
    setPanel(p => p === next ? null : next)
  }
  const goHome = () => {
    setPanel(null); setPlaying(null); setSuggestions(false)
    if (loaded.current) {
      void nativeBrowser.navigate({action:'home'}).then(updateNativeState).catch(err => setError(String(err)))
    } else {
      setCurrent(''); setAddress('')
    }
  }
  const playResource = (resource: MediaResourceDescriptor) => {
    if (playPending) return
    setPlayPending(true)
    setPlayError('')
    setPanel(null)
    // InkVideoPlayer owns native playback preparation and lease release.
    setPlaying(resource)
    window.setTimeout(() => setPlayPending(false), 350)
  }
  useEffect(() => {
    setMediaTabs(prev => {
      if (!prev.size || !tabs.length) return prev
      if ([...prev.keys()].every(id => activeTabIds.has(id))) return prev
      return new Map([...prev].filter(([id]) => activeTabIds.has(id)))
    })
  }, [activeTabIds])
  const toggleMark = () => {
    if (!current) return
    setMarks(prev => {
      const next = marked ? prev.filter(item => item.url !== current) : [{ url: current, title: pageTitle, time: Date.now() }, ...prev]
      localStorage.setItem(MARKS_KEY, JSON.stringify(next))
      return next
    })
  }
  const clearHistory = () => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }
  const menuItems: { label: string; secondary: string; icon: typeof Bookmark; action: () => void }[] = [
    { label: '媒体资源', secondary: mediaResources.length ? `发现 ${mediaResources.length} 条媒体` : '嗅探当前网页视频', icon: Film, action: () => {if (loaded.current) action('scanMedia');setPanel('media')} },
    { label: '新建标签', secondary: '创建独立网页标签', icon: Plus, action: () => {setPanel(null);action('new')} },
    { label: '切换标签', secondary: '管理已打开的页面', icon: Globe2, action: () => {updateNativeState();setPanel('tabs')} },
    { label: '主页', secondary: '常用网址与搜索', icon: Home, action: goHome },
    { label: marked ? '取消收藏' : '收藏当前页面', secondary: pageTitle || '保存网址', icon: Bookmark, action: toggleMark },
    { label: '浏览历史', secondary: `${history.length} 条记录`, icon: Clock3, action: () => setPanel('history') },
    { label: '书签', secondary: `${marks.length} 个网址`, icon: BookmarkCheck, action: () => setPanel('bookmarks') },
    { label: '用户脚本', secondary: `${scriptCount} 个已启用`, icon: ShieldCheck, action: () => setPanel('scripts') },
    { label: '脚本菜单', secondary: '执行网页中的脚本命令', icon: ShieldCheck, action: () => { setPanel(null); action('scriptMenu') } },
    { label: '下载管理', secondary: '查看系统下载文件', icon: Download, action: () => {setPanel(null);action('downloads')} },
    { label: '浏览器设置', secondary: '搜索引擎与桌面模式', icon: Settings2, action: () => setPanel('settings') },
  ]

  const showSearch = () => { setPanel(null); setSuggestions(true); if (active) setAddress('') }
  const addressBar = <button type="button" aria-label="搜索或输入网址" onClick={showSearch} className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-haze/60 px-3 text-left text-paper transition-colors active:bg-haze">
    {loading ? <LoaderCircle size={17} className="shrink-0 animate-spin text-cinnabar"/> : active ? <ShieldCheck size={16} className="shrink-0 text-paper-muted"/> : <Search size={18} className="shrink-0 text-paper-muted"/>}
    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{active ? pageTitle : '搜索或输入网址'}</span>
  </button>
  const addressRow = <div className="flex h-[52px] items-center gap-1.5 px-2">
    {addressBar}
    <Button label="网页工具" onClick={()=>setPanelVisible('menu')}><MoreHorizontal size={22}/></Button>
  </div>
  return <div role="dialog" aria-label="NewsNook 网页浏览器" aria-modal="true" className="fixed inset-0 z-[95] flex min-w-0 flex-col overflow-hidden bg-ink" style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}>
    {active && !bottomAddress && <header className="z-10 shrink-0 border-b border-haze bg-ink-raised">{addressRow}</header>}
    {error && <p role="alert" className="px-4 py-1 text-xs text-cinnabar">{error}</p>}

    <div ref={viewport} className="relative min-h-0 flex-1 overflow-hidden bg-ink">
      {!active && !playing && <div className="mx-auto flex h-full max-w-xl flex-col overflow-y-auto px-6 pt-10 pb-6">
        <div className="mx-auto mb-6 flex size-[70px] items-center justify-center rounded-3xl bg-ink-raised"><img src="/favicon.svg" alt="NewsNook" className="size-12 object-contain"/></div>
        <h1 className="text-center font-display text-2xl text-paper">从这里开始</h1>
        <p className="mt-2 text-center text-sm text-paper-muted">搜索、阅读，发现更多</p>
<button type="button" aria-label="首页搜索或输入网址" onClick={showSearch} className="mt-7 flex min-h-14 w-full items-center gap-3 rounded-2xl border border-haze bg-ink-raised px-4 text-paper-muted shadow-sm"><Search size={19}/>搜索或输入网址<ArrowRight size={18} className="ml-auto"/></button>
        <h2 className="mt-7 mb-2 text-xs font-semibold tracking-wider text-paper-muted">快捷访问</h2><div className="grid grid-cols-4 gap-3">
          {shortcuts.map((shortcut,index) => <button key={shortcut.url} type="button" onContextMenu={event=>{event.preventDefault();setShortcutAction(index)}} onTouchStart={event=>{const el=event.currentTarget;const token=window.setTimeout(()=>{setShortcutAction(index);el.dataset.longPress='1'},650);(el as any).__hold=token}} onTouchEnd={event=>window.clearTimeout((event.currentTarget as any).__hold)} onTouchMove={event=>window.clearTimeout((event.currentTarget as any).__hold)} onClick={event=>{if(event.currentTarget.dataset.longPress){delete event.currentTarget.dataset.longPress;return}void openAddress(shortcut.url)}} className="flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center active:scale-95">
            <span className="grid size-12 place-items-center rounded-2xl bg-ink-raised">{shortcutFaviconUrl(shortcut.url)&&!faviconFailed.includes(shortcut.url)?<img src={shortcutFaviconUrl(shortcut.url)!} alt="" className="size-6 object-contain" onError={()=>setFaviconFailed(prev=>[...prev,shortcut.url])}/>:<Globe2 size={21} strokeWidth={1.7} className="text-paper-muted"/>}</span><span className="w-full truncate text-[12px] font-medium text-paper">{shortcut.name}</span>
          </button>)}
          {shortcuts.length<8&&<button type="button" onClick={()=>{const url=window.prompt('快捷方式网址');if(!url)return;const name=window.prompt('名称',normalizeBrowserHost(url))||normalizeBrowserHost(url);const next=addBrowserShortcut(shortcuts,{name,url});setShortcuts(next);localStorage.setItem(SHORTCUT_KEY,JSON.stringify(next))}} className="flex flex-col items-center gap-2 px-1 py-2"><span className="grid size-12 place-items-center rounded-2xl bg-ink-raised"><Plus size={21}/></span><span className="text-xs text-paper-muted">添加</span></button>}
        </div>
        <div className="mt-5 flex items-center justify-between"><h2 className="text-sm font-semibold text-paper">最近访问</h2><button type="button" onClick={() => setPanel('history')} className="text-xs text-paper-faint">查看全部</button></div>
        <div className="mt-3 space-y-1">{recentSites.map(item => <button type="button" key={item.url} onClick={()=>{if(heldHistory.current===item.url){heldHistory.current=null;return}void openAddress(item.url)}} onTouchStart={()=>startHistoryHold(item)} onTouchEnd={cancelHistoryHold} onTouchMove={cancelHistoryHold} onContextMenu={event=>{event.preventDefault();setHistoryAction(item)}} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-haze"><Clock3 size={16} className="text-paper-faint" /><span className="min-w-0 flex-1 truncate text-[12px] text-paper-muted">{item.title}</span><ArrowRight size={14} className="text-paper-faint" /></button>)}{recentSites.length === 0 && <p className="pt-2 text-[12px] text-paper-faint">访问的网站将在这里显示</p>}</div>
      </div>}
      {active && loading && <div className="absolute top-0 left-0 h-[2px] w-1/2 animate-pulse bg-cinnabar" />}
      {playing && <div className="absolute inset-0 z-20 flex flex-col bg-ink">
        <div className="flex shrink-0 items-center gap-3 border-b border-haze p-3"><Button label="返回网页" onClick={()=>setPlaying(null)}><ChevronLeft size={22}/></Button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-paper">{browserResourceTitle(playing)}</p><p className="truncate text-xs text-paper-muted">{titleOf(playing.pageUrl)}</p></div><button type="button" className="text-xs text-cinnabar" onClick={()=>{setPlaying(null);setPanel('media')}}>切换资源</button></div>
        {playError&&<div role="alert" className="mx-3 mt-3 flex items-center justify-between gap-3 rounded-xl border border-haze bg-ink-raised p-3 text-sm text-paper"><span>{playError}</span><button type="button" className="shrink-0 text-cinnabar" onClick={()=>{setPlaying(null);setPanel('media')}}>换源</button></div>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-ink p-2"><InkVideoPlayer src={playing.url} title={titleOf(playing.pageUrl)} format={playing.type} sourcePage={playing.pageUrl} requestHeaders={playing.requestHeaders} extraUrls={playing.relatedUrls} resources={mediaResources} autoPlay mediaPageHost={false} onPlaybackError={()=>setPlayError('视频播放失败，请选择其他资源')} /></div>
      </div>}
    </div>

    <nav aria-label="浏览器控制" className="z-10 shrink-0 border-t border-haze bg-ink-raised">
      <div className="flex h-14 items-center justify-between gap-1 px-2">
        <Button label="主页" onClick={goHome}><Home size={21}/></Button>
        <Button label="后退" disabled={!nativeState.back} onClick={()=>action('back')}><ArrowLeft size={20}/></Button>
        {bottomAddress && active ? addressBar : <button type="button" aria-label="浏览器主页" onClick={active?()=>action('reload'):showSearch} className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-2xl bg-haze/50 px-3 text-[13px] text-paper-muted">{active ? pageTitle : '主页'}</button>}
        <Button label="标签页" onClick={()=>{updateNativeState();setPanelVisible('tabs')}}><span className="flex size-[23px] items-center justify-center rounded-md border-[1.6px] border-current font-mono text-[12px]">{tabs.length||1}</span></Button>
        <Button label="网页工具" onClick={()=>setPanelVisible('menu')}><MoreHorizontal size={23}/></Button>
      </div>
    </nav>

    {suggestions && <div role="dialog" aria-modal="true" aria-label="搜索与地址" className="absolute inset-0 z-40 flex flex-col bg-ink-raised" style={{top:'var(--sat)',bottom:'var(--sab)'}}>
      <div className="flex items-center gap-2.5 border-b border-haze px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-haze bg-ink px-3 focus-within:border-cinnabar">
          <Search size={18} className="shrink-0 text-paper-muted"/>
          <input ref={input} type="text" autoFocus aria-label="搜索或输入网址" enterKeyHint="go" value={address} onChange={event=>setAddress(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void openAddress(address)}} placeholder="搜索或输入网址" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="min-w-0 h-12 flex-1 bg-transparent text-[15px] text-paper outline-none" />
          {address && <button type="button" aria-label="清空搜索" onClick={()=>{setAddress('');input.current?.focus()}}><X size={17}/></button>}
        </div>
        <button type="button" onClick={()=>{setSuggestions(false);setAddress(current)}} className="shrink-0 px-1 py-3 text-sm text-paper">取消</button>
      </div>
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-paper-muted">
        <span className="shrink-0">访问</span><button className="min-w-0 flex-1 truncate text-left text-paper" onClick={()=>void openAddress(current||address)}>{current || '输入完整网址直接访问'}</button>
        {active && <button aria-label="复制网址" onClick={()=>{void navigator.clipboard.writeText(current)}}><Copy size={17}/></button>}
      </div>
      <div className="flex gap-5 overflow-x-auto border-b border-haze px-4 pb-3">
        {(['常用','搜索','AI','学术'] as const).map(category=><button type="button" key={category} onClick={()=>setSearchCategory(category)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${searchCategory===category?'bg-haze font-semibold text-paper':'text-paper-muted'}`}>{category}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-ink px-3 py-4">
        <div className="grid grid-cols-3 gap-2.5">{browserSearchProviders(searchCategory).map(provider=><button key={provider.id} type="button" onClick={()=>void openAddress(browserSearchDestination(provider,address))} className="flex min-h-16 min-w-0 items-center gap-2 rounded-xl bg-ink-raised px-3 text-left text-[13px] text-paper active:scale-[0.98]"><img src={`https://www.google.com/s2/favicons?domain=${new URL(provider.home).hostname}&sz=48`} alt="" className="size-5 shrink-0"/><span className="min-w-0 truncate">{provider.name}</span></button>)}</div>
        {address.trim() && <button type="button" className="mt-4 flex w-full items-center gap-3 rounded-xl bg-ink-raised p-3 text-left text-sm text-paper" onClick={()=>void openAddress(address)}><Search size={17}/><span className="min-w-0 flex-1 truncate">搜索或打开：{address}</span><ArrowRight size={17}/></button>}
        {history.filter(h=>address.trim()&&h.url.toLowerCase().includes(address.toLowerCase())).slice(0,4).map(h=><button type="button" key={h.url} onClick={()=>void openAddress(h.url)} className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs text-paper-muted"><Clock3 size={17}/><span className="min-w-0 flex-1 truncate">{h.url}</span></button>)}
      </div>
    </div>}

    {panel === 'media' && <div className="absolute inset-0 z-30 flex items-end bg-black/55" onClick={()=>setPanel(null)} role="presentation">
      <section className="flex max-h-[78vh] w-full flex-col rounded-t-3xl border border-haze bg-ink-raised px-4 pt-4 pb-7 shadow-2xl" onClick={event=>event.stopPropagation()} aria-label="网页媒体资源">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-haze"/><div className="mb-3 flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-ink text-cinnabar"><Film size={20}/></div><div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-paper">媒体资源</h2><p className="text-xs text-paper-muted">{mediaResources.length ? `已发现 ${mediaResources.length} 个可播放资源` : '浏览或播放网页视频后将自动发现资源'}</p></div><Button label="关闭" onClick={()=>setPanel(null)}><X size={21}/></Button></div>
        {playError&&<p className="mb-3 text-xs text-cinnabar" role="alert">{playError}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto">{mediaResources.map((resource,index)=><div key={resource.id||resource.url} className="mb-2 flex items-center gap-3 rounded-xl border border-haze bg-ink p-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-haze text-cinnabar"><Film size={18}/></div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-paper">{browserResourceTitle(resource)}</p><p className="mt-1 truncate text-xs text-paper-faint">{(()=>{try{return new URL(resource.url).hostname}catch{return `资源 ${index+1}`}})()}</p></div><button type="button" className="flex items-center gap-1 rounded-xl bg-cinnabar px-3 py-2 text-xs font-semibold text-white active:scale-95" onClick={()=>void playResource(resource)}><Play size={15} fill="currentColor"/>播放</button></div>)}
        {!mediaResources.length&&<div className="flex flex-col items-center py-8 text-center text-paper-muted"><Film size={32} strokeWidth={1.3}/><p className="mt-3 text-sm">当前页面暂无可播放资源</p><p className="mt-1 text-xs text-paper-faint">嗅探在浏览过程中持续运行</p></div>}</div>
        <button type="button" onClick={()=>{action('scanMedia');setPanel(null)}} className="mt-2 w-full rounded-xl border border-haze py-3 text-sm font-medium text-paper">重新扫描</button>
      </section></div>}

    {historyAction && <div className="absolute inset-0 z-50 flex items-end bg-black/55" onClick={()=>setHistoryAction(null)}><section className="w-full rounded-t-3xl bg-ink-raised p-5" onClick={event=>event.stopPropagation()}><p className="mb-4 truncate text-sm font-semibold text-paper">{normalizeBrowserHost(historyAction.url)}</p>{[
      ['打开网页',()=>void openAddress(historyAction.url)],
      ['从首页隐藏此网站',()=>{const host=normalizeBrowserHost(historyAction.url);const next=[...new Set([...hiddenHosts,host])];setHiddenHosts(next);localStorage.setItem(HIDDEN_KEY,JSON.stringify(next))}],
      ['删除这条记录',()=>{const next=history.filter(v=>v.url!==historyAction.url);setHistory(next);localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}],
      ['删除该网站全部历史',()=>{const next=removeSiteHistory(history,normalizeBrowserHost(historyAction.url));setHistory(next);localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}],
    ].map(([label,handler])=><button key={label as string} type="button" onClick={()=>{(handler as ()=>void)();setHistoryAction(null)}} className="block w-full border-b border-haze px-3 py-3 text-left text-sm text-paper">{label as string}</button>)}<button onClick={()=>setHistoryAction(null)} className="mt-3 w-full rounded-xl bg-haze py-3 text-sm text-paper">取消</button></section></div>}
    {shortcutAction!==null && <div className="absolute inset-0 z-50 flex items-end bg-black/55" onClick={()=>setShortcutAction(null)}><section className="w-full rounded-t-3xl bg-ink-raised p-5" onClick={event=>event.stopPropagation()}><p className="mb-3 text-sm text-paper">管理快捷访问</p>{(['上移','下移','删除'] as const).map((label)=> <button key={label} className="block w-full border-b border-haze py-3 text-left text-sm text-paper" onClick={()=>{const next=label==='删除'?shortcuts.filter((_,index)=>index!==shortcutAction):moveBrowserShortcut(shortcuts,shortcutAction,label==='上移'?-1:1);setShortcuts(next);localStorage.setItem(SHORTCUT_KEY,JSON.stringify(next));setShortcutAction(null)}}>{label}</button>)}<button className="mt-3 w-full rounded-xl bg-haze py-3" onClick={()=>setShortcutAction(null)}>取消</button></section></div>}
    {panel === 'menu' && <div className="absolute inset-0 z-30 flex items-end bg-black/60" onClick={() => setPanel(null)} role="presentation">
      <section className="w-full rounded-t-3xl border border-haze bg-ink-raised px-4 pt-5 pb-5 shadow-2xl" onClick={event => event.stopPropagation()} aria-label="浏览器菜单">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl text-paper">网页工具</h2><Button label="关闭菜单" onClick={() => setPanel(null)}><X size={19}/></Button></div>
        <div className="grid grid-cols-5 gap-x-1 gap-y-5">{menuItems.map(item=><button key={item.label} type="button" onClick={item.action} className="flex min-w-0 flex-col items-center gap-2 rounded-2xl px-1 py-2 text-center active:bg-haze"><item.icon size={22} strokeWidth={1.65} className="text-paper"/><span className="max-w-full truncate text-[12px] text-paper">{item.label}</span></button>)}</div>
        <button type="button" disabled={!active} onClick={() => {setPanel(null);action('desktop')}} className="mt-3 flex w-full items-center justify-between rounded-xl border border-haze bg-ink p-3 text-sm text-paper disabled:opacity-40"><span className="flex items-center gap-3">{nativeState.desktop ? <Laptop size={18}/> : <Smartphone size={18}/>}桌面版网页</span><span className="font-mono text-xs text-cinnabar">{nativeState.desktop ? '已启用' : '未启用'}</span></button>
      </section>
    </div>}

    {panel === 'tabs' && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">网页标签 · {tabs.length}</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><div className="grid grid-cols-2 gap-3">{tabs.map(tab => <div key={tab.index} className={`flex h-32 flex-col justify-between rounded-2xl border p-3 ${tab.active ? 'border-cinnabar bg-cinnabar/10' : 'border-haze bg-ink-raised'}`}>
        <div className="flex items-start justify-between gap-2"><Globe2 size={18} className={tab.active?'text-cinnabar':'text-paper-faint'}/><button type="button" aria-label={`关闭标签 ${tab.title}`} onClick={() => {void nativeBrowser.removeTab({index:tab.index}).then(() => {if(tabs.length<=1){loaded.current=false;setCurrent('');setAddress('');setNativeState({url:null,back:false,forward:false,desktop:false});setTabs([]);setMediaTabs(new Map());setPanel(null)}else updateNativeState()}).catch(err => setError(String(err)))}} className="text-paper-faint"><X size={16}/></button></div>
        <button type="button" className="min-w-0 text-left" onClick={() => {void nativeBrowser.activateTab({index:tab.index}).then(() => {updateNativeState();setPanel(null)}).catch(err => setError(String(err)))}}><span className="block truncate text-[13px] font-medium text-paper">{tab.title || titleOf(tab.url)}</span><span className="mt-1 block truncate font-mono text-xs text-paper-faint">{tab.url}</span></button>
      </div>)}</div></div>
      <button type="button" disabled={tabs.length>=6} onClick={() => {setPanel(null);action('new')}} className="mx-5 mb-4 flex items-center justify-center gap-2 rounded-xl bg-cinnabar py-3 text-sm font-semibold text-white disabled:opacity-35"><Plus size={18}/>新建标签页</button>
    </div>}

    {(panel === 'history' || panel === 'bookmarks') && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">{panel === 'history' ? '浏览历史' : '书签'}</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      {panel==='history'&&hiddenHosts.length>0&&<button type="button" className="mx-4 mt-3 rounded-xl border border-haze p-3 text-sm text-paper-muted" onClick={()=>{setHiddenHosts([]);localStorage.removeItem(HIDDEN_KEY)}}>恢复首页隐藏的 {hiddenHosts.length} 个网站</button>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{(panel === 'history' ? history : marks).map(item => <div key={item.url} className="flex items-center gap-3 border-b border-haze/55 py-3">
        <button type="button" className="min-w-0 flex-1 text-left" onContextMenu={event=>{if(panel==='history'){event.preventDefault();setHistoryAction(item)}}} onTouchStart={()=>{if(panel==='history')startHistoryHold(item)}} onTouchEnd={cancelHistoryHold} onTouchMove={cancelHistoryHold} onClick={()=>{if(heldHistory.current===item.url){heldHistory.current=null;return}void openAddress(item.url)}}><span className="block truncate text-sm text-paper">{item.title}</span><span className="mt-1 block truncate font-mono text-[12px] text-paper-faint">{item.url}</span></button>
        <button type="button" aria-label="删除" onClick={() => {if(panel==='history'){const next=history.filter(x=>x.url!==item.url);setHistory(next);localStorage.setItem(HISTORY_KEY,JSON.stringify(next))}else{const next=marks.filter(x=>x.url!==item.url);setMarks(next);localStorage.setItem(MARKS_KEY,JSON.stringify(next))}}}><Trash2 size={16} className="text-paper-faint" /></button>
      </div>)}{(panel==='history'?history:marks).length===0 && <p className="pt-12 text-center text-sm text-paper-faint">暂无记录</p>}</div>
      {panel === 'history' && history.length>0 && <button type="button" onClick={() => {if(window.confirm('清空全部浏览历史？')) clearHistory()}} className="mx-5 mb-5 rounded-xl border border-haze py-3 text-sm text-paper-muted">清除全部历史</button>}
    </div>}

    {panel === 'settings' && <div className="absolute inset-0 z-30 flex flex-col bg-ink" style={{paddingTop:'var(--sat)',paddingBottom:'var(--sab)'}}>
      <header className="flex items-center justify-between border-b border-haze bg-ink-raised p-3"><Button label="返回浏览器" onClick={() => setPanel(null)}><ChevronLeft size={22}/></Button><h2 className="font-display text-lg text-paper">浏览器设置</h2><Button label="关闭" onClick={() => setPanel(null)}><X size={20}/></Button></header>
      <div className="flex-1 overflow-y-auto px-6 py-6"><div className="font-mono text-[10px] tracking-[0.15em] text-cinnabar">SEARCH ENGINE</div><h3 className="mt-1 text-base text-paper">默认搜索引擎</h3><div className="mt-4 grid grid-cols-2 gap-2">{(Object.entries(engines) as [SearchChoice,{name:string,url:string}][]).map(([id,engine])=><button type="button" key={id} onClick={()=>{setSearch(id);localStorage.setItem(SEARCH_KEY,id)}} className={`rounded-xl border px-4 py-3 text-left text-sm ${search===id?'border-cinnabar bg-cinnabar/10 text-paper':'border-haze bg-ink-raised text-paper-muted'}`}>{engine.name}</button>)}</div>
        <div className="mt-8 border-t border-haze pt-6"><p className="mb-3 text-sm font-semibold text-paper">地址栏位置</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={()=>{setBottomAddress(false);localStorage.setItem(ADDRESS_POSITION_KEY,'top')}} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm ${!bottomAddress?'border-cinnabar bg-cinnabar/10 text-paper':'border-haze text-paper-muted'}`}><PanelTop size={18}/>顶部</button><button type="button" onClick={()=>{setBottomAddress(true);localStorage.setItem(ADDRESS_POSITION_KEY,'bottom')}} className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm ${bottomAddress?'border-cinnabar bg-cinnabar/10 text-paper':'border-haze text-paper-muted'}`}><PanelBottom size={18}/>底部</button></div></div><div className="mt-8 border-t border-haze pt-6"><div className="font-mono text-[10px] tracking-[0.15em] text-cinnabar">DISPLAY</div><button type="button" disabled={!active} onClick={() => {setPanel(null);action('desktop')}} className="mt-3 flex w-full items-center justify-between rounded-xl border border-haze bg-ink-raised px-4 py-3 text-sm text-paper disabled:opacity-40"><span>桌面版网页</span><span className="text-cinnabar">{nativeState.desktop ? '开启' : '关闭'}</span></button></div>
        <div className="mt-8 border-t border-haze pt-6"><p className="text-sm font-semibold text-paper">隐私与数据</p><p className="mt-2 text-xs leading-relaxed text-paper-faint">网页访问历史仅保留在本设备，与 NewsNook 的文章阅读记录分开存储。</p><button type="button" onClick={() => {if(window.confirm('清除浏览历史？')) clearHistory()}} className="mt-4 rounded-xl border border-haze px-4 py-3 text-sm text-paper-muted">清除浏览历史</button></div>
      </div>
    </div>}
    {panel === 'scripts' && <ScriptManager onClose={() => setPanel(null)} onChanged={() => setScriptCount(loadUserScripts().filter(s => s.enabled).length)} />}
  </div>
}
