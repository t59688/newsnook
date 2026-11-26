import assert from 'node:assert/strict'
import React, { act, createRef } from 'react'
import { parseHTML } from 'linkedom'
import { CategoryRail, type CategoryRailGestureHandle } from '../src/components/CategoryRail'
import type { NewsCategory } from '../src/sources/categories'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const prototype = window.HTMLElement.prototype
Object.defineProperty(prototype, 'offsetWidth', { configurable: true, get() { return 80 } })
Object.defineProperty(prototype, 'offsetLeft', { configurable: true, get() {
  if (this.getAttribute('role') !== 'tab') return 0
  return Array.from(this.parentElement?.querySelectorAll('[role="tab"]') ?? []).indexOf(this) * 100 + 10
} })
Object.defineProperty(prototype, 'clientWidth', { configurable: true, get() { return 160 } })
Object.defineProperty(prototype, 'scrollWidth', { configurable: true, get() { return 580 } })
const { createRoot } = await import('react-dom/client')
const root = createRoot(document.querySelector('#root')!)
const ref = createRef<CategoryRailGestureHandle>()
const categories: NewsCategory[] = Array.from({ length: 5 }, (_, i) => ({
  id: `category-${i}`, label: `分类${i}`, short: `分类${i}`, caption: `频道${i}`,
}))
let commits = 0
await act(async () => root.render(<CategoryRail ref={ref} categories={categories} activeId={categories[0].id} onChange={() => { commits++ }} />))
const scroller = document.querySelector('[role="tablist"]') as HTMLElement
const indicator = scroller.querySelector('.will-change-transform') as HTMLElement
assert.ok(indicator, 'a live visual indicator exists')
assert.ok(ref.current, 'gesture compositor handle is ready')
let scrollWrites = 0
let scrollPosition = 0
Object.defineProperty(scroller, 'scrollLeft', { configurable: true, get() { return scrollPosition }, set(value) { scrollWrites++; scrollPosition = Number(value) } })
const tab = (i: number) => scroller.querySelectorAll('[role="tab"]')[i] as HTMLElement
for (let i = 0; i <= 20; i++) ref.current!.followSwipe(-i * 2, 360)
assert.equal(scrollWrites, 0, 'ordinary indicator tracking does not scroll the entire rail every frame')
assert.equal(indicator.style.width, '16px', 'indicator uses a fixed layout width')
assert.match(indicator.style.transform, /scaleX\(/, 'the original elastic stretch is handled by compositor scaling')
assert.notEqual(tab(0).style.opacity, '1', 'active tab fades with gesture progress')
assert.notEqual(tab(1).style.opacity, '0.68', 'target tab fades in without React reconciliation')
assert.equal(tab(2).style.opacity, '0.68', 'unrelated labels never receive gesture style writes')
ref.current!.followSwipe(40, 360)
assert.equal(tab(1).style.opacity, '0.68', 'reversing direction restores the old target label')
ref.current!.followSwipe(0, 360, 240)
assert.equal(tab(0).style.opacity, '1', 'settling restores active tab opacity')
assert.equal(commits, 0, 'dragging the indicator alone must never navigate')
await act(async () => root.unmount())
console.log('category-rail-performance: fixed-width elastic indicator, focused label fades and bounded scrolling OK')
