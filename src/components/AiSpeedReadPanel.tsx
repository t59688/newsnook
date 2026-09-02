import { useMemo } from 'react'
import { LoaderCircle, RefreshCw, ScrollText, Square, X } from 'lucide-react'

import { markdownToSafeHtml } from '../lib/markdown'

export type SpeedReadUiState = 'idle' | 'loading' | 'ready' | 'error' | 'cancelled'

interface Props {
  open: boolean
  state: SpeedReadUiState
  markdown: string
  error: string
  model?: string
  onClose: () => void
  onRetry: () => void
  onCancel: () => void
}

export function AiSpeedReadPanel({
  open,
  state,
  markdown,
  error,
  model,
  onClose,
  onRetry,
  onCancel,
}: Props) {
  const safeHtml = useMemo(() => markdownToSafeHtml(markdown), [markdown])
  if (!open) return null

  return (
    <section
      data-reader-block
      className="page-x lg:px-8 mt-4"
      aria-label="AI 速读"
    >
      <div className="overflow-hidden rounded-2xl border border-cinnabar/25 bg-ink-raised/70 shadow-xl">
        <div className="flex items-center gap-3 border-b border-haze px-4 py-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-cinnabar/10 text-cinnabar-soft">
            <ScrollText size={16} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold tracking-[0.01em] text-paper">AI 速读</h2>
              {state === 'loading' && (
                <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] text-cinnabar-soft">
                  <LoaderCircle size={10} className="animate-spin" />
                  生成中
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate font-mono text-[9.5px] tracking-[0.06em] text-paper-faint">
              {model ? `${model} · 仅基于当前原文` : '请先在「我的 → 翻译」配置 AI 速读模型'}
            </p>
          </div>
          {state === 'loading' && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-haze px-2.5 font-mono text-[10px] text-paper-muted hover:border-cinnabar/35 hover:text-paper"
            >
              <Square size={10} fill="currentColor" strokeWidth={1.5} />
              停止
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="收起 AI 速读"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-paper-faint hover:bg-haze hover:text-paper"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        <div className="px-4 py-4 sm:px-5">
          {state === 'error' ? (
            <div role="alert" className="rounded-xl border border-cinnabar/30 bg-cinnabar/10 p-3.5">
              <p className="text-[12.5px] leading-relaxed text-cinnabar-soft">{error}</p>
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
              className="speed-read-markdown text-[13.5px] leading-[1.78] text-paper-muted [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-mono [&_h2]:text-[11px] [&_h2]:font-semibold [&_h2]:tracking-[0.12em] [&_h2]:text-paper [&_h2:first-child]:mt-0 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_li]:pl-0.5 [&_strong]:font-semibold [&_strong]:text-paper [&_a]:text-cinnabar-soft [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-ink [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-cinnabar/35 [&_blockquote]:pl-3 [&_blockquote]:text-paper-faint"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <div className="flex items-center gap-2 py-2 font-mono text-[10.5px] text-paper-faint">
              <LoaderCircle size={12} className={state === 'loading' ? 'animate-spin text-cinnabar-soft' : ''} />
              {state === 'cancelled' ? '生成已停止' : '正在阅读全文并提炼重点…'}
            </div>
          )}

          {state === 'loading' && safeHtml && (
            <span className="mt-1 inline-block h-4 w-[2px] animate-pulse rounded-full bg-cinnabar-soft" aria-hidden />
          )}

          {state === 'cancelled' && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-haze pt-3">
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
      </div>
    </section>
  )
}
