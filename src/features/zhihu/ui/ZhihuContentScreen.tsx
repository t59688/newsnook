import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Browser } from '@capacitor/browser'
import { ChevronDown, ChevronUp, Copy, ExternalLink, Heart, Info, Loader2, LockKeyhole, MessageCircle, MessageSquareQuote, SquarePen, ThumbsDown, ThumbsUp, UserPlus, X } from 'lucide-react'
import type { ZhihuCommentDraftStore } from '../comments/draftStore'
import type { ZhihuCommentsService } from '../comments/service'
import type { ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { parseZhihuLink, parseZhihuVideoId } from '../content/links'
import { normalizeZhihuContentHtml } from '../content/normalize'
import { ZhihuAnswerDetailPreloader, ZhihuAnswerNavigator, type ZhihuAnswerNeighbors } from '../content/answerNavigation'
import { useAnswerSwipe } from '../content/useAnswerSwipe'
import type { ZhihuContentService } from '../content/service'
import type { ZhihuRecommendationSignalItem } from '../feed/recommendation'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuInteractionService, ZhihuVoteState } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import { segmentTargetFromElement, type ZhihuSegmentTarget } from '../segments/normalize'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import type { ZhihuQuestionAnswerOrder } from '../api/endpoints'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { AiSpeedReadPanel } from '../../../components/AiSpeedReadPanel'
import { ImageLightbox } from '../../../components/ImageLightbox'
import { InlineArticleVideos } from '../../../components/InlineArticleVideos'
import { InlineYoutubeEmbeds } from '../../../components/InlineYoutubeEmbeds'
import { InlineVideoPages } from '../../../components/InlineVideoPages'
import type { MediaDescriptor } from '../../mediaSniffer/types'
import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import { useReaderFontPinch } from '../../../hooks/useReaderFontPinch'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useSpeedRead } from '../../speedRead/useSpeedRead'
import type { SpeedReadUiState } from '../../speedRead/types'
import type { CloudTranslationConfig } from '../../translation/types'
import { ZhihuCollectionPicker } from './ZhihuCollectionPicker'
import { ZhihuCommentsSection } from './ZhihuCommentsSection'
import {
  ZhihuAuthorAvatar,
  ZhihuAnswerContinuation,
  ZhihuAnswerMeta,
  ZhihuAnswerPeek,
  ZhihuContentRow,
  ZhihuEntityIcon,
  ZhihuErrorBanner,
  ZhihuLoadingState,
  ZhihuSectionHeader,
  ZhihuSurface,
} from './ZhihuUi'
import { formatZhihuCount, zhihuEntityLabel } from './ZhihuUiUtils'

interface Props {
  refValue: ZhihuEntityRef
  preview?: ZhihuContentSummary
  contentService: ZhihuContentService
  feedService: ZhihuFeedService
  commentsService: ZhihuCommentsService
  onNavigate: (ref: ZhihuEntityRef, sourceAnchor?: string) => void
  onReplaceNavigate: (ref: ZhihuEntityRef) => void
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
  restoreAnchor?: string
  authenticated: boolean
  accountId?: string
  commentDraftStore: ZhihuCommentDraftStore
  interaction: ZhihuInteractionService
  onRecommendationSignal?: (
    item: ZhihuRecommendationSignalItem,
    action: 'vote-up' | 'collect',
  ) => void
  onWriteAnswer: (questionId: string) => void
  scrollContainerRef: RefObject<HTMLElement | null>
  answerPreviewHostRef: RefObject<HTMLElement | null>
  fontScale: number
  onFontScale: (next: number) => void
  speedReadConfig: CloudTranslationConfig
  onSpeedReadHeaderActionChange: (action: ZhihuSpeedReadHeaderAction | null) => void
}

export interface ZhihuSpeedReadHeaderAction {
  state: SpeedReadUiState
  open: boolean
  onOpen: () => void
}

function detailFromPreview(preview: ZhihuContentSummary): ZhihuContentDetail {
  return {
    ...preview,
    contentHtml: '',
    segmentInfos: [],
    allowSegmentInteraction: false,
    voteState: 'neutral',
    isFollowing: false,
  }
}

async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

async function copyPlainText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('当前系统无法写入剪贴板')
}

interface ZhihuAnswerActionBarProps {
  authenticated: boolean
  voteWritable: boolean
  actionBusy: boolean
  voteState: ZhihuVoteState
  voteCountLabel?: string
  commentCountLabel?: string
  commentsDisabled: boolean
  actionError?: string | null
  collectionAction: ReactNode
  onUpVote: () => void
  onDownVote: () => void
  onOpenComments: () => void
  onPreviousAnswer?: () => void
  onNextAnswer?: () => void
}

export function ZhihuAnswerActionBar({
  authenticated,
  voteWritable,
  actionBusy,
  voteState,
  voteCountLabel,
  commentCountLabel,
  commentsDisabled,
  actionError,
  collectionAction,
  onUpVote,
  onDownVote,
  onOpenComments,
  onPreviousAnswer,
  onNextAnswer,
}: ZhihuAnswerActionBarProps) {
  const voteDisabled = !authenticated || !voteWritable || actionBusy

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3 sm:px-4"
      style={{ bottom: 'calc(var(--sab) + 0.65rem)' }}
      aria-label="回答操作"
    >
      <div className="relative w-full max-w-lg">
        {actionError && (
          <div role="alert" className="absolute bottom-full left-1/2 mb-2.5 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-cinnabar/35 bg-ink/98 px-3.5 py-2.5 text-[11px] text-cinnabar-soft shadow-2xl">
            {actionError}
          </div>
        )}

        <div className="zhihu-action-dock pointer-events-auto flex h-13 min-w-0 items-center gap-1 rounded-2xl p-1.5">
          <button
            type="button"
            disabled={voteDisabled}
            onClick={onUpVote}
            aria-label={voteState === 'up' ? '取消赞同' : '赞同'}
            title={!authenticated ? '登录后可赞同' : voteState === 'up' ? '取消赞同' : '赞同'}
            className={`zhihu-vote-pill flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3.5 font-sans transition-all duration-150 active:scale-95 disabled:opacity-35 disabled:active:scale-100 ${voteState === 'up' ? 'is-active bg-[#0066FF] font-semibold text-white shadow-[0_2px_12px_rgba(0,102,255,0.45)]' : 'text-paper-muted hover:bg-paper/5 hover:text-paper'}`}
          >
            <ThumbsUp size={16.5} strokeWidth={2.2} fill={voteState === 'up' ? 'currentColor' : 'none'} className="shrink-0" />
            {voteCountLabel && <span className="max-w-16 truncate text-[12.5px] font-semibold tabular-nums">{voteCountLabel}</span>}
          </button>

          <button
            type="button"
            disabled={voteDisabled}
            onClick={onDownVote}
            aria-label={voteState === 'down' ? '取消反对' : '反对'}
            title={!authenticated ? '登录后可反对' : voteState === 'down' ? '取消反对' : '反对'}
            className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-150 active:scale-90 disabled:opacity-35 disabled:active:scale-100 ${voteState === 'down' ? 'bg-[#0066FF]/15 text-[#0066FF] dark:text-[#3B82F6]' : 'text-paper-muted/80 hover:bg-paper/5 hover:text-paper'}`}
          >
            <ThumbsDown size={16} strokeWidth={1.9} fill={voteState === 'down' ? 'currentColor' : 'none'} />
          </button>

          <div className="flex size-10 shrink-0 items-center justify-center text-paper-muted/80 [&>button]:size-full [&>button]:min-h-0 [&>button]:rounded-xl [&>button]:border-0 [&>button]:bg-transparent [&>button]:px-0 [&>button]:transition-all [&>button]:duration-150 [&>button:hover]:bg-paper/5 [&>button:hover]:text-paper [&>button:active]:scale-90">
            {collectionAction}
          </div>

          <button
            type="button"
            disabled={commentsDisabled}
            onClick={onOpenComments}
            aria-label={commentCountLabel ? `查看 ${commentCountLabel} 条评论` : '查看评论'}
            title={commentsDisabled ? '当前内容暂无法读取评论' : '查看评论'}
            className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2.5 text-paper-muted transition-all duration-150 hover:bg-paper/5 hover:text-paper active:scale-95 disabled:opacity-35 disabled:active:scale-100"
          >
            <MessageCircle size={16.5} strokeWidth={1.8} className="shrink-0" />
            {commentCountLabel && <span className="max-w-14 truncate text-[12px] font-medium tabular-nums">{commentCountLabel}</span>}
          </button>

          {(onPreviousAnswer || onNextAnswer) && <span className="mx-0.5 h-5 w-px shrink-0 bg-paper/[0.08]" aria-hidden />}
          {(onPreviousAnswer || onNextAnswer) && (
            <div className="flex shrink-0 items-center gap-0.5" aria-label="此问题的回答导航">
              <button
                type="button"
                disabled={!onPreviousAnswer}
                onClick={onPreviousAnswer}
                aria-label="上一个回答"
                title="上一个回答"
                className="flex size-9 items-center justify-center rounded-xl text-paper-muted/80 transition-all hover:bg-paper/5 hover:text-[#0066FF] active:scale-90 disabled:opacity-25"
              >
                <ChevronUp size={17} strokeWidth={2} />
              </button>
              <button
                type="button"
                disabled={!onNextAnswer}
                onClick={onNextAnswer}
                aria-label="下一个回答"
                title="下一个回答"
                className="flex size-9 items-center justify-center rounded-xl text-paper-muted/80 transition-all hover:bg-paper/5 hover:text-[#0066FF] active:scale-90 disabled:opacity-25"
              >
                <ChevronDown size={17} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}

interface ZhihuAnswerCommentsDialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function ZhihuAnswerCommentsDialog({ open, onClose, children }: ZhihuAnswerCommentsDialogProps) {
  const [dragY, setDragY] = useState(0)
  const dragStartYRef = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      dragStartYRef.current = null
      setDragY(0)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[74] flex min-h-0 items-end justify-center bg-black/40 backdrop-blur-[3px] sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="知乎回答评论"
        className="flex h-[88dvh] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-t-[2rem] border-t border-paper/[0.08] bg-ink/95 shadow-2xl backdrop-blur-2xl sm:h-[86dvh] sm:rounded-[1.75rem] sm:border"
        style={{
          transform: dragY ? `translate3d(0, ${dragY}px, 0)` : undefined,
          transition: dragStartYRef.current === null ? 'transform 180ms var(--ease-ink)' : 'none',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative shrink-0 touch-none py-2.5"
          onTouchStart={(event) => {
            dragStartYRef.current = event.touches[0]?.clientY ?? null
          }}
          onTouchMove={(event) => {
            const start = dragStartYRef.current
            const currentY = event.touches[0]?.clientY
            if (start === null || currentY === undefined) return
            setDragY(Math.min(180, Math.max(0, currentY - start)))
          }}
          onTouchEnd={() => {
            dragStartYRef.current = null
            if (dragY > 72) onClose()
            setDragY(0)
          }}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-paper-faint/30" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭评论"
            title="关闭评论"
            className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper"
          >
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  )
}

export function ZhihuContentScreen({ refValue, preview, contentService, feedService, commentsService, onNavigate, onReplaceNavigate, overlayCloserRef, restoreAnchor, authenticated, accountId, commentDraftStore, interaction, onRecommendationSignal, onWriteAnswer, scrollContainerRef, answerPreviewHostRef, fontScale, onFontScale, speedReadConfig, onSpeedReadHeaderActionChange }: Props) {
  const [detail, setDetail] = useState<ZhihuContentDetail | null>(null)
  const [answers, setAnswers] = useState<ZhihuContentSummary[]>([])
  const [answerOrder, setAnswerOrder] = useState<ZhihuQuestionAnswerOrder>('default')
  const [answersCursor, setAnswersCursor] = useState<string | undefined>()
  const [answersHasMore, setAnswersHasMore] = useState(false)
  const [answersLoadingMore, setAnswersLoadingMore] = useState(false)
  const [answersError, setAnswersError] = useState<string | null>(null)
  const answerNavigator = useMemo(() => new ZhihuAnswerNavigator(feedService), [feedService])
  const answerDetailPreloader = useMemo(() => new ZhihuAnswerDetailPreloader(contentService), [contentService])
  const [answerNeighbors, setAnswerNeighbors] = useState<{
    questionId: string
    answerId: string
    value: ZhihuAnswerNeighbors
  } | null>(null)
  const [answerNavigationLoading, setAnswerNavigationLoading] = useState(false)
  const [answerNavigationError, setAnswerNavigationError] = useState<string | null>(null)
  const [answerNavigationAttempt, setAnswerNavigationAttempt] = useState(0)
  const [, setAnswerPreviewRevision] = useState(0)
  const [answerPreviewAttempt, setAnswerPreviewAttempt] = useState(0)
  const [answerPreviewErrors, setAnswerPreviewErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [voteState, setVoteState] = useState<ZhihuVoteState>('neutral')
  const [voteCount, setVoteCount] = useState<number | undefined>()
  const [following, setFollowing] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [guestLimited, setGuestLimited] = useState(false)
  const recommendationSignalItem = useMemo<ZhihuRecommendationSignalItem>(
    () => ({
      ref: refValue,
      author: detail?.author ?? preview?.author,
      title: detail?.title ?? preview?.title,
      excerpt: detail?.excerpt ?? preview?.excerpt,
    }),
    [detail?.author, detail?.excerpt, detail?.title, preview?.author, preview?.excerpt, preview?.title, refValue],
  )
  const proseRef = useRef<HTMLDivElement | null>(null)
  const questionDetailRef = useRef<HTMLDivElement | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(Boolean(restoreAnchor))
  const [questionDetailExpanded, setQuestionDetailExpanded] = useState(false)
  const [questionDetailCanCollapse, setQuestionDetailCanCollapse] = useState(false)
  const [selectedSegment, setSelectedSegment] = useState<ZhihuSegmentTarget | null>(null)
  const [segmentCommentsOpen, setSegmentCommentsOpen] = useState(false)
  const [segmentBusy, setSegmentBusy] = useState(false)
  const [segmentError, setSegmentError] = useState<string | null>(null)
  const reduced = useReducedMotion()
  const { hudLabel } = useReaderFontPinch({
    targetRef: scrollContainerRef,
    fontScale,
    enabled: Boolean(detail) && !lightbox && !commentsOpen && !selectedSegment,
    onCommit: onFontScale,
  })
  const normalizedHtml = useMemo(
    () => normalizeZhihuContentHtml(
      detail?.contentHtml ?? '',
      detail?.segmentInfos ?? [],
      refValue,
    ),
    [detail?.contentHtml, detail?.segmentInfos, refValue],
  )
  // 这不是普通的“渲染一段 HTML”：InlineArticleVideos / InlineYoutubeEmbeds /
  // InlineVideoPages 会在该 DOM 子树内部挂 portal/播放器。React 19 对一个新的
  // dangerouslySetInnerHTML 对象会重新写 innerHTML，即便 __html 字符串没变；回答页
  // 的点赞数、上下回答等任意状态更新都会因此抹掉播放器宿主。保持对象引用稳定，
  // 只有 normalizedHtml 真正变化时才允许 React 重建正文 DOM。
  const normalizedHtmlMarkup = useMemo(() => ({ __html: normalizedHtml }), [normalizedHtml])
  const speedReadDocument = useMemo(() => {
    if (!detail || detail.ref.kind !== refValue.kind || detail.ref.id !== refValue.id) return null
    if (!['answer', 'article', 'pin'].includes(refValue.kind) || !normalizedHtml.trim()) return null
    return {
      id: `zhihu:${refValue.kind}:${refValue.id}`,
      title: detail.title,
      contentHtml: normalizedHtml,
      profile: refValue.kind === 'answer' ? 'zhihu-answer' as const : 'news' as const,
    }
  }, [detail, normalizedHtml, refValue.id, refValue.kind])
  const speedRead = useSpeedRead({ document: speedReadDocument, config: speedReadConfig })
  const speedReadOpen = speedRead.open
  const closeSpeedRead = speedRead.closePanel
  useEffect(() => {
    onSpeedReadHeaderActionChange(speedRead.available ? {
      state: speedRead.state,
      open: speedRead.open,
      onOpen: speedRead.openPanel,
    } : null)
  }, [onSpeedReadHeaderActionChange, speedRead.available, speedRead.open, speedRead.openPanel, speedRead.state])
  useEffect(
    () => () => onSpeedReadHeaderActionChange(null),
    [onSpeedReadHeaderActionChange],
  )
  const contentId = refValue.id
  const contentKind = refValue.kind
  const resolveInlineVideo = useCallback(async (pageUrl: string, signal: AbortSignal): Promise<MediaDescriptor | null> => {
    const videoId = parseZhihuVideoId(pageUrl)
    if (!videoId) return null
    const playback = await contentService.readVideo(videoId, { kind: contentKind, id: contentId }, signal)
    if (!playback) return null
    return {
      type: 'progressive',
      url: playback.url,
      pageUrl,
      score: 100,
      videoTracks: [],
      audioTracks: [],
      subtitles: [],
      drm: false,
      drmKeySystems: [],
      requestHeaders: { Referer: 'https://www.zhihu.com/' },
      relatedUrls: playback.urls,
    }
  }, [contentId, contentKind, contentService])

  // 与 NewsNook Reader 共用同一套图片代理、占位、渐显和失败处理。
  // 知乎图片直连失败时允许走原生字节通道 + Referer 自动补救，并保留点按重试。
  useProgressiveImages(proseRef, normalizedHtml, Boolean(normalizedHtml), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://www.zhihu.com/',
  })

  useEffect(() => {
    setLightbox(null)
    setCommentsOpen(Boolean(restoreAnchor))
    setQuestionDetailExpanded(false)
    setQuestionDetailCanCollapse(false)
    setSelectedSegment(null)
    setSegmentCommentsOpen(false)
    setSegmentError(null)
    setAnswerNavigationError(null)
  }, [refValue.id, refValue.kind, restoreAnchor])

  useEffect(() => {
    if (refValue.kind !== 'question') {
      setQuestionDetailCanCollapse(false)
      return
    }
    const node = questionDetailRef.current
    if (!node) return
    const measure = () => setQuestionDetailCanCollapse(node.scrollHeight > 300)
    const frame = window.requestAnimationFrame(measure)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(node)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [detail?.excerpt, normalizedHtml, refValue.kind])

  useEffect(() => {
    if (!overlayCloserRef) return
    if (!lightbox && !commentsOpen && !selectedSegment && !speedReadOpen) {
      overlayCloserRef.current = null
      return
    }
    overlayCloserRef.current = () => {
      if (speedReadOpen) {
        closeSpeedRead()
        return true
      }
      if (lightbox) {
        setLightbox(null)
        return true
      }
      if (commentsOpen) {
        setCommentsOpen(false)
        return true
      }
      if (segmentCommentsOpen) {
        setSegmentCommentsOpen(false)
        return true
      }
      if (selectedSegment) {
        setSelectedSegment(null)
        setSegmentError(null)
        return true
      }
      return false
    }
    return () => {
      overlayCloserRef.current = null
    }
  }, [closeSpeedRead, commentsOpen, lightbox, overlayCloserRef, segmentCommentsOpen, selectedSegment, speedReadOpen])

  useEffect(() => {
    const controller = new AbortController()
    const cachedAnswer = refValue.kind === 'answer' ? answerDetailPreloader.peek(refValue) : undefined
    setDetail(cachedAnswer ?? (preview ? detailFromPreview(preview) : null))
    setAnswers([])
    setAnswersCursor(undefined)
    setAnswersHasMore(false)
    setAnswersError(null)
    setLoading(!cachedAnswer)
    setError(null)
    setGuestLimited(!authenticated && Boolean(preview))
    const detailRequest = refValue.kind === 'answer'
      ? answerDetailPreloader.load(refValue)
      : contentService.read(refValue, controller.signal)
    void detailRequest.then(
      async (value) => {
        if (controller.signal.aborted) return
        setDetail(value)
        setGuestLimited(false)
        setVoteState(value.voteState)
        setVoteCount(value.voteupCount)
        setFollowing(value.isFollowing)
        if (refValue.kind === 'question') {
          try {
            const page = await feedService.questionAnswers(refValue.id, answerOrder, undefined, controller.signal)
            if (!controller.signal.aborted) {
              setAnswers(page.items)
              setAnswersCursor(page.nextCursor)
              setAnswersHasMore(page.hasMore)
            }
          } catch (reason) {
            // 问题正文仍然可读；回答列表失败独立提示，不把一个失败请求伪装成“0 个回答”。
            if (!controller.signal.aborted) setAnswersError(reason instanceof Error ? reason.message : '回答列表读取失败')
          }
        }
        if (!controller.signal.aborted) setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        const apiError = reason instanceof ZhihuApiError ? reason : null
        // 知乎目前会对未登录详情接口返回 need_login/403，但推荐与热榜本身仍可匿名读取。
        // 已经从列表拿到的公开卡片不能因此变成一张“登录墙”：保留标题、作者和摘要，
        // 只有完整正文/评论/关系态明确提示需要登录。
        if (!authenticated && preview && (apiError?.code === 'forbidden' || apiError?.code === 'auth-expired')) {
          setDetail(detailFromPreview(preview))
          setGuestLimited(true)
          setError(null)
          setLoading(false)
          return
        }
        setError(apiError?.message ?? (reason instanceof Error ? reason.message : '读取正文失败'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [answerDetailPreloader, answerOrder, authenticated, contentService, feedService, preview, refValue])

  useEffect(() => {
    if (refValue.kind !== 'answer' || detail?.ref.kind !== 'answer' || detail.ref.id !== refValue.id || !detail.questionId) return
    const questionId = detail.questionId
    const answerId = refValue.id
    const controller = new AbortController()
    setAnswerNeighbors((current) => current?.questionId === questionId && current.answerId === answerId ? current : null)
    setAnswerNavigationLoading(true)
    setAnswerNavigationError(null)
    void answerNavigator.neighbors(questionId, answerId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setAnswerNeighbors({ questionId, answerId, value })
          setAnswerNavigationLoading(false)
        }
      },
      (reason) => {
        if (!controller.signal.aborted) {
          setAnswerNavigationError(reason instanceof Error ? reason.message : '回答顺序加载失败')
          setAnswerNavigationLoading(false)
        }
      },
    )
    return () => controller.abort()
  }, [answerNavigationAttempt, answerNavigator, detail?.questionId, detail?.ref.id, detail?.ref.kind, refValue.id, refValue.kind])

  const resolvedAnswerNeighbors = answerNeighbors
    && answerNeighbors.questionId === detail?.questionId
    && answerNeighbors.answerId === refValue.id
    ? answerNeighbors.value
    : null
  const previousAnswerRef = resolvedAnswerNeighbors?.previous
  const nextAnswerRef = resolvedAnswerNeighbors?.next
  useEffect(() => {
    const targets = [previousAnswerRef, nextAnswerRef].filter((value): value is ZhihuEntityRef => Boolean(value))
    if (targets.length === 0) return
    let alive = true
    for (const target of targets) {
      if (answerDetailPreloader.peek(target)) {
        setAnswerPreviewErrors((current) => {
          if (!(target.id in current)) return current
          const next = { ...current }
          delete next[target.id]
          return next
        })
        continue
      }
      setAnswerPreviewErrors((current) => {
        if (!(target.id in current)) return current
        const next = { ...current }
        delete next[target.id]
        return next
      })
      void answerDetailPreloader.load(target).then(
        () => {
          if (!alive) return
          setAnswerPreviewErrors((current) => {
            if (!(target.id in current)) return current
            const next = { ...current }
            delete next[target.id]
            return next
          })
          setAnswerPreviewRevision((value) => value + 1)
        },
        (reason) => {
          if (!alive) return
          setAnswerPreviewErrors((current) => ({
            ...current,
            [target.id]: reason instanceof Error ? reason.message : '回答正文预加载失败',
          }))
        },
      )
    }
    return () => { alive = false }
  }, [answerDetailPreloader, answerPreviewAttempt, nextAnswerRef, previousAnswerRef])

  const navigateToAnswer = useCallback((target: ZhihuEntityRef) => {
    const cached = answerDetailPreloader.peek(target)
    if (cached) {
      setDetail(cached)
      setVoteState(cached.voteState)
      setVoteCount(cached.voteupCount)
      setFollowing(cached.isFollowing)
      setGuestLimited(false)
      setLoading(false)
      setError(null)
    }
    onReplaceNavigate(target)
  }, [answerDetailPreloader, onReplaceNavigate])

  const answerSwipe = useAnswerSwipe({
    containerRef: scrollContainerRef,
    enabled: refValue.kind === 'answer'
      && Boolean(detail?.questionId)
      && !loading
      && !guestLimited
      && !lightbox
      && !commentsOpen
      && !selectedSegment
      && !speedReadOpen,
    reduced,
    canGo: (direction) => Boolean(direction === 'previous' ? previousAnswerRef : nextAnswerRef),
    onCommit: (direction) => {
      const target = direction === 'previous' ? previousAnswerRef : nextAnswerRef
      if (target) navigateToAnswer(target)
    },
  })

  const loadMoreAnswers = async () => {
    if (refValue.kind !== 'question' || !answersCursor || answersLoadingMore) return
    setAnswersLoadingMore(true)
    try {
      setAnswersError(null)
      const page = await feedService.questionAnswers(refValue.id, answerOrder, answersCursor)
      setAnswers((prev) => {
        const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
        return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
      })
      setAnswersCursor(page.nextCursor)
      setAnswersHasMore(page.hasMore)
    } catch (reason) {
      setAnswersError(reason instanceof Error ? reason.message : '加载更多回答失败')
    } finally {
      setAnswersLoadingMore(false)
    }
  }

  const toggleDownVote = async () => {
    if (!authenticated || actionBusy || refValue.kind !== 'answer') return
    const previous = voteState
    const target: ZhihuVoteState = previous === 'down' ? 'neutral' : 'down'
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await interaction.setVote(refValue, target)
      setVoteState(result.state)
      if (typeof result.voteupCount === 'number') setVoteCount(result.voteupCount)
      else if (previous === 'up' && target === 'down') {
        setVoteCount((count) => typeof count === 'number' ? Math.max(0, count - 1) : count)
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '反对操作失败')
    } finally {
      setActionBusy(false)
    }
  }

  const toggleVote = async () => {
    if (!authenticated || actionBusy || (refValue.kind !== 'answer' && refValue.kind !== 'article')) return
    const target: ZhihuVoteState = voteState === 'up' ? 'neutral' : 'up'
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await interaction.setVote(refValue, target)
      setVoteState(result.state)
      if (typeof result.voteupCount === 'number') setVoteCount(result.voteupCount)
      else setVoteCount((count) => typeof count === 'number' ? Math.max(0, count + (target === 'up' ? 1 : -1)) : count)
      if (target === 'up') onRecommendationSignal?.(recommendationSignalItem, 'vote-up')
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '赞同操作失败')
    } finally {
      setActionBusy(false)
    }
  }

  const toggleQuestionFollow = async () => {
    if (!authenticated || actionBusy || refValue.kind !== 'question') return
    const target = !following
    setActionBusy(true)
    setActionError(null)
    try {
      await interaction.setFollowing('question', refValue.id, target)
      setFollowing(target)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : '关注问题失败')
    } finally {
      setActionBusy(false)
    }
  }

  const syncSegmentDom = (previous: ZhihuSegmentTarget, next: ZhihuSegmentTarget) => {
    const nodes = proseRef.current?.querySelectorAll<HTMLElement>('[data-reader-role="zhihu-segment"]') ?? []
    for (const node of nodes) {
      if (node.getAttribute('data-zhihu-segment-id') !== previous.segmentId) continue
      node.setAttribute('data-zhihu-segment-id', next.segmentId)
      node.setAttribute('data-zhihu-segment-liked', String(next.liked))
      node.setAttribute('data-zhihu-segment-like-count', String(next.likeCount))
    }
  }

  const toggleSegmentLike = async () => {
    if (!selectedSegment || !authenticated || segmentBusy) return
    const operation = selectedSegment.liked ? 'segment.like.clear' : 'segment.like.set'
    if (!canExecuteZhihuOperation(operation)) return
    const previous = selectedSegment
    setSegmentBusy(true)
    setSegmentError(null)
    try {
      const next = await interaction.setSegmentLiked(previous, !previous.liked)
      syncSegmentDom(previous, next)
      setSelectedSegment(next)
    } catch (reason) {
      setSegmentError(reason instanceof Error ? reason.message : '段落点赞失败')
    } finally {
      setSegmentBusy(false)
    }
  }

  const copySelectedSegment = async () => {
    if (!selectedSegment) return
    setSegmentError(null)
    try {
      await copyPlainText(selectedSegment.displayText)
      setSelectedSegment(null)
    } catch (reason) {
      setSegmentError(reason instanceof Error ? reason.message : '复制失败')
    }
  }

  const handleBodyClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (!target) return

    const segment = segmentTargetFromElement(target)
    if (segment) {
      event.preventDefault()
      event.stopPropagation()
      setSegmentError(null)
      setSegmentCommentsOpen(false)
      setSelectedSegment(segment)
      return
    }

    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (anchor?.getAttribute('data-media-format') === 'video-page') {
      // 正文视频由 InlineVideoPages 原地替换为播放器；这里不再打开二级视频页。
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const image = target.closest('img') as HTMLImageElement | null
    const imageCard = image?.closest('a[data-reader-role="zhihu-link-card"]')
    if (image && !imageCard && !image.classList.contains('async-img-failed')) {
      const src = image.currentSrc || image.src
      if (src) {
        event.preventDefault()
        event.stopPropagation()
        setLightbox({ src, alt: image.alt || detail?.title || '' })
        return
      }
    }

    if (!anchor?.href) return
    event.preventDefault()

    const ref = parseZhihuLink(anchor.href)
    if (ref) onNavigate(ref)
    else void openExternal(anchor.href)
  }

  if (loading && !detail) {
    return <ZhihuLoadingState label="正在读取正文…" />
  }
  if (error || !detail) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
        <ZhihuErrorBanner>{error ?? '正文不可用'}</ZhihuErrorBanner>
      </div>
    )
  }

  const voteWritable = canExecuteZhihuOperation('vote.set')
  const questionFollowWritable = canExecuteZhihuOperation(following ? 'follow.question.clear' : 'follow.question.set')
  const voteCountLabel = formatZhihuCount(voteCount)
  const commentCountLabel = formatZhihuCount(detail.commentCount)

  const actionClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-haze bg-ink-raised/55 px-3 text-[11px] text-paper-muted transition-colors hover:border-paper-faint/45 hover:bg-ink-raised hover:text-paper disabled:opacity-35'
  const activeActionClass = 'border-cinnabar/45 bg-cinnabar/12 text-cinnabar-soft'
  const answerPreviewItem = answerSwipe.direction === 'previous'
    ? resolvedAnswerNeighbors?.previousPreview
    : resolvedAnswerNeighbors?.nextPreview
  const answerPreviewRef = answerSwipe.direction === 'previous' ? previousAnswerRef : nextAnswerRef
  const answerPreviewDetail = answerPreviewRef ? answerDetailPreloader.peek(answerPreviewRef) : undefined
  const answerPreviewError = answerPreviewRef ? answerPreviewErrors[answerPreviewRef.id] : undefined
  const answerPreviewUnavailable = answerNavigationError
    ? '回答顺序加载失败，请在正文底部重试'
    : answerPreviewError
      ? `正文预加载失败：${answerPreviewError}。松开后可重试打开`
    : answerNavigationLoading || !resolvedAnswerNeighbors
      ? '正在预加载完整回答…'
      : answerSwipe.direction === 'previous'
        ? '已是第一个回答'
        : answerPreviewRef
          ? '正在预加载完整回答…'
          : '已是最后一个回答'
  const answerPreviewProgress = answerSwipe.viewportHeight > 0
    ? Math.min(1, Math.abs(answerSwipe.dragY) / answerSwipe.viewportHeight)
    : 0
  const answerPreviewPortal = answerSwipe.direction && answerPreviewHostRef.current
    ? createPortal(
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: answerSwipe.direction === 'previous'
              ? `translate3d(0, calc(${answerSwipe.dragY}px - 100%), 0)`
              : `translate3d(0, calc(${answerSwipe.dragY}px + 100%), 0)`,
            transition: answerSwipe.transitionMs > 0
              ? `transform ${answerSwipe.transitionMs}ms var(--ease-ink)`
              : 'none',
            backfaceVisibility: 'hidden',
            opacity: 0.86 + answerPreviewProgress * 0.14,
          }}
        >
          <ZhihuAnswerPeek
            direction={answerSwipe.direction}
            phase={answerSwipe.phase === 'ready' || answerSwipe.phase === 'committing' ? 'ready' : 'pulling'}
            item={answerPreviewItem}
            detail={answerPreviewDetail}
            unavailableLabel={answerPreviewUnavailable}
          />
        </div>,
        answerPreviewHostRef.current,
      )
    : null

  return (
    <article className={`mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6 ${refValue.kind === 'answer' ? 'pb-28' : 'pb-24'}`}>
      {answerPreviewPortal}
      {hudLabel && (
        <div
          className="pointer-events-none fixed left-1/2 top-[40%] z-[70] -translate-x-1/2 rounded-full border border-haze bg-ink/92 px-3.5 py-1.5 font-mono text-[12px] text-paper shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          {hudLabel}
        </div>
      )}
      <header className="border-b border-haze/45 pb-5">
        {refValue.kind !== 'answer' && (
          <div className="flex items-center gap-1.5 font-sans text-[11px] font-medium text-sky-500">
            <ZhihuEntityIcon kind={refValue.kind} size={13} />
            <span>{zhihuEntityLabel(refValue.kind)}</span>
          </div>
        )}
        <h1 className={`${refValue.kind === 'answer' ? 'mt-0' : 'mt-2'} font-sans text-[21px] font-bold leading-[1.36] tracking-tight text-paper sm:text-[25px]`}>
          {refValue.kind === 'answer' && detail.questionId ? (
            <button
              type="button"
              onClick={() => onNavigate({ kind: 'question', id: detail.questionId! })}
              title="查看问题详情"
              className="text-left transition-colors hover:text-sky-500"
            >
              {detail.title}
            </button>
          ) : detail.title}
        </h1>

        {/* 回答页：原生答主身份卡片 */}
        {detail.author?.name ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-haze/45 bg-ink-raised/30 p-3 sm:p-3.5">
            <button
              type="button"
              onClick={() => onNavigate({ kind: 'people', id: detail.author!.token ?? detail.author!.id })}
              aria-label={`查看 ${detail.author.name} 的主页`}
              className="group flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <ZhihuAuthorAvatar author={detail.author} className="size-10 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-sans text-[14.5px] font-semibold text-paper transition-colors group-hover:text-sky-500">
                    {detail.author.name}
                  </span>
                </div>
                {detail.author.headline ? (
                  <p className="truncate text-[12px] text-paper-muted">
                    {detail.author.headline}
                  </p>
                ) : (
                  <p className="text-[11.5px] text-paper-faint">知乎答主</p>
                )}
              </div>
            </button>

            {detail.author.token && (
              <button
                type="button"
                onClick={() => onNavigate({ kind: 'people', id: detail.author!.token ?? detail.author!.id })}
                className="shrink-0 rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1 font-sans text-[11.5px] font-medium text-sky-500 transition-colors hover:bg-sky-500/20 active:scale-95"
              >
                主页
              </button>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[12px] text-paper-faint">
            {refValue.kind !== 'answer' && voteCountLabel && <span>{voteCountLabel} 赞同</span>}
            {refValue.kind !== 'answer' && commentCountLabel && <span>{commentCountLabel} 讨论</span>}
          </div>
        )}

        {refValue.kind !== 'answer' && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {refValue.kind === 'article' && (
              <button
                type="button"
                disabled={!authenticated || !voteWritable || actionBusy}
                onClick={() => void toggleVote()}
                aria-label={voteState === 'up' ? '取消赞同' : '赞同'}
                title={!authenticated ? '登录后可赞同' : voteState === 'up' ? '取消赞同' : '赞同'}
                className={`${actionClass} ${voteState === 'up' ? 'border-[#0066FF] bg-[#0066FF] text-white shadow-sm' : ''}`}
              >
                <ThumbsUp size={14} strokeWidth={1.65} fill={voteState === 'up' ? 'currentColor' : 'none'} />
                {voteCountLabel && <span>{voteCountLabel}</span>}
              </button>
            )}

          {refValue.kind === 'question' && (
            <>
              <button
                type="button"
                disabled={!authenticated || !questionFollowWritable || actionBusy}
                onClick={() => void toggleQuestionFollow()}
                aria-label={following ? '取消关注问题' : '关注问题'}
                title={!authenticated ? '登录后可关注问题' : following ? '取消关注问题' : '关注问题'}
                className={`${actionClass} ${following ? activeActionClass : ''}`}
              >
                <UserPlus size={14} strokeWidth={1.65} />
              </button>
              <button
                type="button"
                disabled={!authenticated}
                onClick={() => onWriteAnswer(refValue.id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cinnabar/55 bg-cinnabar/12 px-3.5 text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35"
              >
                <SquarePen size={14} strokeWidth={1.7} />
                <span>写回答</span>
              </button>
            </>
          )}

          <ZhihuCollectionPicker refValue={refValue} service={interaction} authenticated={authenticated} />
          <button
            type="button"
            onClick={() => void openExternal(detail.url)}
            aria-label="打开知乎原页"
            title="打开知乎原页"
            className={actionClass}
          >
            <ExternalLink size={14} strokeWidth={1.65} />
          </button>
          </div>
        )}

        {refValue.kind !== 'answer' && actionError && <div className="mt-3"><ZhihuErrorBanner>{actionError}</ZhihuErrorBanner></div>}
      </header>

      {guestLimited && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-haze/70 bg-ink-raised/45 px-3.5 py-3 text-[11.5px] leading-relaxed text-paper-muted">
          <LockKeyhole size={15} strokeWidth={1.6} className="mt-0.5 shrink-0 text-cinnabar-soft" />
          <span>当前显示的是信息流公开摘要；知乎要求登录后才能读取这条内容的完整正文、评论与回答导航。</span>
        </div>
      )}

      <div className="mt-6">
        <div
          ref={questionDetailRef}
          className={`relative ${refValue.kind === 'question' && questionDetailCanCollapse && !questionDetailExpanded ? 'max-h-[18rem] overflow-hidden' : ''}`}
        >
          {detail.contentHtml ? (
            <>
              <div
                ref={proseRef}
                className="reader-prose zhihu-prose text-paper"
                data-article-lang="zh"
                style={refValue.kind === 'answer' ? { touchAction: 'manipulation' } : undefined}
                onClick={handleBodyClick}
                onDoubleClick={(event) => {
                  if (refValue.kind !== 'answer' || guestLimited || commentsOpen || selectedSegment || lightbox || speedReadOpen) return
                  const target = event.target instanceof Element ? event.target : null
                  if (!target || target.closest('a, button, img, video, audio, iframe, input, textarea, [contenteditable], [data-segment-id]')) return
                  if (window.getSelection()?.toString().trim()) return
                  event.preventDefault()
                  setCommentsOpen(true)
                }}
                dangerouslySetInnerHTML={normalizedHtmlMarkup}
              />
              <InlineArticleVideos
                rootRef={proseRef}
                html={normalizedHtml}
                enabled={Boolean(normalizedHtml)}
                fallbackTitle={detail.title}
                sourcePage={detail.url}
              />
              <InlineYoutubeEmbeds
                rootRef={proseRef}
                html={normalizedHtml}
                enabled={Boolean(normalizedHtml)}
                fallbackTitle={detail.title}
                sourcePage={detail.url}
              />
              <InlineVideoPages
                rootRef={proseRef}
                html={normalizedHtml}
                enabled={Boolean(normalizedHtml)}
                fallbackTitle={detail.title}
                sourcePage={detail.url}
                resolveDirect={resolveInlineVideo}
              />
            </>
          ) : detail.excerpt ? (
            <div className="reader-prose zhihu-prose" data-article-lang="zh">
              <p data-cjk="true">{detail.excerpt}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-8 text-[12px] text-paper-faint">
              <Info size={15} />
              <span>没有可显示的正文内容。</span>
            </div>
          )}
          {refValue.kind === 'question' && questionDetailCanCollapse && !questionDetailExpanded && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-ink" aria-hidden />
          )}
        </div>
        {refValue.kind === 'question' && questionDetailCanCollapse && (
          <div className="mt-2 flex justify-center border-b border-haze/45 pb-3">
            <button
              type="button"
              onClick={() => setQuestionDetailExpanded((value) => !value)}
              aria-expanded={questionDetailExpanded}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-haze/70 bg-ink-raised/45 px-3.5 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft"
            >
              {questionDetailExpanded ? <ChevronUp size={14} strokeWidth={1.7} /> : <ChevronDown size={14} strokeWidth={1.7} />}
              <span>{questionDetailExpanded ? '收起问题详情' : '展开问题详情'}</span>
            </button>
          </div>
        )}
      </div>

      {refValue.kind === 'answer' && !guestLimited && (
        <ZhihuAnswerMeta
          createdAt={detail.createdAt}
          updatedAt={detail.updatedAt}
          ipLocation={detail.ipLocation}
        />
      )}

      {refValue.kind === 'answer' && (
        <ZhihuAnswerActionBar
          authenticated={authenticated}
          voteWritable={voteWritable}
          actionBusy={actionBusy}
          voteState={voteState}
          voteCountLabel={voteCountLabel}
          commentCountLabel={commentCountLabel}
          commentsDisabled={guestLimited}
          actionError={actionError}
          collectionAction={(
            <ZhihuCollectionPicker
              refValue={refValue}
              service={interaction}
              authenticated={authenticated}
              onCollected={() => onRecommendationSignal?.(recommendationSignalItem, 'collect')}
            />
          )}
          onUpVote={() => void toggleVote()}
          onDownVote={() => void toggleDownVote()}
          onOpenComments={() => setCommentsOpen(true)}
          onPreviousAnswer={previousAnswerRef ? () => navigateToAnswer(previousAnswerRef) : undefined}
          onNextAnswer={nextAnswerRef ? () => navigateToAnswer(nextAnswerRef) : undefined}
        />
      )}

      {refValue.kind === 'answer' && !guestLimited && detail.questionId && (
        <ZhihuAnswerContinuation
          state={answerNavigationError || (nextAnswerRef && answerPreviewErrors[nextAnswerRef.id])
            ? 'error'
            : answerNavigationLoading || !resolvedAnswerNeighbors
              ? 'loading'
              : nextAnswerRef
                ? 'ready'
                : 'end'}
          error={answerNavigationError ?? (nextAnswerRef ? answerPreviewErrors[nextAnswerRef.id] : undefined)}
          onRetry={answerNavigationError
            ? () => setAnswerNavigationAttempt((value) => value + 1)
            : nextAnswerRef && answerPreviewErrors[nextAnswerRef.id]
              ? () => setAnswerPreviewAttempt((value) => value + 1)
              : undefined}
        />
      )}

      {refValue.kind === 'question' && (
        <section className="mt-8 border-t border-haze/55 pt-5">
          <ZhihuSectionHeader
            icon={<MessageSquareQuote size={17} />}
            title="回答"
            detail={answers.length > 0 ? `已载入 ${answers.length} 条` : undefined}
            action={(
              <div className="w-36">
                <SegmentedControl
                  label="回答排序"
                  value={answerOrder}
                  onChange={setAnswerOrder}
                  options={[
                    { value: 'default', label: '默认' },
                    { value: 'updated', label: '最新' },
                  ]}
                />
              </div>
            )}
          />
          {answersError && <div className="mb-3"><ZhihuErrorBanner>{answersError}</ZhihuErrorBanner></div>}
          {answers.length > 0 ? (
            <ZhihuSurface className="divide-y divide-haze/55">
              {answers.map((answer) => (
                <ZhihuContentRow key={`${answer.ref.kind}:${answer.ref.id}`} item={answer} onOpen={(item) => onNavigate(item.ref)} showReason={false} />
              ))}
            </ZhihuSurface>
          ) : !answersError && !loading ? (
            <div className="py-8 text-center text-[12px] text-paper-faint">暂无可读取回答</div>
          ) : null}
          {answersHasMore && (
            <button
              type="button"
              disabled={answersLoadingMore}
              onClick={() => void loadMoreAnswers()}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/45 font-mono text-[10.5px] text-paper-muted transition-colors hover:bg-ink-raised disabled:opacity-40"
            >
              {answersLoadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
              <span>{answersLoadingMore ? '正在加载回答…' : '加载更多回答'}</span>
            </button>
          )}
        </section>
      )}

      {!guestLimited && refValue.kind !== 'answer' && ['article', 'pin', 'question'].includes(refValue.kind) && (
        <ZhihuCommentsSection
          target={refValue}
          service={commentsService}
          onNavigate={onNavigate}
          restoreAnchor={restoreAnchor}
          authenticated={authenticated}
          accountId={accountId}
          draftStore={commentDraftStore}
          onOpenImage={(src, alt) => setLightbox({ src, alt })}
        />
      )}

      <ZhihuAnswerCommentsDialog open={refValue.kind === 'answer' && commentsOpen} onClose={() => setCommentsOpen(false)}>
        <ZhihuCommentsSection
          target={refValue}
          service={commentsService}
          onNavigate={(nextRef, anchor) => {
            setCommentsOpen(false)
            onNavigate(nextRef, anchor)
          }}
          restoreAnchor={restoreAnchor}
          authenticated={authenticated}
          accountId={accountId}
          draftStore={commentDraftStore}
          onOpenImage={(src, alt) => setLightbox({ src, alt })}
          variant="dialog"
        />
      </ZhihuAnswerCommentsDialog>

      {selectedSegment && !segmentCommentsOpen && (
        <div
          className="fixed inset-0 z-[72] flex items-end bg-black/35 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="段落互动"
          onClick={() => { setSelectedSegment(null); setSegmentError(null) }}
        >
          <div
            className="w-full rounded-t-[1.75rem] border-t border-haze/80 bg-ink/98 px-4 pb-[calc(var(--sab)+1rem)] pt-3 shadow-2xl sm:mx-auto sm:max-w-xl sm:rounded-[1.5rem] sm:border sm:mb-4 sm:pb-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto h-1 w-10 rounded-full bg-paper-faint/30" aria-hidden />
            <div className="mt-4 rounded-xl border border-haze/60 bg-ink-raised/45 px-3.5 py-3 text-[12.5px] leading-[1.75] text-paper-muted">
              {selectedSegment.displayText}
            </div>
            {segmentError && <div className="mt-2.5"><ZhihuErrorBanner>{segmentError}</ZhihuErrorBanner></div>}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={
                  !authenticated
                  || segmentBusy
                  || !canExecuteZhihuOperation(selectedSegment.liked ? 'segment.like.clear' : 'segment.like.set')
                }
                onClick={() => void toggleSegmentLike()}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border text-[11px] transition-colors disabled:opacity-35 ${selectedSegment.liked ? 'border-cinnabar/45 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/70 bg-ink-raised/55 text-paper-muted hover:border-cinnabar/35 hover:text-cinnabar-soft'}`}
                title={!authenticated ? '登录后可点赞这段文字' : selectedSegment.liked ? '取消段落点赞' : '点赞这段文字'}
              >
                {segmentBusy ? <Loader2 size={14} className="animate-spin" /> : <Heart size={14} fill={selectedSegment.liked ? 'currentColor' : 'none'} strokeWidth={1.7} />}
                <span>{selectedSegment.liked ? '已赞' : '赞'}</span>
                {selectedSegment.likeCount > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(selectedSegment.likeCount)}</span>}
              </button>
              <button
                type="button"
                disabled={!canExecuteZhihuOperation('segment.comment.list-root')}
                onClick={() => setSegmentCommentsOpen(true)}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/55 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft disabled:opacity-35"
                title="查看段评"
              >
                <MessageCircle size={14} strokeWidth={1.7} />
                <span>段评</span>
                {selectedSegment.commentCount > 0 && <span className="font-mono text-[9.5px]">{formatZhihuCount(selectedSegment.commentCount)}</span>}
              </button>
              <button
                type="button"
                onClick={() => void copySelectedSegment()}
                className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-haze/70 bg-ink-raised/55 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft"
                title="复制这段文字"
              >
                <Copy size={14} strokeWidth={1.7} />
                <span>复制</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedSegment && segmentCommentsOpen && (
        <div className="fixed inset-0 z-[74] flex min-h-0 flex-col bg-ink/98" role="dialog" aria-modal="true" aria-label="知乎段评">
          <header className="shrink-0 border-b border-haze/60 px-4 pb-3 pt-[calc(var(--sat)+0.75rem)] sm:px-6">
            <div className="flex items-center gap-3">
              <MessageCircle size={17} className="shrink-0 text-cinnabar-soft" strokeWidth={1.7} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[17px] text-paper">段评</div>
                <div className="mt-0.5 line-clamp-1 text-[10.5px] text-paper-faint">{selectedSegment.displayText}</div>
              </div>
              <button
                type="button"
                onClick={() => setSegmentCommentsOpen(false)}
                aria-label="关闭段评"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-paper-muted hover:bg-paper/5 hover:text-paper"
              >
                <X size={18} />
              </button>
            </div>
          </header>
          <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--sab)+1rem)] sm:px-6">
            <div className="mx-auto w-full max-w-3xl">
              <ZhihuCommentsSection
                target={selectedSegment}
                service={commentsService}
                onNavigate={(ref, anchor) => {
                  setSegmentCommentsOpen(false)
                  setSelectedSegment(null)
                  onNavigate(ref, anchor)
                }}
                authenticated={authenticated}
                accountId={accountId}
                draftStore={commentDraftStore}
                onOpenImage={(src, alt) => setLightbox({ src, alt })}
              />
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}

      <AiSpeedReadPanel
        open={speedRead.open}
        state={speedRead.state}
        partialStore={speedRead.partialStore}
        error={speedRead.error}
        model={speedReadConfig.model}
        articleTitle={detail.title}
        sourceName={detail.author?.name ? `知乎 · ${detail.author.name}` : '知乎'}
        sourceLabel={detail.author?.name}
        originUrl={detail.url}
        profile={speedReadDocument?.profile}
        scopeLabel={refValue.kind === 'answer' ? '本回答' : '本正文'}
        onClose={speedRead.closePanel}
        onRetry={speedRead.retry}
        onCancel={speedRead.cancel}
      />
    </article>
  )
}
