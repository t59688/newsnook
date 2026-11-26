export interface FloatingVideoBounds { left: number; top: number; width: number; height: number }

/** Coalesce drag/resize bounds; never queue a native call for every pointer sample. */
export function createFloatingVideoOcclusionCoordinator(
  apply: (bounds: FloatingVideoBounds | null) => Promise<void>,
) {
  let desired: FloatingVideoBounds | null = null
  let applied: FloatingVideoBounds | null = null
  let pending: Promise<void> | null = null
  const same = (a: FloatingVideoBounds | null, b: FloatingVideoBounds | null) =>
    a === b || Boolean(a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
  const flush = async () => {
    while (!same(applied, desired)) {
      const next = desired
      try { await apply(next) } catch {
        // Keep the newest destination; Android may be shutting down the bridge.
      }
      applied = next
    }
  }
  return {
    set(bounds: FloatingVideoBounds | null) {
      desired = bounds
      if (!pending) {
        pending = flush().finally(() => {
          pending = null
          if (!same(applied, desired)) this.set(desired)
        })
      }
    },
    idle: async () => { while (pending) await pending },
  }
}

/** Serializes native view visibility, coalescing intermediate states while a bridge call is pending. */
export function createLiveSuppressionCoordinator(
  apply: (suppressed: boolean) => Promise<void>,
) {
  let desired = false
  let current: boolean | undefined
  let running: Promise<void> | null = null
  const flush = async () => {
    while (current !== desired) {
      const value = desired
      try {
        await apply(value)
      } catch {
        // The native bridge may be unavailable during activity shutdown.
      }
      current = value
    }
  }
  return {
    set(value: boolean) {
      desired = value
      if (!running) {
        running = flush().finally(() => {
          running = null
          if (current !== desired) this.set(desired)
        })
      }
    },
    idle: async () => { while (running) await running },
  }
}
