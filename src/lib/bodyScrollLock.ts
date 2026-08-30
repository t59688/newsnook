/**
 * Reference-counted body scroll lock for modal overlays.
 *
 * Multiple overlays may lock scroll at the same time (e.g. lightbox while a
 * confirm sheet is open). Saving/restoring `document.body.style.overflow` per
 * component breaks when they unmount out of order and can leave the page stuck
 * with `overflow: hidden`.
 */
let lockCount = 0
let savedOverflow = ''

export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow
    }
  }
}

/** For tests and emergency recovery after navigation. */
export function resetBodyScrollLock(): void {
  lockCount = 0
  document.body.style.overflow = ''
}

export function bodyScrollLockDepth(): number {
  return lockCount
}
