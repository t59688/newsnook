import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'

// Node's TSX loader uses the classic JSX runtime for components imported in tests.
;(globalThis as typeof globalThis & { React: typeof React }).React = React
const { AppShell } = await import('../src/components/AppShell')

function statusBarStyle(surface?: 'page' | 'toolbar'): string {
  const { document } = parseHTML(renderToStaticMarkup(
    <AppShell statusBarSurface={surface}><main>content</main></AppShell>,
  ))
  const strip = document.querySelector('[aria-hidden="true"]')
  assert.ok(strip, 'AppShell must render its Android status-bar safe-area strip')
  assert.ok(strip.className.includes('is-video-fullscreen'), 'video fullscreen must still hide the strip')
  return strip.getAttribute('style') ?? ''
}

// The base surface is unchanged for settings, site workspaces and e-ink reader.
assert.match(statusBarStyle(), /background-color:var\(--tone-ink\)/)
assert.match(statusBarStyle('page'), /background-color:var\(--tone-ink\)/)

// Feed and normal article pages share the exact semantic background of their toolbars.
assert.match(statusBarStyle('toolbar'), /background-color:var\(--ui-surface\)/)

const editorialCss = readFileSync('src/styles/editorial-system.css', 'utf8')
assert.match(editorialCss, /html \.editorial-feed-header\s*\{[^}]*background:\s*var\(--ui-surface\)\s*!important;/)
assert.match(editorialCss, /html:not\(\[data-eink='1'\]\) \.editorial-reader-toolbar\s*\{[^}]*background:\s*var\(--ui-surface\)\s*!important;/)

console.log('status-bar surface matches feed/reader toolbars: ok')
