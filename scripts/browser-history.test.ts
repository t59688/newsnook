import assert from 'node:assert/strict'
import {
  compactRecentSites,
  saveBrowserVisit,
  removeSiteHistory,
  normalizeBrowserHost,
  addBrowserShortcut,
  moveBrowserShortcut,
  shortcutFaviconUrl,
  normalizeBrowserVisits,
  normalizeBrowserShortcuts,
  normalizeHiddenBrowserHosts,
  DEFAULT_BROWSER_SHORTCUTS,
} from '../src/features/browser/browserHistory'

const visits = [
  { url: 'https://91rb.net/a', title: 'article a', time: 30 },
  { url: 'https://91rb.net/b', title: 'article b', time: 20 },
  { url: 'https://linux.do/t/1', title: 'topic', time: 10 },
  { url: 'https://91rb.net/c', title: 'article c', time: 5 },
]
assert.deepEqual(compactRecentSites(visits, [], 5).map(x => x.url), ['https://91rb.net/a', 'https://linux.do/t/1'], 'home shows only the latest URL from each host')
assert.deepEqual(compactRecentSites(visits, ['91rb.net'], 5).map(x => x.url), ['https://linux.do/t/1'], 'hidden hosts disappear from home but remain in history')
assert.equal(saveBrowserVisit(visits, 'https://91rb.net/a', 'revisited', 40).filter(x=>x.url==='https://91rb.net/a').length, 1, 'the same URL is not duplicated')
assert.equal(saveBrowserVisit(visits, 'about:blank', 'home', 41).length, visits.length, 'browser internal URLs are never recorded')
assert.equal(removeSiteHistory(visits, '91rb.net').length, 1, 'delete site history leaves unrelated entries')
assert.equal(normalizeBrowserHost('https://WWW.LINUX.DO:443/t/1'), 'linux.do', 'hostname comparison is canonical')
assert.equal(normalizeBrowserHost('javascript:alert(1)'), '', 'not a navigable web URL')
const shortcuts = [ { name: 'Linux.do', url: 'https://linux.do/' }, { name: '知乎', url:'https://zhihu.com/' } ]
assert.equal(addBrowserShortcut(shortcuts, { name: 'duplicate', url: 'https://linux.do/test' }).length, 2, 'same hostname cannot be added twice')
assert.equal(addBrowserShortcut(shortcuts, { name: 'new', url: 'https://example.com/' }).length, 3)
assert.deepEqual(moveBrowserShortcut(shortcuts, 1, -1).map(x=>x.name), ['知乎','Linux.do'])
assert.equal(shortcutFaviconUrl('https://linux.do/t/1'), 'https://linux.do/favicon.ico', 'favicons use direct site origins, no cross-site tracking service')
assert.equal(removeSiteHistory(visits, 'WWW.91RB.NET').length, 1, 'site deletion uses the same www/case normalization as home grouping')
assert.equal(saveBrowserVisit(visits, 'https://name:password@example.com/', 'credentials').length, visits.length, 'non-navigable credential URLs are not persisted')
assert.deepEqual(normalizeBrowserVisits({ url: 'https://example.com/' }), [], 'non-array history is ignored')
assert.deepEqual(normalizeBrowserVisits([
  null, { url: 'javascript:alert(1)', title: 'bad', time: 60 },
  { url: 'https://example.com/', title: 'older', time: 10 },
  { url: 'https://EXAMPLE.com', time: 20 },
  { url: 'https://invalid.example/', time: Number.NaN },
]), [{ url: 'https://example.com/', title: 'example.com', time: 20 }], 'history validates fields, repairs labels and keeps the latest canonical URL')
assert.deepEqual(normalizeHiddenBrowserHosts({}), [])
assert.deepEqual(normalizeHiddenBrowserHosts([' WWW.Example.COM ', null, 'example.com', 'linux.do', 'bad host']), ['example.com', 'linux.do'])
assert.deepEqual(normalizeBrowserShortcuts({}), DEFAULT_BROWSER_SHORTCUTS, 'invalid shortcut container falls back to the default start page')
assert.equal(DEFAULT_BROWSER_SHORTCUTS.length, 6, 'start page reserves 6 default shortcuts leaving 2 customizable slots')
assert.deepEqual(DEFAULT_BROWSER_SHORTCUTS.map(x => x.name), ['GitHub 仓库', '微信公众号', 'Linux.do', '维基百科', 'ChatGPT', 'Google'])
assert.deepEqual(
  normalizeBrowserShortcuts([
    { name: 'Linux.do', url: 'https://linux.do/' },
    { name: '知乎', url: 'https://www.zhihu.com/' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Bing', url: 'https://www.bing.com/' },
  ]),
  DEFAULT_BROWSER_SHORTCUTS,
  'legacy 4 default shortcuts smoothly upgrade to the new 6 curated items',
)
assert.deepEqual(
  normalizeBrowserShortcuts([
    { name: '我的博客', url: 'https://blog.example.com/' },
    { name: 'Linux.do', url: 'https://linux.do/' },
  ]),
  [
    { name: '我的博客', url: 'https://blog.example.com/' },
    { name: 'Linux.do', url: 'https://linux.do/' },
  ],
  'custom shortcuts are strictly preserved without unwanted upgrades',
)
assert.deepEqual(normalizeBrowserShortcuts([]), [], 'an intentionally empty shortcut list stays empty')
assert.deepEqual(normalizeBrowserShortcuts([
  null, { name: 1, url: 'https://invalid.example/' },
  { name: ' Example ', url: 'https://EXAMPLE.com' },
  { name: 'Duplicate', url: 'https://www.example.com/page' },
  { name: 'Private', url: 'https://user:secret@example.net/' },
]), [{ name: 'Example', url: 'https://example.com/' }])
console.log('Browser home/history/shortcut behavior and stored-data recovery: OK')
