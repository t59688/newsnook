import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// The registry is also loaded by edge/Node forwarding code. It must stay DOM-free.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'linkedom') throw new Error('Source registry unexpectedly loads the client DOM parser')
    return nextResolve(specifier, context)
  },
})
try {
  const { findSource, offsetPageRequest, pagingStrategyOf, SOURCES } = await import('../src/sources/registry')
  assert.ok(findSource(SOURCES[0].id))
  const source = { ...SOURCES[0], kind: 'web-catalog' as const, url: 'https://example.test/list/' }
  assert.equal(offsetPageRequest(source, 0).url, source.url)
  assert.equal(pagingStrategyOf(source), 'upstream-offset')
  console.log('site catalog shared registry DOM boundary: ok')
} finally {
  hook.deregister()
}
