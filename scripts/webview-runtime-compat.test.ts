import { readAppStyles } from './helpers/readAppStyles'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const inlineVideoPages = readFileSync(new URL('../src/components/InlineVideoPages.tsx', import.meta.url), 'utf8')
const inkVideoPlayer = readFileSync(new URL('../src/components/InkVideoPlayer.tsx', import.meta.url), 'utf8')
const originPlayerSurface = readFileSync(new URL('../src/components/OriginPlayerSurface.tsx', import.meta.url), 'utf8')
const indexCss = readAppStyles()
const mediaSnifferCore = readFileSync(new URL('../src/features/mediaSniffer/core.ts', import.meta.url), 'utf8')
const mediaSnifferNative = readFileSync(new URL('../src/features/mediaSniffer/native.ts', import.meta.url), 'utf8')

// Product contract: the app intentionally admits Chrome / Android WebView 69.
assert.match(viteConfig, /target:\s*\['chrome69',\s*'es2020'\]/)
assert.match(indexHtml, /ver < 69/)

// Vite/Oxc transpile syntax only. Runtime Web/JS APIs introduced after Chrome 69
// must either be polyfilled here or avoided on the critical playback path.
assert.match(indexHtml, /Element\.prototype\.replaceChildren\s*=\s*replaceChildrenCompat/)
assert.match(indexHtml, /DocumentFragment\.prototype\.replaceChildren\s*=\s*replaceChildrenCompat/)
assert.match(indexHtml, /String\.prototype\.matchAll\s*=\s*function/)
assert.match(indexHtml, /typeof globalThis === 'undefined'/)
assert.match(indexHtml, /!crypto\.randomUUID/)

// The Zhihu inline-video mount itself deliberately uses the Chrome-69 baseline
// primitives. This is the exact regression that left the static video card visible.
assert.match(inlineVideoPages, /removeChild\(shell\.firstChild\)/)
assert.match(inlineVideoPages, /appendChild\(host\)/)
assert.doesNotMatch(inlineVideoPages, /shell\.replaceChildren\(/)

// CSS aspect-ratio only arrived after the Chrome 69 baseline. Every player
// surface on the Zhihu direct/fallback path must use the padding-ratio fallback.
assert.match(indexCss, /\.reader-video-aspect::before[\s\S]*padding-top:\s*56\.25%/)
assert.match(indexCss, /@supports \(aspect-ratio:\s*16 \/ 9\)/)
assert.match(inlineVideoPages, /reader-video-aspect/)
assert.match(inkVideoPlayer, /reader-video-aspect/)
assert.match(originPlayerSurface, /reader-video-aspect/)

// The generic fallback still uses matchAll/globalThis by design. Keep these
// assertions so removing the startup polyfills cannot silently break the fallback.
assert.match(mediaSnifferCore, /\.matchAll\(/)
assert.match(mediaSnifferNative, /globalThis\.crypto/)

console.log('webview-runtime-compat: ok')
