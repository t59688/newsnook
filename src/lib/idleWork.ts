/** Yield noncritical maintenance to an idle turn; cleanup also invalidates queued callbacks. */
export function scheduleIdleWork(work: () => void): () => void {
  let pending = true
  const run = () => {
    if (!pending) return
    pending = false
    work()
  }
  const useIdle = typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function'
  const id = useIdle
    ? window.requestIdleCallback(run, { timeout: 1000 })
    : window.setTimeout(run, 0)
  return () => {
    pending = false
    if (useIdle) window.cancelIdleCallback(id)
    else window.clearTimeout(id)
  }
}

/**
 * Run non-visual work after the next painted frame instead of on the input
 * event's critical path. Flush on background/pagehide so navigation history
 * survives an immediate Android WebView suspension.
 */
export function scheduleAfterPaint(work: () => void): () => void {
  let pending = true
  let frame = 0
  let timer: number | null = null
  const dispose = () => {
    if (frame) window.cancelAnimationFrame(frame)
    if (timer !== null) window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', run)
  }
  const run = () => {
    if (!pending) return
    pending = false
    dispose()
    work()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') run()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', run)
  if (document.visibilityState === 'hidden') run()
  else {
    frame = window.requestAnimationFrame(() => {
      frame = 0
      timer = window.setTimeout(run, 0)
    })
  }
  return () => {
    pending = false
    dispose()
  }
}
