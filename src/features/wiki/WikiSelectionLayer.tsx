import { useCallback, useEffect, useRef, useState } from 'react'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { registerHardwareBackLayer } from '../../lib/hardwareBackStack'
import { BookOpen, Bookmark, Check, ChevronDown, ChevronLeft, Copy, Maximize2, Minimize2, Search, Settings2, X } from 'lucide-react'
import { readWikiLibrary, rememberWikiEntry, removeWikiBookmark, wikiEntryIdentity } from './library'
import {
  encyclopediaProviders, getEncyclopediaProvider, loadWikiSettings,
  lookupEncyclopedia, parseWikiSections, sanitizeWikiHtml, saveWikiSettings,
  type WikiEntry, type WikiSettings,
} from './encyclopedia'
import { WikiSearchBrowserSheet } from './WikiSearchBrowserSheet'
import { WikiSheetGrabber } from './WikiSheetGrabber'
import { openBrowserWithUrl, openContentLink } from '../browser/browserOpen'
import './wiki.css'

interface SelectionInfo { text: string; x: number; y: number }
type View = 'peek' | 'article' | 'settings' | 'search'

const READING_SURFACE = '.reader-prose, .linuxdo-post-prose, .zhihu-prose, .reader-content, .article-body, .post-body, .topic-body, .markdown-body, .cooked'
export function WikiSelectionLayer() {
  const [settings, setSettings] = useState<WikiSettings>(loadWikiSettings)
  const [selected, setSelected] = useState<SelectionInfo | null>(null)
  const [view, setView] = useState<View>('peek')
  const [entry, setEntry] = useState<WikiEntry | null>(null)
  const [activeTerm, setActiveTerm] = useState('')
  const [queryProviderId, setQueryProviderId] = useState(settings.providerId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fullText, setFullText] = useState<string | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [isFullArticleMode, setIsFullArticleMode] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [trail, setTrail] = useState<WikiEntry[]>([])
  const [history, setHistory] = useState(() => readWikiLibrary('history'))
  const [bookmarks, setBookmarks] = useState(() => readWikiLibrary('bookmarks'))
  const [settingsReturn, setSettingsReturn] = useState<View>('peek')
  const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false)
  const [footerDropdownOpen, setFooterDropdownOpen] = useState(false)
  const requestRef = useRef<AbortController | null>(null)
  const fullRef = useRef<AbortController | null>(null)
  const settingsRef = useRef(settings)
  const selectedRef = useRef(selected)
  const viewRef = useRef(view)
  settingsRef.current = settings
  selectedRef.current = selected
  viewRef.current = view

  const updateSettings = (patch: Partial<WikiSettings>) => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    saveWikiSettings(next)
    setSettings(next)
  }
  const dismiss = useCallback(() => {
    requestRef.current?.abort()
    fullRef.current?.abort()
    setSelected(null)
    setView('peek')
    setEntry(null)
    setActiveTerm('')
    setTrail([])
    setFullText(null)
    setError('')
    setLoading(false)
    setFullLoading(false)
    setIsFullArticleMode(false)
    setExpanded(false)
    setSettingsDropdownOpen(false)
    setFooterDropdownOpen(false)
  }, [])
  const lookup = useCallback(async (term: string, override?: string, nest = false) => {
    window.getSelection()?.removeAllRanges()
    requestRef.current?.abort()
    fullRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    if (!nest) setTrail([])
    else if (entry) setTrail(old => [...old, entry])
    setActiveTerm(term)
    setQueryProviderId(override || settingsRef.current.providerId)
    setView('article')
    setEntry(null)
    setError('')
    setLoading(true)
    setFullText(null)
    setFullLoading(false)
    setIsFullArticleMode(false)
    try {
      const result = await lookupEncyclopedia(term, settingsRef.current, controller.signal, override)
      if (!controller.signal.aborted) {
        setEntry(result)
        setHistory(rememberWikiEntry(result, 'history'))
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '查询失败，请稍后重试')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [entry])
  const handleSearch = useCallback((term: string) => {
    window.getSelection()?.removeAllRanges()
    requestRef.current?.abort()
    fullRef.current?.abort()
    setActiveTerm(term)
    setExpanded(false)
    setView('search')
    setError('')
    setLoading(false)
    setFullText(null)
    setFullLoading(false)
    setIsFullArticleMode(false)
  }, [])
  const switchToFullArticle = useCallback(async () => {
    setIsFullArticleMode(true)
    setExpanded(true)
    if (!entry) return
    if (fullText !== null) return
    fullRef.current?.abort()
    const controller = new AbortController()
    fullRef.current = controller
    setFullLoading(true)
    try {
      const text = await getEncyclopediaProvider(entry.providerId).fullText?.(entry, controller.signal)
      if (!controller.signal.aborted) setFullText(text || entry.summary)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取词条全文')
    } finally {
      if (!controller.signal.aborted) setFullLoading(false)
    }
  }, [entry, fullText])
  const toggleFullMode = useCallback(async () => {
    if (isFullArticleMode) {
      setIsFullArticleMode(false)
    } else {
      await switchToFullArticle()
    }
  }, [isFullArticleMode, switchToFullArticle])

  const openSettingsView = () => {
    setSettingsReturn(view)
    setView('settings')
  }
  const toggleBookmark = (value: WikiEntry) => {
    const exists = readWikiLibrary('bookmarks').some(item => wikiEntryIdentity(item) === wikiEntryIdentity(value))
    setBookmarks(exists ? removeWikiBookmark(value) : rememberWikiEntry(value, 'bookmarks'))
  }
  useEffect(() => {
    function openSettings() {
      setSelected({ text: '', x: 0, y: 0 })
      setSettingsReturn('peek')
      setExpanded(false)
      setView('settings')
    }
    window.addEventListener('newsnook:open-wiki-settings', openSettings)
    return () => window.removeEventListener('newsnook:open-wiki-settings', openSettings)
  }, [])
  useEffect(() => {
    const timers = new Set<number>()
    const clearTimers = () => {
      timers.forEach(timer => window.clearTimeout(timer))
      timers.clear()
    }
    function captureSelection() {
      if (!settingsRef.current.enabled || viewRef.current !== 'peek') return false
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        if (selectedRef.current) dismiss()
        return false
      }
      const term = selection.toString().trim().replace(/\s+/g, ' ')
      if (!term || term.length > 160) return false
      const elementFor = (node: Node | null) => node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement
      const node = elementFor(selection.anchorNode)
      const focus = elementFor(selection.focusNode)
      const excluded = 'input, textarea, [contenteditable]:not([contenteditable="false"]), button, .wiki-lookup-ui, [role="textbox"]'
      if (!node || !focus || node.closest(excluded) || focus.closest(excluded)) return false
      // Restrict to actual reading surfaces; never intercept editing or configuration controls.
      if (!node.closest(READING_SURFACE) || !focus.closest(READING_SURFACE)) return false
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return false
      const x = Math.min(window.innerWidth - 12, Math.max(12, rect.left + rect.width / 2))
      const y = Math.max(12, rect.top)
      setSelected(old => old?.text === term && old.x === x && old.y === y ? old : { text: term, x, y })
      setEntry(null)
      setView('peek')
      return true
    }
    function scheduleCapture(delay: number) {
      clearTimers()
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        captureSelection()
      }, delay)
      timers.add(timer)
    }
    function onPointerDown(event: Event) {
      if (!selectedRef.current || viewRef.current !== 'peek') return
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      clearTimers()
      // Clear the stale selection so pointerup/touchend cannot reopen the toolbar.
      window.getSelection()?.removeAllRanges()
      dismiss()
    }
    function onNativeSelection(event: Event) {
      // A cancelled event acknowledges that the Web toolbar owns this selection.
      if (captureSelection()) event.preventDefault()
    }
    function onContextMenu(event: Event) {
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      if (captureSelection()) event.preventDefault()
    }
    function onSelectionChange() {
      if (!selectedRef.current || viewRef.current !== 'peek') return
      scheduleCapture(40)
    }
    function shouldScheduleFor(target: EventTarget | null) {
      const element = target as Element | null
      if (element?.closest?.('.wiki-lookup-ui')) return false
      if (element?.closest?.(READING_SURFACE)) return true
      // Preserve range drag-and-release outside the reader; ordinary feed
      // scrolling has no range and must not schedule a global selection scan.
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed && selection.rangeCount)
    }
    function onPointerUp(event: PointerEvent) {
      if (shouldScheduleFor(event.target)) scheduleCapture(40)
    }
    function onTouchEnd(event: TouchEvent) {
      if (shouldScheduleFor(event.target)) scheduleCapture(100)
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.shiftKey || event.key === 'Shift') scheduleCapture(0)
    }
    window.addEventListener('newsnook:wiki-selection', onNativeSelection)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('touchstart', onPointerDown, true)
    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      clearTimers()
      window.removeEventListener('newsnook:wiki-selection', onNativeSelection)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('touchstart', onPointerDown, true)
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [dismiss])
  useEffect(() => {
    if (!selected || view !== 'peek' || !settings.directLookup) return
    void lookup(selected.text)
  }, [selected, view, settings.directLookup, lookup])
  const handleBack = useCallback(() => {
    if (view === 'settings' && settingsReturn === 'article' && entry) {
      setView('article')
      return
    }
    if (view === 'article' && trail.length > 0) {
      requestRef.current?.abort()
      fullRef.current?.abort()
      const previous = trail[trail.length - 1]
      setEntry(previous)
      setActiveTerm(previous.query)
      setQueryProviderId(previous.providerId)
      setTrail(old => old.slice(0, -1))
      setError('')
      setLoading(false)
      setFullText(null)
      setFullLoading(false)
      return
    }
    dismiss()
  }, [dismiss, entry, settingsReturn, trail, view])
  useEffect(() => {
    if (!selected) return
    return registerHardwareBackLayer(() => { handleBack(); return true })
  }, [handleBack, selected])
  useEffect(() => {
    if (!selected) return
    function onEscape(event: KeyboardEvent) { if (event.key === 'Escape') handleBack() }
    function onScroll(event: Event) {
      if ((event.target as Element)?.closest?.('.wiki-lookup-ui')) return
      if (view === 'peek') dismiss()
    }
    window.addEventListener('keydown', onEscape)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('keydown', onEscape)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [selected, view, dismiss, handleBack])
  useEffect(() => {
    if (!settingsDropdownOpen && !footerDropdownOpen) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null
      if (target?.closest('.wiki-settings-dropdown-container, .wiki-footer-dropdown-container')) return
      setSettingsDropdownOpen(false)
      setFooterDropdownOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSettingsDropdownOpen(false)
        setFooterDropdownOpen(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [settingsDropdownOpen, footerDropdownOpen])
  if (!selected) return null
  const activeProvider = getEncyclopediaProvider(entry?.providerId || queryProviderId)
  return (
    <div className="wiki-lookup-ui" onPointerDown={event => { if (view === 'peek') event.preventDefault(); event.stopPropagation() }} onTouchStart={event => event.stopPropagation()}>
      {view === 'peek' && (
        <div
          className="wiki-selection-popover"
          role="dialog"
          aria-label="划词操作"
          style={{
            left: Math.max(12, Math.min(window.innerWidth - 240, selected.x - 110)),
            top: Math.max(12, selected.y - 48),
          }}
        >
          <button
            type="button"
            className="wiki-popover-item"
            onClick={() => void lookup(selected.text)}
            title={`在百科中查找“${selected.text}”`}
          >
            <BookOpen size={14} className="shrink-0 text-cinnabar-soft" />
            <span>百科</span>
          </button>
          <div className="wiki-popover-divider" aria-hidden="true" />
          <button
            type="button"
            className="wiki-popover-item"
            onClick={() => handleSearch(selected.text)}
            title={`在浏览器中搜索“${selected.text}”`}
          >
            <Search size={14} className="shrink-0" />
            <span>搜索</span>
          </button>
          <div className="wiki-popover-divider" aria-hidden="true" />
          <button
            type="button"
            className="wiki-popover-item"
            aria-label="复制所选文字"
            title="复制"
            onClick={() => {
              void navigator.clipboard.writeText(selected.text)
              window.getSelection()?.removeAllRanges()
              dismiss()
            }}
          >
            <Copy size={14} className="shrink-0" />
            <span>复制</span>
          </button>
        </div>
      )}
      {(view === 'article' || view === 'settings') && (
        <>
          <div className="wiki-sheet-mask" onClick={dismiss} />
          <section className={`wiki-sheet ${expanded ? 'wiki-sheet-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={view === 'settings' ? '百科设置' : '百科词条'}>
            <header className="wiki-sheet-header">
              <WikiSheetGrabber expanded={expanded} onExpandedChange={setExpanded} />
              <div className="wiki-sheet-header-top">
                <div className="wiki-mode-capsule" role="tablist" aria-label="查看模式切换">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={true}
                    className="wiki-mode-tab is-active"
                    title="当前为词条百科"
                  >
                    <BookOpen size={12} className="shrink-0" />
                    <span>百科</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={false}
                    onClick={() => handleSearch(activeTerm || entry?.title || selected?.text || '')}
                    className="wiki-mode-tab"
                    title={`切换到网页搜索“${activeTerm || entry?.title || selected?.text || ''}”`}
                  >
                    <Search size={12} className="shrink-0" />
                    <span>搜索</span>
                  </button>
                </div>

                <div className="flex-1 min-w-0 flex items-center justify-center px-1">
                  <div
                    className="wiki-term-badge"
                    title={view === 'settings' ? '划词百科设置' : entry?.title || activeTerm || selected?.text || ''}
                  >
                    <span className="truncate max-w-[120px] sm:max-w-[180px]">
                      {view === 'settings' ? '百科设置' : entry?.title || activeTerm || selected?.text || ''}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {trail.length > 0 && view === 'article' && (
                    <button
                      type="button"
                      aria-label="返回上一词条"
                      onClick={handleBack}
                      className="wiki-nav-btn"
                      title="返回上一词条"
                    >
                      <ChevronLeft size={16} />
                    </button>
                  )}
                  {view === 'article' && (
                    <button
                      type="button"
                      aria-label="设置"
                      onClick={openSettingsView}
                      className="wiki-nav-btn"
                      title="百科设置"
                    >
                      <Settings2 size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={expanded ? '收起' : '展开'}
                    onClick={() => setExpanded(x => !x)}
                    className="wiki-nav-btn"
                    title={expanded ? '收起' : '展开'}
                  >
                    {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                  <button
                    type="button"
                    aria-label="关闭百科"
                    onClick={dismiss}
                    className="wiki-nav-btn"
                    title="关闭百科"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            </header>
            {view === 'settings' ? (
              <div className="wiki-sheet-body wiki-settings">
                <div className="wiki-settings-row"><span>启用划词百科</span><ToggleSwitch checked={settings.enabled} label="启用划词百科" onChange={() => updateSettings({ enabled: !settings.enabled })}/></div>
                <div className="wiki-settings-row">
                  <span>默认百科源</span>
                  <div className="wiki-settings-dropdown-container relative">
                    <button
                      type="button"
                      className="wiki-settings-picker-trigger"
                      onClick={() => setSettingsDropdownOpen(open => !open)}
                      aria-haspopup="listbox"
                      aria-expanded={settingsDropdownOpen}
                      aria-label={`默认百科源：${getEncyclopediaProvider(settings.providerId).name}`}
                    >
                      <span>{getEncyclopediaProvider(settings.providerId).name}</span>
                      <ChevronDown size={14} className={`opacity-60 shrink-0 transition-transform duration-150 ${settingsDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {settingsDropdownOpen && (
                      <div className="wiki-dropdown-menu" role="listbox">
                        {encyclopediaProviders().map(provider => {
                          const active = provider.id === settings.providerId
                          return (
                            <button
                              key={provider.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              className={`wiki-dropdown-item ${active ? 'is-active' : ''}`}
                              onClick={() => {
                                updateSettings({ providerId: provider.id })
                                setSettingsDropdownOpen(false)
                              }}
                            >
                              <span>{provider.name}</span>
                              {active && <Check size={14} className="text-cinnabar shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <div className="wiki-settings-row"><span>选中文字后直接打开词条</span><ToggleSwitch checked={settings.directLookup} label="选中文字后直接打开词条" onChange={() => updateSettings({ directLookup: !settings.directLookup })}/></div>
                <div className="wiki-settings-row"><span>中文维基未收录时尝试英文维基</span><ToggleSwitch checked={settings.fallbackEnglish} label="中文维基未收录时尝试英文维基" onChange={() => updateSettings({ fallbackEnglish: !settings.fallbackEnglish })}/></div>
                {(bookmarks.length > 0 || history.length > 0) && <div className="wiki-library">
                  {bookmarks.length > 0 && <><h3>收藏词条</h3><div>{bookmarks.map(item => <button type="button" key={wikiEntryIdentity(item)} onClick={() => void lookup(item.query, item.providerId)}>{item.title}</button>)}</div></>}
                  {history.length > 0 && <><h3>最近查询</h3><div>{history.slice(0, 12).map(item => <button type="button" key={wikiEntryIdentity(item)} onClick={() => void lookup(item.query, item.providerId)}>{item.title}</button>)}</div></>}
                </div>}
                <button className="wiki-primary" type="button" onClick={() => { if (settingsReturn === 'article' && (entry || loading)) setView('article'); else dismiss() }}>完成</button>
              </div>
            ) : (() => {
              const sections = entry ? parseWikiSections(fullText || '', entry.summary) : []
              const isBookmarked = entry ? bookmarks.some(item => wikiEntryIdentity(item) === wikiEntryIdentity(entry)) : false
              const scrollToSection = (id: string) => {
                const target = document.getElementById(id)
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              }

              return (
                <>
                  <div className="wiki-sheet-body" key={entry?.url || 'loading'}>
                    {loading && <p className="wiki-status">正在查询 {activeProvider.name}…</p>}
                    {error && <div className="wiki-error" role="alert">{error}<button type="button" onClick={() => void lookup(activeTerm || selected.text, queryProviderId)}>重试</button></div>}
                    {entry && (
                      <>
                        <div className="wiki-badges-row">
                          <span className="wiki-provider-badge">
                            {getEncyclopediaProvider(entry.providerId).name}{isFullArticleMode ? ' · 全文模式' : ''}
                          </span>
                          <span className="wiki-mode-badge">
                            {isFullArticleMode ? '站内全文' : (entry.isLiveApi ? '实时接口' : '网页提取')}
                          </span>
                        </div>

                        <div className="wiki-entry-heading">
                          <div>
                            <h3>{entry.title}</h3>
                            {entry.description && <p>{entry.description}</p>}
                          </div>
                          {entry.thumbnail && <img alt={entry.title} loading="lazy" src={entry.thumbnail} />}
                        </div>

                        {!isFullArticleMode ? (
                          <>
                            <div className="wiki-summary-card">
                              <div
                                className="wiki-entry-summary"
                                dangerouslySetInnerHTML={{ __html: sanitizeWikiHtml(entry.summary) }}
                              />
                              <div className="wiki-summary-card-footer">
                                <span className="wiki-summary-footer-hint">
                                  📑 章节目录与百科全文
                                </span>
                                <button
                                  type="button"
                                  className="wiki-expand-full-btn"
                                  onClick={() => void switchToFullArticle()}
                                >
                                  展开全文 &rarr;
                                </button>
                              </div>
                            </div>

                            {entry.structuredFacts && entry.structuredFacts.length > 0 && (
                              <div className="wiki-facts-card">
                                <div className="wiki-facts-grid">
                                  {entry.structuredFacts.map((fact, idx) => (
                                    <div key={idx} className="wiki-fact-item">
                                      <span className="wiki-fact-label">{fact.label}</span>
                                      <span className="wiki-fact-value">{fact.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {entry.related.length > 0 && (
                              <div className="wiki-related">
                                <h4><span>🔗</span> 关联词条</h4>
                                <div>
                                  {entry.related.map(term => (
                                    <button
                                      type="button"
                                      key={term}
                                      onClick={() => void lookup(term, entry.providerId, true)}
                                    >
                                      {term} &rarr;
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            {sections.length > 1 && (
                              <div className="wiki-toc-card">
                                <div className="wiki-toc-header">
                                  <span className="wiki-toc-title">📑 词条章节目录 (点击直达)</span>
                                  <span className="wiki-toc-count">{sections.length} 节</span>
                                </div>
                                <div className="wiki-toc-grid">
                                  {sections.map((sec, idx) => (
                                    <button
                                      key={sec.id}
                                      type="button"
                                      className="wiki-toc-btn"
                                      onClick={() => scrollToSection(sec.id)}
                                    >
                                      <span className="wiki-toc-num">{String(idx + 1).padStart(2, '0')}.</span>
                                      <span>{sec.title}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {entry.structuredFacts && entry.structuredFacts.length > 0 && (
                              <div className="wiki-facts-card">
                                <div className="wiki-facts-header">📊 词条结构化档案 (Infobox)</div>
                                <div className="wiki-facts-grid">
                                  {entry.structuredFacts.map((fact, idx) => (
                                    <div key={idx} className="wiki-fact-item">
                                      <span className="wiki-fact-label">{fact.label}</span>
                                      <span className="wiki-fact-value">{fact.value}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="wiki-sections-body">
                              {fullLoading && (
                                <p className="wiki-status">正在加载完整词条章节…</p>
                              )}
                              {sections.map((sec, idx) => (
                                <section key={sec.id} id={sec.id} className="wiki-chapter">
                                  <div className="wiki-chapter-header">
                                    <span className="wiki-chapter-badge">{String(idx + 1).padStart(2, '0')}</span>
                                    <h4 className="wiki-chapter-title">{sec.title}</h4>
                                  </div>
                                  <div className="wiki-chapter-paragraphs">
                                    {sec.paragraphs.map((p, pIdx) => (
                                      <div
                                        key={pIdx}
                                        className={`wiki-chapter-p ${idx === 0 && pIdx === 0 ? 'wiki-entry-summary' : ''}`}
                                        dangerouslySetInnerHTML={{ __html: sanitizeWikiHtml(p) }}
                                      />
                                    ))}
                                  </div>
                                </section>
                              ))}
                            </div>

                            {entry.related.length > 0 && (
                              <div className="wiki-related">
                                <h4><span>🔗</span> 关联词条</h4>
                                <div>
                                  {entry.related.map(term => (
                                    <button
                                      type="button"
                                      key={term}
                                      onClick={() => void lookup(term, entry.providerId, true)}
                                    >
                                      {term} &rarr;
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <footer className="wiki-sheet-footer">
                    <div className="wiki-footer-left">
                      <div className="wiki-footer-telemetry">
                        <span className="wiki-telemetry-dot" />
                        <span>{entry?.isLiveApi ? '实时接口' : '网页提取'} · {entry?.latencyMs ? `${entry.latencyMs}ms` : '就绪'}</span>
                      </div>
                      <div className="wiki-footer-dropdown-container relative min-w-0">
                        <button
                          type="button"
                          className="wiki-footer-picker-trigger"
                          onClick={() => setFooterDropdownOpen(open => !open)}
                          aria-haspopup="listbox"
                          aria-expanded={footerDropdownOpen}
                          aria-label={`切换查询百科源，当前为${getEncyclopediaProvider(entry?.providerId || queryProviderId).name}`}
                        >
                          <span className="truncate">{getEncyclopediaProvider(entry?.providerId || queryProviderId).name}</span>
                          <ChevronDown size={13} className={`opacity-60 shrink-0 transition-transform duration-150 ${footerDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>
                        {footerDropdownOpen && (
                          <div className="wiki-dropdown-menu wiki-dropdown-menu-up" role="listbox">
                            {encyclopediaProviders().map(provider => {
                              const active = provider.id === (entry?.providerId || queryProviderId)
                              return (
                                <button
                                  key={provider.id}
                                  type="button"
                                  role="option"
                                  aria-selected={active}
                                  className={`wiki-dropdown-item ${active ? 'is-active' : ''}`}
                                  onClick={() => {
                                    setFooterDropdownOpen(false)
                                    updateSettings({ providerId: provider.id })
                                    void lookup(activeTerm || selected.text, provider.id)
                                  }}
                                >
                                  <span>{provider.name}</span>
                                  {active && <Check size={14} className="text-cinnabar shrink-0" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    {entry && (
                      <div className="wiki-footer-actions">
                        <a href={entry.url} target="_blank" rel="noopener noreferrer" onClick={(event) => {
                          if (openContentLink(entry.url)) {
                            event.preventDefault()
                            dismiss()
                          }
                        }}>原文</a>
                        <button
                          type="button"
                          className={`wiki-btn-icon ${isBookmarked ? 'is-active' : ''}`}
                          onClick={() => toggleBookmark(entry)}
                          aria-label={isBookmarked ? '取消收藏' : '收藏词条'}
                          title={isBookmarked ? '已收藏' : '加入生词本'}
                        >
                          <Bookmark size={15} fill={isBookmarked ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          className="wiki-footer-btn-full"
                          onClick={() => void toggleFullMode()}
                          disabled={fullLoading}
                        >
                          <BookOpen size={13} className="shrink-0" />
                          <span>{fullLoading ? '加载中' : isFullArticleMode ? '摘要' : '全文'}</span>
                        </button>
                      </div>
                    )}
                  </footer>
                </>
              )
            })()}
          </section>
        </>
      )}
      {view === 'search' && (
        <>
          <div className="wiki-sheet-mask" onClick={dismiss} />
          <WikiSearchBrowserSheet
            term={activeTerm || selected?.text || ''}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onClose={dismiss}
            onOpenInFullBrowser={(url) => {
              dismiss()
              openBrowserWithUrl(url)
            }}
            onSwitchToWiki={() => {
              const query = activeTerm || selected?.text
              if (query) void lookup(query)
            }}
          />
        </>
      )}
    </div>
  )
}
