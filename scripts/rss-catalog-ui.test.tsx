import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { CatalogService } from '../src/features/rssCatalog/service'
import { RssCatalogBrowser } from '../src/features/rssCatalog/RssCatalogBrowser'
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const settings = new Map<string, string>()
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: (key: string) => settings.get(key) ?? null, setItem: (key: string, value: string) => settings.set(key, value) } })
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
  assert.equal((document.querySelector('[role="switch"]') as HTMLButtonElement)?.getAttribute('aria-checked'), 'false')
  assert.ok(document.body.textContent?.includes('65'), 'only normal feeds are counted by default')
  assert.equal([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '摄影'), false, 'NSFW-only categories are hidden by default')
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
  const visibility = document.querySelector('[role="switch"]') as HTMLButtonElement
  await act(async () => visibility.click())
  assert.equal(visibility.getAttribute('aria-checked'), 'true')
  assert.equal(settings.get('newsnook:rss-catalog:show-nsfw'), 'true', 'opt-in persists locally')
  assert.ok(document.body.textContent?.includes('66'), 'all entries are counted once opt-in is enabled')
  await act(async () => button('摄影').click())
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 1)
  assert.ok(document.body.textContent?.includes('Couture Boudoir'))
  assert.ok(document.querySelector('[data-catalog-feed]')?.textContent?.includes('NSFW'))
  await act(async () => (document.querySelector('[data-catalog-feed]') as HTMLButtonElement).click())
  assert.equal(selected, 'adult-1', 'NSFW feeds reuse the normal preview/subscribe flow')
  await act(async () => visibility.click())
  assert.equal(visibility.getAttribute('aria-checked'), 'false')
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 0)
  assert.equal([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === '摄影'), false)
  assert.equal(settings.get('newsnook:rss-catalog:show-nsfw'), 'false')
  await act(async () => visibility.click())
  await act(async () => root.render(<RssCatalogBrowser key="reopened" service={service} onSelect={(entry) => { selected = entry.entryId }} duplicateLabel={() => undefined} />))
  assert.equal(document.querySelector('[role="switch"]')?.getAttribute('aria-checked'), 'true', 'opt-in survives component unmount and remount')
  assert.equal(calls, 1, 'filters and selection perform no remote searches')
} finally { await act(async () => root.unmount()) }
console.log('rss catalog browser: ok')
