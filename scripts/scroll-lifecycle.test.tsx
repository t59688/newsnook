import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import React, { act, useRef } from 'react'
import { parseHTML } from 'linkedom'
import { ImageLightbox } from '../src/components/ImageLightbox'
import { createSpeedReadPartialStore } from '../src/features/speedRead/partialStore'
import { useEdgeSwipeBack } from '../src/hooks/useEdgeSwipeBack'
import { bodyScrollLockDepth, resetBodyScrollLock } from '../src/lib/bodyScrollLock'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
})
const captures = new WeakMap<HTMLElement, Set<number>>()
window.HTMLElement.prototype.setPointerCapture = function (id: number) {
  const ids = captures.get(this) ?? new Set<number>()
  ids.add(id)
  captures.set(this, ids)
}
window.HTMLElement.prototype.hasPointerCapture = function (id: number) {
  return captures.get(this)?.has(id) ?? false
}
window.HTMLElement.prototype.releasePointerCapture = function (id: number) {
  captures.get(this)?.delete(id)
}
window.HTMLElement.prototype.getBoundingClientRect = () => ({
  left: 0, top: 0, width: 320, height: 640, right: 320, bottom: 640,
  x: 0, y: 0, toJSON: () => ({}),
})
window.getComputedStyle = (() => ({ transform: 'none' })) as typeof getComputedStyle
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
window.requestAnimationFrame = (cb) => { frames.set(++frameId, cb); return frameId }
window.cancelAnimationFrame = (id) => { frames.delete(id) }
const flushFrames = () => {
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((cb) => cb(0))
}
const { createRoot } = await import('react-dom/client')
// Match Vite's CSS ?inline contract when loading the real speed-read panel.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css?inline')) {
      const source = readFileSync(new URL(url), 'utf8')
      return { format: 'module', source: `export default ${JSON.stringify(source)}`, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
const { AiSpeedReadPanel } = await import('../src/components/AiSpeedReadPanel')
const host = document.createElement('div')
const otherPage = document.createElement('div')
document.body.append(host, otherPage)
const root = createRoot(host)
let failures = 0
let closed = 0
let next = 0
const partialStore = createSpeedReadPartialStore()
const noop = () => undefined

function SpeedRead() {
  return <AiSpeedReadPanel open state="idle" partialStore={partialStore} error=""
    articleTitle="Test article" sourceName="Test source" onClose={noop} onRetry={noop} onCancel={noop} />
}
function Lightbox() {
  return <ImageLightbox src="test-image.png" onClose={() => { closed++ }} onNext={() => { next++ }} />
}
function EdgeSwipe() {
  const containerRef = useRef<HTMLDivElement>(null)
  useEdgeSwipeBack({ containerRef, onBack: () => { closed++ }, reduced: true })
  return <div ref={containerRef} data-edge-surface><div data-edge-child /></div>
}
async function render(content: React.ReactNode) {
  await act(async () => { root.render(content) })
}
const stage = () => host.querySelector<HTMLImageElement>('img')!.parentElement!
async function pointer(type: string, id: number, x: number, y: number, isPrimary = true) {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isPrimary })
  await act(async () => { stage().dispatchEvent(event) })
}
function touches(id: number, x: number, y: number) {
  const entries = [{ identifier: id, clientX: x, clientY: y }]
  return Object.assign(entries, { item: (index: number) => entries[index] ?? null })
}
async function touch(type: string, target: HTMLElement, id: number, x: number, y: number, cancelable = true) {
  const event = new window.Event(type, { bubbles: true, cancelable })
  Object.assign(event, {
    touches: type === 'touchend' ? Object.assign([], { item: () => null }) : touches(id, x, y),
    changedTouches: touches(id, x, y), timeStamp: 100,
  })
  await act(async () => { target.dispatchEvent(event) })
  return event.defaultPrevented
}
async function check(name: string, run: () => Promise<void>) {
  await render(null)
  resetBodyScrollLock()
  document.body.style.overflow = 'auto'
  frames.clear()
  closed = 0
  next = 0
  try { await run(); console.log(`ok: ${name}`) }
  catch (error) { failures++; console.error(`FAIL: ${name}`, error) }
}

await check('speed read and image overlays release out of order without stranding body overflow', async () => {
  await render(<><SpeedRead key="speed" /><Lightbox key="image" /></>)
  assert.equal(document.body.style.overflow, 'hidden')
  await render(<Lightbox key="image" />)
  assert.equal(document.body.style.overflow, 'hidden', 'the remaining image overlay still owns a lock')
  await render(null)
  assert.equal(document.body.style.overflow, 'auto')
  assert.equal(bodyScrollLockDepth(), 0)
})

await check('closing the image before speed read restores the original body overflow', async () => {
  await render(<><SpeedRead key="speed" /><Lightbox key="image" /></>)
  await render(<SpeedRead key="speed" />)
  assert.equal(document.body.style.overflow, 'hidden')
  await render(null)
  assert.equal(document.body.style.overflow, 'auto')
})

await check('cancelling a downward image gesture does not close the image', async () => {
  await render(<Lightbox />)
  await pointer('pointerdown', 1, 160, 200)
  await pointer('pointermove', 1, 160, 340)
  await pointer('pointercancel', 1, 160, 340)
  assert.equal(closed, 0)
  assert.equal(host.querySelector('img')!.style.transform, 'translate3d(0px, 0px, 0) scale(1)')
})

await check('cancelling a horizontal image gesture does not switch images', async () => {
  await render(<Lightbox />)
  await pointer('pointerdown', 1, 200, 200)
  await pointer('pointermove', 1, 80, 200)
  await pointer('pointercancel', 1, 80, 200)
  assert.equal(next, 0)
})

for (const interruptedBy of ['lostpointercapture', 'blur', 'fresh-primary'] as const) {
  await check(`image pinch interrupted by ${interruptedBy} cannot strand subsequent single-finger gestures`, async () => {
    await render(<Lightbox />)
    await pointer('pointerdown', 1, 100, 200)
    await pointer('pointerdown', 2, 200, 200, false)
    if (interruptedBy === 'lostpointercapture') await pointer('lostpointercapture', 1, 100, 200)
    if (interruptedBy === 'blur') await act(async () => { window.dispatchEvent(new window.Event('blur')) })
    // No terminal event for the old contacts; WebView reuses an identifier.
    await pointer('pointerdown', 3, 160, 200)
    await pointer('pointermove', 3, 160, 340)
    await pointer('pointerup', 3, 160, 340)
    assert.equal(closed, 1)
  })
}

await check('a real downward release still closes the image', async () => {
  await render(<Lightbox />)
  await pointer('pointerdown', 1, 160, 200)
  await pointer('pointermove', 1, 160, 340)
  await pointer('pointerup', 1, 160, 340)
  assert.equal(closed, 1)
})

await check('a real two-finger pinch and a subsequent pan still work', async () => {
  await render(<Lightbox />)
  const img = host.querySelector<HTMLImageElement>('img')!
  Object.defineProperties(img, { naturalWidth: { value: 400 }, naturalHeight: { value: 600 } })
  await pointer('pointerdown', 1, 100, 320)
  await pointer('pointerdown', 2, 200, 320, false)
  await pointer('pointermove', 2, 300, 320, false)
  assert.equal(img.style.transform, 'translate3d(-40px, 0px, 0) scale(2)')
  await pointer('pointerup', 1, 100, 320)
  await pointer('lostpointercapture', 1, 100, 320)
  await pointer('pointerup', 2, 300, 320, false)
  await pointer('pointerdown', 3, 160, 320)
  await pointer('pointermove', 3, 160, 370)
  await pointer('pointerup', 3, 160, 370)
  assert.equal(img.style.transform, 'translate3d(-40px, 50px, 0) scale(2)')
  assert.equal(closed, 0)
})

await check('an interrupted reader swipe cannot prevent scrolling on another surface', async () => {
  await render(<EdgeSwipe />)
  const child = host.querySelector<HTMLElement>('[data-edge-child]')!
  await touch('touchstart', child, 0, 4, 100)
  assert.equal(await touch('touchmove', child, 0, 40, 100), true)
  // The old touchend is swallowed, then the next page reuses touch identifier 0.
  await touch('touchstart', otherPage, 0, 150, 100)
  assert.equal(await touch('touchmove', otherPage, 0, 150, 240), false)
  flushFrames()
})

await check('the temporary scroll probe records final cancellation and the preventing handler', async () => {
  Object.assign(globalThis, {
    Event: window.Event, getComputedStyle: window.getComputedStyle,
    innerWidth: 320, innerHeight: 640, visualViewport: undefined,
  })
  document.elementFromPoint = () => otherPage
  const originalPreventDefault = Event.prototype.preventDefault
  await import('./scroll-diagnostics.js')
  const probe = (window as unknown as { __newsnookScrollProbe: {
    snapshot: (x: number, y: number) => { records: Array<{ type: string; prevented?: boolean; stack?: string }> }
    stop: () => void
  } }).__newsnookScrollProbe
  const prevent = (event: Event) => event.preventDefault()
  otherPage.addEventListener('touchmove', prevent)
  try {
    assert.equal(await touch('touchmove', otherPage, 0, 150, 240), true)
    const { records } = probe.snapshot(150, 240)
    assert.equal(records.find((record) => record.type === 'touchmove')?.prevented, true)
    assert.ok(records.find((record) => record.type === 'preventDefault')?.stack?.includes('prevent'))
  } finally {
    otherPage.removeEventListener('touchmove', prevent)
    probe.stop()
    assert.equal(Event.prototype.preventDefault, originalPreventDefault)
  }
})

await render(null)
await act(async () => { root.unmount() })
assert.equal(bodyScrollLockDepth(), 0)
if (failures) throw new Error(`${failures} scroll lifecycle checks failed`)
console.log('scroll-lifecycle: ok')
