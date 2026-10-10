import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Film,
  Layers3,
  LayoutGrid,
  List,
  Plus,
  RotateCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import type { FrameworkHint } from '../features/frameworkDetect/types'
import type { NewsSource } from '../sources/registry'
import type { Article } from '../lib/types'
import { useCatalogSession } from '../features/siteCatalog/useCatalogSession'
import { catalogProfileFor } from '../features/siteCatalog/profile'
import { catalogSearchRequest } from '../features/siteCatalog/requests'
import {
  formatSiteBrandName,
  getSiteAvatarMeta,
  getSiteCleanDomain,
  getSiteFrameworkInfo,
  isLikelyVideoArticle,
  parseArticlePosterMeta,
} from '../features/siteCatalog/uiUtils'
import { InkImage } from '../components/InkImage'
import { CmsHelpDialog } from '../components/CmsHelpDialog'
import { useHardwareBackLayer } from '../hooks/useHardwareBackLayer'

export interface SiteScreenProps {
  sites: { source: NewsSource; hint?: FrameworkHint }[]
  initialSiteId?: string | null
  activeSiteId?: string | null
  onSelectSite?: (siteId: string) => void
  onManageSites?: () => void
  readIds: Set<string>
  onOpen: (article: Article) => void
  onBack?: () => void
}

export const SiteScreen = memo(function SiteScreen({
  sites,
  initialSiteId,
  activeSiteId,
  onSelectSite,
  onManageSites,
  readIds,
  onOpen,
  onBack,
}: SiteScreenProps) {
  // 当前选中的站点
  const [selectedId, setSelectedId] = useState<string | undefined>(() => {
    return activeSiteId ?? initialSiteId ?? sites[0]?.source.id
  })

  // 当外部 activeSiteId 变化时同步更新
  useEffect(() => {
    if (activeSiteId && activeSiteId !== selectedId) {
      setSelectedId(activeSiteId)
    }
  }, [activeSiteId, selectedId])

  const currentSiteEntry = useMemo(() => {
    return sites.find((s) => s.source.id === selectedId) ?? sites[0]
  }, [sites, selectedId])

  const source = currentSiteEntry?.source
  const { session, state } = useCatalogSession(source)

  const [query, setQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [selectedUrl, setSelectedUrl] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [siteSheetOpen, setSiteSheetOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sheetTitleId = useId()

  const profile = state.page?.profile ?? (source ? catalogProfileFor(source) : undefined)
  const fwInfo = useMemo(
    () => getSiteFrameworkInfo(source?.frameworkHint?.framework ?? profile?.engine),
    [source?.frameworkHint?.framework, profile?.engine],
  )
  const brandName = useMemo(() => formatSiteBrandName(source), [source])

  // 硬件返回键拦截：如果站点切换抽屉打开，优先关闭抽屉
  useHardwareBackLayer(siteSheetOpen, () => {
    setSiteSheetOpen(false)
    return true
  })

  useEffect(() => {
    setQuery('')
    setSearchActive(false)
    setSearchOpen(false)
    setSelectedUrl(source?.url ?? '')
    if (source) {
      void session?.open({ method: 'GET', url: source.url })
    }
  }, [session, source])

  const openUrl = (url: string) => {
    setSelectedUrl(url)
    setQuery('')
    setSearchActive(false)
    void session?.open({ method: 'GET', url })
    containerRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  const handleSelectSite = (siteId: string) => {
    if (siteId === source?.id) {
      openUrl(source.url)
    } else {
      setSelectedId(siteId)
      onSelectSite?.(siteId)
    }
    setSiteSheetOpen(false)
  }

  const handleSearch = () => {
    const trimmed = query.trim()
    if (!trimmed || !profile) return
    const request = catalogSearchRequest(profile, trimmed)
    if (request) {
      setSearchActive(true)
      void session?.open(request)
      containerRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
    }
  }

  const handleRefresh = async () => {
    if (refreshing || state.loading) return
    setRefreshing(true)
    try {
      if (state.request) {
        await session?.retry()
      } else if (source) {
        await session?.open({ method: 'GET', url: selectedUrl || source.url })
      }
    } finally {
      setRefreshing(false)
    }
  }

  const handleOpenExternal = () => {
    const url = state.page?.url || selectedUrl || source?.url
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  const handlePageChange = (type: 'prev' | 'next') => {
    if (type === 'prev') {
      session?.previous()
    } else {
      void session?.next()
    }
    containerRef.current?.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  if (!source) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-paper/5 text-paper-muted">
          <Layers3 size={28} strokeWidth={1.5} />
        </div>
        <p className="mt-4 font-display text-[16px] font-semibold text-paper">暂无已识别的 CMS 站点</p>
        <p className="mt-2 max-w-sm text-[12px] leading-relaxed text-paper-muted">
          请在自定义订阅中添加支持的网站列表或栏目地址，系统将自动识别为独立站点空间。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {onManageSites && (
            <button
              type="button"
              onClick={onManageSites}
              className="inline-flex items-center gap-1.5 rounded-full bg-cinnabar px-5 py-2.5 text-[12px] font-medium text-white shadow-xs transition-opacity hover:opacity-90 active:scale-95"
            >
              <Plus size={14} />
              添加自定义源
            </button>
          )}
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="查看 CMS 站点说明"
            className="inline-flex items-center gap-1.5 rounded-full border border-haze/90 bg-ink-raised px-4 py-2.5 text-[12px] font-medium text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-cinnabar active:scale-95"
          >
            <CircleAlert size={14} strokeWidth={1.8} className="text-cinnabar" />
            支持哪些站点？
          </button>
        </div>
        <CmsHelpDialog
          open={helpOpen}
          onClose={() => setHelpOpen(false)}
          onAddCms={onManageSites}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative h-full overflow-y-auto overscroll-contain bg-ink text-paper selection:bg-cinnabar/30">
      {/* 沉浸式紧凑顶部 Header（无巨大空白，极简优雅原生质感） */}
      <header className="sticky top-0 z-20 border-b border-haze/40 bg-ink/95 backdrop-blur-xl transition-colors">
        {/* 第一行：紧凑主导航栏 */}
        <div className="page-x flex items-center justify-between gap-2 py-1.5 sm:py-2">
          {/* 左侧：返回首页 */}
          <div className="flex shrink-0 items-center">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="返回"
                className="inline-flex size-8.5 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/8 hover:text-paper active:scale-95"
              >
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
            )}
          </div>

          {/* 居中：核心站点切换器标题（点击呼出切换抽屉） */}
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setSiteSheetOpen(true)}
              aria-haspopup="dialog"
              aria-label={`当前站点：${brandName}，点击切换站点`}
              className="group inline-flex max-w-[200px] sm:max-w-xs items-center gap-1.5 rounded-full px-2.5 py-1 text-center transition-colors hover:bg-paper/6 active:scale-95"
            >
              <span className="truncate font-display text-[15.5px] font-semibold text-paper group-hover:text-cinnabar transition-colors">
                {brandName}
              </span>
              <ChevronDown
                size={13}
                className="shrink-0 text-paper-muted transition-transform group-hover:translate-y-0.5"
              />
            </button>
          </div>

          {/* 右侧：功能按钮（搜索 / 视图 / 刷新 / 外链） */}
          <div className="flex shrink-0 items-center gap-0.5">
            {profile?.search && (
              <button
                type="button"
                onClick={() => {
                  setSearchOpen((prev) => !prev)
                  if (!searchOpen) {
                    setTimeout(() => searchInputRef.current?.focus?.(), 80)
                  }
                }}
                aria-label="展开搜索"
                className={`inline-flex size-8.5 items-center justify-center rounded-full transition-colors active:scale-95 ${
                  searchOpen || searchActive
                    ? 'bg-cinnabar/15 text-cinnabar'
                    : 'text-paper-muted hover:bg-paper/8 hover:text-paper'
                }`}
              >
                <Search size={16} strokeWidth={1.8} />
              </button>
            )}

            <button
              type="button"
              onClick={() => setViewMode((prev) => (prev === 'grid' ? 'list' : 'grid'))}
              aria-label={viewMode === 'grid' ? '切换为列表视图' : '切换为网格海报'}
              title={viewMode === 'grid' ? '切换为列表' : '切换为网格'}
              className="inline-flex size-8.5 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/8 hover:text-paper active:scale-95"
            >
              {viewMode === 'grid' ? <List size={16} /> : <LayoutGrid size={16} />}
            </button>

            <button
              type="button"
              onClick={handleRefresh}
              aria-label="刷新目录"
              disabled={state.loading || refreshing}
              className="inline-flex size-8.5 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/8 hover:text-paper disabled:opacity-40 active:scale-95"
            >
              <RotateCw size={15} className={refreshing || state.loading ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              onClick={handleOpenExternal}
              aria-label="在浏览器中打开"
              title="在浏览器中打开"
              className="hidden size-8.5 items-center justify-center rounded-full text-paper-muted transition-colors hover:bg-paper/8 hover:text-paper sm:inline-flex active:scale-95"
            >
              <ExternalLink size={15} />
            </button>
          </div>
        </div>

        {/* 展开搜索栏（按需显隐，不占用常态垂直高度） */}
        {(searchOpen || searchActive) && profile?.search && (
          <div className="page-x pb-2 pt-0.5 transition-all">
            <form
              className="relative flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                handleSearch()
              }}
            >
              <div className="relative flex flex-1 items-center">
                <Search
                  size={14}
                  className="absolute left-3 text-paper-faint pointer-events-none"
                />
                <input
                  ref={searchInputRef}
                  aria-label="站内搜索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`在 ${brandName} 中搜索...`}
                  className="w-full rounded-xl border border-haze/80 bg-ink-raised py-1.5 pl-8.5 pr-8 text-[12.5px] text-paper placeholder:text-paper-faint outline-none transition-all focus:border-cinnabar/60"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="清除输入"
                    className="absolute right-2.5 flex size-4.5 items-center justify-center rounded-full bg-paper/10 text-paper-muted hover:text-paper"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!query.trim() || state.loading}
                className="shrink-0 rounded-xl bg-cinnabar px-3.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition-opacity disabled:opacity-40 active:scale-95"
              >
                搜索
              </button>
            </form>

            {/* 搜索激活提示与重置按钮 */}
            {searchActive && (
              <div className="mt-1.5 flex items-center justify-between rounded-lg bg-cinnabar/8 px-2.5 py-1 border border-cinnabar/20 text-[11px]">
                <span className="text-paper-muted">
                  结果：<span className="font-medium text-cinnabar">“{query}”</span>
                </span>
                <button
                  type="button"
                  onClick={() => openUrl(selectedUrl || source.url)}
                  className="font-medium text-cinnabar hover:underline"
                >
                  清除搜索
                </button>
              </div>
            )}
          </div>
        )}

        {/* 第二行：分类胶囊栏（优雅 NewsNook 朱砂强调色，告别死黑白方块） */}
        {!!profile?.categories.length && (
          <nav aria-label="全站分类" className="page-x flex gap-1.5 overflow-x-auto scroll-hidden pb-2 pt-0.5">
            <button
              type="button"
              onClick={() => openUrl(source.url)}
              className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-all active:scale-95 ${
                selectedUrl === source.url && !searchActive
                  ? 'bg-cinnabar text-white shadow-xs shadow-cinnabar/20'
                  : 'text-paper-muted hover:text-paper hover:bg-paper/6'
              }`}
            >
              全部
            </button>
            {profile.categories.map((link) => {
              const active = selectedUrl === link.url && !searchActive
              return (
                <button
                  key={link.url}
                  type="button"
                  onClick={() => openUrl(link.url)}
                  className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] font-medium transition-all active:scale-95 ${
                    active
                      ? 'bg-cinnabar text-white shadow-xs shadow-cinnabar/20'
                      : 'text-paper-muted hover:text-paper hover:bg-paper/6'
                  }`}
                >
                  {link.title}
                </button>
              )
            })}
          </nav>
        )}

        {/* 排序与过滤栏（若站点提供） */}
        {(!!profile?.sorts?.length || !!profile?.filters?.length) && (
          <div className="page-x flex flex-col gap-1 border-t border-haze/25 py-1.5">
            {!!profile?.sorts?.length && (
              <div className="flex items-center gap-1.5 overflow-x-auto scroll-hidden">
                <span className="shrink-0 text-[11px] text-paper-faint">排序：</span>
                {profile.sorts.map((link) => (
                  <button
                    key={link.url}
                    type="button"
                    onClick={() => openUrl(link.url)}
                    className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      selectedUrl === link.url ? 'bg-cinnabar/15 text-cinnabar' : 'text-paper-muted hover:text-paper'
                    }`}
                  >
                    {link.title}
                  </button>
                ))}
              </div>
            )}
            {profile?.filters?.map((group) => (
              <div key={group.title} className="flex items-center gap-1.5 overflow-x-auto scroll-hidden">
                <span className="shrink-0 text-[11px] text-paper-faint">{group.title}：</span>
                {group.options.map((link) => (
                  <button
                    key={link.url}
                    type="button"
                    onClick={() => openUrl(link.url)}
                    className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      selectedUrl === link.url ? 'bg-cinnabar/15 text-cinnabar' : 'text-paper-muted hover:text-paper'
                    }`}
                  >
                    {link.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </header>

      {/* 主体内容网格/列表 */}
      <main className="page-x space-y-3 pt-3 pb-8">
        {/* 错误提示横幅 */}
        {state.error && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-2xl border border-cinnabar/30 bg-cinnabar/8 p-3.5 text-[12.5px] text-paper"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-cinnabar">访问站点遇到异常</p>
              <p className="mt-0.5 truncate text-paper-muted">{state.error}</p>
            </div>
            <button
              type="button"
              onClick={() => void session?.retry()}
              className="shrink-0 rounded-xl bg-cinnabar px-3.5 py-1.5 text-[12px] font-medium text-white shadow-xs active:scale-95"
            >
              重试
            </button>
          </div>
        )}

        {/* 截断条目提醒 */}
        {state.page?.truncated && (
          <div className="flex items-center gap-1.5 rounded-xl border border-haze/40 bg-paper/4 px-3 py-1.5 text-[11px] text-paper-muted">
            <Sparkles size={13} className="text-amber-500" />
            <span>本页条目较多，已呈现前 200 项精选结果</span>
          </div>
        )}

        {/* 骨架屏加载态：杜绝简陋白屏与小菊花 */}
        {state.loading && (!state.page?.articles || state.page.articles.length === 0) && (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-3 gap-2 sm:gap-2.5 md:grid-cols-4 lg:grid-cols-6'
                : 'space-y-2'
            }
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse overflow-hidden rounded-xl border border-haze/40 bg-ink-raised"
              >
                <div
                  className={`w-full bg-paper/8 ${
                    viewMode === 'grid'
                      ? fwInfo.isVideo
                        ? 'aspect-[3/4]'
                        : 'aspect-[16/10]'
                      : 'h-22'
                  }`}
                />
                <div className="p-2 space-y-1.5">
                  <div className="h-3 w-4/5 rounded bg-paper/10" />
                  <div className="h-2.5 w-1/2 rounded bg-paper/6" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 真实条目卡片渲染 */}
        {state.page && state.page.articles.length > 0 && (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-3 gap-2 sm:gap-2.5 md:grid-cols-4 lg:grid-cols-6'
                : 'space-y-2'
            }
          >
            {state.page.articles.map((article) => {
              const isRead = readIds.has(article.id)
              const isVideo = isLikelyVideoArticle(article, fwInfo.isVideo)
              const posterMeta = parseArticlePosterMeta(article.title)

              if (viewMode === 'list') {
                return (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => onOpen(article)}
                    className="group relative flex w-full items-start gap-3 overflow-hidden rounded-xl border border-haze/60 bg-ink-raised p-2.5 text-left transition-all hover:border-cinnabar/40 hover:bg-paper/4 active:scale-[0.99]"
                  >
                    {/* 左侧封面小图 (3:4 海报比例) */}
                    <div className="relative h-22 w-16 shrink-0 overflow-hidden rounded-lg bg-paper/8 border border-haze/40 sm:h-26 sm:w-19">
                      {article.image ? (
                        <InkImage
                          src={article.image}
                          alt=""
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-paper/5 text-paper-faint">
                          {isVideo ? <Film size={18} strokeWidth={1.5} /> : <Layers3 size={18} strokeWidth={1.5} />}
                        </div>
                      )}
                      {posterMeta.badge && (
                        <span className="absolute top-1 left-1 rounded bg-cinnabar/90 px-1 py-0.2 font-mono text-[8.5px] font-semibold text-white shadow-xs">
                          {posterMeta.badge}
                        </span>
                      )}
                    </div>

                    {/* 右侧详细文字信息与实质内容 */}
                    <div className="min-w-0 flex-1 flex flex-col justify-between self-stretch py-0.5">
                      <div>
                        <h3
                          className={`line-clamp-2 text-[13.5px] font-semibold leading-snug transition-colors group-hover:text-cinnabar ${
                            isRead ? 'text-paper-faint' : 'text-paper'
                          }`}
                        >
                          {posterMeta.cleanTitle}
                        </h3>
                        {article.summary && article.summary !== article.title && (
                          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-paper-muted">
                            {article.summary}
                          </p>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-paper-faint">
                        {posterMeta.year && (
                          <span className="rounded bg-paper/6 px-1.5 py-0.2 font-mono text-[9.5px] text-paper-muted">
                            {posterMeta.year}
                          </span>
                        )}
                        <span className="rounded bg-paper/6 px-1.5 py-0.2 text-[9.5px] text-paper-muted">
                          {fwInfo.categoryBadge}
                        </span>
                        {isRead && <span className="ml-auto text-[9.5px] text-paper-faint">已读</span>}
                      </div>
                    </div>
                  </button>
                )
              }

              // 网格海报视图 (3列紧凑布局，高信息密度)
              return (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onOpen(article)}
                  className="group relative flex flex-col overflow-hidden rounded-xl border border-haze/60 bg-ink-raised text-left transition-all hover:border-cinnabar/45 hover:shadow-md hover:shadow-cinnabar/5 active:scale-[0.98]"
                >
                  {/* 海报封面容器 */}
                  <div
                    className={`relative w-full overflow-hidden bg-paper/6 ${
                      isVideo ? 'aspect-[3/4]' : 'aspect-[16/10]'
                    }`}
                  >
                    {article.image ? (
                      <InkImage
                        src={article.image}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      /* 缺省海报艺术占位 */
                      <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-paper/10 via-paper/5 to-transparent p-2 text-center">
                        <div className="flex size-8 items-center justify-center rounded-full bg-paper/8 text-paper-muted shadow-xs transition-transform group-hover:scale-110">
                          {isVideo ? <Film size={15} strokeWidth={1.8} /> : <Layers3 size={15} strokeWidth={1.8} />}
                        </div>
                        <span className="mt-1 font-mono text-[8.5px] font-semibold uppercase tracking-wider text-paper-faint line-clamp-1">
                          {brandName}
                        </span>
                      </div>
                    )}

                    {/* 封面左上角画质/集数/状态角标 */}
                    {posterMeta.badge && (
                      <span className="absolute top-1 left-1 rounded bg-cinnabar/90 px-1 py-0.2 font-mono text-[9px] font-semibold text-white shadow-xs backdrop-blur-xs">
                        {posterMeta.badge}
                      </span>
                    )}

                    {/* 封面右上角年份微标 */}
                    {posterMeta.year && (
                      <span className="absolute top-1 right-1 rounded bg-black/70 px-1 py-0.2 font-mono text-[9px] font-medium text-white/95 backdrop-blur-xs shadow-xs">
                        {posterMeta.year}
                      </span>
                    )}

                    {/* 影视底部柔和渐变与微标 */}
                    {isVideo && (
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/30 to-transparent px-1.5 py-1 text-white">
                        <span className="flex items-center gap-0.5 text-[9px] font-medium opacity-90">
                          <Film size={9} />
                          <span>{fwInfo.categoryBadge}</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 标题与紧凑元数据 */}
                  <div className="flex flex-1 flex-col justify-between p-1.5 sm:p-2">
                    <h3
                      className={`line-clamp-2 text-[11.5px] sm:text-[12px] font-medium leading-[1.3] transition-colors group-hover:text-cinnabar ${
                        isRead ? 'text-paper-faint' : 'text-paper'
                      }`}
                      title={article.title}
                    >
                      {posterMeta.cleanTitle}
                    </h3>
                    <div className="mt-1 flex items-center justify-between text-[9.5px] text-paper-faint">
                      <span className="truncate">{posterMeta.year || fwInfo.categoryBadge}</span>
                      {isRead && <span className="shrink-0 text-[8.5px] text-paper-faint">已读</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* 空数据提示 */}
        {!state.loading && !state.error && (!state.page?.articles || state.page.articles.length === 0) && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-paper/5 text-paper-muted">
              <Layers3 size={24} strokeWidth={1.5} />
            </div>
            <p className="mt-4 font-display text-[15px] font-semibold text-paper">当前分类暂无内容</p>
            <p className="mt-1 text-[11px] text-paper-faint">请尝试选择其他分类或进行搜索</p>
            <button
              type="button"
              onClick={() => openUrl(source.url)}
              className="mt-4 rounded-xl border border-haze bg-paper/5 px-4 py-1.5 text-[12px] text-paper transition-colors hover:border-cinnabar/40"
            >
              返回站点主页
            </button>
          </div>
        )}
        {/* 原生流式底部分页控制器（自然跟随在列表末尾，舒展大方，绝无遮挡） */}
        {state.page && (
          <div className="flex items-center justify-center gap-3 pt-6 pb-10">
            <button
              type="button"
              disabled={state.loading || state.index <= 0}
              onClick={() => handlePageChange('prev')}
              className="inline-flex items-center gap-1.5 rounded-full border border-haze/80 bg-ink-raised px-4 py-2 text-[12px] font-medium text-paper transition-all hover:border-cinnabar/40 disabled:opacity-30 active:scale-95"
            >
              <ChevronLeft size={15} />
              <span className="whitespace-nowrap">上一页</span>
            </button>

            <span className="rounded-full bg-paper/6 px-4 py-1.5 font-mono text-[12px] font-medium text-paper whitespace-nowrap">
              第 {state.index + 1} 页
            </span>

            <button
              type="button"
              disabled={state.loading || (state.exhausted && !state.history[state.index + 1])}
              onClick={() => handlePageChange('next')}
              className="inline-flex items-center gap-1.5 rounded-full border border-haze/80 bg-ink-raised px-4 py-2 text-[12px] font-medium text-paper transition-all hover:border-cinnabar/40 disabled:opacity-30 active:scale-95"
            >
              <span className="whitespace-nowrap">下一页</span>
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </main>

      {/* 快捷切换站点底栏抽屉 (Site Switcher Bottom Sheet / Dialog) */}
      {siteSheetOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-end justify-center md:items-center p-0 md:p-6"
            role="presentation"
          >
            {/* 遮罩 */}
            <button
              type="button"
              aria-label="关闭站点切换"
              className="absolute inset-0 bg-black/60 transition-opacity"
              onClick={() => setSiteSheetOpen(false)}
            />

            {/* 抽屉卡片主体 */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={sheetTitleId}
              className="relative z-10 flex max-h-[min(85vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl md:rounded-2xl border border-haze/90 bg-ink-raised shadow-2xl"
              style={{
                paddingBottom: 'calc(var(--sab, 0px) + 14px)',
              }}
            >
              {/* 顶部把手指示器 */}
              <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
                <span className="h-1 w-10 rounded-full bg-haze" />
              </div>

              {/* 头部标题与管理入口 */}
              <div className="page-x flex shrink-0 items-center justify-between gap-3 border-b border-haze/50 pt-3 pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cinnabar/15 text-cinnabar">
                    <Layers3 size={18} />
                  </div>
                  <div className="min-w-0">
                    <h2 id={sheetTitleId} className="font-display text-[17px] font-semibold text-paper">
                      切换 CMS 站点
                    </h2>
                    <p className="mt-0.5 text-[11px] text-paper-faint">
                      已添加 {sites.length} 个独立空间 · 点击快速切换
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="查看 CMS 站点说明"
                    title="CMS 站点使用说明与支持类型"
                    onClick={() => setHelpOpen(true)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-haze bg-ink text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-cinnabar"
                  >
                    <CircleAlert size={14} strokeWidth={1.8} className="text-cinnabar" />
                  </button>
                  {onManageSites && (
                    <button
                      type="button"
                      onClick={() => {
                        setSiteSheetOpen(false)
                        onManageSites()
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-haze bg-ink px-3 py-1.5 text-[11px] font-medium text-paper-muted hover:border-cinnabar/50 hover:text-cinnabar"
                    >
                      <Plus size={12} />
                      管理站点
                    </button>
                  )}
                </div>
              </div>

              {/* 站点卡片列表 */}
              <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-2">
                {sites.map(({ source: site, hint }) => {
                  const active = site.id === source.id
                  const brand = formatSiteBrandName(site)
                  const domain = getSiteCleanDomain(site.url)
                  const av = getSiteAvatarMeta(site.url || site.id)
                  const siteFw = getSiteFrameworkInfo(hint?.framework ?? site.frameworkHint?.framework ?? site.catalogProfile?.engine)

                  return (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => handleSelectSite(site.id)}
                      className={`group flex w-full items-center gap-3.5 rounded-2xl border p-3.5 text-left transition-all active:scale-[0.985] ${
                        active
                          ? 'border-cinnabar/60 bg-cinnabar/8 ring-1 ring-cinnabar/20 shadow-xs'
                          : 'border-haze/70 bg-ink hover:border-cinnabar/40 hover:bg-paper/4'
                      }`}
                    >
                      {/* 渐变品牌头像 */}
                      <span
                        className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${av.gradientClass} text-[16px] font-bold text-white shadow-xs`}
                      >
                        {av.letter}
                      </span>

                      {/* 站点信息 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-display text-[15px] font-semibold text-paper group-hover:text-cinnabar transition-colors">
                            {brand}
                          </span>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-medium border ${siteFw.badgeClass}`}>
                            {siteFw.categoryBadge}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-paper-faint">
                          {domain || site.url}
                        </p>
                      </div>

                      {/* 激活标记与箭头 */}
                      {active ? (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-cinnabar">
                          <Check size={16} strokeWidth={2.5} />
                          <span className="hidden sm:inline">浏览中</span>
                        </div>
                      ) : (
                        <ChevronRight size={16} className="text-paper-faint transition-transform group-hover:translate-x-0.5" />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* 底部新增引导 */}
              {onManageSites && (
                <div className="shrink-0 border-t border-haze/40 p-3.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSiteSheetOpen(false)
                      onManageSites()
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-haze/90 bg-ink/40 py-2.5 text-[12px] font-medium text-paper-muted hover:border-cinnabar/50 hover:text-paper"
                  >
                    <Plus size={14} />
                    添加更多 CMS 站点
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      <CmsHelpDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onAddCms={onManageSites}
      />
    </div>
  )
})
