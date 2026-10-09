import { useEffect, useState } from 'react'
import { Loader2, MessageCircle, Send, UserRound } from 'lucide-react'

import type {
  ZhihuMessagePeer,
  ZhihuNotificationService,
  ZhihuPrivateMessage,
} from '../notification/service'
import type { ZhihuMessageDraftStore } from '../notification/draftStore'
import { canExecuteZhihuOperation } from '../protocol'
import { ZhihuErrorBanner, ZhihuLoadingState } from './ZhihuUi'

interface Props {
  peerId: string
  accountId?: string
  service: ZhihuNotificationService
  draftStore: ZhihuMessageDraftStore
}

function messageTime(value?: number): string {
  if (!value) return ''
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ZhihuConversationScreen({ peerId, accountId, service, draftStore }: Props) {
  const sendWritable = canExecuteZhihuOperation('message.send')
  const [peer, setPeer] = useState<ZhihuMessagePeer | null>(null)
  const [items, setItems] = useState<ZhihuPrivateMessage[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [draft, setDraft] = useState('')
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.readPeer(peerId, controller.signal),
      service.conversation(peerId, undefined, controller.signal),
    ]).then(
      ([nextPeer, page]) => {
        if (controller.signal.aborted) return
        setPeer(nextPeer)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取私信失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [peerId, service])

  useEffect(() => {
    let disposed = false
    setDraftHydrated(false)
    if (!accountId) {
      setDraft('')
      setDraftHydrated(true)
      return () => { disposed = true }
    }
    void draftStore.load(accountId, peerId).then(
      (content) => {
        if (disposed) return
        setDraft(content)
        setDraftHydrated(true)
      },
      () => {
        if (disposed) return
        setDraft('')
        setDraftHydrated(true)
      },
    )
    return () => { disposed = true }
  }, [accountId, draftStore, peerId])

  useEffect(() => {
    if (!draftHydrated || !accountId) return
    const timer = window.setTimeout(() => {
      void draftStore.save(accountId, peerId, draft).catch(() => undefined)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [accountId, draft, draftHydrated, draftStore, peerId])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await service.conversation(peerId, nextCursor)
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id))
        return [...prev, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多私信失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const send = async () => {
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError(null)
    try {
      const message = await service.sendMessage(peerId, content)
      setItems((prev) => prev.some((item) => item.id === message.id) ? prev : [message, ...prev])
      if (accountId) await draftStore.clear(accountId, peerId).catch(() => undefined)
      setDraft('')
    } catch (reason) {
      // 非幂等发送永不自动重试；输入必须保留，让用户明确决定是否再次发送。
      setError(reason instanceof Error ? reason.message : '私信发送失败；输入已保留')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-28 pt-4 sm:px-6">
      <header className="mb-4 flex items-center gap-3 border-b border-haze/55 pb-4">
        {peer?.avatarUrl ? (
          <img src={peer.avatarUrl} alt="" className="size-11 rounded-2xl object-cover" />
        ) : (
          <span className="flex size-11 items-center justify-center rounded-2xl border border-haze/70 bg-ink-raised/45"><UserRound size={18} className="text-paper-faint" /></span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[19px] font-medium text-paper">{peer?.name || '私信'}</h1>
          {peer?.headline && <p className="mt-0.5 truncate text-[11px] text-paper-faint">{peer.headline}</p>}
        </div>
        <MessageCircle size={17} strokeWidth={1.5} className="text-paper-faint" />
      </header>

      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && items.length === 0 && <ZhihuLoadingState label="正在读取私信…" />}

      {hasMore && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mb-4 flex min-h-9 items-center justify-center gap-1.5 rounded-lg font-mono text-[10px] text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper-muted disabled:opacity-40">
          {loadingMore && <Loader2 size={12} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '加载中…' : '更早的消息'}</span>
        </button>
      )}

      <div className="space-y-2.5">
        {[...items].reverse().map((message) => {
          const mine = Boolean(accountId && message.sender?.id === accountId)
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 shadow-[var(--shadow-lift)] ${mine ? 'bg-cinnabar/18 text-paper' : 'border border-haze/65 bg-ink-raised/50 text-paper'}`}>
                <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.65]">{message.content}</div>
                <div className={`mt-1 font-mono text-[8.5px] ${mine ? 'text-cinnabar-soft/75' : 'text-paper-faint'}`}>{messageTime(message.createdAt)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="sticky bottom-13 z-10 -mx-1 mt-4 border-t border-haze/55 bg-ink/92 px-1 pb-2 pt-3 backdrop-blur-xl" style={{ paddingBottom: 'calc(var(--sab) + 0.5rem)' }}>
        <div className="flex items-end gap-2 rounded-2xl border border-haze/70 bg-ink-raised/45 p-2.5 focus-within:border-cinnabar/35">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={sending}
            rows={1}
            maxLength={10_000}
            placeholder="发私信…"
            className="min-h-9 max-h-32 min-w-0 flex-1 resize-y bg-transparent px-1 py-2 text-[13px] leading-[1.6] text-paper outline-none placeholder:text-paper-faint/65 disabled:opacity-60"
          />
          <button
            type="button"
            disabled={!sendWritable || sending || !draft.trim()}
            onClick={() => void send()}
            aria-label="发送私信"
            title="发送私信"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-cinnabar/50 bg-cinnabar/12 text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={1.7} />}
          </button>
        </div>
        {!sendWritable && <p className="mt-1.5 px-2 font-mono text-[9.5px] text-paper-faint">当前会话仅保留本机草稿，暂不可发送。</p>}
      </div>
    </div>
  )
}
