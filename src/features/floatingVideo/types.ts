import type { InkVideoPlayerProps } from '../../components/InkVideoPlayer'

export type VideoPresentationMode = 'inline' | 'floating' | 'page'

export interface VideoSession {
  id: string
  owner: symbol
  props: InkVideoPlayerProps
  slot: HTMLDivElement | null
  mode: VideoPresentationMode
  immersive: boolean
}

export interface VideoRuntimeHandle {
  pause: () => void
  exitFullscreen: () => Promise<void>
  dismissOverlay: () => boolean
}

export interface WindowBounds { x: number; y: number; width: number; height: number }
export interface WindowRect extends WindowBounds {}
