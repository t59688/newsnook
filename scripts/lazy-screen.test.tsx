import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import React, { act, Suspense, startTransition } from 'react'
import { parseHTML } from 'linkedom'

assert.ok(existsSync(new URL('../src/lib/lazyScreen.tsx', import.meta.url)), 'Screens need a shared preload cache that renders synchronously after warming')
const { lazyScreen } = await import('../src/lib/lazyScreen')
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const root = createRoot(document.getElementById('root')!)
const screen = () => <p>RSS store controls</p>
let calls = 0
let resolve!: (module: { default: typeof screen }) => void
const Store = lazyScreen(() => { calls++; return new Promise(done => { resolve = done }) })
assert.equal(calls, 0, 'declaring a screen must not add work to cold startup')
const pending = Store.preload()
assert.equal(pending, Store.preload(), 'warming and navigation share one module request')
assert.equal(calls, 1)
resolve({ default: screen })
await pending
let fallbacks = 0
function Fallback() { React.useLayoutEffect(() => { fallbacks++ }, []); return <p>Opening screen</p> }
try {
  await act(async () => root.render(<Suspense fallback={<Fallback />}><Store /></Suspense>))
  assert.equal(fallbacks, 0, 'even the very first render of a warmed screen must not suspend')
  assert.equal(document.getElementById('root')!.textContent, 'RSS store controls')

  let release!: (module: { default: typeof screen }) => void
  const Cold = lazyScreen(() => new Promise(done => { release = done }))
  await act(async () => root.render(<Suspense fallback={<Fallback />}>{null}</Suspense>))
  await act(async () => startTransition(() => root.render(<Suspense fallback={<Fallback />}><Cold /></Suspense>)))
  assert.equal(fallbacks, 0, 'a cold settings navigation retains the committed surface, including an initially empty overlay')
  await act(async () => { release({ default: screen }) })
  assert.equal(document.getElementById('root')!.textContent, 'RSS store controls')

  let finish!: (module: { default: React.ComponentType }) => void
  const Stateful = lazyScreen(() => new Promise(done => { finish = done }))
  function Editor() {
    const [value, setValue] = React.useState('draft')
    return <button onClick={() => setValue('edited')}>{value}</button>
  }
  await act(async () => startTransition(() => root.render(<Suspense fallback={<Fallback />}><Stateful /></Suspense>)))
  await act(async () => { finish({ default: Editor }) })
  await act(async () => document.querySelector('button')!.click())
  await act(async () => root.render(<Suspense fallback={<Fallback />}><Stateful /></Suspense>))
  assert.equal(document.querySelector('button')!.textContent, 'edited', 'finishing a cold import must not change component identity and reset page state on later renders')

  let finishStale!: (module: { default: typeof screen }) => void
  const Stale = lazyScreen(() => new Promise(done => { finishStale = done }))
  await act(async () => startTransition(() => root.render(<Suspense fallback={<Fallback />}><Stale /></Suspense>)))
  await act(async () => root.render(<Suspense fallback={<Fallback />}><Store /></Suspense>))
  await act(async () => { finishStale({ default: () => <p>Stale destination</p> }) })
  assert.equal(document.getElementById('root')!.textContent, 'RSS store controls', 'a late module must not override a newer navigation')

  let attempts = 0
  const Retry = lazyScreen(async () => { if (++attempts === 1) throw new Error('offline'); return { default: screen } })
  await assert.rejects(Retry.preload(), /offline/)
  await Retry.preload()
  await act(async () => root.render(<Suspense fallback={<Fallback />}><Retry /></Suspense>))
  assert.equal(attempts, 2, 'a failed speculative preload must not poison later navigation')
  assert.equal(fallbacks, 0)
  console.log('Screen preload: cold-start isolation, deduplication, synchronous first render, transitions, state preservation, stale navigation and retry passed')
} finally {
  await act(async () => root.unmount())
}
