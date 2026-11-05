import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
import { SOURCES } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
Object.defineProperty(window, 'innerWidth', { configurable: true, value: 420 })
Object.defineProperty(window, 'innerHeight', { configurable: true, value: 820 })
Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ x: 20, y: 20, left: 20, top: 20, right: 240, bottom: 140, width: 220, height: 120, toJSON() {} }),
})
const { createRoot } = await import('react-dom/client')
const { SourceFilterChips } = await import('../src/components/SourceFilterChips')
const root = createRoot(document.getElementById('root')!)
const source = SOURCES.find((item) => !item.workspaceOnly)!
const moved: Array<{ sourceId: string; categoryId: string }> = []

async function click(element: HTMLElement): Promise<void> {
  await act(async () => { element.click() })
}
async function chooseOption(label: string): Promise<void> {
  const option = [...document.querySelectorAll('[role="option"]')].find((item) => item.textContent?.trim() === label)
  assert.ok(option, 'missing option: ' + label)
  await click(option as HTMLElement)
}

try {
  await act(async () => root.render(
    <SourceFilterChips
      sources={[source]}
      selectedSourceId={null}
      onSelect={() => {}}
      favoriteSourceIds={DEFAULT_PREFERENCES.favoriteSourceIds}
      moveTargets={[{ id: 'tech-media', label: '科技产业', short: '科技产业', caption: '' }]}
      onMoveSource={(sourceId, categoryId) => moved.push({ sourceId, categoryId })}
    />,
  ))

  const chip = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(source.name))
  assert.ok(chip, 'source chip exists')
  await act(async () => {
    const event = new window.Event('contextmenu', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clientX', { value: 90 })
    Object.defineProperty(event, 'clientY', { value: 120 })
    chip!.dispatchEvent(event)
  })

  const moveAction = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes('移动到分类'))
  assert.ok(moveAction, 'long-press menu exposes move action')
  await click(moveAction as HTMLElement)
  await chooseOption('科技产业')
  assert.deepEqual(moved, [{ sourceId: source.id, categoryId: 'tech-media' }])
} finally {
  await act(async () => root.unmount())
}
console.log('source filter chip move UI: ok')
