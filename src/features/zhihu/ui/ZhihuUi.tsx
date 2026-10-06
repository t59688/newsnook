import { useMemo, useRef, type ReactNode } from 'react'
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  FileText,
  Flame,
  Hash,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  MessageSquareQuote,
  ThumbsUp,
  UserRound,
} from 'lucide-react'

import type { ZhihuAuthor, ZhihuContentSummary, ZhihuEntityKind } from '../types'
import type { ZhihuContentDetail } from '../api/decode'
import { normalizeZhihuContentHtml } from '../content/normalize'
import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import { formatZhihuCount, zhihuEntityLabel } from './ZhihuUiUtils'

export function ZhihuEntityIcon({ kind, size = 13 }: { kind: ZhihuEntityKind; size?: number }) {
  const props = { size, strokeWidth: 1.6, className: 'shrink-0' }
  switch (kind) {
    case 'answer': return <MessageSquareQuote {...props} />
    case 'article': return <FileText {...props} />
    case 'question': return <CircleHelp {...props} />
    case 'pin': return <Lightbulb {...props} />
    case 'people': return <UserRound {...props} />
    case 'topic': return <Hash {...props} />
    case 'collection': return <Bookmark {...props} />
    case 'comment': return <MessageCircle {...props} />
    default: return <FileText {...props} />
  }
}

/** 知乎热榜前列名次徽章 (01, 02, 03 醒目高对比度数字) */
export function ZhihuHotRankBadge({ rank }: { rank: number }) {
  const display = rank < 10 ? `0${rank}` : String(rank)
  if (rank === 1) {
    return (
      <span className="inline-flex min-w-[1.65rem] shrink-0 items-center justify-start font-mono text-[17px] font-black leading-none tracking-tight text-[#FF3838]">
        {display}
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="inline-flex min-w-[1.65rem] shrink-0 items-center justify-start font-mono text-[17px] font-black leading-none tracking-tight text-[#FF7700]">
        {display}
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="inline-flex min-w-[1.65rem] shrink-0 items-center justify-start font-mono text-[17px] font-black leading-none tracking-tight text-[#F5A623]">
        {display}
      </span>
    )
  }
  return (
    <span className="inline-flex min-w-[1.65rem] shrink-0 items-center justify-start font-mono text-[15.5px] font-bold leading-none tracking-tight text-paper-muted">
      {display}
    </span>
  )
}

/** 内容类型优雅轻量徽标 (右下角展示：回答采用克制淡灰字标，文章采用清晰专栏微标签以防营销软文) */
export function ZhihuKindBadge({ kind, className = '' }: { kind: ZhihuEntityKind; className?: string }) {
  if (kind === 'article') {
    return (
      <span
        title="知乎专栏/文章"
        className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[10.5px] font-medium leading-none text-purple-600 dark:text-purple-400 bg-purple-500/10 border border-purple-500/20 ${className}`}
      >
        <FileText size={10.5} strokeWidth={2} className="shrink-0" />
        <span>文章</span>
      </span>
    )
  }
  if (kind === 'answer') {
    return (
      <span
        title="知乎回答"
        className={`inline-flex shrink-0 items-center gap-1 font-sans text-[11px] font-normal leading-none text-paper-faint/75 ${className}`}
      >
        <MessageSquareQuote size={11} strokeWidth={1.8} className="shrink-0 text-paper-faint/60" />
        <span>回答</span>
      </span>
    )
  }
  if (kind === 'pin') {
    return (
      <span
        title="知乎想法"
        className={`inline-flex shrink-0 items-center gap-1 font-sans text-[11px] font-normal leading-none text-emerald-600/80 dark:text-emerald-400/80 ${className}`}
      >
        <Lightbulb size={11} strokeWidth={1.8} className="shrink-0" />
        <span>想法</span>
      </span>
    )
  }
  if (kind === 'question') {
    return (
      <span
        title="知乎提问"
        className={`inline-flex shrink-0 items-center gap-1 font-sans text-[11px] font-normal leading-none text-amber-600/80 dark:text-amber-400/80 ${className}`}
      >
        <CircleHelp size={11} strokeWidth={1.8} className="shrink-0" />
        <span>提问</span>
      </span>
    )
  }
  return null
}

export function ZhihuAuthorAvatar({
  author,
  className = 'size-8',
  verified,
}: {
  author: ZhihuAuthor
  className?: string
  verified?: boolean
}) {
  const initial = author.name.trim().slice(0, 1) || '?'
  const hasBadge = verified ?? Boolean(author.headline?.includes('优秀答主') || author.headline?.includes('认证'))
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        className="relative inline-flex size-full items-center justify-center overflow-hidden rounded-full border border-haze/60 bg-gradient-to-br from-ink-raised to-ink-deep font-sans text-paper-muted shadow-2xs"
        aria-hidden
      >
        <span className="select-none text-[0.72em] font-medium leading-none">{initial}</span>
        {author.avatarUrl && (
          <img
            src={author.avatarUrl}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 size-full object-cover"
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        )}
      </span>
      {hasBadge && (
        <span
          title="认证答主"
          className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-[#0066FF] text-white ring-1.5 ring-ink"
        >
          <CheckCircle2 size={9} strokeWidth={2.8} />
        </span>
      )}
    </span>
  )
}

export function ZhihuSurface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-haze/75 bg-ink-raised/45 shadow-[var(--shadow-lift)] ${className}`}>
      {children}
    </div>
  )
}

export function ZhihuSectionHeader({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode
  title: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon && <span className="text-cinnabar-soft">{icon}</span>}
          <h2 className="font-display text-[18px] font-medium leading-tight text-paper">{title}</h2>
        </div>
        {detail && <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-paper-faint">{detail}</p>}
      </div>
      {action}
    </div>
  )
}

export function ZhihuLoadingState({ label = '正在读取…' }: { label?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2.5 text-paper-faint">
      <LoaderCircle size={22} className="animate-spin text-cinnabar-soft" />
      <span className="font-mono text-[10.5px] tracking-[0.08em]">{label}</span>
    </div>
  )
}

export function ZhihuEmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      {icon && <div className="mb-3 text-paper-faint/55">{icon}</div>}
      <p className="font-display text-[16px] text-paper-muted">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-paper-faint">{description}</p>}
    </div>
  )
}

export function ZhihuErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-cinnabar/30 bg-cinnabar/8 px-3.5 py-3 text-[12px] leading-relaxed text-paper-muted">
      {children}
    </div>
  )
}

export function ZhihuAnswerContinuation({
  state,
  error,
  onRetry,
}: {
  state: 'loading' | 'ready' | 'end' | 'error'
  error?: string | null
  onRetry?: () => void
}) {
  return (
    <div className="mt-8 flex min-h-20 items-center justify-center border-t border-haze/45 pt-5 text-center font-mono text-[10.5px] tracking-[0.06em] text-paper-faint">
      {state === 'loading' && (
        <span className="inline-flex items-center gap-2">
          <LoaderCircle size={14} className="animate-spin text-cinnabar-soft" />
          正在加载相邻回答…
        </span>
      )}
      {state === 'ready' && <span>到达底部后，再持续上拉预览下一个回答</span>}
      {state === 'end' && <span>已是最后一个回答</span>}
      {state === 'error' && (
        <div className="flex flex-col items-center gap-2.5">
          <span className="max-w-md text-cinnabar-soft">{error || '回答顺序加载失败'}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="min-h-9 rounded-full border border-cinnabar/40 bg-cinnabar/10 px-4 text-cinnabar-soft transition-colors hover:bg-cinnabar/18"
            >
              重试加载相邻回答
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ZhihuAnswerPeek({
  direction,
  phase,
  item,
  detail,
  unavailableLabel,
}: {
  direction: 'previous' | 'next'
  phase: 'pulling' | 'ready'
  item?: ZhihuContentSummary
  detail?: ZhihuContentDetail
  unavailableLabel?: string
}) {
  const previous = direction === 'previous'
  const proseRef = useRef<HTMLDivElement | null>(null)
  const normalizedHtml = useMemo(
    () => detail
      ? normalizeZhihuContentHtml(detail.contentHtml, detail.segmentInfos, detail.ref)
      : '',
    [detail],
  )
  const normalizedMarkup = useMemo(() => ({ __html: normalizedHtml }), [normalizedHtml])
  useProgressiveImages(proseRef, normalizedHtml, Boolean(normalizedHtml), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://www.zhihu.com/',
  })
  const content = detail ?? item
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink" aria-hidden>
      <div className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-4 ${previous ? 'bottom-3' : 'top-3'}`}>
        <div className="flex items-center gap-2 rounded-full border border-haze/75 bg-ink/92 px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-cinnabar-soft shadow-lg backdrop-blur-xl">
          {previous ? <ChevronUp size={14} strokeWidth={1.8} /> : <ChevronDown size={14} strokeWidth={1.8} />}
          <span>{previous ? '上一个回答' : '下一个回答'}</span>
          <span className="text-paper-faint">{phase === 'ready' ? '松开切换' : previous ? '继续下拉' : '继续上拉'}</span>
        </div>
      </div>

      <article className="mx-auto w-full max-w-3xl px-4 pb-24 pt-5 sm:px-6">
        <header className="border-b border-haze/55 pb-5">
          {content ? (
            <>
              <h1 className="font-display text-[27px] font-medium leading-[1.34] tracking-[0.003em] text-paper sm:text-[31px]">
                {content.title}
              </h1>
              {content.author && (
                <div className="mt-3 flex items-center gap-2 text-[12px] text-paper-muted">
                  <ZhihuAuthorAvatar author={content.author} className="size-8" />
                  <span className="max-w-[18rem] truncate font-medium">{content.author.name}</span>
                  {content.author.headline && <span className="max-w-full truncate text-paper-faint">{content.author.headline}</span>}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3 py-1">
              <div className="h-8 w-[82%] rounded-lg bg-haze/45" />
              <div className="h-8 w-36 rounded-full bg-haze/35" />
            </div>
          )}
        </header>

        {detail ? (
          <>
            <div
              ref={proseRef}
              className="reader-prose zhihu-prose mt-6 text-paper"
              data-article-lang="zh"
              dangerouslySetInnerHTML={normalizedMarkup}
            />
            <ZhihuAnswerMeta
              createdAt={detail.createdAt}
              updatedAt={detail.updatedAt}
              ipLocation={detail.ipLocation}
            />
          </>
        ) : (
          <div className="mt-6 space-y-3" role="status">
            <div className="h-4 w-full rounded bg-haze/38" />
            <div className="h-4 w-[94%] rounded bg-haze/35" />
            <div className="h-4 w-[88%] rounded bg-haze/32" />
            <div className="h-4 w-[72%] rounded bg-haze/28" />
            <p className="pt-3 text-center font-mono text-[10px] tracking-[0.06em] text-paper-faint">
              {unavailableLabel ?? '正在预加载完整回答…'}
            </p>
          </div>
        )}
      </article>
    </div>
  )
}

function formatZhihuDetailTime(value?: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ZhihuAnswerMeta({
  createdAt,
  updatedAt,
  ipLocation,
}: {
  createdAt?: number
  updatedAt?: number
  ipLocation?: string
}) {
  const created = formatZhihuDetailTime(createdAt)
  const updated = formatZhihuDetailTime(updatedAt)
  const entries = [
    { label: '发布于', value: created ?? '时间未知', timestamp: createdAt },
    { label: '编辑于', value: updated ?? '时间未知', timestamp: updatedAt },
    { label: 'IP 属地', value: ipLocation?.trim() || '未显示' },
  ]
  return (
    <dl
      className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-haze/25 pt-2.5 text-[10.5px] leading-5 text-paper-faint/55"
      aria-label="回答信息"
    >
      {entries.map((entry, index) => (
        <div key={entry.label} className="inline-flex min-w-0 items-baseline gap-1">
          {index > 0 && <span className="mr-1 text-paper-faint/25" aria-hidden>·</span>}
          <dt className="shrink-0 text-paper-faint/45">{entry.label}</dt>
          <dd className="min-w-0 text-paper-faint/65">
            {entry.timestamp && entry.value !== '时间未知'
              ? <time dateTime={new Date(entry.timestamp * 1000).toISOString()}>{entry.value}</time>
              : entry.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ZhihuContentRow({
  item,
  onOpen,
  showReason = true,
  trailing,
  compact = false,
  hotRank,
  hotMetric,
}: {
  item: ZhihuContentSummary
  onOpen: (item: ZhihuContentSummary) => void
  showReason?: boolean
  trailing?: ReactNode
  /** 首页信息流保持高扫描密度：标题 2 行、摘要 2 行。 */
  compact?: boolean
  /** 热榜序号 (1, 2, 3...) */
  hotRank?: number
  /** 热度指数 (例如 "1850万热度") */
  hotMetric?: string
}) {
  const vote = formatZhihuCount(item.voteupCount)
  const comments = formatZhihuCount(item.commentCount)
  const isHot = typeof hotRank === 'number'

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="group block w-full overflow-hidden rounded-2xl border border-haze/50 bg-ink-raised/35 p-3.5 text-left shadow-[0_4px_20px_-10px_rgba(0,0,0,0.45)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:border-sky-500/30 hover:bg-ink-raised/60 hover:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.6)] active:scale-[0.992] sm:p-4"
      >
        <span className="flex min-w-0 items-start gap-3 sm:gap-3.5">
          {/* 热榜模式下展示醒目的名次徽章 */}
          {isHot && (
            <span className="pt-0.5">
              <ZhihuHotRankBadge rank={hotRank} />
            </span>
          )}

          <span className="flex min-w-0 flex-1 flex-col">
            <span className="zhihu-content-row-title is-compact block font-sans text-[16px] font-semibold leading-[1.42] tracking-[-0.01em] text-paper transition-colors group-hover:text-sky-500 sm:text-[17px]">
              {item.title}
            </span>

            {item.excerpt && (
              <span className="zhihu-content-row-excerpt is-compact mt-1.5 block text-[13px] leading-[1.62] text-paper-muted">
                {item.excerpt}
              </span>
            )}

            {/* 底部元数据栏：作者信息 + 热度/点赞 + 讨论数；右下角展示优雅类型标识 */}
            <span className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-paper-faint">
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
                {item.author && (
                  <span className="inline-flex items-center gap-1.5 truncate text-paper-muted">
                    <ZhihuAuthorAvatar author={item.author} className="size-4 shrink-0" />
                    <span className="max-w-28 truncate font-medium text-paper-muted sm:max-w-40">
                      {item.author.name}
                    </span>
                  </span>
                )}

                {/* 热度指标或赞同数 */}
                {hotMetric ? (
                  <span className="inline-flex items-center gap-1 font-medium text-[#FF7700]">
                    <Flame size={12} strokeWidth={2.2} className="shrink-0" />
                    <span>{hotMetric}</span>
                  </span>
                ) : vote ? (
                  <span className="inline-flex items-center gap-1 font-mono text-paper-faint">
                    <ThumbsUp size={11.5} strokeWidth={1.8} className="text-sky-500/80" />
                    <span>{vote} 赞同</span>
                  </span>
                ) : null}

                {comments && (
                  <span className="inline-flex items-center gap-1 font-mono text-paper-faint/80">
                    <MessageCircle size={11.5} strokeWidth={1.7} />
                    <span>{comments} 讨论</span>
                  </span>
                )}

                {showReason && item.recommendationReason && !hotMetric && (
                  <span className="truncate rounded bg-ink px-1.5 py-0.5 text-[10px] text-sky-500/85">
                    {item.recommendationReason}
                  </span>
                )}
              </span>

              {/* 右下角：低噪、优雅的内容类型与扩展操作 */}
              <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
                <ZhihuKindBadge kind={item.ref.kind} />
                {trailing}
              </span>
            </span>
          </span>

          {/* 右侧缩略图 */}
          {item.imageUrl && (
            <span className="relative aspect-[4/3] w-[28%] max-w-24 shrink-0 overflow-hidden rounded-xl border border-haze/50 bg-ink-deep sm:max-w-32">
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                onError={(event) => { event.currentTarget.parentElement?.classList.add('hidden') }}
              />
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative block w-full px-4 py-3.5 text-left transition-colors duration-200 hover:bg-ink-raised/70 active:bg-ink-deep/30 sm:px-5 sm:py-4"
    >
      <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] text-paper-faint">
        <span className="flex items-center gap-1 text-sky-500/90">
          <ZhihuEntityIcon kind={item.ref.kind} size={12} />
          <span className="font-sans font-medium">{zhihuEntityLabel(item.ref.kind)}</span>
        </span>
        {item.author?.name && (
          <>
            <span aria-hidden className="text-paper-faint/35">·</span>
            <span className="truncate font-sans text-paper-muted">{item.author.name}</span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-paper-faint">
          {vote && <span>{vote} 赞同</span>}
          {comments && <span>{comments} 讨论</span>}
          {trailing}
        </span>
      </span>

      <span className="mt-1.5 flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className={`zhihu-content-row-title block font-sans text-[16.5px] font-semibold leading-[1.45] text-paper transition-colors group-hover:text-sky-500 sm:text-[17.5px] ${compact ? 'is-compact' : ''}`}>
            {item.title}
          </span>
          {item.excerpt && (
            <span className={`zhihu-content-row-excerpt mt-1.5 block text-[13px] leading-[1.68] text-paper-muted ${compact ? 'is-compact' : ''}`}>
              {item.excerpt}
            </span>
          )}
          {showReason && item.recommendationReason && (
            <span className="mt-2 block font-mono text-[11px] leading-relaxed text-sky-500/90">
              {item.recommendationReason}
            </span>
          )}
        </span>
        <ChevronRight size={16} strokeWidth={1.5} className="mt-1 shrink-0 text-paper-faint/50 transition-transform group-hover:translate-x-0.5 group-hover:text-sky-500" />
      </span>
    </button>
  )
}

