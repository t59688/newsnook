import assert from 'node:assert/strict'
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

// Use the declared Playwright dependency; env overrides support shared local runtimes.
const { chromium } = await import(process.env.NEWSNOOK_PLAYWRIGHT_MODULE || 'playwright')
const name = `__settings-focus-${process.pid}.html`
const fixture = resolve(name)
let server
let browser
try {
  await writeFile(fixture, `<!doctype html><html lang="zh-CN" data-theme="light" data-scheme="ink"><body>
    <div class="paper-settings-shell"><div class="paper-settings-shell-scroll space-y-5 p-5">
      <div id="frame" class="flex rounded-xl border border-haze focus-within:border-cinnabar"><input id="compound" class="outline-none" aria-label="组合输入框"></div>
      <input id="bordered" aria-label="独立输入框" class="border border-haze focus:border-cinnabar focus:outline-none">
      <input id="plain" aria-label="默认焦点输入框">
      <button id="button">键盘操作</button>
    </div></div><script type="module">import '/src/index.css'; window.focusStylesReady=true;</script></body></html>`)
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.NEWSNOOK_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NEWSNOOK_CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${name}`)
  await page.waitForFunction(() => window.focusStylesReady)
  const frameBefore = await page.locator('#frame').evaluate((element) => getComputedStyle(element).borderColor)
  await page.locator('#compound').focus()
  const compound = await page.locator('#compound').evaluate((element) => ({ outline: getComputedStyle(element).outlineStyle, focusVisible: element.matches(':focus-visible') }))
  assert.equal(compound.focusVisible, true)
  assert.equal(compound.outline, 'none', 'a framed input must not gain a second rectangular focus outline')
  assert.notEqual(await page.locator('#frame').evaluate((element) => getComputedStyle(element).borderColor), frameBefore, 'the surrounding frame must still indicate focus')
  await page.locator('#bordered').focus()
  assert.equal(await page.locator('#bordered').evaluate((element) => getComputedStyle(element).outlineStyle), 'none', 'focus:outline-none must also remain effective')
  await page.locator('#plain').focus()
  assert.equal(await page.locator('#plain').evaluate((element) => getComputedStyle(element).outlineStyle), 'solid', 'ordinary inputs retain a visible focus outline')
  await page.locator('#button').focus()
  assert.equal(await page.locator('#button').evaluate((element) => getComputedStyle(element).outlineStyle), 'solid', 'keyboard button focus remains visible')
  console.log('settings focus: single composite frame, standalone border and keyboard focus passed')
} finally {
  await browser?.close()
  await server?.close()
  await unlink(fixture).catch(() => {})
}
