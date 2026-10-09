import { MarkdownBody } from '../../components/MarkdownBody'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'

import type { LatestReleaseInfo } from './types'

const DIALOG_CANCEL_CLASS =
  'rounded-full border border-haze bg-transparent px-4 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper'

const DIALOG_CONFIRM_CLASS =
  'rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-35'

type Props = {
  open: boolean
  release: LatestReleaseInfo | null
  localVersion: string
  onUpdate: () => void
  onLater: () => void
  onSkip: () => void
  allowPermanentSkip?: boolean
}

/** 发现新版本弹框：立即更新 / 稍后 / 跳过此版本 */
export function UpdateDialog({ open, release, localVersion, onUpdate, onLater, onSkip, allowPermanentSkip = false }: Props) {
  useHardwareBackLayer(open && Boolean(release), () => {
    onLater()
    return true
  })
  if (!open || !release) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onLater}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        className="w-full max-w-sm rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="app-update-title" className="font-display text-[17px] font-medium text-paper">
          发现新版本 v{release.version}
        </h3>
        <div className="mt-2 text-[12.5px] leading-relaxed text-paper-muted">
          <p>
            当前 v{localVersion} → 新版 v{release.version}
          </p>
          {release.notes ? (
            <MarkdownBody markdown={release.notes} className="mt-2 max-h-40 overflow-y-auto text-[12px]" />
          ) : null}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button type="button" onClick={onLater} className={DIALOG_CANCEL_CLASS}>
            稍后提醒
          </button>
          <button type="button" onClick={onUpdate} className={DIALOG_CONFIRM_CLASS}>
            立即更新
          </button>
        </div>
        {allowPermanentSkip ? (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={onSkip}
              className="font-mono text-[11px] text-paper-faint transition-colors hover:text-paper-muted"
            >
              不再提醒此版本
            </button>
          </div>
        ) : (
          <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-paper-faint">
            稍后仍可从“我的 → 关于 → 检查更新”继续更新
          </p>
        )}
      </div>
    </div>
  )
}
