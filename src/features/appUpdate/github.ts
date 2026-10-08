import { CapacitorHttp } from '@capacitor/core'

import { selectPreferredAbi } from './abi'
import {
  fetchUpdateManifest,
  releaseFromUpdateManifest,
  updateCheckFromManifest,
} from './cdn'
import {
  isNewerVersion,
  isValidVersion,
  normalizeTagVersion,
  releaseTrackForVersion,
} from './semver'
import type {
  AndroidAbi,
  FetchReleaseApkResult,
  LatestReleaseInfo,
  PackageFlavor,
  ReleaseNotesResult,
  UpdateCheckResult,
  UpdateTrack,
} from './types'

export function buildApkFileName(
  version: string,
  flavor: PackageFlavor,
  abi?: AndroidAbi,
): string {
  return `newsnook-${version}-${flavor}${abi ? `-${abi}` : ''}-release.apk`
}

type GitHubAsset = {
  name: string
  browser_download_url: string
  digest?: string | null
  size?: number
}

type GitHubRelease = {
  tag_name?: unknown
  body?: unknown
  prerelease?: unknown
  draft?: unknown
  assets?: GitHubAsset[]
}

type PickedReleaseAsset = {
  url: string
  fileName: string
  sha256?: string
  size?: number
}

function githubSha256(digest: string | null | undefined): string | undefined {
  if (!digest) return undefined
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim())
  return match?.[1]?.toLowerCase()
}

export function pickReleaseAsset(
  assets: GitHubAsset[],
  version: string,
  flavor: PackageFlavor,
  abi?: AndroidAbi,
): PickedReleaseAsset | null {
  const fileName = buildApkFileName(version, flavor, abi)
  const hit = assets.find((a) => a.name === fileName)
  if (!hit?.browser_download_url) return null

  const picked: PickedReleaseAsset = { url: hit.browser_download_url, fileName }
  const sha256 = githubSha256(hit.digest)
  if (sha256) picked.sha256 = sha256
  if (typeof hit.size === 'number' && Number.isSafeInteger(hit.size) && hit.size > 0) {
    picked.size = hit.size
  }
  return picked
}

export function truncateReleaseNotes(body: string | null | undefined, maxLines = 8): string {
  const text = (body ?? '').trim()
  if (!text) return ''
  const lines = text.split(/\r?\n/)
  if (lines.length <= maxLines) return text
  return `${lines.slice(0, maxLines).join('\n')}\n…`
}

const RELEASES_LATEST = 'https://api.github.com/repos/t59688/newsnook/releases/latest'
const RELEASES_LIST = 'https://api.github.com/repos/t59688/newsnook/releases?per_page=100'
const RELEASES_TAG_PREFIX = 'https://api.github.com/repos/t59688/newsnook/releases/tags/'

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'NewsNook-AppUpdate',
}

export function releaseTagUrl(version: string): string {
  const normalized = normalizeTagVersion(version)
  return `https://github.com/t59688/newsnook/releases/tag/v${normalized}`
}

async function fetchReleaseNotesFromGitHub(version: string): Promise<ReleaseNotesResult> {
  try {
    const response = await CapacitorHttp.get({
      url: `${RELEASES_TAG_PREFIX}v${encodeURIComponent(version)}`,
      headers: GITHUB_HEADERS,
    })
    if (response.status === 404) {
      return { status: 'error', message: '未找到该版本的发布说明' }
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const tagName = String(data.tag_name ?? `v${version}`)
    const body = typeof data.body === 'string' ? data.body.trim() : ''
    if (!body) return { status: 'empty', version, tagName }
    return { status: 'ok', version, tagName, body }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '加载更新日志失败',
    }
  }
}

/** 当前版本说明优先读取其所属发布通道的 R2 manifest，历史版本回退 GitHub tag。 */
export async function fetchReleaseNotes(version: string): Promise<ReleaseNotesResult> {
  const normalized = normalizeTagVersion(version)
  const track = releaseTrackForVersion(normalized)
  if (!track) return { status: 'error', message: '版本号无效' }

  const cdn = await fetchUpdateManifest(track)
  if (cdn.status === 'ok' && cdn.manifest.version === normalized) {
    const body = cdn.manifest.notes.trim()
    if (!body) {
      return { status: 'empty', version: normalized, tagName: cdn.manifest.tagName }
    }
    return { status: 'ok', version: normalized, tagName: cdn.manifest.tagName, body }
  }

  return fetchReleaseNotesFromGitHub(normalized)
}

function normalizeRelease(data: GitHubRelease): {
  version: string
  track: UpdateTrack
  prerelease: boolean
  assets: GitHubAsset[]
  body: string
  tagName: string
} | null {
  if (data.draft === true) return null
  const version = normalizeTagVersion(String(data.tag_name ?? ''))
  const track = releaseTrackForVersion(version)
  if (!track) return null

  const prerelease = data.prerelease === true
  if ((track === 'beta') !== prerelease) return null

  return {
    version,
    track,
    prerelease,
    assets: Array.isArray(data.assets) ? data.assets : [],
    body: typeof data.body === 'string' ? data.body : '',
    tagName: String(data.tag_name ?? `v${version}`),
  }
}

async function fetchLatestReleaseFromGitHub(
  localVersion: string,
  flavor: PackageFlavor,
  track: UpdateTrack,
  supportedAbis: readonly AndroidAbi[] = [],
): Promise<UpdateCheckResult> {
  try {
    const url = track === 'stable' ? RELEASES_LATEST : RELEASES_LIST
    const response = await CapacitorHttp.get({ url, headers: GITHUB_HEADERS })
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }

    const payload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    const candidates = (track === 'stable' ? [payload] : Array.isArray(payload) ? payload : [])
      .map((item) => normalizeRelease(item ?? {}))
      .filter((item): item is NonNullable<ReturnType<typeof normalizeRelease>> => item != null)
      .filter((item) => item.track === track)
      .sort((a, b) => {
        if (isNewerVersion(a.version, b.version)) return -1
        if (isNewerVersion(b.version, a.version)) return 1
        return 0
      })

    const release = candidates[0]
    if (!release) return { status: 'error', message: 'GitHub 未找到有效发布版本' }

    if (!isNewerVersion(release.version, localVersion)) {
      return {
        status: 'up-to-date',
        localVersion,
        remoteVersion: release.version,
        track,
      }
    }

    let abi: AndroidAbi | undefined
    if (flavor === 'local') {
      const available = supportedAbis.filter((candidate) =>
        release.assets.some(
          (asset) => asset.name === buildApkFileName(release.version, 'local', candidate),
        ),
      )
      abi = selectPreferredAbi(supportedAbis, available)
    }
    const picked =
      pickReleaseAsset(release.assets, release.version, flavor, abi) ??
      pickReleaseAsset(release.assets, release.version, flavor)
    const pickedAbi =
      abi && picked?.fileName === buildApkFileName(release.version, flavor, abi) ? abi : undefined
    if (!picked) {
      return {
        status: 'no-asset',
        localVersion,
        remoteVersion: release.version,
        flavor,
        track,
      }
    }

    return {
      status: 'available',
      localVersion,
      release: {
        version: release.version,
        tagName: release.tagName,
        notes: truncateReleaseNotes(release.body),
        apkUrl: picked.url,
        apkFileName: picked.fileName,
        ...(picked.sha256 ? { sha256: picked.sha256 } : {}),
        ...(picked.size ? { size: picked.size } : {}),
        flavor,
        ...(pickedAbi ? { abi: pickedAbi } : {}),
        track,
        subscriptionTrack: track,
      },
    }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '检查更新失败',
    }
  }
}

/** R2 是权威主源；主源不可用时按同一发布通道回退 GitHub。 */
export async function fetchLatestRelease(
  localVersion: string,
  flavor: PackageFlavor,
  track: UpdateTrack,
  supportedAbis: readonly AndroidAbi[] = [],
): Promise<UpdateCheckResult> {
  const cdn = await fetchUpdateManifest(track)
  if (cdn.status === 'ok') {
    return updateCheckFromManifest(cdn.manifest, localVersion, flavor, supportedAbis)
  }
  return fetchLatestReleaseFromGitHub(localVersion, flavor, track, supportedAbis)
}

/**
 * 检查时短暂回退 GitHub 不应永久丢失差分能力。下载前仅补取一次主源元数据，
 * 且必须仍是用户确认的同一份 APK；不能借机换版本、通道、变体或 ABI。
 */
export async function refreshReleaseForDownload(
  release: LatestReleaseInfo,
): Promise<LatestReleaseInfo> {
  if (release.deltas?.length || !release.sha256 || !release.size
    || release.subscriptionTrack !== release.track) return release

  const cdn = await fetchUpdateManifest(release.track, 5_000)
  if (cdn.status !== 'ok' || cdn.manifest.version !== release.version) return release
  const candidate = releaseFromUpdateManifest(
    cdn.manifest, release.flavor, release.abi ? [release.abi] : [],
  )
  if (!candidate.deltas?.length
    || candidate.abi !== release.abi
    || candidate.apkFileName !== release.apkFileName
    || candidate.sha256 !== release.sha256
    || candidate.size !== release.size) return release

  // 原生差分验证要求 full URL 与 patch URL 同属受信任 CDN 的同一通道。
  // 保留用户已确认的说明与版本，只更新相同字节目标的传输元数据。
  return { ...release, apkUrl: candidate.apkUrl, deltas: candidate.deltas }
}

/** 从 tag Release JSON 解析指定安装包（不发起网络请求）。 */
export function releaseApkFromTagPayload(
  data: GitHubRelease,
  version: string,
  flavor: PackageFlavor,
  supportedAbis: readonly AndroidAbi[] = [],
): FetchReleaseApkResult {
  const normalized = normalizeTagVersion(version)
  const track = releaseTrackForVersion(normalized)
  if (!track || !isValidVersion(normalized)) {
    return { status: 'error', message: '版本号无效' }
  }

  const release = normalizeRelease(data)
  if (!release || release.version !== normalized || release.track !== track) {
    return { status: 'error', message: 'Release 与请求版本不匹配' }
  }

  const assets = release.assets
    .map((a) => ({
      name: String(a.name ?? ''),
      browser_download_url: String(a.browser_download_url ?? ''),
      digest: typeof a.digest === 'string' ? a.digest : undefined,
      size: typeof a.size === 'number' ? a.size : undefined,
    }))
    .filter((a) => a.name && a.browser_download_url)

  let abi: AndroidAbi | undefined
  if (flavor === 'local') {
    const available = supportedAbis.filter((candidate) =>
      assets.some((asset) => asset.name === buildApkFileName(normalized, 'local', candidate)),
    )
    abi = selectPreferredAbi(supportedAbis, available)
  }
  const picked =
    pickReleaseAsset(assets, normalized, flavor, abi) ??
    pickReleaseAsset(assets, normalized, flavor)
  const pickedAbi = abi && picked?.fileName === buildApkFileName(normalized, flavor, abi) ? abi : undefined
  if (!picked) return { status: 'no-asset', version: normalized, flavor, track }

  return {
    status: 'ok',
    release: {
      version: normalized,
      tagName: release.tagName,
      notes: truncateReleaseNotes(release.body),
      apkUrl: picked.url,
      apkFileName: picked.fileName,
      ...(picked.sha256 ? { sha256: picked.sha256 } : {}),
      ...(picked.size ? { size: picked.size } : {}),
      flavor,
      ...(pickedAbi ? { abi: pickedAbi } : {}),
      track,
      subscriptionTrack: track,
    },
  }
}

async function fetchReleaseApkForFlavorFromGitHub(
  version: string,
  flavor: PackageFlavor,
  supportedAbis: readonly AndroidAbi[] = [],
): Promise<FetchReleaseApkResult> {
  try {
    const response = await CapacitorHttp.get({
      url: `${RELEASES_TAG_PREFIX}v${encodeURIComponent(version)}`,
      headers: GITHUB_HEADERS,
    })
    if (response.status === 404) {
      return { status: 'error', message: '未找到该版本的发布' }
    }
    if (response.status < 200 || response.status >= 300) {
      return { status: 'error', message: `GitHub HTTP ${response.status}` }
    }
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
    return releaseApkFromTagPayload(data ?? {}, version, flavor, supportedAbis)
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : '查找安装包失败',
    }
  }
}

/** 当前通道最新版本优先走 R2；R2 不保留历史，历史包切换回退 GitHub。 */
export async function fetchReleaseApkForFlavor(
  version: string,
  flavor: PackageFlavor,
  supportedAbis: readonly AndroidAbi[] = [],
): Promise<FetchReleaseApkResult> {
  const normalized = normalizeTagVersion(version)
  const track = releaseTrackForVersion(normalized)
  if (!track) return { status: 'error', message: '版本号无效' }

  const cdn = await fetchUpdateManifest(track)
  if (cdn.status === 'ok' && cdn.manifest.version === normalized) {
    return {
      status: 'ok',
      release: releaseFromUpdateManifest(cdn.manifest, flavor, supportedAbis),
    }
  }

  return fetchReleaseApkForFlavorFromGitHub(normalized, flavor, supportedAbis)
}
