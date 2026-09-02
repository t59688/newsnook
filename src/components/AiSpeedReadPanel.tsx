import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Copy,
  FileDown,
  ImageDown,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  ScrollText,
  Share2,
  Square,
  X,
} from 'lucide-react'

import { Capacitor } from '@capacitor/core'

import { exportMarkdownFile } from '../lib/articleMarkdown'
import { displayArticleTitle } from '../lib/displayArticleTitle'
import { saveImageBlob, shareImageBlob } from '../lib/imageActions'
import { markdownToSafeHtml } from '../lib/markdown'
import { copyShareText } from '../lib/shareArticle'
import { buildSpeedReadMarkdown, speedReadMarkdownFileName } from '../lib/speedReadExport'
import {
  loadSpeedReadShareStyle,
  renderSpeedReadImageBlob,
  saveSpeedReadShareStyle,
  SPEED_READ_SHARE_STYLES,
  speedReadImageFileName,
  type SpeedReadShareStyle,
} from '../lib/speedReadImage'
import { warmupSpeedReadShareAssets } from '../lib/speedReadShare/assets'

export type SpeedReadUiState = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled'

type ActionId = 'copy' | 'export-md' | 'save-image' | 'share-image'

interface Props {
  open: boolean
  state: SpeedReadUiState
  markdown: string
  thinking: string
  status: string
  error: string
  model?: string
  articleTitle: string
  sourceName: string
  sourceLabel?: string
  originUrl?: string
  onClose: () => void
  onRetry: () => void
  onCancel: () => void
}

const ACTION_BUTTON_CLASS =
  'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-haze bg-ink-raised/70 px-3 font-mono text-[10.5px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-paper disabled:opacity-35'

/** 距底部在此范围内视为「贴底」，流式正文才跟随滚动 */
const STREAM_SCROLL_STICK_THRESHOLD_PX = 64
const THINKING_TIMER_FINE_INTERVAL_MS = 100
const THINKING_TIMER_COARSE_INTERVAL_MS = 1000
const THINKING_RAIL_MEASURE_INTERVAL_MS = 100

function isNearScrollBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STREAM_SCROLL_STICK_THRESHOLD_PX
}

function formatThinkingElapsed(seconds: number): string {
  if (seconds < 10) return seconds.toFixed(1)
  return String(Math.round(seconds))
}

const ThinkingElapsedLabel = memo(function ThinkingElapsedLabel({ active }: { active: boolean }) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const startedAtRef = useRef<number | null>(null)
  const frozenRef = useRef<number | null>(null)

  useEffect(() => {
    const node = labelRef.current
    if (!node) return

    if (!active) {
      if (startedAtRef.current != null && frozenRef.current == null) {
        frozenRef.current = (Date.now() - startedAtRef.current) / 1000
      }
      node.textContent = formatThinkingElapsed(frozenRef.current ?? 0)
      return
    }

    if (!startedAtRef.current) startedAtRef.current = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      if (!labelRef.current || !startedAtRef.current) return
      const elapsed = (Date.now() - startedAtRef.current) / 1000
      labelRef.current.textContent = formatThinkingElapsed(elapsed)
      timer = setTimeout(
        tick,
        elapsed < 10 ? THINKING_TIMER_FINE_INTERVAL_MS : THINKING_TIMER_COARSE_INTERVAL_MS,
      )
    }
    tick()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [active])

  return <span ref={labelRef} className="tabular-nums">0.0</span>
})

function ThinkingPreviewRail({
  text,
  active,
  expanded,
}: {
  text: string
  active: boolean
  expanded: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const prevExpandedRef = useRef(false)
  const prevActiveRef = useRef(active)
  const measureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMeasuredAtRef = useRef(0)
  const measureInputRef = useRef({ text, active, justCollapsed: false })

  useEffect(
    () => () => {
      if (measureTimerRef.current) clearTimeout(measureTimerRef.current)
    },
    [],
  )

  useLayoutEffect(() => {
    const justCollapsed = prevExpandedRef.current && !expanded
    const activeChanged = prevActiveRef.current !== active
    prevExpandedRef.current = expanded
    prevActiveRef.current = active
    measureInputRef.current = { text, active, justCollapsed }

    const track = trackRef.current
    const inner = innerRef.current
    if (!track || !inner) return

    const cancelScheduledMeasure = () => {
      if (!measureTimerRef.current) return
      clearTimeout(measureTimerRef.current)
      measureTimerRef.current = null
    }

    if (expanded) {
      cancelScheduledMeasure()
      return
    }

    const measure = () => {
      measureTimerRef.current = null
      lastMeasuredAtRef.current = Date.now()
      const input = measureInputRef.current
      const stopMarquee = () => {
        inner.classList.remove('speed-read-thinking-marquee')
        inner.style.removeProperty('--speed-read-marquee-duration')
      }

      if (!input.text) {
        stopMarquee()
        inner.style.removeProperty('transform')
        return
      }

      const halfWidth = inner.scrollWidth / 2
      const overflows = halfWidth > track.clientWidth + 4
      if (input.active && overflows) {
        inner.style.removeProperty('transform')
        const duration = Math.min(48, Math.max(14, input.text.length * 0.08))
        inner.style.setProperty('--speed-read-marquee-duration', `${duration}s`)
        if (input.justCollapsed || !inner.classList.contains('speed-read-thinking-marquee')) {
          inner.classList.remove('speed-read-thinking-marquee')
          void inner.offsetWidth
          inner.classList.add('speed-read-thinking-marquee')
        }
        return
      }

      stopMarquee()
      if (overflows) {
        inner.style.transform = `translate3d(${track.clientWidth - halfWidth}px, 0, 0)`
      } else {
        inner.style.removeProperty('transform')
      }
    }

    const now = Date.now()
    const elapsed = now - lastMeasuredAtRef.current
    if (!text || justCollapsed || activeChanged || elapsed >= THINKING_RAIL_MEASURE_INTERVAL_MS) {
      cancelScheduledMeasure()
      measure()
      return
    }
    if (!measureTimerRef.current) {
      measureTimerRef.current = setTimeout(
        measure,
        Math.max(THINKING_RAIL_MEASURE_INTERVAL_MS - elapsed, 0),
      )
    }
  }, [text, active, expanded])

  return (
    <div
      ref={trackRef}
      className={`speed-read-thinking-track scroll-hidden mt-1 h-[18px] max-w-full overflow-x-hidden overflow-y-hidden ${expanded ? 'hidden' : ''}`}
      aria-hidden={expanded}
    >
      <div ref={innerRef} className="speed-read-thinking-inner inline-flex whitespace-nowrap text-[11px] leading-[18px] text-paper-faint/85">
        <span>{text}</span>
        <span className="pl-8" aria-hidden>{text}</span>
      </div>
    </div>
  )
}

const SpeedReadThinkingBlock = memo(function SpeedReadThinkingBlock({
  thinking,
  loading,
  bodyStarted,
}: {
  thinking: string
  loading: boolean
  bodyStarted: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const previewText = useMemo(() => thinking.replace(/\s+/g, ' ').trim(), [thinking])
  const thinkingPhase = loading && !bodyStarted

  useEffect(() => {
    if (!previewText) setExpanded(false)
  }, [previewText])

  if (!previewText) return null

  const titlePrefix = thinkingPhase ? '思考中' : '思考过程'

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-haze/80 bg-ink-raised/45">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-haze/20"
      >
        <Lightbulb
          size={14}
          strokeWidth={1.6}
          className={`mt-0.5 shrink-0 ${thinkingPhase ? 'text-cinnabar-soft' : 'text-paper-faint'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[19px] items-center gap-2">
            <span className="text-[12.5px] font-medium text-paper">
              {titlePrefix}（用时
              <ThinkingElapsedLabel active={thinkingPhase} />
              秒）
            </span>
            {thinkingPhase && <LoaderCircle size={11} className="shrink-0 animate-spin text-cinnabar-soft" />}
          </div>
          <ThinkingPreviewRail text={previewText} active={thinkingPhase} expanded={expanded} />
        </div>
        <ChevronRight
          size={14}
          strokeWidth={1.8}
          className={`mt-0.5 shrink-0 text-paper-faint transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-haze/60 px-3 py-2.5 font-mono text-[11.5px] leading-[1.65] text-paper-faint">
          {thinking.trim()}
        </pre>
      )}
    </div>
  )
})

export function AiSpeedReadPanel({
  open,
  state,
  markdown,
  thinking,
  status,
  error,
  model,
  articleTitle,
  sourceName,
  sourceLabel,
  originUrl,
  onClose,
  onRetry,
  onCancel,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(false)
  const prevStreamStateRef = useRef<SpeedReadUiState>('idle')
  const panelToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [busyAction, setBusyAction] = useState<ActionId | null>(null)
  const [panelToast, setPanelToast] = useState<string | null>(null)
  const [shareStyle, setShareStyle] = useState<SpeedReadShareStyle>(() => loadSpeedReadShareStyle())
  const hasMarkdown = Boolean(markdown.trim())
  const safeHtml = useMemo(() => (open && hasMarkdown ? markdownToSafeHtml(markdown) : ''), [open, hasMarkdown, markdown])
  const displayTitle = useMemo(
    () => displayArticleTitle(articleTitle, { sourceName, sourceLabel }),
    [articleTitle, sourceName, sourceLabel],
  )
  const hasContent = Boolean(hasMarkdown || thinking.trim())
  const canExport = hasMarkdown && (state === 'ready' || state === 'cancelled')

  const notify = useCallback((message: string) => {
    setPanelToast(message)
    if (panelToastTimerRef.current) clearTimeout(panelToastTimerRef.current)
    panelToastTimerRef.current = setTimeout(() => setPanelToast(null), 2600)
  }, [])

  useEffect(
    () => () => {
      if (panelToastTimerRef.current) clearTimeout(panelToastTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) setPanelToast(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open || !hasMarkdown) return
    void warmupSpeedReadShareAssets()
  }, [open, hasMarkdown])

  useEffect(() => {
    if (!open) {
      prevStreamStateRef.current = 'idle'
      return
    }
    if (state === 'loading' && prevStreamStateRef.current !== 'loading') {
      stickToBottomRef.current = false
      if (contentRef.current) contentRef.current.scrollTop = 0
    }
    prevStreamStateRef.current = state
  }, [open, state])

  useEffect(() => {
    const el = contentRef.current
    if (!open || !el) return
    const onScroll = () => {
      stickToBottomRef.current = isNearScrollBottom(el)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [open])

  useEffect(() => {
    if (!open || state !== 'loading' || !contentRef.current) return
    if (!stickToBottomRef.current) return
    const el = contentRef.current
    el.scrollTop = el.scrollHeight
  }, [markdown, open, state])

  if (!open || typeof document === 'undefined') return null

  const runAction = async (action: ActionId) => {
    if (!canExport || busyAction) return
    setBusyAction(action)
    try {
      const trimmed = markdown.trim()
      if (action === 'copy') {
        const text = buildSpeedReadMarkdown({
          articleTitle,
          sourceName,
          originUrl,
          model,
          markdown: trimmed,
        })
        notify((await copyShareText(text)) ? '速读内容已复制' : '复制失败，请重试')
        return
      }

      if (action === 'export-md') {
        const file = buildSpeedReadMarkdown({
          articleTitle,
          sourceName,
          originUrl,
          model,
          markdown: trimmed,
        })
        const result = await exportMarkdownFile(
          file,
          speedReadMarkdownFileName(articleTitle),
          `${articleTitle} · AI 速读`,
        )
        if (result === 'downloaded') notify('Markdown 已下载')
        else if (result === 'shared') notify('Markdown 已导出')
        return
      }

      const imageInput = {
        articleTitle,
        sourceName,
        sourceLabel,
        model,
        markdown: trimmed,
      }
      const blob = await renderSpeedReadImageBlob(imageInput, shareStyle)
      const styleLabel = SPEED_READ_SHARE_STYLES.find((item) => item.id === shareStyle)?.label ?? shareStyle

      if (action === 'save-image') {
        const fileName = speedReadImageFileName(articleTitle, shareStyle, { unique: true })
        const result = await saveImageBlob(blob, fileName)
        if (result === 'saved') {
          notify(
            Capacitor.isNativePlatform()
              ? `「${styleLabel}」已保存到相册「有所闻」`
              : `「${styleLabel}」图片已下载`,
          )
        }
        return
      }

      const fileName = speedReadImageFileName(articleTitle, shareStyle)
      const result = await shareImageBlob(blob, fileName, `${articleTitle} · AI 速读`)
      if (result === 'shared') notify('已调起分享')
      else if (result === 'cancelled') return
    } catch (actionError) {
      if (action === 'save-image') {
        const detail = actionError instanceof Error ? actionError.message.trim() : ''
        notify(detail ? `图片保存失败：${detail}` : '图片保存失败，请重试')
        return
      }
      const message = actionError instanceof Error ? actionError.message : '操作失败，请重试'
      notify(message)
    } finally {
      setBusyAction(null)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90] flex flex-col bg-black/55 backdrop-blur-sm" data-no-page-tap>
      <div
        role="dialog"
        aria-label="AI 速读"
        className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col bg-ink shadow-2xl"
        style={{
          marginTop: 'max(var(--sat), 12px)',
          marginBottom: 'max(var(--sab), 12px)',
          maxHeight: 'calc(100dvh - max(var(--sat), 12px) - max(var(--sab), 12px))',
        }}
      >
        <div className="flex items-center gap-3 border-b border-haze px-4 py-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cinnabar/10 text-cinnabar-soft">
            <ScrollText size={17} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold tracking-[0.01em] text-paper">AI 速读</h2>
              {state === 'loading' && (
                <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] text-cinnabar-soft">
                  <LoaderCircle size={10} className="animate-spin" />
                  生成中
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono text-[9.5px] tracking-[0.06em] text-paper-faint">
              {displayTitle}
              {model ? ` · ${model}` : ''}
            </p>
          </div>
          {state === 'loading' && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-haze px-2.5 font-mono text-[10px] text-paper-muted hover:border-cinnabar/35 hover:text-paper"
            >
              <Square size={10} fill="currentColor" strokeWidth={1.5} />
              停止
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭 AI 速读"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper-faint hover:bg-haze hover:text-paper"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div ref={contentRef} className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {state === 'error' ? (
            <div role="alert" className="rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-4">
              <p className="text-[13px] leading-relaxed text-cinnabar-soft">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cinnabar/35 bg-cinnabar/10 px-2.5 py-1.5 font-mono text-[10.5px] text-cinnabar-soft hover:bg-cinnabar/15"
              >
                <RefreshCw size={11} strokeWidth={1.8} />
                重新生成
              </button>
            </div>
          ) : (
            <>
              {thinking.trim() && (
                <SpeedReadThinkingBlock
                  thinking={thinking}
                  loading={state === 'loading'}
                  bodyStarted={Boolean(markdown.trim())}
                />
              )}

              {safeHtml ? (
                <div
                  className="speed-read-markdown text-[15px] leading-[1.82] text-paper-muted [&_h2]:mt-6 [&_h2]:mb-2.5 [&_h2]:font-mono [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:tracking-[0.12em] [&_h2]:text-paper [&_h2:first-child]:mt-0 [&_p]:my-2.5 [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-0.5 [&_strong]:font-semibold [&_strong]:text-paper [&_a]:text-cinnabar-soft [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-ink [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-cinnabar/35 [&_blockquote]:pl-3 [&_blockquote]:text-paper-faint"
                  dangerouslySetInnerHTML={{ __html: safeHtml }}
                />
              ) : (
                <div className="flex items-center gap-2 py-6 font-mono text-[11px] text-paper-faint">
                  <LoaderCircle size={13} className={state === 'loading' ? 'animate-spin text-cinnabar-soft' : ''} />
                  {state === 'cancelled' ? '生成已停止' : status || '正在阅读全文并提炼重点…'}
                </div>
              )}

              {state === 'loading' && (safeHtml || thinking.trim()) && (
                <span className="mt-2 inline-block h-4 w-[2px] animate-pulse rounded-full bg-cinnabar-soft" aria-hidden />
              )}

              {state === 'cancelled' && hasContent && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-haze pt-4">
                  <span className="font-mono text-[10px] text-paper-faint">已停止生成，以上可能是不完整内容</span>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="shrink-0 font-mono text-[10px] text-cinnabar-soft hover:text-cinnabar"
                  >
                    重新生成
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div
          className="shrink-0 border-t border-haze bg-ink/95 px-4 py-3 backdrop-blur-md"
          style={{ paddingBottom: 'max(var(--sab), 12px)' }}
        >
          <div className="mb-2.5">
            <p className="mb-1.5 font-mono text-[9px] tracking-[0.1em] text-paper-faint">分享图风格</p>
            <div className="scroll-hidden flex gap-1.5 overflow-x-auto pb-0.5">
              {SPEED_READ_SHARE_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={!canExport}
                  onClick={() => {
                    setShareStyle(item.id)
                    saveSpeedReadShareStyle(item.id)
                  }}
                  className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-[10px] transition-colors disabled:opacity-35 ${
                    shareStyle === item.id
                      ? 'border-cinnabar/50 bg-cinnabar/15 text-paper'
                      : 'border-haze bg-ink-raised/50 text-paper-muted hover:border-cinnabar/25 hover:text-paper'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              disabled={!canExport || Boolean(busyAction)}
              onClick={() => void runAction('copy')}
              className={ACTION_BUTTON_CLASS}
            >
              {busyAction === 'copy' ? <LoaderCircle size={14} className="animate-spin" /> : <Copy size={14} />}
              复制
            </button>
            <button
              type="button"
              disabled={!canExport || Boolean(busyAction)}
              onClick={() => void runAction('export-md')}
              className={ACTION_BUTTON_CLASS}
            >
              {busyAction === 'export-md' ? <LoaderCircle size={14} className="animate-spin" /> : <FileDown size={14} />}
              导出 MD
            </button>
            <button
              type="button"
              disabled={!canExport || Boolean(busyAction)}
              onClick={() => void runAction('save-image')}
              className={ACTION_BUTTON_CLASS}
            >
              {busyAction === 'save-image' ? (
                <LoaderCircle size={14} className="animate-spin" />
              ) : (
                <ImageDown size={14} />
              )}
              保存图片
            </button>
            <button
              type="button"
              disabled={!canExport || Boolean(busyAction)}
              onClick={() => void runAction('share-image')}
              className={ACTION_BUTTON_CLASS}
            >
              {busyAction === 'share-image' ? <LoaderCircle size={14} className="animate-spin" /> : <Share2 size={14} />}
              分享图片
            </button>
          </div>
        </div>
      </div>
      </div>
      {panelToast && (
        <div
          className="pointer-events-none fixed inset-x-0 z-[100] flex justify-center px-4"
          style={{ bottom: 'calc(max(var(--sab), 12px) + 96px)' }}
          role="status"
          aria-live="polite"
        >
          <span className="max-w-[min(100%,24rem)] rounded-full border border-haze bg-ink/95 px-3.5 py-2 text-center font-mono text-[11.5px] leading-snug text-paper shadow-xl backdrop-blur-md">
            {panelToast}
          </span>
        </div>
      )}
    </>,
    document.body,
  )
}
