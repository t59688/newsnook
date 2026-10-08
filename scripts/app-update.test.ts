import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  androidVersionCode,
  compareSemver,
  isNewerVersion,
  normalizeTagVersion,
  parseVersion,
  releaseTrackForVersion,
} from '../src/features/appUpdate/semver'
import {
  buildApkFileName,
  pickReleaseAsset,
  releaseApkFromTagPayload,
  releaseTagUrl,
  truncateReleaseNotes,
} from '../src/features/appUpdate/github'
import { normalizeSupportedAbis, selectPreferredAbi } from '../src/features/appUpdate/abi'
import {
  manifestUrl,
  parseUpdateManifest,
  releaseFromUpdateManifest,
  updateCheckFromManifest,
} from '../src/features/appUpdate/cdn'
import {
  resolveOppositeFlavor,
  selectEligibleUpdateResult,
} from '../src/features/appUpdate/service'
import { normalizeAppUpdatePrefs } from '../src/features/appUpdate/prefs'
import {
  shouldAutoPrompt,
  shouldFetchForAutoCheck,
  shouldShowUpdateBadge,
  SNOOZE_MS,
  RESUME_CHECK_INTERVAL_MS,
} from '../src/features/appUpdate/gate'
import { deltaFileName, selectHistory } from './android-delta-release.mjs'
import {
  androidVersionCodeForRelease,
  parseReleaseVersion,
  compareReleaseVersions,
  releaseContract,
} from './release-contract.mjs'

console.log('--- app-update semver / release contract ---')

assert.deepEqual(parseVersion('1.8.7'), { major: 1, minor: 8, patch: 7 })
assert.deepEqual(parseVersion('v1.8.7-beta.3'), { major: 1, minor: 8, patch: 7, beta: 3 })
assert.equal(parseVersion('1.8'), null)
assert.equal(parseVersion('1.8.7-beta.0'), null)
assert.equal(parseVersion('1.8.7-beta.999'), null)
assert.equal(normalizeTagVersion('V2.0.0-beta.2'), '2.0.0-beta.2')
assert.equal(releaseTrackForVersion('1.8.7'), 'stable')
assert.equal(releaseTrackForVersion('1.8.7-beta.1'), 'beta')
assert.equal(releaseTrackForVersion('1.8.7-rc.1'), null)

assert.ok(compareSemver('1.8.7-beta.2', '1.8.7-beta.1') > 0)
assert.ok(compareSemver('1.8.7', '1.8.7-beta.998') > 0)
assert.ok(compareSemver('1.8.8-beta.1', '1.8.7') > 0)
assert.equal(isNewerVersion('1.8.7-beta.2', '1.8.7-beta.1'), true)
assert.equal(isNewerVersion('1.8.7-beta.3', '1.8.7'), false)
assert.equal(isNewerVersion('1.8.8-beta.1', '1.8.7'), true)
assert.equal(isNewerVersion('1.8.8', '1.8.8-beta.998'), true)

// Android 安装顺序必须严格单调：beta.N < stable < 下一 core beta.1。
const beta1 = androidVersionCode('1.8.7-beta.1')!
const beta2 = androidVersionCode('1.8.7-beta.2')!
const stable = androidVersionCode('1.8.7')!
const nextBeta = androidVersionCode('1.8.8-beta.1')!
assert.ok(beta1 < beta2)
assert.ok(beta2 < stable)
assert.ok(stable < nextBeta)
assert.equal(beta1, androidVersionCodeForRelease('1.8.7-beta.1'))
assert.equal(stable, androidVersionCodeForRelease('1.8.7'))

assert.deepEqual(parseReleaseVersion('v1.8.7-beta.3'), {
  version: '1.8.7-beta.3',
  major: 1,
  minor: 8,
  patch: 7,
  beta: 3,
  track: 'beta',
  branch: 'beta',
})
assert.equal(releaseContract('1.8.7')?.branch, 'main')
assert.equal(releaseContract('1.8.7')?.track, 'stable')
assert.equal(releaseContract('1.8.7-beta.1')?.branch, 'beta')
assert.ok(compareReleaseVersions('1.8.7', '1.8.7-beta.998') > 0)
assert.ok(compareReleaseVersions('1.8.8-beta.1', '1.8.7') > 0)

console.log('✓ semver / release contract ok')

console.log('--- app-update asset / gate ---')

assert.equal(
  buildApkFileName('1.8.7-beta.2', 'cloud'),
  'newsnook-1.8.7-beta.2-cloud-release.apk',
)
assert.equal(buildApkFileName('1.8.7', 'local'), 'newsnook-1.8.7-local-release.apk')
assert.equal(
  buildApkFileName('1.8.7', 'local', 'arm64-v8a'),
  'newsnook-1.8.7-local-arm64-v8a-release.apk',
)
assert.deepEqual(normalizeSupportedAbis(['arm64-v8a', 'unknown', 'x86_64', 'arm64-v8a']), [
  'arm64-v8a',
  'x86_64',
])
assert.equal(selectPreferredAbi(['x86_64', 'arm64-v8a'], ['arm64-v8a', 'x86_64']), 'x86_64')
assert.equal(selectPreferredAbi(['armeabi-v7a'], ['arm64-v8a']), undefined)

const assets = [
  {
    name: 'newsnook-1.8.7-beta.2-cloud-release.apk',
    browser_download_url: 'https://github.com/x/cloud.apk',
  },
  {
    name: 'newsnook-1.8.7-beta.2-local-release.apk',
    browser_download_url: 'https://github.com/x/local.apk',
  },
]
assert.equal(pickReleaseAsset(assets, '1.8.7-beta.2', 'local')?.fileName, assets[1]!.name)
assert.equal(pickReleaseAsset([], '1.8.7-beta.2', 'cloud'), null)

const githubHash = 'a'.repeat(64)
assert.deepEqual(
  pickReleaseAsset(
    [
      {
        name: 'newsnook-1.8.7-cloud-release.apk',
        browser_download_url: 'https://github.com/x/cloud.apk',
        digest: `sha256:${githubHash}`,
        size: 1234,
      },
    ],
    '1.8.7',
    'cloud',
  ),
  {
    url: 'https://github.com/x/cloud.apk',
    fileName: 'newsnook-1.8.7-cloud-release.apk',
    sha256: githubHash,
    size: 1234,
  },
)

assert.equal(releaseTagUrl('1.8.7-beta.2'), 'https://github.com/t59688/newsnook/releases/tag/v1.8.7-beta.2')
const notes = truncateReleaseNotes('a\nb\nc\nd\ne\nf\ng\nh\ni\nj')
assert.equal(notes.split('\n').length, 9)
assert.ok(notes.endsWith('…'))

assert.equal(SNOOZE_MS, 2 * 60 * 60 * 1000)
assert.equal(RESUME_CHECK_INTERVAL_MS, 15 * 60 * 1000)

const now = 1_000_000
assert.equal(shouldFetchForAutoCheck({ prefs: {}, now, downloading: false }), true)
assert.equal(
  shouldFetchForAutoCheck({
    prefs: { lastCheckAt: now - 1000 },
    now,
    downloading: false,
    isColdStart: true,
  }),
  true,
)
assert.equal(
  shouldFetchForAutoCheck({
    prefs: { lastCheckAt: now - 1000 },
    now,
    downloading: false,
    isColdStart: false,
  }),
  false,
)
assert.equal(
  shouldFetchForAutoCheck({
    prefs: { lastCheckAt: now - RESUME_CHECK_INTERVAL_MS - 1 },
    now,
    downloading: false,
    isColdStart: false,
  }),
  true,
)
assert.equal(shouldFetchForAutoCheck({ prefs: {}, now, downloading: true }), false)

assert.equal(
  shouldAutoPrompt({ remoteVersion: '1.8.7-beta.2', prefs: {}, now, downloading: false }),
  true,
)
assert.equal(
  shouldAutoPrompt({
    remoteVersion: '1.8.7-beta.2',
    prefs: { skippedVersion: '1.8.7-beta.2' },
    now,
    downloading: false,
  }),
  false,
)
assert.equal(
  shouldShowUpdateBadge({
    remoteVersion: '1.8.7',
    prefs: { skippedVersion: '1.8.7' },
  }),
  false,
)

const updateDialogSource = readFileSync(new URL('../src/features/appUpdate/UpdateDialog.tsx', import.meta.url), 'utf8')
const updateHookSource = readFileSync(new URL('../src/features/appUpdate/useAppUpdate.ts', import.meta.url), 'utf8')
assert.match(updateDialogSource, /allowPermanentSkip/)
assert.match(updateDialogSource, /不再提醒此版本/)
assert.match(updateHookSource, /dialogOrigin !== 'manual'/)
assert.match(updateHookSource, /origin: 'auto'/)
assert.match(updateHookSource, /origin: 'manual'/)
assert.match(updateHookSource, /resolveSupportedAbis\(target\)/)
assert.match(updateHookSource, /fetchReleaseApkForFlavor\(__APP_VERSION__, target, supportedAbis\)/)
const notifierSource = readFileSync(new URL('../android/app/src/main/java/com/aizeek/newsnook/AppUpdateDownloadNotifier.java', import.meta.url), 'utf8')
assert.match(notifierSource, /void assembling\(\)/)
assert.match(notifierSource, /正在校验并合成安装包/)

console.log('✓ asset / gate ok')

console.log('--- app-update R2 channel manifests ---')

assert.equal(
  manifestUrl('stable'),
  'https://news-update.aizeek.com/newsnook/stable/latest.json',
)
assert.equal(manifestUrl('beta'), 'https://news-update.aizeek.com/newsnook/beta/latest.json')

const cdnHash = 'b'.repeat(64)
const sourceHash = 'a'.repeat(64)
const patchHash = 'c'.repeat(64)
const patchName = deltaFileName(sourceHash, cdnHash)
const stableDelta = {
  algorithm: 'gdiff-gzip-v1',
  fromSha256: sourceHash,
  fileName: patchName,
  url: `https://news-update.aizeek.com/newsnook/stable/deltas/${patchName}`,
  sha256: patchHash,
  size: 58,
}
assert.equal(patchName, `delta-${sourceHash}-${cdnHash}.gdiff.gz`)
assert.deepEqual(selectHistory([
  { tag_name: 'v1.8.7-beta.1', prerelease: true },
  { tag_name: 'v1.8.7-beta.3', prerelease: true },
  { tag_name: 'v1.8.7-beta.2', prerelease: true },
  { tag_name: 'v1.8.7', prerelease: false },
], '1.8.7-beta.4', 'beta', 2).map((x) => x.tag_name), [
  'v1.8.7-beta.3', 'v1.8.7-beta.2',
])
const stableManifest = parseUpdateManifest(
  {
    schemaVersion: 2,
    track: 'stable',
    version: '1.8.7',
    versionCode: androidVersionCode('1.8.7'),
    tagName: 'v1.8.7',
    publishedAt: '2026-09-19T00:00:00Z',
    notes: 'stable notes',
    packages: {
      cloud: {
        fileName: 'newsnook-1.8.7-cloud-release.apk',
        url: 'https://news-update.aizeek.com/newsnook/stable/newsnook-1.8.7-cloud-release.apk',
        sha256: cdnHash,
        size: 123,
        deltas: [stableDelta],
      },
      local: {
        fileName: 'newsnook-1.8.7-local-release.apk',
        url: 'https://news-update.aizeek.com/newsnook/stable/newsnook-1.8.7-local-release.apk',
        sha256: cdnHash,
        size: 456,
        deltas: [stableDelta],
        abis: {
          'arm64-v8a': {
            fileName: 'newsnook-1.8.7-local-arm64-v8a-release.apk',
            url: 'https://news-update.aizeek.com/newsnook/stable/newsnook-1.8.7-local-arm64-v8a-release.apk',
            sha256: cdnHash,
            size: 222,
            deltas: [stableDelta],
          },
          x86_64: {
            fileName: 'newsnook-1.8.7-local-x86_64-release.apk',
            url: 'https://news-update.aizeek.com/newsnook/stable/newsnook-1.8.7-local-x86_64-release.apk',
            sha256: cdnHash,
            size: 111,
          },
        },
      },
    },
  },
  'stable',
)
assert.ok(stableManifest)
if (stableManifest) {
  assert.equal(releaseFromUpdateManifest(stableManifest, 'cloud').deltas?.[0]?.sha256, patchHash)
  assert.equal(releaseFromUpdateManifest(stableManifest, 'local', ['arm64-v8a']).deltas?.[0]?.sha256, patchHash)
  const release = releaseFromUpdateManifest(stableManifest, 'local')
  assert.equal(release.apkFileName, 'newsnook-1.8.7-local-release.apk')
  const arm64Release = releaseFromUpdateManifest(stableManifest, 'local', ['arm64-v8a'])
  assert.equal(arm64Release.apkFileName, 'newsnook-1.8.7-local-arm64-v8a-release.apk')
  assert.equal(arm64Release.abi, 'arm64-v8a')
  const preferredX64 = releaseFromUpdateManifest(stableManifest, 'local', ['x86_64', 'arm64-v8a'])
  assert.equal(preferredX64.apkFileName, 'newsnook-1.8.7-local-x86_64-release.apk')
  const fallbackUniversal = releaseFromUpdateManifest(stableManifest, 'local', ['x86'])
  assert.equal(fallbackUniversal.apkFileName, 'newsnook-1.8.7-local-release.apk')
  assert.equal(fallbackUniversal.abi, undefined)
  assert.equal(release.flavor, 'local')
  assert.equal(release.track, 'stable')
  assert.equal(release.subscriptionTrack, 'stable')
  assert.equal(updateCheckFromManifest(stableManifest, '1.8.6', 'cloud').status, 'available')
  assert.equal(updateCheckFromManifest(stableManifest, '1.8.7-beta.4', 'cloud').status, 'available')
  const malformed = (deltas: unknown) => parseUpdateManifest({
    ...stableManifest,
    packages: {
      ...stableManifest.packages,
      cloud: { ...stableManifest.packages.cloud, deltas },
    },
  }, 'stable')
  assert.equal(malformed([{ ...stableDelta, url: `https://example.com/${patchName}` }]), null)
  assert.equal(malformed([{ ...stableDelta, url: stableDelta.url.replace('/stable/', '/beta/') }]), null)
  assert.equal(malformed([{ ...stableDelta, fileName: '../escape.gdiff.gz' }]), null)
  assert.equal(malformed([{ ...stableDelta, algorithm: 'unsupported' }]), null)
  assert.equal(malformed([{ ...stableDelta, fromSha256: cdnHash }]), null)
  assert.equal(malformed([{ ...stableDelta, sha256: 'invalid' }]), null)
  assert.equal(malformed([stableDelta, stableDelta]), null)
  assert.equal(malformed(new Array(17).fill(stableDelta)), null)
  assert.equal(malformed(undefined)?.packages.cloud.deltas, undefined)
}

const betaManifest = parseUpdateManifest(
  {
    schemaVersion: 2,
    track: 'beta',
    version: '1.8.8-beta.2',
    versionCode: androidVersionCode('1.8.8-beta.2'),
    tagName: 'v1.8.8-beta.2',
    notes: 'beta notes',
    packages: {
      cloud: {
        fileName: 'newsnook-1.8.8-beta.2-cloud-release.apk',
        url: 'https://news-update.aizeek.com/newsnook/beta/newsnook-1.8.8-beta.2-cloud-release.apk',
        sha256: cdnHash,
        size: 123,
      },
      local: {
        fileName: 'newsnook-1.8.8-beta.2-local-release.apk',
        url: 'https://news-update.aizeek.com/newsnook/beta/newsnook-1.8.8-beta.2-local-release.apk',
        sha256: cdnHash,
        size: 456,
      },
    },
  },
  'beta',
)
assert.ok(betaManifest)
assert.equal(parseUpdateManifest(betaManifest, 'stable'), null)
assert.equal(
  parseUpdateManifest(
    {
      ...(stableManifest ?? {}),
      versionCode: androidVersionCode('1.8.7-beta.1'),
    },
    'stable',
  ),
  null,
  'manifest versionCode 必须与 version 严格一致',
)

// manifest track 与版本/URL 必须一致，防止 beta 清单误指向 stable 或反之。
assert.equal(
  parseUpdateManifest(
    {
      ...betaManifest,
      track: 'stable',
    },
    'stable',
  ),
  null,
)

console.log('✓ R2 channel manifests ok')

console.log('--- app-update flavor switch / GitHub release semantics ---')

assert.equal(resolveOppositeFlavor('cloud'), 'local')
assert.equal(resolveOppositeFlavor('local'), 'cloud')

const stablePayload = {
  tag_name: 'v1.8.7',
  body: 'x',
  prerelease: false,
  draft: false,
  assets: [
    {
      name: 'newsnook-1.8.7-cloud-release.apk',
      browser_download_url: 'https://example.com/cloud.apk',
    },
  ],
}
const noLocal = releaseApkFromTagPayload(stablePayload, '1.8.7', 'local')
assert.equal(noLocal.status, 'no-asset')
if (noLocal.status === 'no-asset') {
  assert.equal(noLocal.flavor, 'local')
  assert.equal(noLocal.track, 'stable')
}

const localPayload = {
  ...stablePayload,
  assets: [
    ...stablePayload.assets,
    {
      name: 'newsnook-1.8.7-local-release.apk',
      browser_download_url: 'https://example.com/local-universal.apk',
    },
    {
      name: 'newsnook-1.8.7-local-arm64-v8a-release.apk',
      browser_download_url: 'https://example.com/local-arm64.apk',
    },
  ],
}
const localArm64 = releaseApkFromTagPayload(localPayload, '1.8.7', 'local', ['arm64-v8a'])
assert.equal(localArm64.status, 'ok')
if (localArm64.status === 'ok') {
  assert.equal(localArm64.release.apkFileName, 'newsnook-1.8.7-local-arm64-v8a-release.apk')
  assert.equal(localArm64.release.abi, 'arm64-v8a')
}
const localFallback = releaseApkFromTagPayload(localPayload, '1.8.7', 'local', ['x86_64'])
assert.equal(localFallback.status, 'ok')
if (localFallback.status === 'ok') {
  assert.equal(localFallback.release.apkFileName, 'newsnook-1.8.7-local-release.apk')
  assert.equal(localFallback.release.abi, undefined)
}
const localBrokenAbiAsset = releaseApkFromTagPayload(
  {
    ...localPayload,
    assets: localPayload.assets.map((asset) =>
      asset.name === 'newsnook-1.8.7-local-arm64-v8a-release.apk'
        ? { ...asset, browser_download_url: '' }
        : asset,
    ),
  },
  '1.8.7',
  'local',
  ['arm64-v8a'],
)
assert.equal(localBrokenAbiAsset.status, 'ok')
if (localBrokenAbiAsset.status === 'ok') {
  assert.equal(localBrokenAbiAsset.release.apkFileName, 'newsnook-1.8.7-local-release.apk')
  assert.equal(localBrokenAbiAsset.release.abi, undefined)
}

const cloud = releaseApkFromTagPayload(stablePayload, '1.8.7', 'cloud')
assert.equal(cloud.status, 'ok')
if (cloud.status === 'ok') {
  assert.equal(cloud.release.flavor, 'cloud')
  assert.equal(cloud.release.track, 'stable')
  assert.equal(cloud.release.subscriptionTrack, 'stable')
}

const betaPayload = {
  tag_name: 'v1.8.8-beta.1',
  body: 'beta',
  prerelease: true,
  draft: false,
  assets: [
    {
      name: 'newsnook-1.8.8-beta.1-cloud-release.apk',
      browser_download_url: 'https://example.com/beta.apk',
    },
  ],
}
const beta = releaseApkFromTagPayload(betaPayload, '1.8.8-beta.1', 'cloud')
assert.equal(beta.status, 'ok')
if (beta.status === 'ok') {
  assert.equal(beta.release.track, 'beta')
  assert.equal(beta.release.subscriptionTrack, 'beta')
}

// beta tag 不能伪装成正式 Release，stable tag 也不能标成 prerelease。
assert.equal(
  releaseApkFromTagPayload({ ...betaPayload, prerelease: false }, '1.8.8-beta.1', 'cloud').status,
  'error',
)
assert.equal(
  releaseApkFromTagPayload({ ...stablePayload, prerelease: true }, '1.8.7', 'cloud').status,
  'error',
)

console.log('✓ flavor / GitHub release semantics ok')

console.log('--- update subscription eligibility / prefs migration ---')

const stableAvailable = {
  status: 'available' as const,
  localVersion: '1.8.7-beta.3',
  release: {
    version: '1.8.7',
    tagName: 'v1.8.7',
    notes: '',
    apkUrl: 'https://example.com/stable.apk',
    apkFileName: 'newsnook-1.8.7-cloud-release.apk',
    flavor: 'cloud' as const,
    track: 'stable' as const,
    subscriptionTrack: 'stable' as const,
  },
}
const newerBetaAvailable = {
  status: 'available' as const,
  localVersion: '1.8.7',
  release: {
    version: '1.8.8-beta.1',
    tagName: 'v1.8.8-beta.1',
    notes: '',
    apkUrl: 'https://example.com/beta.apk',
    apkFileName: 'newsnook-1.8.8-beta.1-cloud-release.apk',
    flavor: 'cloud' as const,
    track: 'beta' as const,
    subscriptionTrack: 'beta' as const,
  },
}

const betaIgnoresStableFinal = selectEligibleUpdateResult('1.8.7-beta.3', 'beta', [
  stableAvailable,
  {
    status: 'up-to-date',
    localVersion: '1.8.7-beta.3',
    remoteVersion: '1.8.7-beta.3',
    track: 'beta',
  },
])
assert.equal(betaIgnoresStableFinal.status, 'up-to-date')
if (betaIgnoresStableFinal.status === 'up-to-date') {
  assert.equal(betaIgnoresStableFinal.remoteVersion, '1.8.7-beta.3')
  assert.equal(betaIgnoresStableFinal.track, 'beta')
}

const stableNeverGetsBeta = selectEligibleUpdateResult('1.8.7', 'stable', [
  {
    status: 'up-to-date',
    localVersion: '1.8.7',
    remoteVersion: '1.8.7',
    track: 'stable',
  },
  newerBetaAvailable,
])
assert.equal(stableNeverGetsBeta.status, 'up-to-date')
if (stableNeverGetsBeta.status === 'up-to-date') {
  assert.equal(stableNeverGetsBeta.remoteVersion, '1.8.7')
  assert.equal(stableNeverGetsBeta.track, 'stable')
}

const betaGetsNewerBeta = selectEligibleUpdateResult('1.8.7', 'beta', [
  {
    status: 'up-to-date',
    localVersion: '1.8.7',
    remoteVersion: '1.8.7',
    track: 'stable',
  },
  newerBetaAvailable,
])
assert.equal(betaGetsNewerBeta.status, 'available')
if (betaGetsNewerBeta.status === 'available') {
  assert.equal(betaGetsNewerBeta.release.version, '1.8.8-beta.1')
  assert.equal(betaGetsNewerBeta.release.track, 'beta')
  assert.equal(betaGetsNewerBeta.release.subscriptionTrack, 'beta')
}

const beta14SeesBeta15InsteadOfStable188 = selectEligibleUpdateResult('1.8.8-beta.14', 'beta', [
  {
    ...stableAvailable,
    localVersion: '1.8.8-beta.14',
    release: {
      ...stableAvailable.release,
      version: '1.8.8',
      tagName: 'v1.8.8',
    },
  },
  {
    ...newerBetaAvailable,
    localVersion: '1.8.8-beta.14',
    release: {
      ...newerBetaAvailable.release,
      version: '1.8.8-beta.15',
      tagName: 'v1.8.8-beta.15',
    },
  },
])
assert.equal(beta14SeesBeta15InsteadOfStable188.status, 'available')
if (beta14SeesBeta15InsteadOfStable188.status === 'available') {
  assert.equal(beta14SeesBeta15InsteadOfStable188.release.version, '1.8.8-beta.15')
  assert.equal(beta14SeesBeta15InsteadOfStable188.release.track, 'beta')
}

const betaDoesNotFallbackWhenBetaCheckFails = selectEligibleUpdateResult('1.8.6', 'beta', [
  {
    ...stableAvailable,
    localVersion: '1.8.6',
  },
  { status: 'error', message: 'beta CDN temporary failure' },
])
assert.equal(betaDoesNotFallbackWhenBetaCheckFails.status, 'error')

const betaDoesNotFallbackWhenBetaAssetMissing = selectEligibleUpdateResult('1.8.6', 'beta', [
  {
    ...stableAvailable,
    localVersion: '1.8.6',
    release: { ...stableAvailable.release, version: '1.8.7' },
  },
  {
    status: 'no-asset',
    localVersion: '1.8.6',
    remoteVersion: '1.8.8-beta.1',
    flavor: 'cloud',
    track: 'beta',
  },
])
assert.equal(betaDoesNotFallbackWhenBetaAssetMissing.status, 'no-asset')
if (betaDoesNotFallbackWhenBetaAssetMissing.status === 'no-asset') {
  assert.equal(betaDoesNotFallbackWhenBetaAssetMissing.remoteVersion, '1.8.8-beta.1')
  assert.equal(betaDoesNotFallbackWhenBetaAssetMissing.track, 'beta')
}

assert.deepEqual(normalizeAppUpdatePrefs(null), {
  track: 'stable',
  tracks: { stable: {}, beta: {} },
})
assert.deepEqual(
  normalizeAppUpdatePrefs({
    skippedVersion: '1.8.5',
    snoozeUntil: 123,
    lastCheckAt: 456,
    availableVersion: '1.8.6',
  }),
  {
    track: 'stable',
    tracks: {
      stable: {
        skippedVersion: '1.8.5',
        snoozeUntil: 123,
        lastCheckAt: 456,
        availableVersion: '1.8.6',
      },
      beta: {},
    },
  },
  '旧版扁平偏好必须迁移到 stable，不得让老用户自动加入 beta',
)
assert.deepEqual(
  normalizeAppUpdatePrefs({
    track: 'beta',
    tracks: {
      stable: { availableVersion: '1.8.7' },
      beta: { availableVersion: '1.8.8-beta.2' },
    },
  }),
  {
    track: 'beta',
    tracks: {
      stable: { availableVersion: '1.8.7' },
      beta: { availableVersion: '1.8.8-beta.2' },
    },
  },
)
assert.deepEqual(
  normalizeAppUpdatePrefs({
    track: 'beta',
    tracks: {
      stable: {
        skippedVersion: '1.8.9-beta.1',
        availableVersion: '1.8.9-beta.1',
      },
      beta: {
        skippedVersion: '1.8.8',
        availableVersion: '1.8.8',
      },
    },
  }),
  {
    track: 'beta',
    tracks: {
      stable: {},
      beta: {},
    },
  },
  '缓存的版本号必须属于对应更新通道，避免升级后继续显示旧的跨通道提示',
)

console.log('✓ strict channel isolation / prefs migration ok')

console.log('--- app-update download notification ---')

const appUpdatePluginSource = readFileSync(
  new URL('../android/app/src/main/java/com/aizeek/newsnook/AppUpdatePlugin.java', import.meta.url),
  'utf8',
)
const appUpdateNotifierSource = readFileSync(
  new URL(
    '../android/app/src/main/java/com/aizeek/newsnook/AppUpdateDownloadNotifier.java',
    import.meta.url,
  ),
  'utf8',
)
const androidManifestSource = readFileSync(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
)

assert.match(appUpdatePluginSource, /VISIBILITY_HIDDEN/)
assert.match(appUpdatePluginSource, /AppUpdateDownloadNotifier/)
assert.match(appUpdatePluginSource, /startProgressPolling/)
assert.match(appUpdatePluginSource, /ensureNotifier\(\)\.complete\(/)
assert.match(appUpdatePluginSource, /VISIBILITY_VISIBLE_NOTIFY_COMPLETED/)

assert.match(appUpdateNotifierSource, /TITLE_DOWNLOADING = "有所闻 · 正在下载更新"/)
assert.match(appUpdateNotifierSource, /TITLE_READY = "有所闻 · 更新已就绪"/)
assert.match(appUpdateNotifierSource, /setProgress/)
assert.match(appUpdateNotifierSource, /formatBytes/)

assert.match(androidManifestSource, /android\.permission\.DOWNLOAD_WITHOUT_NOTIFICATION/)

console.log('✓ download notification contract ok')
