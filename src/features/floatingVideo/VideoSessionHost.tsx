import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, X } from 'lucide-react'
import { InkVideoPlayerRuntime } from '../../components/InkVideoPlayer'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { VideoPresentationContext } from './context'
import { FloatingVideoWindow } from './FloatingVideoWindow'
import type { VideoSessionManager } from './session'
import type { VideoSession } from './types'

export function VideoSessionHost({ manager, session }: { manager: VideoSessionManager; session: VideoSession }) {
  const [host] = useState(() => {
    const element = document.createElement('div')
    element.dataset.videoSessionHost = ''
    return element
  })
  const windowSlotRef = useRef<HTMLDivElement>(null)
  const pageSlotRef = useRef<HTMLDivElement>(null)
  const immersive = session.immersive
  const domFullscreen = Boolean(immersive && document.fullscreenElement && host.contains(document.fullscreenElement))
  const close = useCallback(() => manager.close(session.id), [manager, session.id])
  const float = useCallback(() => manager.float(session.id), [manager, session.id])
  const restore = useCallback(() => {
    const slot = manager.getSnapshot().find(item => item.id === session.id)?.slot
    manager.restore(session.id)
    if (slot?.isConnected) {
      requestAnimationFrame(() => slot.scrollIntoView?.({ behavior: 'smooth', block: 'center' }))
    }
  }, [manager, session.id])
  const presentation = useMemo(() => ({
    mode: session.mode, detached: !session.slot, float,
    openPage: () => manager.openPage(session.id),
    setImmersive: (value: boolean) => manager.setImmersive(session.id, value),
    claimPlayback: () => manager.claimPlayback(session.id),
    bindRuntime: (runtime: Parameters<typeof manager.bindRuntime>[1]) => manager.bindRuntime(session.id, runtime),
    runTransition: manager.runTransition,
  }), [manager, session.id, session.mode, session.slot, float])

  useLayoutEffect(() => {
    // Removing an ancestor of a DOM fullscreen element triggers browser exit.
    // Only the fixed-position fallback needs promotion out of the page layout.
    if (immersive && document.fullscreenElement && host.contains(document.fullscreenElement)) return
    const target = immersive ? document.body
      : session.mode === 'floating' ? windowSlotRef.current
      : session.mode === 'page' ? pageSlotRef.current : session.slot
    if (target && host.parentNode !== target) target.appendChild(host)
  }, [host, immersive, session.mode, session.slot])
  useLayoutEffect(() => () => host.remove(), [host])

  const exitLayer = useCallback(() => {
    if (manager.dismissOverlay(session.id)) return true
    if (immersive) {
      void manager.exitFullscreen(session.id)
      return true
    }
    if (session.mode === 'page') { float(); return true }
    return false
  }, [float, immersive, manager, session.id, session.mode])
  useHardwareBackLayer(immersive || session.mode === 'page', exitLayer)
  useEffect(() => {
    if (!immersive && session.mode !== 'page') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (exitLayer()) { event.preventDefault(); event.stopImmediatePropagation() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitLayer, immersive, session.mode])

  return <>
    {createPortal(<VideoPresentationContext.Provider value={presentation}>
      <InkVideoPlayerRuntime {...session.props} />
    </VideoPresentationContext.Provider>, host)}
    {createPortal(<FloatingVideoWindow
      domFullscreen={domFullscreen}
      title={session.props.title || '文章视频'} active={session.mode === 'floating'} hidden={immersive || session.mode !== 'floating'} slotRef={windowSlotRef}
      onRestore={restore} onClose={close}
    />, document.body)}
    {session.mode === 'page' && createPortal(<section
      data-video-session-page="" data-theme="dark" aria-label="独立视频播放页"
      className="video-session-page" style={{ visibility: immersive ? 'hidden' : undefined }}
    >
      <header>
        <button type="button" aria-label="返回悬浮播放" onClick={float}><ChevronLeft size={22} /></button>
        <h2>{session.props.title || '文章视频'}</h2>
        <button type="button" aria-label="关闭悬浮播放" onClick={close}><X size={20} /></button>
      </header>
      <div className="video-session-page-content"><div ref={pageSlotRef} /></div>
    </section>, document.body)}
  </>
}
