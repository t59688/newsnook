import assert from 'node:assert/strict'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html data-theme="light"><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
})
window.HTMLElement.prototype.hasPointerCapture = () => false
window.HTMLElement.prototype.releasePointerCapture = () => {}
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 600 }) as DOMRect
window.HTMLElement.prototype.scrollTo = function (options: ScrollToOptions) { this.scrollLeft = options.left ?? 0 }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const styles: string[] = []
const bridges: string[] = []
let nextStyle: ReturnType<typeof deferred> | null = null
let failStyle = false
;(window as unknown as { NewsNookNative: unknown }).NewsNookNative = {
  setSystemTheme: (theme: string) => bridges.push(theme),
}
mock.module('@capacitor/core', { namedExports: {
  WebPlugin: class {}, CapacitorHttp: {}, registerPlugin: () => ({}),
  Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  SystemBarsStyle: { Light: 'LIGHT', Dark: 'DARK' },
  SystemBars: { setStyle: async ({ style }: { style: string }) => {
    styles.push(style)
    const pending = nextStyle
    nextStyle = null
    if (pending) await pending.promise
    if (failStyle) { failStyle = false; throw new Error('old native plugin') }
  } },
} })
const { createRoot } = await import('react-dom/client')
const { ImageLightbox } = await import('../src/components/ImageLightbox')
const { applyNativeChrome } = await import('../src/lib/nativeChrome')
const root = createRoot(document.getElementById('root')!)
const imageItems = [{ src: 'blob:current', alt: '当前图片' }, { src: 'blob:neighbor', alt: '相邻图片' }]
const fixture = (src = '', loadError?: string) => <React.StrictMode>
  <ImageLightbox src={src} alt="当前图片" browserMode items={imageItems} total={2} onClose={() => {}} loadError={loadError}/>
</React.StrictMode>
const adjust = () => document.querySelector<HTMLButtonElement>('button[aria-label="调整图片"]')!
const toolbar = () => document.querySelector('[role="toolbar"][aria-label="图片调整"]')
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function loaded(img: HTMLImageElement) {
  Object.defineProperties(img, {
    naturalWidth: { value: 1200, configurable: true },
    naturalHeight: { value: 800, configurable: true },
    complete: { value: true, configurable: true },
  })
  await act(async () => img.dispatchEvent(new window.Event('load')))
}

try {
  await applyNativeChrome('light')
  await act(async () => root.render(fixture()))
  await flush()
  assert.equal(styles.at(-1), 'DARK', 'a dark browser viewer must use light native system-bar icons')
  assert.equal(bridges.at(-1), 'dark', 'the native fallback bridge must match the temporary dark viewer')
  assert.equal(document.documentElement.dataset.theme, 'light', 'opening a viewer never changes the user theme')
  assert.equal(adjust().disabled, true, 'an unresolved native image cannot open adjustments')
  await act(async () => adjust().click())
  assert.equal(toolbar(), null)
  await loaded(document.querySelector<HTMLImageElement>('img[src="blob:neighbor"]')!)
  assert.equal(adjust().disabled, true, 'a loaded neighboring slide cannot enable current-image adjustments')

  await act(async () => root.render(fixture('blob:current')))
  assert.equal(adjust().disabled, true, 'receiving the blob URL still waits for the displayed image to load')
  await loaded(document.querySelector<HTMLImageElement>('img[alt="当前图片"]')!)
  assert.equal(adjust().disabled, false, 'the current image load enables adjustments')
  await act(async () => adjust().click())
  assert.ok(toolbar(), 'the enabled adjustment action opens a stable toolbar')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="收起图片调整"]')!.click())
  await act(async () => root.render(fixture('blob:current', '当前图片请求失败')))
  assert.equal(adjust().disabled, true, 'a native image error cannot leave adjustments enabled')
  await act(async () => root.render(fixture('blob:replacement')))
  assert.equal(adjust().disabled, true, 'replacing the main image returns adjustments to the loading state')

  document.documentElement.dataset.theme = 'dark'
  await applyNativeChrome('dark')
  await act(async () => root.render(null))
  await flush()
  assert.equal(bridges.at(-1), 'dark', 'closing restores the current theme, including changes made while viewing')
  document.documentElement.dataset.theme = 'light'
  await applyNativeChrome('light')
  await act(async () => root.render(fixture('blob:again')))
  await applyNativeChrome('light')
  assert.equal(bridges.at(-1), 'dark', 'global theme synchronization must not override an active viewer')
  await act(async () => root.render(null))
  await flush()
  assert.equal(bridges.at(-1), 'light', 'leaving the browser viewer restores light system bars')
  assert.equal(styles.at(-1), 'LIGHT')
  assert.equal(document.documentElement.dataset.theme, 'light')

  const gate = deferred()
  nextStyle = gate
  await act(async () => root.render(fixture('blob:fast')))
  assert.equal(styles.at(-1), 'DARK')
  await act(async () => root.render(null))
  const beforeDelayedReply = bridges.length
  gate.resolve()
  await flush()
  assert.equal(styles.at(-1), 'LIGHT', 'a delayed native dark request cannot win after the viewer closes')
  assert.deepEqual(bridges.slice(beforeDelayedReply), ['light'], 'stale native replies never restore a closed viewer theme')

  failStyle = true
  await act(async () => root.render(fixture('blob:fallback')))
  await flush()
  assert.equal(bridges.at(-1), 'dark', 'the existing native bridge still works when SystemBars is unavailable')
  await act(async () => root.render(null))
  await flush()
  const beforeReader = bridges.length
  await act(async () => root.render(<ImageLightbox src="blob:reader" onClose={() => {}}/>))
  await flush()
  assert.equal(bridges.length, beforeReader, 'the browser-only scope does not change the reader viewer contract')
  console.log('Browser image chrome: temporary system bars, current-theme restoration, delayed native replies and loaded-only adjustments OK')
} finally { await act(async () => root.unmount()) }
