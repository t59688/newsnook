import assert from 'node:assert/strict'
import { installUserScript, loadUserScripts, matchesUserScript, prepareUserScriptInstall, saveUserScripts } from '../src/features/browser/scripts'

function script(metadata: string) {
  return installUserScript(`// ==UserScript==\n// @name Integration specimen\n// @version 2.4\n${metadata}\n// ==/UserScript==\n(() => {})();`)
}

const linuxdo = script(`// @match https://linux.do/*\n// @run-at document-idle\n// @grant GM_getValue\n// @grant unsafeWindow`)
assert.equal(linuxdo.name, 'Integration specimen')
assert.equal(linuxdo.noFrames, false)
assert.equal(linuxdo.runAt, 'document-idle')
assert.deepEqual(linuxdo.grants, ['GM_getValue', 'unsafeWindow'])
assert.equal(matchesUserScript(linuxdo, 'https://linux.do/t/hello/2'), true)
assert.equal(matchesUserScript(linuxdo, 'https://attackerlinux.do/t/hello/2'), false)
assert.equal(matchesUserScript(linuxdo, 'http://linux.do/t/hello/2'), false)

const chat = script(`// @match https://chatgpt.com/*\n// @match https://chat.openai.com/*\n// @require https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js\n// @grant GM_download\n// @grant GM_xmlhttpRequest\n// @connect *`)
assert.equal(chat.requires.length, 1)
assert.equal(chat.connects[0], '*')
assert.equal(matchesUserScript(chat, 'https://chatgpt.com/c/abc'), true)
assert.equal(matchesUserScript(chat, 'https://chat.openai.com/c/abc'), true)
assert.equal(matchesUserScript(chat, 'https://example.com/'), false)

const frameOptOut = script(`// @match https://example.com/*\n// @noframes`)
assert.equal(frameOptOut.noFrames, true, '@noframes is parsed as a presence-only directive')

const mixed = script(`// @match *://*.example.com/*\n// @exclude-match https://secret.example.com/*\n// @exclude *://*.example.com/private/*`)
assert.equal(matchesUserScript(mixed, 'https://example.com/post/5'), true)
assert.equal(matchesUserScript(mixed, 'http://www.example.com/post/5'), true)
assert.equal(matchesUserScript(mixed, 'https://secret.example.com/post/5'), false)
assert.equal(matchesUserScript(mixed, 'https://x.example.com/private/5'), false)
assert.equal(matchesUserScript(mixed, 'https://example.com.evil.org/'), false)

assert.throws(() => installUserScript('// @match https://example.com/*'), /UserScript/)
assert.throws(() => script('// @grant GM_getValue'), /@match|@include/)
assert.throws(() => installUserScript('x'.repeat(400_001)), /400 KB/)
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} })
const stored = { ...linuxdo, enabled: false, name: null, grants: null, excludes: undefined, excludeMatches: undefined }
storage.set('newsnook:userscripts:v1', JSON.stringify([null, stored, { ...linuxdo, id: 'broken', source: 'not a userscript' }]))
const restored = loadUserScripts()
assert.equal(restored.length, 1, 'bad entries do not hide other installed scripts')
assert.equal(restored[0].name, linuxdo.name, 'derived metadata is rebuilt from the saved source')
assert.deepEqual(restored[0].grants, linuxdo.grants, 'missing or damaged arrays cannot enter the native runtime')
assert.equal(restored[0].enabled, false, 'recovery preserves the user enable setting')
assert.equal(restored[0].id, linuxdo.id, 'recovery preserves the script storage identity')
assert.equal(matchesUserScript(restored[0], 'https://linux.do/t/hello/2'), true)

const exactCap = linuxdo.source.padEnd(400_000, ' ')
saveUserScripts([installUserScript(exactCap)])
assert.equal(loadUserScripts().length, 1, 'an accepted script must survive reload at the size limit')
assert.throws(() => installUserScript(linuxdo.source + '字'.repeat(140_000)), /400 KB/, 'source and file imports share a byte budget')
const disabled = { ...linuxdo, enabled: false }
const updated = prepareUserScriptInstall(linuxdo.source.replace('@version 2.4', '@version 2.5'), [disabled])
assert.equal(updated.id, disabled.id, 're-importing an existing script offers an update instead of creating a duplicate')
assert.equal(updated.createdAt, disabled.createdAt)
assert.equal(updated.enabled, false, 'updates do not silently enable a disabled script')
assert.equal(updated.version, '2.5')
const separateNamespace = prepareUserScriptInstall(linuxdo.source.replace('// @version', '// @namespace https://other.example/\n// @version'), [disabled])
assert.notEqual(separateNamespace.id, disabled.id, 'same-name scripts from another namespace are independent')
const renamed = prepareUserScriptInstall(linuxdo.source.replace('@name Integration specimen', '@name Renamed script'), [disabled], disabled)
assert.equal(renamed.id, disabled.id, 'an explicit edit keeps its identity even if metadata changes')
assert.throws(() => script('// @match    '), /@match|@include/, 'empty website rules are not installable')
const editingWithOldEnabledState = prepareUserScriptInstall(linuxdo.source, [disabled], linuxdo)
assert.equal(editingWithOldEnabledState.enabled, false, 'saving an open editor preserves a switch changed after editing began')
storage.set('newsnook:userscripts:v1', JSON.stringify([{ ...linuxdo, source: linuxdo.source + '字'.repeat(140_000) }]))
assert.equal(loadUserScripts().length, 1, 'previous versions accepted a character budget, so existing multibyte scripts remain readable')
const legacy = { ...loadUserScripts()[0], enabled: false }
const editedLegacySource = legacy.source.replace('@version 2.4', '@version 2.5')
const editedLegacy = prepareUserScriptInstall(editedLegacySource, [legacy], legacy)
saveUserScripts([editedLegacy])
const legacyRoundTrip = loadUserScripts()[0]
assert.equal(legacyRoundTrip.source, editedLegacySource, 'a previously installed large multibyte script remains editable and survives saving')
assert.equal(legacyRoundTrip.version, '2.5')
assert.equal(legacyRoundTrip.id, legacy.id)
assert.equal(legacyRoundTrip.createdAt, legacy.createdAt)
assert.equal(legacyRoundTrip.enabled, false)
const sameLegacyIdentity = prepareUserScriptInstall(editedLegacySource.replace('@version 2.5', '@version 2.6'), [legacyRoundTrip])
assert.equal(sameLegacyIdentity.id, legacy.id, 'a matched name and namespace may update the same legacy installation')
const renamedLegacy = prepareUserScriptInstall(editedLegacySource.replace('@name Integration specimen', '@name Legacy renamed'), [legacyRoundTrip], legacyRoundTrip)
assert.equal(renamedLegacy.id, legacy.id, 'an explicit installed editor retains the legacy allowance when renaming')
assert.throws(() => prepareUserScriptInstall(editedLegacySource, [], legacy), /400 KB/, 'a stale or forged editing object cannot grant the legacy budget to a new install')
assert.throws(() => prepareUserScriptInstall(editedLegacySource.replace('// @version', '// @namespace https://unmatched.example/\n// @version'), [legacyRoundTrip]), /400 KB/, 'an unrelated namespace cannot borrow another script\'s legacy budget')
assert.throws(() => prepareUserScriptInstall(editedLegacySource.padEnd(400_001, '字'), [legacyRoundTrip], legacyRoundTrip), /400000|400,000/, 'legacy edits remain bounded by the historical character limit')
assert.throws(() => installUserScript(editedLegacySource, legacy), /400 KB/, 'the new-install API remains byte-limited even when given an old identity')

const { readFileSync } = await import('node:fs')
const { runInNewContext } = await import('node:vm')
const runtimeSource = readFileSync(new URL('../android/app/src/main/assets/newsnook-userscript-runtime.js', import.meta.url), 'utf8')
type RuntimeMessage = { op?: string; id?: string; token?: string; documentId?: string; documentUrl?: string; storageEpoch?: number; value?: string }
function bootRuntime(options: { runAt?: string; url?: string; grants?: string[]; frame?: boolean; body?: (...args: unknown[]) => void } = {}) {
  const messages: RuntimeMessage[] = []
  const documentEvents = new Map<string, (() => void)[]>()
  const windowEvents = new Map<string, (() => void)[]>()
  const portEvents: ((event: { data: string }) => void)[] = []
  const timers: (() => void)[] = []
  let executions = 0
  const listen = (events: Map<string, (() => void)[]>, type: string, callback: () => void) => {
    events.set(type, [...events.get(type) ?? [], callback])
  }
  const port = { postMessage: (text: string) => messages.push(JSON.parse(text)),
    addEventListener: (_type: string, callback: (event: { data: string }) => void) => portEvents.push(callback) }
  const page: Record<string, unknown> = { __NewsNookUserScriptPort: port,
    addEventListener: (type: string, callback: () => void) => listen(windowEvents, type, callback) }
  page.top = options.frame ? {} : page
  const cfg = { id: 'us-runtime', secret: 'verified-script-token', name: 'Runtime specimen', version: '1',
    matches: ['https://example.com/*'], includes: [], excludes: [], excludeMatches: [],
    runAt: options.runAt ?? 'document-end', executionWorld: 'page', grants: options.grants ?? ['none'],
    noFrames: options.noFrames ?? false, values: { ordinary: 'retained' }, storageEpoch: 0 }
  runInNewContext(runtimeSource + '\n__NN_BOOT(__testBody);', {
    __NN_CONFIG: cfg, __testBody: (...args: unknown[]) => { executions++; options.body?.(...args) },
    window: page, document: { readyState: 'loading',
      addEventListener: (type: string, callback: () => void) => listen(documentEvents, type, callback) },
    location: { href: options.url ?? 'https://example.com/article' },
    performance: { timeOrigin: 1700000000000.25, timing: { navigationStart: 1700000000000 } },
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length },
    console: { error: () => {} }, URL, Blob, TextDecoder, Uint8Array, atob, btoa,
  })
  return { messages, executions: () => executions, cfg,
    documentEvent: (type: string) => documentEvents.get(type)?.forEach(callback => callback()),
    windowEvent: (type: string) => windowEvents.get(type)?.forEach(callback => callback()),
    flushTimers: () => timers.forEach(callback => callback()),
    receive: (message: object) => portEvents.forEach(callback => callback({ data: JSON.stringify(message) })),
  }
}
const pendingEnd = bootRuntime()
assert.equal(pendingEnd.executions(), 0)
assert.equal(pendingEnd.messages.length, 0, 'installing or matching a document-end script does not count as execution')
pendingEnd.documentEvent('DOMContentLoaded')
assert.equal(pendingEnd.executions(), 1)
const started = pendingEnd.messages.filter(message => message.op === 'started')
assert.equal(started.length, 1, 'the actual execute boundary reports one started event through the authenticated port')
assert.equal(started[0].id, pendingEnd.cfg.id)
assert.equal(started[0].token, pendingEnd.cfg.secret)
assert.equal(started[0].documentId, '1700000000000.25')
assert.equal(started[0].documentUrl, 'https://example.com/article')
pendingEnd.documentEvent('DOMContentLoaded')
assert.equal(pendingEnd.messages.filter(message => message.op === 'started').length, 1, 'duplicate readiness cannot count the script twice')
const pendingIdle = bootRuntime({ runAt: 'document-idle' })
assert.equal(pendingIdle.messages.length, 0)
pendingIdle.windowEvent('load')
pendingIdle.flushTimers()
assert.equal(pendingIdle.executions(), 1)
assert.equal(pendingIdle.messages.filter(message => message.op === 'started').length, 1, 'load and idle fallback share one execution')
const unmatched = bootRuntime({ url: 'https://other.example/article', runAt: 'document-start' })
assert.equal(unmatched.executions(), 0)
assert.equal(unmatched.messages.length, 0, 'unmatched pages never execute')
const frame = bootRuntime({ frame: true, runAt: 'document-start' })
assert.equal(frame.executions(), 1, 'a matching grant-none script executes in a child frame')
assert.equal(frame.messages.filter(message => message.op === 'started').length, 1, 'a frame may report its execution boundary')
const optedOutFrame = bootRuntime({ frame: true, noFrames: true, runAt: 'document-start' })
assert.equal(optedOutFrame.executions(), 0, '@noframes prevents child-frame execution')
const privilegedFrame = bootRuntime({ frame: true, grants: ['GM_getValue'], runAt: 'document-start' })
assert.equal(privilegedFrame.executions(), 0, 'scripts requiring native GM capabilities are not injected into child frames')
const failedBody = bootRuntime({ runAt: 'document-start', body: () => { throw new Error('script body failed') } })
assert.equal(failedBody.executions(), 1)
assert.equal(failedBody.messages.filter(message => message.op === 'started').length, 1, 'started means entered the user script, including a body that later throws')

let gmGet!: (key: string, fallback?: unknown) => unknown
let gmSet!: (key: string, value: unknown) => void
const valuesRuntime = bootRuntime({ runAt: 'document-start', grants: ['GM_getValue', 'GM_setValue'],
  body: (...args) => { gmGet = args[1] as typeof gmGet; gmSet = args[2] as typeof gmSet } })
assert.equal(gmGet('ordinary'), 'retained')
valuesRuntime.receive({ event: 'storageReset', id: 'different-script', storageEpoch: 1, values: {} })
assert.equal(gmGet('ordinary'), 'retained', 'a shared world port cannot reset another script storage')
valuesRuntime.receive({ event: 'storageReset', id: valuesRuntime.cfg.id, storageEpoch: 1, values: {} })
assert.equal(gmGet('ordinary'), undefined, 'turning on no-record mode removes ordinary values from the live JS view')
gmSet('private', 'ephemeral')
assert.equal(valuesRuntime.messages.at(-1)?.storageEpoch, 1, 'writes identify the active storage generation')
valuesRuntime.receive({ event: 'storageReset', id: valuesRuntime.cfg.id, storageEpoch: 0, values: { stale: true } })
assert.equal(gmGet('private'), 'ephemeral', 'a late reset cannot restore a previous storage generation')
valuesRuntime.receive({ event: 'storageReset', id: valuesRuntime.cfg.id, storageEpoch: 2, values: { ordinary: 'retained' } })
assert.equal(gmGet('private'), undefined)
assert.equal(gmGet('ordinary'), 'retained')
let download: ((options: string, name: string) => void) | undefined
const downloadRuntime = bootRuntime({ runAt: 'document-start', grants: ['GM_download'],
  body: (...args) => { download = args[5] as typeof download } })
assert.ok(download)
download('https://example.com/manual.bin', 'manual.bin')
assert.equal(downloadRuntime.messages.at(-1)?.op, 'downloadUrl', 'an explicitly granted download stays callable across privacy modes')
bootRuntime({ runAt: 'document-start', body: (...args) => {
  assert.equal(args[5], undefined)
  assert.equal((args[7] as Record<string, unknown>).download, undefined, 'reporting execution does not grant download authority')
} })

console.log('Userscript matching, actual execution reports, live storage generations and grant boundaries: OK')
