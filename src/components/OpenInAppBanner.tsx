import { Smartphone, X } from 'lucide-react'

interface Props {
  /** 深链地址（intent:// 或 newsnook://），由 lib/appDeepLink 拼好 */
  href: string
  onDismiss: () => void
}

/**
 * 分享落地页的「在 App 中打开」引导条。
 * 只是一个普通链接：已装 App 时由系统唤起并打开同一篇文章；
 * 未安装或被浏览器拦截时点击无事发生，网页阅读不受影响。
 */
export function OpenInAppBanner({ href, onDismiss }: Props) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
      style={{ bottom: 'calc(var(--sab) + 18px)' }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-haze bg-ink-raised/95 py-1 pl-1.5 pr-1 shadow-lg backdrop-blur">
        <a
          href={href}
          className="flex items-center gap-1.5 rounded-full bg-cinnabar/15 px-3 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft"
        >
          <Smartphone size={13} strokeWidth={1.8} />
          在「有所闻」App 中打开
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          className="flex h-7 w-7 items-center justify-center text-paper-faint transition-colors hover:text-paper"
        >
          <X size={14} strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}
