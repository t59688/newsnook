import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url))
const html = readFileSync(indexPath, 'utf8')
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]

assert.ok(inlineScript, 'index.html must retain its synchronous compatibility bootstrap')
assert.doesNotMatch(
  inlineScript,
  /\?\./,
  'the synchronous HTML bootstrap must not contain optional chaining (Chrome 80+ syntax)',
)
assert.doesNotMatch(
  inlineScript,
  /\?\?/,
  'the synchronous HTML bootstrap must not contain nullish coalescing (Chrome 80+ syntax)',
)

const moduleScriptIndex = html.indexOf('<script type="module"')
const fromEntriesPolyfillIndex = inlineScript.indexOf('Object.fromEntries（Chrome 73+）')
assert.ok(moduleScriptIndex > 0, 'the application module script must exist')
assert.ok(fromEntriesPolyfillIndex >= 0, 'the Chrome 69 Object.fromEntries fallback must exist')
assert.ok(
  html.indexOf('Object.fromEntries（Chrome 73+）') < moduleScriptIndex,
  'the compatibility fallback must execute before the application module',
)

const documentElement = { dataset: {}, innerHTML: '' }
const sandbox = {
  console: { info() {} },
  performance: { now: () => 1 },
  window: {
    location: { hash: '' },
    matchMedia: () => ({ matches: false }),
  },
  navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/69.0.3497.100 Mobile Safari/537.36' },
  document: { documentElement, title: '' },
  localStorage: { getItem: () => null },
}
const context = vm.createContext(sandbox)

// Emulate the API surface that caused the startup crash on Android 9 / WebView 69.
vm.runInContext('Object.fromEntries = undefined', context)
vm.runInContext(inlineScript, context, { filename: 'index.html:inline-bootstrap' })

const expression = [
  '(function () {',
  "  var symbol = Symbol('entry')",
  '  var value = Object.fromEntries([',
  "    ['duplicate', 1],",
  "    ['duplicate', 2],",
  "    ['__proto__', { safe: true }],",
  '    [symbol, 3],',
  '  ])',
  '  return {',
  '    duplicate: value.duplicate,',
  "    hasOwnProto: Object.prototype.hasOwnProperty.call(value, '__proto__'),",
  '    protoValue: value.__proto__.safe,',
  '    symbolValue: value[symbol],',
  '    ordinaryPrototype: Object.getPrototypeOf(value) === Object.prototype,',
  "    mapValue: Object.fromEntries(new Map([['map-key', 9]]))['map-key'],",
  '    bootMode: document.documentElement.dataset.boot,',
  '    theme: document.documentElement.dataset.theme,',
  '    scheme: document.documentElement.dataset.scheme,',
  '  }',
  '}())',
].join('\n')
const result = vm.runInContext(expression, context)

assert.equal(result.duplicate, 2, 'later duplicate entries must replace earlier values')
assert.equal(result.hasOwnProto, true, '__proto__ must be defined as an own data property')
assert.equal(result.protoValue, true)
assert.equal(result.symbolValue, 3, 'symbol keys must be preserved')
assert.equal(result.ordinaryPrototype, true, 'the result must retain the ordinary object prototype')
assert.equal(result.mapValue, 9, 'the fallback must accept general iterables')
assert.equal(result.bootMode, 'splash', 'the synchronous boot marker must still be set')
assert.equal(result.theme, 'light', 'the existing theme resolution must remain unchanged')
assert.equal(result.scheme, 'ink', 'the existing scheme fallback must remain unchanged')

assert.throws(
  () => vm.runInContext('Object.fromEntries(null)', context),
  /requires an iterable/,
)
assert.throws(
  () => vm.runInContext('Object.fromEntries([1])', context),
  /not an entry object/,
)

console.log('legacy-webview bootstrap compatibility: ok')
