import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const server = await createServer({ server: { port: 0, host: '127.0.0.1' } })
let browser
let releasePage
let releaseStore
try {
  await server.listen()
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_AGENT_CHROMIUM || undefined,
  })
  const page = await browser.newPage({ viewport: { width: 420, height: 800 } })
  await page.addInitScript(() => {
    for (const key of ['splash-seen', 'tour-seen', 'scheme-onboarding-seen', 'sync-onboarding-seen']) {
      localStorage.setItem(`newsnook:${key}`, 'true')
    }
  })
  // Keep the first visit genuinely cold and hold the page module until we have
  // checked the visible shell. A warm import would hide the regression.
  const pageReleased = new Promise(resolve => { releasePage = resolve })
  await page.route('**/src/screens/MeScreen.tsx*', async route => {
    await pageReleased
    await route.continue()
  })
  const storeReleased = new Promise(resolve => { releaseStore = resolve })
  await page.route('**/src/screens/settings/FeedStoreScreen.tsx*', async route => {
    await storeReleased
    await route.continue()
  })
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/rss+xml', body: '<rss version="2.0"><channel><title>Test</title></channel></rss>' }))
  await page.goto(server.resolvedUrls.local[0])
  const dock = page.locator('[data-surface="tabbar"]')
  await dock.waitFor({ state: 'visible' })
  const initialDock = await dock.boundingBox()
  assert.ok(initialDock.y > 650, 'the dock initially sits at the bottom')
  const pageRequested = page.waitForRequest('**/src/screens/MeScreen.tsx*')
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await pageRequested
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const pendingDock = await dock.boundingBox()
  assert.ok(Math.abs(pendingDock.y - initialDock.y) < 1,
    `cold tab navigation must keep the dock at the bottom (${initialDock.y} -> ${pendingDock.y})`)
  assert.equal(await page.getByRole('status').filter({ hasText: '正在打开页面' }).count(), 0,
    'keep the current page visible while the next tab loads')
  releasePage()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: /RSS 订阅商店/ }).click()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.getByText('正在加载…', { exact: true }).count(), 0,
    'a cold RSS store must not replace the settings menu with a loading placeholder')
  assert.equal(await page.getByRole('heading', { name: '设置', exact: true }).isVisible(), true,
    'the settings menu remains usable until a cold destination is ready')
  releaseStore()
  await page.getByRole('heading', { name: 'RSS 订阅商店', exact: true }).waitFor()
  await page.getByRole('searchbox').first().waitFor()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  assert.ok(Math.abs((await dock.boundingBox()).y - initialDock.y) < 1,
    'the loaded settings page keeps the same dock position')
  await page.getByRole('button', { name: '速闻', exact: true }).click()
  await page.getByRole('button', { name: '我的', exact: true }).click()
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  console.log('Cold and warm tab navigation preserve content and dock geometry')
} finally {
  releasePage?.()
  releaseStore?.()
  await browser?.close()
  await server.close()
}
