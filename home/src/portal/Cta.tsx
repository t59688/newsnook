import { Download } from 'lucide-react'

/* 按钮语法沿用应用：主操作 = 朱砂描边胶囊（SHEET_PRIMARY_CLASS），
 * 次操作 = haze 描边（DIALOG_CANCEL_CLASS）。 */
export function PrimaryCta({
  href,
  children,
  className = '',
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-full border border-cinnabar bg-cinnabar px-6 py-3 font-mono text-[12.5px] font-medium tracking-[0.06em] text-ink-deep transition-colors hover:bg-cinnabar-soft ${className}`}
    >
      <Download size={14} strokeWidth={1.8} />
      {children}
    </a>
  )
}

export function GhostCta({
  href,
  children,
  className = '',
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={`pressable inline-flex items-center justify-center gap-2 rounded-full border border-haze bg-transparent px-6 py-3 font-mono text-[12.5px] tracking-[0.06em] text-paper-muted transition-colors hover:text-paper ${className}`}
    >
      {children}
    </a>
  )
}
