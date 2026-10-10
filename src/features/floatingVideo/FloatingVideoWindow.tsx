import { useRef, type RefObject } from 'react'
import { ArrowDownRight, Move, PanelTop, X } from 'lucide-react'
import { useWindowGesture } from './useWindowGesture'

export function FloatingVideoWindow({ title, active, hidden, domFullscreen, slotRef, onRestore, onClose }: {
  title: string
  active: boolean
  hidden: boolean
  domFullscreen: boolean
  slotRef: RefObject<HTMLDivElement | null>
  onRestore: () => void
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { rect, drag, resize, pinch, tip, dismissTip } = useWindowGesture(rootRef, slotRef, hidden)
  return <div data-floating-video-window={active ? '' : undefined} aria-hidden={(hidden && !domFullscreen) || undefined} data-theme="dark" className="floating-video-window"
    ref={rootRef} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, visibility: hidden ? 'hidden' : undefined }}
    {...pinch}
  >
    <header className="floating-video-titlebar">
      <div role="button" tabIndex={0} aria-label="移动悬浮窗口" className="floating-video-drag" {...drag}>
        <Move size={13} aria-hidden="true" /><span>{title}</span>
      </div>
      <button type="button" aria-label="恢复播放页" title="恢复播放页" onClick={onRestore}><PanelTop size={17} /></button>
      <button type="button" aria-label="关闭悬浮播放" title="关闭" onClick={onClose}><X size={18} /></button>
    </header>
    <div ref={slotRef} className="floating-video-slot" />
    <div role="button" tabIndex={0} aria-label="调整悬浮窗口大小" className="floating-video-resize" {...resize}>
      <ArrowDownRight size={19} aria-hidden="true" />
    </div>
    {tip && <button className="floating-video-tip" type="button" onClick={dismissTip}>拖动标题移动，拖动右下角调整大小</button>}
  </div>
}
