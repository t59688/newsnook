import assert from 'node:assert/strict'
import React from 'react'
;(globalThis as unknown as { React: typeof React }).React = React

import { getBrowserBrandIcon } from '../src/features/browser/browserBrandIcons'

const engines = [
  'https://www.bing.com/',
  'https://www.google.com/',
  'https://www.baidu.com/',
  'https://duckduckgo.com/',
  'https://www.sogou.com/',
  'https://www.so.com/',
  'https://www.perplexity.ai/',
  'https://www.phind.com/',
  'https://scholar.google.com/',
  'https://xueshu.baidu.com/',
  'https://zh.wikipedia.org/',
]

for (const url of engines) {
  const icon = getBrowserBrandIcon(url)
  assert.ok(icon, `Expected brand icon for engine URL: ${url}`)
}

import { DEFAULT_BROWSER_SHORTCUTS } from '../src/features/browser/browserHistory'

for (const item of DEFAULT_BROWSER_SHORTCUTS) {
  const icon = getBrowserBrandIcon(item.url, item.name)
  assert.ok(icon, `Expected brand icon for default shortcut: ${item.name} (${item.url})`)
}

// Fallback for custom / unknown URL
assert.equal(getBrowserBrandIcon('https://random-site-12345.org/'), null, 'Unknown site returns null to allow remote favicon fallback')

// Fallback matched by label
assert.ok(getBrowserBrandIcon('https://random-site.org/', '百度学术'), 'Matches by label when host is custom or proxied')

console.log('Browser brand local vector icons: OK')
