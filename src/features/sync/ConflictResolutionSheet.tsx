import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import type { SyncConflict, SyncConflictResolution, SyncEntityType } from '@newsnook/contracts'
import {
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  FolderTree,
  KeyRound,
  LoaderCircle,
  Rss,
  Settings2,
  X,
} from 'lucide-react'

import {
  CONFLICT_ENTITY_LABEL,
  conflictReasonText,
  conflictTitle,
  decidedCount,
  describeConflictSides,
  filterConflicts,
  materializeDecisions,
  nextUndecidedIndex,
  stageBulkDecision,
  stageDecision,
  summarizeConflicts,
  type ConflictDecisions,
  type ConflictScope,
} from './conflictView'
import { describeSyncError } from './notifier'

const ENTITY_ICON: Record<SyncEntityType, typeof Rss> = {
  subscription: Rss,
  category: FolderTree,
  setting: Settings2,
  secret: KeyRound,
}

const CHIP_BASE =
  'shrink-0 rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors disabled:opacity-40'
const BULK_BUTTON =
  'flex-1 rounded-xl border border-haze px-3 py-2 text-[12px] text-paper-muted transition-colors hover:border-paper-faint hover:text-paper disabled:opacity-40'

interface Props {
  open: boolean
  conflicts: SyncConflict[]
  /** 把整批决定交给同步引擎；onProgress 驱动面板上的应用进度 */
  onApply: (
    decisions: Array<{ id: string; resolution: SyncConflictResolution }>,
    onProgress: (done: number, total: number) => void,
  ) => Promise<void>
  onClose: () => void
}

type Phase = 'review' | 'applying' | 'done'

/**
 * 冲突裁决面板：摘要 → 按类分组 → 逐项裁决（一次只看一处）→ 一次应用。
 *
 * 刻意不做成把每处冲突都平铺出来的长列表：几十处冲突时那只是压力，
 * 不是信息。批量按钮负责「全都要某一边」的多数情形，卡片翻页负责少数
 * 真正需要逐条看的裁决，最后统一应用并给出进度与完成态。
 */
export function ConflictResolutionSheet({ open, conflicts, onApply, onClose }: Props) {
  const titleId = useId()
  const [decisions, setDecisions] = useState<ConflictDecisions>({})
  const [scope, setScope] = useState<ConflictScope>('all')
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('review')
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 })
  const [appliedCount, setAppliedCount] = useState(0)
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDecisions({})
    setScope('all')
    setIndex(0)
    setPhase('review')
    setApplyError(null)
    setAppliedCount(0)
  }, [open])

  const applying = phase === 'applying'

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !applying) onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, applying, onClose])

  const summary = useMemo(() => summarizeConflicts(conflicts), [conflicts])
  const scoped = useMemo(() => filterConflicts(conflicts, scope), [conflicts, scope])
  const decided = decidedCount(conflicts, decisions)

  // 队列在应用途中会缩短，作用域也可能被清空：始终把游标夹回有效范围
  const safeIndex = scoped.length ? Math.min(index, scoped.length - 1) : 0
  const current = scoped[safeIndex] ?? null

  useEffect(() => {
    if (scope !== 'all' && !scoped.length && conflicts.length) setScope('all')
  }, [scope, scoped.length, conflicts.length])

  const choose = useCallback(
    (conflictId: string, resolution: SyncConflictResolution) => {
      setDecisions((previous) => {
        const already = previous[conflictId]
        const next = stageDecision(previous, conflictId, already === resolution ? null : resolution)
        if (already !== resolution) {
          const advance = nextUndecidedIndex(scoped, next, safeIndex)
          if (advance >= 0) setIndex(advance)
        }
        return next
      })
    },
    [scoped, safeIndex],
  )

  const bulk = useCallback(
    (resolution: SyncConflictResolution) => {
      setDecisions((previous) => stageBulkDecision(previous, conflicts, resolution, scope))
    },
    [conflicts, scope],
  )

  const apply = useCallback(async () => {
    const payload = materializeDecisions(conflicts, decisions)
    if (!payload.length) return
    setPhase('applying')
    setApplyError(null)
    setApplyProgress({ done: 0, total: payload.length })
    try {
      await onApply(payload, (done, total) => setApplyProgress({ done, total }))
      setAppliedCount(payload.length)
      setDecisions({})
      setPhase('done')
    } catch (error: unknown) {
      setApplyError(describeSyncError(error, '有些决定没能应用，稍后可以重试'))
      setPhase('review')
    }
  }, [conflicts, decisions, onApply])

  if (!open) return null

  const allSettled = conflicts.length === 0
  const showDone = phase === 'done' || (phase === 'review' && allSettled)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center md:p-4"
      role="presentation"
      onClick={() => {
        if (!applying) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(92dvh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
        style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-haze" />
        </div>

        <header className="shrink-0 px-5 pt-2 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={titleId} className="font-display text-[18px] font-medium text-paper">
                解决同步冲突
              </h3>
              <p className="mt-1 font-mono text-[10.5px] tracking-[0.08em] text-paper-faint">
                {allSettled
                  ? '队列已清空'
                  : `共 ${summary.total} 处 · 已决定 ${decided} 处 · 应用前随时可改`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={applying}
              aria-label="关闭"
              className="-mr-1.5 -mt-1 shrink-0 rounded-full p-1.5 text-paper-faint transition-colors hover:text-paper disabled:opacity-40"
            >
              <X size={17} strokeWidth={1.6} />
            </button>
          </div>

          {/* 进度：审阅阶段显示已决定占比，应用阶段显示提交进度 */}
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-haze" aria-hidden>
            <div
              className="h-full rounded-full bg-cinnabar transition-[width] duration-300"
              style={{
                width: `${
                  applying
                    ? applyProgress.total
                      ? (applyProgress.done / applyProgress.total) * 100
                      : 0
                    : summary.total
                      ? (decided / summary.total) * 100
                      : 100
                }%`,
              }}
            />
          </div>
        </header>

        <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
          {applying && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <LoaderCircle size={22} className="animate-spin text-paper-muted" />
              <p className="text-[13.5px] text-paper">
                正在应用 {applyProgress.done} / {applyProgress.total} 项决定…
              </p>
              <p className="text-[11.5px] text-paper-faint">应用完成后会自动同步一次</p>
            </div>
          )}

          {!applying && showDone && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-cinnabar/50 bg-cinnabar/10">
                <CheckCheck size={22} strokeWidth={1.8} className="text-cinnabar-soft" />
              </span>
              <p className="text-[15px] font-medium text-paper">
                {appliedCount > 0 ? `已应用 ${appliedCount} 项决定` : '没有需要处理的冲突'}
              </p>
              {conflicts.length > 0 ? (
                <>
                  <p className="text-[12px] text-paper-muted">
                    还有 {conflicts.length} 处待处理，可以现在继续，也可以下次再来。
                  </p>
                  <button
                    type="button"
                    onClick={() => setPhase('review')}
                    className="mt-1 rounded-full border border-cinnabar/70 bg-cinnabar/15 px-5 py-2 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
                  >
                    继续处理
                  </button>
                </>
              ) : (
                <p className="text-[12px] text-paper-muted">两台设备的配置已经一致。</p>
              )}
            </div>
          )}

          {!applying && !showDone && (
            <>
              {applyError && (
                <p className="mb-3 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-[12px] leading-relaxed text-cinnabar-soft">
                  {applyError}
                </p>
              )}

              {/* 按类分组：几十处冲突先收成几个数字 */}
              <div className="scroll-hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    setScope('all')
                    setIndex(0)
                  }}
                  className={`${CHIP_BASE} ${
                    scope === 'all'
                      ? 'border-cinnabar/70 bg-cinnabar/15 text-cinnabar-soft'
                      : 'border-haze text-paper-muted hover:text-paper'
                  }`}
                >
                  全部 {summary.total}
                </button>
                {summary.groups.map(({ entityType, count }) => (
                  <button
                    key={entityType}
                    type="button"
                    onClick={() => {
                      setScope(entityType)
                      setIndex(0)
                    }}
                    className={`${CHIP_BASE} ${
                      scope === entityType
                        ? 'border-cinnabar/70 bg-cinnabar/15 text-cinnabar-soft'
                        : 'border-haze text-paper-muted hover:text-paper'
                    }`}
                  >
                    {CONFLICT_ENTITY_LABEL[entityType]} {count}
                  </button>
                ))}
              </div>

              {/* 批量：多数场景其实是「这一类全都要某一边」 */}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => bulk('accept_local')} className={BULK_BUTTON}>
                  <CloudUpload size={13} strokeWidth={1.6} className="mr-1.5 inline align-[-2px]" />
                  {scope === 'all' ? '全部用本机' : `${CONFLICT_ENTITY_LABEL[scope]}全用本机`}
                </button>
                <button type="button" onClick={() => bulk('accept_server')} className={BULK_BUTTON}>
                  <CloudDownload size={13} strokeWidth={1.6} className="mr-1.5 inline align-[-2px]" />
                  {scope === 'all' ? '全部用云端' : `${CONFLICT_ENTITY_LABEL[scope]}全用云端`}
                </button>
              </div>

              {/* 逐项裁决：一次只专注一处，翻页代替无限滚动 */}
              {current && (
                <div className="mt-4 rounded-2xl border border-haze bg-ink p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">
                      第 {safeIndex + 1} / {scoped.length} 处
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setIndex((safeIndex - 1 + scoped.length) % scoped.length)}
                        disabled={scoped.length < 2}
                        aria-label="上一处"
                        className="rounded-full border border-haze p-1.5 text-paper-muted transition-colors hover:text-paper disabled:opacity-30"
                      >
                        <ChevronLeft size={14} strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIndex((safeIndex + 1) % scoped.length)}
                        disabled={scoped.length < 2}
                        aria-label="下一处"
                        className="rounded-full border border-haze p-1.5 text-paper-muted transition-colors hover:text-paper disabled:opacity-30"
                      >
                        <ChevronRight size={14} strokeWidth={1.8} />
                      </button>
                    </span>
                  </div>

                  <ConflictCard
                    conflict={current}
                    decision={decisions[current.id] ?? null}
                    onChoose={choose}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {!applying && !showDone && (
          <footer className="shrink-0 border-t border-haze/60 px-5 pt-3">
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-paper-faint">
                {decided > 0
                  ? `已决定 ${decided} / ${summary.total} 处，未决定的会留在队列里`
                  : '先选一边，或用上面的批量按钮'}
              </p>
              <button
                type="button"
                disabled={decided === 0}
                onClick={() => void apply()}
                className="shrink-0 rounded-full border border-cinnabar/70 bg-cinnabar/15 px-5 py-2.5 font-mono text-[11.5px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-40"
              >
                {decided > 0 ? `应用 ${decided} 项决定` : '应用决定'}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

function ConflictCard({
  conflict,
  decision,
  onChoose,
}: {
  conflict: SyncConflict
  decision: SyncConflictResolution | null
  onChoose: (conflictId: string, resolution: SyncConflictResolution) => void
}) {
  const sides = describeConflictSides(conflict)
  const EntityIcon = ENTITY_ICON[conflict.entityType]

  return (
    <>
      <div className="mt-3 flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-haze bg-ink-raised">
          <EntityIcon size={15} strokeWidth={1.6} className="text-paper-muted" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-medium text-paper">{conflictTitle(conflict)}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-paper-faint">
            {CONFLICT_ENTITY_LABEL[conflict.entityType]} · {conflictReasonText(conflict.reason)}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <SideOption
          heading="用本机的"
          icon={CloudUpload}
          view={sides.local}
          selected={decision === 'accept_local'}
          onClick={() => onChoose(conflict.id, 'accept_local')}
        />
        <SideOption
          heading="用云端的"
          icon={CloudDownload}
          view={sides.server}
          selected={decision === 'accept_server'}
          onClick={() => onChoose(conflict.id, 'accept_server')}
        />
      </div>
    </>
  )
}

function SideOption({
  heading,
  icon: Icon,
  view,
  selected,
  onClick,
}: {
  heading: string
  icon: typeof CloudUpload
  view: { action: string; detail: string | null }
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-[92px] rounded-xl border p-3 text-left transition-colors ${
        selected
          ? 'border-cinnabar/80 bg-cinnabar/10'
          : 'border-haze bg-ink-raised hover:border-paper-faint'
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.12em] ${
            selected ? 'text-cinnabar-soft' : 'text-paper-faint'
          }`}
        >
          <Icon size={13} strokeWidth={1.6} />
          {heading}
        </span>
        {selected && <Check size={14} strokeWidth={2.2} className="shrink-0 text-cinnabar" />}
      </span>
      <span className="mt-2 block text-[12.5px] leading-snug text-paper">{view.action}</span>
      {view.detail && (
        <span className="mt-1 block text-[11px] leading-relaxed text-paper-faint">{view.detail}</span>
      )}
    </button>
  )
}
