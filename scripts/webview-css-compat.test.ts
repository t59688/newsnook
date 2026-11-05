import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TW_VAR_FALLBACK_CSS,
  applyWebViewCssCompat,
  legacyMotionFallbackCss,
  unwrapWhereSelectors,
} from './webview-css-compat.ts'

// Settings toolbar is nested inside the section content wrapper. Keep its
// vertical spacing rule as a descendant selector, not a direct-child selector.
const settingsPaperCss = readFileSync(new URL('../src/styles/settings-paper.css', import.meta.url), 'utf8')
assert.match(settingsPaperCss, /\.paper-settings-section-content\s+\.custom-sources-filter-toolbar\s*\{[^}]*min-height:\s*57px;[^}]*align-items:\s*center;/s)

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

// The Chrome 69 pipeline strips @property, leaving Tailwind's translate axes
// uninitialized in modern WebView and its independent transform properties
// unsupported on older WebView builds.
assert.ok(TW_VAR_FALLBACK_CSS.includes('--tw-translate-x:0px'))
assert.ok(TW_VAR_FALLBACK_CSS.includes('--tw-translate-y:0px'))
assert.ok(TW_VAR_FALLBACK_CSS.includes('--tw-legacy-scale-x:1'))
assert.ok(TW_VAR_FALLBACK_CSS.includes('--tw-legacy-rotate:0deg'))

const tailwindMotion = [
  String.raw`.translate-x-\[16px\]{--tw-translate-x:16px;translate:var(--tw-translate-x) var(--tw-translate-y)}`,
  String.raw`.-translate-x-1\/2{--tw-translate-x:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}`,
  String.raw`.-translate-y-1\/2{--tw-translate-y:-50%;translate:var(--tw-translate-x) var(--tw-translate-y)}`,
  '.scale-90{--tw-scale-x:90%;--tw-scale-y:90%;scale:var(--tw-scale-x) var(--tw-scale-y)}',
  String.raw`.active\:scale-\[0\.94\]:active{scale:.94;}`,
  '.rotate-180{rotate:180deg;}',
  '.-rotate-90{rotate:-90deg;}',
  '.unrelated{color:red}',
].join('\n')
const motionFallback = legacyMotionFallbackCss(tailwindMotion)
assert.ok(motionFallback.startsWith('@supports not (translate: 0px 0px)'))
assert.ok(motionFallback.includes('transform:translate(var(--tw-translate-x,0px),var(--tw-translate-y,0px))'))
assert.ok(motionFallback.includes('rotate(var(--tw-legacy-rotate,0deg)) scale(var(--tw-legacy-scale-x,1),var(--tw-legacy-scale-y,1))'))
assert.ok(motionFallback.includes(String.raw`.translate-x-\[16px\]`))
assert.ok(motionFallback.includes(String.raw`.-translate-x-1\/2`))
assert.ok(motionFallback.includes(String.raw`.-translate-y-1\/2`))
assert.match(motionFallback, /\.scale-90\{--tw-legacy-scale-x:0\.9;--tw-legacy-scale-y:0\.9;/)
assert.match(motionFallback, /--tw-legacy-scale-x:\.94;--tw-legacy-scale-y:\.94;/)
assert.match(motionFallback, /\.rotate-180\{--tw-legacy-rotate:180deg;/)
assert.match(motionFallback, /\.-rotate-90\{--tw-legacy-rotate:-90deg;/)
assert.ok(!motionFallback.includes('.unrelated'))
assert.ok(applyWebViewCssCompat(tailwindMotion).includes(motionFallback))
assert.equal(legacyMotionFallbackCss('.something{color:blue}'), '')

// The compatibility pass runs after Vite's normal CSS minifier. Its final
// output must stay compact without losing the legacy fallbacks just added.
const expandedCss = Array.from({ length: 40 }, (_, index) => `
            .startup-rule-${index} {
                padding-top: 10px;
                padding-right: 10px;
                padding-bottom: 10px;
                padding-left: 10px;
                color: rgb(255, 0, 0);
            }
`).join('\n') + tailwindMotion + '\nhtml[data-no-flex-gap="1"] .gap-2 > * + * { margin-left: 8px; }'
const compact = applyWebViewCssCompat(expandedCss, { minify: true })
assert.ok(compact.length < applyWebViewCssCompat(expandedCss).length * 0.6,
  'The final compatibility pass must not expand a minified production stylesheet')
assert.ok(!compact.includes(':where('), 'Minification must retain the WebView 69 selector fix')
assert.ok(!compact.includes('@property'), 'Minification must not restore unsupported property registration')
assert.match(compact, /--tw-border-style:solid/)
assert.match(compact, /--tw-translate-x:0px/)
assert.match(compact, /--tw-legacy-scale-x:0?\.9(?:;|})/)
assert.match(compact, /data-no-flex-gap[^}]+margin-left:8px/)
assert.match(compact, /transform:translate\(/)
const dynamicColor = applyWebViewCssCompat(
  '.wiki-selection-popover{background:color-mix(in srgb,var(--wiki-bg) 92%,transparent)}',
  { minify: true },
)
assert.match(dynamicColor, /var\(--wiki-bg\)/,
  'A complete nested runtime color must survive final CSS parsing and minification')

console.log('webview-css-compat: selectors, fallback variables, motion, dynamic colors, and final minification passed')
