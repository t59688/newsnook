type RecoverableError = 'manifest' | 'network' | 'media'

/** A decoder gets a bounded recovery budget until it makes sustained progress. */
export function createHlsRecovery(options: {
  recover: (kind: RecoverableError) => void
  fail: (reason: 'unsupported' | 'exhausted') => void
}) {
  let attempts = 0
  let terminal = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastProgress: { position: number; time: number } | null = null
  let progressMs = 0
  const interruptProgress = () => {
    lastProgress = null
    progressMs = 0
  }
  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const stop = (reason: 'unsupported' | 'exhausted') => {
    terminal = true
    cancelTimer()
    interruptProgress()
    options.fail(reason)
  }
  return {
    fatal(kind: RecoverableError | null) {
      if (terminal) return
      interruptProgress()
      if (kind === null) { stop('unsupported'); return }
      if (timer !== null) return
      if (attempts >= 3) { stop('exhausted'); return }
      const delay = 500 * 2 ** attempts++
      timer = setTimeout(() => {
        timer = null
        if (terminal) return
        try { options.recover(kind) } catch { stop('exhausted') }
      }, delay)
    },
    progress(position: number) {
      if (terminal || timer !== null || !Number.isFinite(position)) return
      const time = Date.now()
      if (lastProgress) {
        const elapsed = time - lastProgress.time
        const advancement = position - lastProgress.position
        // A seek or a long gap without timeupdate is not sustained playback.
        if (elapsed > 0 && elapsed <= 2000 && advancement > 0 && advancement <= 5) {
          progressMs += elapsed
          if (progressMs >= 10000) attempts = 0
        } else {
          progressMs = 0
        }
      }
      lastProgress = { position, time }
    },
    interruptProgress,
    destroy() { terminal = true; cancelTimer(); interruptProgress() },
  }
}
