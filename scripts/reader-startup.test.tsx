import assert from 'node:assert/strict'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { Article } from '../src/lib/types'
import type { PrestoredBody } from '../src/features/prestore/store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const data = new Map<string, string>()
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
const requestFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }
const cancelFrame = (id: number) => frames.delete(id)
Object.assign(window, {
  requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame,
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
})
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
  HTMLAnchorElement: window.HTMLAnchorElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: requestFrame, cancelAnimationFrame: cancelFrame,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size },
  },
})
let localRead = deferred<PrestoredBody | null>()
let localReads = 0
let networkReads = 0
mock.module('../src/features/prestore/store.ts', { namedExports: {
  loadPrestoredBody: () => { localReads++; return localRead.promise },
} })
mock.module('../src/lib/resolveBody.ts', { namedExports: {
  resolveArticleBody: () => { networkReads++; return new Promise(() => {}) },
  pageUserAgentForArticle: () => undefined,
} })
// Keep ReaderScreen and its body rendering real. Isolate optional audio/AI and
// device gesture services, which are unrelated to the local-first body restore.
mock.module('../src/components/AiSpeedReadPanel.tsx', { namedExports: { AiSpeedReadPanel: () => null } })
mock.module('../src/features/readAloud/useReadAloud.ts', { namedExports: {
  useReadAloud: () => ({ snapshot: { state: 'idle' }, isCurrentArticle: false }),
} })
const partial = { body: '', thinking: '', status: '' }
mock.module('../src/features/speedRead/useSpeedRead.ts', { namedExports: {
  useSpeedRead: () => ({ available: false, open: false, state: 'idle', markdown: '', closePanel() {},
    partialStore: { subscribe: () => () => {}, getSnapshot: () => partial } }),
} })
mock.module('../src/hooks/useNetworkStatus.ts', { namedExports: {
  useNetworkStatus: () => ({ online: true, connectionType: 'wifi' }),
} })
mock.module('../src/hooks/useReaderFontPinch.ts', { namedExports: {
  useReaderFontPinch: () => ({ hudLabel: null }),
} })
mock.module('../src/lib/volumePageTurn.ts', { namedExports: {
  setVolumePageTurnEnabled: async () => {}, addVolumePageTurnListener: async () => () => {},
} })
const { createRoot } = await import('react-dom/client')
const { ReaderScreen } = await import('../src/screens/ReaderScreen')
const { StartupReadinessProvider } = await import('../src/components/StartupReadiness')
const { DEFAULT_PREFERENCES } = await import('../src/sources/preferences')
const { saveCachedBody } = await import('../src/lib/bodyCache')
const article: Article = {
  id: 'startup-reader', title: 'Offline article', summary: 'Summary', publishedAt: 1, hasRealDate: true,
  sourceId: 'test', sourceName: 'Test', sourceLabel: 'Test', sourceGroup: 'custom',
  originUrl: 'https://example.org/offline', contentType: 'article',
}
const prestored = {
  article, html: '<p>Restored offline body is available.</p>', bodySource: 'readability', savedAt: 1,
} as PrestoredBody
let readyCalls = 0
const onReady = () => { readyCalls++ }
const noop = () => {}
const sources: [] = []
const root = createRoot(document.getElementById('root')!)
function surface(startupVisible = true) {
  return <React.StrictMode><StartupReadinessProvider onReady={onReady}>
    {!startupVisible && <aside>Browser overlay controls</aside>}
    <ReaderScreen article={article} saved={false} onClose={noop} onToggleLater={noop}
      onCacheChange={noop} translationPrefs={DEFAULT_PREFERENCES.translation}
      readAloudPrefs={DEFAULT_PREFERENCES.readAloud} customSources={sources} startupVisible={startupVisible}/>
  </StartupReadinessProvider></React.StrictMode>
}
async function frame() {
  const pending = [...frames.values()]
  frames.clear()
  await act(async () => pending.forEach(callback => callback(performance.now())))
}
async function reset() {
  await act(async () => root.render(null))
  data.clear()
  localRead = deferred<PrestoredBody | null>()
  localReads = networkReads = readyCalls = 0
}
try {
  await act(async () => root.render(surface()))
  await frame(); await frame()
  assert.equal(readyCalls, 0, 'a real Reader skeleton must wait for local persisted body restoration')
  assert.equal(networkReads, 0, 'local restoration is tried before any network extraction')
  await act(async () => localRead.resolve(prestored))
  assert.match(document.body.textContent ?? '', /Restored offline body is available/)
  await frame(); await frame()
  assert.equal(readyCalls, 1, 'the persisted body must be committed before the initial Reader frame is reported')
  assert.equal(networkReads, 0)

  await reset()
  await act(async () => root.render(surface()))
  await act(async () => localRead.resolve(null))
  assert.equal(networkReads, 1)
  await frame(); await frame()
  assert.equal(readyCalls, 1, 'a cache miss releases startup even while network extraction remains pending')

  await reset()
  await act(async () => root.render(surface()))
  await act(async () => localRead.reject(new Error('Local snapshot unavailable')))
  assert.equal(networkReads, 1, 'a failed local read falls back to normal extraction')
  await frame(); await frame()
  assert.equal(readyCalls, 1, 'local read failures cannot leave startup blocked')

  await reset()
  assert.equal(saveCachedBody(article, { html: '<p>Hot cached article body.</p>', bodySource: 'readability' }), true)
  await act(async () => root.render(surface()))
  assert.equal(localReads, 0, 'a synchronous cache hit skips the durable read')
  assert.match(document.body.textContent ?? '', /Hot cached article body/)
  await frame(); await frame()
  assert.equal(readyCalls, 1)

  await reset()
  await act(async () => root.render(surface(false)))
  await frame(); await frame()
  assert.equal(readyCalls, 1, 'a browser covering Reader does not wait for the hidden local body')
  await act(async () => root.render(null))
  await act(async () => localRead.resolve(prestored))
  assert.equal(document.body.textContent, '', 'an unmounted Reader ignores a late persisted body')
  console.log('Reader startup: real local restore, cache hit, miss/error network fallback, coverage and cancellation passed')
} finally {
  await act(async () => root.unmount())
  mock.restoreAll()
}
