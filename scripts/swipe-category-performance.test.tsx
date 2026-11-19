import assert from 'node:assert/strict'
import React, { act, useRef } from 'react'
import { parseHTML } from 'linkedom'
import { useSwipeCategory } from '../src/hooks/useSwipeCategory'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
window.requestAnimationFrame = (cb) => { frames.set(++frameId, cb); return frameId }
window.cancelAnimationFrame = (id) => { frames.delete(id) }
const flush = () => {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((cb) => cb(0))
}

const { createRoot } = await import('react-dom/client')
const root = createRoot(document.getElementById('root')!)
const commits: string[] = []
let renders = 0
function Fixture() {
  renders++
  const containerRef = useRef<HTMLDivElement>(null)
  const { dragX, transitionMs } = useSwipeCategory({
    containerRef, reduced: true, canGo: () => true,
    onCommit: (direction) => commits.push(direction),
  })
  return <div data-parent><div ref={containerRef} data-track data-drag-x={dragX} data-transition={transitionMs} /></div>
}
await act(async () => root.render(<Fixture />))
const parent = document.querySelector('[data-parent]') as HTMLElement
const track = document.querySelector('[data-track]') as HTMLElement
let reads = 0
Object.defineProperty(parent, 'clientWidth', { configurable: true, get() { reads++; return 360 } })
Object.defineProperty(track, 'clientWidth', { configurable: true, get() { reads++; return 360 } })

async function touch(type: string, x: number, y = 200) {
  const point = { identifier: 1, clientX: x, clientY: y }
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, {
    touches: Object.assign(type === 'touchend' ? [] : [point], { item(index: number) { return this[index] ?? null } }),
    changedTouches: Object.assign(type === 'touchend' ? [point] : [], { item(index: number) { return this[index] ?? null } }),
  })
  await act(async () => { track.dispatchEvent(event); flush() })
  return event.defaultPrevented
}
for (let index = 0; index < 8; index++) {
  await touch('touchstart', 280)
  await touch('touchend', 280)
}
assert.equal(reads, 0, 'touchstart reuses the measured width until resize, without synchronous layout reads')
await touch('touchstart', 280)
assert.equal(await touch('touchmove', 140), true, 'horizontal swipe retains ownership')
assert.equal(track.dataset.dragX, '-140', 'horizontal swipe still moves with the finger')
const rendersBeforeContinuousDrag = renders
for (let x = 130; x >= 30; x -= 5) {
  await touch('touchmove', x)
  assert.equal(track.style.getPropertyValue('--feed-swipe-x'), `${x - 280}px`, 'composited swipe tracks each pointer frame')
}
assert.ok(renders - rendersBeforeContinuousDrag < 10, 'continuous drag does not reconcile the entire feed each frame')
await touch('touchend', 30)
assert.deepEqual(commits, ['next'])
assert.equal(track.dataset.dragX, '0', 'commit resets the previous category transform')
await act(async () => root.unmount())
console.log('swipe-category-performance: cached width and unchanged gesture semantics OK')
