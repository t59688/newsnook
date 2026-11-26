import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { Article } from '../src/lib/types'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  CSS: { supports: () => false },
})
const observerInstances: MockIntersectionObserver[] = []
class MockIntersectionObserver {
  targets = new Set<Element>()
  constructor(private callback: IntersectionObserverCallback) { observerInstances.push(this) }
  observe(target: Element) { this.targets.add(target) }
  unobserve(target: Element) { this.targets.delete(target) }
  disconnect() { this.targets.clear() }
  fire(targets: Element[], visible: boolean) {
    this.callback(targets.map(target => ({target, isIntersecting:visible} as IntersectionObserverEntry)),this as unknown as IntersectionObserver)
  }
}
Object.assign(globalThis, { IntersectionObserver: MockIntersectionObserver })
const idleTasks: Array<() => void> = []
Object.assign(window, {
  requestIdleCallback(fn: () => void) { idleTasks.push(fn); return idleTasks.length },
  cancelIdleCallback() {},
})
const proto = window.HTMLElement.prototype
Object.defineProperty(proto,'offsetHeight',{configurable:true,get() {return Number.parseFloat(this.style.height||'')||160}})
Object.defineProperty(proto,'getBoundingClientRect',{configurable:true,value() {return {left:0,top:0,width:360,height:Number.parseFloat(this.style.height||'')||160,right:360,bottom:160}}})
const { createRoot } = await import('react-dom/client')
const { ViewportArticleRow } = await import('../src/components/ViewportArticleRow')
const root=createRoot(document.querySelector('#root')!)
const articles: Article[] = Array.from({length:25},(_,i)=>({
  id:`qa-item-${i}`,title:`Test article ${i}`,summary:'A stable feed row',sourceGroup:'cn',
  sourceId:'netease',sourceName:'Netease',sourceLabel:'Feed',originUrl:`https://example.com/${i}`,
  publishedAt:Date.now()-i*1000,hasRealDate:true,image:'https://example.com/thumb.png',
}))
let opens=0
await act(async () => root.render(
  <div data-scroll-surface=""><ul className="editorial-feed-rows">
    {articles.map(article => <ViewportArticleRow key={article.id} article={article} read={false} saved={false} onOpen={()=>{opens++}} variant="row" />)}
  </ul></div>,
))
const rows=Array.from(document.querySelectorAll('.article-row-item'))
assert.equal(rows.length,25,'preserve all 25 list positions and source ordering')
assert.equal(rows.filter(x=>x.querySelector('button')).length,25,'initial layout measures real row geometry')
assert.equal(observerInstances.length,1,'all rows share one scroll IntersectionObserver')
const far=rows.slice(7)
await act(async()=>{
  observerInstances[0].fire(far,false)
  while (idleTasks.length) idleTasks.splice(0).forEach(run=>run())
})
assert.equal(document.querySelectorAll('[data-windowed-spacer]').length,far.length,'distant rows become equal-height placeholders')
assert.equal(document.querySelectorAll('.article-row-item').length,25,'no item can disappear from list layout')
for (const node of document.querySelectorAll('[data-windowed-spacer]')) {
  assert.equal((node as HTMLElement).style.height,'160px','spacers preserve measured row height')
}
const parked=Array.from(document.querySelectorAll('[data-windowed-spacer]'))
await act(async()=>observerInstances[0].fire(parked.slice(0,4),true))
assert.equal(document.querySelectorAll('[data-windowed-spacer]').length,far.length-4,'nearby rows rehydrate without losing content')
const visibleRow=document.querySelector('.article-row-item button') as HTMLButtonElement
await act(async()=>visibleRow.click())
assert.equal(opens,1,'card tap still navigates after windowing')
await act(async()=>root.unmount())
assert.equal(observerInstances[0].targets.size,0,'all shared IntersectionObserver targets cleaned up')
console.log('viewport-article-windowing: measured heights, stable semantic rows, distant unmount, near restore and tap OK')
