import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorialCoverPlaceholder } from '../src/components/EditorialCoverPlaceholder'
import type { Article } from '../src/lib/types'

Object.assign(globalThis, { React })
const article: Article = {
  id:'cover-perf-a', title:'矢量封面和网页样式隔离', summary:'', sourceGroup:'cn',
  sourceId:'netease', sourceName:'网易', sourceLabel:'网易', originUrl:'https://example.com/a',
  publishedAt:Date.now(), hasRealDate:true,
}
const a=renderToStaticMarkup(<EditorialCoverPlaceholder article={article} />)
const b=renderToStaticMarkup(<EditorialCoverPlaceholder article={{...article,id:'cover-perf-b'}} />)
assert.match(a, /class="editorial-scene-svg/, 'procedural cover preserves vector composition')
assert.match(a, /--ec-bg-dark:url\(#ec-g-/, 'each SVG has its own dark gradient reference')
assert.match(a, /--ec-bg-light:url\(#ec-g-/, 'each SVG has its own light gradient reference')
assert.match(a, /--ec-dark-accent:/, 'per-cover theme palette remains available')
assert.match(a, /--ec-light-accent:/, 'per-cover light theme remains available')
assert.doesNotMatch(a+b, /<style/, 'mounting dozens of cards must never insert global CSS')
const css=readFileSync(new URL('../src/styles/editorial-magazine.css',import.meta.url),'utf8')
assert.match(css, /:root\[data-theme='light'\] \.editorial-scene-svg/, 'theme switch uses static shared CSS')
assert.match(css, /\[data-eink='1'\] \.editorial-scene-svg/, 'e-ink artwork still receives monochrome palette')
assert.match(css, /--ec-bg-grad: var\(--ec-bg-dark\)/, 'dark vector theme resolves cover-local gradient')
console.log('editorial-cover-performance: unique SVG palettes, static shared CSS and dark/light/eink artwork OK')
