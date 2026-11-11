import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NewsSource } from '../src/sources/registry'

const sources: NewsSource[] = [
  { id: 'openai-news', name: 'OpenAI News', label: 'OpenAI', group: 'ai', kind: 'feed', url: 'https://openai.com/news/rss.xml', enabled: true },
]

// Local tsx test runner keeps classic JSX transform; Vite production uses JSX automatic.
Object.assign(globalThis, { React })

test('source watch uses the existing opaque fullscreen SettingsShell, not the MeScreen flow', async () => {
  const { SourceWatchScreen } = await import('../src/screens/settings/SourceWatchScreen')
  const markup = renderToStaticMarkup(React.createElement(SourceWatchScreen, {
    sources, onBack: () => {}, onOpenArticle: () => {},
  }))
  assert.match(markup, /paper-settings-shell absolute inset-0 z-30/)
  assert.match(markup, /role="tablist"/)
  assert.match(markup, /跨预设收集你关心的更新/)
  assert.match(markup, /选择关注信源/)
  assert.doesNotMatch(markup, /paper-settings-root flex min-h-0/)
})

test('only supported directly fetched XML sources are presented as background ready', async () => {
  const { supportsNativeSourceWatch } = await import('../src/features/sourceWatch/eligibility')
  const base = sources[0]
  assert.equal(supportsNativeSourceWatch(base), true)
  assert.equal(supportsNativeSourceWatch({ ...base, kind: 'anthropic' }), false)
  assert.equal(supportsNativeSourceWatch({ ...base, paused: true }), false)
  assert.equal(supportsNativeSourceWatch({ ...base, url: 'http://example.org/rss.xml' }), false)
  assert.equal(supportsNativeSourceWatch({ ...base, discovery: { providerId: 'rsshub', entryId: 'x', generator: 'rsshub' } }), false)
})
