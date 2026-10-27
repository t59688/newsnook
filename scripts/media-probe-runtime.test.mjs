import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { parseHTML } from 'linkedom'
import ts from 'typescript'

const java = readFileSync(
  new URL('../android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java', import.meta.url),
  'utf8',
)

function decodeJavaTextBlock(source) {
  const match = source.match(/PROBE_SCRIPT_TEMPLATE\s*=\s*"""\r?\n([\s\S]*?)\r?\n\s*""";/)
  assert.ok(match, 'media probe Java text block must exist')
  const lines = match[1].split(/\r?\n/)
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length))
  const text = lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n')
  let decoded = ''
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\') {
      decoded += text[index]
      continue
    }
    const next = text[index + 1]
    if (next === '\\' || next === '"' || next === "'") decoded += next
    else if (next === 'n') decoded += '\n'
    else if (next === 'r') decoded += '\r'
    else if (next === 't') decoded += '\t'
    else if (next === 'b') decoded += '\b'
    else if (next === 'f') decoded += '\f'
    else throw new Error(`unsupported Java escape in probe: \\${next}`)
    index += 1
  }
  return decoded
}

function probeScript(passive) {
  return decodeJavaTextBlock(java)
    .replaceAll('__NEWSNOOK_SESSION_NONCE__', 'runtime-test-nonce')
    .replaceAll('__NEWSNOOK_MAX_BODY_TEXT__', '262144')
    .replaceAll('__NEWSNOOK_PASSIVE_MODE__', passive ? 'true' : 'false')
}

function makeRuntime(html, { passive = false, fetchBody } = {}) {
  const { window } = parseHTML(html)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: 'https://video.example/vodplay/1-1-1.html' },
  })
  Object.defineProperty(window, 'top', { configurable: true, value: window })
  for (const name of [
    '__newsnookMediaProbeInstalled',
    '__newsnookAutomaticActivation',
    '__newsnookCollectMedia',
    '__newsnookSetAutomaticActivation',
    '__newsnookMediaEvents',
    '__newsnookLastHighValueAt',
  ]) {
    Object.defineProperty(window, name, { configurable: true, writable: true, value: undefined })
  }
  window.performance = { getEntriesByType: () => [] }
  window.PerformanceObserver = class {
    constructor() {}
    observe() {}
  }
  window.MediaSource = class {}
  window.MediaSource.prototype.addSourceBuffer = function () { return {} }
  window.navigator.requestMediaKeySystemAccess = undefined
  window.fetch = async () => ({
    url: 'https://api.example/player',
    status: 200,
    headers: {
      get(name) {
        if (name === 'content-type') return 'application/json'
        return null
      },
    },
    clone() {
      return { text: async () => fetchBody || '' }
    },
  })
  window.XMLHttpRequest = function XMLHttpRequest() {}
  window.XMLHttpRequest.prototype.open = function () {}
  const context = vm.createContext(window)
  vm.runInContext(probeScript(passive), context, { filename: 'MediaProbe.injected.js' })
  return { window, context }
}

function instrumentMedia(element) {
  Object.setPrototypeOf(element, element.ownerDocument.defaultView.HTMLMediaElement.prototype)
  let muted = false
  let plays = 0
  Object.defineProperty(element, 'muted', {
    configurable: true,
    get: () => muted,
    set: (value) => { muted = Boolean(value) },
  })
  element.play = () => {
    plays += 1
    return Promise.resolve()
  }
  return { get muted() { return muted }, get plays() { return plays } }
}

{
  const source = probeScript(false)
  const parsed = ts.createSourceFile('probe.js', source, ts.ScriptTarget.ES2018, true, ts.ScriptKind.JS)
  assert.deepEqual(parsed.parseDiagnostics, [], 'actual injected probe must parse as JavaScript')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2018,
      module: ts.ModuleKind.None,
      ignoreDeprecations: '6.0',
    },
    reportDiagnostics: true,
  })
  assert.equal(
    transpiled.diagnostics?.length || 0,
    0,
    `TypeScript ES2018 transpilation must report no diagnostics: ${
      (transpiled.diagnostics || []).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')
    }`,
  )
  let optionalChains = 0
  const visit = (node) => {
    if (node.questionDotToken) optionalChains += 1
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.equal(optionalChains, 0, 'WebView 69 probe must not contain optional chaining')
  assert.equal(source.includes('.matchAll('), false, 'WebView 69 probe must not require String.matchAll')
  new vm.Script(source, { filename: 'MediaProbe.es2018.js' })
}

{
  const { window } = makeRuntime('<html><body><video></video></body></html>', { passive: true })
  const state = instrumentMedia(window.document.querySelector('video'))
  window.__newsnookCollectMedia()
  assert.equal(state.plays, 0, 'passive browser probe must never start playback')
  assert.equal(state.muted, false, 'passive browser probe must never mute media')
}

{
  const { window } = makeRuntime('<html><body></body></html>')
  const states = []
  for (let index = 0; index < 12; index += 1) {
    const video = window.document.createElement('video')
    states.push(instrumentMedia(video))
    window.document.body.append(video)
  }
  assert.equal(window.document.querySelector('video') instanceof window.HTMLMediaElement, true,
    'linkedom fixture must model video as HTMLMediaElement')
  window.__newsnookCollectMedia()
  assert.ok(states.reduce((sum, state) => sum + state.plays, 0) <= 6,
    'automatic activation must have a bounded action budget')
  assert.ok(states.some((state) => state.plays > 0),
    `dynamic media nodes must be rescanned and activated without arbitrary clicks: ${JSON.stringify({
      automatic: window.__newsnookAutomaticActivation,
      plays: states.map((state) => state.plays),
    })}`)
  window.__newsnookSetAutomaticActivation(false, true)
  const late = window.document.createElement('video')
  const lateState = instrumentMedia(late)
  window.document.body.append(late)
  window.__newsnookCollectMedia()
  assert.equal(lateState.plays, 0, 'assisted handoff must permanently stop automatic activation')
  assert.equal(lateState.muted, false, 'assisted mode must not mute newly discovered media')
}

{
  const { window } = makeRuntime('<html><body><div id="player"></div><button id="play">Play</button></body></html>')
  let playerPlays = 0
  let arbitraryClicks = 0
  window.document.querySelector('#play').addEventListener('click', () => { arbitraryClicks += 1 })
  const player = {
    el: () => window.document.querySelector('#player'),
    muted: () => {},
    play: () => { playerPlays += 1; return Promise.resolve() },
  }
  window.videojs = { getPlayers: () => ({ primary: player }) }
  window.__newsnookCollectMedia()
  window.__newsnookCollectMedia()
  assert.equal(playerPlays, 1, 'known video.js player instances may be activated once')
  assert.equal(arbitraryClicks, 0, 'automatic activation must not click generic play-labelled controls')
}

{
  const { window } = makeRuntime('<html><body><video src="https://cdn.example/video"></video></body></html>')
  const video = window.document.querySelector('video')
  instrumentMedia(video)
  Object.defineProperty(video, 'currentSrc', { configurable: true, value: 'https://cdn.example/video' })
  let events = window.__newsnookCollectMedia()
  assert.equal(events.find((event) => event.url === 'https://cdn.example/video')?.mimeType, undefined)
  video.setAttribute('type', 'video/mp4')
  events = window.__newsnookCollectMedia()
  assert.equal(
    events.find((event) => event.url === 'https://cdn.example/video')?.mimeType,
    'video/mp4',
    `duplicate observations must retain later metadata enrichment: ${JSON.stringify(events)}`,
  )
}

{
  const encoded = encodeURIComponent('https://cdn.example/current/master.m3u8?token=one')
  const base64 = Buffer.from(encodeURIComponent('https://cdn.example/current/master.m3u8?token=two')).toString('base64')
  const { window } = makeRuntime(`<html><body>
    <script>window.player_aaaa={url:${JSON.stringify(encoded)},url_next:'https://cdn.example/next.m3u8',encrypt:1}</script>
  </body></html>`)
  window.player_aaaa = { url: encoded, url_next: 'https://cdn.example/next.m3u8', encrypt: 1 }
  let events = window.__newsnookCollectMedia()
  assert.ok(events.some((event) => event.url === 'https://cdn.example/current/master.m3u8?token=one'
    && event.source === 'player-config' && event.sourceLabel === 'maccms-player'))
  assert.equal(events.some((event) => event.url?.includes('/next.m3u8')), false,
    'MacCMS observation must not auto-pick url_next')

  const second = window.document.defaultView
  second.player_aaaa = { url: base64, url_next: 'https://cdn.example/episode-2.m3u8', encrypt: 2 }
  events = second.__newsnookCollectMedia()
  assert.ok(events.some((event) => event.url === 'https://cdn.example/current/master.m3u8?token=two'))
}

{
  const { window } = makeRuntime('<html><body></body></html>')
  window.playerConfig = {
    sources: [{
      src: 'https://cdn.example/quality/1080.mp4',
      label: '1080p',
      width: 1920,
      height: 1080,
      mimeType: 'video/mp4',
    }],
  }
  const event = window.__newsnookCollectMedia()
    .find((item) => item.url === 'https://cdn.example/quality/1080.mp4')
  assert.equal(event?.source, 'player-config')
  assert.equal(event?.sourceLabel, '1080p')
  assert.equal(event?.width, 1920)
  assert.equal(event?.height, 1080)
}

{
  const body = JSON.stringify({ stream: { url: 'https://cdn.example/body/master.m3u8' } })
  const { window } = makeRuntime('<html><body></body></html>', { fetchBody: body })
  await window.fetch('https://api.example/player')
  await Promise.resolve()
  const events = window.__newsnookCollectMedia()
  assert.ok(events.some((event) => event.source === 'fetch' && event.bodyText === body),
    'fetch player bodies must remain drainable by the native live collector')
}

{
  const { window } = makeRuntime('<html><body></body></html>')
  const config = { video: { url: '' } }
  window.playerConfig = config
  window.__newsnookCollectMedia()
  config.video.url = 'https://cdn.example/late/current.mp4'
  assert.ok(window.__newsnookCollectMedia().some(event => event.url === config.video.url),
    'asynchronous mutation of an existing player configuration must remain observable')
}

{
  const { window } = makeRuntime(`<html><body><script>var recommendations=[{url:'https://cdn.example/related.mp4'}];</script></body></html>`)
  assert.equal(window.__newsnookCollectMedia().some(event => event.url === 'https://cdn.example/related.mp4'), false,
    'arbitrary script URL literals are not evidence of the current player')
}

console.log('media probe runtime tests passed')
