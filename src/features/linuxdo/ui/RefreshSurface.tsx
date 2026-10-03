import type { ReactNode, RefObject, UIEventHandler } from 'react'
import { PullIndicator } from '../../../components/PullIndicator'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'

/** Keep the scroll node mounted through loading/error states so recovery is always available. */
export function RefreshSurface({ children, onRefresh, scrollerRef, onScroll, className = '' }: {
  children: ReactNode
  onRefresh: () => Promise<void>
  scrollerRef?: RefObject<HTMLDivElement | null>
  onScroll?: UIEventHandler<HTMLDivElement>
  className?: string
}) {
  const { containerRef, indicatorRef, phase } = usePullToRefresh({ onRefresh, containerRef: scrollerRef })
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <PullIndicator indicatorRef={indicatorRef} phase={phase} />
      <div ref={containerRef} onScroll={onScroll} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}>
        {children}
      </div>
    </div>
  )
}
