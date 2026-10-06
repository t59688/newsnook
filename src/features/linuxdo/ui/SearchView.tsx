import {
  ArrowDownWideNarrow,
  ChevronRight,
  Clock3,
  Hash,
  Loader2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { OptionPickerDialog } from '../../../components/ConfirmDialog'
import { log } from '../../../lib/logger'
import { linuxDoSearch } from '../runtime'
import {
  buildLinuxDoSearch,
  emptyLinuxDoSearchFilters,
  linuxDoSearchFilterLabels,
  linuxDoSearchOrders,
  parseLinuxDoSearch,
  type LinuxDoSearchOrder,
  type LinuxDoSearchQuery,
} from '../search/query'
import type { LinuxDoCategory, LinuxDoPost, LinuxDoTopicSummary } from '../types'
import { LinuxDoApiError } from '../types'
import { SearchFilters } from './SearchFilters'
import { createLinuxDoSearchCache, type LinuxDoSearchCache, type LinuxDoSearchTab } from './searchCache'
import { ago, avatar, readableError } from './utils'

const tabs = [
  ['posts', '帖子'],
  ['categories', '类别与标签'],
  ['users', '用户'],
] as const
const HISTORY_KEY = 'newsnook-linuxdo-search-history'
export function SearchView({
  onOpen,
  onOpenUser,
  onOpenCategory,
  onOpenTag,
  onVerify,
  onLogin,
  categoriesById = {},
  authenticated = false,
  cacheRef,
}: {
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string) => void
  onOpenCategory?: (category: LinuxDoCategory) => void
  onOpenTag?: (name: string) => void
  onVerify?: () => Promise<boolean>
  onLogin?: () => void
  categoriesById?: Record<number, LinuxDoCategory>
  authenticated?: boolean
  cacheRef: MutableRefObject<LinuxDoSearchCache>
}) {
  const [state, setState] = useState(() => cacheRef.current)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<LinuxDoApiError['kind']>()
  const [verifying, setVerifying] = useState(false)
  const [queryError, setQueryError] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
      return Array.isArray(saved)
        ? saved.filter((item): item is string => typeof item === 'string').slice(0, 8)
        : []
    } catch {
      return []
    }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const pendingRef = useRef('')
  const retryRef = useRef({ page: 1, query: '' })
  const stateRef = useRef(state)
  stateRef.current = state
  const update = (patch: Partial<LinuxDoSearchCache>) => {
    const next = { ...stateRef.current, ...patch }
    const { tabs: snapshots, ...snapshot } = next
    next.tabs = { ...snapshots, [next.activeTab]: snapshot }
    stateRef.current = next
    cacheRef.current = next
    setState(next)
  }
  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = cacheRef.current.scrollTop
  }, [cacheRef])
  useEffect(
    () => () => {
      generationRef.current++
      requestRef.current?.abort()
    },
    []
  )
  const invalidate = () => {
    generationRef.current++
    requestRef.current?.abort()
    pendingRef.current = ''
    setLoading(false)
    setLoadingMore(false)
    setError('')
    setQueryError('')
  }
  const clear = () => {
    invalidate()
    update({ ...createLinuxDoSearchCache(), activeTab: stateRef.current.activeTab })
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    inputRef.current?.focus()
  }
  const run = async (nextPage = 1, searchTerm = stateRef.current.query) => {
    const activeTab = stateRef.current.activeTab
    const normalized = searchTerm.trim()
    const requestKey = `${activeTab}:${normalized}:${nextPage}`
    if (!normalized || pendingRef.current === requestKey) return
    setQueryError('')
    if (nextPage > 1 && (normalized !== stateRef.current.lastQuery || activeTab !== 'posts')) return
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const generation = ++generationRef.current
    pendingRef.current = requestKey
    if (nextPage === 1) inputRef.current?.blur()
    update({
      query: searchTerm,
      ...(nextPage === 1
        ? {
            lastQuery: '',
            topics: [],
            posts: [],
            users: [],
            categories: [],
            tags: [],
            hasMore: false,
            page: 1,
            scrollTop: 0,
          }
        : {}),
    })
    setLoading(nextPage === 1)
    setLoadingMore(nextPage > 1)
    setError('')
    retryRef.current = { page: nextPage, query: searchTerm }
    try {
      const result =
        activeTab === 'users'
          ? await linuxDoSearch.searchUsers(normalized, controller.signal)
          : activeTab === 'categories'
          ? await linuxDoSearch.searchCategories(normalized, controller.signal)
          : await linuxDoSearch.search(normalized, nextPage, controller.signal)
      if (controller.signal.aborted || generation !== generationRef.current) return
      const previous = stateRef.current
      const merge = <T extends { id: number }>(old: T[], incoming: T[]) => {
        const byId = new Map(old.map((item) => [item.id, item]))
        for (const item of incoming) byId.set(item.id, item)
        return [...byId.values()]
      }
      update({
        lastQuery: normalized,
        page: nextPage,
        hasMore: result.hasMore,
        topics: nextPage === 1 ? result.topics : merge(previous.topics, result.topics),
        posts: nextPage === 1 ? result.posts : merge(previous.posts, result.posts),
        users: result.users,
        categories: result.categories ?? [],
        tags: result.tags ?? [],
        ...(nextPage === 1 ? { scrollTop: 0 } : {}),
      })
      if (nextPage === 1) {
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
        setHistory((previous) => {
          const nextHistory = [normalized, ...previous.filter((item) => item !== normalized)].slice(0, 8)
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory))
          } catch (storageError) {
            log.storage.warn('LinuxDO search history save failed', storageError)
          }
          return nextHistory
        })
      }
    } catch (nextError) {
      if (!controller.signal.aborted && generation === generationRef.current) {
        setError(readableError(nextError))
        setErrorKind(nextError instanceof LinuxDoApiError ? nextError.kind : undefined)
      }
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = ''
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }
  const serialize = (query: LinuxDoSearchQuery) => {
    try {
      return buildLinuxDoSearch(query)
    } catch (nextError) {
      setQueryError(readableError(nextError))
      return undefined
    }
  }
  const selectTab = (activeTab: LinuxDoSearchTab) => {
    if (activeTab === stateRef.current.activeTab) return
    invalidate()
    const previous = stateRef.current
    const saved = previous.tabs[activeTab]
    const parsed = parseLinuxDoSearch(previous.query)
    const text = previous.activeTab === 'posts' ? parsed.text || parsed.filters.author : previous.query
    const query =
      activeTab === 'posts' ? serialize({ ...parseLinuxDoSearch(saved?.query ?? ''), text }) : text
    if (query === undefined) return
    const next = { ...(saved ?? createLinuxDoSearchCache()), tabs: previous.tabs, activeTab, query }
    update(next)
    if (scrollerRef.current) scrollerRef.current.scrollTop = next.scrollTop
    if (query.trim() && query.trim() !== saved?.lastQuery) void run(1, query)
  }
  const { query, lastQuery, activeTab, topics, posts, users, categories, tags, hasMore, page } = state
  const parsed = parseLinuxDoSearch(query)
  const chips = linuxDoSearchFilterLabels(parsed.filters, categoriesById)
  const visibleCount =
    activeTab === 'posts'
      ? posts.length || topics.length
      : activeTab === 'categories'
      ? categories.length + tags.length
      : users.length
  const orderLabel = linuxDoSearchOrders.find((item) => item.id === parsed.order)!.label
  const applyQuery = (next: string) => {
    setFiltersOpen(false)
    if (next.trim()) void run(1, next)
    else clear()
  }
  const removeFilter = (chip: (typeof chips)[number]) => {
    const filters = { ...parsed.filters }
    if (chip.scope) filters.scopes = filters.scopes.filter((scope) => scope !== chip.scope)
    else if (chip.key !== 'scopes' && chip.key !== 'allTags') filters[chip.key] = ''
    const next = serialize({ ...parsed, filters })
    if (next !== undefined) applyQuery(next)
  }
  const openPost = (post: LinuxDoPost) => {
    if (!post.topicId) return
    const topic = topics.find((item) => item.id === post.topicId) ?? {
      id: post.topicId,
      slug: post.topicSlug || 'topic',
      title: post.topicTitle || '搜索结果',
      postsCount: 0,
      replyCount: 0,
      views: 0,
      likeCount: 0,
      createdAt: post.createdAt,
      lastPostedAt: post.createdAt,
      tags: [],
      posters: [],
    }
    onOpen(topic, post.postNumber)
  }
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  return (
    <div
      ref={scrollerRef}
      onScroll={(event) => {
        const scrollTop = event.currentTarget.scrollTop
        cacheRef.current.scrollTop = event.currentTarget.scrollTop
        stateRef.current.scrollTop = scrollTop
        const snapshot = cacheRef.current.tabs[activeTab]
        if (snapshot) snapshot.scrollTop = scrollTop
      }}
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
    >
      <div className="sticky top-0 z-20 shrink-0 border-b border-haze/50 bg-ink/85 supports-[backdrop-filter]:bg-ink/65 page-x pb-3 pt-3 backdrop-blur-2xl">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
          role="search"
        >
          <div className="flex min-h-11 items-center gap-2 rounded-[14px] bg-paper/[0.06] pl-3.5 pr-1.5 focus-within:ring-1 focus-within:ring-cinnabar/40">
            <Search size={17} className="shrink-0 text-paper-faint" aria-hidden />
            <input
              ref={inputRef}
              autoFocus={!lastQuery}
              type="search"
              enterKeyHint="search"
              aria-label="搜索 LinuxDO 社区"
              value={query}
              onChange={(event) => {
                setQueryError('')
                update({ query: event.target.value })
              }}
              placeholder={
                activeTab === 'posts'
                  ? '搜索帖子，支持高级语法'
                  : activeTab === 'categories'
                  ? '搜索分类或标签'
                  : '搜索用户名或昵称'
              }
              className="min-w-0 flex-1 bg-transparent py-3 text-[15px] text-paper outline-none placeholder:text-paper-faint"
            />
            {query ? (
              <button
                type="button"
                onClick={clear}
                aria-label="清空搜索词"
                className="linuxdo-control grid h-10 w-9 shrink-0 place-items-center rounded-full text-paper-faint hover:bg-paper/5 hover:text-paper"
              >
                <X size={15} />
              </button>
            ) : null}
            <button
              type="submit"
              className="linuxdo-control min-h-10 shrink-0 rounded-xl bg-cinnabar px-3.5 text-[13px] font-medium text-white"
            >
              搜索
            </button>
          </div>
        </form>
        <div
          role="tablist"
          aria-label="搜索类型"
          className="mt-3 flex gap-1 rounded-[12px] bg-paper/[0.05] p-1"
        >
          {tabs.map(([tab, label], index) => (
            <button
              key={tab}
              type="button"
              id={`linuxdo-search-tab-${tab}`}
              role="tab"
              aria-controls="linuxdo-search-results"
              aria-selected={activeTab === tab}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => selectTab(tab)}
              onKeyDown={(event) => {
                const target =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                    ? tabs.length - 1
                    : -1
                if (target >= 0) {
                  event.preventDefault()
                  selectTab(tabs[target][0])
                  document.getElementById(`linuxdo-search-tab-${tabs[target][0]}`)?.focus()
                }
              }}
              className={
                'linuxdo-control min-h-10 min-w-0 flex-1 rounded-[10px] text-[13px] font-medium transition-colors ' +
                (activeTab === tab ? 'bg-ink text-paper shadow-sm' : 'text-paper-muted hover:text-paper')
              }
            >
              {label}
            </button>
          ))}
        </div>
        {activeTab === 'posts' ? (
          <div className="mt-3 flex items-center justify-between gap-2">
            <span role="status" aria-live="polite" className="text-[12px] text-paper-faint">
              {lastQuery ? `已加载 ${visibleCount} 条` : '查找主题与回复'}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={'排序：' + orderLabel}
                onClick={() => setSortOpen(true)}
                className="linuxdo-control inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12px] text-paper-muted hover:bg-paper/5"
              >
                <ArrowDownWideNarrow size={14} />
                {orderLabel}
              </button>
              <button
                type="button"
                aria-label="高级筛选"
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen(true)}
                className={
                  'linuxdo-control inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12px] ' +
                  (chips.length ? 'bg-cinnabar/10 text-cinnabar-soft' : 'text-paper-muted hover:bg-paper/5')
                }
              >
                <SlidersHorizontal size={14} />
                筛选
                {chips.length ? (
                  <span className="rounded-full bg-cinnabar px-1.5 text-[10px] text-white">
                    {chips.length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex-1 page-x pb-6 pt-4">
        {queryError ? (
          <p role="alert" className="mb-4 rounded-xl bg-cinnabar/5 p-3 text-[13px] text-cinnabar-soft">
            {queryError}，请修改搜索条件
          </p>
        ) : null}
        {activeTab === 'posts' && chips.length ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key + (chip.scope ?? '')}
                type="button"
                onClick={() => removeFilter(chip)}
                aria-label={`移除条件：${chip.label}`}
                className="linuxdo-control inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-cinnabar/20 bg-cinnabar/5 px-3 text-[12px] text-cinnabar-soft"
              >
                <span className="truncate">{chip.label}</span>
                <X size={12} className="shrink-0" />
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                applyQuery(buildLinuxDoSearch({ ...parsed, filters: emptyLinuxDoSearchFilters() }))
              }
              className="linuxdo-control min-h-9 px-2 text-[12px] text-paper-faint"
            >
              清除筛选
            </button>
          </div>
        ) : null}
        {!lastQuery && history.length ? (
          <div className="mb-5">
            <div className="mb-2 flex items-center justify-between text-[12px] text-paper-faint">
              <span className="flex items-center gap-1.5">
                <Clock3 size={13} />
                最近搜索
              </span>
              <button
                type="button"
                onClick={() => {
                  setHistory([])
                  try {
                    localStorage.removeItem(HISTORY_KEY)
                  } catch (storageError) {
                    log.storage.warn('LinuxDO search history clear failed', storageError)
                  }
                }}
                className="linuxdo-control min-h-10 px-2"
              >
                清除
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {history.map((item) => (
                <button
                  type="button"
                  key={item}
                  onClick={() =>
                    void run(1, activeTab === 'posts' ? item : parseLinuxDoSearch(item).text || item)
                  }
                  className="linuxdo-control min-h-10 max-w-full truncate rounded-full bg-paper/[0.05] px-3 text-[13px] text-paper-muted"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {loading ? (
          <div role="status" aria-label="正在搜索" className="space-y-5 py-2">
            <span className="sr-only">搜索中…</span>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex gap-3 py-3">
                <div className="linuxdo-skeleton h-11 w-11 shrink-0 rounded-full" />
                <div className="flex-1 space-y-3">
                  <div className="linuxdo-skeleton h-3 w-1/3 rounded" />
                  <div className="linuxdo-skeleton h-4 w-4/5 rounded" />
                  <div className="linuxdo-skeleton h-3 w-3/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mb-4 rounded-2xl border border-cinnabar/20 bg-cinnabar/5 p-4">
            <p className="text-[13px] text-cinnabar-soft">{error}</p>
            {errorKind === 'auth-required' && onLogin ? (
              <button
                type="button"
                onClick={onLogin}
                className="linuxdo-control mr-3 mt-2 min-h-11 rounded-full bg-cinnabar px-4 text-[13px] text-white"
              >
                登录 LinuxDO
              </button>
            ) : null}
            {errorKind === 'browser-verification' && onVerify ? (
              <button
                type="button"
                disabled={verifying}
                onClick={async () => {
                  const generation = generationRef.current
                  setVerifying(true)
                  try {
                    const verified = await onVerify()
                    if (verified && generation === generationRef.current)
                      await run(retryRef.current.page, retryRef.current.query)
                  } catch (nextError) {
                    if (generation === generationRef.current) setError(readableError(nextError))
                  } finally {
                    setVerifying(false)
                  }
                }}
                className="linuxdo-control mr-3 mt-2 min-h-11 rounded-full bg-cinnabar px-4 text-[13px] text-white disabled:opacity-50"
              >
                {verifying ? '验证中…' : '完成安全验证'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void run(retryRef.current.page, retryRef.current.query)}
              className="linuxdo-control mt-2 min-h-10 text-[13px] font-medium text-cinnabar-soft"
            >
              {error} · 点击重试
            </button>
          </div>
        ) : null}
        <div
          id="linuxdo-search-results"
          role="tabpanel"
          aria-labelledby={`linuxdo-search-tab-${activeTab}`}
          aria-busy={loading || loadingMore}
          className="divide-y divide-haze/40"
        >
          {activeTab === 'posts'
            ? posts.length
              ? posts.map((post) => {
                  const topic = topicById.get(post.topicId ?? 0)
                  return (
                    <SearchResultRow
                      key={post.id}
                      topic={topic}
                      post={post}
                      category={categoriesById[topic?.categoryId ?? 0]}
                      onOpen={() => openPost(post)}
                    />
                  )
                })
              : topics.map((topic) => (
                  <SearchResultRow
                    key={topic.id}
                    topic={topic}
                    category={categoriesById[topic.categoryId ?? 0]}
                    onOpen={() => onOpen(topic)}
                  />
                ))
            : null}
          {activeTab === 'categories' ? (
            <>
              {categories.length ? (
                <div className="pb-5">
                  <h3 className="mb-2 text-[12px] font-medium text-paper-faint">
                    分类 · {categories.length}
                  </h3>
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      disabled={!onOpenCategory}
                      onClick={() => onOpenCategory?.(category)}
                      className="linuxdo-control flex min-h-20 w-full items-center gap-3 py-3 text-left disabled:opacity-50"
                    >
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cinnabar/10 text-cinnabar-soft">
                        <Hash size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[16px] font-semibold text-paper">{category.name}</span>
                        {category.parentId && categoriesById[category.parentId] ? (
                          <span className="mt-1 block text-[12px] text-paper-faint">
                            {categoriesById[category.parentId].name} / {category.name}
                          </span>
                        ) : null}
                        {category.description ? (
                          <span className="mt-1 line-clamp-2 text-[13px] text-paper-muted">
                            {category.description}
                          </span>
                        ) : null}
                        {category.topicCount !== undefined ? (
                          <span className="mt-1 block text-[12px] text-paper-faint">
                            {category.topicCount} 个话题
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight size={16} className="text-paper-faint" />
                    </button>
                  ))}
                </div>
              ) : null}
              {tags.length ? (
                <div className="pt-4">
                  <h3 className="mb-3 text-[12px] font-medium text-paper-faint">标签 · {tags.length}</h3>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.name}
                        type="button"
                        disabled={!onOpenTag || tag.disabled}
                        title={tag.disabledReason}
                        onClick={() => onOpenTag?.(tag.name)}
                        className="linuxdo-control inline-flex min-h-11 max-w-full items-center gap-2 rounded-xl border border-haze/60 bg-paper/[0.025] px-3 text-[14px] text-paper-muted disabled:opacity-50"
                      >
                        <span className="truncate">#{tag.name}</span>
                        {tag.topicCount !== undefined ? (
                          <span className="shrink-0 text-[12px] tabular-nums text-paper-faint">
                            {tag.topicCount}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[12px] text-paper-faint">
                    最多显示 30 个标签，可继续输入关键词缩小范围
                  </p>
                </div>
              ) : null}
            </>
          ) : null}
          {activeTab === 'users'
            ? users.map((user) => (
                <button
                  type="button"
                  key={user.id}
                  onClick={() => onOpenUser(user.username)}
                  className="linuxdo-control flex min-h-20 w-full items-center gap-3.5 py-3 text-left active:bg-paper/[0.035]"
                >
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10">
                    {avatar(user.avatarTemplate, user.username)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold text-paper">
                      {user.name || user.username}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-paper-faint">@{user.username}</span>
                  </span>
                  <ChevronRight size={16} className="text-paper-faint" />
                </button>
              ))
            : null}
        </div>
        {!loading && !error && !visibleCount ? (
          <div className="py-14 text-center">
            <Search size={28} className="mx-auto mb-3 text-paper-faint" />
            <p className="text-[14px] text-paper-muted">
              {lastQuery ? '没有找到匹配结果' : '在社区里找到你需要的内容'}
            </p>
            <p className="mt-2 text-[12px] text-paper-faint">
              {lastQuery
                ? chips.length && activeTab === 'posts'
                  ? '试试移除部分筛选条件，或换个关键词'
                  : '试试其他关键词或搜索类型'
                : '搜索帖子、分类、标签和成员'}
            </p>
          </div>
        ) : null}
        {activeTab === 'users' && users.length ? (
          <p className="mt-4 text-center text-[12px] text-paper-faint">
            最多显示 20 位成员，可输入更完整的用户名
          </p>
        ) : null}
        {lastQuery && hasMore ? (
          <button
            type="button"
            disabled={loading || loadingMore || query.trim() !== lastQuery}
            onClick={() => void run(page + 1)}
            className="linuxdo-control mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-paper/[0.045] text-[13px] text-paper-muted disabled:opacity-40"
          >
            {loadingMore ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                加载中…
              </>
            ) : (
              '加载更多结果'
            )}
          </button>
        ) : null}
        {lastQuery && activeTab === 'posts' && page === 10 && !hasMore ? (
          <p className="mt-5 text-center text-[12px] text-paper-faint">已达到搜索页数上限，请增加筛选条件</p>
        ) : null}
      </div>
      {filtersOpen ? (
        <SearchFilters
          value={parsed}
          categories={Object.values(categoriesById)}
          authenticated={authenticated}
          onApply={applyQuery}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}
      <OptionPickerDialog<LinuxDoSearchOrder>
        open={sortOpen}
        title="排序依据"
        value={parsed.order}
        options={linuxDoSearchOrders
          .filter((order) => !('personal' in order) || authenticated)
          .map((order) => ({ id: order.id, label: order.label }))}
        onCancel={() => setSortOpen(false)}
        onChange={(order) => {
          setSortOpen(false)
          const next = serialize({ ...parsed, order })
          if (next === undefined) return
          if (next.trim()) applyQuery(next)
          else update({ query: next })
        }}
      />
    </div>
  )
}

function SearchResultRow({
  topic,
  post,
  category,
  onOpen,
}: {
  topic?: LinuxDoTopicSummary
  post?: LinuxDoPost
  category?: LinuxDoCategory
  onOpen: () => void
}) {
  const author = post ?? topic?.posters[0]
  const title = topic?.title || post?.topicTitle || '搜索结果'
  const displayName = post?.name || author?.username || '作者信息暂缺'
  return (
    <button
      type="button"
      aria-label={'打开搜索结果：' + title}
      disabled={!topic && !post?.topicId}
      onClick={onOpen}
      className="linuxdo-control flex w-full items-start gap-3.5 py-4 text-left active:bg-paper/[0.035] disabled:opacity-50"
    >
      <span className="mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10">
        {avatar(author?.avatarTemplate, author?.username)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[16px] font-semibold leading-[1.45] tracking-[-0.01em] text-paper">
          {title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] text-paper-faint">
          <span className="max-w-full truncate font-medium text-paper-muted">{displayName}</span>
          {post?.name && post.username !== post.name ? <span>@{post.username}</span> : null}
          <span>{ago(post?.createdAt || topic?.lastPostedAt || '')}</span>
        </span>
        {post?.cooked ? (
          <span
            className="mt-2 block line-clamp-3 text-[14px] leading-[1.55] text-paper-muted [&_b]:font-semibold [&_b]:text-cinnabar-soft [&_mark]:bg-cinnabar/15 [&_.search-highlight]:font-semibold [&_.search-highlight]:text-cinnabar-soft"
            dangerouslySetInnerHTML={{ __html: post.cooked }}
          />
        ) : null}
        <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-paper-faint">
          {category ? <span className="text-cinnabar-soft">{category.name}</span> : null}
          {topic?.tags.slice(0, 2).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
          <span>{post ? `匹配楼层 #${post.postNumber}` : `${topic?.replyCount || 0} 条回复`}</span>
          {topic ? (
            <span>
              {topic.views} 浏览 · {topic.likeCount} 赞
            </span>
          ) : null}
        </span>
      </span>
    </button>
  )
}
