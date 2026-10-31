import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Square,
  X,
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import { registerHardwareBackLayer } from '../../lib/hardwareBackStack'
import {
  BROWSER_ENGINES,
  BROWSER_KEYS,
  DEFAULT_BROWSER_SEARCH_ENGINE,
  loadBrowserPreferences,
  readBrowserList,
  readBrowserPreference,
  resolveBrowserAddress,
  writeBrowserPreference,
  type BrowserSearchChoice,
} from '../browser/browserPreferences'
import {
  BROWSER_SEARCH_PROVIDERS,
  type BrowserSearchProvider,
} from '../browser/browserSearchCatalog'
import { getBrowserBrandIcon } from '../browser/browserBrandIcons'
import {
  normalizeBrowserVisits,
  saveBrowserVisit,
} from '../browser/browserHistory'
import { useBrowserSession } from '../browser/useBrowserSession'
import { WikiSheetGrabber } from './WikiSheetGrabber'

export interface WikiSearchBrowserSheetProps {
  term: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onClose: () => void
  onOpenInFullBrowser?: (url: string) => void
  onSwitchToWiki?: () => void
}

const CANDIDATE_PROVIDERS: BrowserSearchProvider[] = BROWSER_SEARCH_PROVIDERS.filter(
  p => p.category === '搜索' || p.category === 'AI' || p.id === 'wikipedia',
)

export function WikiSearchBrowserSheet({
  term,
  expanded,
  onExpandedChange,
  onClose,
  onOpenInFullBrowser,
  onSwitchToWiki,
}: WikiSearchBrowserSheetProps) {
  const [preferences] = useState(loadBrowserPreferences)
  const viewport = useRef<HTMLDivElement>(null)
  const fullBrowserOpeningRef = useRef(false)
  const pillsContainerRef = useRef<HTMLDivElement>(null)

  const [searchEngine, setSearchEngine] = useState<BrowserSearchChoice>(() => {
    const saved = readBrowserPreference(BROWSER_KEYS.search)
    return saved && Object.prototype.hasOwnProperty.call(BROWSER_ENGINES, saved)
      ? (saved as BrowserSearchChoice)
      : DEFAULT_BROWSER_SEARCH_ENGINE
  })

  const currentProvider = useMemo(() => {
    return (
      CANDIDATE_PROVIDERS.find(p => p.id === searchEngine) ||
      BROWSER_SEARCH_PROVIDERS.find(p => p.id === searchEngine) ||
      CANDIDATE_PROVIDERS[0]
    )
  }, [searchEngine])

  const currentSearchUrl = useMemo(() => {
    return (
      resolveBrowserAddress(term, searchEngine) ||
      `https://www.bing.com/search?q=${encodeURIComponent(term)}`
    )
  }, [term, searchEngine])

  const recordVisit = useCallback(
    (url: string, title: string) => {
      if (preferences.privateMode) return
      try {
        const current = normalizeBrowserVisits(readBrowserList(BROWSER_KEYS.history))
        const next = saveBrowserVisit(current, url, title)
        writeBrowserPreference(BROWSER_KEYS.history, next)
      } catch {
        // Ignore storage failure
      }
    },
    [preferences.privateMode],
  )

  const session = useBrowserSession(
    viewport,
    false,
    recordVisit,
    false,
    undefined,
    { settings: preferences },
  )

  const sessionRef = useRef(session)
  sessionRef.current = session

  const initialOpenedRef = useRef(false)
  useEffect(() => {
    if (initialOpenedRef.current) return
    initialOpenedRef.current = true
    void sessionRef.current.open(currentSearchUrl)
  }, [currentSearchUrl])

  const handleSwitchEngine = useCallback(
    (providerId: BrowserSearchChoice) => {
      if (providerId === searchEngine) {
        void sessionRef.current.command('reload')
        return
      }
      setSearchEngine(providerId)
      try {
        writeBrowserPreference(BROWSER_KEYS.search, providerId)
      } catch {
        // Ignore storage error
      }
      const targetUrl =
        resolveBrowserAddress(term, providerId) ||
        `https://www.bing.com/search?q=${encodeURIComponent(term)}`
      void sessionRef.current.open(targetUrl)
    },
    [searchEngine, term],
  )

  useEffect(() => {
    return registerHardwareBackLayer(() => {
      if (sessionRef.current.state.back) {
        void sessionRef.current.command('back')
        return true
      }
      onClose()
      return true
    })
  }, [onClose])

  const isAndroid = Capacitor.getPlatform() === 'android'

  const handleOpenFullBrowser = async () => {
    if (!onOpenInFullBrowser || fullBrowserOpeningRef.current) return
    fullBrowserOpeningRef.current = true
    const currentUrl = session.state.url || currentSearchUrl
    // 两种浏览器共用同一个原生 WebView Host：先完成旧会话关闭，再交给全屏浏览器创建。
    await session.close()
    onOpenInFullBrowser(currentUrl)
  }

  return (
    <section
      className={`wiki-sheet wiki-sheet-search ${expanded ? 'wiki-sheet-expanded' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`搜索“${term}”`}
    >
      <header className="wiki-sheet-header">
        <WikiSheetGrabber
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          onReachTop={() => { void handleOpenFullBrowser() }}
        />

        {/* Row 1: Mode Switcher [百科 | 搜索] + Term Badge + Window Actions */}
        <div className="wiki-sheet-header-top">
          <div className="wiki-mode-capsule" role="tablist" aria-label="查看模式切换">
            {onSwitchToWiki && (
              <button
                type="button"
                role="tab"
                aria-selected={false}
                onClick={onSwitchToWiki}
                className="wiki-mode-tab"
                title="切换到词条百科"
              >
                <BookOpen size={12} className="shrink-0" />
                <span>百科</span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={true}
              className="wiki-mode-tab is-active"
              title="当前为网页搜索"
            >
              <Search size={12} className="shrink-0" />
              <span>搜索</span>
            </button>
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-center px-1">
            <div className="wiki-term-badge" title={`搜索词：“${term}”`}>
              <Search size={11} className="opacity-50 shrink-0" />
              <span className="truncate max-w-[120px] sm:max-w-[180px]">{term}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="在完整浏览器中打开"
              title="在完整浏览器中打开"
              onClick={() => { void handleOpenFullBrowser() }}
              className="wiki-nav-btn"
            >
              <ExternalLink size={15} />
            </button>
            <button
              type="button"
              aria-label={expanded ? '收起为半窗' : '展开为全屏'}
              title={expanded ? '收起为半窗' : '展开为全屏'}
              onClick={() => onExpandedChange(!expanded)}
              className="wiki-nav-btn"
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              aria-label="关闭搜索返回阅读"
              title="关闭搜索返回阅读"
              onClick={onClose}
              className="wiki-nav-btn"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Row 2: Search Engine Switcher Pills + Web Navigation */}
        <div className="wiki-sheet-header-toolbar">
          <div
            ref={pillsContainerRef}
            className="wiki-engine-pills-row"
            role="radiogroup"
            aria-label="切换搜索引擎"
          >
            {CANDIDATE_PROVIDERS.map(provider => {
              const active = provider.id === searchEngine
              const brandIcon = getBrowserBrandIcon(provider.home, provider.name, 'small')
              return (
                <button
                  key={provider.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleSwitchEngine(provider.id)}
                  className={`wiki-engine-pill ${active ? 'is-active' : ''}`}
                  title={`切换为 ${provider.name} 搜索“${term}”`}
                >
                  <span className="shrink-0 flex items-center justify-center w-3.5 h-3.5 [&>svg]:w-3.5 [&>svg]:h-3.5">
                    {brandIcon || <Globe size={13} className="opacity-60" />}
                  </span>
                  <span>{provider.name}</span>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-cinnabar shrink-0" />}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-0.5 shrink-0 pl-1 border-l border-haze/40">
            <button
              type="button"
              aria-label="后退"
              disabled={!session.state.back}
              onClick={() => void session.command('back')}
              className="wiki-nav-btn"
            >
              <ArrowLeft size={15} />
            </button>
            <button
              type="button"
              aria-label="前进"
              disabled={!session.state.forward}
              onClick={() => void session.command('forward')}
              className="wiki-nav-btn"
            >
              <ArrowRight size={15} />
            </button>
            <button
              type="button"
              aria-label={session.state.loading ? '停止加载' : '刷新'}
              onClick={() => void session.command(session.state.loading ? 'stop' : 'reload')}
              className="wiki-nav-btn"
            >
              {session.state.loading ? (
                <Square size={13} className="text-cinnabar" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {session.state.loading && (
          <div
            role="progressbar"
            aria-label="网页加载进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={session.state.progress ?? 0}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-haze/30"
          >
            <div
              className="h-full bg-gradient-to-r from-cinnabar via-cinnabar-soft to-cinnabar transition-[width] duration-150"
              style={{ width: `${Math.max(6, session.state.progress ?? 6)}%` }}
            />
          </div>
        )}
      </header>

      {/* Content Area */}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-ink">
        {!isAndroid ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-paper">
            <div className="mb-3 rounded-full bg-haze/25 p-3 text-cinnabar-soft">
              <Search size={26} />
            </div>
            <h3 className="mb-1 text-[15px] font-semibold">Web 开发预览</h3>
            <p className="mb-4 max-w-xs text-[12.5px] text-paper-muted">
              当前引擎：<strong className="text-paper">{currentProvider.name}</strong>。在 Android 设备中将以原生 WebView 呈现。
            </p>
            <a
              href={currentSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cinnabar px-4 py-2 text-[12.5px] font-medium text-white shadow-sm transition hover:opacity-90 active:scale-95"
            >
              <span>在外部浏览器打开搜索</span>
              <ExternalLink size={14} />
            </a>
          </div>
        ) : (
          <div ref={viewport} data-browser-viewport className="h-full w-full overflow-hidden bg-ink" />
        )}

        {session.state.error && isAndroid && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-ink">
            <p className="mb-3 text-[14px] text-paper-muted">{session.state.error}</p>
            <button
              type="button"
              onClick={() => void session.command('reload')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-haze px-3 py-1.5 text-[13px]"
            >
              <RefreshCw size={14} />
              <span>重新加载</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
