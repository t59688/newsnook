import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CloudUpload, XCircle } from 'lucide-react'

import type { SyncToastModel, SyncToastTone } from '../features/sync/notifier'

const TONE_ICON: Record<SyncToastTone, typeof CloudUpload> = {
  info: CloudUpload,
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
}

const TONE_CLASS: Record<SyncToastTone, string> = {
  info: 'text-paper-muted',
  success: 'text-paper',
  warn: 'text-cinnabar-soft',
  error: 'text-cinnabar-soft',
}

/** 普通提示自动消失；需要用户处理的（冲突 / 重新登录）留久一点 */
const AUTO_DISMISS_MS: Record<SyncToastTone, number> = {
  info: 2600,
  success: 3000,
  warn: 6000,
  error: 6000,
}

interface Props {
  toast: SyncToastModel | null
  onDismiss: () => void
  onAction?: () => void
}

/**
 * 同步的应用内提示条。前台永远优先用它，而不是系统通知栏——
 * 后台通知只留给首次同步完成、连续失败与待处理冲突（见 features/sync/notifier）。
 */
export function SyncToast({ toast, onDismiss, onAction }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) {
      setVisible(false)
      return
    }
    setVisible(true)
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS[toast.tone])
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])

  if (!toast) return null

  const Icon = TONE_ICON[toast.tone]

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: 'calc(var(--sab) + 84px)' }}
    >
      <div
        className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full border border-haze bg-ink-raised px-4 py-2.5 shadow-[var(--shadow-lift)] transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
      >
        <Icon size={15} strokeWidth={1.6} className={`shrink-0 ${TONE_CLASS[toast.tone]}`} />
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-paper">{toast.text}</span>
        {toast.action && onAction && (
          <button
            type="button"
            onClick={() => {
              onAction()
              onDismiss()
            }}
            className="shrink-0 rounded-full border border-cinnabar/70 bg-cinnabar/15 px-3 py-1 font-mono text-[10.5px] text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
          >
            {toast.actionLabel ?? '处理'}
          </button>
        )}
      </div>
    </div>
  )
}
