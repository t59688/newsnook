import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Loader2, RotateCw, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'

import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { RefreshSurface } from './RefreshSurface'

import type { LinuxDoBookmarkService } from '../bookmark/service'
import {
  linuxDoNotificationDetail,
  linuxDoNotificationLabel,
  linuxDoNotificationMatchesFilter,
  linuxDoNotificationTitle,
  markAllLinuxDoNotificationsRead,
  markLinuxDoNotificationRead,
  mergeLinuxDoNotifications,
  resolveLinuxDoNotificationTarget,
  type LinuxDoNotificationFilter,
} from '../notification/model'
import {
  linuxDoBookmarks as bookmarkApi,
  linuxDoNotifications as notificationsApi,
  linuxDoSearch as searchApi,
} from '../runtime'
import type {
  LinuxDoNotification,
  LinuxDoPost,
  LinuxDoSessionSnapshot,
  LinuxDoTopicSummary,
} from '../types'
import { TopicCard } from './shared'
import type { LinuxDoSearchCache, LinuxDoSearchTab } from './searchCache'
import { ago, avatar, readableError } from './utils'

export function SearchView({ onOpen, onOpenUser, cacheRef }: {
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string) => void
  cacheRef: MutableRefObject<LinuxDoSearchCache>
}) {
  const initialCache = cacheRef.current
  const [query, setQuery] = useState(() => initialCache.query)
  const [loading, setLoading] = useState(false)
  const [topics, setTopics] = useState<LinuxDoTopicSummary[]>(() => initialCache.topics)
  const [posts, setPosts] = useState<LinuxDoPost[]>(() => initialCache.posts)
  const [users, setUsers] = useState(() => initialCache.users)
  const [active, setActive] = useState<LinuxDoSearchTab>(() => initialCache.activeTab)
  const [error, setError] = useState('')
  const [page, setPage] = useState(() => initialCache.page)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => initialCache.hasMore)
  const [lastQuery, setLastQuery] = useState(() => initialCache.lastQuery)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('newsnook-linuxdo-search-history') || '[]') as string[] } catch { return [] }
  })

  useEffect(() => {
    cacheRef.current = {
      ...cacheRef.current,
      query,
      lastQuery,
      topics,
      posts,
      users,
      activeTab: active,
      page,
      hasMore,
    }
  }, [active, cacheRef, hasMore, lastQuery, page, posts, query, topics, users])

  useEffect(() => {
    const scrollTop = cacheRef.current.scrollTop
    window.requestAnimationFrame(() => {
      if (scrollerRef.current) scrollerRef.current.scrollTop = scrollTop
    })
  }, [cacheRef])

  const run = async (nextPage = 1) => {
    const normalized = query.trim()
    if (!normalized) return
    if (nextPage === 1) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const next = await searchApi.search(normalized, nextPage)
      if (nextPage === 1) {
        cacheRef.current.scrollTop = 0
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
        const nextHistory = [normalized, ...history.filter((item) => item !== normalized)].slice(0, 8)
        setHistory(nextHistory)
        localStorage.setItem('newsnook-linuxdo-search-history', JSON.stringify(nextHistory))
        setTopics(next.topics)
        setPosts(next.posts)
        setUsers(next.users)
        setLastQuery(normalized)
      } else {
        setTopics((previous) => previous.concat(next.topics.filter((item) => !previous.some((existing) => existing.id === item.id))))
        setPosts((previous) => previous.concat(next.posts.filter((item) => !previous.some((existing) => existing.id === item.id))))
        setUsers((previous) => previous.concat(next.users.filter((item) => !previous.some((existing) => existing.id === item.id))))
      }
      setPage(nextPage)
      setHasMore(next.topics.length > 0 || next.posts.length > 0 || next.users.length > 0)
    } catch (nextError) {
      setError(readableError(nextError))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={(event) => { cacheRef.current.scrollTop = event.currentTarget.scrollTop }}
      className="min-h-0 flex-1 overflow-y-auto page-x pb-4 pt-4"
    >
      <div className="relative flex items-center gap-2 rounded-2xl border border-haze/80 bg-ink-raised/60 p-1.5 pl-3 transition-colors focus-within:border-cinnabar/60 focus-within:ring-1 focus-within:ring-cinnabar/20">
        <Search size={16} className="shrink-0 text-paper-faint" />
        <input
          autoFocus={!lastQuery}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void run(1)}
          placeholder="搜索主题、帖子、用户"
          className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-[13px] leading-normal text-paper outline-none focus:outline-none focus-visible:outline-none placeholder:text-paper-faint"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setTopics([])
              setPosts([])
              setUsers([])
              setLastQuery('')
              setPage(1)
              setHasMore(false)
              cacheRef.current.scrollTop = 0
              if (scrollerRef.current) scrollerRef.current.scrollTop = 0
            }}
            className="linuxdo-control shrink-0 rounded-full p-1 text-paper-faint transition hover:text-paper"
            aria-label="清空搜索词"
          >
            <X size={14} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void run(1)}
          className="linuxdo-control shrink-0 rounded-xl bg-cinnabar px-3.5 py-1.5 text-[11px] font-medium text-white shadow-sm transition active:opacity-90"
        >
          搜索
        </button>
      </div>
      {history.length ? (
        <div className="mt-3 flex items-center gap-2 overflow-x-auto scrollbar-none">
          <span className="shrink-0 text-[9.5px] text-paper-faint">最近</span>
          {history.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setQuery(item)}
              className="linuxdo-control shrink-0 rounded-full border border-haze px-2.5 py-1 text-[10px] text-paper-muted"
            >
              {item}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setHistory([]); localStorage.removeItem('newsnook-linuxdo-search-history') }}
            className="linuxdo-control shrink-0 text-[9.5px] text-paper-faint"
          >
            清除
          </button>
        </div>
      ) : null}
      <div className="linuxdo-control mt-3 grid grid-cols-3 gap-1 rounded-xl bg-paper/[0.04] p-1 select-none border border-haze/30">
        {([['topics', '主题'], ['posts', '帖子'], ['users', '用户']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActive(key)}
            className={'flex items-center justify-center rounded-lg py-1.5 text-[11.5px] font-medium transition-all ' + (active === key ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')}
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : null}
      {error ? <p className="py-8 text-center text-[12px] text-cinnabar-soft">{error}</p> : null}
      {!loading && active === 'topics' ? <div className="mt-4 space-y-3">{topics.map((topic) => <TopicCard key={topic.id} topic={topic} onOpen={() => onOpen(topic)} />)}</div> : null}
      {!loading && active === 'posts' ? <div className="mt-4 space-y-2.5">{posts.map((post) => <button key={post.id} type="button" disabled={!post.topicId} onClick={() => post.topicId && onOpen({ id: post.topicId, slug: post.topicSlug || 'topic', title: post.topicTitle || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: post.createdAt, lastPostedAt: post.createdAt, tags: [], posters: [] }, post.postNumber)} className="linuxdo-control w-full rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3 text-left disabled:opacity-70"><div className="text-[10px] text-paper-faint">{'@' + post.username + ' · #' + post.postNumber}</div><div className="linuxdo-post-prose mt-2 line-clamp-4 text-[12px] text-paper-muted" dangerouslySetInnerHTML={{ __html: post.cooked }} /></button>)}</div> : null}
      {!loading && active === 'users' ? <div className="mt-4 space-y-2.5">{users.map((user) => <button key={user.id} type="button" onClick={() => onOpenUser(user.username)} className="linuxdo-control flex w-full items-center gap-3 rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3 text-left"><div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-haze bg-paper/5">{avatar(user.avatarTemplate, user.username)}</div><div><div className="text-[12.5px] font-medium text-paper">{user.name || user.username}</div><div className="text-[10px] text-paper-faint">{'@' + user.username}</div></div></button>)}</div> : null}
      {!loading && lastQuery && hasMore ? <button type="button" disabled={loadingMore || query.trim() !== lastQuery} onClick={() => void run(page + 1)} className="linuxdo-control mt-4 w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">{loadingMore ? '加载中…' : '加载更多结果'}</button> : null}
    </div>
  )
}

export { DiscoverView } from './DiscoverView'

async function openLinuxDoNotificationExternal(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url })
  } else {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function NotificationsView({
  session,
  onOpen,
  onOpenUser,
  onUnreadChange,
}: {
  session: LinuxDoSessionSnapshot
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string, tab?: 'badges', badgeId?: number) => void
  onUnreadChange: (count: number) => void
}) {
  const [items, setItems] = useState<LinuxDoNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | undefined>()
  const [totalRows, setTotalRows] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<LinuxDoNotificationFilter>('all')
  const [privateItems, setPrivateItems] = useState<LinuxDoTopicSummary[]>([])
  const [privateLoading, setPrivateLoading] = useState(false)
  const [privateLoadingMore, setPrivateLoadingMore] = useState(false)
  const [privateNextPage, setPrivateNextPage] = useState<number | undefined>()
  const [privateError, setPrivateError] = useState('')
  const [unreadCount, setUnreadCount] = useState(session.currentUser?.allUnreadNotificationsCount ?? session.currentUser?.unreadNotifications ?? 0)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingIds, setMarkingIds] = useState<Set<number>>(() => new Set())
  const [detailItem, setDetailItem] = useState<LinuxDoNotification | null>(null)
  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const notificationLoadingRef = useRef(false)
  const mutationGenerationRef = useRef(0)
  const unreadCountRef = useRef(unreadCount)
  const pendingIdsRef = useRef(new Set<number>())
  const markingAllRef = useRef(false)
  const loadingMoreRef = useRef(false)
  const privateGenerationRef = useRef(0)
  const privateLoadingRef = useRef(false)
  const privateLoadingMoreRef = useRef(false)

  const applyUnreadCount = useCallback((count: number) => {
    const normalized = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0))
    unreadCountRef.current = normalized
    if (mountedRef.current) setUnreadCount(normalized)
    onUnreadChange(normalized)
  }, [onUnreadChange])

  const refreshServerTruth = useCallback(async (mutationGeneration: number, refreshItems: boolean) => {
    const [countResult, listResult] = await Promise.allSettled([
      notificationsApi.unreadCount(),
      refreshItems ? notificationsApi.list() : Promise.resolve(undefined),
    ])
    if (mutationGeneration !== mutationGenerationRef.current) return

    if (countResult.status === 'fulfilled') applyUnreadCount(countResult.value)

    if (mountedRef.current && listResult.status === 'fulfilled' && listResult.value) {
      const result = listResult.value
      setItems((previous) => {
        const serverById = new Map(result.items.map((item) => [item.id, item]))
        const next = previous.map((item) => serverById.get(item.id) ?? item)
        for (const item of result.items) {
          if (!next.some((existing) => existing.id === item.id)) next.push(item)
        }
        return next
      })
      setNextOffset(result.nextOffset)
      setTotalRows(result.totalRows)
    }
  }, [applyUnreadCount])

  const loadPrivateMessages = useCallback(async (page = 0) => {
    const username = session.currentUser?.username
    if (!session.authenticated || !username) return
    if (page === 0) {
      if (privateLoadingRef.current || privateLoadingMoreRef.current) return
      privateLoadingRef.current = true
      setPrivateLoading(true)
    } else {
      if (privateLoadingMoreRef.current || privateLoadingRef.current) return
      privateLoadingMoreRef.current = true
      setPrivateLoadingMore(true)
    }
    const generation = ++privateGenerationRef.current
    setPrivateError('')
    try {
      const result = await notificationsApi.privateMessages(username, page)
      if (!mountedRef.current || generation !== privateGenerationRef.current) return
      setPrivateItems((previous) => page === 0
        ? result.items
        : previous.concat(result.items.filter((item) => !previous.some((existing) => existing.id === item.id))))
      setPrivateNextPage(result.nextPage)
    } catch (nextError) {
      if (mountedRef.current && generation === privateGenerationRef.current) setPrivateError(readableError(nextError))
    } finally {
      if (generation === privateGenerationRef.current) {
        if (page === 0) privateLoadingRef.current = false
        else privateLoadingMoreRef.current = false
        if (mountedRef.current) {
          setPrivateLoading(false)
          setPrivateLoadingMore(false)
        }
      }
    }
  }, [session.authenticated, session.currentUser?.username])

  const loadNotifications = useCallback(async (showSpinner: boolean) => {
    if (!session.authenticated || notificationLoadingRef.current || loadingMoreRef.current) return
    notificationLoadingRef.current = true
    const generation = ++loadGenerationRef.current
    const mutationGeneration = mutationGenerationRef.current
    if (showSpinner) setLoading(true)
    setError('')
    try {
      const [result, count] = await Promise.all([
        notificationsApi.list(),
        notificationsApi.unreadCount().catch(() => undefined),
      ])
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      setItems((previous) => showSpinner ? mergeLinuxDoNotifications([], result.items) : mergeLinuxDoNotifications(previous, result.items))
      setNextOffset(result.nextOffset)
      setTotalRows(result.totalRows)
      if (count !== undefined && mutationGeneration === mutationGenerationRef.current) applyUnreadCount(count)
    } catch (nextError) {
      if (mountedRef.current && generation === loadGenerationRef.current) setError(readableError(nextError))
    } finally {
      if (generation === loadGenerationRef.current) {
        notificationLoadingRef.current = false
        if (mountedRef.current) setLoading(false)
      }
    }
  }, [applyUnreadCount, session.authenticated])

  useEffect(() => {
    if (filter === 'private' && privateItems.length === 0 && !privateLoading && !privateError) {
      void loadPrivateMessages(0)
    }
  }, [filter, loadPrivateMessages, privateError, privateItems.length, privateLoading])

  useEffect(() => {
    mountedRef.current = true
    if (!session.authenticated) {
      setItems([])
      setLoading(false)
      applyUnreadCount(0)
      return () => {
        mountedRef.current = false
        loadGenerationRef.current += 1
      }
    }

    void loadNotifications(true)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadNotifications(false)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      privateGenerationRef.current += 1
      notificationLoadingRef.current = false
      privateLoadingRef.current = false
      privateLoadingMoreRef.current = false
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [applyUnreadCount, loadNotifications, session.authenticated])

  const loadMoreNotifications = useCallback(async () => {
    const offset = nextOffset
    if (offset === undefined || loadingMoreRef.current || notificationLoadingRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const result = await notificationsApi.list(offset)
      if (!mountedRef.current) return
      setItems((previous) => mergeLinuxDoNotifications(previous, result.items))
      setNextOffset(result.nextOffset)
      setTotalRows(result.totalRows)
    } catch (nextError) {
      if (mountedRef.current) setError(readableError(nextError))
    } finally {
      loadingMoreRef.current = false
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [nextOffset])

  const markOneRead = useCallback((item: LinuxDoNotification) => {
    if (item.read || pendingIdsRef.current.has(item.id)) return

    pendingIdsRef.current.add(item.id)
    const mutationGeneration = ++mutationGenerationRef.current
    setItems((previous) => markLinuxDoNotificationRead(previous, item.id))
    applyUnreadCount(unreadCountRef.current - 1)
    setMarkingIds((previous) => {
      const next = new Set(previous)
      next.add(item.id)
      return next
    })

    void notificationsApi.markRead(item.id).then(() => {
      void refreshServerTruth(mutationGeneration, false)
    }).catch((nextError) => {
      if (mountedRef.current) setError('标记通知已读失败：' + readableError(nextError))
      void refreshServerTruth(mutationGeneration, true)
    }).finally(() => {
      pendingIdsRef.current.delete(item.id)
      if (mountedRef.current) {
        setMarkingIds((previous) => {
          const next = new Set(previous)
          next.delete(item.id)
          return next
        })
      }
    })
  }, [applyUnreadCount, refreshServerTruth])

  const markAllRead = useCallback(() => {
    if (markingAllRef.current || unreadCountRef.current === 0) return

    markingAllRef.current = true
    const mutationGeneration = ++mutationGenerationRef.current
    setMarkingAll(true)
    setItems((previous) => markAllLinuxDoNotificationsRead(previous))
    applyUnreadCount(0)

    void notificationsApi.markAllRead().then(() => {
      void refreshServerTruth(mutationGeneration, true)
    }).catch((nextError) => {
      if (mountedRef.current) setError('全部已读失败：' + readableError(nextError))
      void refreshServerTruth(mutationGeneration, true)
    }).finally(() => {
      markingAllRef.current = false
      if (mountedRef.current) setMarkingAll(false)
    })
  }, [applyUnreadCount, refreshServerTruth])

  const openNotification = useCallback((item: LinuxDoNotification) => {
    markOneRead(item)
    const target = resolveLinuxDoNotificationTarget(item, session.currentUser?.username)

    if (target.kind === 'topic') {
      onOpen({
        id: target.topicId,
        slug: target.slug || 'topic',
        title: linuxDoNotificationTitle(item),
        postsCount: 0,
        replyCount: 0,
        views: 0,
        likeCount: 0,
        createdAt: item.createdAt,
        lastPostedAt: item.createdAt,
        tags: [],
        posters: [],
      }, target.postNumber)
      return
    }

    if (target.kind === 'user') {
      onOpenUser(target.username, target.tab, target.badgeId)
      return
    }

    if (target.kind === 'external') {
      void openLinuxDoNotificationExternal(target.url).catch((nextError) => {
        if (mountedRef.current) setError('无法打开通知内容：' + readableError(nextError))
      })
      return
    }

    setDetailItem(item)
  }, [markOneRead, onOpen, onOpenUser, session.currentUser?.username])

  if (!session.authenticated) return <div className="px-6 py-20 text-center text-[13px] text-paper-muted">登录后可查看通知</div>
  const isPrivate = filter === 'private'
  const filteredItems = isPrivate ? [] : items.filter((item) => linuxDoNotificationMatchesFilter(item, filter))

  return (
    <RefreshSurface onRefresh={() => isPrivate ? loadPrivateMessages(0) : loadNotifications(true)} className="page-x pb-4 pt-3">
      <section className="mb-4 rounded-[24px] border border-haze/70 bg-ink-raised p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div><h2 className="text-[20px] font-bold tracking-[-0.03em] text-paper">通知</h2><p className="mt-1 text-[10.5px] text-paper-muted">不错过任何重要互动</p></div>
          <button type="button" aria-label={isPrivate ? '刷新私信' : '刷新通知'} disabled={isPrivate ? privateLoading || privateLoadingMore : loading || loadingMore} onClick={() => void (isPrivate ? loadPrivateMessages(0) : loadNotifications(true))} className="linuxdo-control grid h-10 w-10 place-items-center rounded-full bg-cinnabar/10 text-cinnabar disabled:opacity-40">
            <RotateCw size={18} className={(isPrivate ? privateLoading : loading) ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-5 rounded-2xl bg-ink-deep p-1">
          {([['all', '全部'], ['mentions', '提及'], ['replies', '回复'], ['private', '私信'], ['system', '系统']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={'linuxdo-control min-h-9 rounded-xl px-2 text-[10.5px] font-semibold ' + (filter === key ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted')}>{label}</button>
          ))}
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[10.5px] text-paper-faint">
          {isPrivate
            ? `私信会话 ${privateItems.length}${privateNextPage !== undefined ? '+' : ''}`
            : `未读 ${unreadCount} · 已加载 ${items.length}${totalRows !== undefined ? ` / ${totalRows}` : ''}`}
        </span>
        {!isPrivate ? (
          <button
            type="button"
            disabled={markingAll || unreadCount === 0 || loading}
            onClick={markAllRead}
            className="linuxdo-control rounded-full border border-haze bg-ink-raised px-3 py-1.5 text-[10px] text-paper-muted disabled:opacity-40"
          >
            {markingAll ? '处理中…' : '全部已读'}
          </button>
        ) : (
          <span className="text-[9.5px] text-paper-faint">私信已读状态以会话为准</span>
        )}
      </div>

      {!isPrivate && error ? <button type="button" onClick={() => void loadNotifications(true)} className="mb-3 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{error} · 点击重试</button> : null}
      {isPrivate && privateError ? (
        <button type="button" onClick={() => void loadPrivateMessages(0)} className="mb-3 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">
          私信加载失败：{privateError} · 点击重试
        </button>
      ) : null}

      {isPrivate ? (
        privateLoading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : (
          <div className="space-y-3">
            {privateItems.map((topic) => (
              <TopicCard key={topic.id} topic={topic} onOpen={() => onOpen(topic)} />
            ))}
            {!privateItems.length ? <div className="py-14 text-center text-[11px] text-paper-faint">暂无私信会话</div> : null}
            {privateNextPage !== undefined ? (
              <button
                type="button"
                disabled={privateLoadingMore}
                onClick={() => void loadPrivateMessages(privateNextPage)}
                className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40"
              >
                {privateLoadingMore ? '加载中…' : '加载更早私信'}
              </button>
            ) : null}
          </div>
        )
      ) : loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : (
        <div className="space-y-2.5">
          {filteredItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openNotification(item)}
              className={'linuxdo-control w-full rounded-[18px] border px-4 py-3 text-left ' + (item.read ? 'border-haze/50 bg-ink-raised/30' : 'border-cinnabar/25 bg-cinnabar/[0.055]')}
            >
              <div className="flex items-start gap-3">
                <div className={'mt-1 h-2 w-2 shrink-0 rounded-full ' + (item.read ? 'bg-paper/15' : 'bg-cinnabar')} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-cinnabar-soft">
                    <span>{linuxDoNotificationLabel(item.notificationType)}</span>
                    {markingIds.has(item.id) ? <Loader2 size={10} className="animate-spin text-paper-faint" /> : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12.5px] font-medium text-paper">{linuxDoNotificationTitle(item)}</div>
                  <div className="mt-1 text-[9.5px] text-paper-faint">{ago(item.createdAt)}</div>
                </div>
              </div>
            </button>
          ))}
          {!filteredItems.length ? <div className="py-14 text-center text-[11px] text-paper-faint">当前分类暂无通知</div> : null}
          {nextOffset !== undefined ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => void loadMoreNotifications()}
              className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40"
            >
              {loadingMore ? '加载中…' : '加载更多通知'}
            </button>
          ) : null}
        </div>
      )}

      {detailItem ? (
        <div className="fixed inset-0 z-[90] grid place-items-end bg-black/25 p-3 pb-[max(16px,var(--sab))] sm:place-items-center" role="presentation" onClick={() => setDetailItem(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-label="通知详情"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-[24px] border border-haze/80 bg-ink-raised p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-cinnabar-soft">{linuxDoNotificationLabel(detailItem.notificationType)}</div>
                <h3 className="mt-1 text-[17px] font-bold tracking-[-0.02em] text-paper">{linuxDoNotificationTitle(detailItem)}</h3>
              </div>
              <button type="button" onClick={() => setDetailItem(null)} className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full border border-haze text-paper-muted" aria-label="关闭通知详情"><X size={15} /></button>
            </div>
            <p className="mt-3 text-[11.5px] leading-6 text-paper-muted">{linuxDoNotificationDetail(detailItem)}</p>
            <div className="mt-4 text-[9.5px] text-paper-faint">{ago(detailItem.createdAt)}</div>
          </section>
        </div>
      ) : null}
    </RefreshSurface>
  )
}

export function BookmarksView({ session, onOpenTopic }: { session: LinuxDoSessionSnapshot; onOpenTopic: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<LinuxDoBookmarkService['list']>>['items']>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextUrl, setNextUrl] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<number | undefined>()
  const [editName, setEditName] = useState('')
  const [editReminder, setEditReminder] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<number | undefined>()

  useEffect(() => {
    const username = session.currentUser?.username
    if (!session.authenticated || !username) {
      setLoading(false)
      return
    }
    void bookmarkApi.list(username).then((result) => {
      setItems(result.items)
      setNextUrl(result.nextUrl)
    }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoading(false))
  }, [session.authenticated, session.currentUser?.username])

  if (!session.authenticated) return <div className="px-6 py-20 text-center text-[13px] text-paper-muted">登录后可查看书签</div>
  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-paper-faint" /></div>
  if (error) return <div className="px-6 py-20 text-center text-[12px] text-cinnabar-soft">{error}</div>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto page-x pb-4 pt-4">
      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="rounded-[18px] border border-haze/60 bg-ink-raised/40 px-4 py-3">
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => item.topicId && onOpenTopic({ id: item.topicId, slug: item.topicSlug || 'topic', title: item.topicTitle || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: item.createdAt || '', lastPostedAt: item.createdAt || '', tags: [], posters: [] }, item.postNumber)} className="linuxdo-control min-w-0 flex-1 text-left">
                <div className="line-clamp-2 text-[13px] font-medium text-paper">{item.topicTitle || item.name || '已收藏帖子'}</div>
                <div className="mt-1 text-[10px] text-paper-faint">{item.username ? '@' + item.username + ' · ' : ''}{item.postNumber ? '#' + item.postNumber : ''}{item.name ? ' · ' + item.name : ''}{item.reminderAt ? ' · ' + new Date(item.reminderAt).toLocaleString('zh-CN') : ''}</div>
              </button>
              <button type="button" onClick={() => {
                setEditingId(item.id)
                setEditName(item.name || '')
                if (item.reminderAt) {
                  const date = new Date(item.reminderAt)
                  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                  setEditReminder(local)
                } else setEditReminder('')
              }} className="linuxdo-control shrink-0 rounded-full bg-paper/5 px-2.5 py-1.5 text-[10px] text-paper-muted">编辑</button>
            </div>
            {editingId === item.id ? <div className="mt-3 grid gap-2 rounded-2xl bg-ink/55 p-3 sm:grid-cols-[1fr_1fr_auto]">
              <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="书签备注" className="rounded-xl border border-haze bg-ink px-3 py-2 text-[11px] text-paper outline-none" />
              <input type="datetime-local" value={editReminder} onChange={(event) => setEditReminder(event.target.value)} className="rounded-xl border border-haze bg-ink px-3 py-2 text-[11px] text-paper outline-none" />
              <div className="flex gap-1.5">
                <button type="button" disabled={saving} onClick={async () => {
                  setSaving(true)
                  setError('')
                  try {
                    const reminderAt = editReminder ? new Date(editReminder).toISOString() : ''
                    await bookmarkApi.update(item.id, { name: editName.trim(), reminderAt })
                    setItems((previous) => previous.map((candidate) => candidate.id === item.id ? { ...candidate, name: editName.trim() || undefined, reminderAt: reminderAt || undefined } : candidate))
                    setEditingId(undefined)
                  } catch (nextError) {
                    setError(readableError(nextError))
                  } finally {
                    setSaving(false)
                  }
                }} className="linuxdo-control rounded-full bg-cinnabar px-3 py-2 text-[10px] text-white disabled:opacity-40">保存</button>
                <button type="button" disabled={saving} onClick={() => setEditingId(undefined)} className="linuxdo-control rounded-full border border-haze px-3 py-2 text-[10px] text-paper-muted">取消</button>
                <button type="button" disabled={saving} onClick={() => setDeleteTargetId(item.id)} className="linuxdo-control rounded-full border border-haze px-3 py-2 text-[10px] text-paper-faint disabled:opacity-40">删除</button>
              </div>
            </div> : null}
          </div>
        ))}
        {!items.length ? <div className="py-16 text-center text-[12px] text-paper-faint">暂无书签</div> : null}
        {nextUrl ? <button type="button" disabled={loadingMore} onClick={() => {
          const username = session.currentUser?.username
          if (!username) return
          setLoadingMore(true)
          void bookmarkApi.list(username, nextUrl).then((result) => {
            setItems((previous) => previous.concat(result.items.filter((item) => !previous.some((existing) => existing.id === item.id))))
            setNextUrl(result.nextUrl)
          }).catch((nextError) => setError(readableError(nextError))).finally(() => setLoadingMore(false))
        }} className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[10.5px] text-paper-muted disabled:opacity-40">{loadingMore ? '加载中…' : '加载更多书签'}</button> : null}
      </div>
      <ConfirmDialog
        open={deleteTargetId !== undefined}
        title="删除书签？"
        message="删除后将同步到 Linux.do。"
        confirmLabel={saving ? '删除中…' : '删除'}
        cancelLabel="取消"
        danger
        onCancel={() => { if (!saving) setDeleteTargetId(undefined) }}
        onConfirm={() => {
          const id = deleteTargetId
          if (id === undefined || saving) return
          setSaving(true)
          setError('')
          void bookmarkApi.delete(id).then(() => {
            setItems((previous) => previous.filter((candidate) => candidate.id !== id))
            setEditingId(undefined)
            setDeleteTargetId(undefined)
          }).catch((nextError) => setError(readableError(nextError))).finally(() => setSaving(false))
        }}
      />
    </div>
  )
}
