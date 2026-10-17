import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// Real Chromium key input verifies both our trap and the browser's default Tab behavior.
// Uses an isolated temporary profile and the project's existing Vite dependency.
const root = fileURLToPath(new URL('../', import.meta.url))
const candidates = [
  process.env.BROWSER_TEST_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
let executable
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break } catch {}
}
assert.ok(executable, 'Set BROWSER_TEST_CHROME to an installed Chromium or Chrome executable')
const profile = await mkdtemp(path.join(tmpdir(), 'newsnook-dialog-focus-'))
const assets = await readdir(path.join(root, 'dist/assets'))
const compiledStyles = assets.find(file => /^index-.*\.css$/.test(file))
assert.ok(compiledStyles, 'Build the app before checking its actual theme CSS')
const browserStyles = await readFile(path.join(root, 'src/features/browser/browser.css'), 'utf8')
const server = await createServer({
  root, configFile: false, logLevel: 'silent', appType: 'custom',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'browser-dialog-focus-fixture',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__dialog-focus')) return next()
        response.setHeader('Content-Type', 'text/html')
        const themeCase = ['case=theme-', 'case=workspace', 'case=player-'].some(value => request.url.includes(value))
        const theme = new URL(request.url, 'http://localhost').searchParams.get('theme') === 'dark' ? 'dark' : 'light'
        const head = themeCase ? '<link rel="stylesheet" href="/dist/assets/' + compiledStyles + '"><style>' + browserStyles + '</style>' : ''
        response.end('<!doctype html><html data-scheme="buer" data-theme="' + theme + '"><head><meta name="viewport" content="width=device-width, initial-scale=1">' + head + '</head><body><div id="root"></div><script type="module" src="/scripts/browser-dialog-focus.fixture.tsx"></script></body></html>')
      })
    },
  }],
})
let browser
let socket
let nextId = 0
const requests = new Map()
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('CDP timeout: ' + method)) }, 10000)
    requests.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
let pageSession
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, pageSession)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description)
  return result.result.value
}
const focused = () => evaluate('document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim()')
const inside = selector => evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.contains(document.activeElement) ?? false')
async function click(selector) {
  await evaluate('(() => { const target = document.querySelector(' + JSON.stringify(selector) + '); if (!target) throw new Error("Missing control"); target.focus(); target.click() })()')
  await pause(25)
}
async function clickText(text) {
  await evaluate('(() => { const target = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === ' + JSON.stringify(text) + '); if (!target) throw new Error("Missing text control"); target.focus(); target.click() })()')
  await pause(25)
}
async function key(name, shift = false) {
  const keyCode = name === 'Tab' ? 9 : 27
  const params = { key: name, code: name, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...params }, pageSession)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...params }, pageSession)
  await pause(25)
}
async function load(scenario, port) {
  await send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__dialog-focus?case=' + scenario }, pageSession)
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate('window.__focusFixtureReady === true')) return
    await pause(50)
  }
  throw new Error('Fixture did not load: ' + scenario)
}

try {
  await server.listen()
  const port = server.httpServer.address().port
  browser = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--user-data-dir=' + profile, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Chromium did not expose a DevTools endpoint')), 10000)
    browser.once('error', reject)
    browser.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (!message.id) return
    const pending = requests.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    requests.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  pageSession = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
  await send('Page.enable', {}, pageSession)

  const evidenceDirectory = process.env.BROWSER_TEST_EVIDENCE_DIR
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true })
  const evidence = []
  const safeAreaOnly = process.argv.includes('--safe-area-only')
  const settle = () => evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  async function waitFor(expression, label) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return
      await pause(50)
    }
    throw new Error('Visual fixture did not settle: ' + label)
  }
  async function capture(name, viewport, theme) {
    await settle()
    const layout = await evaluate(`(() => {
      const icons = [...document.querySelectorAll(".browser-icon-button")].filter(button => {
        const box = button.getBoundingClientRect()
        return box.width && box.height && !button.closest("[inert]")
      })
      return {
        viewport: innerWidth, content: document.documentElement.scrollWidth,
        uiFont: getComputedStyle(document.querySelector(".browser-workspace")).fontFamily,
        iconTargets: icons.length,
        undersizedIcons: icons.filter(button => { const box = button.getBoundingClientRect(); return box.width < 44 || box.height < 44 }).map(button => button.getAttribute("aria-label")),
      }
    })()`)
    assert.ok(layout.content <= layout.viewport, name + ': content cannot overflow the viewport horizontally')
    assert.deepEqual(layout.undersizedIcons, [], name + ': browser icon targets remain at least 44px')
    const file = name + '-' + viewport.width + '-' + theme + '.png'
    if (evidenceDirectory) {
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }, pageSession)
      await writeFile(path.join(evidenceDirectory, file), Buffer.from(screenshot.data, 'base64'))
    }
    evidence.push({ file, theme, viewport, ...layout })
  }

  if (!safeAreaOnly) {
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true }, pageSession)
    await load('player-owner', port)
    await click('#opener')
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('Boolean(document.querySelector("[aria-label=全屏]"))')) break
      await pause(50)
    }
    const playerOwner = '[data-test-player-owner]'
    await click('[aria-label^="选择视频资源，共"]')
    assert.equal(await evaluate('document.querySelector("[data-test-player-owner]").contains(document.querySelector("[role=dialog][aria-label^=已嗅探到]"))'), true, 'Owned player resource dialogs stay inside the browser focus container')
    await key('Tab', true)
    assert.equal(await inside('[role="dialog"][aria-label^="已嗅探到"]'), true, 'Owned resource dialog traps reverse Tab')
    await key('Tab')
    assert.equal(await inside('[role="dialog"][aria-label^="已嗅探到"]'), true, 'Owned resource dialog traps forward Tab')
    await key('Escape')
    assert.equal(await inside(playerOwner), true, 'Resource Escape closes its layer without exiting the browser player')
    await evaluate('document.querySelector("[aria-label=投屏]").focus(); window.__openCastForTest()')
    await pause(50)
    const castDialog = '[role="dialog"][aria-label="选择投屏设备"]'
    assert.equal(await inside(castDialog), true, 'The owned cast picker receives focus')
    assert.equal(await evaluate('document.querySelector("[data-test-player-owner]").contains(document.querySelector("[role=dialog][aria-label=选择投屏设备]"))'), true)
    await key('Tab', true)
    assert.equal(await inside(castDialog), true)
    await key('Tab')
    assert.equal(await inside(castDialog), true)
    await click(castDialog + ' [aria-label="关闭"]')
    assert.equal(await focused(), '投屏', 'Closing the cast picker restores its player control')
    await evaluate('window.__openCastForTest()')
    await pause(50)
    await key('Escape')
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(castDialog) + ') === null'), true)
    assert.equal(await inside(playerOwner), true, 'Cast Escape leaves the browser player open')

    await evaluate('document.querySelector("[data-video-gestures]").requestFullscreen = async () => { throw new Error("Exercise native-style fixed fullscreen") }')
    await click('[aria-label="全屏"]')
    await pause(75)
    const immersive = '[data-video-fullscreen="true"]'
    assert.equal(await evaluate('document.querySelector("[data-test-player-owner]").contains(document.querySelector("[data-video-session-host]"))'), true, 'Owned fixed fullscreen stays inside the browser')
    await key('Tab', true)
    assert.equal(await inside(immersive), true, 'Fullscreen focus cannot move to the covered browser controls')
    await key('Tab')
    assert.equal(await inside(immersive), true)
    await key('Escape')
    await pause(75)
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(immersive) + ') === null'), true, 'Escape exits owned fullscreen')
    assert.equal(await inside(playerOwner), true, 'Fullscreen Escape leaves the browser player open')
    await click('[aria-label="悬浮播放"]')
    assert.equal(await evaluate('document.querySelector("[data-test-player-owner]").contains(document.querySelector("[data-floating-video-window]"))'), true, 'An owned floating window stays in the browser focus container')
    await click('#player-back')
    assert.equal(await evaluate('document.querySelector("[data-test-player-owner]") === null'), true)
    assert.equal(await evaluate('document.querySelector("[data-floating-video-window]").parentElement === document.body'), true, 'A detached floating session returns to the app container')
    assert.equal(await evaluate('window.__videoManager.getSnapshot()[0].props.overlayContainer === undefined'), true, 'A detached session releases its removed browser container')
    await click('[aria-label="关闭悬浮播放"]')

    await load('player-browser', port)
    await click('#opener')
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate('Boolean(document.querySelector("[aria-label=全屏]"))')) break
      await pause(50)
    }
    assert.equal(await evaluate('document.querySelector("[aria-label^=选择视频资源]") === null'), true, 'The browser can suppress the duplicate player resource FAB')
    assert.equal(await evaluate('document.querySelector("[aria-label=锁定控制]") === null'), true, 'Unavailable placeholder controls are not exposed')
    assert.equal(await evaluate('[...document.querySelectorAll("button")].some(button => ["片头", "片尾", "极速播", "选集"].includes(button.textContent.trim()))'), false)
    const playerBounds = await evaluate('(() => { const root = document.querySelector("[data-video-gestures]").getBoundingClientRect(); const fullscreen = document.querySelector("[aria-label=全屏]").getBoundingClientRect(); return { width: root.width, left: fullscreen.left, right: fullscreen.right, viewport: innerWidth } })()')
    assert.ok(playerBounds.width >= 318, 'The player fills its narrow browser container')
    assert.ok(playerBounds.left >= 0 && playerBounds.right <= playerBounds.viewport, 'The full-screen button remains reachable at 320px')
    console.log('Player bounds at 320px: ' + JSON.stringify(playerBounds))

    await load('player-default', port)
    await click('#opener')
    await click('[aria-label^="选择视频资源，共"]')
    assert.equal(await evaluate('!document.querySelector("[data-test-player-owner]").contains(document.querySelector("[role=dialog][aria-label^=已嗅探到]"))'), true, 'Other player instances retain their default app-level portals')
    console.log('Browser player ownership: real resource/cast/fullscreen focus, floating detach, default portals and 320px controls OK')

    await load('workspace', port)
    await click('#opener')
    const workspace = '[aria-label="NewsNook 网页浏览器"]'
    const searchDialog = '[aria-label="搜索与地址"]'
    const toolbarMenu = '[aria-label="浏览器控制"] [aria-label="网页工具"]'
    await click('[aria-label="浏览器控制"] [aria-label="搜索或输入网址"]')
    assert.equal(await focused(), '搜索或输入网址', 'Opening search retains input focus under StrictMode')
    await key('Tab', true)
    assert.equal(await inside(searchDialog), true, 'Shift+Tab from search cannot reach covered browser controls')
    assert.equal(await focused(), '填入网址 example.org')
    await key('Tab')
    assert.equal(await focused(), '搜索或输入网址', 'Tab wraps from the last search action to its input')
    await evaluate('document.querySelector(' + JSON.stringify(toolbarMenu) + ').focus()')
    await pause(25)
    assert.equal(await inside(searchDialog), true, 'Covered browser controls cannot take focus from search')
    await clickText('取消')
    assert.equal(await focused(), '搜索或输入网址', 'Closing search restores its toolbar opener')
    assert.equal(await inside(workspace), true)
    await evaluate('document.querySelector(' + JSON.stringify(toolbarMenu) + ').focus()')
    await key('Tab')
    assert.equal(await inside(workspace), true, 'Tab from the last browser control cannot reach the background app')
    await evaluate('document.querySelector(' + JSON.stringify(workspace) + ').querySelector("button").focus()')
    await key('Tab', true)
    assert.equal(await inside(workspace), true, 'Reverse Tab from the first browser control stays in the workspace')
    await evaluate('document.getElementById("background").focus()')
    await pause(25)
    assert.equal(await inside(workspace), true, 'The background app cannot steal browser focus')

    for (const page of [
      { menu: '浏览历史', label: '浏览历史' },
      { menu: '书签', label: '书签' },
      { menu: '浏览设置', label: '浏览器设置' },
      { menu: null, label: '标签页' },
    ]) {
      if (page.menu) {
        await click(toolbarMenu)
        await clickText(page.menu)
      } else {
        await click('[aria-label="浏览器控制"] [aria-label="标签页"]')
      }
      const pageSelector = 'section[aria-label="' + page.label + '"]'
      await evaluate('document.querySelector(' + JSON.stringify(pageSelector + ' [aria-label="返回浏览器"]') + ').focus()')
      await key('Tab', true)
      assert.equal(await inside(pageSelector), true, page.label + ': reverse Tab cannot reach the covered toolbar')
      await key('Tab')
      assert.equal(await focused(), '返回浏览器', page.label + ': Tab wraps to the page back button')
      await evaluate('document.querySelector(' + JSON.stringify(toolbarMenu) + ').focus()')
      await pause(25)
      assert.equal(await inside(pageSelector), true, page.label + ': covered toolbar cannot steal focus')
      if (page.menu === '浏览历史') {
        await click(pageSelector + ' [aria-label="清空浏览历史"]')
        await key('Tab', true)
        assert.equal(await focused(), '确认删除', 'The confirmation owns focus above the full page and workspace')
        await key('Tab')
        assert.equal(await focused(), '关闭清空浏览历史')
        await key('Escape')
        assert.equal(await focused(), '清空浏览历史', 'Closing confirmation restores its full-page trigger')
        assert.equal(await inside(pageSelector), true)
      }
      await click(pageSelector + ' [aria-label="返回浏览器"]')
      assert.equal(await focused(), page.menu ? '网页工具' : '标签页', page.label + ': returning restores a visible toolbar control')
    }
    await click(toolbarMenu)
    await clickText('返回有所闻')
    assert.equal(await evaluate('document.querySelector(' + JSON.stringify(workspace) + ') === null'), true)
    assert.equal(await focused(), 'opener', 'Exiting the browser restores the app opener')
    console.log('Browser workspace keyboard: search, full-page tabs/places/settings, nested confirmation and app focus restoration OK')

    await load('sheet', port)
    await click('#opener')
    assert.equal(await inside('[aria-label="测试弹层"]'), true, 'Opening focuses the active dialog')
    await key('Tab', true)
    assert.equal(await focused(), 'last', 'Shift+Tab from the dialog cannot reach the background')
    await key('Tab')
    assert.equal(await focused(), '关闭测试弹层', 'Tab wraps from the last action to the dialog close button')
    await key('Tab')
    assert.equal(await focused(), 'first')
    await key('Tab')
    assert.equal(await focused(), 'last', 'Disabled and hidden controls are skipped')
    await evaluate('document.getElementById("background").focus()')
    await pause(25)
    assert.equal(await inside('[aria-label="测试弹层"]'), true, 'Programmatic focus cannot escape the active dialog')
    await click('[aria-label="关闭测试弹层"]')
    assert.equal(await focused(), 'opener', 'Closing a dialog restores its opener')

    await load('autofocus', port)
    await click('#opener')
    assert.equal(await focused(), 'autofocus', 'Dialog setup preserves an autoFocus input, including StrictMode replay')
    await click('[aria-label="关闭测试弹层"]')
    assert.equal(await focused(), 'opener', 'autoFocus must not overwrite the restore target')

    await load('sheet', port)
    await click('#opener')
    await click('#last')
    assert.equal(await inside('[aria-label="叠加确认"]'), true)
    await key('Tab', true)
    assert.equal(await focused(), 'confirm', 'Only the top dialog handles reverse Tab')
    await key('Tab')
    assert.equal(await focused(), '关闭叠加确认', 'Only the top dialog handles forward Tab')
    await key('Tab')
    assert.equal(await focused(), 'cancel')
    await click('#cancel')
    assert.equal(await focused(), 'last', 'Closing confirmation restores its opener in the underlying dialog')
    await click('#last')
    await evaluate('window.__dismissDialog()')
    await pause(25)
    assert.equal(await focused(), 'opener', 'Unmounting both layers restores the external opener')

    await load('scripts', port)
    await click('#opener')
    assert.equal(await inside('[aria-label="用户脚本管理"]'), true)
    await click('[aria-label="删除 Keyboard specimen"]')
    assert.equal(await inside('[aria-label="删除用户脚本"]'), true)
    await key('Tab', true)
    assert.equal(await focused(), '删除脚本')
    await key('Tab')
    assert.equal(await focused(), '取消')
    await key('Escape')
    assert.equal(await focused(), '删除 Keyboard specimen', 'Canceling deletion restores the script-row control')
    await clickText('Keyboard specimenv1.0 · https://example.com/*')
    await clickText('审核修改')
    assert.equal(await inside('[aria-label="脚本权限确认"]'), true)
    await key('Tab', true)
    assert.equal(await focused(), '确认更新')
    await key('Tab')
    assert.equal(await focused(), '返回编辑')
    await key('Escape')
    assert.equal(await focused(), '审核修改', 'Canceling permissions restores the editor action')
    assert.equal(await evaluate('document.querySelector("textarea").value.includes("Keyboard specimen")'), true)
    await clickText('审核修改')
    await evaluate('window.__dismissDialog()')
    await pause(25)
    assert.equal(await focused(), 'opener', 'Script-manager teardown restores outside both dialog levels')

    await load('settings', port)
    assert.equal(await evaluate('document.querySelector("[role=switch]").disabled'), true, 'Desktop mode is disabled while a native command is pending')
    await click('[role="switch"]')
    assert.equal(await evaluate('window.__desktopChanges'), 0, 'Pending desktop changes do not enqueue another toggle')
    // Capture the real local favicon fallback without variable third-party responses.
    await send('Network.enable', {}, pageSession)
    await send('Network.setBlockedURLs', { urls: ['*/favicon.ico'] }, pageSession)
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, pageSession)
    const preferencesKey = 'newsnook:browser:preferences:v1'
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }]) {
      await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 2, mobile: true }, pageSession)
      for (const theme of ['light', 'dark']) {
        const suffix = '&theme=' + theme
        await load('theme-settings' + suffix, port)
        const settingsAppearance = await evaluate(`(() => {
          const choices = [...document.querySelectorAll("[role=radio]")]
          const selected = choices.find(choice => choice.getAttribute("aria-checked") === "true")
          const unselected = choices.find(choice => choice.getAttribute("aria-checked") === "false")
          return {
            choices: choices.length, switches: document.querySelectorAll("[role=switch]").length,
            selected: getComputedStyle(selected).backgroundColor, unselected: getComputedStyle(unselected).backgroundColor,
            fills: [...document.querySelectorAll(".browser-workspace svg.lucide")].map(icon => getComputedStyle(icon).fill),
            outsideFill: getComputedStyle(document.querySelector("[data-outside-browser] svg")).fill,
          }
        })()`)
        assert.equal(settingsAppearance.choices, 9, 'The theme fixture renders the complete preferences panel')
        assert.equal(settingsAppearance.switches, 6, 'All web and privacy preference switches are present')
        assert.ok(settingsAppearance.fills.every(fill => fill === 'none'), 'Browser line icons retain empty fills in ' + theme)
        assert.notEqual(settingsAppearance.selected, settingsAppearance.unselected, 'Selected choices have distinct backgrounds in ' + theme)
        assert.notEqual(settingsAppearance.outsideFill, 'none', 'The correction must not change other workspaces')
        await capture('browser-settings', viewport, theme)
        await click('[role="radio"][aria-label="桌面版"]')
        await waitFor('JSON.parse(localStorage.getItem(' + JSON.stringify(preferencesKey) + ')).userAgentMode === "desktop"', 'saved desktop UA')
        await click('[aria-label="放大网页文字"]')
        await waitFor('JSON.parse(localStorage.getItem(' + JSON.stringify(preferencesKey) + ')).textZoom === 110', 'saved text zoom')
        await click('[role="switch"][aria-label="JavaScript"]')
        await waitFor('JSON.parse(localStorage.getItem(' + JSON.stringify(preferencesKey) + ')).javaScriptEnabled === false', 'saved JavaScript preference')
        await evaluate('document.querySelector(".browser-panel-scroll").scrollTop = document.querySelector(".browser-panel-scroll").scrollHeight')
        await capture('browser-settings-permissions', viewport, theme)
        await click('[role="radio"][aria-label="自定义"]')
        await click('.browser-user-agent-editor button[type="submit"]')
        assert.equal(await evaluate('document.querySelector("#browser-user-agent-error")?.textContent'), '请输入自定义浏览器标识')
        assert.equal(await evaluate('JSON.parse(localStorage.getItem(' + JSON.stringify(preferencesKey) + ')).userAgentMode'), 'desktop', 'An invalid custom UA does not replace the saved mode')
        await evaluate('document.querySelector(".browser-user-agent-editor").scrollIntoView({ block: "center" })')
        await capture('browser-settings-custom-error', viewport, theme)

        await load('theme-tabs' + suffix, port)
        const tabsAppearance = await evaluate('(() => { const active = document.querySelector(".browser-tab-card[data-active=true]"); const inactive = document.querySelector(".browser-tab-card:not([data-active])"); return { active: getComputedStyle(active).backgroundColor, inactive: getComputedStyle(inactive).backgroundColor, fills: [...document.querySelectorAll(".browser-tab-close svg")].map(icon => getComputedStyle(icon).fill) } })()')
        assert.equal(tabsAppearance.fills.length, 2)
        assert.ok(tabsAppearance.fills.every(fill => fill === 'none'), 'Tab action icons remain outlined')
        assert.notEqual(tabsAppearance.active, tabsAppearance.inactive, 'Active tab has a distinct background in ' + theme)
        await waitFor('document.querySelectorAll(".browser-site-icon img").length === 0', 'tab favicon fallback after a failed response')
        await capture('browser-tabs', viewport, theme)

        for (const privateMode of [false, true]) {
          await load((privateMode ? 'theme-private-home' : 'theme-home') + suffix, port)
          if (!privateMode) await waitFor('document.querySelectorAll(".browser-site-icon img").length === 0', 'home favicon fallback after a failed response')
          const home = await evaluate(`(() => {
            const workspace = document.querySelector('[aria-label="NewsNook 网页浏览器"]')
            const toolbar = workspace.querySelector('[aria-label="浏览器控制"]')
            const address = toolbar.querySelector('[aria-label="搜索或输入网址"]')
            const rect = address.getBoundingClientRect()
            return {
              privateMode: workspace.dataset.privateMode === "true",
              title: workspace.querySelector("h1")?.textContent,
              recent: Boolean(workspace.querySelector("#browser-recent-title")),
              shortcuts: Boolean(workspace.querySelector("#browser-shortcuts-title")),
              remoteImages: [...workspace.querySelectorAll("img")].filter(img => /^https?:/.test(img.getAttribute("src") || "")).length,
              address: { left: rect.left, right: rect.right, width: rect.width },
              toolbarText: toolbar.textContent,
            }
          })()`)
          assert.equal(home.privateMode, privateMode)
          assert.equal(home.title, privateMode ? '隐私浏览' : '浏览器')
          assert.equal(home.recent, !privateMode, 'Private home does not render ordinary history')
          assert.equal(home.shortcuts, !privateMode, 'Private home does not render ordinary shortcuts')
          assert.ok(home.address.left >= 0 && home.address.right <= viewport.width && home.address.width >= 44, 'Address input remains reachable at ' + viewport.width + 'px')
          if (privateMode) {
            assert.equal(home.remoteImages, 0, 'Private home makes no ordinary favicon requests')
            assert.ok(home.toolbarText.includes('隐私'), 'Private state remains visible in the address bar')
          }
          await capture(privateMode ? 'browser-private-home' : 'browser-home', viewport, theme)

          await load((privateMode ? 'theme-private-images' : 'theme-images') + suffix, port)
          await waitFor(`document.querySelectorAll('button[aria-label^="查看："] img').length === 6 && [...document.querySelectorAll('button[aria-label^="查看："] img')].every(image => image.complete && image.naturalWidth > 0)`, 'six thumbnails under StrictMode')
          assert.equal(await evaluate(`document.querySelector('[role="group"][aria-label="图片筛选"] button[aria-pressed="true"]').textContent`), '内容图片 6')
          if (privateMode) assert.equal(await evaluate('document.querySelector(".browser-page-heading p").textContent'), '隐私会话')
          const clippedDimensions = await evaluate(`[...document.querySelectorAll('button[aria-label^="查看："] > span:last-child')].filter(span => span.scrollWidth > span.clientWidth).map(span => span.textContent)`)
          assert.deepEqual(clippedDimensions, [], 'Image dimensions remain complete at ' + viewport.width + 'px')
          await capture(privateMode ? 'browser-private-images' : 'browser-images', viewport, theme)
          await click('button[aria-label="查看：湖畔晨光"]')
          await waitFor(`Boolean(document.querySelector('[data-image-track] > div:not([aria-hidden]) img')?.naturalWidth)`, 'full image under StrictMode')
          assert.equal(await evaluate(`document.querySelector('[role="dialog"][aria-label="查看图片"]').getAttribute("data-theme")`), 'dark', 'The immersive image viewer keeps its deliberate dark surface')
          if (privateMode) assert.ok(await evaluate(`document.querySelector('[role="dialog"][aria-label="查看图片"]').textContent.includes("隐私")`), 'Private state stays visible in the image viewer')
          await capture(privateMode ? 'browser-private-lightbox' : 'browser-lightbox', viewport, theme)
          if (privateMode) {
            await click('[aria-label="图片操作"]')
            await clickText('保存到相册')
            await waitFor('Boolean(document.querySelector("#browser-image-export-title"))', 'private image export confirmation')
            assert.equal(await evaluate(`document.querySelector('[role="dialog"][aria-label="查看图片"]').textContent.includes("正在保存")`), false, 'Export waits for confirmation before showing save progress')
            assert.equal(await inside('[aria-labelledby="browser-image-export-title"]'), true, 'Export confirmation owns focus above the image viewer')
            await key('Tab', true)
            assert.equal(await inside('[aria-labelledby="browser-image-export-title"]'), true, 'Export confirmation traps reverse Tab')
            await capture('browser-private-image-export', viewport, theme)
            await click('[aria-labelledby="browser-image-export-title"] button')
            assert.equal(await evaluate('document.querySelector("#browser-image-export-title") === null'), true, 'Canceling export keeps the image inside this fixture')
            await click('[aria-label="关闭菜单"]')
          }
          await click('[role="dialog"][aria-label="查看图片"] [aria-label="关闭"]')
          await waitFor(`document.querySelector('[role="dialog"][aria-label="查看图片"]') === null`, 'closing the image viewer')
        }
        console.log('Visual matrix ' + viewport.width + 'px / ' + theme + ': complete settings, private/normal home, tabs, image loader, lightbox and export confirmation OK')
      }
    }
  }

  // Android edge-to-edge measurements from the audit device. Absolute full-page
  // overlays must own their safe-area padding; the workspace's padding is not inherited.
  const insetViewport = { width: 320, height: 740 }
  await send('Emulation.setDeviceMetricsOverride', { ...insetViewport, deviceScaleFactor: 2, mobile: true }, pageSession)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, pageSession)
  for (const privateMode of [false, true]) {
    const theme = privateMode ? 'dark' : 'light'
    await load((privateMode ? 'theme-private-images' : 'theme-images') + '&theme=' + theme, port)
    await evaluate('document.documentElement.style.setProperty("--sat", "max(52px, 52px)"); document.documentElement.style.setProperty("--sab", "max(24px, 24px)")')
    await waitFor(`document.querySelectorAll('button[aria-label^="查看："] img').length === 6 && [...document.querySelectorAll('button[aria-label^="查看："] img')].every(image => image.naturalWidth > 0)`, 'safe-area thumbnails')
    await settle()
    const insets = await evaluate(`(() => {
      const panel = document.querySelector('[role="dialog"][aria-label="看图模式"]')
      const header = panel.querySelector('.browser-page-header').getBoundingClientRect()
      const scroll = panel.querySelector('[class*="overflow-y-auto"]').getBoundingClientRect()
      const style = getComputedStyle(panel)
      return { paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, headerTop: header.top, scrollBottom: scroll.bottom }
    })()`)
    assert.equal(insets.paddingTop, '52px')
    assert.equal(insets.paddingBottom, '24px')
    assert.ok(insets.headerTop >= 52, 'The image header clears the actual Android status-bar inset')
    assert.ok(insets.scrollBottom <= insetViewport.height - 24, 'Image content clears the gesture-navigation inset')
    await capture(privateMode ? 'browser-private-images-safe-area' : 'browser-images-safe-area', insetViewport, theme)
    if (privateMode) {
      await click('button[aria-label="查看：湖畔晨光"]')
      await waitFor(`Boolean(document.querySelector('[data-image-track] > div:not([aria-hidden]) img')?.naturalWidth)`, 'safe-area lightbox')
      const viewerInsets = await evaluate(`(() => {
        const viewer = document.querySelector('[role="dialog"][aria-label="查看图片"]')
        return { closeTop: viewer.querySelector('[aria-label="关闭"]').getBoundingClientRect().top,
          thumbnailsBottom: viewer.querySelector('[aria-label="图片缩略图"]').getBoundingClientRect().bottom }
      })()`)
      assert.ok(viewerInsets.closeTop >= 52, 'The image viewer close action clears the status bar')
      assert.ok(viewerInsets.thumbnailsBottom <= insetViewport.height - 24, 'Viewer thumbnails clear the gesture area')
      await capture('browser-private-lightbox-safe-area', insetViewport, theme)
    }
    console.log('Image safe-area ' + theme + ': ' + JSON.stringify(insets))
  }
  const manifest = safeAreaOnly ? 'browser-safe-area-matrix.json' : 'browser-visual-matrix.json'
  if (evidenceDirectory) await writeFile(path.join(evidenceDirectory, manifest), JSON.stringify(evidence, null, 2) + '\n')
  console.log(safeAreaOnly ? 'Browser image safe-area: 3 focused visual states and Android inset bounds OK'
    : 'Browser dialogs and themes: existing focus/player coverage plus ' + evidence.length + ' visual states, actual preference saves, StrictMode images and Android inset bounds OK')
} finally {
  if (socket?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => undefined)
  socket?.close()
  browser?.kill()
  for (const pending of requests.values()) clearTimeout(pending.timer)
  await server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)
}
