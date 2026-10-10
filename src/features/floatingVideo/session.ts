import type { InkVideoPlayerProps } from '../../components/InkVideoPlayer'
import type { VideoRuntimeHandle, VideoSession } from './types'

/** App-scoped ownership. Page leases and the surviving playback session are separate. */
export function createVideoSessionManager() {
  let sessions: readonly VideoSession[] = []
  const listeners = new Set<() => void>()
  const runtimes = new Map<string, VideoRuntimeHandle>()
  let transitionQueue: Promise<unknown> = Promise.resolve()
  const emit = () => { for (const listener of listeners) listener() }
  const find = (id: string) => sessions.find(s => s.id === id)
  const replace = (id: string, change: Partial<VideoSession>) => {
    if (!find(id)) return
    sessions = sessions.map(s => s.id === id ? { ...s, ...change } : s)
    emit()
  }
  const close = (id: string) => {
    if (!find(id)) return
    runtimes.get(id)?.pause()
    runtimes.delete(id)
    sessions = sessions.filter(s => s.id !== id)
    emit()
  }
  return {
    getSnapshot: () => sessions,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    register(id: string, props: InkVideoPlayerProps, slot: HTMLDivElement) {
      const owner = Symbol(id)
      const existing = find(id)
      if (existing) replace(id, { owner, props, slot })
      else { sessions = [...sessions, { id, owner, props, slot, mode: 'inline', immersive: false }]; emit() }
      return owner
    },
    update(id: string, owner: symbol, props: InkVideoPlayerProps) {
      if (find(id)?.owner === owner) replace(id, { props })
    },
    detach(id: string, owner: symbol) {
      const session = find(id)
      if (!session || session.owner !== owner) return
      if (session.mode === 'inline') { close(id); return }
      const { onUnlocked: _unlock, onRefreshSource: _refresh, onPlaybackError: _error,
        fullscreenHandleRef: _fullscreen, ...props } = session.props
      replace(id, { slot: null, props })
    },
    float(id: string) {
      if (!find(id)) return
      for (const other of sessions) if (other.id !== id && other.mode !== 'inline') close(other.id)
      replace(id, { mode: 'floating' })
    },
    restore(id: string) {
      const session = find(id)
      if (session) replace(id, { mode: session.slot?.isConnected ? 'inline' : 'page' })
    },
    openPage(id: string) {
      if (!find(id)) return
      for (const other of sessions) if (other.id !== id && other.mode !== 'inline') close(other.id)
      replace(id, { mode: 'page' })
    },
    close,
    runTransition(operation: () => Promise<void>): Promise<void> {
      const task = transitionQueue.then(operation, operation)
      // Keep the queue usable after failure; the caller still receives rejection.
      transitionQueue = task.then(() => undefined, () => undefined)
      return task
    },
    setImmersive(id: string, immersive: boolean) {
      if (find(id)?.immersive !== immersive) replace(id, { immersive })
    },
    bindRuntime(id: string, runtime: VideoRuntimeHandle) {
      runtimes.set(id, runtime)
      return () => { if (runtimes.get(id) === runtime) runtimes.delete(id) }
    },
    exitFullscreen(id: string) { return runtimes.get(id)?.exitFullscreen() },
    dismissOverlay(id: string) { return runtimes.get(id)?.dismissOverlay() || false },
    claimPlayback(id: string) {
      for (const [other, runtime] of runtimes) if (other !== id) runtime.pause()
    },
    pauseAll() { for (const runtime of runtimes.values()) runtime.pause() },
    async suspend() {
      for (const runtime of [...runtimes.values()]) {
        runtime.pause()
        await runtime.exitFullscreen()
      }
    },
    dispose() {
      for (const session of [...sessions]) close(session.id)
    },
  }
}

export type VideoSessionManager = ReturnType<typeof createVideoSessionManager>
