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

  if (!owner) return <div className="page-x py-20 text-center text-[13px] text-paper-muted">登录后可查看个人私信{onLogin ? <button type="button" onClick={onLogin} className="linuxdo-control mx-auto mt-4 block min-h-11 rounded-full bg-cinnabar px-5 text-white">登录 Linux.do</button> : null}</div>
  return (
    <RefreshSurface onRefresh={() => load()} scrollerRef={scrollerRef} onScroll={(event) => {
      const cached = cacheRef.current.entries[scope]
      if (cached) cached.scrollTop = event.currentTarget.scrollTop
    }} className="page-x pb-4 pt-3">
      {onBack ? <button type="button" onClick={onBack} className="linuxdo-control mb-3 inline-flex min-h-10 items-center gap-1.5 text-[11px] text-paper-muted"><ArrowLeft size={14} />全部通知</button> : null}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div><h2 className="text-[20px] font-bold text-paper">{groupName ? `${groupName} · 私信` : '个人私信'}</h2><p className="mt-1 text-[10.5px] text-paper-faint">{filter === 'recent' ? '最近互动与未读消息' : '会话与阅读状态随账号同步'}</p></div>
        <button type="button" aria-label="刷新私信" disabled={busy !== null} onClick={() => void load()} className="linuxdo-control grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cinnabar/10 text-cinnabar disabled:opacity-40"><RefreshCcw size={17} className={busy === 'refresh' ? 'animate-spin' : ''} /></button>
      </div>
      {groupName ? <button type="button" onClick={() => select('recent', null)} className="linuxdo-control mb-3 text-[11px] text-cinnabar">返回个人私信</button> : null}
      <div role="tablist" aria-label="私信分类" className="scrollbar-none mb-3 flex gap-1 overflow-x-auto border-b border-haze/60 pb-2">
        {filters.filter((item) => !groupName || (item.id !== 'recent' && item.id !== 'sent')).map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => select(item.id)} className={'linuxdo-control min-h-10 shrink-0 rounded-full px-3 text-[11px] font-medium ' + (filter === item.id ? 'bg-cinnabar text-white' : 'text-paper-muted hover:bg-paper/5')}>{item.label}</button>)}
      </div>
      {error != null ? <div role="alert" className="mb-3 rounded-2xl border border-cinnabar/25 bg-cinnabar/[0.06] px-4 py-3 text-[11px] leading-5 text-paper-muted"><p>私信加载失败：{readableError(error)}</p><button type="button" disabled={busy !== null} onClick={() => void load(lastResetRef.current)} className="linuxdo-control mt-2 min-h-9 font-medium text-cinnabar">重试私信</button>{error instanceof LinuxDoApiError && error.kind === 'browser-verification' && onVerify ? <button type="button" onClick={async () => { if (await onVerify()) await load() }} className="linuxdo-control ml-3 min-h-9 font-medium text-cinnabar">打开安全验证</button> : null}{error instanceof LinuxDoApiError && error.kind === 'auth-required' && onLogin ? <button type="button" onClick={onLogin} className="linuxdo-control ml-3 min-h-9 font-medium text-cinnabar">重新登录</button> : null}</div> : null}
      {!entry.loaded && busy ? <div role="status" className="flex items-center justify-center gap-2 py-16 text-[11px] text-paper-faint"><Loader2 size={16} className="animate-spin" />正在加载私信</div> : <div className="divide-y divide-haze/50 rounded-2xl border border-haze/60 bg-ink-raised/40">
        {entry.items.map((item) => <button type="button" key={item.key} aria-label={'打开私信：' + item.title} onClick={() => open(item)} className="linuxdo-control flex min-h-[86px] w-full items-start gap-3 px-3 py-3.5 text-left hover:bg-paper/[0.025]">
          <span className="relative mt-0.5 h-9 w-9 shrink-0 rounded-full bg-paper/5">{avatar(item.avatarTemplate, item.sender)}<Mail size={11} className="absolute -bottom-0.5 -right-0.5 rounded bg-ink-raised text-paper-muted" /></span>
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-[11.5px] font-semibold text-paper">{item.sender}</span><span className="shrink-0 text-[9px] text-paper-faint">{ago(item.createdAt)}</span></span><span className="mt-1 block line-clamp-2 text-[12px] leading-[1.5] text-paper-muted">{item.title}</span></span>
          {item.unread ? <span aria-label="未读私信" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cinnabar" /> : <ChevronRight size={13} className="mt-2 shrink-0 text-paper-faint" />}
        </button>)}
      </div>}
      {entry.loaded && !entry.items.length && error == null ? <div className="py-14 text-center text-[11px] text-paper-faint">{filters.find((item) => item.id === filter)?.empty}</div> : null}
      {entry.nextPage !== undefined ? <button type="button" disabled={busy !== null} onClick={() => void load(false)} className="linuxdo-control mt-3 min-h-11 w-full rounded-full border border-haze text-[11px] text-paper-muted disabled:opacity-40">{busy === 'more' ? '加载中…' : '加载更早私信'}</button> : null}
      {filter === 'recent' && entry.loaded ? <button type="button" onClick={() => select('inbox')} className="linuxdo-control mt-3 min-h-11 w-full rounded-full border border-haze text-[11px] text-paper-muted">查看全部私信<ChevronRight size={13} className="ml-1 inline" /></button> : null}
    </RefreshSurface>
  )
}
