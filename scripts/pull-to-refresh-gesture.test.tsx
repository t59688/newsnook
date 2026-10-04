import assert from 'node:assert/strict'
import React, { act, useRef } from 'react'
import { parseHTML } from 'linkedom'
import { usePullToRefresh } from '../src/hooks/usePullToRefresh'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
window.requestAnimationFrame = (cb) => { frames.set(++frameId, cb); return frameId }
window.cancelAnimationFrame = (id) => { frames.delete(id) }
const translateY = (node: HTMLElement) => Number(node.style.transform?.match(/translate3d\(0, ([\d.-]+)px, 0\)/)?.[1] ?? 0)
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { top: Number(this.dataset.contentTop ?? 0) + translateY(this) } as DOMRect
}
window.getComputedStyle = ((node: HTMLElement) => ({ transform: `matrix(1, 0, 0, 1, 0, ${translateY(node)})` })) as any
Object.assign(globalThis, { DOMMatrixReadOnly: class {
  m42: number
  constructor(value: string) { this.m42 = Number(value.slice(7, -1).split(',')[5]) }
} })
const { createRoot } = await import('react-dom/client')
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
let refreshes = 0
function Fixture() {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { containerRef, indicatorRef, phase } = usePullToRefresh({
    onRefresh: () => { refreshes++ }, surfaceRef, reduced: true,
  })
  return <div data-ancestor><div ref={indicatorRef} data-phase={phase} />
    <div ref={containerRef} data-scroller><div ref={surfaceRef} data-content><div data-nested>News</div></div></div>
  </div>
}
let scroller: HTMLElement
let nested: HTMLElement
let ancestor: HTMLElement
const phase = () => host.querySelector('[data-phase]')!.getAttribute('data-phase')
const content = () => host.querySelector('[data-content]') as HTMLElement
const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((cb) => cb(0)) }
async function touch(type: string, y = 0, cancelable = true, target = nested, x = 100) {
  const event = new window.Event(type, { bubbles: true, cancelable })
  Object.assign(event, { touches: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] })
  await act(async () => { target.dispatchEvent(event); await Promise.resolve() })
  return event.defaultPrevented
}
async function mount() {
  await act(async () => { root.render(null) })
  refreshes = 0
  await act(async () => { root.render(<Fixture />) })
  scroller = host.querySelector('[data-scroller]') as HTMLElement
  nested = host.querySelector('[data-nested]') as HTMLElement
  ancestor = host.querySelector('[data-ancestor]') as HTMLElement
  for (const node of [nested, scroller, ancestor, document.body, document.documentElement]) node.scrollTop = 0
  Object.defineProperty(scroller, 'clientTop', { value: 0 })
}
let failures = 0
async function check(name: string, run: () => Promise<void>) {
  await mount()
  try { await run(); console.log(`ok: ${name}`) }
  catch (error) { failures++; console.error(`FAIL: ${name}`, error) }
}
await check('a new downward gesture in the middle leaves native scrolling alone', async () => {
  scroller.scrollTop = 240
  await touch('touchstart')
  assert.equal(await touch('touchmove', 200), false)
  scroller.scrollTop = 0 // Reaching the top during this same contact must not arm refresh.
  assert.equal(await touch('touchmove', 400), false)
  await touch('touchend')
  assert.equal(refreshes, 0)
  assert.equal(phase(), 'idle')
})
await check('an upward start followed by a reversal stays native for the entire contact', async () => {
  await touch('touchstart', 200)
  assert.equal(await touch('touchmove', 100), false)
  assert.equal(await touch('touchmove', 400), false)
  await touch('touchend')
  assert.equal(refreshes, 0)
})
await check('browser-owned noncancelable movement cannot become a refresh', async () => {
  await touch('touchstart')
  await touch('touchmove', 200, false)
  flushFrames()
  assert.equal(phase(), 'idle')
  assert.ok(!content().style.transform)
  await touch('touchend')
  assert.equal(refreshes, 0)
})
for (const owner of ['ancestor', 'nested'] as const) {
  await check(`a scrolled ${owner} cannot be mistaken for the top`, async () => {
    ;(owner === 'ancestor' ? ancestor : nested).scrollTop = 150
    await touch('touchstart')
    assert.equal(await touch('touchmove', 200), false)
    await touch('touchend')
    assert.equal(refreshes, 0)
  })
}
await check('content still above the viewport cannot be treated as the top', async () => {
  content().dataset.contentTop = '-120'
  await touch('touchstart')
  assert.equal(await touch('touchmove', 200), false)
  await touch('touchend')
  assert.equal(refreshes, 0)
})
await check('losing the top after ready clears phase and pending paint before the next contact', async () => {
  await touch('touchstart')
  await touch('touchmove', 200)
  assert.equal(phase(), 'ready')
  scroller.scrollTop = 150
  assert.equal(await touch('touchmove', 220), false)
  flushFrames()
  assert.equal(phase(), 'idle')
  assert.ok(!content().style.transform)
  assert.ok(!host.querySelector<HTMLElement>('[data-phase]')!.style.getPropertyValue('--pull-height'))
  await touch('touchend')
  scroller.scrollTop = 0
  await touch('touchstart')
  await touch('touchend')
  assert.equal(refreshes, 0, 'a tap must not reuse a previous ready phase')
})
await check('release must recheck the top even without another move event', async () => {
  await touch('touchstart')
  await touch('touchmove', 200)
  scroller.scrollTop = 100
  await touch('touchend')
  assert.equal(refreshes, 0)
  assert.equal(phase(), 'idle')
})
await check('a legitimate pull at the top refreshes exactly once and resets', async () => {
  await touch('touchstart')
  assert.equal(await touch('touchmove', 200), true)
  flushFrames()
  assert.ok(content().style.transform)
  assert.ok(!scroller.style.transform, 'the scroll viewport must stay stationary')
  await touch('touchend')
  await touch('touchend')
  assert.equal(refreshes, 1)
  assert.equal(phase(), 'idle')
  assert.ok(!content().style.transform)
})
await check('a pull transform must not conceal an underlying content offset on release', async () => {
  await touch('touchstart')
  await touch('touchmove', 200)
  flushFrames()
  content().dataset.contentTop = '-80' // Pull translation still makes the visual top positive.
  await touch('touchend')
  assert.equal(refreshes, 0)
  assert.equal(phase(), 'idle')
})
await check('horizontal movement cancels refresh ownership', async () => {
  await touch('touchstart')
  assert.equal(await touch('touchmove', 10, true, nested, 300), false)
  await touch('touchmove', 200)
  await touch('touchend')
  assert.equal(refreshes, 0)
})
// Exercise the news screen's actual wiring too: removing its surfaceRef must fail this check.
window.matchMedia = ((query: string) => ({ matches: query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} })) as any
Object.assign(globalThis, { MutationObserver: window.MutationObserver })
const { FeedScreen } = await import('../src/screens/FeedScreen')
await act(async () => { root.render(null) })
refreshes = 0
await act(async () => {
  root.render(<FeedScreen title="测试新闻" caption="" articles={[]} statuses={[]}
    refreshing={false} showLead={false} readIds={new Set()} laterIds={new Set()}
    onOpen={() => {}} onRefresh={async () => { refreshes++ }} />)
})
scroller = host.querySelector('[data-scroll-surface]') as HTMLElement
assert.ok(scroller)
scroller.scrollTop = 0
Object.defineProperty(scroller, 'clientTop', { value: 0 })
const listBody = scroller.firstElementChild as HTMLElement
await touch('touchstart', 0, true, listBody)
await touch('touchmove', 200, true, listBody)
flushFrames()
assert.ok(!scroller.style.transform, 'FeedScreen must not translate its native scroll viewport')
assert.ok(listBody.style.transform, 'FeedScreen must translate the content layer')
await touch('touchend', 200, true, listBody)
assert.equal(refreshes, 1)
console.log('ok: FeedScreen refresh translates content while keeping the native viewport stationary')
await act(async () => { root.unmount() })
assert.equal(failures, 0, `${failures} gesture regressions failed`)
console.log('pull-to-refresh-gesture: ok')
