import { createContext, useContext, useSyncExternalStore } from 'react'
import type { VideoSessionManager } from './session'
import type { VideoPresentationMode, VideoRuntimeHandle } from './types'

export const VideoSessionManagerContext = createContext<VideoSessionManager | null>(null)
export const VideoPresentationContext = createContext<{
  mode: VideoPresentationMode
  detached: boolean
  float: () => void
  openPage: () => void
  claimPlayback: () => void
  setImmersive: (value: boolean) => void
  bindRuntime: (runtime: VideoRuntimeHandle) => () => void
  runTransition: (operation: () => Promise<void>) => Promise<void>
} | null>(null)

export const useVideoPresentation = () => useContext(VideoPresentationContext)

const noSubscribe = () => () => {}
const noOverlay = () => false
export function useHasGlobalVideoSurface() {
  const manager = useContext(VideoSessionManagerContext)
  const read = () => manager?.getSnapshot().some(s => s.mode !== 'inline' || s.immersive) || false
  return useSyncExternalStore(manager?.subscribe || noSubscribe, manager ? read : noOverlay, noOverlay)
}
