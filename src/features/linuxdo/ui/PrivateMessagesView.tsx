import { createLinuxDoPrivateMessagesCache, markPrivateMessageNotificationRead, type LinuxDoPrivateMessagesCache, type LinuxDoPrivateMessagesEntry as Entry, type LinuxDoPrivateMessagesFilter as Filter } from './privateMessagesCache'
import { ArrowLeft, ChevronRight, Loader2, Mail, RefreshCcw } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { linuxDoNotifications as notificationsApi } from '../runtime'
import { privateMessageTopicItem, type LinuxDoPrivateMessageItem } from '../notification/privateMessages'
import { LinuxDoApiError } from '../types'
import type { LinuxDoSessionSnapshot, LinuxDoTopicSummary } from '../types'
import { RefreshSurface } from './RefreshSurface'
import { ago, avatar, readableError } from './utils'

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
      <div className="page-x py-20 text-center text-[13px] text-paper-muted">
        登录后可查看个人私信
        {onLogin ? (
          <button type="button" onClick={onLogin} className="linuxdo-control mx-auto mt-4 block min-h-11 rounded-full bg-cinnabar px-5 text-[13px] font-medium text-white">
            登录 Linux.do
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-20 shrink-0 border-b border-haze/50 bg-ink/85 supports-[backdrop-filter]:bg-ink/65 page-x pb-2 pt-4 backdrop-blur-2xl">
        {onBack ? (
          <button type="button" onClick={onBack} className="linuxdo-control mb-2.5 inline-flex h-8 items-center gap-1.5 text-[13px] font-medium text-paper-muted">
            <ArrowLeft size={16} />全部通知
          </button>
        ) : null}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[22px] font-bold tracking-tight text-paper">
              {groupName ? `${groupName} · 私信` : '个人私信'}
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-paper-faint">
              {filter === 'recent' ? '最近互动与未读消息' : '会话与阅读状态随账号同步'}
            </p>
          </div>
          <button
            type="button"
            aria-label="刷新私信"
            disabled={busy !== null}
            onClick={() => void load()}
            className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper/[0.05] text-paper-muted disabled:opacity-40"
          >
            <RefreshCcw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} />
          </button>
        </div>
        {groupName ? (
          <button type="button" onClick={() => select('recent', null)} className="linuxdo-control mt-2 text-[13px] font-medium text-cinnabar">
            返回个人私信
          </button>
        ) : null}
        <div role="tablist" aria-label="私信分类" className="scrollbar-none mt-4 -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5">
          {filters.filter((item) => !groupName || (item.id !== 'recent' && item.id !== 'sent')).map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              onClick={() => select(item.id)}
              className={'linuxdo-control h-8 shrink-0 rounded-full px-4 text-[13px] font-medium transition-colors ' + (filter === item.id ? 'bg-ink-raised text-paper shadow-[0_1px_3px_rgba(0,0,0,0.1)] border border-haze/60' : 'text-paper-muted hover:bg-paper/[0.04]')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <RefreshSurface
        onRefresh={() => load()}
        scrollerRef={scrollerRef}
        onScroll={(event) => {
          const cached = cacheRef.current.entries[scope]
          if (cached) cached.scrollTop = event.currentTarget.scrollTop
        }}
        className="page-x pb-6 pt-2"
      >
        {error != null ? (
          <div role="alert" className="mb-3 rounded-2xl border border-cinnabar/25 bg-cinnabar/[0.06] px-4 py-3 text-[12px] leading-5 text-paper-muted">
            <p>私信加载失败：{readableError(error)}</p>
            <button type="button" disabled={busy !== null} onClick={() => void load(lastResetRef.current)} className="linuxdo-control mt-2 min-h-9 font-medium text-cinnabar">
              重试私信
            </button>
            {error instanceof LinuxDoApiError && error.kind === 'browser-verification' && onVerify ? (
              <button type="button" onClick={async () => { if (await onVerify()) await load() }} className="linuxdo-control ml-3 min-h-9 font-medium text-cinnabar">
                打开安全验证
              </button>
            ) : null}
            {error instanceof LinuxDoApiError && error.kind === 'auth-required' && onLogin ? (
              <button type="button" onClick={onLogin} className="linuxdo-control ml-3 min-h-9 font-medium text-cinnabar">
                重新登录
              </button>
            ) : null}
          </div>
        ) : null}

        {!entry.loaded && busy ? (
          <div role="status" className="flex items-center justify-center gap-2 py-16 text-[12px] text-paper-faint">
            <Loader2 size={15} className="animate-spin" />正在加载私信
          </div>
        ) : (
          <div className="divide-y divide-haze/40">
            {entry.items.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-label={'打开私信：' + item.title}
                onClick={() => open(item)}
                className="linuxdo-control flex min-h-[72px] w-full items-center gap-3.5 py-4 text-left active:bg-paper/[0.035]"
              >
                <span className="relative h-12 w-12 shrink-0">
                  <span className="block h-full w-full overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10">
                    {avatar(item.avatarTemplate, item.sender)}
                  </span>
                  <span className="absolute -bottom-1 -right-1 grid h-[20px] w-[20px] place-items-center rounded-full bg-ink text-paper-muted ring-2 ring-ink">
                    <Mail size={11} aria-hidden />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em] text-paper">{item.sender}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-paper-faint">{ago(item.createdAt)}</span>
                  </span>
                  <span className="mt-1 block line-clamp-2 text-[14px] leading-[1.5] text-paper-muted">{item.title}</span>
                </span>
                {item.unread ? (
                  <span aria-label="未读私信" className="ml-1 h-2.5 w-2.5 shrink-0 rounded-full bg-cinnabar" />
                ) : (
                  <ChevronRight size={16} className="ml-1 shrink-0 text-paper-faint/70" aria-hidden />
                )}
              </button>
            ))}
          </div>
        )}

        {entry.loaded && !entry.items.length && error == null ? (
          <div className="py-16 text-center text-[13px] text-paper-faint">{filters.find((item) => item.id === filter)?.empty}</div>
        ) : null}
        {entry.nextPage !== undefined ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void load(false)}
            className="linuxdo-control mt-3 min-h-11 w-full rounded-full bg-paper/[0.045] text-[13px] text-paper-muted disabled:opacity-40"
          >
            {busy === 'more' ? '加载中…' : '加载更早私信'}
          </button>
        ) : null}
        {filter === 'recent' && entry.loaded ? (
          <button
            type="button"
            onClick={() => select('inbox')}
            className="linuxdo-control mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-full text-[13px] font-medium text-paper-muted"
          >
            查看全部私信
            <ChevronRight size={14} aria-hidden />
          </button>
        ) : null}
      </RefreshSurface>
    </div>
  )
}
