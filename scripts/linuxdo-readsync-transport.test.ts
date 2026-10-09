import assert from 'node:assert/strict'
import { Capacitor, registerPlugin } from '@capacitor/core'

// Run the real API client and topic service. Only the Android network boundary
// is substituted; no CSRF/retry/classification behavior is mocked.
Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'
type Request = { url: string; method: string; headers?: Record<string, string>; body?: string; browserOnly?: boolean }
type Response = { status: number; data: string; headers?: Record<string, string>; transport?: string; responseUrl?: string }
const calls: Request[] = []
let handle: (request: Request) => Promise<Response>
let recover: () => Promise<Record<string, unknown>> = async () => ({ ready: false })
const nativeBoundary = {
  request: async (request: Request) => { calls.push(request); return handle(request) },
  prepareBrowserSession: async () => recover(),
}
registerPlugin('LinuxDoSession', { android: () => nativeBoundary, web: () => nativeBoundary })
const { LinuxDoApiClient } = await import('../src/features/linuxdo/api/client')
const { LinuxDoTopicService } = await import('../src/features/linuxdo/topic/service')
const { LinuxDoApiError } = await import('../src/features/linuxdo/types')
const session = { authenticated: true, authMode: 'browser-session' as const, currentUser: { id: 9, username: 'test-reader' } }
const json = (data: unknown): Response => ({ status: 200, data: JSON.stringify(data), headers: { 'content-type': 'application/json' }, transport: 'native' })
const challenge = (): Response => ({ status: 403, data: '<html><title>Just a moment...</title></html>', headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'test-ray', 'content-type': 'text/html' }, transport: 'browser' })
const accepted = (): Response => ({ status: 200, data: '', headers: { 'content-type': 'text/html' }, transport: 'browser' })
function setup() { calls.length = 0; recover = async () => ({ ready: false }); const api = new LinuxDoApiClient(); api.setSession(session as any); return { api, topics: new LinuxDoTopicService(api) } }
const cases: Array<[string, () => Promise<void>]> = []

cases.push(['a CSRF challenge is not a failed timings POST and is not retried as BAD CSRF', async () => {
  const { topics } = setup()
  handle = async request => request.method === 'GET' ? challenge() : accepted()
  let failure: any
  try { await topics.reportTimings(2942004, 5000, { 1: 5000 }) } catch (error) { failure = error }
  assert.ok(failure instanceof LinuxDoApiError)
  assert.equal(failure.kind, 'browser-verification')
  assert.equal(calls.length, 1, 'CF rejection must not trigger an identical CSRF request loop')
  assert.equal(failure.diagnostics?.stage, 'csrf')
  assert.equal(failure.diagnostics?.method, 'GET')
  assert.match(failure.diagnostics?.path ?? '', /^\/session\/csrf/)
  assert.equal(failure.diagnostics?.cfMitigated, 'challenge')
  assert.equal(failure.diagnostics?.transport, 'browser')
}])

cases.push(['a timings challenge retains the valid CSRF instead of refreshing it', async () => {
  const { topics } = setup()
  handle = async request => request.method === 'GET' ? json({ csrf: 'test-secret-token' }) : challenge()
  let failure: any
  try { await topics.reportTimings(2942004, 5000, { 1: 5000 }) } catch (error) { failure = error }
  assert.equal(calls.filter(r => r.method === 'GET').length, 1)
  assert.equal(calls.filter(r => r.method === 'POST').length, 1)
  assert.equal(failure.diagnostics?.stage, 'request')
  assert.equal(failure.diagnostics?.path, '/topics/timings')
  assert.ok(!JSON.stringify(failure.diagnostics).includes('test-secret-token'))
}])

cases.push(['only the explicit Discourse BAD CSRF response refreshes and retries once', async () => {
  const { topics } = setup()
  let gets = 0; let posts = 0
  handle = async request => request.method === 'GET'
    ? json({ csrf: `token-${++gets}` })
    : ++posts === 1 ? { status: 403, data: '["BAD CSRF"]' } : accepted()
  await topics.reportTimings(2942004, 5000, { 1: 5000, 2: 5000 })
  assert.equal(gets, 2); assert.equal(posts, 2)
  assert.equal(calls.at(-1)?.headers?.['X-CSRF-Token'], 'token-2')
  assert.equal(new URLSearchParams(calls.at(-1)?.body).get('timings[2]'), '5000')
}])

cases.push(['permission 403 is not a CSRF or browser challenge', async () => {
  const { topics } = setup()
  handle = async request => request.method === 'GET' ? json({ csrf: 'token' }) : { status: 403, data: '{"errors":["not allowed"]}', headers: { 'content-type': 'application/json' } }
  await assert.rejects(topics.reportTimings(2942004, 5000, { 1: 5000 }), (e: any) => e.kind === 'forbidden')
  assert.equal(calls.length, 2)
}])

cases.push(['concurrent writes share one in-flight CSRF fetch', async () => {
  const { topics } = setup()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  handle = async request => { if (request.method === 'GET') { await pending; return json({ csrf: 'shared-token' }) }; return accepted() }
  const one = topics.reportTimings(1, 5000, { 1: 5000 })
  const two = topics.reportTimings(2, 5000, { 1: 5000 })
  await Promise.resolve(); await Promise.resolve(); release()
  await Promise.all([one, two])
  assert.equal(calls.filter(r => r.method === 'GET').length, 1, 'parallel first writes must not race session-cookie/CSRF pairs')
}])

cases.push(['logout during CSRF cannot send the old account reading data', async () => {
  const { api, topics } = setup()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  handle = async request => { if (request.method === 'GET') { await pending; return json({ csrf: 'old-account-token' }) }; return accepted() }
  const operation = topics.reportTimings(1, 5000, { 1: 5000 })
  await Promise.resolve(); await Promise.resolve()
  api.setSession({ authenticated: false, authMode: 'none' }); release()
  await assert.rejects(operation)
  assert.equal(calls.filter(r => r.method === 'POST').length, 0)
}])

cases.push(['HTTP 200 login HTML must never count as a timings acknowledgement', async () => {
  const { topics } = setup()
  handle = async request => request.method === 'GET' ? json({ csrf: 'token' }) : { status: 200, data: '<html><form action="/session">Login</form></html>', responseUrl: 'https://linux.do/login', headers: { 'content-type': 'text/html' } }
  await assert.rejects(topics.reportTimings(1, 5000, { 1: 5000 }))
}])

cases.push(['an empty 200 response remains the official successful timings contract', async () => {
  const { topics } = setup()
  handle = async request => request.method === 'GET' ? json({ csrf: 'token' }) : accepted()
  await topics.reportTimings(1, 5000, { 1: 5000 })
  assert.equal(calls.length, 2)
}])

cases.push(['one normal first-party session recovery can resume the failed preflight', async () => {
  const { topics } = setup()
  let recovered = false; let preparations = 0
  recover = async () => { preparations++; recovered = true; return { ready: true, username: 'test-reader', userId: 9, csrf: 'fresh-browser-token' } }
  handle = async request => request.method === 'GET' ? challenge() : recovered && request.headers?.['X-CSRF-Token'] === 'fresh-browser-token' ? accepted() : challenge()
  await topics.reportTimings(2942004, 5000, { 2: 5000 })
  assert.equal(preparations, 1)
  assert.equal(calls.filter(r => r.method === 'GET').length, 1)
  assert.equal(calls.filter(r => r.method === 'POST').length, 1)
}])

cases.push(['session recovery must never replay timings into a different account', async () => {
  const { topics } = setup()
  recover = async () => ({ ready: true, username: 'other-account', userId: 99, csrf: 'other-account-token' })
  handle = async request => request.method === 'GET' ? challenge() : accepted()
  await assert.rejects(topics.reportTimings(1, 5000, { 1: 5000 }), (error: any) => error.kind === 'auth-required')
  assert.equal(calls.filter(r => r.method === 'POST').length, 0)
}])

cases.push(['a CSRF rotation after browser recovery still gets one bounded token retry', async () => {
  const { topics } = setup()
  let gets = 0; let posts = 0
  recover = async () => ({ ready: true, username: 'test-reader', userId: 9, csrf: 'prepared-token' })
  handle = async request => request.method === 'GET'
    ? ++gets === 1 ? challenge() : json({ csrf: 'rotated-token' })
    : ++posts === 1 ? { status: 403, data: '["BAD CSRF"]' } : accepted()
  await topics.reportTimings(1, 5000, { 1: 5000 })
  assert.equal(gets, 2); assert.equal(posts, 2)
  assert.equal(calls.at(-1)?.headers?.['X-CSRF-Token'], 'rotated-token')
}])

cases.push(['diagnostics distinguish a real first-party retry from a synthetic browser request', async () => {
  const { topics } = setup()
  recover = async () => ({ ready: true, username: 'test-reader', userId: 9, csrf: 'token' })
  handle = async request => request.method === 'GET' ? json({ csrf: 'token' }) : { ...challenge(), transport: 'browser-firstparty' }
  await assert.rejects(topics.reportTimings(1, 5000, { 1: 5000 }), (error: any) => error.diagnostics?.transport === 'browser-firstparty')
  assert.equal(calls.filter(request => request.method === 'POST').length, 1, 'an already first-party challenge must not replay the same write')
}])

cases.push(['a confirmed logged-out browser is reported as login-required, not another Cloudflare challenge', async () => {
  const { topics } = setup()
  recover = async () => ({ ready: false, reason: 'needs-verification', phase: 'session', status: 404 })
  handle = async request => request.method === 'GET' ? json({ csrf: 'token' }) : challenge()
  await assert.rejects(topics.reportTimings(1, 5000, { 1: 5000 }), (error: any) => error.kind === 'auth-required' && error.diagnostics?.stage === 'session')
  assert.equal(calls.filter(r => r.method === 'POST').length, 1)
}])

let failures = 0
for (const [name, run] of cases) {
  try { await run(); console.log('PASS', name) }
  catch (error) { failures++; console.error('FAIL', name, error instanceof Error ? error.message : error) }
}
assert.equal(failures, 0, `${failures} read-sync transport regressions`)
console.log(`linuxdo-readsync-transport: ${cases.length} passed`)
