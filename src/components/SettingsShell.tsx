import { useCallback, useRef, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { haptics } from '../lib/haptics'

interface Props {
  title: ReactNode
  caption?: string
  toolbar?: ReactNode
  className?: string
  action?: ReactNode
  footer?: ReactNode
  onBack: () => void
  children: ReactNode
}

/** 设置页始终保留不透明背景；返回直接交给路由，内容层负责轻量入场与右滑。 */
export function SettingsShell({ title, caption, toolbar, className, action, footer, onBack, children }: Props) {
  const reduced = useReducedMotion()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  const handleBack = useCallback(() => {
    void haptics.tick()
    onBackRef.current()
  }, [])

  // 支持从屏幕左边缘向右平滑滑动返回上一级
  useEdgeSwipeBack({
    containerRef,
    onBack: () => onBackRef.current(),
    reduced,
  })

  const animationStyle = reduced
    ? undefined
    : 'settings-in 180ms var(--ease-ink)'

  return (
    <div
      className={`paper-settings-shell absolute inset-0 z-30 flex flex-col overflow-hidden bg-ink ${className ?? ""}`}
      style={{
        paddingBottom: 'var(--sab)',
      }}
    >
      <style>{`
        @keyframes settings-in { from { transform: translate3d(12px, 0, 0) } to { transform: translate3d(0, 0, 0) } }
      `}</style>
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col" style={{ animation: animationStyle }}>
        <header className="paper-settings-shell-header shrink-0 bg-ink/90 backdrop-blur-md">
          <div className="paper-settings-shell-header-inner page-x lg:px-8 max-w-4xl mx-auto w-full">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={handleBack}
                aria-label="返回"
                className="-ml-1.5 shrink-0 p-1.5 transition-transform duration-100 active:scale-[0.88] hover:text-paper"
              >
                <ArrowLeft size={19} strokeWidth={1.6} className="text-paper" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h1 className="paper-settings-shell-title truncate font-display text-[22px] leading-none text-paper sm:text-[24px] md:text-[28px]">
                      {title}
                    </h1>
                    {caption && (
                      <p className="paper-settings-shell-caption mt-1.5 line-clamp-2 font-mono text-[10px] lg:text-[11px] tracking-[0.14em] text-paper-faint">
                        {caption}
                      </p>
                    )}
                  </div>
                  {action ? <div className="shrink-0">{action}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </header>

        {toolbar && <div className="paper-settings-shell-toolbar shrink-0">{toolbar}</div>}

        <div
          data-settings-scroll
          className="paper-settings-shell-scroll scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: '24px' }}
        >
          <div className="max-w-4xl mx-auto w-full">
            {children}
          </div>
        </div>

        {footer && (
          <footer className="shrink-0 border-t border-haze/30 bg-ink/95 backdrop-blur-md">
            <div className="page-x lg:px-8 max-w-4xl mx-auto w-full py-2.5">
              {footer}
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

/** 统一设置分组容器：默认收拢为一块可读的分组表面；瓷片、卡片网格使用 plain 布局。 */
export function SettingsSection({
  title,
  children,
  variant = 'group',
}: {
  title: string
  children: ReactNode
  variant?: 'group' | 'plain'
}) {
  return (
    <section className={`paper-settings-section paper-settings-section--${variant}`}>
      <div className="paper-settings-section-heading">
        <h2 className="paper-settings-section-title">{title}</h2>
      </div>
      <div className="paper-settings-section-content">{children}</div>
    </section>
  )
}

export function SettingsHint({ children }: { children: ReactNode }) {
  return (
    <p className="paper-settings-hint page-x max-w-2xl pt-4 text-[11.5px] leading-relaxed text-paper-faint">
      {children}
    </p>
  )
}
