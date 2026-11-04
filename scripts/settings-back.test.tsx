import assert from 'node:assert/strict'
import React, { act, startTransition, Suspense, useState } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
let reduceMotion = false
window.matchMedia = (() => ({ matches: reduceMotion, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
})
const { createRoot } = await import('react-dom/client')
const { SettingsShell } = await import('../src/components/SettingsShell')
const { lazyScreen } = await import('../src/lib/lazyScreen')
const root = createRoot(document.getElementById('root')!)
const host = document.getElementById('root')!
let calls = 0
let release!: (module: { default: React.ComponentType }) => void
const Presets = lazyScreen(() => new Promise(done => { release = done }))
const titles: string[] = []
function PresetPage() {
  return <SettingsShell title="场景预设" onBack={() => { calls++; titles.push('设置') }}>预设内容</SettingsShell>
}
function Categories() {
  const [parent, setParent] = useState(false)
  return <>
    <div data-settings-menu>设置</div>
    <Suspense fallback={<p>Opening parent</p>}>
      {parent ? <Presets /> : <SettingsShell title="分类与信源" onBack={() => {
        calls++
        titles.push('场景预设')
        startTransition(() => setParent(true))
      }}>分类内容</SettingsShell>}
    </Suspense>
  </>
}
try {
  await act(async () => root.render(<Categories />))
  await act(async () => (host.querySelector('[aria-label="返回"]') as HTMLButtonElement).click())
  assert.equal(calls, 1, 'back must request the real parent immediately, without first fading out to the settings menu')
  const shell = host.querySelector<HTMLElement>('.paper-settings-shell')!
  assert.ok(shell, 'a delayed parent module retains the current shell')
  assert.equal(shell.style.animation ?? '', '', 'the opaque page background must not be animated away')
  assert.doesNotMatch(shell.textContent ?? '', /opacity:\s*0/, 'content motion must not fade the full overlay and reveal the unrelated settings menu')
  await act(async () => { release({ default: PresetPage }) })
  assert.deepEqual([...host.querySelectorAll('h1')].map(heading => heading.textContent), ['场景预设'])
  await act(async () => new Promise(done => setTimeout(done, 280)))
  assert.equal(calls, 1, 'a late exit timer must never trigger the parent page’s back callback')
  assert.deepEqual(titles, ['场景预设'], 'one click must navigate exactly one level')

  reduceMotion = true
  await act(async () => root.render(<SettingsShell key="reduced" title="分类与信源" onBack={() => { calls++ }}>内容</SettingsShell>))
  await act(async () => (host.querySelector('[aria-label="返回"]') as HTMLButtonElement).click())
  assert.equal(calls, 2, 'reduced motion uses the same immediate back behavior')
  const backdrop = host.querySelector<HTMLElement>('.paper-settings-shell')!
  const motion = backdrop.querySelector<HTMLElement>('div')!
  assert.equal(motion.style.animation ?? '', '', 'reduced motion has no content animation')

  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
  window.cancelAnimationFrame = id => { frames.delete(id) }
  window.getComputedStyle = (() => ({ transform: 'none' })) as typeof window.getComputedStyle
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  motion.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 640, width: 320, height: 640, x: 0, y: 0, toJSON() {} })
  motion.setPointerCapture = () => {}
  motion.hasPointerCapture = () => true
  motion.releasePointerCapture = () => {}
  for (const [type, x] of [['pointerdown', 5], ['pointermove', 200], ['pointerup', 220]] as const) {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(event, { pointerId: 1, pointerType: 'pen', isPrimary: true, clientX: x, clientY: 100 })
    await act(async () => {
      motion.dispatchEvent(event)
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(performance.now()))
    })
  }
  assert.equal(calls, 3, 'the content layer still supports a committed edge swipe')
  assert.equal(backdrop.style.visibility ?? '', '', 'a completed swipe must not hide the opaque backdrop while the parent is pending')
  assert.equal(backdrop.style.transform ?? '', '', 'swipe transforms belong to content rather than exposing the menu underneath')
  console.log('Settings back: direct parent, opaque pending surface, single navigation, reduced motion and edge swipe passed')
} finally {
  await act(async () => root.unmount())
}
