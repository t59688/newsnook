import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { CatalogService } from '../src/features/rssCatalog/service'
import { RssCatalogBrowser } from '../src/features/rssCatalog/RssCatalogBrowser'
import { catalogEntryFor } from '../src/features/rssCatalog/entry'
const resolved = catalogEntryFor({ id: 'bili', title: '影视飓风', url: 'https://rsshub-balancer.virworks.moe/bilibili/user/video/946974', category: '视频', language: 'zh', region: '未标注', aliases: [], tags: [], nsfw: false })
assert.equal(resolved.type, 'rsshub')
assert.equal(resolved.routePath, '/bilibili/user/video/946974')
assert.equal(resolved.instanceId, 'virworks')
assert.equal(resolved.siteUrl, 'https://space.bilibili.com/946974')
const importedMirror = catalogEntryFor({ id: 'mirror', title: '远端来源', url: 'https://rss.materium.io/telegram/channel/News', category: '社区', language: 'zh', region: '未标注', aliases: [], tags: [], nsfw: false })
assert.equal(importedMirror.type, 'rsshub')
assert.equal(importedMirror.instanceId, 'materium')
assert.equal(importedMirror.routePath, '/telegram/channel/News')
const officialDemo = catalogEntryFor({ id: 'official', title: '演示实例', url: 'https://rsshub.app/bilibili/user/video/1234', category: '视频', language: 'zh', region: '未标注', aliases: [], tags: [], nsfw: false })
assert.equal(officialDemo.type, 'rsshub')
assert.equal(officialDemo.instanceId, undefined, 'disabled demo instance cannot prevent automatic fallback to enabled public instances')

assert.equal(catalogEntryFor({ id: 'rss', title: '普通 RSS', url: 'https://example.org/feed', category: '新闻', language: 'zh', region: '未标注', aliases: [], tags: [], nsfw: false }).type, 'direct')
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const feeds = [...Array.from({ length: 65 }, (_, i) => ({ id: String(i), title: '研究 ' + i, url: `https://example.org/${i}`, category: i < 40 ? '人工智能' : '农业', language: i < 40 ? 'zh' : 'en', region: 'Global', aliases: ['科研'], tags: [], nsfw: false })), { id: 'adult-1', title: 'Couture Boudoir', url: 'https://example.org/boudoir', category: '摄影', language: 'en', region: 'Global', aliases: ['写真'], tags: [], nsfw: true }]
let calls = 0
const service = new CatalogService({ seed: async () => ({ schemaVersion: 1, generatedAt: '2026-11-03T00:00:00Z', feeds }), storage: { read: async () => null, write: async () => {} }, fetch: async () => { calls++; throw new Error('offline') } })
const root = createRoot(document.getElementById('root')!)
let selected = ''
const button = (label: string) => { const found = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label || node.firstElementChild?.textContent === label); assert.ok(found, label); return found as HTMLButtonElement }
try {
  await act(async () => root.render(<RssCatalogBrowser service={service} onSelect={(entry) => { selected = entry.entryId }} duplicateLabel={() => undefined} />))
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 30)
  assert.equal(document.querySelector('[role="switch"]'), null, 'catalog has no NSFW visibility toggle')
  assert.ok(document.body.textContent?.includes('66'), 'all feeds are counted without a visibility setting')
  assert.ok([...document.querySelectorAll('button')].some((item) => item.firstElementChild?.textContent === '摄影'), 'all categories are directly discoverable')
  assert.ok(document.body.textContent?.includes('已保留本地目录'))
  await act(async () => button('加载更多').click())
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 60)
  await act(async () => button('农业').click())
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 25)
  assert.equal(document.querySelector('select'), null, 'catalog must not invoke the Android native select dialog')
  await act(async () => (document.querySelector('button[aria-label="目录语言"]') as HTMLButtonElement).click())
  assert.ok(document.querySelector('[role="dialog"]'), 'language options use the existing themed application dialog')
  assert.ok([...document.querySelectorAll('[role="option"]')].some((node) => node.textContent === '英文'), 'common language labels remain Chinese even on WebViews with incomplete Intl locale data')
  const chinese = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.includes('中文')) as HTMLButtonElement
  assert.ok(chinese)
  await act(async () => chinese.click())
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 0)
  await act(async () => button('重置筛选').click())
  await act(async () => (document.querySelector('[data-catalog-feed]') as HTMLButtonElement).click())
  assert.ok(selected)
  await act(async () => button('摄影').click())
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 1)
  assert.ok(document.body.textContent?.includes('Couture Boudoir'))
  assert.ok(document.querySelector('[data-catalog-feed]')?.textContent?.includes('NSFW'), 'sensitive source has a small per-item label')
  await act(async () => (document.querySelector('[data-catalog-feed]') as HTMLButtonElement).click())
  assert.equal(selected, 'adult-1', 'all feeds reuse the normal preview/subscribe flow')
  assert.equal(calls, 1, 'filters and selection perform no remote searches')
} finally { await act(async () => root.unmount()) }
console.log('rss catalog browser: ok')
