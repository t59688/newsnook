import { NotificationRow } from './NotificationRow'
import { PrivateMessagesView } from './PrivateMessagesView'
import type { LinuxDoPrivateMessagesCache } from './privateMessagesCache'
import { advanceLinuxDoNotificationPagination, emptyLinuxDoNotificationPagination } from '../notification/pagination'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Bell, Loader2, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { RefreshSurface } from './RefreshSurface'
import { LinuxDoRequestError } from './VerificationAction'

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
} from '../runtime'
import type {
  LinuxDoNotification,
  LinuxDoSessionSnapshot,
  LinuxDoTopicSummary,
} from '../types'
import { ago, readableError } from './utils'

export { SearchView } from './SearchView'

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
  privateMessagesCacheRef,
  onVerify,
  onLogin,
  initialFilter = 'all',
  onFilterChange,
  onPrivateError,
}: {
  session: LinuxDoSessionSnapshot
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string, tab?: 'badges', badgeId?: number) => void
  onUnreadChange: (count: number) => void
  initialFilter?: LinuxDoNotificationFilter
  onPrivateError?: (message: string) => void
  onFilterChange?: (filter: LinuxDoNotificationFilter) => void
  onVerify?: () => Promise<boolean>
  onLogin?: () => void
  privateMessagesCacheRef?: import('react').MutableRefObject<LinuxDoPrivateMessagesCache>
}) {
  const [items, setItems] = useState<LinuxDoNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pagination, setPagination] = useState(emptyLinuxDoNotificationPagination)
  const [error, setError] = useState('')
  const [apiFailure, setApiFailure] = useState<unknown>(null)
  const [filter, setFilter] = useState<LinuxDoNotificationFilter>(initialFilter)
  const filterRef = useRef(filter)
  const autoScannedFilterRef = useRef<LinuxDoNotificationFilter | null>(null)
  const selectFilter = (next: LinuxDoNotificationFilter) => {
    if (next === filterRef.current) return
    filterRef.current = next
    autoScannedFilterRef.current = null
    setFilter(next)
    onFilterChange?.(next)
  }
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
  const paginationRef = useRef(pagination)

  const applyUnreadCount = useCallback((count: number) => {
    const normalized = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0))
    unreadCountRef.current = normalized
    if (mountedRef.current) setUnreadCount(normalized)
    onUnreadChange(normalized)
  }, [onUnreadChange])

  const applyPagination = useCallback((
    page: { scannedRows: number; nextOffset?: number; totalRows?: number },
    reset = false,
  ) => {
    const next = advanceLinuxDoNotificationPagination(paginationRef.current, page, reset)
    paginationRef.current = next
    if (mountedRef.current) setPagination(next)
  }, [])

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
      applyPagination(result)
    }
  }, [applyPagination, applyUnreadCount])

  const loadNotifications = useCallback(async (showSpinner: boolean) => {
    if (!session.authenticated || notificationLoadingRef.current || loadingMoreRef.current) return
    notificationLoadingRef.current = true
    const generation = ++loadGenerationRef.current
    const mutationGeneration = mutationGenerationRef.current
    if (showSpinner) setLoading(true)
    setError('')
    setApiFailure(null)
    try {
      const [result, count] = await Promise.all([
        notificationsApi.list(),
        notificationsApi.unreadCount().catch(() => undefined),
      ])
      if (!mountedRef.current || generation !== loadGenerationRef.current) return
      setItems((previous) => showSpinner ? mergeLinuxDoNotifications([], result.items) : mergeLinuxDoNotifications(previous, result.items))
      applyPagination(result, showSpinner)
      if (count !== undefined && mutationGeneration === mutationGenerationRef.current) applyUnreadCount(count)
    } catch (nextError) {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setError(readableError(nextError))
        setApiFailure(nextError)
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        notificationLoadingRef.current = false
        if (mountedRef.current) setLoading(false)
      }
    }
  }, [applyPagination, applyUnreadCount, session.authenticated])

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
      notificationLoadingRef.current = false
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [applyUnreadCount, loadNotifications, session.authenticated])

  const loadMoreNotifications = useCallback(async (searchFilter?: LinuxDoNotificationFilter) => {
    if (paginationRef.current.nextOffset === undefined || loadingMoreRef.current || notificationLoadingRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    setError('')
    setApiFailure(null)
    const generation = loadGenerationRef.current
    try {
      // A type might not appear in the most recent page. Search a bounded
      // number of additional pages, stopping early on a match. Never scan
      // the entire account history automatically or issue overlapping calls.
      const maxPages = searchFilter && searchFilter !== 'all' ? 3 : 1
      for (let page = 0; page < maxPages; page++) {
        const offset = paginationRef.current.nextOffset
        if (offset === undefined || (searchFilter && filterRef.current !== searchFilter)) break
        const result = await notificationsApi.list(offset)
        if (!mountedRef.current || generation !== loadGenerationRef.current) return
        setItems((previous) => mergeLinuxDoNotifications(previous, result.items))
        applyPagination(result)
        if (result.items.some((item) => searchFilter && linuxDoNotificationMatchesFilter(item, searchFilter))) break
      }
    } catch (nextError) {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setError(readableError(nextError))
        setApiFailure(nextError)
      }
    } finally {
      loadingMoreRef.current = false
      if (mountedRef.current) setLoadingMore(false)
    }
  }, [applyPagination])

  // An empty *loaded subset* is not proof that there are no mentions/replies.
  // Probe up to three older pages on tab selection; users can continue the
  // search explicitly without incurring hundreds of background API requests.
  useEffect(() => {
    if (!session.authenticated || filter === 'all' || filter === 'private' || loading || loadingMore || error) return
    if (pagination.nextOffset === undefined || items.some((item) => linuxDoNotificationMatchesFilter(item, filter))) return
    if (autoScannedFilterRef.current === filter) return
    autoScannedFilterRef.current = filter
    void loadMoreNotifications(filter)
  }, [error, filter, items, loadMoreNotifications, loading, loadingMore, pagination.nextOffset, session.authenticated])

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
      if (mountedRef.current) { setError('标记通知已读失败：' + readableError(nextError)); setApiFailure(nextError) }
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
      if (mountedRef.current) { setError('全部已读失败：' + readableError(nextError)); setApiFailure(nextError) }
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
  if (filter === 'private') return <PrivateMessagesView onError={onPrivateError} onVerify={onVerify} onLogin={onLogin} session={session} onOpen={onOpen} onUnreadChange={onUnreadChange} onBack={() => selectFilter('all')} cacheRef={privateMessagesCacheRef} />
  const filteredItems = items.filter((item) => linuxDoNotificationMatchesFilter(item, filter))
  const filterLabel = { all: '全部', mentions: '提及', replies: '回复', private: '私信', system: '系统' }[filter]
  const hasOlderNotifications = pagination.nextOffset !== undefined

  return (
    <RefreshSurface onRefresh={() => loadNotifications(true)} className="page-x pb-4 pt-3">
      <section className="mb-4 overflow-hidden rounded-[24px] border border-haze/70 bg-ink-raised p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[20px] font-bold tracking-[-0.03em] text-paper">通知</h2>
                {unreadCount > 0 ? (
                  <span className="linuxdo-count-badge">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] text-paper-muted">不错过任何重要互动</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="刷新通知"
            disabled={loading || loadingMore}
            onClick={() => void loadNotifications(true)}
            className="linuxdo-control grid h-10 w-10 place-items-center rounded-full border border-haze/60 bg-paper/[0.04] text-paper-muted shadow-sm transition-all hover:bg-paper/[0.08] hover:text-cinnabar active:scale-95 disabled:opacity-40"
          >
            <RotateCw size={17} className={loading ? 'animate-spin text-cinnabar' : ''} />
          </button>
        </div>

        <div className="linuxdo-segmented mt-3.5">
          {([['all', '全部'], ['mentions', '提及'], ['replies', '回复'], ['private', '私信'], ['system', '系统']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => selectFilter(key)}
              className={
                'linuxdo-control linuxdo-segment min-h-10 rounded-xl px-2 text-[12.5px] font-semibold transition-all ' +
                (filter === key ? 'is-active bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:text-paper')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <span className="text-[11px] font-medium text-paper-faint">
          {filter === 'all'
            ? `未读 ${unreadCount} · 已检索 ${pagination.scanned}${pagination.totalRows !== undefined ? ` / ${pagination.totalRows}` : ''} 条历史通知`
            : `已找到 ${filteredItems.length} 条${filterLabel} · 已检索 ${pagination.scanned}${pagination.totalRows !== undefined ? ` / ${pagination.totalRows}` : ''} 条`}
        </span>
        <button
          type="button"
          disabled={markingAll || unreadCount === 0 || loading}
          onClick={markAllRead}
          className="linuxdo-control inline-flex min-h-9 items-center gap-1.5 rounded-full border border-haze/70 bg-ink-raised px-3.5 py-1 text-[11.5px] font-medium text-paper-muted shadow-sm transition-all hover:border-paper/20 hover:text-paper active:scale-95 disabled:opacity-40"
        >
          {markingAll ? (
            <>
              <Loader2 size={13} className="animate-spin text-paper-faint" />
              <span>处理中…</span>
            </>
          ) : (
            '全部已读'
          )}
        </button>
      </div>

      {error ? (
        <LinuxDoRequestError error={apiFailure ?? new Error(error)} onVerify={onVerify} onLogin={onLogin} onRetry={() => loadNotifications(true)} busy={loading || loadingMore} />
      ) : null}

      {loading ? (
        <div className="linuxdo-group p-2 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="linuxdo-skeleton h-20 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="linuxdo-group" style={{ '--row-inset': '4.25rem' } as import('react').CSSProperties}>
          {filteredItems.map((item) => (
            <NotificationRow key={item.id} item={item} marking={markingIds.has(item.id)} onOpen={() => openNotification(item)} />
          ))}
          {!error && !filteredItems.length ? (
            <div className="px-5 py-11 text-center" role="status">
              <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-paper/[0.04] text-paper-faint">
                {loadingMore ? <Loader2 size={20} className="animate-spin" /> : <Bell size={20} className="opacity-55" />}
              </div>
              <p className="text-[13px] font-medium text-paper-muted">
                {loadingMore ? `正在查找更早的${filterLabel}…` : hasOlderNotifications ? `已检索记录中暂未找到${filterLabel}` : `暂无${filterLabel}通知`}
              </p>
              <p className="mt-1.5 text-[11px] leading-5 text-paper-faint">
                {hasOlderNotifications
                  ? `已检查最近 ${pagination.scanned} 条记录，可能还有更早的${filterLabel}通知`
                  : '已检查完当前账号可访问的历史通知'}
              </p>
            </div>
          ) : null}
          {hasOlderNotifications ? (
            <div className="p-3">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMoreNotifications(filter)}
                className="linuxdo-control flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/60 bg-paper/[0.025] text-[12px] font-medium text-paper-muted transition-all hover:bg-paper/[0.06] hover:text-paper active:scale-[0.99] disabled:opacity-40"
              >
                {loadingMore ? (
                  <>
                    <Loader2 size={14} className="animate-spin text-paper-faint" />
                    <span>正在检索历史通知…</span>
                  </>
                ) : (
                  filter === 'all' ? '加载更多通知' : `查找更多${filterLabel}`
                )}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {detailItem ? (
        <div
          className="linuxdo-sheet-backdrop fixed inset-0 z-[90] grid place-items-end bg-black/50 p-3 pb-[max(16px,var(--sab))] backdrop-blur-sm sm:place-items-center"
          role="presentation"
          onClick={() => setDetailItem(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="通知详情"
            onClick={(event) => event.stopPropagation()}
            className="linuxdo-sheet w-full max-w-md rounded-[28px] border border-haze/80 bg-ink-raised p-5 shadow-2xl"
          >
            <div className="linuxdo-sheet-grabber mb-3" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex rounded-full bg-cinnabar/10 px-2.5 py-0.5 text-[10px] font-semibold text-cinnabar-soft">
                  {linuxDoNotificationLabel(detailItem.notificationType)}
                </div>
                <h3 className="mt-2 text-[17px] font-bold tracking-[-0.02em] text-paper">{linuxDoNotificationTitle(detailItem)}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full border border-haze/70 bg-paper/[0.04] text-paper-muted transition-colors hover:bg-paper/[0.08] hover:text-paper"
                aria-label="关闭通知详情"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-3.5 text-[12px] leading-relaxed text-paper-muted">{linuxDoNotificationDetail(detailItem)}</p>
            <div className="mt-5 flex items-center justify-between border-t border-haze/40 pt-3 text-[10px] text-paper-faint">
              <span>{ago(detailItem.createdAt)}</span>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                className="linuxdo-control rounded-full bg-paper/[0.05] px-3 py-1 text-[11px] font-medium text-paper-muted hover:text-paper"
              >
                关闭
              </button>
            </div>
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
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-[20px] border border-haze/60 bg-ink-raised/60 p-4 shadow-sm transition-all hover:border-haze">
            <div className="flex items-start gap-3.5">
              <button
                type="button"
                onClick={() =>
                  item.topicId &&
                  onOpenTopic(
                    {
                      id: item.topicId,
                      slug: item.topicSlug || 'topic',
                      title: item.topicTitle || 'Linux.do 主题',
                      postsCount: 0,
                      replyCount: 0,
                      views: 0,
                      likeCount: 0,
                      createdAt: item.createdAt || '',
                      lastPostedAt: item.createdAt || '',
                      tags: [],
                      posters: [],
                    },
                    item.postNumber
                  )
                }
                className="linuxdo-control min-w-0 flex-1 text-left"
              >
                <div className="line-clamp-2 text-[14px] font-semibold leading-snug text-paper hover:text-cinnabar transition-colors">
                  {item.topicTitle || item.name || '已收藏帖子'}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-paper-faint">
                  {item.username ? <span className="font-medium text-paper-muted">@{item.username}</span> : null}
                  {item.postNumber ? <span>#{item.postNumber}</span> : null}
                  {item.name ? <span className="rounded-md bg-paper/[0.04] px-1.5 py-0.5 text-paper-muted">{item.name}</span> : null}
                  {item.reminderAt ? (
                    <span className="text-[#f5b326]">· 提醒：{new Date(item.reminderAt).toLocaleString('zh-CN')}</span>
                  ) : null}
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingId(item.id)
                  setEditName(item.name || '')
                  if (item.reminderAt) {
                    const date = new Date(item.reminderAt)
                    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
                    setEditReminder(local)
                  } else setEditReminder('')
                }}
                className="linuxdo-control shrink-0 rounded-full border border-haze/60 bg-paper/[0.04] px-3 py-1.5 text-[11px] font-medium text-paper-muted transition-colors hover:text-paper"
              >
                编辑
              </button>
            </div>
            {editingId === item.id ? (
              <div className="mt-3.5 grid gap-2.5 rounded-2xl border border-haze/60 bg-ink/75 p-3.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder="书签备注"
                  className="rounded-xl border border-haze bg-ink px-3 py-2 text-[12px] text-paper outline-none focus:border-cinnabar/60"
                />
                <input
                  type="datetime-local"
                  value={editReminder}
                  onChange={(event) => setEditReminder(event.target.value)}
                  className="rounded-xl border border-haze bg-ink px-3 py-2 text-[12px] text-paper outline-none focus:border-cinnabar/60"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true)
                      setError('')
                      try {
                        const reminderAt = editReminder ? new Date(editReminder).toISOString() : ''
                        await bookmarkApi.update(item.id, { name: editName.trim(), reminderAt })
                        setItems((previous) =>
                          previous.map((candidate) =>
                            candidate.id === item.id
                              ? { ...candidate, name: editName.trim() || undefined, reminderAt: reminderAt || undefined }
                              : candidate
                          )
                        )
                        setEditingId(undefined)
                      } catch (nextError) {
                        setError(readableError(nextError))
                      } finally {
                        setSaving(false)
                      }
                    }}
                    className="linuxdo-control rounded-full bg-cinnabar px-3.5 py-2 text-[11px] font-medium text-white shadow-sm disabled:opacity-40"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setEditingId(undefined)}
                    className="linuxdo-control rounded-full border border-haze px-3.5 py-2 text-[11px] text-paper-muted"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setDeleteTargetId(item.id)}
                    className="linuxdo-control rounded-full border border-haze px-3.5 py-2 text-[11px] text-paper-faint hover:text-cinnabar-soft disabled:opacity-40"
                  >
                    删除
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {!items.length ? <div className="py-16 text-center text-[12px] text-paper-faint">暂无书签</div> : null}
        {nextUrl ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => {
              const username = session.currentUser?.username
              if (!username) return
              setLoadingMore(true)
              void bookmarkApi.list(username, nextUrl)
                .then((result) => {
                  setItems((previous) =>
                    previous.concat(result.items.filter((item) => !previous.some((existing) => existing.id === item.id)))
                  )
                  setNextUrl(result.nextUrl)
                })
                .catch((nextError) => setError(readableError(nextError)))
                .finally(() => setLoadingMore(false))
            }}
            className="linuxdo-control w-full rounded-full border border-haze px-4 py-2 text-[11px] text-paper-muted disabled:opacity-40"
          >
            {loadingMore ? '加载中…' : '加载更多书签'}
          </button>
        ) : null}
      </div>
      <ConfirmDialog
        open={deleteTargetId !== undefined}
        title="删除书签？"
        message="删除后将同步到 Linux.do。"
        confirmLabel={saving ? '删除中…' : '删除'}
        cancelLabel="取消"
        danger
        onCancel={() => {
          if (!saving) setDeleteTargetId(undefined)
        }}
        onConfirm={() => {
          const id = deleteTargetId
          if (id === undefined || saving) return
          setSaving(true)
          setError('')
          void bookmarkApi.delete(id)
            .then(() => {
              setItems((previous) => previous.filter((candidate) => candidate.id !== id))
              setEditingId(undefined)
              setDeleteTargetId(undefined)
            })
            .catch((nextError) => setError(readableError(nextError)))
            .finally(() => setSaving(false))
        }}
      />
    </div>
  )
}

