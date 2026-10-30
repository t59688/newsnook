import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'

const java = readFileSync('android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java', 'utf8')
const script = java.split('PROBE_SCRIPT_TEMPLATE = """')[1].split('""";')[0]
  .replace(/\\\\/g, '\\').replace('__NEWSNOOK_SESSION_NONCE__', 'fixture-nonce')
  .replace('__NEWSNOOK_MAX_BODY_TEXT__', '262144').replace('__NEWSNOOK_PASSIVE_MODE__', 'true')
const { document, window: dom } = parseHTML('<html><head><title>页面标题</title><meta property="og:title" content="页面介绍"></head><body><video src="https://cdn.example/plain.mp4"></video><script type="application/ld+json">{"@type":"VideoObject","name":"结构化名称","contentUrl":"https://cdn.example/structured.mp4"}</script></body></html>')
const messages: unknown[] = []
const handlers = new Map<string, (event: unknown) => void>()
const window: any = { addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn), postMessage: (value: unknown) => messages.push(value),
  player_aaaa: { title: '正片名称', sources: [{ url: 'https://cdn.example/main.m3u8?token=keep' }] } }
window.top = window
const location = { href: 'https://watch.example/film', origin: 'https://watch.example' }
runInNewContext(script, { window, document, location, URL, Element: dom.Element, HTMLMediaElement: class {}, navigator: {},
  performance: { getEntriesByType: () => [] }, MutationObserver: class { observe() {} } })
const events = window.__newsnookCollectMedia()
assert.equal(events.find((e: any) => e.url?.includes('main.m3u8'))?.title, '正片名称', 'probe carries player-scoped titles')
assert.equal(events.find((e: any) => e.url?.includes('structured.mp4'))?.titleSource, 'structured')
assert.equal(events.find((e: any) => e.url?.includes('plain.mp4'))?.title, undefined)
assert.equal(events.find((e: any) => e.url?.includes('plain.mp4'))?.pageTitle, '页面介绍')
handlers.get('message')?.({ data: { nonce: 'wrong', __newsnookMediaObservation: { url: 'https://bad.example/fake.mp4' } } })
assert.ok(!window.__newsnookCollectMedia().some((e: any) => e.url?.includes('bad.example')))
window.player_aaaa.sources[0].title = '更新名称'
assert.equal(window.__newsnookCollectMedia().find((e: any) => e.url?.includes('main.m3u8'))?.title, '更新名称', 'late player metadata is not discarded by dedupe')
console.log('Android media probe metadata association and nonce behavior: OK')
