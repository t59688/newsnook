import assert from 'node:assert/strict'

import {
  TW_VAR_FALLBACK_CSS,
  applyWebViewCssCompat,
  unwrapWhereSelectors,
} from './webview-css-compat.ts'

// Nested :not() must stay intact
const nested = ':where(.divide-y > :not(:last-child)){border-bottom-width:1px}'
assert.equal(
  unwrapWhereSelectors(nested),
  '.divide-y > :not(:last-child){border-bottom-width:1px}',
)

assert.equal(
  unwrapWhereSelectors(':where(.divide-haze > :not(:last-child)){border-color:red}'),
  '.divide-haze > :not(:last-child){border-color:red}',
)

// Multiple :where in one stylesheet
const multi = ':where(.a){x:1}:where(.b > :not(:first-child)){y:2}'
assert.equal(unwrapWhereSelectors(multi), '.a{x:1}.b > :not(:first-child){y:2}')

// Non-:where content unchanged
assert.equal(unwrapWhereSelectors('.plain{color:red}'), '.plain{color:red}')

const applied = applyWebViewCssCompat(
  ':where(.divide-y > :not(:last-child)){border-bottom-style:var(--tw-border-style)}',
)
assert.ok(applied.includes('.divide-y > :not(:last-child){'))
assert.ok(!applied.includes(':where('))
assert.ok(applied.includes(TW_VAR_FALLBACK_CSS))
assert.ok(applied.includes('--tw-border-style:solid'))
assert.ok(applied.includes('--tw-gradient-from-position:0%'))

console.log('webview-css-compat: ok')
