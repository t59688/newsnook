import assert from 'node:assert/strict'
import { browserSearchDestination, browserSearchProviders, BROWSER_SEARCH_PROVIDERS } from '../src/features/browser/browserSearchCatalog'
const categories = ['常用', '搜索', 'AI', '学术'] as const
for (const category of categories) {
  const providers = browserSearchProviders(category)
  assert.ok(providers.length > 0, `${category} missing providers`)
  for (const provider of providers) {
    assert.equal(new URL(provider.home).protocol, 'https:')
    assert.equal(new URL(browserSearchDestination(provider, '汉字 test')).protocol, 'https:')
    assert.match(browserSearchDestination(provider, '汉字 test'), /%E6%B1%89%E5%AD%97%20test/)
    assert.equal(browserSearchDestination(provider, ''), provider.home)
  }
}
assert.equal(BROWSER_SEARCH_PROVIDERS.length, new Set(BROWSER_SEARCH_PROVIDERS.map(provider=>provider.id)).size)
assert.deepEqual(browserSearchProviders('常用').map(provider=>provider.id), ['bing','google','baidu','duckduckgo'])
console.info('Browser search providers, category filters and URL encoding: OK')
