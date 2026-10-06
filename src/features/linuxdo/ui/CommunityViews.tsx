import { NotificationRow } from './NotificationRow'
import { PrivateMessagesView } from './PrivateMessagesView'
import type { LinuxDoPrivateMessagesCache } from './privateMessagesCache'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Loader2, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [nextOffset, setNextOffset] = useState<number | undefined>()
  const [totalRows, setTotalRows] = useState<number | undefined>()
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<LinuxDoNotificationFilter>(initialFilter)
  const selectFilter = (next: LinuxDoNotificationFilter) => { setFilter(next); onFilterChange?.(next) }
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
  if (filter === 'private') return <PrivateMessagesView onError={onPrivateError} onVerify={onVerify} onLogin={onLogin} session={session} onOpen={onOpen} onUnreadChange={onUnreadChange} onBack={() => selectFilter('all')} cacheRef={privateMessagesCacheRef} />
  const filteredItems = items.filter((item) => linuxDoNotificationMatchesFilter(item, filter))

  return (
    <RefreshSurface onRefresh={() => loadNotifications(true)} className="page-x pb-4 pt-3">
      <section className="mb-4 rounded-[24px] border border-haze/70 bg-ink-raised p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div><h2 className="text-[20px] font-bold tracking-[-0.03em] text-paper">通知</h2><p className="mt-1 text-[10.5px] text-paper-muted">不错过任何重要互动</p></div>
          <button type="button" aria-label="刷新通知" disabled={loading || loadingMore} onClick={() => void loadNotifications(true)} className="linuxdo-control grid h-10 w-10 place-items-center rounded-full bg-cinnabar/10 text-cinnabar disabled:opacity-40">
            <RotateCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-5 rounded-2xl bg-ink-deep p-1">
          {([['all', '全部'], ['mentions', '提及'], ['replies', '回复'], ['private', '私信'], ['system', '系统']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => selectFilter(key)} className={'linuxdo-control min-h-11 rounded-xl px-2 text-[12px] font-semibold ' + (filter === key ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted')}>{label}</button>
          ))}
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[10.5px] text-paper-faint">
          {`未读 ${unreadCount} · 已加载 ${items.length}${totalRows !== undefined ? ` / ${totalRows}` : ''}`}
        </span>
        <button
            type="button"
            disabled={markingAll || unreadCount === 0 || loading}
            onClick={markAllRead}
            className="linuxdo-control min-h-11 rounded-full border border-haze bg-ink-raised px-3 py-1.5 text-[12px] text-paper-muted disabled:opacity-40"
          >
            {markingAll ? '处理中…' : '全部已读'}
          </button>
      </div>

      {error ? <button type="button" onClick={() => void loadNotifications(true)} className="mb-3 w-full rounded-xl border border-cinnabar/25 bg-cinnabar/10 px-3 py-2 text-left text-[10.5px] text-cinnabar-soft">{error} · 点击重试</button> : null}
      {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-paper-faint" /></div> : (
        <div className="overflow-hidden rounded-2xl bg-ink-raised/30 divide-y divide-haze/50">
          {filteredItems.map((item) => <NotificationRow key={item.id} item={item} marking={markingIds.has(item.id)} onOpen={() => openNotification(item)} />)}
          {!error && !filteredItems.length ? <div className="py-14 text-center text-[11px] text-paper-faint">当前分类暂无通知</div> : null}
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
