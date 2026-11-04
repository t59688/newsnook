import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const settingsPaperCss = readFileSync(new URL('../src/styles/settings-paper.css', import.meta.url), 'utf8')
const themesExtendedCss = readFileSync(new URL('../src/styles/themes-extended.css', import.meta.url), 'utf8')
const buerCss = readFileSync(new URL('../src/styles/buer.css', import.meta.url), 'utf8')

// 1. settings-paper.css must reset plain section content and align heading
assert.match(
  settingsPaperCss,
  /\.paper-settings-section--plain\s+\.paper-settings-section-heading\s*\{[^}]*padding-left:\s*0;[^}]*padding-right:\s*0;/s,
  'plain heading must remove left/right padding to align with plain content',
)
assert.match(
  settingsPaperCss,
  /\.paper-settings-section--plain\s+\.paper-settings-section-content\s*\{[^}]*border:\s*0\s*!important;[^}]*box-shadow:\s*none\s*!important;/s,
  'plain content must strictly reset border and box-shadow with !important',
)

// 2. themes-extended.css and buer.css must NOT target plain section content with border/box-shadow
// Check that whenever .paper-settings-section-content is used in themes, it is guarded with :not(.paper-settings-section--plain)
const contentMatches = [...themesExtendedCss.matchAll(/([^\n,{}]+)\.paper-settings-section-content/g), ...buerCss.matchAll(/([^\n,{}]+)\.paper-settings-section-content/g)]
for (const match of contentMatches) {
  const selectorPrefix = match[1]
  assert.ok(
    selectorPrefix.includes(':not(.paper-settings-section--plain)'),
    `selector targeting .paper-settings-section-content must guard with :not(.paper-settings-section--plain): ${match[0]}`,
  )
}

// 3. All scheme rules in themes-extended.css targeting section content must exclude plain sections
const schemes = ['ink', 'pearl', 'amber', 'celadon', 'dusk']
for (const scheme of schemes) {
  assert.ok(
    themesExtendedCss.includes(`html[data-scheme='${scheme}'] .paper-settings-section:not(.paper-settings-section--plain) .paper-settings-section-content`),
    `themes-extended.css should scope ${scheme} section content to non-plain sections`,
  )
}
assert.ok(
  buerCss.includes(`html[data-scheme='buer'] .paper-settings-section:not(.paper-settings-section--plain) .paper-settings-section-content`),
  'buer.css should scope buer section content to non-plain sections',
)

console.log('settings-section-plain: all assertions passed successfully!')
