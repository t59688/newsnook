import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { VideoSessionManagerContext } from './context'
import { createVideoSessionManager } from './session'
import { VideoSessionHost } from './VideoSessionHost'
import { setNativeLiveSurfaceSuppressed } from '../mediaSniffer/native'

export function FloatingVideoProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(createVideoSessionManager)
  const sessions = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot)
  const nativeSuppressed = sessions.some(session => session.mode !== 'inline' || session.immersive)
  useEffect(() => {
    void setNativeLiveSurfaceSuppressed(nativeSuppressed)
  }, [nativeSuppressed])
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
      void setNativeLiveSurfaceSuppressed(false)
    }
  }, [manager])
  return <VideoSessionManagerContext.Provider value={manager}>
    {children}
    {sessions.map(session => <VideoSessionHost key={session.id} manager={manager} session={session} />)}
  </VideoSessionManagerContext.Provider>
}
