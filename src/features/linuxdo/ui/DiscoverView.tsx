import {
  ArrowLeft,
  ChevronRight,
  Compass,
  Flame,
  Grid2X2,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'

import { sortLinuxDoTags } from '../discovery/service'
import { linuxDoDiscovery as discovery } from '../runtime'
import type {
  LinuxDoCategory,
  LinuxDoTag,
  LinuxDoTopicOrder,
  LinuxDoTopicSummary,
} from '../types'
import { TopicCard } from './shared'
import { RefreshSurface } from './RefreshSurface'
import { discoveryScopeKey, loadDiscoveryScope, mergeDiscoveryTopics, type LinuxDoDiscoveryScope } from './discoveryScope'
import type { LinuxDoDiscoverTab, LinuxDoDiscoveryCache } from './discoveryCache'
import { compact, readableError } from './utils'
import { isLinuxDoVerificationError, LinuxDoRequestError, type LinuxDoVerify } from './VerificationAction'

function getCategoryColor(category?: LinuxDoCategory): string {
  if (!category?.color) return 'var(--color-cinnabar)'
  return category.color.startsWith('#') ? category.color : `#${category.color}`
}

const DISCOVERY_ORDERS: Array<{ id: LinuxDoTopicOrder; label: string }> = [
  { id: 'activity', label: '活跃' },
  { id: 'created', label: '最新' },
  { id: 'posts', label: '回复' },
  { id: 'views', label: '浏览' },
  { id: 'likes', label: '获赞' },
]

function CategoryCard({
  category,
  onClick,
}: {
  category: LinuxDoCategory
  onClick: () => void
}) {
  const catColor = getCategoryColor(category)
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ '--cat-accent': catColor } as CSSProperties}
      className="linuxdo-control linuxdo-cat-card group relative flex flex-col justify-between rounded-2xl p-3.5 text-left select-none"
    >
      <div className="linuxdo-cat-accent-bar" />
      <div className="pl-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: catColor }}
            />
            <span className="truncate text-[13.5px] font-semibold text-paper group-hover:text-cinnabar-soft transition-colors">
              {category.name}
            </span>
          </div>
          {typeof category.topicCount === 'number' ? (
            <span className="shrink-0 rounded-full bg-paper/6 px-2 py-0.5 font-mono text-[9.5px] font-medium text-paper-muted">
              {compact(category.topicCount)}
            </span>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-paper-muted">
          {category.description || '浏览该版块的最新讨论'}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-end pl-1.5 text-[10px] font-medium text-paper-faint group-hover:text-cinnabar transition-colors">
        <span>进入版块</span>
        <ChevronRight size={12} className="ml-0.5" />
      </div>
    </button>
  )
}

function TagChip({
  tag,
  rank,
  onClick,
}: {
  tag: LinuxDoTag
  rank?: number
  onClick: () => void
}) {
  const isRank1 = rank === 1
  const isRank2 = rank === 2
  const isRank3 = rank === 3

  return (
    <button
      type="button"
      onClick={onClick}
      className={`linuxdo-control linuxdo-tag-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium select-none ${
        isRank1
          ? 'is-rank-1 text-cinnabar dark:text-cinnabar-soft'
          : isRank2
          ? 'is-rank-2 text-[#7c3aed] dark:text-[#a78bfa]'
          : isRank3
          ? 'is-rank-3 text-[#d97706] dark:text-[#fbbf24]'
          : 'text-paper-muted hover:text-paper'
      }`}
    >
      {isRank1 ? (
        <Flame size={12} className="shrink-0 fill-current" />
      ) : isRank2 ? (
        <span className="shrink-0 text-[10px] font-bold">#2</span>
      ) : isRank3 ? (
        <span className="shrink-0 text-[10px] font-bold">#3</span>
      ) : (
        <span className="shrink-0 text-paper-faint">#</span>
      )}
      <span className="truncate max-w-[120px]">{tag.name}</span>
      {typeof tag.topicCount === 'number' && tag.topicCount > 0 ? (
        <span
          className={`font-mono text-[9px] ${
            isRank1 || isRank2 || isRank3 ? 'font-semibold opacity-90' : 'text-paper-faint'
          }`}
        >
          ×{tag.topicCount}
        </span>
      ) : null}
    </button>
  )
}

export function DiscoverView({
  onOpen,
  initialScope,
  onScopeChange,
  cacheRef,
  onVerify,
}: {
  onOpen: (topic: LinuxDoTopicSummary) => void
  initialScope?: LinuxDoDiscoveryScope
  onScopeChange: (scope: LinuxDoDiscoveryScope | null) => void
  cacheRef: MutableRefObject<LinuxDoDiscoveryCache>
  onVerify?: LinuxDoVerify
}) {
  const activeScope = initialScope ?? null
  const initialScopeCache = activeScope ? cacheRef.current.scopes[discoveryScopeKey(activeScope)] : undefined
  const [categories, setCategories] = useState<LinuxDoCategory[]>(() => cacheRef.current.categories)
  const [tags, setTags] = useState<LinuxDoTag[]>(() => cacheRef.current.tags)
  const [items, setItems] = useState<LinuxDoTopicSummary[]>(() => initialScopeCache?.items ?? [])
  const [loading, setLoading] = useState(() => !cacheRef.current.taxonomyLoaded)
  const [taxonomyRefreshing, setTaxonomyRefreshing] = useState(false)
  const taxonomyBusyRef = useRef(false)
  const mountedRef = useRef(true)
  const [itemsLoading, setItemsLoading] = useState(() => Boolean(activeScope && !initialScopeCache))
  const [itemsRefreshing, setItemsRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialScopeCache?.hasMore ?? false)
  const [itemsError, setItemsError] = useState('')
  const [itemsFailure, setItemsFailure] = useState<unknown>(null)
  const [itemsErrorMode, setItemsErrorMode] = useState<'initial' | 'refresh' | 'more' | null>(null)
  const [activeTab, setActiveTab] = useState<LinuxDoDiscoverTab>(() => cacheRef.current.hub.activeTab)
  const [tagQuery, setTagQuery] = useState(() => cacheRef.current.hub.tagQuery)
  const [order, setOrder] = useState<LinuxDoTopicOrder>(() => initialScopeCache?.order ?? 'activity')
  const [tagSearchResults, setTagSearchResults] = useState<LinuxDoTag[]>([])
  const [tagSearchLoading, setTagSearchLoading] = useState(false)
  const [tagSearchError, setTagSearchError] = useState('')
  const [categoriesError, setCategoriesError] = useState('')
  const [tagsError, setTagsError] = useState('')
  const [taxonomyFailure, setTaxonomyFailure] = useState<unknown>(null)
  const [tagSearchRevision, setTagSearchRevision] = useState(0)
  const pageRef = useRef(initialScopeCache?.page ?? 0)
  const scopeBusyRef = useRef(false)
  const scopeRequestIdRef = useRef(0)
  const hasMoreRef = useRef(initialScopeCache?.hasMore ?? false)
  const scopedScrollerRef = useRef<HTMLDivElement | null>(null)
  const hubScrollerRef = useRef<HTMLDivElement | null>(null)
  const normalizedTagQuery = tagQuery.trim().toLocaleLowerCase('zh-CN')
  const activeScopeKey = activeScope ? discoveryScopeKey(activeScope) : ''

  const changeScope = useCallback((scope: LinuxDoDiscoveryScope | null) => {
    if (scope) {
      const cached = cacheRef.current.scopes[discoveryScopeKey(scope)]
      setOrder(cached?.order ?? 'activity')
    }
    onScopeChange(scope)
  }, [cacheRef, onScopeChange])

  const refreshTaxonomy = useCallback(async () => {
    if (taxonomyBusyRef.current) return
    taxonomyBusyRef.current = true
    setTaxonomyRefreshing(true)
    setCategoriesError('')
    setTagsError('')
    setTaxonomyFailure(null)
    try {
      const [categoryResult, tagResult] = await Promise.allSettled([discovery.categories(), discovery.tags()])
      if (!mountedRef.current) return
      if (categoryResult.status === 'fulfilled') {
        cacheRef.current.categories = categoryResult.value
        setCategories(categoryResult.value)
      } else { setCategoriesError(readableError(categoryResult.reason)); if (isLinuxDoVerificationError(categoryResult.reason)) setTaxonomyFailure(categoryResult.reason) }
      if (tagResult.status === 'fulfilled') {
        cacheRef.current.tags = tagResult.value
        setTags(tagResult.value)
      } else { setTagsError(readableError(tagResult.reason)); if (isLinuxDoVerificationError(tagResult.reason)) setTaxonomyFailure(tagResult.reason) }
      // A failed load is recoverable, including when the screen is revisited.
      cacheRef.current.taxonomyLoaded = categoryResult.status === 'fulfilled' && tagResult.status === 'fulfilled'
    } finally {
      taxonomyBusyRef.current = false
      if (mountedRef.current) {
        setLoading(false)
        setTaxonomyRefreshing(false)
      }
    }
  }, [cacheRef])

  useEffect(() => {
    mountedRef.current = true
    if (!cacheRef.current.taxonomyLoaded) void refreshTaxonomy()
    else setLoading(false)
    return () => {
      mountedRef.current = false
      scopeRequestIdRef.current += 1
    }
  }, [cacheRef, refreshTaxonomy])

  useEffect(() => {
    cacheRef.current.hub.activeTab = activeTab
  }, [activeTab, cacheRef])

  useEffect(() => {
    cacheRef.current.hub.tagQuery = tagQuery
  }, [cacheRef, tagQuery])

  useEffect(() => {
    if (activeTab !== 'tags' || !normalizedTagQuery) {
      setTagSearchResults([])
      setTagSearchLoading(false)
      setTagSearchError('')
      return
    }
    let active = true
    setTagSearchResults([])
    setTagSearchLoading(true)
    setTagSearchError('')
    const timer = window.setTimeout(() => {
      void discovery.searchTags(tagQuery.trim()).then((results) => {
        if (active) setTagSearchResults(sortLinuxDoTags(results))
      }).catch((nextError) => {
        if (active) { setTagSearchError(readableError(nextError)); if (isLinuxDoVerificationError(nextError)) setTaxonomyFailure(nextError) }
      }).finally(() => {
        if (active) setTagSearchLoading(false)
      })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [activeTab, normalizedTagQuery, tagQuery, tagSearchRevision])

  const loadActiveScope = useCallback(async (mode: 'initial' | 'refresh' | 'more') => {
    if (!activeScope || !activeScopeKey || scopeBusyRef.current) return
    if (mode === 'more' && !hasMoreRef.current) return

    scopeBusyRef.current = true
    const requestId = ++scopeRequestIdRef.current
    if (mode === 'initial') setItemsLoading(true)
    else if (mode === 'refresh') setItemsRefreshing(true)
    else setLoadingMore(true)
    setItemsError('')
    setItemsFailure(null)
    setItemsErrorMode(null)

    try {
      const nextPage = mode === 'more' ? pageRef.current + 1 : 0
      const next = await loadDiscoveryScope(discovery, activeScope, nextPage, order)
      if (requestId !== scopeRequestIdRef.current) return
      pageRef.current = nextPage
      hasMoreRef.current = next.hasMore
      setHasMore(next.hasMore)
      setItems((previous) => {
        const merged = mode === 'more' ? mergeDiscoveryTopics(previous, next.items) : next.items
        const previousCache = cacheRef.current.scopes[activeScopeKey]
        cacheRef.current.scopes[activeScopeKey] = {
          scope: activeScope,
          order,
          items: merged,
          page: nextPage,
          hasMore: next.hasMore,
          scrollTop: mode === 'initial' ? 0 : previousCache?.scrollTop ?? 0,
        }
        return merged
      })
    } catch (nextError) {
      if (requestId !== scopeRequestIdRef.current) return
      setItemsError(readableError(nextError))
      setItemsFailure(nextError)
      setItemsErrorMode(mode)
    } finally {
      if (requestId === scopeRequestIdRef.current) {
        scopeBusyRef.current = false
        setItemsLoading(false)
        setItemsRefreshing(false)
        setLoadingMore(false)
      }
    }
  }, [activeScope, activeScopeKey, cacheRef, order])

  useEffect(() => {
    scopeRequestIdRef.current += 1
    scopeBusyRef.current = false
    if (!activeScope || !activeScopeKey) {
      pageRef.current = 0
      hasMoreRef.current = false
      setHasMore(false)
      setItems([])
      setItemsError('')
      setItemsErrorMode(null)
      setItemsLoading(false)
      setItemsRefreshing(false)
      setLoadingMore(false)
      window.requestAnimationFrame(() => {
        if (hubScrollerRef.current) hubScrollerRef.current.scrollTop = cacheRef.current.hub.scrollTop
      })
      return
    }

    const cached = cacheRef.current.scopes[activeScopeKey]
    if (cached && cached.order === order) {
      pageRef.current = cached.page
      hasMoreRef.current = cached.hasMore
      setHasMore(cached.hasMore)
      setItems(cached.items)
      setItemsError('')
      setItemsErrorMode(null)
      setItemsLoading(false)
      window.requestAnimationFrame(() => {
        if (scopedScrollerRef.current) scopedScrollerRef.current.scrollTop = cached.scrollTop
      })
      return
    }

    pageRef.current = 0
    hasMoreRef.current = true
    setHasMore(true)
    setItems([])
    if (scopedScrollerRef.current) scopedScrollerRef.current.scrollTop = 0
    void loadActiveScope('initial')
  }, [activeScope, activeScopeKey, cacheRef, loadActiveScope, order])

  const reloadActiveScope = () => loadActiveScope('refresh')
  const loadMoreActiveScope = () => loadActiveScope('more')

  const categoriesById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories]
  )

  const activeCategory = activeScope?.kind === 'category'
    ? categoriesById[activeScope.category.id] || activeScope.category
    : undefined

  const sortedTags = useMemo(() => sortLinuxDoTags(tags), [tags])

  const hotTags = useMemo(() => sortedTags.slice(0, 10), [sortedTags])

  const filteredTags = useMemo(() => {
    if (!normalizedTagQuery) return sortedTags
    return tagSearchResults
  }, [sortedTags, normalizedTagQuery, tagSearchResults])

  // --- 模态 B：专属讨论流 (Scoped Feed Mode) ---
  if (activeScope) {
    const isCategory = activeScope.kind === 'category'
    const catColor = isCategory ? getCategoryColor(activeCategory) : undefined

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* 顶部聚焦固定导航栏 */}
        <header className="shrink-0 border-b border-haze/50 bg-ink/95 backdrop-blur-xl select-none">
          <div className="page-x flex items-center justify-between gap-2 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => changeScope(null)}
                className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted transition-all hover:bg-paper/12 hover:text-paper active:scale-95"
                aria-label="返回发现大厅"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {isCategory ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-paper/10"
                      style={{ backgroundColor: catColor }}
                    />
                  ) : (
                    <Tag size={13} className="shrink-0 text-cinnabar-soft" />
                  )}
                  <h2 className="truncate text-[15px] font-bold text-paper">
                    {isCategory ? activeCategory?.name : `#${activeScope.name}`}
                  </h2>
                </div>
                <p className="truncate text-[10px] text-paper-faint">
                  {itemsLoading
                    ? '正在加载讨论…'
                    : isCategory && activeCategory?.description
                      ? activeCategory.description
                      : `已加载 ${items.length} 篇讨论${hasMore ? ' · 继续下滑加载更多' : ' · 已全部加载'}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={itemsLoading || itemsRefreshing}
              onClick={() => void reloadActiveScope()}
              className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted transition-all hover:bg-paper/12 hover:text-cinnabar active:scale-95 disabled:opacity-40"
              aria-label={itemsRefreshing ? '正在刷新讨论' : '刷新讨论'}
            >
              <RotateCw size={14} className={itemsLoading || itemsRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="page-x flex items-center gap-1 overflow-x-auto pb-2.5 scrollbar-none" aria-label="讨论排序">
            {DISCOVERY_ORDERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setOrder(option.id)}
                className={'linuxdo-control min-h-8 shrink-0 rounded-full px-3 py-1 text-[10.5px] font-medium transition-all ' + (order === option.id ? 'bg-cinnabar text-white shadow-sm' : 'bg-paper/[0.04] text-paper-muted hover:bg-paper/[0.08] hover:text-paper')}
                aria-pressed={order === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {/* 独立滚动区域 */}
        <RefreshSurface
          onRefresh={reloadActiveScope}
          scrollerRef={scopedScrollerRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-6 pt-3"
          onScroll={(event) => {
            const node = event.currentTarget
            const cached = cacheRef.current.scopes[activeScopeKey]
            if (cached) cached.scrollTop = node.scrollTop
            if (hasMoreRef.current && !scopeBusyRef.current && node.scrollHeight - node.scrollTop - node.clientHeight < 420) {
              void loadMoreActiveScope()
            }
          }}
        >

        {/* 讨论列表 */}
        {itemsRefreshing && items.length > 0 ? (
          <div className="mb-2 flex items-center justify-center gap-2 rounded-full bg-paper/[0.035] py-1.5 text-[10px] text-paper-faint" role="status">
            <Loader2 size={12} className="animate-spin" />正在刷新当前排序
          </div>
        ) : null}

        {itemsLoading && items.length === 0 ? (
          <div className="space-y-3" role="status" aria-label="正在加载讨论">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="linuxdo-skeleton h-28 rounded-2xl border border-haze/50" />
            ))}
          </div>
        ) : null}

        {itemsError && items.length === 0 ? (
          <LinuxDoRequestError variant="empty" error={itemsFailure ?? new Error(itemsError)} onVerify={onVerify} onRetry={reloadActiveScope} />
        ) : null}

        {itemsError && items.length > 0 ? (
          <LinuxDoRequestError error={itemsFailure ?? new Error(itemsError)} onVerify={onVerify} onRetry={itemsErrorMode === 'more' ? loadMoreActiveScope : reloadActiveScope} />
        ) : null}

        {!itemsLoading && items.length > 0 ? (
          <div className="space-y-3">
            {items.map((topic, index) => (
              <div
                key={topic.id}
                className="linuxdo-card-in"
                style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
              >
                <TopicCard
                  topic={topic}
                  category={topic.categoryId ? categoriesById[topic.categoryId] : undefined}
                  onOpen={() => onOpen(topic)}
                  onOpenCategory={(cat) => changeScope({ kind: 'category', category: cat })}
                  onOpenTag={(name) => changeScope({ kind: 'tag', name })}
                />
              </div>
            ))}
            <div className="pt-1">
              {loadingMore ? (
                <div className="flex items-center justify-center gap-2 py-4 text-[10.5px] text-paper-faint" role="status">
                  <Loader2 size={14} className="animate-spin" />正在加载更多讨论
                </div>
              ) : hasMore ? (
                <button
                  type="button"
                  onClick={() => void loadMoreActiveScope()}
                  className="linuxdo-control w-full rounded-2xl border border-haze/60 bg-paper/[0.025] py-3 text-[11px] font-medium text-paper-muted transition-colors hover:bg-paper/[0.055] hover:text-paper"
                >
                  加载更多讨论
                </button>
              ) : (
                <div className="py-4 text-center text-[10px] text-paper-faint">已加载全部 {items.length} 篇讨论</div>
              )}
            </div>
          </div>
        ) : null}

        {!itemsLoading && !itemsError && items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-paper/5 text-paper-muted">
              <Compass size={22} />
            </div>
            <p className="mt-3 text-[13px] font-medium text-paper">该分类或标签下暂无讨论</p>
            <p className="mt-1 text-[11px] text-paper-faint">可以去其他版块或热门标签看看</p>
            <button
              type="button"
              onClick={() => changeScope(null)}
              className="linuxdo-control mt-4 rounded-full bg-paper/8 px-4 py-1.5 text-[11.5px] font-medium text-paper hover:bg-paper/12"
            >
              返回发现全览
            </button>
          </div>
        ) : null}
      </RefreshSurface>
    </div>
  )
}

  // --- 模态 A：探索大厅 (Hub Mode) ---
  return (
    <RefreshSurface
      onRefresh={refreshTaxonomy}
      scrollerRef={hubScrollerRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-6 pt-4"
      onScroll={(event) => { cacheRef.current.hub.scrollTop = event.currentTarget.scrollTop }}
    >
      {loading ? <div className="linuxdo-skeleton mb-4 h-40 rounded-2xl" role="status" aria-label="正在加载分类与标签" /> : null}
      {categoriesError || tagsError ? (
        <LinuxDoRequestError error={taxonomyFailure ?? new Error([categoriesError, tagsError].filter(Boolean).join(' · '))} onVerify={onVerify} onRetry={refreshTaxonomy} />
      ) : null}
      {tagSearchError && isLinuxDoVerificationError(taxonomyFailure) ? (
        <LinuxDoRequestError error={taxonomyFailure} onVerify={onVerify} onRetry={() => setTagSearchRevision(value => value + 1)} />
      ) : null}
      {/* 顶部社区氛围横幅 */}
      <section className="linuxdo-discover-hero rounded-[26px] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-cinnabar/12 px-3 py-1 text-[10.5px] font-semibold text-cinnabar dark:bg-cinnabar/20 dark:text-cinnabar-soft">
              <Sparkles size={12} />
              <span>探索 Linux.do</span>
            </div>
            <h2 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-paper">
              发现前沿讨论
            </h2>
            <p className="mt-1 max-w-sm text-[11px] leading-5 text-paper-muted">
              从真实版块与社区标签中探索优质话题，直连一手经验。
            </p>
          </div>
          <button type="button" aria-label="刷新发现" disabled={taxonomyRefreshing} onClick={() => void refreshTaxonomy()} className="linuxdo-control grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cinnabar/10 text-cinnabar disabled:opacity-40">
            <RotateCw size={18} className={taxonomyRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* 社区数据微胶囊 */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div
            onClick={() => setActiveTab('categories')}
            className="linuxdo-control linuxdo-stat-card cursor-pointer rounded-2xl p-3 select-none"
          >
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Grid2X2 size={12} />
              <span>版块</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {categories.length}
            </div>
          </div>
          <div
            onClick={() => setActiveTab('tags')}
            className="linuxdo-control linuxdo-stat-card cursor-pointer rounded-2xl p-3 select-none"
          >
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Tag size={12} />
              <span>标签</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {tags.length}
            </div>
          </div>
          <div className="linuxdo-stat-card rounded-2xl p-3 select-none">
            <div className="flex items-center gap-1.5 text-paper-faint text-[10px]">
              <Flame size={12} className="text-[#ff8a3d]" />
              <span>焦点热度</span>
            </div>
            <div className="mt-1 text-[18px] font-bold font-mono text-paper">
              {compact(hotTags[0]?.topicCount ?? 0)}
            </div>
          </div>
        </div>
      </section>

      {/* 探索分段导航 */}
      <div className="mt-4 flex rounded-full bg-paper/[0.04] p-1 border border-haze/50 select-none">
        <button
          type="button"
          onClick={() => setActiveTab('featured')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'featured' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Sparkles size={13} />
          <span>精选探索</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'categories' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Grid2X2 size={13} />
          <span>版块大厅</span>
          <span className="ml-0.5 text-[10px] opacity-75 font-mono">({categories.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tags')}
          className={'flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 text-[12px] font-semibold transition-all ' + (activeTab === 'tags' ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
        >
          <Tag size={13} />
          <span>标签集市</span>
          <span className="ml-0.5 text-[10px] opacity-75 font-mono">({tags.length})</span>
        </button>
      </div>

      {/* Tab 1: 精选探索 */}
      {activeTab === 'featured' ? (
        <div className="mt-5 space-y-6">
          {/* 热门焦点标签 */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={15} className="text-[#ff8a3d]" />
                <h3 className="text-[13px] font-bold text-paper">热门焦点标签</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('tags')}
                className="linuxdo-control text-[11px] font-medium text-paper-faint hover:text-cinnabar transition-colors"
              >
                查看全部 →
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {hotTags.map((tag, index) => (
                <TagChip
                  key={tag.name}
                  tag={tag}
                  rank={index + 1}
                  onClick={() => changeScope({ kind: 'tag', name: tag.name })}
                />
              ))}
            </div>
          </div>

          {/* 热门版块精选 */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Grid2X2 size={15} className="text-cinnabar-soft" />
                <h3 className="text-[13px] font-bold text-paper">热门活跃版块</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('categories')}
                className="linuxdo-control text-[11px] font-medium text-paper-faint hover:text-cinnabar transition-colors"
              >
                浏览全部版块 →
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 sm:grid-cols-3">
              {categories.slice(0, 6).map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  onClick={() => changeScope({ kind: 'category', category })}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tab 2: 版块大厅 */}
      {activeTab === 'categories' ? (
        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Grid2X2 size={15} className="text-cinnabar-soft" />
              <h3 className="text-[13px] font-bold text-paper">全部分类版块</h3>
            </div>
            <span className="text-[10.5px] text-paper-faint font-mono">共 {categories.length} 个分类</span>
          </div>
          {categoriesError ? (
            <button type="button" onClick={() => void refreshTaxonomy()} className="linuxdo-control mb-3 flex w-full items-center justify-between rounded-2xl border border-cinnabar/20 bg-cinnabar/[0.06] px-3.5 py-3 text-left text-[11px] text-cinnabar-soft">
              <span className="min-w-0 flex-1 truncate">分类加载失败：{categoriesError}</span><span className="ml-3 shrink-0 font-semibold">重试</span>
            </button>
          ) : null}
          <div className="grid grid-cols-1 gap-2.5 min-[380px]:grid-cols-2 sm:grid-cols-3">
            {categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onClick={() => changeScope({ kind: 'category', category })}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Tab 3: 标签集市 */}
      {activeTab === 'tags' ? (
        <div className="mt-5 space-y-4">
          {/* 即时过滤搜索框 */}
          <div className="linuxdo-tag-search flex h-11 items-center gap-2 rounded-2xl border border-haze bg-ink-raised/60 px-3 transition-colors focus-within:border-cinnabar/45">
            <span className="grid h-8 w-8 shrink-0 place-items-center text-paper-faint" aria-hidden><Search size={15} /></span>
            <input
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              placeholder="搜索社区标签（如 Docker, AI, 薅羊毛...）"
              aria-label="搜索社区标签"
              className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[12.5px] leading-[1.25] text-paper outline-none placeholder:text-paper-faint"
            />
            {tagQuery ? (
              <button
                type="button"
                onClick={() => setTagQuery('')}
                className="linuxdo-control grid h-6 w-6 shrink-0 place-items-center rounded-full bg-paper/10 text-paper-muted hover:text-paper"
                aria-label="清除标签搜索"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          {/* 标签列表 */}
          {normalizedTagQuery ? (
            <div>
              <div className="mb-2 text-[11px] text-paper-faint">
                {tagSearchLoading ? '正在搜索 LinuxDo 标签…' : tagSearchError ? '标签搜索失败' : `找到 ${filteredTags.length} 个相关标签`}
              </div>
              {tagSearchLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-paper-faint"><Loader2 size={15} className="animate-spin" />正在获取完整结果</div>
              ) : tagSearchError ? (
                <div className="rounded-2xl border border-cinnabar/20 bg-cinnabar/[0.07] px-4 py-5 text-center text-[12px] text-cinnabar-soft">{tagSearchError}</div>
              ) : filteredTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {filteredTags.map((tag) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      onClick={() => changeScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-[12px] text-paper-faint">
                  未找到包含“{tagQuery}”的标签
                </div>
              )}
            </div>
          ) : (
            <>
              {tagsError ? (
                <button type="button" onClick={() => void refreshTaxonomy()} className="linuxdo-control flex w-full items-center justify-between rounded-2xl border border-cinnabar/20 bg-cinnabar/[0.06] px-3.5 py-3 text-left text-[11px] text-cinnabar-soft">
                  <span className="min-w-0 flex-1 truncate">标签目录加载失败：{tagsError}</span><span className="ml-3 shrink-0 font-semibold">重试</span>
                </button>
              ) : null}
              {/* 热门 Top 10 */}
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-paper">
                  <Flame size={14} className="text-[#ff8a3d]" />
                  <span>热门排行</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hotTags.map((tag, index) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      rank={index + 1}
                      onClick={() => changeScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              </div>

              {/* 全部标签 */}
              <div className="pt-2">
                <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-paper">
                  <div className="flex items-center gap-1.5">
                    <Tag size={13} className="text-cinnabar-soft" />
                    <span>全部标签</span>
                  </div>
                  <span className="font-mono text-[10px] font-normal text-paper-faint">
                    {tags.length} 个
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sortedTags.slice(0, 80).map((tag) => (
                    <TagChip
                      key={tag.name}
                      tag={tag}
                      onClick={() => changeScope({ kind: 'tag', name: tag.name })}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </RefreshSurface>
  )
}
