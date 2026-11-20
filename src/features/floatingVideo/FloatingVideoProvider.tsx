import { Suspense, lazy, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { VideoSessionManagerContext } from './context'
import { createVideoSessionManager } from './session'
// No player hosts exist during an ordinary app startup. Delay the heavy
// video presentation tree until the first session is registered.
const VideoSessionHost = lazy(() =>
  import('./VideoSessionHost').then(module => ({ default: module.VideoSessionHost })),
)
import { setNativeLiveSurfaceSuppressed } from '../mediaSniffer/native'
import { createLiveSuppressionCoordinator, createFloatingVideoOcclusionCoordinator } from './nativeSurfaceCoordinator'
import { nativeBrowser } from '../browser/nativeBrowser'

export function FloatingVideoProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(createVideoSessionManager)
  const [suppression] = useState(() => createLiveSuppressionCoordinator(setNativeLiveSurfaceSuppressed))
  const [occlusion] = useState(() => createFloatingVideoOcclusionCoordinator(async bounds => {
    if (Capacitor.getPlatform() !== 'android') return
    await nativeBrowser.setFloatingVideoBounds(bounds ? { visible: true, ...bounds } : { visible: false })
  }))
  const sessions = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot)
  const nativeSuppressed = sessions.some(session => session.mode !== 'inline' || session.immersive)
  const hasFloatingWindow = sessions.some(session => session.mode === 'floating' && !session.immersive)
  const hasFullVideoSurface = sessions.some(session => session.immersive || session.mode === 'page')
  useLayoutEffect(() => {
    if (hasFullVideoSurface) {
      occlusion.set({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight })
    } else if (!hasFloatingWindow) {
      occlusion.set(null)
    }
  }, [hasFullVideoSurface, hasFloatingWindow, occlusion])
  useEffect(() => {
    if (!hasFullVideoSurface) return
    const sync = () => occlusion.set({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
    }
  }, [hasFullVideoSurface, occlusion])
  useEffect(() => {
    suppression.set(nativeSuppressed)
  }, [nativeSuppressed, suppression])
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) void manager.suspend() }
    document.addEventListener('visibilitychange', onVisibility)
    let disposed = false
    let removeNative: (() => Promise<void>) | undefined
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) void manager.suspend()
      }).then(listener => {
        if (disposed) void listener.remove()
        else removeNative = () => listener.remove()
      })
    }
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void removeNative?.()
      // Child slot layout cleanups run first. Remaining detached runtimes are
      // paused here; their own React unmount cleans engines and native state.
      manager.pauseAll()
      suppression.set(false)
      occlusion.set(null)
    }
  }, [manager, suppression, occlusion])
  return <VideoSessionManagerContext.Provider value={manager}>
    {children}
    <Suspense fallback={null}>
      {sessions.map(session => <VideoSessionHost key={session.id} manager={manager} session={session}
        onFloatingBounds={bounds => { if (!hasFullVideoSurface) occlusion.set(bounds) }} />)}
    </Suspense>
  </VideoSessionManagerContext.Provider>
}
