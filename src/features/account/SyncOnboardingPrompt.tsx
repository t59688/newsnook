import { CloudUpload, X } from 'lucide-react'

/**
 * 同步介绍：只出现一次，且刻意不做成引导流程的一步。
 * 功能引导（driver.js）讲的是「无需账号也能用」，这里才是可选的加分项，
 * 两个动作都会记下 `newsnook:sync-onboarding-seen`，之后再也不打扰。
 */
interface Props {
  open: boolean
  onSignIn: () => void
  onDismiss: () => void
}

export function SyncOnboardingPrompt({ open, onSignIn, onDismiss }: Props) {
  if (!open) return null

  return (
    <div
      className="fixed inset-x-0 z-[65] flex justify-center px-4"
      style={{ bottom: 'calc(var(--sab) + 84px)' }}
    >
      <div className="w-full max-w-md rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
        <div className="flex items-start gap-3">
          <CloudUpload size={18} strokeWidth={1.6} className="mt-0.5 shrink-0 text-paper-muted" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-paper">跨设备同步你的有所闻</p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-paper-faint">
              登录后可以同步订阅源、分类与排序、应用配置。不登录也能完整使用，正文、缓存与阅读记录始终只留在本机。
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭"
            className="-mr-1 -mt-1 shrink-0 p-1 text-paper-faint hover:text-paper"
          >
            <X size={15} strokeWidth={1.6} />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full border border-haze px-4 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper"
          >
            稍后再说
          </button>
          <button
            type="button"
            onClick={onSignIn}
            className="rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
          >
            登录并开启同步
          </button>
        </div>
      </div>
    </div>
  )
}
