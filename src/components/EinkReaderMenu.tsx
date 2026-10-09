import { BookmarkCheck, BookmarkPlus, Languages, List, Settings2, Share2, Type, X } from 'lucide-react'

import { FONT_SCALE_OPTIONS } from '../sources/preferences'

interface Props {
  open: boolean
  pageIndex: number
  pageCount: number
  fontScale: number
  saved: boolean
  translating: boolean
  showTranslation: boolean
  onClose: () => void
  onFontScale: (next: number) => void
  onJumpPage: (index: number) => void
  onToggleTranslation: () => void
  onToggleLater: () => void
  onShare: () => void
  onBackToList: () => void
  onOpenSettings: () => void
}

function neighborScale(current: number, delta: -1 | 1): number {
  const values = FONT_SCALE_OPTIONS.map((o) => o.value)
  let idx = values.findIndex((v) => Math.abs(v - current) < 0.001)
  if (idx < 0) {
    idx = values.reduce(
      (best, v, i) => (Math.abs(v - current) < Math.abs(values[best]! - current) ? i : best),
      0,
    )
  }
  return values[Math.min(Math.max(idx + delta, 0), values.length - 1)]!
}

export function EinkReaderMenu({
  open,
  pageIndex,
  pageCount,
  fontScale,
  saved,
  translating,
  showTranslation,
  onClose,
  onFontScale,
  onJumpPage,
  onToggleTranslation,
  onToggleLater,
  onShare,
  onBackToList,
  onOpenSettings,
}: Props) {
  if (!open) return null

  const scaleLabel =
    FONT_SCALE_OPTIONS.find((o) => Math.abs(o.value - fontScale) < 0.001)?.label ?? '自定义'
  const safeCount = Math.max(pageCount, 1)

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-no-page-tap>
      <button
        type="button"
        aria-label="关闭阅读菜单"
        className="min-h-0 flex-1 bg-ink/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="阅读菜单"
        className="shrink-0 border-t border-haze bg-ink pt-3"
        style={{ paddingBottom: 'calc(var(--sab) + 12px)' }}
      >
        <div className="page-x mx-auto w-full max-w-3xl space-y-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">阅读菜单</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="flex h-8 w-8 items-center justify-center text-paper-muted"
            >
              <X size={16} strokeWidth={1.7} />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Type size={15} strokeWidth={1.6} className="shrink-0 text-paper-muted" />
            <button
              type="button"
              aria-label="减小字号"
              onClick={() => onFontScale(neighborScale(fontScale, -1))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-haze font-mono text-[16px] text-paper"
            >
              −
            </button>
            <span className="min-w-0 flex-1 text-center font-mono text-[12px] text-paper-muted">
              字号 · {scaleLabel}
            </span>
            <button
              type="button"
              aria-label="增大字号"
              onClick={() => onFontScale(neighborScale(fontScale, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-haze font-mono text-[16px] text-paper"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="第一页"
              disabled={pageIndex <= 0}
              onClick={() => onJumpPage(0)}
              className="shrink-0 font-mono text-[11px] text-paper-muted disabled:opacity-35"
            >
              首页
            </button>
            <input
              type="range"
              min={0}
              max={safeCount - 1}
              step={1}
              value={Math.min(pageIndex, safeCount - 1)}
              onChange={(e) => onJumpPage(Number(e.target.value))}
              aria-label="阅读进度"
              className="min-w-0 flex-1 accent-[var(--color-cinnabar)]"
            />
            <button
              type="button"
              aria-label="最后一页"
              disabled={pageIndex >= safeCount - 1}
              onClick={() => onJumpPage(safeCount - 1)}
              className="shrink-0 font-mono text-[11px] text-paper-muted disabled:opacity-35"
            >
              末页
            </button>
          </div>
          <p className="text-center font-mono text-[11px] tracking-[0.08em] text-paper-faint">
            {pageIndex + 1} / {safeCount}
          </p>

          <div className="grid grid-cols-5 gap-2">
            <button
              type="button"
              disabled={translating}
              onClick={onToggleTranslation}
              className="flex flex-col items-center gap-1 rounded-xl border border-haze px-2 py-2.5 disabled:opacity-40"
            >
              <Languages
                size={15}
                strokeWidth={1.7}
                className={showTranslation ? 'text-cinnabar' : 'text-paper-muted'}
              />
              <span className="font-mono text-[11px] text-paper">
                {showTranslation ? '原文' : '翻译'}
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleLater}
              className="flex flex-col items-center gap-1 rounded-xl border border-haze px-2 py-2.5"
            >
              {saved ? (
                <BookmarkCheck size={15} strokeWidth={1.7} className="text-cinnabar" />
              ) : (
                <BookmarkPlus size={15} strokeWidth={1.7} className="text-paper-muted" />
              )}
              <span className="font-mono text-[11px] text-paper">{saved ? '已藏' : '稍后'}</span>
            </button>
            <button
              type="button"
              onClick={onShare}
              className="flex flex-col items-center gap-1 rounded-xl border border-haze px-2 py-2.5"
            >
              <Share2 size={15} strokeWidth={1.7} className="text-paper-muted" />
              <span className="font-mono text-[11px] text-paper">分享</span>
            </button>
            <button
              type="button"
              onClick={onBackToList}
              className="flex flex-col items-center gap-1 rounded-xl border border-haze px-2 py-2.5"
            >
              <List size={15} strokeWidth={1.7} className="text-paper-muted" />
              <span className="font-mono text-[11px] text-paper">列表</span>
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex flex-col items-center gap-1 rounded-xl border border-haze px-2 py-2.5"
            >
              <Settings2 size={15} strokeWidth={1.7} className="text-paper-muted" />
              <span className="font-mono text-[11px] text-paper">设置</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
