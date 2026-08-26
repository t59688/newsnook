import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Loader2, RotateCw, Search, X } from 'lucide-react'

import { ArticleRow, LeadStory } from '../components/ArticleItem'
import { CategoryRail } from '../components/CategoryRail'
import { FeedSkeleton } from '../components/FeedSkeleton'
import { PresetSwitcher, type PresetSwitcherItem } from '../components/PresetSwitcher'
import { PullIndicator } from '../components/PullIndicator'
import { SourceFilterChips } from '../components/SourceFilterChips'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { usePullToRefresh } from '../hooks/usePullToRefresh'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useSwipeCategory, type SwipeDirection } from '../hooks/useSwipeCategory'
import { inkPulse, markRevealedAll, revealItems } from '../lib/motion'
import type { PaginationViewState } from '../lib/feedPagination'
import { chineseDate, dayBucket, relativeTime } from '../lib/time'
import type { Article, RefreshProgress, SourceStatus } from '../lib/types'
import { DEFAULT_TRANSLATION_PREFS } from '../features/translation/config'
import { useFeedTranslation } from '../features/translation/useFeedTranslation'
import type { TranslationPrefs } from '../features/translation/types'
import { extractCatalog } from '../features/catalogEngine/engine'
import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
import { RECOMMEND_CATEGORY_ID, type CategoryId, type NewsCategory } from '../sources/categories'
import { findSource, type NewsSource } from '../sources/registry'
import { fetchAbsoluteText } from '../lib/http'

const EMPTY_ARTICLE_IDS: ReadonlySet<string> = new Set()

interface Props {
  title: string
  caption: string
  articles: Article[]
  statuses: SourceStatus[]
  refreshing: boolean
  refreshProgress?: RefreshProgress | null
  loadingMore?: boolean
  paginationState?: PaginationViewState
  lastUpdated?: number
  readIds: Set<string>
  laterIds: Set<string>
  /** 持久预存正文 ID；仅用于低权重云朵状态标记 */
  prestoredIds?: ReadonlySet<string>
  showLead: boolean
  /** 内容全部来自本地缓存，尚未拿到本次联网结果 */
  offline?: boolean
  categories?: NewsCategory[]
  categoryId?: CategoryId
  onCategoryChange?: (id: CategoryId) => void
  /** 当前分类下可供筛选的信源列表 */
  availableSources?: NewsSource[]
  /** 当前分类下选中的单个信源 ID（null 为全部） */
  selectedSourceId?: string | null
  /** 切换选中的单个信源 */
  onSelectSource?: (sourceId: string | null) => void
  /** 预览邻页用：按分类取已缓存的文章，横滑时并排露出 */
  articlesForCategory?: (id: CategoryId) => Article[]
  /** 首页场景预设快捷切换；单源聚焦页不传 */
  presetSwitcher?: {
    activeName: string
    items: PresetSwitcherItem[]
    onSelect: (id: string) => void
    onManage: () => void
    onSites?: () => void
    siteCount?: number
  }
  translationPrefs?: TranslationPrefs
  /** 自定义源，用于刷新进度显示名称 */
  customSources?: NewsSource[]
  onRefresh: () => Promise<void>
  onLoadMore?: () => void
  onOpen: (article: Article) => void
  onBack?: () => void
  /** 仅主今日流品牌名「有所闻」时传入；单源标题不启用 */
  onBrandTap?: () => void
  /** 打开本地离线搜索；与 searchTemplate 的站内联网搜索是两回事 */
  onOpenLocalSearch?: () => void
  /** 递增时触发与下拉相同的刷新动画与加载（底栏双击速闻） */
  pullRefreshSeq?: number
  /** 站内搜索模板（仅 web-catalog 源有 frameworkHint.searchTemplate 时传入） */
  searchTemplate?: string
  /** 框架站点分类列表（frameworkHint.categories） */
  frameworkCategories?: { title: string; url: string }[]
}

/** 邻页预览：排版与正式列表对齐，并恢复该分类上次滚动位置，避免滑入时先顶后跳 */
function CategoryPeek({
  articles,
  showLead,
  readIds,
  laterIds,
  prestoredIds,
  scrollTop = 0,
  onOpen,
}: {
  articles: Article[]
  showLead: boolean
  readIds: Set<string>
  laterIds: Set<string>
  prestoredIds: ReadonlySet<string>
  scrollTop?: number
  onOpen: (article: Article) => void
}) {
  // 邻页预览只取前 8 篇，既满足横滑露出的视觉效果，又避免在横滑拖拽时三页 DOM 爆炸引发严重掉帧
  const previewArticles = useMemo(() => articles.slice(0, 8), [articles])
  const lead = showLead ? previewArticles.find((item) => item.image) : undefined
  const rest = useMemo(
    () => (lead ? previewArticles.filter((item) => item.id !== lead.id) : previewArticles),
    [previewArticles, lead],
  )
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>()
    rest.forEach((article) => {
      const key = dayBucket(article.publishedAt)
      const list = map.get(key)
      if (list) list.push(article)
      else map.set(key, [article])
    })
    return [...map.entries()]
  }, [rest])

  if (articles.length === 0) {
    return (
      <div className="h-full bg-ink px-4 pt-10">
        <div className="space-y-4">
          <div className="h-4 w-1/3 rounded bg-haze/80" />
          <div className="h-14 rounded-xl bg-haze/60" />
          <div className="h-14 rounded-xl bg-haze/50" />
          <div className="h-14 rounded-xl bg-haze/40" />
        </div>
        <p className="mt-8 text-center font-mono text-[10px] tracking-[0.14em] text-paper-faint">
          邻页加载中
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-hidden bg-ink">
      {/* 用位移模拟该分类上次的 scrollTop，松手进页后与真实列表对齐 */}
      <div style={{ transform: scrollTop ? `translateY(-${scrollTop}px)` : undefined }}>
        {lead && (
          <LeadStory
            article={lead}
            read={readIds.has(lead.id)}
            saved={laterIds.has(lead.id)}
            prestored={prestoredIds.has(lead.id)}
            onOpen={onOpen}
            revealed
            variant="lead"
          />
        )}
        {grouped.map(([bucket, items]) => (
          <div key={bucket}>
            <div className="page-x flex items-center gap-2.5 pt-5 pb-1.5">
              <span className="font-mono text-[11px] tracking-[0.16em] text-paper-muted font-medium">{bucket}</span>
              <span className="h-px flex-1 bg-haze" aria-hidden />
            </div>
            <ul className="divide-y divide-haze">
              {items.map((article) => (
                <ArticleRow
                  key={article.id}
                  article={article}
                  read={readIds.has(article.id)}
                  saved={laterIds.has(article.id)}
                  prestored={prestoredIds.has(article.id)}
                  onOpen={onOpen}
                  revealed
                  variant="row"
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export const FeedScreen = memo(function FeedScreen({
  title,
  caption,
  articles,
  statuses,
  refreshing,
  refreshProgress,
  loadingMore = false,
  paginationState = 'unsupported',
  lastUpdated,
  readIds,
  laterIds,
  prestoredIds = EMPTY_ARTICLE_IDS,
  showLead,
  offline,
  categories,
  categoryId,
  onCategoryChange,
  availableSources,
  selectedSourceId,
  onSelectSource,
  articlesForCategory,
  presetSwitcher,
  translationPrefs,
  customSources,
  onRefresh,
  onLoadMore,
  onOpen,
  onBack,
  onBrandTap,
  onOpenLocalSearch,
  pullRefreshSeq = 0,
  searchTemplate,
  frameworkCategories,
}: Props) {
  const isDesktop = useIsDesktop()
  const reduced = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const wasRefreshing = useRef(refreshing)
  /** 各分类独立记住滚动位置，避免共用滚动容器时互相串位 */
  const scrollByCategory = useRef<Partial<Record<CategoryId, number>>>({})
  const activeCategoryRef = useRef(categoryId)
  const scrollTopRef = useRef(0)
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore

  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<Article[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const handleSearch = useCallback(async () => {
    if (!searchTemplate || !searchQuery.trim()) return
    const url = searchTemplate.replace('{query}', encodeURIComponent(searchQuery.trim()))
    setSearching(true)
    setSearchError(null)
    try {
      const html = await fetchAbsoluteText(url)
      const catalog = extractCatalog(html, url)
      if (!catalog.items.length) {
        setSearchResults([])
        return
      }
      const dummySource: NewsSource = {
        id: 'search_temp',
        name: 'Search',
        label: 'Search',
        group: 'custom',
        kind: 'web-catalog',
        url,
        enabled: true,
      }
      const results = catalogHtmlToArticles(dummySource, html, Date.now())
      setSearchResults(results)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }, [searchTemplate, searchQuery])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setSearchResults(null)
    setSearchError(null)
  }, [])

  const [activeFwCat, setActiveFwCat] = useState<number | null>(null)
  const [fwCatArticles, setFwCatArticles] = useState<Article[] | null>(null)
  const [fwCatLoading, setFwCatLoading] = useState(false)
  const [fwCatPage, setFwCatPage] = useState(0)
  const [fwCatExhausted, setFwCatExhausted] = useState(false)

  const selectFwCategory = useCallback(async (idx: number | null) => {
    setActiveFwCat(idx)
    setFwCatPage(0)
    setFwCatExhausted(false)
    if (idx === null || !frameworkCategories?.[idx]) {
      setFwCatArticles(null)
      return
    }
    const catUrl = frameworkCategories[idx].url
    setFwCatLoading(true)
    try {
      const html = await fetchAbsoluteText(catUrl)
      const results = catalogHtmlToArticles(
        { id: 'fw_cat', name: '', label: '', group: 'custom', kind: 'web-catalog', url: catUrl, enabled: true },
        html, Date.now(),
      )
      setFwCatArticles(results)
    } catch {
      setFwCatArticles([])
    } finally {
      setFwCatLoading(false)
    }
  }, [frameworkCategories])

  const loadMoreFwCat = useCallback(async () => {
    if (fwCatLoading || fwCatExhausted || activeFwCat === null || !frameworkCategories?.[activeFwCat]) return
    const catUrl = frameworkCategories[activeFwCat].url
    const nextPage = fwCatPage + 1
    const pageUrl = catUrl.replace(/\.html$/i, '') + `/page/${nextPage + 1}.html`
    setFwCatLoading(true)
    try {
      const html = await fetchAbsoluteText(pageUrl)
      const results = catalogHtmlToArticles(
        { id: 'fw_cat', name: '', label: '', group: 'custom', kind: 'web-catalog', url: pageUrl, enabled: true },
        html, Date.now(),
      )
      if (!results.length) {
        setFwCatExhausted(true)
      } else {
        setFwCatArticles((prev) => [...(prev ?? []), ...results])
        setFwCatPage(nextPage)
      }
    } catch {
      setFwCatExhausted(true)
    } finally {
      setFwCatLoading(false)
    }
  }, [activeFwCat, frameworkCategories, fwCatPage, fwCatLoading, fwCatExhausted])

  const loadingMoreRef = useRef(loadingMore)
  loadingMoreRef.current = loadingMore
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const loadRequestedForRef = useRef('')
  const inkLineRef = useRef<HTMLDivElement>(null)
  const scrollFrameRef = useRef(0)
  /** 横滑提交后跳过列表入场动画，避免预览→正式页闪白/闪透明 */
  const skipRevealAfterSwipe = useRef(false)

  const activeTranslationPrefs = translationPrefs ?? DEFAULT_TRANSLATION_PREFS
  const { translations } = useFeedTranslation(
    articles,
    activeTranslationPrefs,
    { enabled: activeTranslationPrefs.translateFeed !== false },
  )

  const { containerRef, indicatorRef, phase, cancel: cancelPull, trigger: triggerPullRefresh } =
    usePullToRefresh({
      onRefresh,
      reduced,
    })
  const lastPullRefreshSeq = useRef(pullRefreshSeq)

  useEffect(() => {
    if (pullRefreshSeq === lastPullRefreshSeq.current) return
    lastPullRefreshSeq.current = pullRefreshSeq
    if (refreshing) return
    triggerPullRefresh()
  }, [pullRefreshSeq, triggerPullRefresh, refreshing])

  const swipeCategories = categories ?? []
  const activeIndex = categoryId
    ? swipeCategories.findIndex((item) => item.id === categoryId)
    : -1
  const swipeEnabled = Boolean(onCategoryChange) && activeIndex >= 0 && swipeCategories.length > 1

  const neighbourOf = (direction: SwipeDirection) => {
    if (activeIndex < 0) return undefined
    return swipeCategories[direction === 'next' ? activeIndex + 1 : activeIndex - 1]
  }

  const prevCategory = neighbourOf('prev')
  const nextCategory = neighbourOf('next')

  const prevArticles = useMemo(
    () => (prevCategory && articlesForCategory ? articlesForCategory(prevCategory.id) : []),
    [prevCategory, articlesForCategory],
  )
  const nextArticles = useMemo(
    () => (nextCategory && articlesForCategory ? articlesForCategory(nextCategory.id) : []),
    [nextCategory, articlesForCategory],
  )

  const { dragX, transitionMs, containerWidth } = useSwipeCategory({
    containerRef: trackRef,
    disabled: !swipeEnabled,
    reduced,
    canGo: (direction) => Boolean(neighbourOf(direction)),
    onCommit: (direction) => {
      const target = neighbourOf(direction)
      if (!target) return
      skipRevealAfterSwipe.current = true
      onCategoryChange?.(target.id)
    },
    onHorizontalLock: cancelPull,
  })

  const lead = showLead ? articles.find((item) => item.image) : undefined
  const rest = useMemo(
    () => (lead ? articles.filter((item) => item.id !== lead.id) : articles),
    [articles, lead],
  )

  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>()
    rest.forEach((article) => {
      const key = dayBucket(article.publishedAt)
      const list = map.get(key)
      if (list) list.push(article)
      else map.set(key, [article])
    })
    return Array.from(map.entries())
  }, [rest])

  // 列表内容变更时（分类切换/刷新）执行优雅入场交错；横滑翻页后跳过，避免闪动
  useLayoutEffect(() => {
    if (skipRevealAfterSwipe.current) {
      skipRevealAfterSwipe.current = false
      if (listRef.current) markRevealedAll(listRef.current)
      return
    }
    if (listRef.current) {
      revealItems(listRef.current, reduced)
    }
  }, [categoryId, articles, reduced])

  // 分类切换时，恢复该分类上次记住的滚动位置（若初次访问则平滑归零）
  useLayoutEffect(() => {
    const prevCat = activeCategoryRef.current
    activeCategoryRef.current = categoryId
    const container = containerRef.current
    if (!container) return

    const savedTop = (categoryId ? scrollByCategory.current[categoryId] : undefined) ?? 0
    if (prevCat !== categoryId) {
      container.scrollTop = savedTop
      scrollTopRef.current = savedTop
      const scale = 0.12 + Math.min(1, savedTop / 150) * 0.88
      inkLineRef.current?.style.setProperty('transform', `scaleX(${scale})`)
    }
  }, [categoryId, containerRef])

  useEffect(() => {
    if (wasRefreshing.current && !refreshing && pulseRef.current) {
      inkPulse(pulseRef.current, reduced)
    }
    wasRefreshing.current = refreshing
  }, [refreshing, reduced])

  useEffect(() => {
    loadRequestedForRef.current = ''
  }, [categoryId, selectedSourceId])

  useEffect(() => {
    const canLoadMore = paginationState === 'available' || paginationState === 'error'
    if (!onLoadMoreRef.current || !canLoadMore) return
    const sentinel = loadMoreSentinelRef.current
    const root = containerRef.current
    if (!sentinel || !root) return

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (!first?.isIntersecting) return
        if (loadingMoreRef.current) return
        const lastArticle = articles[articles.length - 1]
        const requestKey = `${categoryId ?? 'all'}:${selectedSourceId ?? 'all'}:${lastArticle?.id ?? ''}`
        if (!requestKey || loadRequestedForRef.current === requestKey) return
        loadRequestedForRef.current = requestKey
        onLoadMoreRef.current?.()
      },
      {
        root,
        rootMargin: '240px 0px',
        threshold: 0.01,
      },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [articles, categoryId, containerRef, paginationState, selectedSourceId])

  useEffect(
    () => () => {
      if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current)
    },
    [],
  )

  const failed = statuses.filter((status) => status.state === 'error')
  const activeCategory = categories?.find((item) => item.id === categoryId)

  const swipeTransition =
    transitionMs > 0 ? `transform ${transitionMs}ms var(--ease-ink)` : 'none'
  // 下拉回弹只作用在纵向；切勿和横滑共用同一个 transition，否则松手归零会再播一遍水平滑入
  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const top = target.scrollTop
    scrollTopRef.current = top
    if (categoryId) scrollByCategory.current[categoryId] = top
    if (scrollFrameRef.current) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0
      const scale = 0.12 + Math.min(1, scrollTopRef.current / 150) * 0.88
      inkLineRef.current?.style.setProperty('transform', `scaleX(${scale})`)
    })
  }

  const sourceCounts = useMemo(() => {
    const map: Record<string, number> = {}
    articles.forEach((a) => {
      map[a.sourceId] = (map[a.sourceId] || 0) + 1
    })
    return map
  }, [articles])

  const listBody = (
    <div ref={listRef} className="w-full max-w-[2400px] mx-auto pb-12">
      {lead && (
        <LeadStory
          key={lead.id}
          article={lead}
          read={readIds.has(lead.id)}
          saved={laterIds.has(lead.id)}
          prestored={prestoredIds.has(lead.id)}
          translated={translations.get(lead.id)}
          displayMode={activeTranslationPrefs.displayMode}
          onOpen={onOpen}
          onSourceClick={onSelectSource}
          variant={isDesktop ? 'banner' : 'lead'}
        />
      )}

      {searchTemplate && (
        <div className="page-x lg:px-6 xl:px-8 2xl:px-10 flex items-center gap-2 py-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-paper-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="站内搜索…"
              className="w-full rounded-xl border border-haze bg-ink py-2 pl-8 pr-8 text-[13px] text-paper placeholder:text-paper-muted/50 focus:border-cinnabar/40 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-paper-muted hover:text-paper"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="rounded-xl border border-haze bg-paper/5 px-3 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-paper disabled:opacity-40"
          >
            {searching ? <Loader2 size={13} className="animate-spin" /> : '搜索'}
          </button>
        </div>
      )}

      {searchError && (
        <p className="page-x lg:px-6 xl:px-8 2xl:px-10 py-2 text-[12px] text-red-400">{searchError}</p>
      )}

      {frameworkCategories && frameworkCategories.length > 0 && (
        <div className="page-x lg:px-6 xl:px-8 2xl:px-10 flex gap-1.5 overflow-x-auto py-2 scrollbar-none">
          <button
            type="button"
            onClick={() => selectFwCategory(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition-colors ${
              activeFwCat === null
                ? 'bg-cinnabar text-white'
                : 'bg-paper/10 text-paper-muted hover:bg-paper/20'
            }`}
          >
            全部
          </button>
          {frameworkCategories.map((cat, idx) => (
            <button
              key={cat.url}
              type="button"
              onClick={() => selectFwCategory(idx)}
              className={`shrink-0 rounded-full px-3 py-1 text-[12px] transition-colors ${
                activeFwCat === idx
                  ? 'bg-cinnabar text-white'
                  : 'bg-paper/10 text-paper-muted hover:bg-paper/20'
              }`}
            >
              {cat.title}
            </button>
          ))}
        </div>
      )}

      {searchResults !== null ? (
        <div className="page-x lg:px-6 xl:px-8 2xl:px-10">
          <div className="flex items-center justify-between py-2">
            <span className="font-mono text-[11px] text-paper-muted">
              搜索结果：{searchResults.length} 条
            </span>
            <button
              type="button"
              onClick={clearSearch}
              className="font-mono text-[11px] text-cinnabar-soft hover:text-cinnabar"
            >
              返回列表
            </button>
          </div>
          <ul className="divide-y divide-haze">
            {searchResults.map((article) => (
              <ArticleRow
                key={article.id}
                article={article}
                read={readIds.has(article.id)}
                saved={laterIds.has(article.id)}
                prestored={prestoredIds.has(article.id)}
                onOpen={onOpen}
                variant="row"
              />
            ))}
          </ul>
        </div>
      ) : fwCatArticles !== null ? (
        <div className="page-x lg:px-6 xl:px-8 2xl:px-10">
          {fwCatLoading && !fwCatArticles.length && <FeedSkeleton showLead={false} />}
          <ul className="divide-y divide-haze">
            {fwCatArticles.map((article) => (
              <ArticleRow
                key={article.id}
                article={article}
                read={readIds.has(article.id)}
                saved={laterIds.has(article.id)}
                prestored={prestoredIds.has(article.id)}
                onOpen={onOpen}
                variant="row"
              />
            ))}
          </ul>
          {!fwCatExhausted && fwCatArticles.length > 0 && (
            <div className="flex justify-center py-6">
              <button
                type="button"
                onClick={loadMoreFwCat}
                disabled={fwCatLoading}
                className="rounded-xl border border-haze bg-paper/5 px-4 py-2 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-paper disabled:opacity-40"
              >
                {fwCatLoading ? <Loader2 size={13} className="animate-spin" /> : '加载更多'}
              </button>
            </div>
          )}
          {fwCatExhausted && fwCatArticles.length > 0 && (
            <p className="py-4 text-center font-mono text-[10px] text-paper-faint">没有更多了</p>
          )}
        </div>
      ) : (
        <>
          {articles.length === 0 && refreshing && <FeedSkeleton showLead={showLead} />}

          {articles.length === 0 && !refreshing && (
            <div className="page-x py-16 text-center text-[13px] leading-relaxed text-paper-faint">
              {selectedSourceId ? (
                <>
                  <p>该信源暂无已缓存文章。</p>
                  <button
                    type="button"
                    onClick={() => onSelectSource?.(null)}
                    className="mt-3 inline-flex items-center gap-1 rounded-full border border-haze bg-ink-raised px-3.5 py-1 text-[11.5px] text-paper-muted transition-colors hover:text-paper hover:border-paper-faint"
                  >
                    查看分类全部信源
                  </button>
                </>
              ) : categoryId === RECOMMEND_CATEGORY_ID ? (
                <p>
                  暂时没有可推荐的新内容：可能这批候选都读过了，或还没取到列表。
                  <br />
                  下拉刷新会拉取新内容并重算推荐。
                </p>
              ) : (
                <p>
                  还没有取到内容。
                  <br />
                  下拉刷新，或切换其他分类。
                </p>
              )}
            </div>
          )}

          {grouped.map(([bucket, items]) => (
            <div key={bucket}>
              <div className="page-x lg:px-6 xl:px-8 2xl:px-10 flex items-center gap-2.5 pt-4 pb-1.5">
                <span className="font-mono text-[11px] tracking-[0.16em] text-paper-muted font-medium">{bucket}</span>
                <span className="h-px flex-1 bg-haze" aria-hidden />
              </div>

              {/* 按平台只渲染一种列表布局，减少 50% DOM 节点与 React Diff 开销 */}
              {!isDesktop ? (
                <ul className="divide-y divide-haze">
                  {items.map((article) => (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      read={readIds.has(article.id)}
                      saved={laterIds.has(article.id)}
                      prestored={prestoredIds.has(article.id)}
                      translated={translations.get(article.id)}
                      displayMode={activeTranslationPrefs.displayMode}
                      onOpen={onOpen}
                      onSourceClick={onSelectSource}
                      variant="row"
                    />
                  ))}
                </ul>
              ) : (
                <ul className="grid grid-cols-2 gap-4 px-6 py-2 xl:grid-cols-3 2xl:grid-cols-4 min-[2100px]:grid-cols-5 xl:px-8 2xl:px-10 min-[2100px]:gap-5">
                  {items.map((article) => (
                    <ArticleRow
                      key={article.id}
                      article={article}
                      read={readIds.has(article.id)}
                      saved={laterIds.has(article.id)}
                      prestored={prestoredIds.has(article.id)}
                      translated={translations.get(article.id)}
                      displayMode={activeTranslationPrefs.displayMode}
                      onOpen={onOpen}
                      onSourceClick={onSelectSource}
                      variant="card"
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}

      <footer
        className={`page-x lg:px-6 xl:px-8 2xl:px-10 pt-10 pb-8 text-center font-mono text-[10px] leading-relaxed text-paper-faint ${
          articles.length === 0 && refreshing ? 'hidden' : ''
        }`}
      >
        {offline && !refreshing ? (
          <>
            <span className="text-paper-muted">
              离线内容 · 缓存于 {lastUpdated ? relativeTime(lastUpdated) : '较早'}
            </span>
            <br />
          </>
        ) : (
          <>
            {lastUpdated ? `更新于 ${relativeTime(lastUpdated)}` : '尚未更新'}
            <br />
          </>
        )}
        {chineseDate()} · 共 {articles.length} 条
        {paginationState === 'loading' && (
          <>
            <br />
            <span className="text-paper-muted">正在加载更早内容…</span>
          </>
        )}
        {paginationState === 'error' && articles.length > 0 && (
          <>
            <br />
            <button
              type="button"
              onClick={onLoadMore}
              className="mt-2 rounded-full border border-cinnabar/35 px-3 py-1.5 text-cinnabar/85"
            >
              较早内容加载失败 · 点击重试
            </button>
          </>
        )}
        {paginationState === 'exhausted' && articles.length > 0 && (
          <>
            <br />
            <span className="text-paper-faint">已加载全部更早内容</span>
          </>
        )}
        {paginationState === 'unsupported' && articles.length > 0 && (
          <>
            <br />
            <span className="text-paper-faint">当前分类暂无可续载来源</span>
          </>
        )}
        {failed.length > 0 && (
          <>
            <br />
            <span className="text-cinnabar/80">{failed.length} 个来源本次未取回</span>
          </>
        )}
      </footer>
      <div ref={loadMoreSentinelRef} className="h-px w-full" aria-hidden />
    </div>
  )

  const listScroller = (
    <div
      ref={containerRef}
      onScroll={onListScroll}
      className="scroll-hidden h-full overflow-x-hidden overflow-y-auto overscroll-contain bg-ink"
      style={{
        overflowAnchor: 'none',
      }}
    >
      {listBody}
    </div>
  )

  return (
    <section className="relative flex min-h-0 flex-1 flex-col">
      <header className="relative z-20 shrink-0 bg-ink/92 pt-1.5 pb-1 backdrop-blur-xl border-b border-haze/40">
        <div className="page-x lg:px-6 xl:px-8 2xl:px-10 max-w-[2400px] mx-auto flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {onBack && (
              <button type="button" onClick={onBack} aria-label="返回" className="-ml-1 p-1 hover:text-paper">
                <ChevronLeft size={18} strokeWidth={1.5} className="text-paper-muted" />
              </button>
            )}
            {title === '有所闻' && onBrandTap ? (
              <button
                type="button"
                onClick={onBrandTap}
                className="shrink-0 font-display text-[18px] leading-tight text-paper md:text-[20px] lg:text-[22px]"
              >
                {title}
              </button>
            ) : (
              <h1 className="shrink-0 font-display text-[18px] leading-tight text-paper md:text-[20px] lg:text-[22px]">
                {title}
              </h1>
            )}
            <p className="hidden md:inline-block min-w-0 truncate font-mono text-[11px] lg:text-[11.5px] tracking-[0.12em] text-paper-faint">
              {activeCategory?.caption || caption}
            </p>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full border border-haze/80 bg-ink-raised/60 text-[9.5px] lg:text-[10px] font-mono text-paper-faint">
              {articles.length} 篇
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden lg:inline-block font-mono text-[11px] text-paper-faint">
              {lastUpdated ? `更新于 ${relativeTime(lastUpdated)}` : ''}
            </span>

            {onOpenLocalSearch && (
              <button
                type="button"
                onClick={onOpenLocalSearch}
                aria-label="本地搜索已缓存内容"
                className="flex h-7.5 w-7.5 lg:h-8 lg:w-8 shrink-0 items-center justify-center rounded-lg border border-transparent lg:border-haze/70 lg:bg-ink-raised/50 lg:hover:bg-ink-raised lg:hover:border-paper-faint/30 transition-all text-paper-muted hover:text-paper"
              >
                <Search size={14} strokeWidth={1.6} />
              </button>
            )}

            {presetSwitcher && (
              <div className="lg:hidden" data-tour="preset-switcher">
                <PresetSwitcher
                  activeName={presetSwitcher.activeName}
                  items={presetSwitcher.items}
                  onSelect={presetSwitcher.onSelect}
                  onManage={presetSwitcher.onManage}
                  onSites={presetSwitcher.onSites}
                  siteCount={presetSwitcher.siteCount}
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => void onRefresh()}
              aria-label="刷新"
              className="relative flex h-7.5 w-7.5 lg:h-8 lg:w-8 lg:px-2.5 lg:w-auto shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent lg:border-haze/70 lg:bg-ink-raised/50 lg:hover:bg-ink-raised lg:hover:border-paper-faint/30 transition-all text-paper-muted hover:text-paper"
            >
              <RotateCw
                size={14}
                strokeWidth={1.6}
                className={`text-paper-muted ${refreshing ? 'animate-spin text-cinnabar' : ''}`}
              />
              <span className="hidden lg:inline font-mono text-[11px] text-paper-muted">
                {refreshing ? '刷新中' : '刷新'}
              </span>
              <span
                ref={pulseRef}
                className="pointer-events-none absolute h-2 w-2 rounded-full bg-cinnabar opacity-0"
                aria-hidden
              />
            </button>
          </div>
        </div>

        {categoryId && categories && categories.length > 0 && onCategoryChange && (
          <div className="mt-0.5 lg:hidden" data-tour="category-rail">
            <CategoryRail
              categories={categories}
              activeId={categoryId}
              onChange={onCategoryChange}
              dragX={dragX}
              containerWidth={containerWidth}
              transitionMs={transitionMs}
              reduced={reduced}
            />
          </div>
        )}

        {availableSources && availableSources.length > 1 && onSelectSource && (
          <div className="mt-0.5 lg:mt-1.5">
            <SourceFilterChips
              sources={availableSources}
              selectedSourceId={selectedSourceId ?? null}
              onSelect={onSelectSource}
              counts={sourceCounts}
            />
          </div>
        )}

        {refreshing && refreshProgress && phase === 'idle' && (
          <div className="page-x lg:px-6 xl:px-8 pt-1.5 pb-0.5 animate-fade-in">
            <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] leading-tight text-paper-muted">
              <span className="min-w-0 truncate">
                {(() => {
                  const currentSource = refreshProgress.pendingSourceIds
                    .map((id) => findSource(id, customSources))
                    .find((source) => Boolean(source))
                  const pendingCount = refreshProgress.pendingSourceIds.length
                  return currentSource
                    ? `正在同步 ${currentSource.name}${pendingCount > 1 ? ` · 另 ${pendingCount - 1} 个` : ''}`
                    : '正在同步信源…'
                })()}
              </span>
              <span className="shrink-0 tabular-nums text-cinnabar-soft font-medium">
                已同步 {refreshProgress.synced} / {refreshProgress.total}
              </span>
            </div>
          </div>
        )}

        <div className="page-x lg:px-6 xl:px-8 mt-1 h-px w-full">
          <div className="relative h-px w-full overflow-hidden bg-haze">
            <div
              ref={inkLineRef}
              className="h-px origin-left bg-gradient-to-r from-cinnabar/80 via-paper/30 to-transparent transition-[transform,width] duration-300 ease-out"
              style={{
                transform:
                  refreshing && refreshProgress && refreshProgress.total > 0
                    ? `scaleX(${Math.max(0.12, refreshProgress.completed / refreshProgress.total)})`
                    : 'scaleX(0.12)',
              }}
            />
            {refreshing && (!refreshProgress || refreshProgress.total === 0) && (
              <span className="ink-progress absolute inset-y-0 left-0 block w-1/3" aria-hidden />
            )}
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden" data-tour="feed-list">
        <PullIndicator
          indicatorRef={indicatorRef}
          phase={phase}
          progress={refreshProgress}
          customSources={customSources}
        />

        <div
          ref={trackRef}
          className="relative h-full w-full"
          style={{ touchAction: swipeEnabled ? 'pan-y' : undefined }}
        >
          {/*
            三页均 absolute inset-0：布局盒始终在裁剪视口内，各自 translate 跟手。
            按手势方向单向挂载邻页视图（向右滑挂载上一分类，向左滑挂载下一分类），消除不可见反方向的 DOM 与图片开销。
          */}
          {swipeEnabled && dragX > 0 && prevCategory && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px - 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
              }}
              aria-hidden
            >
              <CategoryPeek
                articles={prevArticles}
                showLead={showLead}
                readIds={readIds}
                laterIds={laterIds}
                prestoredIds={prestoredIds}
                scrollTop={scrollByCategory.current[prevCategory.id] ?? 0}
                onOpen={onOpen}
              />
            </div>
          )}

          {swipeEnabled ? (
            <div
              className="absolute inset-0"
              style={{
                // 静止时不要让纵向滚动容器常驻合成层；Android WebView 在触摸
                // 序列被系统打断后，偶尔会让这种嵌套滚动层停止接收后续手势。
                transform:
                  dragX === 0 && transitionMs === 0
                    ? undefined
                    : `translate3d(${dragX}px, 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility:
                  dragX === 0 && transitionMs === 0 ? undefined : 'hidden',
              }}
            >
              {listScroller}
            </div>
          ) : (
            listScroller
          )}

          {swipeEnabled && dragX < 0 && nextCategory && (
            <div
              className="pointer-events-none absolute inset-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px + 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
              }}
              aria-hidden
            >
              <CategoryPeek
                articles={nextArticles}
                showLead={showLead}
                readIds={readIds}
                laterIds={laterIds}
                prestoredIds={prestoredIds}
                scrollTop={scrollByCategory.current[nextCategory.id] ?? 0}
                onOpen={onOpen}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
})
