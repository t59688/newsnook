import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import {
  bodyScrollLockDepth,
  lockBodyScroll,
  resetBodyScrollLock,
} from '../src/lib/bodyScrollLock'
import {
  clearGestureCompositorStyles,
  recoverAppScrollAfterNavigation,
  recoverAppScrollSurfaces,
  SCROLL_SURFACE_ATTR,
} from '../src/lib/gestureStyles'

const { document } = parseHTML('<body><div id="surface"></div></body>')
;(globalThis as typeof globalThis & { document: Document }).document = document as unknown as Document
const surface = document.querySelector<HTMLElement>('#surface')
assert.ok(surface)

surface.style.transform = 'translate3d(0, 0, 0)'
surface.style.transition = 'transform 220ms ease'
surface.style.willChange = 'transform'
surface.dataset.swipeBackActive = 'true'

clearGestureCompositorStyles(surface)

assert.equal(surface.style.transform, '')
assert.equal(surface.style.transition, '')
assert.equal(surface.style.willChange, '')
assert.equal(surface.dataset.swipeBackActive, undefined)

resetBodyScrollLock()
document.body.style.overflow = 'auto'

const releaseA = lockBodyScroll()
assert.equal(document.body.style.overflow, 'hidden')
assert.equal(bodyScrollLockDepth(), 1)

const releaseB = lockBodyScroll()
assert.equal(bodyScrollLockDepth(), 2)

releaseA()
assert.equal(document.body.style.overflow, 'hidden')
assert.equal(bodyScrollLockDepth(), 1)

releaseB()
assert.equal(document.body.style.overflow, 'auto')
assert.equal(bodyScrollLockDepth(), 0)

// Out-of-order release must not leave overflow stuck on hidden.
const releaseC = lockBodyScroll()
const releaseD = lockBodyScroll()
releaseC()
releaseD()
assert.equal(document.body.style.overflow, 'auto')

const feed = document.createElement('div')
feed.setAttribute(SCROLL_SURFACE_ATTR, '')
feed.style.transform = 'translate3d(0, 12px, 0)'
document.body.appendChild(feed)
document.documentElement.classList.add('is-video-fullscreen')
document.body.style.overflow = 'hidden'
lockBodyScroll()

recoverAppScrollSurfaces()
assert.equal(feed.style.transform, '')
assert.equal(document.documentElement.classList.contains('is-video-fullscreen'), false)
assert.equal(document.body.style.overflow, 'hidden')

resetBodyScrollLock()
assert.equal(document.body.style.overflow, '')

recoverAppScrollAfterNavigation()
assert.equal(document.body.style.overflow, '')

console.log('gesture-styles: ok')
