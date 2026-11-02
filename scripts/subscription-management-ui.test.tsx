import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

import { DEFAULT_PREFERENCES, addCustomSource } from '../src/sources/preferences'
import type { NewsSource } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.defineProperty(window.document, 'oninput', { configurable: true, value: null })
window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  DOMParser: window.DOMParser, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
} })
const { createRoot } = await import('react-dom/client')
const { CustomSourcesScreen } = await import('../src/screens/settings/CustomSourcesScreen')
const root = createRoot(document.getElementById('root')!)

let prefs = DEFAULT_PREFERENCES
const alpha = addCustomSource(prefs, { name: 'Alpha Feed', label: 'Alpha', url: 'https://alpha.example/feed.xml' }, 'tech-media')
prefs = alpha.nextPrefs
const beta = addCustomSource(prefs, { name: 'Beta Feed', label: 'Beta', url: 'https://beta.example/feed.xml' }, 'world-zh')
prefs = beta.nextPrefs
const gamma = addCustomSource(prefs, { name: 'Gamma Feed', label: 'Gamma', url: 'https://gamma.example/feed.xml' })
prefs = gamma.nextPrefs

const actions: Array<{ type: string; ids?: string[]; categoryId?: string; paused?: boolean }> = []
const props = {
  prefs,
  onAddCustomSource: (_value: NewsSource) => {},
  onUpdateCustomSource: () => {},
  onDeleteCustomSource: () => {},
  onDeleteCustomSources: () => {},
  onMoveCustomSourcesToCategory: (ids: string[], categoryId: string) => actions.push({ type: 'move', ids, categoryId }),
  onAddCustomSourcesToCategory: (ids: string[], categoryId: string) => actions.push({ type: 'add', ids, categoryId }),
  onSetCustomSourcesPaused: (ids: string[], paused: boolean) => actions.push({ type: 'pause', ids, paused }),
  onBatchImport: () => {},
  onOpenFeedStore: () => {},
  onBack: () => {},
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label))
  assert.ok(match, 'missing button: ' + label)
  return match as HTMLButtonElement
}
async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click() })
}
async function chooseOption(label: string): Promise<void> {
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent?.trim() === label)
  assert.ok(option, 'missing option: ' + label)
  await click(option as HTMLElement)
}
function sourceListText(): string {
  return document.querySelector('ul.divide-y')?.textContent ?? ''
}

try {
  await act(async () => root.render(<CustomSourcesScreen {...props} />))
  assert.ok(sourceListText().includes('Alpha Feed'))
  assert.ok(sourceListText().includes('中文公共'))
  assert.ok(sourceListText().includes('未归类'))

  await click(button('全部分类'))
  await chooseOption('未归类')
  assert.ok(sourceListText().includes('Gamma Feed'), 'uncategorized filter shows unassigned source')
  assert.ok(!sourceListText().includes('Alpha Feed'), 'uncategorized filter hides categorized source')

  await click(button('未归类'))
  await chooseOption('全部分类')
  await click(button('批量管理'))
  await click(button('Alpha'))
  await click(button('Gamma'))
  await click(button('移动到分类'))
  await chooseOption('中文公共')
  assert.deepEqual(actions.at(-1), { type: 'move', ids: [alpha.newSourceId, gamma.newSourceId], categoryId: 'world-zh' })

  await click(button('批量管理'))
  await click(button('Alpha'))
  await click(button('加入分类'))
  await chooseOption('市场快讯')
  assert.deepEqual(actions.at(-1), { type: 'add', ids: [alpha.newSourceId], categoryId: 'biz-market' })

  await click(button('批量管理'))
  await click(button('Beta'))
  await click(button('暂停抓取'))
  assert.deepEqual(actions.at(-1), { type: 'pause', ids: [beta.newSourceId], paused: true })
} finally {
  await act(async () => root.unmount())
}
console.log('subscription management UI: ok')
