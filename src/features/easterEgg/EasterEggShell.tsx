import type { ReactNode } from 'react'

/**
 * 全屏不透明宿主：不提供通用顶栏/边距。
 * 本版页面布局与关闭控件一律由 CurrentEasterEgg 自绘。
 */
export function EasterEggShell({
  open,
  children,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex h-dvh max-h-dvh flex-col bg-[rgb(232,228,217)]"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
      role="dialog"
      aria-modal="true"
      aria-label="有所闻"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
