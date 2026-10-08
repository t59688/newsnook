import assert from 'node:assert/strict'
import type { HttpOptions } from '@capacitor/core'
import type { LatestReleaseInfo } from '../src/features/appUpdate/types'

// Exercise the real Capacitor proxy, HTTP parsers and update service. Only the native
// transport/DownloadManager boundary is replaced; no production method is mocked.
const listeners = new Map<string, (payload: Record<string, unknown>) => void>()
const downloads: Record<string, unknown>[] = []
const requests: HttpOptions[] = []
let respond: (options: HttpOptions) => Promise<unknown>
let nextId = 100
let installPermission = true
let enqueueError = false
Object.assign(globalThis, {
  androidBridge: {},
  Capacitor: {
    PluginHeaders: [
      { name: 'CapacitorHttp', methods: [{ name: 'get', rtype: 'promise' }] },
      { name: 'AppUpdate', methods: [
        { name: 'canInstallPackages', rtype: 'promise' },
        { name: 'startDownload', rtype: 'promise' },
        { name: 'addListener', rtype: 'callback' },
        { name: 'removeListener', rtype: 'callback' },
      ] },
    ],
    async nativePromise(plugin: string, method: string, options: Record<string, unknown>) {
      if (plugin === 'CapacitorHttp' && method === 'get') {
        requests.push(options as unknown as HttpOptions)
        return respond(options as unknown as HttpOptions)
      }
      if (method === 'canInstallPackages') return { value: installPermission }
      if (method === 'startDownload') {
        if (enqueueError) throw new Error('enqueue failed')
        downloads.push(options)
        return { downloadId: ++nextId }
      }
      throw new Error(`Unexpected native call: ${plugin}.${method}`)
    },
    nativeCallback(_plugin: string, method: string, options: { eventName: string }, callback: (payload: Record<string, unknown>) => void) {
      if (method === 'addListener') listeners.set(options.eventName, callback)
      return String(listeners.size)
    },
  },
})

const { fetchLatestRelease } = await import('../src/features/appUpdate/github')
const { beginUpdate, getActiveDownloadId, getAppUpdateUiState } = await import('../src/features/appUpdate/service')
const { parseUpdateManifest, releaseFromUpdateManifest } = await import('../src/features/appUpdate/cdn')

const version = '1.8.11-beta.15'
const sourceHash = 'a8187f0b9da79d204c80b2def44718904da3acf8809ad970892406de54b872f2'
const targetHash = '7c3e4f7d9881ff773d38e3c9594ac1248839e98937c3f606b813ef71e9dc6a12'
const patchHash = 'bc0f386e154f2ee9c1b65e3ed78d2d7e8ef56e236beff5869619931bff0f021e'
const base = 'https://news-update.aizeek.com/newsnook/beta'
// The arm64 identity/size reproduces the published 14 -> 15 metadata. Other
// variants below are synthetic fixtures, not claims about release APK contents.
function asset(suffix: string, hash: string, size: number) {
  const fileName = `newsnook-${version}-${suffix}-release.apk`
  const patchName = `delta-${sourceHash}-${hash}.gdiff.gz`
  return {
    fileName, url: `${base}/${fileName}`, sha256: hash, size,
    deltas: [{ algorithm: 'gdiff-gzip-v1', fromSha256: sourceHash,
      fileName: patchName, url: `${base}/deltas/${patchName}`, sha256: patchHash, size: 351505 }],
  }
}
const arm64 = asset('local-arm64-v8a', targetHash, 32309704)
const manifest = {
  schemaVersion: 2, track: 'beta', version, versionCode: 10811015,
  tagName: `v${version}`, notes: 'Current CDN notes',
  packages: {
    cloud: asset('cloud', 'b'.repeat(64), 3676878),
    local: { ...asset('local', 'c'.repeat(64), 78573126), abis: {
      'arm64-v8a': arm64,
      'x86_64': asset('local-x86_64', 'd'.repeat(64), 23063747),
    } },
  },
}
const githubUrl = `https://github.com/t59688/newsnook/releases/download/v${version}/${arm64.fileName}`
const githubRelease = {
  tag_name: `v${version}`, prerelease: true, body: 'Accepted release notes',
  assets: [{ name: arm64.fileName, browser_download_url: githubUrl,
    digest: `sha256:${targetHash}`, size: arm64.size }],
}
function complete() {
  listeners.get('downloadComplete')!({ downloadId: getActiveDownloadId() })
  assert.equal(getActiveDownloadId(), null)
  downloads.length = 0
  requests.length = 0
}
function lastDownload() {
  assert.equal(downloads.length, 1, 'Exactly one native download must be enqueued')
  return downloads[0]!
}

console.log('--- transient manifest outage: GitHub check -> recovered CDN download ---')
respond = async ({ url }) => url.startsWith(base)
  ? { status: 503, data: '' }
  : { status: 200, data: [githubRelease] }
const checked = await fetchLatestRelease('1.8.11-beta.14', 'local', 'beta', ['arm64-v8a'])
assert.equal(checked.status, 'available')
assert(checked.status === 'available')
const accepted = checked.release
assert.equal(accepted.apkUrl, githubUrl)
assert.equal(accepted.deltas, undefined, 'GitHub release assets do not contain delta metadata')
respond = async () => ({ status: 200, data: manifest })
requests.length = 0
await beginUpdate(accepted)
assert.deepEqual(lastDownload().deltas, arm64.deltas,
  'A recovered authoritative manifest must restore the exact accepted APK delta before download')
assert.equal(lastDownload().url, arm64.url, 'The native delta contract requires a same-channel CDN target')
assert.equal(lastDownload().sha256, targetHash)
assert.equal(lastDownload().size, 32309704)
assert.equal(lastDownload().versionCode, 10811015)
assert.equal(requests.length, 1)
assert.equal(requests[0]!.connectTimeout, 5000)
assert.equal(requests[0]!.readTimeout, 5000)
assert.equal(accepted.apkUrl, githubUrl, 'Recovery must not mutate the accepted release object')
complete()
console.log('PASS: 343 KiB delta survives recovered CDN metadata')

console.log('--- identity pinning, unavailable source and variant coverage ---')
const parsed = parseUpdateManifest(manifest, 'beta')
assert(parsed)
const direct = releaseFromUpdateManifest(parsed, 'local', ['arm64-v8a'])
respond = async () => { throw new Error('Unexpected metadata refetch') }
await beginUpdate(direct)
assert.deepEqual(lastDownload().deltas, arm64.deltas)
assert.equal(requests.length, 0, 'Existing delta metadata must not add another network dependency')
complete()

for (const [name, response] of [
  ['offline', () => Promise.reject(new Error('offline'))],
  ['HTTP error', () => Promise.resolve({ status: 503, data: '' })],
  ['invalid JSON', () => Promise.resolve({ status: 200, data: '{' })],
  ['wrong channel', () => Promise.resolve({ status: 200, data: { ...manifest, track: 'stable' } })],
  ['new version', () => Promise.resolve({ status: 200, data: JSON.parse(JSON.stringify(manifest)
    .replaceAll('1.8.11-beta.15', '1.8.11-beta.16').replaceAll('10811015', '10811016')) })],
  ['changed hash', () => Promise.resolve({ status: 200, data: JSON.parse(JSON.stringify(manifest)
    .replaceAll(targetHash, 'e'.repeat(64))) })],
  ['changed size', () => Promise.resolve({ status: 200, data: JSON.parse(JSON.stringify(manifest)
    .replaceAll('32309704', '32309705')) })],
  ['missing ABI', () => {
    const value = structuredClone(manifest)
    delete (value.packages.local.abis as Record<string, unknown>)['arm64-v8a']
    return Promise.resolve({ status: 200, data: value })
  }],
  ['no deltas', () => {
    const value = structuredClone(manifest)
    value.packages.local.abis['arm64-v8a'].deltas = []
    return Promise.resolve({ status: 200, data: value })
  }],
] as const) {
  respond = response
  await beginUpdate(accepted)
  assert.equal(lastDownload().url, githubUrl, `${name}: preserve the accepted fallback URL`)
  assert.equal(lastDownload().sha256, targetHash, `${name}: never switch the target hash`)
  assert.equal(lastDownload().deltas, undefined, `${name}: do not use unrelated deltas`)
  assert.equal(requests.length, 1, `${name}: at most one recovery request, no retry loop`)
  complete()
}

for (const release of [
  { ...accepted, sha256: undefined },
  { ...accepted, size: undefined },
  { ...accepted, subscriptionTrack: 'stable' as const },
]) {
  respond = async () => { throw new Error('Unpinned target must not be refreshed') }
  await beginUpdate(release)
  assert.equal(lastDownload().url, githubUrl)
  assert.equal(requests.length, 0)
  complete()
}

// All flavors and ABIs use the same rule; no cloud/size/version-number exceptions.
for (const release of [
  releaseFromUpdateManifest(parsed, 'cloud'),
  releaseFromUpdateManifest(parsed, 'local'),
  releaseFromUpdateManifest(parsed, 'local', ['x86_64']),
]) {
  const withoutDelta: LatestReleaseInfo = { ...release, deltas: undefined,
    apkUrl: `https://github.com/t59688/newsnook/releases/download/v${version}/${release.apkFileName}` }
  respond = async () => ({ status: 200, data: manifest })
  await beginUpdate(withoutDelta)
  assert.equal(lastDownload().url, release.apkUrl)
  assert.deepEqual(lastDownload().deltas, release.deltas)
  assert.equal(lastDownload().fileName, release.apkFileName)
  complete()
}
console.log('PASS: identity pinning and all package variants')

console.log('--- single flight while recovering metadata ---')
let resolveManifest!: (value: unknown) => void
let fetched!: () => void
const fetching = new Promise<void>((resolve) => { fetched = resolve })
const deferred = new Promise<unknown>((resolve) => { resolveManifest = resolve })
respond = async () => { fetched(); return deferred }
const first = beginUpdate(accepted)
await fetching
const second = beginUpdate(accepted)
resolveManifest({ status: 200, data: manifest })
const results = await Promise.all([first, second])
assert.equal(requests.length, 1, 'Repeated taps during metadata recovery must share one operation')
assert.deepEqual(results[0], results[1])
lastDownload()
complete()
console.log('PASS: repeated taps share one native download')

console.log('--- denied permission and enqueue error release the start lock ---')
respond = async () => ({ status: 200, data: manifest })
installPermission = false
assert.deepEqual(await beginUpdate(accepted), { needInstallPermission: true })
assert.equal(downloads.length, 0)
assert.equal(requests.length, 0)
installPermission = true
enqueueError = true
assert.deepEqual(await beginUpdate(accepted), { error: 'enqueue failed' })
assert.equal(getAppUpdateUiState().downloading, false)
enqueueError = false
requests.length = 0
await beginUpdate(accepted)
lastDownload()
complete()
console.log('PASS: permission/error retries are not blocked')

console.log('--- full fallback preserves reason without becoming an error ---')
await beginUpdate(direct)
const originalId = getActiveDownloadId()!
listeners.get('downloadRedirected')!({ fromDownloadId: originalId, toDownloadId: originalId + 10,
  message: 'patch hash mismatch' })
assert.equal(getActiveDownloadId(), originalId + 10)
assert.equal(getAppUpdateUiState().downloading, true)
assert.match(getAppUpdateUiState().downloadMessage ?? '', /patch hash mismatch/,
  'The reason for downloading a full APK must remain visible during fallback')
assert.equal(getAppUpdateUiState().lastManualMessage, undefined,
  'A successful fallback is still an active download, not an installation failure')
// Late completion/failure of the old patch must not clear the redirected full download.
listeners.get('downloadComplete')!({ downloadId: originalId })
listeners.get('downloadFailed')!({ downloadId: originalId, message: 'stale patch error' })
assert.equal(getAppUpdateUiState().downloading, true)
assert.equal(getActiveDownloadId(), originalId + 10)
listeners.get('downloadRedirected')!({ fromDownloadId: originalId, toDownloadId: originalId + 20,
  message: 'stale fallback' })
assert.equal(getActiveDownloadId(), originalId + 10)
assert.doesNotMatch(getAppUpdateUiState().downloadMessage ?? '', /stale/)
complete()
assert.equal(getAppUpdateUiState().downloadMessage, undefined)
// An older native shell without the optional diagnostic field must remain compatible.
await beginUpdate(direct)
listeners.get('downloadRedirected')!({ fromDownloadId: getActiveDownloadId(), toDownloadId: 900 })
assert.equal(getActiveDownloadId(), 900)
assert.match(getAppUpdateUiState().downloadMessage ?? '', /全量/)
complete()
console.log('PASS: redirected download keeps diagnostics and ignores stale patch events')
