import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Heart, ImageOff, Loader2, MessageCircle, Reply, Send, Trash2 } from 'lucide-react'

import { resolvePlayableImageSrc, revokeBlobUrl } from '../../proxy/hydrateImages'
import {
  type ZhihuCommentSort,
  type ZhihuCommentTarget,
  type ZhihuCommentsService,
  zhihuCommentDraftRef,
  zhihuCommentTargetKey,
} from '../comments/service'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentMedia, ZhihuCommentNode } from '../comments/types'
import type { ZhihuEntityRef } from '../types'
import { canExecuteZhihuOperation } from '../protocol'
import { ZhihuAuthorAvatar, ZhihuEmptyState, ZhihuErrorBanner, ZhihuSectionHeader } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  target: ZhihuCommentTarget
  service: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  restoreAnchor?: string
  authenticated: boolean
  accountId?: string
  draftStore: ZhihuCommentDraftStore
  onOpenImage?: (src: string, alt: string) => void
  variant?: 'inline' | 'dialog'
}

function formatCommentTime(createdAt?: number): string {
  if (!createdAt) return ''
  const timestamp = createdAt < 10_000_000_000 ? createdAt * 1000 : createdAt
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const diff = Math.max(0, now.getTime() - date.getTime())
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function CommentMedia({
  media,
  onOpen,
}: {
  media: ZhihuCommentMedia
  onOpen?: (src: string, alt: string) => void
}) {
  const [src, setSrc] = useState(media.url)
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'error'>('loading')
  const fallbackTried = useRef(false)
  const ownedBlob = useRef<string | null>(null)
  const disposed = useRef(false)

  useEffect(() => {
    disposed.current = false
    fallbackTried.current = false
    setSrc(media.url)
    setPhase('loading')
    return () => {
      disposed.current = true
      revokeBlobUrl(ownedBlob.current)
      ownedBlob.current = null
    }
  }, [media.url])

  const recover = () => {
    if (fallbackTried.current) {
      setPhase('error')
      return
    }
    fallbackTried.current = true
    setPhase('loading')
    void resolvePlayableImageSrc(media.url, {
      forceNative: true,
      referer: 'https://www.zhihu.com/',
    }).then((resolved) => {
      if (disposed.current) {
        revokeBlobUrl(resolved)
        return
      }
      if (resolved === media.url) {
        setPhase('error')
        return
      }
      revokeBlobUrl(ownedBlob.current)
      ownedBlob.current = resolved.startsWith('blob:') ? resolved : null
      setSrc(resolved)
    }, () => {
      if (!disposed.current) setPhase('error')
    })
  }

  const retry = () => {
    fallbackTried.current = false
    setSrc(media.url)
    setPhase('loading')
  }

  const sticker = media.kind === 'sticker'
  return (
    <span
      className={`relative inline-flex max-w-full overflow-hidden ${
        sticker
          ? 'min-h-20 min-w-20 rounded-xl bg-transparent'
          : 'min-h-24 min-w-32 rounded-xl border border-haze/70 bg-ink-deep/35 shadow-2xs'
      }`}
    >
      {phase === 'loading' && (
        <span className={`ink-shimmer block ${sticker ? 'size-20' : 'h-28 w-44 max-w-full'}`} aria-hidden />
      )}
      {phase === 'error' ? (
        <button
          type="button"
          onClick={retry}
          className="flex min-h-24 min-w-32 max-w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-haze px-3 py-2 text-center text-paper-faint transition-colors hover:border-cinnabar/35 hover:text-paper-muted active:scale-[0.98]"
          aria-label="图片加载失败，点击重试"
        >
          <ImageOff size={16} strokeWidth={1.5} />
          <span className="font-mono text-[9.5px]">加载失败 · 点按重试</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={phase !== 'loaded' || !onOpen}
          onClick={() => onOpen?.(src, media.alt)}
          className={`relative max-w-full overflow-hidden text-left ${onOpen ? 'cursor-zoom-in' : ''} disabled:cursor-default`}
          aria-label={onOpen ? `查看${media.alt}` : undefined}
        >
          <img
            src={src}
            alt={media.alt}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setPhase('loaded')}
            onError={recover}
            className={`${
              sticker
                ? 'max-h-28 max-w-28 object-contain'
                : 'max-h-56 w-auto max-w-full object-contain'
            } ${phase === 'loaded' ? 'opacity-100' : 'absolute inset-0 opacity-0'} transition-opacity duration-200`}
          />
          {phase === 'loaded' && media.kind === 'gif' && (
            <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.08em] text-white/85 backdrop-blur-sm">
              GIF
            </span>
          )}
        </button>
      )}
    </span>
  )
}

function mergeComments(current: ZhihuCommentNode[], incoming: ZhihuCommentNode[]): ZhihuCommentNode[] {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function commentIdFromAnchor(anchor?: string): string | undefined {
  return /^zhihu-comment-(\d+)$/.exec(anchor ?? '')?.[1]
}

function containsComment(items: readonly ZhihuCommentNode[], commentId: string): boolean {
  for (const item of items) {
    if (item.id === commentId || containsComment(item.children, commentId)) return true
  }
  return false
}

function useCommentDraft(
  store: ZhihuCommentDraftStore,
  accountId: string | undefined,
  target: ZhihuCommentTarget,
  replyToCommentId?: string,
) {
  const targetKey = zhihuCommentTargetKey(target)
  const stableRef = useMemo<ZhihuEntityRef>(
    () => zhihuCommentDraftRef(target),
    // targetKey captures every identity field relevant to draft isolation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey],
  )
  const [value, setValue] = useState('')
  const [ready, setReady] = useState(false)
  const latest = useRef({ value: '', ready: false })
  latest.current = { value, ready }

  useEffect(() => {
    let disposed = false
    setValue('')
    setReady(false)
    if (!accountId) return () => { disposed = true }
    void store.load(accountId, stableRef, replyToCommentId).then(
      (content) => {
        if (disposed) return
        setValue(content)
        setReady(true)
      },
      () => {
        if (!disposed) setReady(true)
      },
    )
    return () => { disposed = true }
  }, [accountId, replyToCommentId, stableRef, store])

  useEffect(() => {
    if (!accountId || !ready) return
    const timer = window.setTimeout(() => {
      void store.save(accountId, stableRef, replyToCommentId, value).catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [accountId, ready, replyToCommentId, stableRef, store, value])

  useEffect(() => () => {
    if (!accountId || !latest.current.ready) return
    void store.save(accountId, stableRef, replyToCommentId, latest.current.value).catch(() => undefined)
  }, [accountId, replyToCommentId, stableRef, store])

  const clear = async () => {
    setValue('')
    if (accountId) await store.clear(accountId, stableRef, replyToCommentId)
  }
  return { value, setValue, clear, ready }
}

function CommentItem({
  comment,
  service,
  onNavigate,
  authenticated,
  accountId,
  draftStore,
  rootTarget,
  onDeleted,
  onOpenImage,
  depth = 0,
}: {
  comment: ZhihuCommentNode
  service: ZhihuCommentsService
  onNavigate: Props['onNavigate']
  authenticated: boolean
  accountId?: string
  draftStore: ZhihuCommentDraftStore
  rootTarget: ZhihuCommentTarget
  onDeleted: (commentId: string) => void
  onOpenImage?: Props['onOpenImage']
  depth?: number
}) {
  const likeWritable = canExecuteZhihuOperation(comment.liked ? 'comment.like.clear' : 'comment.like.set')
  const replyWritable = canExecuteZhihuOperation(rootTarget.kind === 'segment' ? 'segment.comment.create' : 'comment.create')
  const deleteWritable = canExecuteZhihuOperation('comment.delete')
  const cached = service.cachedChildren(comment.id)
  const initialChildren = cached?.items ?? comment.children
  const [children, setChildren] = useState(initialChildren)
  const [nextCursor, setNextCursor] = useState<string | undefined>(cached?.nextCursor)
  const [expanded, setExpanded] = useState(initialChildren.length > 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liked, setLiked] = useState(comment.liked)
  const [likeCount, setLikeCount] = useState(comment.likeCount)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [replying, setReplying] = useState(false)
  const replyDraft = useCommentDraft(draftStore, accountId, rootTarget, comment.id)

  useEffect(() => {
    setLiked(comment.liked)
    setLikeCount(comment.likeCount)
  }, [comment.id, comment.likeCount, comment.liked])

  const loadChildren = () => {
    if (loading) return
    setLoading(true)
    setError(null)
    void service.listChildren(comment.id, nextCursor).then(
      (page) => {
        setChildren((prev) => mergeComments(prev, page.items))
        setNextCursor(page.hasMore ? page.nextCursor : undefined)
        setExpanded(true)
        setLoading(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '读取回复失败')
        setLoading(false)
      },
    )
  }

  const toggleLike = async () => {
    if (!authenticated || mutationBusy) return
    const target = !liked
    setMutationBusy(true)
    setError(null)
    try {
      await service.setLiked(comment.id, target)
      setLiked(target)
      setLikeCount((count) => Math.max(0, count + (target ? 1 : -1)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论点赞失败')
    } finally {
      setMutationBusy(false)
    }
  }

  const submitReply = async () => {
    if (!authenticated || mutationBusy || !replyDraft.value.trim()) return
    setMutationBusy(true)
    setError(null)
    try {
      const created = await service.create(rootTarget, replyDraft.value, comment.id)
      setChildren((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setExpanded(true)
      await replyDraft.clear()
      setReplying(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '回复发送失败')
    } finally {
      setMutationBusy(false)
    }
  }

  const remove = async () => {
    if (!authenticated || !comment.canDelete || mutationBusy) return
    setMutationBusy(true)
    setError(null)
    try {
      await service.delete(comment.id)
      onDeleted(comment.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论删除失败')
      setMutationBusy(false)
    }
  }

  const createdTime = formatCommentTime(comment.createdAt)

  return (
    <article
      id={`zhihu-comment-${comment.id}`}
      className={`scroll-mt-20 ${
        depth === 0
          ? 'border-b border-haze/45 py-3 first:pt-1 last:border-b-0'
          : 'py-2'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onNavigate(
            { kind: 'people', id: comment.author.token ?? comment.author.id },
            `zhihu-comment-${comment.id}`,
          )}
          className={`flex shrink-0 items-center justify-center rounded-full transition-[transform,box-shadow] hover:scale-[1.03] hover:shadow-[0_5px_14px_-7px_rgba(0,0,0,0.55)] active:scale-[0.96] ${
            depth === 0 ? 'size-8' : 'size-7'
          }`}
          aria-label={`查看 ${comment.author.name} 的主页`}
        >
          <ZhihuAuthorAvatar author={comment.author} className={depth === 0 ? 'size-8' : 'size-7'} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 leading-none">
            <button
              type="button"
              onClick={() => onNavigate(
                { kind: 'people', id: comment.author.token ?? comment.author.id },
                `zhihu-comment-${comment.id}`,
              )}
              className="min-w-0 truncate text-left text-[13px] font-medium text-paper transition-colors hover:text-cinnabar-soft"
            >
              {comment.author.name}
            </button>
            {comment.replyToAuthor && (
              <>
                <span className="shrink-0 text-[10px] text-paper-faint/70">回复</span>
                <span className="min-w-0 truncate text-[11px] text-paper-muted">{comment.replyToAuthor.name}</span>
              </>
            )}
          </div>

          {comment.contentHtml && (
            <div
              className="zhihu-comment-body mt-1.5 text-[13.5px] leading-[1.55] text-paper-muted"
              dangerouslySetInnerHTML={{ __html: comment.contentHtml }}
            />
          )}

          {comment.media.length > 0 && (
            <div className="mt-2 flex max-w-full flex-wrap items-start gap-2">
              {comment.media.map((media, index) => (
                <CommentMedia
                  key={`${media.kind}:${media.url}:${index}`}
                  media={media}
                  onOpen={onOpenImage}
                />
              ))}
            </div>
          )}

          <div className="mt-1.5 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[9.5px] tracking-[0.02em] text-paper-faint/85">
              {createdTime && <span>{createdTime}</span>}
              {createdTime && comment.ipLocation && <span aria-hidden className="text-paper-faint/45">·</span>}
              {comment.ipLocation && <span className="truncate">IP属地 {comment.ipLocation}</span>}
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                disabled={!authenticated || mutationBusy || !replyWritable}
                onClick={() => setReplying((value) => !value)}
                title={!authenticated ? '登录后可回复' : '回复'}
                aria-label="回复"
                className={`inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition-colors disabled:opacity-35 ${
                  replying ? 'bg-sky-500/12 text-sky-500' : 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'
                }`}
              >
                <Reply size={12} strokeWidth={1.8} />
                <span>回复</span>
              </button>
              <button
                type="button"
                disabled={!authenticated || mutationBusy || !likeWritable}
                onClick={() => void toggleLike()}
                title={!authenticated ? '登录后可点赞' : liked ? '取消点赞' : '点赞'}
                aria-label={liked ? '取消点赞' : '点赞'}
                className={`inline-flex min-h-7 items-center gap-1 rounded-lg px-2 font-mono text-[11px] transition-colors disabled:opacity-35 ${
                  liked ? 'bg-sky-500/12 font-semibold text-sky-500' : 'text-paper-faint hover:bg-paper/5 hover:text-paper-muted'
                }`}
              >
                <Heart size={12} strokeWidth={1.8} fill={liked ? 'currentColor' : 'none'} />
                {likeCount > 0 && <span>{formatZhihuCount(likeCount)}</span>}
              </button>
              {comment.canDelete && (
                <button
                  type="button"
                  disabled={!authenticated || mutationBusy || !deleteWritable}
                  onClick={() => void remove()}
                  title="删除评论"
                  aria-label="删除评论"
                  className="flex size-7 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-cinnabar-soft disabled:opacity-35"
                >
                  <Trash2 size={12.5} strokeWidth={1.6} />
                </button>
              )}
            </div>
          </div>

          {replying && (
            <div className="mt-2.5 rounded-2xl border border-haze/60 bg-ink-raised/50 p-2.5 shadow-2xs">
              <textarea
                value={replyDraft.value}
                onChange={(event) => replyDraft.setValue(event.target.value)}
                rows={2}
                maxLength={5000}
                placeholder={`回复 @${comment.author.name}…`}
                className="min-h-14 w-full resize-y bg-transparent text-[13px] leading-[1.6] text-paper outline-none placeholder:text-paper-faint/65"
              />
              <div className="mt-1 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReplying(false)}
                  className="rounded-full px-3 py-1 text-[11px] text-paper-faint hover:bg-paper/5 hover:text-paper"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={mutationBusy || !replyDraft.ready || !replyDraft.value.trim()}
                  onClick={() => void submitReply()}
                  className="flex h-7.5 items-center gap-1 rounded-full bg-[#0066FF] px-3.5 text-[11.5px] font-medium text-white transition-colors hover:bg-[#005ce6] active:scale-95 disabled:opacity-35"
                >
                  {mutationBusy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2} />}
                  <span>回复</span>
                </button>
              </div>
            </div>
          )}

          {comment.childCount > 0 && (
            <div className="mt-1.5">
              {!expanded || children.length < comment.childCount || nextCursor ? (
                <button
                  type="button"
                  onClick={loadChildren}
                  disabled={loading}
                  className="inline-flex min-h-6.5 items-center gap-1 rounded-lg bg-ink-raised/40 px-2 text-[11px] font-medium text-sky-500 transition-colors hover:bg-sky-500/10 disabled:opacity-45"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} strokeWidth={2} />}
                  <span>{loading ? '正在读取' : expanded ? '更多回复' : `展开 ${comment.childCount} 条回复`}</span>
                </button>
              ) : null}
              {error && <div className="mt-1"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
              {expanded && children.length > 0 && (
                <div className="mt-2 space-y-1.5 rounded-2xl border border-haze/40 bg-ink-raised/20 p-2 sm:p-2.5">
                  {children.map((child) => (
                    <CommentItem
                      key={child.id}
                      comment={child}
                      service={service}
                      onNavigate={onNavigate}
                      authenticated={authenticated}
                      accountId={accountId}
                      draftStore={draftStore}
                      rootTarget={rootTarget}
                      onDeleted={(id) => setChildren((prev) => prev.filter((item) => item.id !== id))}
                      onOpenImage={onOpenImage}
                      depth={depth + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export function ZhihuCommentsSection({ target, service, onNavigate, restoreAnchor, authenticated, accountId, draftStore, onOpenImage, variant = 'inline' }: Props) {
  const [sort, setSort] = useState<ZhihuCommentSort>('score')
  const targetKey = zhihuCommentTargetKey(target)
  const stableTarget = useMemo<ZhihuCommentTarget>(
    () => target,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey],
  )
  const initialCache = service.cachedRoot(stableTarget, 'score')
  const [items, setItems] = useState<ZhihuCommentNode[]>(initialCache?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialCache?.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(Boolean(initialCache))
  const [error, setError] = useState<string | null>(null)
  const rootDraft = useCommentDraft(draftStore, accountId, stableTarget)
  const [sending, setSending] = useState(false)
  const commentWritable = canExecuteZhihuOperation(stableTarget.kind === 'segment' ? 'segment.comment.create' : 'comment.create')
  const sectionTitle = stableTarget.kind === 'segment' ? '段评' : '评论'

  // 每个“内容 + 排序”只维护一个可取消请求。通知 deep link 额外携带 anchor_comment_id 时，
  // 根评论列表接口并不会保证返回该评论，所以并行读取评论详情并把对应根评论置顶。
  // 这样点击“评论转发@”不会把 zhihu:// 自定义 scheme 交给 Browser，也不会卡在无法定位的状态。
  useEffect(() => {
    const cached = service.cachedRoot(stableTarget, sort)
    const anchorCommentId = commentIdFromAnchor(restoreAnchor)
    const cachedHasAnchor = anchorCommentId
      ? containsComment(cached?.items ?? [], anchorCommentId)
      : true

    setItems(cached?.items ?? [])
    setNextCursor(cached?.nextCursor)
    setError(null)
    if (cached && cachedHasAnchor) {
      setLoadedOnce(true)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoadedOnce(Boolean(cached))
    setLoading(true)
    void (async () => {
      const rootPromise = cached
        ? Promise.resolve(cached)
        : service.listRoot(stableTarget, undefined, controller.signal, sort)
      const anchorPromise = anchorCommentId && !cachedHasAnchor
        ? service.resolveCommentAnchor(anchorCommentId, controller.signal)
        : Promise.resolve(undefined)

      const [rootResult, anchorResult] = await Promise.allSettled([rootPromise, anchorPromise])
      if (controller.signal.aborted) return

      const page = rootResult.status === 'fulfilled' ? rootResult.value : cached
      const anchored = anchorResult.status === 'fulfilled' ? anchorResult.value : undefined
      let nextItems = page?.items ?? []
      if (anchored) nextItems = mergeComments([anchored.root], nextItems)

      setItems(nextItems)
      setNextCursor(page?.hasMore ? page.nextCursor : undefined)
      setLoadedOnce(true)
      setLoading(false)

      if (rootResult.status === 'rejected' && !anchored) {
        setError(rootResult.reason instanceof Error ? rootResult.reason.message : '评论读取失败')
      } else if (anchorResult.status === 'rejected') {
        setError('已打开评论区，但未能定位这条评论；可稍后重试。')
      }
    })()
    return () => controller.abort()
  }, [restoreAnchor, service, sort, stableTarget])

  useEffect(() => {
    if (!restoreAnchor || items.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(restoreAnchor)?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [items, restoreAnchor])

  const loadMore = async () => {
    if (loading || !nextCursor) return
    setLoading(true)
    setError(null)
    try {
      const page = await service.listRoot(stableTarget, nextCursor, undefined, sort)
      setItems((prev) => mergeComments(prev, page.items))
      setNextCursor(page.hasMore ? page.nextCursor : undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论读取失败')
    } finally {
      setLoading(false)
    }
  }

  const submitRoot = async () => {
    if (!authenticated || sending || !rootDraft.value.trim()) return
    setSending(true)
    setError(null)
    try {
      const created = await service.create(stableTarget, rootDraft.value)
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setLoadedOnce(true)
      await rootDraft.clear()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '评论发送失败')
    } finally {
      setSending(false)
    }
  }

  const sortControl = (
    <div className="inline-flex items-center rounded-full bg-ink-raised/55 p-0.5" aria-label="评论排序">
      <button
        type="button"
        disabled={loading}
        onClick={() => setSort('score')}
        aria-pressed={sort === 'score'}
        className={`min-h-8 rounded-full px-3 text-[11px] font-medium transition-colors disabled:opacity-40 ${sort === 'score' ? 'bg-paper/8 text-paper' : 'text-paper-faint hover:text-paper-muted'}`}
      >
        热度
      </button>
      <button
        type="button"
        disabled={loading}
        onClick={() => setSort('time')}
        aria-pressed={sort === 'time'}
        className={`min-h-8 rounded-full px-3 text-[11px] font-medium transition-colors disabled:opacity-40 ${sort === 'time' ? 'bg-paper/8 text-paper' : 'text-paper-faint hover:text-paper-muted'}`}
      >
        最新
      </button>
    </div>
  )

  const composer = authenticated && commentWritable ? (
    <div className={`flex items-end gap-2.5 rounded-2xl border border-haze/55 bg-ink-raised/50 shadow-[var(--shadow-lift)] transition-[border-color,background-color] focus-within:border-sky-500/50 focus-within:bg-ink-raised/80 ${variant === 'dialog' ? 'p-2.5' : 'p-3'}`}>
      <textarea
        value={rootDraft.value}
        onChange={(event) => rootDraft.setValue(event.target.value)}
        rows={variant === 'dialog' ? 1 : 2}
        maxLength={5000}
        placeholder={stableTarget.kind === 'segment' ? '评论这段文字…' : '写下你的评论…'}
        className={`${variant === 'dialog' ? 'min-h-10 resize-none' : 'min-h-16 resize-y'} min-w-0 flex-1 bg-transparent text-[13px] leading-[1.6] text-paper outline-none placeholder:text-paper-faint/65`}
      />
      <button
        type="button"
        disabled={sending || !rootDraft.ready || !rootDraft.value.trim()}
        onClick={() => void submitRoot()}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0066FF] text-white transition-[background-color,transform] hover:bg-[#005ce6] active:scale-95 disabled:bg-paper/10 disabled:text-paper-faint/40"
        aria-label="发送评论"
        title="发送评论"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={2} />}
      </button>
    </div>
  ) : (
    <div className="rounded-xl border border-haze/55 bg-ink-raised/30 px-3.5 py-2.5 text-[11px] leading-relaxed text-paper-faint">
      {!authenticated ? `登录知乎后可发表${stableTarget.kind === 'segment' ? '段评' : '评论'}、回复和点赞。` : `当前会话暂不可发表${stableTarget.kind === 'segment' ? '段评' : '评论'}。`}
    </div>
  )

  const commentList = (
    <>
      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && items.length === 0 && (
        <div className="flex min-h-28 items-center justify-center gap-2 font-mono text-[10.5px] text-paper-faint">
          <Loader2 size={14} className="animate-spin text-cinnabar-soft" />
          <span>正在读取{stableTarget.kind === 'segment' ? '段评' : '评论'}…</span>
        </div>
      )}
      {!loading && loadedOnce && !error && items.length === 0 && (
        <ZhihuEmptyState icon={<MessageCircle size={26} />} title={stableTarget.kind === 'segment' ? '还没有段评' : '还没有评论'} description={stableTarget.kind === 'segment' ? '这里会显示围绕这段文字的讨论。' : '这里会显示这条内容下的讨论。'} />
      )}
      {items.length > 0 && (
        <div>
          {items.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              service={service}
              onNavigate={onNavigate}
              authenticated={authenticated}
              accountId={accountId}
              draftStore={draftStore}
              rootTarget={stableTarget}
              onDeleted={(id) => setItems((prev) => prev.filter((item) => item.id !== id))}
              onOpenImage={onOpenImage}
            />
          ))}
        </div>
      )}
      {nextCursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className="mx-auto mt-3 flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[11px] text-paper-faint transition-colors hover:bg-paper/5 hover:text-cinnabar-soft disabled:opacity-45"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={14} strokeWidth={1.7} />}
          <span>{loading ? '正在加载' : '加载更多'}</span>
        </button>
      )}
    </>
  )

  if (variant === 'dialog') {
    return (
      <section className="flex h-full min-h-0 flex-col" aria-label="知乎评论">
        <div className="shrink-0 px-4 pt-1 sm:px-6">
          <ZhihuSectionHeader
            icon={<MessageCircle size={17} />}
            title={sectionTitle}
            detail={items.length > 0 ? `${items.length} 条已载入` : undefined}
            action={sortControl}
          />
        </div>
        <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-4 pb-3 sm:px-6">
          {commentList}
        </div>
        <div className="shrink-0 border-t border-haze/50 bg-ink/96 px-4 pb-[calc(var(--sab)+0.65rem)] pt-2.5 backdrop-blur-xl sm:px-6 sm:pb-3">
          {composer}
        </div>
      </section>
    )
  }

  return (
    <section className="mt-9 border-t border-haze/55 pt-5" aria-label="知乎评论">
      <ZhihuSectionHeader
        icon={<MessageCircle size={17} />}
        title={sectionTitle}
        detail={items.length > 0 ? `${items.length} 条已载入` : undefined}
        action={sortControl}
      />
      {composer}
      <div className="mt-3">{commentList}</div>
    </section>
  )
}
