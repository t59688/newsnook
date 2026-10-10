import type { LinuxDoNotificationFilter } from '../notification/model'
import { PrivateMessagesView } from './PrivateMessagesView'
import { createLinuxDoPrivateMessagesCache, applyPrivateMessageReadProgress } from './privateMessagesCache'
import { ArrowLeft, Bell, CheckCircle2, ChevronDown, Compass, Flame, History, ListFilter, Loader2, MessageCircle, Plus, RefreshCcw, Search, Trophy, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'

import { HomeRefreshButton } from '../../../components/HomeRefreshButton'
import { PresetSwitcher, type PresetSwitcherProps } from '../../../components/PresetSwitcher'
import { LinuxDoBoostComposer, LinuxDoComposer, LinuxDoTopicView } from './ThreadViews'
import { BookmarksView, NotificationsView, SearchView } from './CommunityViews'
import { DiscoverView } from './DiscoverView'
import { createLinuxDoDiscoveryCache } from './discoveryCache'
import { createLinuxDoSearchCache } from './searchCache'
import { UserProfileView, type UserProfileTab } from './UserProfileView'
import type { LinuxDoProfileDraft } from '../people/sections'
import { decodePost } from '../api/decode'
import { linuxDoEndpoints } from '../api/endpoints'
import { AccountView } from './AccountView'
import { TrustLevelView } from '../connect/TrustLevelView'
import { verifyLinuxDoChallenge } from '../session/native'
import {
  linuxDoApi as api,
  linuxDoDiscovery as discovery,
  linuxDoFeeds as feeds,
  linuxDoNotifications as notificationsApi,
  linuxDoTopics as topicsApi,
  linuxDoDrafts as draftsApi,
} from '../runtime'
import { TopicCard } from './shared'
import { LinuxDoRequestError, type LinuxDoVerificationOptions, type LinuxDoVerify } from './VerificationAction'
import { useFeedUpdates } from './useFeedUpdates'
import type { LinuxDoFeedUpdates, LinuxDoIncomingSnapshot } from '../feed/updates'
import { applyLinuxDoReadProgress, linuxDoTopicHasUnreadIndicator } from '../topic/readState'
import type { LinuxDoDiscoveryScope } from './discoveryScope'
import { linuxDoLoadingLabel } from './loadingModel'
import { readableError } from './utils'
import type { LinuxDoCategory, LinuxDoFeedMode, LinuxDoPost, LinuxDoSessionSnapshot, LinuxDoTopic, LinuxDoTopicSummary } from '../types'
import { LinuxDoApiError } from '../types'

type Route =
  | { kind: 'feed'; mode: LinuxDoFeedMode }
  | { kind: 'topic'; topic: LinuxDoTopicSummary; targetPostNumber?: number }
  | { kind: 'search' }
  | { kind: 'discover'; scope?: LinuxDoDiscoveryScope }
  | { kind: 'notifications' }
  | { kind: 'messages' }
  | { kind: 'user'; username: string; tab?: UserProfileTab; badgeId?: number }
  | { kind: 'bookmarks' }
  | { kind: 'trust' }
  | { kind: 'account' }

interface Props {
  onExit: () => void
  backHandlerRef: MutableRefObject<(() => boolean) | null>
  presetSwitcher: PresetSwitcherProps
}

interface LinuxDoFeedCacheEntry {
  items: LinuxDoTopicSummary[]
  page: number
  scrollTop: number
  hasMore: boolean
  loaded: boolean
}

type LinuxDoFeedCache = Record<LinuxDoFeedMode, LinuxDoFeedCacheEntry>

const emptyFeedCacheEntry = (): LinuxDoFeedCacheEntry => ({ items: [], page: 0, scrollTop: 0, hasMore: true, loaded: false })

const createFeedCache = (): LinuxDoFeedCache => ({
  latest: emptyFeedCacheEntry(),
  hot: emptyFeedCacheEntry(),
  new: emptyFeedCacheEntry(),
  unread: emptyFeedCacheEntry(),
  top: emptyFeedCacheEntry(),
  posted: emptyFeedCacheEntry(),
  read: emptyFeedCacheEntry(),
  bookmarks: emptyFeedCacheEntry(),
})

const feedLabels: Record<LinuxDoFeedMode, string> = {
  latest: '最新',
  hot: '热门',
  new: '新',
  unread: '未读',
  top: '排行榜',
  posted: '我的帖子',
  read: '已读',
  bookmarks: '书签',
}

const feedTabs: Array<{ id: LinuxDoFeedMode; label: string }> = [
  { id: 'latest', label: '最新' },
  { id: 'hot', label: '热门' },
  { id: 'new', label: '新' },
  { id: 'unread', label: '未读' },
]

const authenticatedFeedModes = new Set<LinuxDoFeedMode>(['new', 'unread', 'posted', 'read', 'bookmarks'])

function FeedView({
  mode,
  session,
  onMode,
  onOpen,
  onVerify,
  onOpenScope,
  onCategories,
  onLogin,
  onSessionExpired,
  categoriesById,
  cacheRef,
  homeRefreshRef,
  updates,
  onUpdatesAcknowledged,
}: {
  mode: LinuxDoFeedMode
  session: LinuxDoSessionSnapshot
  onMode: (mode: LinuxDoFeedMode) => void
  onOpen: (topic: LinuxDoTopicSummary) => void
  onVerify: LinuxDoVerify
  onOpenScope: (scope: LinuxDoDiscoveryScope) => void
  onCategories: () => void
  onLogin: () => void
  onSessionExpired: () => void
  categoriesById: Record<number, LinuxDoCategory>
  cacheRef: MutableRefObject<LinuxDoFeedCache>
  homeRefreshRef: MutableRefObject<(() => void) | null>
  updates: LinuxDoFeedUpdates
  onUpdatesAcknowledged: (mode: LinuxDoFeedMode, snapshot: LinuxDoIncomingSnapshot) => void
}) {
  const [items, setItems] = useState<LinuxDoTopicSummary[]>(() => cacheRef.current[mode].items)
  const [loading, setLoading] = useState(() => !cacheRef.current[mode].loaded)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => cacheRef.current[mode].hasMore)
  const [error, setError] = useState<unknown>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)

  const pageRef = useRef(0)
  const hasMoreRef = useRef(true)
  const busyRef = useRef(false)
  const requestIdRef = useRef(0)
  const currentModeRef = useRef<LinuxDoFeedMode>(mode)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchIntent = useRef<'horizontal' | 'vertical' | null>(null)
  currentModeRef.current = mode

  const selectMode = useCallback((nextMode: LinuxDoFeedMode) => {
    if (nextMode === currentModeRef.current) return
    if (scrollerRef.current) {
      cacheRef.current[currentModeRef.current].scrollTop = scrollerRef.current.scrollTop
    }
    // Invalidate the previous tab synchronously, before React commits the route
    // change. A native request may finish between the tap and the next effect.
    requestIdRef.current += 1
    busyRef.current = false
    currentModeRef.current = nextMode
    onMode(nextMode)
  }, [cacheRef, onMode])

  const load = useCallback(async (reset: boolean) => {
    const requestMode = mode
    if (requestMode !== currentModeRef.current) return
    if (authenticatedFeedModes.has(requestMode) && !session.authenticated) {
      setItems([])
      setHasMore(false)
      hasMoreRef.current = false
      setError(new LinuxDoApiError('auth-required', `登录后可查看${feedLabels[requestMode]}`))
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
      return
    }
    if (busyRef.current || (!reset && !hasMoreRef.current)) return

    busyRef.current = true
    const requestId = ++requestIdRef.current
    if (reset) {
      if (cacheRef.current[requestMode].loaded) setRefreshing(true)
      else setLoading(true)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    const incomingSnapshot = reset ? updates.snapshot(requestMode) : undefined

    try {
      const page = reset ? 0 : pageRef.current + 1
      const incoming = await feeds.list(requestMode, page)
      if (requestId !== requestIdRef.current || currentModeRef.current !== requestMode) return

      pageRef.current = page
      hasMoreRef.current = incoming.hasMore
      setHasMore(incoming.hasMore)
      setItems((previous) => {
        const base = reset ? [] : previous
        const knownIds = new Set(base.map((topic) => topic.id))
        const nextItems = base.concat(incoming.items.filter((topic) => !knownIds.has(topic.id)))
        const previousCache = cacheRef.current[requestMode]
        cacheRef.current[requestMode] = {
          items: nextItems,
          page,
          scrollTop: reset ? 0 : previousCache.scrollTop,
          hasMore: incoming.hasMore,
          loaded: true,
        }
        return nextItems
      })
      if (reset && scrollerRef.current) scrollerRef.current.scrollTop = 0
      if (incomingSnapshot) onUpdatesAcknowledged(requestMode, incomingSnapshot)
    } catch (nextError) {
      if (requestId !== requestIdRef.current || currentModeRef.current !== requestMode) return
      if (nextError instanceof LinuxDoApiError && nextError.kind === 'auth-required') {
        onSessionExpired()
      }
      setError(nextError)
    } finally {
      if (requestId === requestIdRef.current) {
        busyRef.current = false
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
      }
    }
  }, [mode, session.authenticated, cacheRef, onSessionExpired, updates, onUpdatesAcknowledged])

  useEffect(() => {
    homeRefreshRef.current = () => {
      if (busyRef.current) return
      const activeMode = currentModeRef.current
      if (scrollerRef.current) scrollerRef.current.scrollTo({ top: 0 })
      cacheRef.current[activeMode] = { ...cacheRef.current[activeMode], scrollTop: 0 }
      void load(true)
    }
    return () => {
      homeRefreshRef.current = null
    }
  }, [cacheRef, homeRefreshRef, load])

  useEffect(() => {
    requestIdRef.current += 1
    busyRef.current = false
    currentModeRef.current = mode

    if (authenticatedFeedModes.has(mode) && !session.authenticated) {
      pageRef.current = 0
      hasMoreRef.current = false
      setItems([])
      setHasMore(false)
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
      setError(new LinuxDoApiError('auth-required', `登录后可查看${feedLabels[mode]}`))
      return
    }

    const cached = cacheRef.current[mode]
    pageRef.current = cached.page
    hasMoreRef.current = cached.hasMore
    setItems(cached.items)
    setHasMore(cached.hasMore)
    setError(null)
    setRefreshing(false)
    setLoadingMore(false)

    if (cached.loaded) {
      setLoading(false)
      if (scrollerRef.current) scrollerRef.current.scrollTop = cached.scrollTop
    } else {
      setLoading(true)
      void load(true)
    }
  }, [mode, session.authenticated, load, cacheRef])

  useEffect(() => () => {
    requestIdRef.current += 1
    busyRef.current = false
  }, [])

  useLayoutEffect(() => {
    const node = scrollerRef.current
    const cache = cacheRef.current
    if (node) node.scrollTop = cache[mode].scrollTop
    return () => {
      if (node) cache[mode].scrollTop = node.scrollTop
    }
  }, [cacheRef, mode])

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,a,input,textarea,[role="dialog"]')) {
      touchStartX.current = null
      touchStartY.current = null
      touchIntent.current = null
      return
    }
    touchStartX.current = event.touches[0]?.clientX ?? null
    touchStartY.current = event.touches[0]?.clientY ?? null
    touchIntent.current = null
  }

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const x = event.touches[0]?.clientX ?? touchStartX.current
    const y = event.touches[0]?.clientY ?? touchStartY.current
    const dx = x - touchStartX.current
    const dy = y - touchStartY.current
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    if (!touchIntent.current && Math.max(absX, absY) >= 12) {
      touchIntent.current = absX > absY * 1.35 ? 'horizontal' : 'vertical'
    }
    if (touchIntent.current !== 'vertical') return
    if ((scrollerRef.current?.scrollTop ?? 0) > 0 || dy <= 0) return
    setPullDistance(Math.min(96, dy * 0.55))
  }

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const startX = touchStartX.current
    const startY = touchStartY.current
    const intent = touchIntent.current
    const shouldRefresh = intent === 'vertical' && pullDistance >= 54

    touchStartX.current = null
    touchStartY.current = null
    touchIntent.current = null
    setPullDistance(0)

    if (shouldRefresh) {
      void load(true)
      return
    }
    if (intent !== 'horizontal' || startX === null || startY === null) return

    const endX = event.changedTouches[0]?.clientX ?? startX
    const endY = event.changedTouches[0]?.clientY ?? startY
    const dx = endX - startX
    const dy = endY - startY
    if (Math.abs(dx) < 76 || Math.abs(dx) <= Math.abs(dy) * 1.35) return

    const index = feedTabs.findIndex((tab) => tab.id === mode)
    if (index < 0) return
    const nextIndex = dx < 0 ? Math.min(feedTabs.length - 1, index + 1) : Math.max(0, index - 1)
    const nextTab = feedTabs[nextIndex]
    if (nextTab && nextTab.id !== mode) selectMode(nextTab.id)
  }

  const filterItems: Array<{
    id: LinuxDoFeedMode | 'categories'
    label: string
    caption: string
    auth?: boolean
  }> = [
    { id: 'unread', label: '未读', caption: '你已关注但还没有读完的主题', auth: true },
    { id: 'latest', label: '最新', caption: '按最近活动排序的全站主题' },
    { id: 'new', label: '新', caption: 'LinuxDO 为当前账号判定的新主题', auth: true },
    { id: 'hot', label: '热门', caption: 'Discourse Hot 热度算法的当前热门主题' },
    { id: 'top', label: '排行榜', caption: '使用 LinuxDO 当前站点的 Top 时间范围' },
    { id: 'posted', label: '我的帖子', caption: '你参与过的主题', auth: true },
    { id: 'read', label: '已读', caption: '当前账号已经阅读过的主题', auth: true },
    { id: 'bookmarks', label: '书签', caption: '当前账号收藏的帖子和主题', auth: true },
    { id: 'categories', label: '类别', caption: '按 LinuxDO 分类浏览主题' },
  ]

  return (
    <div className="relative flex h-full min-h-0 flex-col" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      <div className="sticky top-0 z-10 border-b border-paper/[0.06] bg-ink/90 backdrop-blur-2xl">
        <div className="page-x flex items-center gap-1.5 py-1.5">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-xl border border-paper/[0.06] bg-paper/[0.03] p-1 scrollbar-none">
            {feedTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectMode(tab.id)}
                aria-pressed={tab.id === mode}
                className={
                  'linuxdo-control min-h-[30px] shrink-0 rounded-lg px-3 py-1 text-[11.5px] font-medium transition-all duration-150 active:scale-95 ' +
                  (tab.id === mode
                    ? 'bg-cinnabar text-white font-semibold shadow-[0_2px_8px_rgba(235,68,54,0.35)]'
                    : 'text-paper-muted/80 hover:bg-paper/[0.05] hover:text-paper')
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFilterMenuOpen(true)}
            className={
              'linuxdo-control inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-medium transition-all duration-150 active:scale-95 ' +
              (feedTabs.some((tab) => tab.id === mode)
                ? 'border-paper/[0.08] bg-paper/[0.03] text-paper-muted hover:border-paper/[0.14] hover:bg-paper/[0.06] hover:text-paper'
                : 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar font-semibold shadow-[0_2px_8px_rgba(235,68,54,0.15)]')
            }
            aria-label="LinuxDO 主题筛选"
          >
            <ListFilter size={12.5} />
            {!feedTabs.some((tab) => tab.id === mode) ? (
              <span className="max-w-[4rem] truncate font-semibold">{feedLabels[mode]}</span>
            ) : null}
            <ChevronDown size={10.5} className="text-paper-faint" />
          </button>
          <button
            type="button"
            disabled={refreshing || loading}
            onClick={() => void load(true)}
            className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-paper/[0.08] bg-paper/[0.03] text-paper-muted hover:border-cinnabar/40 hover:bg-paper/[0.06] hover:text-cinnabar transition-all duration-150 active:scale-90 disabled:opacity-40"
            aria-label={refreshing ? '正在刷新' : '刷新'}
          >
            <RefreshCcw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {pullDistance > 0 || refreshing ? (
        <div className="pointer-events-none flex items-center justify-center gap-2 overflow-hidden text-[10px] text-paper-faint transition-[height]" style={{ height: refreshing ? 34 : pullDistance }}>
          {refreshing ? <><Loader2 size={13} className="animate-spin" /><span>{linuxDoLoadingLabel('refreshing')}</span></> : pullDistance >= 54 ? '松手刷新' : '下拉刷新'}
        </div>
      ) : null}

      {updates.count(mode) > 0 ? (
        <div className="flex shrink-0 justify-center border-b border-haze/50 px-3 py-2" aria-live="polite">
          <button
            type="button"
            disabled={loading || refreshing || loadingMore}
            onClick={() => homeRefreshRef.current?.()}
            className="linuxdo-control rounded-xl bg-cinnabar/15 px-4 py-2 text-[12px] font-medium text-cinnabar-soft disabled:opacity-50"
          >
            查看 {updates.count(mode)} 个新的或更新过的话题
          </button>
        </div>
      ) : null}

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-4 pt-3"
        onScroll={(event) => {
          const node = event.currentTarget
          cacheRef.current[mode] = { ...cacheRef.current[mode], scrollTop: node.scrollTop }
          if (!error && hasMoreRef.current && !busyRef.current && node.scrollHeight - node.scrollTop - node.clientHeight < 420) {
            void load(false)
          }
        }}
      >
        {loading ? (
          <div className="space-y-2 sm:space-y-2.5" role="status" aria-label={linuxDoLoadingLabel('initial')}>
            {Array.from({ length: 6 }, (_, index) => <div key={index} className="linuxdo-skeleton h-[106px] rounded-2xl border border-haze/40" />)}
          </div>
        ) : error && items.length === 0 ? (
          <LinuxDoRequestError variant="empty" error={error} onVerify={onVerify} onLogin={onLogin} onRetry={() => load(true)} />
        ) : (
          <div className="space-y-2 sm:space-y-2.5">
            {error && items.length > 0 ? (
              <div data-linuxdo-feed-error>
                <LinuxDoRequestError error={error} onVerify={onVerify} onLogin={onLogin} onRetry={() => load(true)} busy={refreshing || loading} />
              </div>
            ) : null}
            {items.map((topic, index) => (
              <div key={topic.id} className="linuxdo-card-in" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}>
                <TopicCard
                  topic={topic}
                  category={topic.categoryId ? categoriesById[topic.categoryId] : undefined}
                  onOpen={() => onOpen(topic)}
                  onOpenCategory={(category) => onOpenScope({ kind: 'category', category })}
                  onOpenTag={(name) => onOpenScope({ kind: 'tag', name })}
                />
              </div>
            ))}
            {!items.length && !error ? (
              <div className="py-16 text-center text-[11px] text-paper-faint">当前筛选下没有主题</div>
            ) : null}
            {loadingMore ? (
              <div className="flex items-center justify-center gap-2 py-5 text-[10.5px] text-paper-faint" role="status" aria-label={linuxDoLoadingLabel('more')}>
                <Loader2 size={15} className="animate-spin" />正在加载更多
              </div>
            ) : items.length && hasMore ? (
              <button type="button" onClick={() => void load(false)} className="linuxdo-control w-full rounded-xl border border-haze/60 bg-paper/[0.025] py-3 text-[10.5px] text-paper-muted">
                加载更多
              </button>
            ) : items.length ? (
              <div className="py-4 text-center text-[9.5px] text-paper-faint">已加载全部 {items.length} 个主题</div>
            ) : null}
          </div>
        )}
      </div>

      {filterMenuOpen ? (
        <div className="linuxdo-sheet-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onClick={() => setFilterMenuOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="LinuxDO 主题筛选" className="linuxdo-sheet flex max-h-[82dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-t border-haze/80 bg-ink-raised shadow-2xl sm:max-w-md sm:rounded-[28px] sm:border" onClick={(event) => event.stopPropagation()}>
            <div className="linuxdo-sheet-grabber mx-auto sm:hidden" />
            <div className="flex items-center justify-between border-b border-haze/60 px-5 py-3.5">
              <div>
                <h3 className="text-[16px] font-semibold text-paper">主题筛选</h3>
                <p className="mt-0.5 text-[11px] text-paper-faint">对应 LinuxDO PWA 的原生筛选，不做本地伪排序</p>
              </div>
              <button type="button" onClick={() => setFilterMenuOpen(false)} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full bg-paper/5 text-paper-muted hover:bg-paper/10 hover:text-paper transition active:scale-95" aria-label="关闭筛选"><X size={16} /></button>
            </div>
            <div className="max-h-[calc(82dvh-72px)] overflow-y-auto overscroll-contain p-4 pb-[max(16px,var(--sab))] scrollbar-thin">
              <div className="grid gap-2">
                {filterItems.map((item) => {
                  const selected = item.id === mode
                  const needsAuth = Boolean(item.auth && !session.authenticated)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setFilterMenuOpen(false)
                        if (item.id === 'categories') {
                          onCategories()
                          return
                        }
                        selectMode(item.id)
                      }}
                      className={'linuxdo-control flex min-h-[60px] items-center gap-3.5 rounded-2xl border px-4 py-3 text-left transition select-none ' + (selected ? 'border-cinnabar/40 bg-cinnabar/[0.09] shadow-sm' : 'border-haze/50 bg-paper/[0.025] hover:border-haze hover:bg-paper/[0.05]')}
                    >
                      <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ' + (selected ? 'bg-cinnabar/15 text-cinnabar shadow-sm' : 'bg-paper/[0.05] text-paper-muted')}>
                        {item.id === 'hot' ? <Flame size={18} /> : item.id === 'top' ? <Trophy size={18} /> : item.id === 'read' ? <History size={18} /> : item.id === 'categories' ? <Compass size={18} /> : item.id === 'bookmarks' ? <CheckCircle2 size={18} /> : <MessageCircle size={18} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-paper">
                          {item.label}
                          {selected ? <span className="rounded-full bg-cinnabar/15 px-2 py-0.5 text-[10px] font-medium text-cinnabar-soft">当前</span> : null}
                          {needsAuth ? <span className="rounded-full bg-paper/[0.08] px-2 py-0.5 text-[10px] font-medium text-paper-faint">需登录</span> : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-4 text-paper-faint">{item.caption}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function LinuxDoWorkspace({ onExit, backHandlerRef, presetSwitcher }: Props) {
  const [route, setRoute] = useState<Route>({ kind: 'feed', mode: 'latest' })
  const [history, setHistory] = useState<Route[]>([])
  const feedCacheRef = useRef<LinuxDoFeedCache>(createFeedCache())
  const feedHomeRefreshRef = useRef<(() => void) | null>(null)
  const lastFeedModeRef = useRef<LinuxDoFeedMode>('latest')
  if (route.kind === 'feed') lastFeedModeRef.current = route.mode
  const discoverCacheRef = useRef(createLinuxDoDiscoveryCache())
  const notificationFilterRef = useRef<LinuxDoNotificationFilter>('all')
  const privateMessagesCacheRef = useRef(createLinuxDoPrivateMessagesCache())
  const searchCacheRef = useRef(createLinuxDoSearchCache())
  const searchSessionKeyRef = useRef('guest')
  const [session, setSession] = useState<LinuxDoSessionSnapshot>({ authenticated: false, authMode: 'none' })
  const { updates: feedUpdates, acknowledge: acknowledgeFeedUpdates } = useFeedUpdates(session)
  const [composerTopic, setComposerTopic] = useState<LinuxDoTopic | undefined>()
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerInitialRaw, setComposerInitialRaw] = useState('')
  const [composerReplyTo, setComposerReplyTo] = useState<number | undefined>()
  const [composerEditPost, setComposerEditPost] = useState<LinuxDoPost | undefined>()
  const [composerDraft, setComposerDraft] = useState<LinuxDoProfileDraft | undefined>()
  const [topicPostMutation, setTopicPostMutation] = useState<LinuxDoPost | undefined>()
  const [boostPost, setBoostPost] = useState<LinuxDoPost | null>(null)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceNotice, setWorkspaceNotice] = useState<string>('')
  const [notificationUnread, setNotificationUnread] = useState(0)
  const notificationUnreadRevisionRef = useRef(0)
  const topicOverlayBackHandlerRef = useRef<(() => boolean) | null>(null)
  const composerRequestCloseRef = useRef<(() => void) | null>(null)
  const workspaceNoticeTimerRef = useRef<number | null>(null)
  const [workspaceCategories, setWorkspaceCategories] = useState<Record<number, LinuxDoCategory>>({})

  const applyTopicReadProgress = useCallback((topicId: number, highestSeen: number) => {
    const updateItems = (items: LinuxDoTopicSummary[]) =>
      items.map((item) => item.id === topicId ? applyLinuxDoReadProgress(item, highestSeen) : item)

    for (const mode of Object.keys(feedCacheRef.current) as LinuxDoFeedMode[]) {
      const entry = feedCacheRef.current[mode]
      if (!entry.items.some((item) => item.id === topicId)) continue
      let items = updateItems(entry.items)
      if (mode === 'new' || mode === 'unread') {
        items = items.filter((item) => item.id !== topicId || linuxDoTopicHasUnreadIndicator(item))
      }
      feedCacheRef.current[mode] = { ...entry, items }
    }

    for (const [key, entry] of Object.entries(discoverCacheRef.current.scopes)) {
      if (!entry.items.some((item) => item.id === topicId)) continue
      discoverCacheRef.current.scopes[key] = { ...entry, items: updateItems(entry.items) }
    }

    if (searchCacheRef.current.topics.some((item) => item.id === topicId)) {
      searchCacheRef.current = {
        ...searchCacheRef.current,
        topics: updateItems(searchCacheRef.current.topics),
      }
    }

    applyPrivateMessageReadProgress(privateMessagesCacheRef.current, topicId, highestSeen)

    // /read.json is server-derived; force a fresh page next time rather than
    // pretending that our cached membership/order is authoritative.
    feedCacheRef.current.read = emptyFeedCacheEntry()
    setRoute((current) => current.kind === 'topic' && current.topic.id === topicId
      ? { ...current, topic: applyLinuxDoReadProgress(current.topic, highestSeen) }
      : current)
  }, [])

  const resetPersonalizedFeedCaches = useCallback(() => {
    for (const mode of ['new', 'unread', 'posted', 'read', 'bookmarks'] as const) {
      feedCacheRef.current[mode] = emptyFeedCacheEntry()
    }
  }, [])

  const applyNotificationUnread = useCallback((count: number) => {
    const normalized = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0))
    notificationUnreadRevisionRef.current += 1
    setNotificationUnread(normalized)
    setSession((previous) => previous.currentUser
      ? {
        ...previous,
        currentUser: {
          ...previous.currentUser,
          allUnreadNotificationsCount: normalized,
        },
      }
      : previous)
  }, [])

  const applyWorkspaceSession = useCallback((next: LinuxDoSessionSnapshot) => {
    notificationFilterRef.current = 'all'
    privateMessagesCacheRef.current = createLinuxDoPrivateMessagesCache()
    const searchSessionKey = next.authenticated ? String(next.currentUser?.id ?? 'member') : 'guest'
    if (searchSessionKeyRef.current !== searchSessionKey) {
      searchCacheRef.current = createLinuxDoSearchCache()
      searchSessionKeyRef.current = searchSessionKey
    }
    setSession(next)
    applyNotificationUnread(next.currentUser?.allUnreadNotificationsCount ?? next.currentUser?.unreadNotifications ?? 0)
    resetPersonalizedFeedCaches()
  }, [applyNotificationUnread, resetPersonalizedFeedCaches])

  const expireWorkspaceSession = useCallback(() => {
    const next: LinuxDoSessionSnapshot = { authenticated: false, authMode: 'none' }
    api.setSession(next)
    applyWorkspaceSession(next)
  }, [applyWorkspaceSession])

  useEffect(() => {
    void discovery.categories().then((cats) => setWorkspaceCategories(Object.fromEntries(cats.map((c) => [c.id, c])))).catch(() => undefined)
  }, [])

  useEffect(() => {
    void api.restore().then(applyWorkspaceSession).catch((nextError) => setWorkspaceError(readableError(nextError)))
    return () => {
      if (workspaceNoticeTimerRef.current != null) window.clearTimeout(workspaceNoticeTimerRef.current)
    }
  }, [applyWorkspaceSession])

  const refreshNotificationUnread = useCallback(async () => {
    if (!session.authenticated) return
    const revision = notificationUnreadRevisionRef.current
    try {
      const count = await notificationsApi.unreadCount()
      if (revision === notificationUnreadRevisionRef.current) applyNotificationUnread(count)
    } catch {
      // Notification count is auxiliary UI state; the active screen reports actionable errors.
    }
  }, [applyNotificationUnread, session.authenticated])

  useEffect(() => {
    if (!session.authenticated) return
    void refreshNotificationUnread()
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshNotificationUnread()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshNotificationUnread, session.authenticated])

  const showWorkspaceNotice = useCallback((message: string) => {
    if (workspaceNoticeTimerRef.current != null) window.clearTimeout(workspaceNoticeTimerRef.current)
    setWorkspaceNotice(message)
    workspaceNoticeTimerRef.current = window.setTimeout(() => {
      workspaceNoticeTimerRef.current = null
      setWorkspaceNotice('')
    }, 2400)
  }, [])

  const navigate = useCallback((next: Route) => {
    setHistory((previous) => previous.concat(route))
    setRoute(next)
  }, [route])

  const goBack = useCallback(() => {
    const previous = history[history.length - 1]
    if (!previous) return false
    setHistory((items) => items.slice(0, -1))
    setRoute(previous)
    return true
  }, [history])

  const replaceDiscoverScope = useCallback((scope: LinuxDoDiscoveryScope | null) => {
    setRoute((current) => current.kind === 'discover'
      ? { kind: 'discover', scope: scope ?? undefined }
      : current)
  }, [])

  const closeComposer = useCallback(() => {
    setComposerOpen(false)
    setComposerDraft(undefined)
    setComposerInitialRaw('')
    setComposerReplyTo(undefined)
    setComposerEditPost(undefined)
  }, [])

  useEffect(() => {
    backHandlerRef.current = () => {
      if (topicOverlayBackHandlerRef.current?.()) return true
      if (boostPost) { setBoostPost(null); return true }
      if (composerOpen) { composerRequestCloseRef.current?.(); return true }
      if (route.kind === 'discover' && route.scope) {
        setRoute({ kind: 'discover' })
        return true
      }
      return goBack()
    }
    return () => { backHandlerRef.current = null }
  }, [backHandlerRef, boostPost, composerOpen, goBack, route])

  const verify: LinuxDoVerify = async (options?: LinuxDoVerificationOptions): Promise<boolean> => {
    try {
      // Keep Cloudflare clearance separate from account login. Replaying each
      // affected screen's request is the only authority for successful recovery.
      return await verifyLinuxDoChallenge(options?.url, { readSyncChallenge: options?.readSyncChallenge })
    } catch (nextError) {
      const message = readableError(nextError)
      if (!message.includes('取消')) setWorkspaceError(message)
      return false
    }
  }

  const title =
    route.kind === 'feed' ? 'Linux.do'
      : route.kind === 'topic' ? '主题'
        : route.kind === 'search' ? '搜索'
          : route.kind === 'discover' ? '发现'
            : route.kind === 'messages' ? '个人私信'
            : route.kind === 'notifications' ? '通知'
              : route.kind === 'user' ? '用户'
                : route.kind === 'bookmarks' ? '书签'
                  : route.kind === 'trust' ? '信任等级'
                    : '我的'

  return (
    <div className="linuxdo-workspace relative flex h-full min-h-0 flex-col overflow-hidden bg-ink text-paper">
      {route.kind !== 'topic' ? <header className="linuxdo-brand-header linuxdo-control shrink-0 border-b border-paper/[0.06] bg-ink/90 page-x select-none backdrop-blur-2xl">
        <div className="flex h-12 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (route.kind === 'discover' && route.scope) {
                setRoute({ kind: 'discover' })
                return
              }
              if (!goBack()) onExit()
            }}
            className="linuxdo-icon-button grid h-8 w-8 sm:h-8.5 sm:w-8.5 shrink-0 place-items-center rounded-full text-paper-muted hover:bg-paper/5 hover:text-paper transition-all duration-150 active:scale-90"
            aria-label="返回 NewsNook"
          >
            <ArrowLeft size={16} />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            <span className="truncate text-[16px] sm:text-[17px] font-bold tracking-tight text-paper">
              {route.kind === 'feed' ? 'Linux.do' : title}
            </span>
            {route.kind === 'feed' ? (
              <span className="hidden min-[380px]:inline-flex shrink-0 items-center rounded-full border border-cinnabar/25 bg-cinnabar/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-cinnabar">
                Discourse
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate({ kind: 'search' })}
              className={'linuxdo-icon-button grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 ' + (route.kind === 'search' ? 'is-active bg-cinnabar/10 text-cinnabar' : 'text-paper-muted hover:bg-paper/5 hover:text-paper')}
              aria-label="搜索"
            >
              <Search size={15.5} />
            </button>
            <button
              type="button"
              onClick={() => navigate({ kind: 'notifications' })}
              className={'linuxdo-icon-button relative grid h-8 w-8 shrink-0 place-items-center rounded-full transition active:scale-95 ' + (route.kind === 'notifications' ? 'is-active bg-cinnabar/10 text-cinnabar' : 'text-paper-muted hover:bg-paper/5 hover:text-paper')}
              aria-label="通知"
            >
              <Bell size={15.5} />
              {notificationUnread > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] rounded-full bg-[#ff4d4f] px-1 text-center font-mono text-[8px] font-bold leading-[15px] text-white shadow-sm ring-1 ring-ink">
                  {notificationUnread > 99 ? '99+' : notificationUnread}
                </span>
              ) : null}
            </button>
            <div className="linuxdo-preset-slot shrink-0">
              <PresetSwitcher {...presetSwitcher} />
            </div>
          </div>
        </div>
      </header> : null}

      {workspaceError ? <button type="button" onClick={() => setWorkspaceError('')} className="linuxdo-control mx-3 mt-2 rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{workspaceError} · 点击关闭</button> : null}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {route.kind === 'feed' ? (
          <FeedView
            key={`${route.mode}:${session.authMode}:${session.currentUser?.id ?? ''}`}
            mode={route.mode}
            session={session}
            cacheRef={feedCacheRef}
            onMode={(mode) => setRoute({ kind: 'feed', mode })}
            onOpen={(topic) => navigate({ kind: 'topic', topic })}
            onOpenScope={(scope) => navigate({ kind: 'discover', scope })}
            onVerify={verify}
            onCategories={() => {
              discoverCacheRef.current.hub.activeTab = 'categories'
              navigate({ kind: 'discover' })
            }}
            onLogin={() => navigate({ kind: 'account' })}
            onSessionExpired={expireWorkspaceSession}
            categoriesById={workspaceCategories}
            homeRefreshRef={feedHomeRefreshRef}
            updates={feedUpdates}
            onUpdatesAcknowledged={acknowledgeFeedUpdates}
          />
        ) : route.kind === 'topic' ? (
          <LinuxDoTopicView key={`${route.topic.id}:${session.authenticated ? session.currentUser?.id ?? 'guest' : 'guest'}:${route.targetPostNumber ?? ''}`} summary={route.topic} session={session} targetPostNumber={route.targetPostNumber} postMutation={topicPostMutation} overlayBackHandlerRef={topicOverlayBackHandlerRef} onReadProgress={applyTopicReadProgress} onSession={applyWorkspaceSession} onVerify={verify} onBack={() => { if (!goBack()) setRoute({ kind: 'feed', mode: 'latest' }) }} onCompose={(topic, options) => { setComposerTopic(topic); setComposerEditPost(undefined); setComposerInitialRaw(options?.initialRaw || ''); setComposerReplyTo(options?.replyToPostNumber); setComposerOpen(true) }} onBoost={setBoostPost} onOpenUser={(username) => navigate({ kind: 'user', username })} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onOpenTag={(name) => navigate({ kind: 'discover', scope: { kind: 'tag', name } })} onOpenCategory={(category) => navigate({ kind: 'discover', scope: { kind: 'category', category } })} categoriesById={workspaceCategories} onEdit={(topic, post) => {
            setComposerTopic(topic)
            setComposerReplyTo(undefined)
            const openEditor = (raw: string) => { setComposerEditPost({ ...post, raw }); setComposerInitialRaw(raw); setComposerOpen(true) }
            if (post.raw) openEditor(post.raw)
            else void topicsApi.raw(post.id).then(openEditor).catch((nextError) => setWorkspaceError(readableError(nextError)))
          }} />
        ) : route.kind === 'search' ? (
          <SearchView cacheRef={searchCacheRef} key={session.authenticated ? session.currentUser?.id ?? 'member' : 'guest'} authenticated={session.authenticated} categoriesById={workspaceCategories} onVerify={verify} onLogin={() => navigate({ kind: 'account' })} onOpen={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onOpenUser={(username) => navigate({ kind: 'user', username })} onOpenCategory={(category) => navigate({ kind: 'discover', scope: { kind: 'category', category } })} onOpenTag={(name) => navigate({ kind: 'discover', scope: { kind: 'tag', name } })} />
        ) : route.kind === 'discover' ? (
          <DiscoverView initialScope={route.scope} cacheRef={discoverCacheRef} onVerify={verify} onScopeChange={replaceDiscoverScope} onOpen={(topic) => navigate({ kind: 'topic', topic })} />
        ) : route.kind === 'notifications' ? (
          <NotificationsView onPrivateError={setWorkspaceError} initialFilter={notificationFilterRef.current} onFilterChange={(filter) => { notificationFilterRef.current = filter }} onVerify={verify} onLogin={() => navigate({ kind: 'account' })} privateMessagesCacheRef={privateMessagesCacheRef} key={`${session.authMode}:${session.currentUser?.id ?? ''}`} session={session} onUnreadChange={applyNotificationUnread} onOpen={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onOpenUser={(username, tab, badgeId) => navigate({ kind: 'user', username, tab, badgeId })} />
        ) : route.kind === 'messages' ? (
          <PrivateMessagesView onVerify={verify} onLogin={() => navigate({ kind: 'account' })} key={`${session.authMode}:${session.currentUser?.id ?? ''}`} session={session} cacheRef={privateMessagesCacheRef} onOpen={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onUnreadChange={applyNotificationUnread} onError={setWorkspaceError} />
        ) : route.kind === 'user' ? (
          <UserProfileView username={route.username} initialTab={route.tab} initialBadgeId={route.badgeId} session={session} onVerify={verify} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} onOpenUser={(username) => navigate({ kind: 'user', username })} onResumeDraft={async (draft) => {
            if (draft.key.startsWith('new_private_message')) throw new Error('新私信草稿暂不支持在 App 中编辑')
            const owner = api.sessionSnapshot().currentUser?.id
            if (!session.authenticated || owner !== session.currentUser?.id) throw new Error('请重新登录后打开草稿')
            const snapshot = await draftsApi.get(draft.key)
            const data = snapshot.data
            if (!data) throw new Error('草稿已被移除或无法读取，请刷新列表')
            if (!['createTopic', 'reply', 'edit'].includes(data.action)) throw new Error('此类型草稿暂不支持在 App 中编辑')
            if (data.action === 'reply' && !draft.topicId) throw new Error('草稿缺少回复主题，无法恢复')
            if (data.action === 'edit' && !data.postId) throw new Error('草稿缺少编辑帖子，无法恢复')
            const topic = draft.topicId ? await topicsApi.get(draft.topicSlug || 'topic', draft.topicId) : undefined
            const post = data.action === 'edit' && data.postId ? decodePost(await api.getJson(linuxDoEndpoints.post(data.postId), { auth: 'required' })) : undefined
            if (owner !== api.sessionSnapshot().currentUser?.id) throw new Error('账号已切换，请重新打开草稿')
            setComposerTopic(topic)
            setComposerEditPost(post)
            setComposerInitialRaw(data.reply)
            setComposerReplyTo(data.reply_to_post_number)
            setComposerDraft({ ...draft, sequence: snapshot.sequence, data })
            setComposerOpen(true)
          }} />
        ) : route.kind === 'bookmarks' ? (
          <BookmarksView session={session} onOpenTopic={(topic, targetPostNumber) => navigate({ kind: 'topic', topic, targetPostNumber })} />
        ) : route.kind === 'trust' ? (
          <TrustLevelView session={session} />
        ) : (
          <AccountView onPrivateMessages={() => navigate({ kind: 'messages' })} session={session} onSession={applyWorkspaceSession} onBookmarks={() => navigate({ kind: 'bookmarks' })} onProfile={(username, tab) => navigate({ kind: 'user', username, tab })} onTrustLevel={() => navigate({ kind: 'trust' })} />
        )}
      </div>

      {route.kind !== 'topic' ? <nav className="linuxdo-bottom-nav linuxdo-control relative z-30 w-full shrink-0 grid grid-cols-5 items-center px-1 pt-1 pb-[max(6px,var(--sab))] select-none">
        <HomeRefreshButton
          active={route.kind === 'feed'}
          onNavigateHome={() => setRoute({ kind: 'feed', mode: lastFeedModeRef.current })}
          onRefresh={() => feedHomeRefreshRef.current?.()}
          className={'linuxdo-nav-item ' + (route.kind === 'feed' ? 'is-active' : '')}
          aria-label="首页"
        >
          <span className="linuxdo-nav-icon"><MessageCircle size={19} /></span>
          <span>首页</span>
        </HomeRefreshButton>

        <button
          type="button"
          onClick={() => setRoute({ kind: 'discover' })}
          className={'linuxdo-nav-item ' + (route.kind === 'discover' ? 'is-active' : '')}
          aria-label="发现"
        >
          <span className="linuxdo-nav-icon"><Compass size={19} /></span>
          <span>发现</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setComposerTopic(undefined)
            setComposerEditPost(undefined)
            setComposerInitialRaw('')
            setComposerReplyTo(undefined)
            setComposerOpen(true)
          }}
          className="linuxdo-nav-compose"
          aria-label="发布"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-cinnabar text-white transition-transform duration-150 active:scale-90">
            <Plus size={21} strokeWidth={2.5} />
          </span>
          <span className="mt-0.5">发布</span>
        </button>

        <button
          type="button"
          onClick={() => setRoute({ kind: 'notifications' })}
          className={'linuxdo-nav-item relative ' + (route.kind === 'notifications' ? 'is-active' : '')}
          aria-label="通知"
        >
          <span className="linuxdo-nav-icon relative">
            <Bell size={19} />
            {notificationUnread > 0 ? (
              <i className="absolute right-3.5 top-0.5 h-2 w-2 rounded-full bg-[#ff4d4f] ring-1.5 ring-ink" />
            ) : null}
          </span>
          <span>通知</span>
        </button>

        <button
          type="button"
          onClick={() => setRoute({ kind: 'account' })}
          className={'linuxdo-nav-item ' + (route.kind === 'account' || route.kind === 'messages' || route.kind === 'user' || route.kind === 'bookmarks' || route.kind === 'trust' ? 'is-active' : '')}
          aria-label="我的"
        >
          <span className="linuxdo-nav-icon"><UserRound size={19} /></span>
          <span>我的</span>
        </button>
      </nav> : null}

      <LinuxDoComposer open={composerOpen} topic={composerTopic} session={session} initialRaw={composerInitialRaw} replyToPostNumber={composerReplyTo} editPost={composerEditPost} resumedDraft={composerDraft} requestCloseRef={composerRequestCloseRef} onClose={closeComposer} onSent={(created, kind) => {
        setComposerDraft(undefined)
        if (kind === 'reply') {
          setTopicPostMutation(created)
        } else if (created.topicId) {
          navigate({ kind: 'topic', topic: { id: created.topicId, slug: created.topicSlug || 'topic', title: created.topicTitle || '新主题', postsCount: 1, replyCount: 0, views: 0, likeCount: 0, createdAt: created.createdAt, lastPostedAt: created.createdAt, tags: [], posters: [{ username: created.username, avatarTemplate: created.avatarTemplate }] }, targetPostNumber: created.postNumber || 1 })
        } else {
          feedCacheRef.current.latest = emptyFeedCacheEntry()
          setRoute({ kind: 'feed', mode: 'latest' })
        }
      }} onEdited={(updated) => { setTopicPostMutation(updated); setComposerOpen(false); setComposerEditPost(undefined); setComposerDraft(undefined) }} />

      {boostPost ? (
        <LinuxDoBoostComposer
          post={boostPost}
          onClose={() => setBoostPost(null)}
          onCreated={(post, boost) => {
            setTopicPostMutation({
              ...post,
              boosts: [...(post.boosts ?? []), boost],
              canBoost: false,
            })
            showWorkspaceNotice('Boost 已发送，并已显示在当前帖子中')
          }}
        />
      ) : null}

      {workspaceNotice ? (
        <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-[calc(5.6rem+var(--sab))] left-1/2 z-[70] w-[min(92vw,32rem)] -translate-x-1/2 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-start gap-2 rounded-2xl border border-haze/70 bg-ink-raised/95 px-4 py-2.5 text-[11.5px] font-medium text-paper shadow-2xl backdrop-blur-xl">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-cinnabar-soft" />
            <span className="min-w-0 flex-1 leading-5">{workspaceNotice}</span>
          </div>
        </div>
      ) : null}

    </div>
  )
}
