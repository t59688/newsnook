import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Copy,
  FileDown,
  ImageDown,
  LoaderCircle,
  RefreshCw,
  ScrollText,
  Share2,
  Square,
  X,
} from 'lucide-react'

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
  error: string
  model?: string
  articleTitle: string
  sourceName: string
  sourceLabel?: string
  originUrl?: string
  onClose: () => void
  onRetry: () => void
  onCancel: () => void
  onNotify: (message: string) => void
}

const ACTION_BUTTON_CLASS =
  'flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-haze bg-ink-raised/70 px-3 font-mono text-[10.5px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-paper disabled:opacity-35'

export function AiSpeedReadPanel({
  open,
  state,
  markdown,
  error,
  model,
  articleTitle,
  sourceName,
  sourceLabel,
  originUrl,
  onClose,
  onRetry,
  onCancel,
  onNotify,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [busyAction, setBusyAction] = useState<ActionId | null>(null)
  const [shareStyle, setShareStyle] = useState<SpeedReadShareStyle>(() => loadSpeedReadShareStyle())
  const safeHtml = useMemo(() => markdownToSafeHtml(markdown), [markdown])
  const displayTitle = useMemo(
    () => displayArticleTitle(articleTitle, { sourceName, sourceLabel }),
    [articleTitle, sourceName, sourceLabel],
  )
  const hasContent = Boolean(markdown.trim())
  const canExport = hasContent && (state === 'ready' || state === 'cancelled')

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open || !markdown.trim()) return
    void warmupSpeedReadShareAssets()
  }, [open, markdown])

  useEffect(() => {
    if (!open || state !== 'loading' || !contentRef.current) return
    contentRef.current.scrollTop = contentRef.current.scrollHeight
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
        onNotify((await copyShareText(text)) ? '速读内容已复制' : '复制失败，请重试')
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
        if (result === 'downloaded') onNotify('Markdown 已下载')
        else if (result === 'shared') onNotify('Markdown 已导出')
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
      const fileName = speedReadImageFileName(articleTitle)

      if (action === 'save-image') {
        await saveImageBlob(blob, fileName)
        onNotify('图片已保存')
        return
      }

      const result = await shareImageBlob(blob, fileName, `${articleTitle} · AI 速读`)
      if (result === 'shared') onNotify('已调起分享')
      else if (result === 'cancelled') return
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : '操作失败，请重试'
      onNotify(message)
    } finally {
      setBusyAction(null)
    }
  }

  return createPortal(
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
          ) : safeHtml ? (
            <div
              className="speed-read-markdown text-[15px] leading-[1.82] text-paper-muted [&_h2]:mt-6 [&_h2]:mb-2.5 [&_h2]:font-mono [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:tracking-[0.12em] [&_h2]:text-paper [&_h2:first-child]:mt-0 [&_p]:my-2.5 [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-0.5 [&_strong]:font-semibold [&_strong]:text-paper [&_a]:text-cinnabar-soft [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-ink [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-cinnabar/35 [&_blockquote]:pl-3 [&_blockquote]:text-paper-faint"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <div className="flex items-center gap-2 py-6 font-mono text-[11px] text-paper-faint">
              <LoaderCircle size={13} className={state === 'loading' ? 'animate-spin text-cinnabar-soft' : ''} />
              {state === 'cancelled' ? '生成已停止' : '正在阅读全文并提炼重点…'}
            </div>
          )}

          {state === 'loading' && safeHtml && (
            <span className="mt-2 inline-block h-4 w-[2px] animate-pulse rounded-full bg-cinnabar-soft" aria-hidden />
          )}

          {state === 'cancelled' && (
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
    </div>,
    document.body,
  )
}
