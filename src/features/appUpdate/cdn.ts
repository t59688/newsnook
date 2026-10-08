import { CapacitorHttp } from '@capacitor/core'

import { ANDROID_ABIS, normalizeAndroidAbi, selectPreferredAbi } from './abi'
import {
  androidVersionCode,
  isNewerVersion,
  normalizeTagVersion,
  releaseTrackForVersion,
} from './semver'
import type {
  AndroidAbi,
  LatestReleaseInfo,
  PackageFlavor,
  UpdateCheckResult,
  UpdateTrack,
} from './types'

export const UPDATE_BASE_URL = 'https://news-update.aizeek.com'
const UPDATE_HOST = 'news-update.aizeek.com'
const SHA256_RE = /^[0-9a-f]{64}$/i

type ManifestAsset = {
  fileName: string
  url: string
  sha256: string
  size: number
}

type LocalManifestAsset = ManifestAsset & {
  abis?: Partial<Record<AndroidAbi, ManifestAsset>>
}

export type UpdateManifest = {
  schemaVersion: 2
  track: UpdateTrack
  version: string
  versionCode: number
  tagName: string
  publishedAt?: string
  notes: string
  packages: {
    cloud: ManifestAsset
    local: LocalManifestAsset
  }
}

export type FetchUpdateManifestResult =
  | { status: 'ok'; manifest: UpdateManifest }
  | { status: 'error'; message: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function expectedFileName(
  version: string,
  flavor: PackageFlavor,
  abi?: AndroidAbi,
): string {
  return `newsnook-${version}-${flavor}${abi ? `-${abi}` : ''}-release.apk`
}

function parseAsset(
  value: unknown,
  version: string,
  flavor: PackageFlavor,
  track: UpdateTrack,
  abi?: AndroidAbi,
): ManifestAsset | null {
  const record = asRecord(value)
  if (!record) return null

  const fileName = typeof record.fileName === 'string' ? record.fileName.trim() : ''
  const url = typeof record.url === 'string' ? record.url.trim() : ''
  const sha256 = typeof record.sha256 === 'string' ? record.sha256.trim().toLowerCase() : ''
  const size = record.size
  const expected = expectedFileName(version, flavor, abi)

  if (fileName !== expected || !SHA256_RE.test(sha256)) return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) return null

  try {
    const parsedUrl = new URL(url)
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname.toLowerCase() !== UPDATE_HOST) return null
    if (parsedUrl.pathname !== `/newsnook/${track}/${expected}`) return null
  } catch {
    return null
  }

  return { fileName, url, sha256, size }
}

function parseLocalAsset(
  value: unknown,
  version: string,
  track: UpdateTrack,
): LocalManifestAsset | null {
  const base = parseAsset(value, version, 'local', track)
  const record = asRecord(value)
  if (!base || !record) return null

  const rawAbis = record.abis
  if (rawAbis === undefined) return base

  const abiRecord = asRecord(rawAbis)
  if (!abiRecord) return null

  const abis: Partial<Record<AndroidAbi, ManifestAsset>> = {}
  for (const [key, rawAsset] of Object.entries(abiRecord)) {
    const abi = normalizeAndroidAbi(key)
    if (!abi) return null
    const asset = parseAsset(rawAsset, version, 'local', track, abi)
    if (!asset) return null
    abis[abi] = asset
  }
  return Object.keys(abis).length > 0 ? { ...base, abis } : base
}

export function manifestUrl(track: UpdateTrack): string {
  return `${UPDATE_BASE_URL}/newsnook/${track}/latest.json`
}

export function parseUpdateManifest(
  payload: unknown,
  expectedTrack?: UpdateTrack,
): UpdateManifest | null {
  const record = asRecord(payload)
  if (!record || record.schemaVersion !== 2) return null

  const track = record.track === 'beta' ? 'beta' : record.track === 'stable' ? 'stable' : null
  if (!track || (expectedTrack && track !== expectedTrack)) return null

  const version = normalizeTagVersion(typeof record.version === 'string' ? record.version : '')
  if (!version || releaseTrackForVersion(version) !== track) return null

  const versionCode = record.versionCode
  const expectedVersionCode = androidVersionCode(version)
  if (
    typeof versionCode !== 'number' ||
    !Number.isSafeInteger(versionCode) ||
    expectedVersionCode == null ||
    versionCode !== expectedVersionCode
  ) {
    return null
  }

  const tagName = typeof record.tagName === 'string' ? record.tagName.trim() : ''
  if (normalizeTagVersion(tagName) !== version) return null

  const packages = asRecord(record.packages)
  if (!packages) return null

  const cloud = parseAsset(packages.cloud, version, 'cloud', track)
  const local = parseLocalAsset(packages.local, version, track)
  if (!cloud || !local) return null

  const publishedAt = typeof record.publishedAt === 'string' ? record.publishedAt.trim() : ''
  const notes = typeof record.notes === 'string' ? record.notes.trim() : ''

  return {
    schemaVersion: 2,
    track,
    version,
    versionCode,
    tagName: tagName || `v${version}`,
    ...(publishedAt ? { publishedAt } : {}),
    notes,
    packages: { cloud, local },
  }
}

export function releaseFromUpdateManifest(
  manifest: UpdateManifest,
  flavor: PackageFlavor,
  supportedAbis: readonly AndroidAbi[] = [],
): LatestReleaseInfo {
  let asset: ManifestAsset = manifest.packages[flavor]
  let abi: AndroidAbi | undefined

  if (flavor === 'local') {
    const local = manifest.packages.local
    abi = selectPreferredAbi(supportedAbis, Object.keys(local.abis ?? {}) as AndroidAbi[])
    if (abi && local.abis?.[abi]) asset = local.abis[abi]!
  }

  return {
    version: manifest.version,
    tagName: manifest.tagName,
    notes: manifest.notes,
    apkUrl: asset.url,
    apkFileName: asset.fileName,
    sha256: asset.sha256,
    size: asset.size,
    flavor,
    ...(abi ? { abi } : {}),
    track: manifest.track,
    subscriptionTrack: manifest.track,
  }
}

export function updateCheckFromManifest(
  manifest: UpdateManifest,
  localVersion: string,
  flavor: PackageFlavor,
  supportedAbis: readonly AndroidAbi[] = [],
): UpdateCheckResult {
  if (!isNewerVersion(manifest.version, localVersion)) {
    return {
      status: 'up-to-date',
      localVersion,
      remoteVersion: manifest.version,
      track: manifest.track,
    }
  }
  return {
    status: 'available',
    localVersion,
    release: releaseFromUpdateManifest(manifest, flavor, supportedAbis),
  }
}

export async function fetchUpdateManifest(
  track: UpdateTrack,
): Promise<FetchUpdateManifestResult> {
  const url = manifestUrl(track)
  try {
    const response = await CapacitorHttp.get({
      url: `${url}?t=${Date.now()}`,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    })
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `更新源 HTTP ${response.status}` }
    }
    const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const manifest = parseUpdateManifest(payload, track)
    if (!manifest) return { status: 'error', message: '更新源数据格式无效' }
    return { status: 'ok', manifest }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '更新源连接失败',
    }
  }
}

// 导出 ABI 列表用于 CI/测试保持发布契约一致。
export { ANDROID_ABIS }
