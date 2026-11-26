import assert from 'node:assert/strict'
import React, { act, useRef, useState } from 'react'
import { parseHTML } from 'linkedom'
import { useSwipeCategory } from '../src/hooks/useSwipeCategory'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
window.innerWidth = 360
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
const compositorFrames: number[] = []
const boundaryOnCommit: string[] = []
let renders = 0
function Fixture() {
  renders++
  const [activeKey, setActiveKey] = useState('first')
  const containerRef = useRef<HTMLDivElement>(null)
  const { dragX, transitionMs } = useSwipeCategory({
    containerRef, activeKey, reduced: true, canGo: () => true,
    onCommit: (direction) => {
      boundaryOnCommit.push(document.querySelector<HTMLElement>('[data-current]')?.style.transform ?? '')
      commits.push(direction)
      setActiveKey(current => current === 'first' ? 'second' : 'first')
    },
    onDragFrame: (offset) => compositorFrames.push(offset),
  })
  return <div data-parent><div ref={containerRef} data-track data-drag-x={dragX} data-transition={transitionMs} style={{touchAction:'pan-y'}}>
    <div data-swipe-layer="current" data-current />
    <div data-swipe-layer="next" data-next />
  </div></div>
}
await act(async () => root.render(<Fixture />))
const parent = document.querySelector('[data-parent]') as HTMLElement
const track = document.querySelector('[data-track]') as HTMLElement
const currentLayer = document.querySelector('[data-current]') as HTMLElement
const nextLayer = document.querySelector('[data-next]') as HTMLElement
let reads = 0
Object.defineProperty(parent, 'clientWidth', { configurable: true, get() { reads++; return 360 } })
Object.defineProperty(track, 'clientWidth', { configurable: true, get() { reads++; return 360 } })

async function touch(type: string, x: number, y = 200, timestamp?: number) {
  const point = { identifier: 1, clientX: x, clientY: y }
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  if (timestamp !== undefined) Object.defineProperty(event, 'timeStamp', {value: timestamp})
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
await touch('touchstart', 280, 200, 1000)
await touch('touchmove', 260, 200, 1200)
await touch('touchmove', 250, 200, 1400)
await touch('touchend', 250, 200, 1408)
assert.equal(commits.length, 0, 'a slow short drag must not be mistaken for a fast fling')
await touch('touchstart', 280)
assert.equal(await touch('touchmove', 140), false, 'passive horizontal swipe never blocks native vertical scrolling')
assert.equal(track.dataset.dragX, '0', 'finger movement no longer re-renders the React feed')
assert.equal(currentLayer.style.transform, 'translate3d(-140px, 0, 0)', 'composited feed still moves with the finger')
const rendersBeforeContinuousDrag = renders
for (let x = 130; x >= 30; x -= 5) {
  await touch('touchmove', x)
  assert.equal(currentLayer.style.transform, `translate3d(${x - 280}px, 0, 0)`, 'only the current composite layer tracks each pointer frame')
  assert.equal(nextLayer.style.transform, `translate3d(calc(${x - 280}px + 100%), 0, 0)`, 'the next composite layer follows precisely')
  assert.equal(track.style.getPropertyValue('--feed-swipe-x'), '', 'no inherited CSS variable invalidates every article')
}
assert.equal(renders - rendersBeforeContinuousDrag, 0, 'continuous drag never reconciles the article feed')
assert.ok(compositorFrames.length >= 20, 'the swipe compositor still receives every touch frame')
assert.equal(compositorFrames.at(-1), -250, 'the final touch offset reaches the rail compositor')
await touch('touchend', 30)
assert.deepEqual(commits, ['next'])
assert.equal(boundaryOnCommit[0], 'translate3d(-360px, 0, 0)', 'outgoing preview stays fully visible until React replaces the page')
assert.equal(track.dataset.dragX, '0', 'commit resets the previous category transform after DOM commit')
await touch('touchstart', 280, 200, 2000)
await touch('touchmove', 240, 200, 2020)
await touch('touchend', 240, 200, 2030)
assert.deepEqual(commits, ['next', 'next'], 'a genuine short fast fling still switches category')
assert.equal(currentLayer.style.transform, '', 'the idle scroll surface leaves the compositor layer')
await act(async () => root.unmount())
console.log('swipe-category-performance: cached width and unchanged gesture semantics OK')
