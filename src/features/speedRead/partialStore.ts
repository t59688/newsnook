export interface SpeedReadPartialSnapshot {
  thinking: string
  body: string
  status?: string
}

export const EMPTY_SPEED_READ_PARTIAL: Readonly<SpeedReadPartialSnapshot> = Object.freeze({
  thinking: '',
  body: '',
  status: '',
})

export interface SpeedReadPartialStore {
  getSnapshot: () => Readonly<SpeedReadPartialSnapshot>
  subscribe: (listener: () => void) => () => void
  set: (partial: SpeedReadPartialSnapshot) => void
  reset: () => void
}

function samePartial(
  current: Readonly<SpeedReadPartialSnapshot>,
  next: SpeedReadPartialSnapshot,
): boolean {
  return (
    current.thinking === next.thinking &&
    current.body === next.body &&
    (current.status || '') === (next.status || '')
  )
}

export function createSpeedReadPartialStore(
  initial: SpeedReadPartialSnapshot = EMPTY_SPEED_READ_PARTIAL,
): SpeedReadPartialStore {
  let snapshot: Readonly<SpeedReadPartialSnapshot> = { ...initial, status: initial.status || '' }
  const listeners = new Set<() => void>()

  const set = (partial: SpeedReadPartialSnapshot) => {
    if (samePartial(snapshot, partial)) return
    snapshot = { ...partial, status: partial.status || '' }
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set,
    reset: () => set(EMPTY_SPEED_READ_PARTIAL),
  }
}
