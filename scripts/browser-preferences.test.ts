import assert from 'node:assert/strict'
import test from 'node:test'
import * as browserPreferences from '../src/features/browser/browserPreferences'
import {
  BROWSER_ENGINES, BROWSER_KEYS, DEFAULT_BROWSER_PREFERENCES, browserHostLabel, readBrowserList,
  loadBrowserPreferences, normalizeBrowserPreferences, readBrowserPreference, readHideRecentPreference, resolveBrowserAddress,
  saveBrowserPreferences, toggleBrowserDesktopMode, validateBrowserUserAgent, writeBrowserPreference,
} from '../src/features/browser/browserPreferences'

const stored = new Map<string, string>()
let unreadable = false
let unwritable = false
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem(key: string) {
    if (unreadable) throw new Error('Storage unavailable')
    return stored.get(key) ?? null
  },
  setItem(key: string, value: string) {
    if (unwritable) throw new Error('Quota exceeded')
    stored.set(key, String(value))
  },
} })

test('browser address input normalizes web addresses and encodes plain searches', () => {
  assert.equal(resolveBrowserAddress(' HTTPS://Example.COM:443/a?x=1#b ', 'bing'), 'https://example.com/a?x=1#b')
  assert.equal(resolveBrowserAddress('example.com/path?q=1#section', 'bing'), 'https://example.com/path?q=1#section')
  assert.equal(resolveBrowserAddress('localhost:5173', 'bing'), 'https://localhost:5173/')
  assert.equal(resolveBrowserAddress('127.0.0.1:8080/status', 'bing'), 'https://127.0.0.1:8080/status')
  assert.equal(resolveBrowserAddress('[::1]:8080/status', 'bing'), 'https://[::1]:8080/status')
  assert.equal(resolveBrowserAddress('新闻.中国/搜索', 'bing'), new URL('https://新闻.中国/搜索').href)
  for (const engine of Object.keys(BROWSER_ENGINES) as (keyof typeof BROWSER_ENGINES)[]) {
    assert.equal(resolveBrowserAddress(' 汉字 test & b ', engine), BROWSER_ENGINES[engine].url + encodeURIComponent('汉字 test & b'))
  }
  assert.equal(browserHostLabel('https://www.example.com/a'), 'example.com')
  assert.equal(browserHostLabel('about:blank'), '主页')
})

test('browser address input rejects empty and non-web navigation destinations', () => {
  for (const value of ['', '  ', 'javascript:alert(1)', 'data:text/html,hello', 'file:///private.txt', 'intent://example/#Intent;end', 'https://user:secret@example.com/', 'https://']) {
    assert.equal(resolveBrowserAddress(value, 'bing'), null, value)
  }
})

test('search operators remain search queries instead of invalid URL schemes', () => {
  for (const query of ['site:example.com 中文', 'intitle:新闻', 'filetype:pdf 浏览器']) {
    assert.equal(resolveBrowserAddress(query, 'google'), BROWSER_ENGINES.google.url + encodeURIComponent(query), query)
  }
})

test('browser preferences round-trip raw options and complete local payloads', () => {
  writeBrowserPreference(BROWSER_KEYS.search, 'google', true)
  assert.equal(readBrowserPreference(BROWSER_KEYS.search), 'google')
  const visits = [{ url: 'https://example.com/', title: '保留完整标题', time: 123 }]
  writeBrowserPreference(BROWSER_KEYS.history, visits)
  assert.deepEqual(readBrowserList(BROWSER_KEYS.history), visits)
  writeBrowserPreference(BROWSER_KEYS.shortcuts, [])
  assert.deepEqual(readBrowserList(BROWSER_KEYS.shortcuts), [], 'intentional empty data stays distinct from a missing key')
  assert.equal(readBrowserList('missing'), null)
  stored.set(BROWSER_KEYS.bookmarks, '{broken JSON')
  assert.equal(readBrowserList(BROWSER_KEYS.bookmarks), null, 'malformed local payloads use the caller fallback')
  assert.equal(readHideRecentPreference(), false, 'default hide recent preference is false (visible)')
  writeBrowserPreference(BROWSER_KEYS.hideRecent, 'true', true)
  assert.equal(readHideRecentPreference(), true, 'hide recent preference toggles to true')
  writeBrowserPreference(BROWSER_KEYS.hideRecent, 'false', true)
  assert.equal(readHideRecentPreference(), false, 'hide recent preference toggles to false')
})

test('legacy Bing default migrates once to Google without blocking a later explicit Bing choice', () => {
  stored.clear()
  stored.set(BROWSER_KEYS.search, 'bing')
  const loadBrowserSearchEngine = (browserPreferences as unknown as {
    loadBrowserSearchEngine?: () => string
  }).loadBrowserSearchEngine
  assert.equal(typeof loadBrowserSearchEngine, 'function', 'browser search defaults need one shared migration boundary')
  assert.equal(loadBrowserSearchEngine!(), 'google')
  assert.equal(stored.get(BROWSER_KEYS.search), 'google')
  writeBrowserPreference(BROWSER_KEYS.search, 'bing', true)
  assert.equal(loadBrowserSearchEngine!(), 'bing', 'a choice made after migration remains user-controlled')
})

test('storage read failures fall back and write failures preserve the previous payload', () => {
  unreadable = true
  assert.equal(readBrowserPreference(BROWSER_KEYS.search), null)
  assert.equal(readBrowserList(BROWSER_KEYS.history), null)
  unreadable = false
  const before = stored.get(BROWSER_KEYS.history)
  unwritable = true
  assert.throws(() => writeBrowserPreference(BROWSER_KEYS.history, []), /保存失败/)
  assert.equal(stored.get(BROWSER_KEYS.history), before)
  unwritable = false
})

test('page preferences normalize old, partial, corrupt and untrusted payloads without changing existing keys', () => {
  stored.delete(BROWSER_KEYS.preferences)
  stored.set(BROWSER_KEYS.search, 'baidu')
  stored.set(BROWSER_KEYS.addressPosition, 'top')
  assert.deepEqual(loadBrowserPreferences(), DEFAULT_BROWSER_PREFERENCES)
  for (const value of [null, undefined, [], true, 'desktop']) {
    assert.deepEqual(normalizeBrowserPreferences(value), DEFAULT_BROWSER_PREFERENCES)
  }
  assert.deepEqual(normalizeBrowserPreferences({
    userAgentMode: 'unsupported', textZoom: NaN, javaScriptEnabled: 'false',
    loadsImagesAutomatically: 0, thirdPartyCookiesEnabled: 'true',
  }), DEFAULT_BROWSER_PREFERENCES)
  assert.equal(normalizeBrowserPreferences({textZoom: 0}).textZoom, 75)
  assert.equal(normalizeBrowserPreferences({textZoom: 450}).textZoom, 200)
  assert.equal(normalizeBrowserPreferences({textZoom: 114.7}).textZoom, 115)
  assert.equal(normalizeBrowserPreferences({textZoom: Infinity}).textZoom, 100)
  assert.equal(normalizeBrowserPreferences({userAgentMode: 'custom', customUserAgent: ''}).userAgentMode, 'system')
  stored.set(BROWSER_KEYS.preferences, '{broken')
  assert.deepEqual(loadBrowserPreferences(), DEFAULT_BROWSER_PREFERENCES)
  assert.equal(stored.get(BROWSER_KEYS.search), 'baidu')
  assert.equal(stored.get(BROWSER_KEYS.addressPosition), 'top')
})

test('privacy is an opt-in saved recording preference and never erases existing browser data', () => {
  assert.equal(DEFAULT_BROWSER_PREFERENCES.privateMode, false)
  assert.equal(normalizeBrowserPreferences({privateMode: 'true'}).privateMode, false)
  const history = JSON.stringify([{url: 'https://example.com/existing', title: '已保存的历史', time: 123}])
  stored.set(BROWSER_KEYS.history, history)
  const saved = saveBrowserPreferences({...DEFAULT_BROWSER_PREFERENCES, privateMode: true})
  assert.equal(loadBrowserPreferences().privateMode, true, 'reopening preserves the recording choice')
  assert.equal(stored.get(BROWSER_KEYS.history), history, 'enabling privacy does not erase prior history')
  const before = stored.get(BROWSER_KEYS.preferences)
  unwritable = true
  try {
    assert.throws(() => saveBrowserPreferences({...saved, privateMode: false}), /保存失败/)
    assert.equal(stored.get(BROWSER_KEYS.preferences), before, 'a failed write keeps the previous privacy choice')
  } finally { unwritable = false }
})

test('Android and iOS identities survive normalization and retain the last non-desktop choice', () => {
  for (const mode of ['android', 'ios', 'system'] as const) {
    const preferences = normalizeBrowserPreferences({userAgentMode: mode, lastNonDesktopUserAgentMode: 'ios'})
    assert.equal(preferences.userAgentMode, mode)
    assert.equal(preferences.lastNonDesktopUserAgentMode, mode, 'the active mobile identity is authoritative')
    saveBrowserPreferences(preferences)
    assert.equal(loadBrowserPreferences().userAgentMode, mode)
  }
  const oldDesktop = normalizeBrowserPreferences({userAgentMode: 'desktop'})
  assert.equal(oldDesktop.lastNonDesktopUserAgentMode, 'system', 'old v1 desktop preferences migrate safely')
  const desktop = normalizeBrowserPreferences({userAgentMode: 'desktop', lastNonDesktopUserAgentMode: 'ios'})
  assert.equal(desktop.lastNonDesktopUserAgentMode, 'ios')
  assert.equal(normalizeBrowserPreferences({userAgentMode: 'desktop', lastNonDesktopUserAgentMode: 'desktop'}).lastNonDesktopUserAgentMode, 'system')
  assert.equal(normalizeBrowserPreferences({userAgentMode: 'desktop', lastNonDesktopUserAgentMode: 'custom', customUserAgent: 'invalid\nheader'}).lastNonDesktopUserAgentMode, 'system')
})

test('desktop toggles restore the preceding identity after a storage round-trip', () => {
  for (const mode of ['system', 'android', 'ios', 'custom'] as const) {
    const original = normalizeBrowserPreferences({userAgentMode: mode, customUserAgent: 'Mozilla/5.0 Example/1.0', privateMode: true})
    const desktop = saveBrowserPreferences(toggleBrowserDesktopMode(original))
    assert.equal(desktop.userAgentMode, 'desktop')
    assert.equal(desktop.lastNonDesktopUserAgentMode, mode)
    const restored = toggleBrowserDesktopMode(loadBrowserPreferences())
    assert.equal(restored.userAgentMode, mode)
    assert.equal(restored.customUserAgent, original.customUserAgent)
    assert.equal(restored.privateMode, true, 'display changes keep the recording preference')
  }
})

test('custom user agents enforce the native header boundary before persistence', () => {
  assert.equal(validateBrowserUserAgent('Mozilla/5.0 (Linux; Android 14) Example/1.0'), null)
  assert.equal(validateBrowserUserAgent('A'.repeat(512)), null)
  for (const value of ['', '  ', 'A'.repeat(513), 'Mozilla/5.0\r\nX-Test: value', 'Mozilla/5.0\t', '手机浏览器']) {
    assert.equal(typeof validateBrowserUserAgent(value), 'string', JSON.stringify(value))
  }
  const normalized = normalizeBrowserPreferences({
    userAgentMode: 'custom', customUserAgent: '  Mozilla/5.0 Example/1.0  ', textZoom: 125,
  })
  assert.equal(normalized.customUserAgent, 'Mozilla/5.0 Example/1.0')
  assert.equal(normalized.userAgentMode, 'custom')
  saveBrowserPreferences(normalized)
  const before = stored.get(BROWSER_KEYS.preferences)
  assert.throws(() => saveBrowserPreferences({...normalized, customUserAgent: 'invalid\nheader'}), /浏览器标识/)
  assert.equal(stored.get(BROWSER_KEYS.preferences), before)
  assert.equal(normalizeBrowserPreferences({userAgentMode: 'custom', customUserAgent: 'invalid\nheader'}).userAgentMode, 'system')
})

test('page options round-trip atomically and leave the last saved configuration readable after a failure', () => {
  const saved = saveBrowserPreferences({
    ...DEFAULT_BROWSER_PREFERENCES,
    userAgentMode: 'desktop', textZoom: 150, javaScriptEnabled: false,
    loadsImagesAutomatically: false, thirdPartyCookiesEnabled: true,
    mediaPlaybackRequiresUserGesture: false, confirmExternalApps: false,
  })
  assert.deepEqual(loadBrowserPreferences(), saved, 'reopening reads all saved options')
  assert.equal(stored.get(BROWSER_KEYS.search), 'baidu', 'existing raw search preference is not migrated or overwritten')
  assert.equal(stored.get(BROWSER_KEYS.addressPosition), 'top', 'existing layout preference is not overwritten')
  const before = stored.get(BROWSER_KEYS.preferences)
  unwritable = true
  try {
    assert.throws(() => saveBrowserPreferences({...saved, textZoom: 100}), /保存失败/)
    assert.equal(stored.get(BROWSER_KEYS.preferences), before)
  } finally { unwritable = false }
  assert.deepEqual(loadBrowserPreferences(), saved)
  unreadable = true
  try { assert.deepEqual(loadBrowserPreferences(), DEFAULT_BROWSER_PREFERENCES) }
  finally { unreadable = false }
})
