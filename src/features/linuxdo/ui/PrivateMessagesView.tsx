import { createLinuxDoPrivateMessagesCache, markPrivateMessageNotificationRead, type LinuxDoPrivateMessagesCache, type LinuxDoPrivateMessagesEntry as Entry, type LinuxDoPrivateMessagesFilter as Filter } from './privateMessagesCache'
import { ArrowLeft, ChevronRight, Loader2, Mail, RefreshCcw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { linuxDoNotifications as notificationsApi } from '../runtime'
import { privateMessageTopicItem, type LinuxDoPrivateMessageItem } from '../notification/privateMessages'
import { LinuxDoApiError } from '../types'
import type { LinuxDoSessionSnapshot, LinuxDoTopicSummary } from '../types'
import { RefreshSurface } from './RefreshSurface'
import { ago, avatar, readableError } from './utils'
import { LinuxDoVerificationAction } from './VerificationAction'

const emptyEntry = (): Entry => ({ items: [], loaded: false, scrollTop: 0 })
const filters: Array<{ id: Filter; label: string; empty: string }> = [
  { id: 'recent', label: '最近', empty: '暂无最近私信' },
  { id: 'inbox', label: '收件箱', empty: '收件箱为空' },
  { id: 'new', label: '新消息', empty: '暂无新私信' },
  { id: 'unread', label: '未读', empty: '没有未读私信' },
  { id: 'sent', label: '已发送', empty: '暂无已发送私信' },
  { id: 'archive', label: '归档', empty: '暂无归档私信' },
]

interface Props {
  session: LinuxDoSessionSnapshot
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onUnreadChange: (count: number) => void
  onBack?: () => void
  onError?: (message: string) => void
  onVerify?: () => Promise<boolean>
  onLogin?: () => void
  cacheRef?: MutableRefObject<LinuxDoPrivateMessagesCache>
}

export function PrivateMessagesView(props: Props) {
  return <PrivateMessagesContent key={`${props.session.authenticated}:${props.session.authMode}:${props.session.currentUser?.id}:${props.session.currentUser?.username}`} {...props} />
}

function PrivateMessagesContent({ session, onOpen, onUnreadChange, onBack, onError, onVerify, onLogin, cacheRef: suppliedCache }: Props) {
  const localCache = useRef(createLinuxDoPrivateMessagesCache())
  const cacheRef = suppliedCache ?? localCache
  const owner = session.authenticated && session.currentUser?.username ? `${session.authMode}:${session.currentUser?.id}:${session.currentUser?.username}` : ''
  if (cacheRef.current.owner !== owner) cacheRef.current = { ...createLinuxDoPrivateMessagesCache(), owner }
  const [filter, setFilter] = useState<Filter>(() => cacheRef.current.filter)
  const [groupName, setGroupName] = useState<string | undefined>(() => cacheRef.current.groupName)
  const scope = `${groupName ?? ''}:${filter}`
  const identity = `${owner}:${scope}`
  const activeIdentity = useRef(identity)
  activeIdentity.current = identity
  const [result, setResult] = useState<{ identity: string; entry: Entry }>(() => ({ identity, entry: cacheRef.current.entries[scope] ?? emptyEntry() }))
  const [busy, setBusy] = useState<'refresh' | 'more' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const requestRef = useRef<{ identity: string; controller: AbortController } | null>(null)
  const mountedRef = useRef(false)
  const lastResetRef = useRef(true)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const entry = result.identity === identity ? result.entry : cacheRef.current.entries[scope] ?? emptyEntry()

  const load = useCallback(async (reset = true) => {
    const username = session.currentUser?.username
    if (!owner || !username || requestRef.current?.identity === identity) return
    const previous = cacheRef.current.entries[scope] ?? emptyEntry()
    if (!reset && previous.nextPage === undefined) return
    requestRef.current?.controller.abort()
    const controller = new AbortController()
    const flight = { identity, controller }
    requestRef.current = flight
    lastResetRef.current = reset
    setBusy(reset ? 'refresh' : 'more')
    setError(null)
    try {
      const page = reset ? 0 : previous.nextPage!
      const response = filter === 'recent'
        ? { items: await notificationsApi.recentPrivateMessages(username, controller.signal), nextPage: undefined }
        : await notificationsApi.privateMessages(username, page, controller.signal, filter, groupName).then((value) => ({ ...value, items: value.items.map(privateMessageTopicItem) }))
      if (controller.signal.aborted || activeIdentity.current !== identity) return
      const items = reset ? response.items : previous.items.concat(response.items.filter((item) => !previous.items.some((old) => old.key === item.key)))
      const next = { ...previous, items, nextPage: response.nextPage, loaded: true }
      cacheRef.current.entries[scope] = next
      setResult({ identity, entry: next })
    } catch (failure) {
      if (!controller.signal.aborted && activeIdentity.current === identity) setError(failure)
    } finally {
      if (requestRef.current === flight) {
        requestRef.current = null
        if (activeIdentity.current === identity) setBusy(null)
      }
    }
  }, [cacheRef, filter, groupName, identity, owner, scope, session.currentUser?.username])

  useEffect(() => {
    mountedRef.current = true
    setError(null)
    setBusy(null)
    if (!cacheRef.current.entries[scope]?.loaded) void load()
    return () => { mountedRef.current = false; requestRef.current?.controller.abort(); requestRef.current = null }
  }, [cacheRef, load, scope])

  useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = cacheRef.current.entries[scope]?.scrollTop ?? 0
  }, [cacheRef, identity, scope])

  const select = (next: Filter, targetGroup: string | null | undefined = groupName) => {
    const group = targetGroup ?? undefined
    if (next === filter && group === groupName) return
    requestRef.current?.controller.abort()
    requestRef.current = null
    activeIdentity.current = `${owner}:${group ?? ''}:${next}`
    cacheRef.current.filter = next
    cacheRef.current.groupName = group
    setFilter(next)
    setGroupName(group)
  }
  const open = (item: LinuxDoPrivateMessageItem) => {
    if (item.notification && !item.notification.read) {
      void notificationsApi.markRead(item.notification.id)
        .then(() => {
          if (cacheRef.current.owner === owner) {
            markPrivateMessageNotificationRead(cacheRef.current, item.notification!.id)
            if (mountedRef.current && activeIdentity.current === identity) setResult({ identity, entry: { ...(cacheRef.current.entries[scope] ?? emptyEntry()) } })
          }
          return notificationsApi.unreadCount()
        })
        .then((count) => { if (cacheRef.current.owner === owner) onUnreadChange(count) })
        .catch((failure) => {
          if (cacheRef.current.owner !== owner) return
          const message = '私信通知已读同步失败：' + readableError(failure)
          if (onError) onError(message)
          else setError(new Error(message))
        })
    }
    if (item.topic) onOpen(item.topic, item.targetPostNumber)
    else if (item.groupName) select('inbox', item.groupName)
    else setError(new Error('这条私信提醒没有可打开的会话，请刷新后重试'))
  }

  if (!owner) {
    return (
      <div className="page-x py-24 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-haze/60 bg-paper/[0.035] text-paper-muted shadow-sm">
          <Mail size={26} className="text-paper-faint" />
        </div>
        <p className="text-[14px] font-semibold text-paper">登录后可查看个人私信</p>
        <p className="mt-1 text-[12px] text-paper-faint">同步你的所有私信、群组讨论与阅读进度</p>
        {onLogin ? (
          <button
            type="button"
            onClick={onLogin}
            className="linuxdo-control mx-auto mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-cinnabar px-6 text-[13px] font-medium text-white shadow-lg transition-transform active:scale-95"
          >
            登录 Linux.do
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="linuxdo-toolbar sticky top-0 z-20 shrink-0 page-x pb-2.5 pt-3.5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="linuxdo-control mb-2.5 inline-flex h-8 items-center gap-1.5 rounded-full border border-haze/60 bg-paper/[0.04] px-3 text-[12px] font-medium text-paper-muted transition-colors hover:text-paper"
          >
            <ArrowLeft size={14} />全部通知
          </button>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[21px] font-bold tracking-tight text-paper">
              {groupName ? `${groupName} · 私信` : '个人私信'}
            </h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-paper-faint">
              {filter === 'recent' ? '最近互动与未读消息' : '会话与阅读状态随账号同步'}
            </p>
          </div>
          <button
            type="button"
            aria-label="刷新私信"
            disabled={busy !== null}
            onClick={() => void load()}
            className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full border border-haze/60 bg-paper/[0.04] text-paper-muted shadow-sm transition-all hover:bg-paper/[0.08] hover:text-cinnabar active:scale-95 disabled:opacity-40"
          >
            <RefreshCcw size={15} className={busy === 'refresh' ? 'animate-spin text-cinnabar' : ''} />
          </button>
        </div>
        {groupName ? (
          <button
            type="button"
            onClick={() => select('recent', null)}
            className="linuxdo-control mt-2 text-[12px] font-medium text-cinnabar hover:underline"
          >
            返回个人私信
          </button>
        ) : null}
        <div role="tablist" aria-label="私信分类" className="scrollbar-none mt-3.5 -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-1">
          {filters.filter((item) => !groupName || (item.id !== 'recent' && item.id !== 'sent')).map((item) => {
            const selected = filter === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => select(item.id)}
                className={
                  'linuxdo-control linuxdo-chip min-h-8 shrink-0 rounded-full px-3.5 text-[12.5px] font-medium transition-all ' +
                  (selected
                    ? 'is-active bg-paper text-ink font-semibold shadow-sm'
                    : 'border-haze/70 bg-paper/[0.035] text-paper-muted hover:bg-paper/[0.07] hover:text-paper')
                }
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <RefreshSurface
        onRefresh={() => load()}
        scrollerRef={scrollerRef}
        onScroll={(event) => {
          const cached = cacheRef.current.entries[scope]
          if (cached) cached.scrollTop = event.currentTarget.scrollTop
        }}
        className="page-x pb-6 pt-3"
      >
        {error != null ? (
          <div role="alert" className="mb-3.5 rounded-2xl border border-cinnabar/25 bg-cinnabar/[0.07] px-4 py-3 text-[12px] leading-relaxed text-paper-muted shadow-sm">
            <p className="font-medium text-cinnabar-soft">私信加载失败：{readableError(error)}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void load(lastResetRef.current)}
                className="linuxdo-control inline-flex min-h-8 items-center rounded-full bg-cinnabar px-3.5 text-[12px] font-medium text-white shadow-sm transition-transform active:scale-95"
              >
                重试私信
              </button>
              {error instanceof LinuxDoApiError && error.kind === 'browser-verification' && onVerify ? (
                <LinuxDoVerificationAction onVerify={onVerify} onRetry={() => load(lastResetRef.current)} busy={busy !== null} />
              ) : null}
              {error instanceof LinuxDoApiError && error.kind === 'auth-required' && onLogin ? (
                <button
                  type="button"
                  onClick={onLogin}
                  className="linuxdo-control inline-flex min-h-8 items-center rounded-full border border-cinnabar/30 bg-cinnabar/10 px-3.5 text-[12px] font-medium text-cinnabar-soft"
                >
                  重新登录
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!entry.loaded && busy ? (
          <div className="linuxdo-group p-2 space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="linuxdo-skeleton h-[72px] rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="linuxdo-group" style={{ '--row-inset': '4.5rem' } as import('react').CSSProperties}>
            {entry.items.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-label={'打开私信：' + item.title}
                onClick={() => open(item)}
                className={
                  'linuxdo-control linuxdo-row group flex min-h-[72px] w-full items-center gap-3.5 px-3.5 py-3.5 text-left transition-colors ' +
                  (item.unread ? 'is-unread bg-cinnabar/[0.035] hover:bg-cinnabar/[0.06]' : 'hover:bg-paper/[0.03] active:bg-paper/[0.06]')
                }
              >
                <span className="relative h-11 w-11 shrink-0">
                  <span className="block h-full w-full overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
                    {avatar(item.avatarTemplate, item.sender)}
                  </span>
                  <span className="linuxdo-type-badge absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-raised text-paper-muted ring-2 ring-ink-raised shadow-sm">
                    <Mail size={10} aria-hidden />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-paper group-hover:text-cinnabar transition-colors">
                      {item.sender}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-paper-faint">{ago(item.createdAt)}</span>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-[13.5px] leading-snug font-normal text-paper-muted">
                    {item.title}
                  </span>
                </span>
                {item.unread ? (
                  <span aria-label="未读私信" className="ml-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-cinnabar ring-4 ring-cinnabar/20 shadow-sm" />
                ) : (
                  <ChevronRight size={16} className="ml-1.5 shrink-0 text-paper-faint/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
                )}
              </button>
            ))}
          </div>
        )}

        {entry.loaded && !entry.items.length && error == null ? (
          <div className="py-20 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-paper/[0.04] text-paper-faint">
              <Mail size={22} className="opacity-40" />
            </div>
            <p className="text-[13px] font-medium text-paper-muted">{filters.find((item) => item.id === filter)?.empty}</p>
            <p className="mt-1 text-[11px] text-paper-faint">与社区朋友交流的私密对话会收录在这里</p>
          </div>
        ) : null}

        {entry.nextPage !== undefined ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void load(false)}
            className="linuxdo-control mt-3.5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/60 bg-paper/[0.025] text-[12.5px] font-medium text-paper-muted shadow-sm transition-all hover:bg-paper/[0.06] hover:text-paper active:scale-[0.99] disabled:opacity-40"
          >
            {busy === 'more' ? (
              <>
                <Loader2 size={14} className="animate-spin text-paper-faint" />
                <span>加载中…</span>
              </>
            ) : (
              '加载更早私信'
            )}
          </button>
        ) : null}

        {filter === 'recent' && entry.loaded ? (
          <button
            type="button"
            onClick={() => select('inbox')}
            className="linuxdo-control mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-haze/40 bg-transparent text-[12.5px] font-medium text-paper-muted transition-colors hover:bg-paper/[0.03] hover:text-paper"
          >
            查看全部私信
            <ChevronRight size={14} aria-hidden />
          </button>
        ) : null}
      </RefreshSurface>
    </div>
  )
}
