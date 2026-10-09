import { Download, Smartphone, X } from 'lucide-react'

interface Props {
  href: string
  onDismiss: () => void
}

/** Web 专用的 Android App 下载提示；原生 Capacitor 壳不会挂载本组件。 */
export function WebAppDownloadBanner({ href, onDismiss }: Props) {
  return (
    <aside
      aria-label="手机 App 下载"
      className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3"
    >
      <div className="pointer-events-auto flex max-w-[calc(100vw-24px)] items-center gap-2 rounded-full border border-haze bg-ink-raised/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur">
        <Smartphone size={14} strokeWidth={1.8} className="shrink-0 text-cinnabar-soft" />
        <span className="truncate font-mono text-[11px] text-paper-muted">
          有所闻也提供 Android 手机 App
        </span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1 rounded-full bg-cinnabar/15 px-2.5 py-1 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
        >
          <Download size={12} strokeWidth={1.8} />
          下载
        </a>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭手机下载提示"
          className="flex h-7 w-7 shrink-0 items-center justify-center text-paper-faint transition-colors hover:text-paper"
        >
          <X size={14} strokeWidth={1.7} />
        </button>
      </div>
    </aside>
  )
}
