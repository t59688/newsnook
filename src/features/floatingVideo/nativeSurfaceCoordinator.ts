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
