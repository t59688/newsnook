import assert from 'node:assert/strict'
import {
  compactRecentSites,
  saveBrowserVisit,
  removeSiteHistory,
  normalizeBrowserHost,
  addBrowserShortcut,
  moveBrowserShortcut,
  shortcutFaviconUrl,
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
console.log('Browser home/history/shortcut behavior: OK')
