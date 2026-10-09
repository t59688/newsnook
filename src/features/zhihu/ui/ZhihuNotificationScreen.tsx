import { useEffect, useState } from 'react'
import { Browser } from '@capacitor/browser'
import { AtSign, Bell, Bookmark, CheckCheck, CircleHelp, Heart, Loader2, UserPlus } from 'lucide-react'

import { parseZhihuCommentDeepLink, parseZhihuLink, parseZhihuMessagePeerId } from '../content/links'
import type {
  ZhihuNotificationCategory,
  ZhihuNotificationInvitation,
  ZhihuNotificationItem,
  ZhihuNotificationService,
  ZhihuNotificationTimelineEntry,
} from '../notification/service'
import { mergeZhihuNotificationItems } from '../notification/service'
import type { ZhihuEntityRef } from '../types'
import { canExecuteZhihuOperation } from '../protocol'
import { ZhihuEmptyState, ZhihuErrorBanner, ZhihuLoadingState, ZhihuSurface } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  service: ZhihuNotificationService
  onOpen: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  onMessage: (peerId: string) => void
}

const CATEGORIES: Array<{ id: ZhihuNotificationCategory; label: string }> = [
  { id: 'comment', label: '评论转发@' },
  { id: 'like', label: '赞同喜欢' },
  { id: 'favlist_me', label: '收藏了我' },
  { id: 'follow', label: '关注订阅' },
]

function notificationTime(value?: number): string {
  if (!value) return ''
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ZhihuNotificationScreen({ service, onOpen, onMessage }: Props) {
  const readAllWritable = canExecuteZhihuOperation('notification.readall')
  const [activeEntry, setActiveEntry] = useState<ZhihuNotificationTimelineEntry | null>(null)
  const [items, setItems] = useState<ZhihuNotificationItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [unread, setUnread] = useState<Record<ZhihuNotificationCategory, number>>({ comment: 0, like: 0, favlist_me: 0, follow: 0 })
  const [overviewUnread, setOverviewUnread] = useState(0)
  const [invitation, setInvitation] = useState<ZhihuNotificationInvitation | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [marking, setMarking] = useState<ZhihuNotificationCategory | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (activeEntry) {
          const page = await service.timeline(activeEntry, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
          return
        }
        const page = await service.overview(undefined, controller.signal)
        if (controller.signal.aborted) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setUnread(page.unread)
        setOverviewUnread(page.totalUnread)
        setInvitation(page.invitation)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取知乎通知失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [activeEntry, service])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = activeEntry
        ? await service.timeline(activeEntry, nextCursor)
        : await service.overview(nextCursor)
      setItems((prev) => mergeZhihuNotificationItems(prev, page.items))
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多通知失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const markCategory = async (category: ZhihuNotificationCategory) => {
    if (marking) return
    setMarking(category)
    setError(null)
    try {
      await service.markCategoryRead(category)
      const cleared = unread[category]
      setUnread((prev) => ({ ...prev, [category]: 0 }))
      setOverviewUnread((prev) => Math.max(0, prev - cleared))
      if (activeEntry === category) setItems((prev) => prev.map((item) => ({ ...item, unread: false })))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标记已读失败')
    } finally {
      setMarking(null)
    }
  }

  const markAll = async () => {
    if (marking) return
    setMarking('all')
    setError(null)
    try {
      let cleared = 0
      for (const category of CATEGORIES) {
        if (unread[category.id] > 0) {
          cleared += unread[category.id]
          await service.markCategoryRead(category.id)
          setUnread((prev) => ({ ...prev, [category.id]: 0 }))
        }
      }
      setOverviewUnread((prev) => Math.max(0, prev - cleared))
      if (activeEntry !== 'invite') setItems((prev) => prev.map((item) => ({ ...item, unread: false })))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标记全部已读失败')
    } finally {
      setMarking(null)
    }
  }

  const openItem = (item: ZhihuNotificationItem) => {
    const commentTarget = item.targetUrl ? parseZhihuCommentDeepLink(item.targetUrl) : null
    if (commentTarget) {
      onOpen(commentTarget.ref, `zhihu-comment-${commentTarget.commentId}`)
      return
    }
    const peerId = item.targetUrl ? parseZhihuMessagePeerId(item.targetUrl) : null
    if (peerId) {
      onMessage(peerId)
      return
    }
    const ref = item.targetUrl ? parseZhihuLink(item.targetUrl) : null
    if (ref) {
      onOpen(ref)
      return
    }
    if (item.author?.id) {
      onOpen({ kind: 'people', id: item.author.token || item.author.id })
      return
    }
    if (item.targetUrl) {
      try {
        const target = new URL(item.targetUrl, 'https://www.zhihu.com')
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          void Browser.open({ url: target.href }).catch(() => undefined)
        } else {
          setError('这条知乎消息使用了暂未支持的内部链接，已阻止跳转以避免应用卡住。')
        }
      } catch {
        setError('这条知乎消息的跳转地址无效。')
      }
    }
  }

  const categoryIcon = (category: ZhihuNotificationCategory) => {
    switch (category) {
      case 'comment': return <AtSign size={13} />
      case 'like': return <Heart size={13} />
      case 'favlist_me': return <Bookmark size={13} />
      case 'follow': return <UserPlus size={13} />
    }
  }
  const categoryUnread = Object.values(unread).reduce((sum, value) => sum + value, 0)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <div className="mb-3 flex items-center gap-2">
        <div className="scroll-hidden -mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setActiveEntry(null)}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors ${activeEntry == null ? 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/70 bg-ink-raised/35 text-paper-faint hover:bg-paper/5 hover:text-paper-muted'}`}
          >
            <Bell size={13} /><span>全部</span>{overviewUnread > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(overviewUnread)}</span>}
          </button>
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveEntry(category.id)}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[11px] transition-colors ${activeEntry === category.id ? 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/70 bg-ink-raised/35 text-paper-faint hover:bg-paper/5 hover:text-paper-muted'}`}
            >
              {categoryIcon(category.id)}<span>{category.label}</span>{unread[category.id] > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(unread[category.id])}</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!readAllWritable || Boolean(marking) || categoryUnread === 0}
          onClick={() => void markAll()}
          aria-label="全部标记已读"
          title="全部标记已读"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-haze/70 bg-ink-raised/40 text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper-muted disabled:opacity-30"
        >
          {marking === 'all' ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={15} strokeWidth={1.6} />}
        </button>
      </div>

      {activeEntry && activeEntry !== 'invite' && unread[activeEntry] > 0 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            disabled={!readAllWritable || Boolean(marking)}
            onClick={() => void markCategory(activeEntry)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[10px] text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper-muted disabled:opacity-35"
          >
            {marking === activeEntry ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={13} />}
            <span>当前分类已读</span>
          </button>
        </div>
      )}

      {!activeEntry && invitation && (
        <button
          type="button"
          onClick={() => setActiveEntry('invite')}
          className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-haze/70 bg-ink-raised/45 px-4 py-3.5 text-left transition-colors hover:bg-paper/5"
        >
          {invitation.avatarUrl ? (
            <img src={invitation.avatarUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" loading="lazy" />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-paper/5"><CircleHelp size={16} className="text-cinnabar-soft" /></span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-paper">{invitation.title}</span>
              {invitation.unreadCount > 0 && <span className="rounded-full bg-cinnabar/12 px-1.5 py-0.5 font-mono text-[9px] text-cinnabar-soft">{formatZhihuCount(invitation.unreadCount)}</span>}
              <span className="ml-auto shrink-0 font-mono text-[9px] text-paper-faint">{notificationTime(invitation.createdAt)}</span>
            </span>
            {invitation.text && <span className="mt-1 line-clamp-2 block text-[11.5px] leading-[1.6] text-paper-muted">{invitation.text}</span>}
          </span>
        </button>
      )}
      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && items.length === 0 && <ZhihuLoadingState label="正在读取知乎消息…" />}
      {!loading && items.length === 0 && !error && !(activeEntry == null && invitation) && (
        <ZhihuEmptyState icon={activeEntry === 'invite' ? <CircleHelp size={28} /> : <Bell size={28} />} title={activeEntry === 'invite' ? '暂无邀请' : '暂无消息'} />
      )}

      {items.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((item) => (
            <button key={item.id} type="button" onClick={() => openItem(item)} className="flex w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/5">
              {item.avatarUrl || item.author?.avatarUrl ? (
                <img src={item.avatarUrl || item.author?.avatarUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" loading="lazy" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-paper/5"><Bell size={15} className="text-paper-faint" /></span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-paper">{item.title}</span>
                  {item.unread && <span className="size-1.5 shrink-0 rounded-full bg-cinnabar" />}
                  <span className="ml-auto shrink-0 font-mono text-[9px] text-paper-faint">{notificationTime(item.createdAt)}</span>
                </span>
                {item.text && <span className="mt-1 line-clamp-3 block text-[11.5px] leading-[1.65] text-paper-muted">{item.text}</span>}
              </span>
            </button>
          ))}
        </ZhihuSurface>
      )}

      {hasMore && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 font-mono text-[10.5px] text-paper-muted disabled:opacity-45">
          {loadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '加载中…' : '加载更多'}</span>
        </button>
      )}
    </div>
  )
}
