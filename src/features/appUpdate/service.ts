import { Capacitor } from '@capacitor/core'

import { isLocalTranslationAvailable } from '../translation/native'
import { normalizeSupportedAbis } from './abi'
import { shouldAutoPrompt, shouldFetchForAutoCheck } from './gate'
import { fetchLatestRelease, refreshReleaseForDownload } from './github'
import { androidVersionCode, compareSemver, isNewerVersion } from './semver'
import { AppUpdateNative } from './native'
import {
  getUpdateTrackPrefs,
  loadAppUpdatePrefsNormalized,
  saveAvailableVersion,
  touchLastCheck,
} from './prefs'
import type {
  AndroidAbi,
  LatestReleaseInfo,
  PackageFlavor,
  UpdateCheckResult,
  UpdateTrack,
} from './types'

export type AppUpdateUiState = {
  downloading: boolean
  downloadMessage?: string
  lastManualMessage?: string
}

export type AutoCheckOutcome = {
  result: UpdateCheckResult
  shouldPrompt: boolean
  subscriptionTrack: UpdateTrack
}

type BeginUpdateResult =
  | { downloadId: number }
  | { needInstallPermission: true }
  | { error: string }

let activeDownloadId: number | null = null
let pendingStart: Promise<BeginUpdateResult> | null = null
let uiState: AppUpdateUiState = { downloading: false }
const uiListeners = new Set<(state: AppUpdateUiState) => void>()
let nativeListenersBound = false

function setUi(patch: Partial<AppUpdateUiState>): void {
  uiState = { ...uiState, ...patch }
  for (const listener of uiListeners) listener(uiState)
}

export function subscribeAppUpdateUi(listener: (state: AppUpdateUiState) => void): () => void {
  uiListeners.add(listener)
  listener(uiState)
  return () => {
    uiListeners.delete(listener)
  }
}

export function getAppUpdateUiState(): AppUpdateUiState {
  return uiState
}

export function isAppUpdateSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('AppUpdate')
}

export function resolvePackageFlavor(): PackageFlavor {
  return isLocalTranslationAvailable() ? 'local' : 'cloud'
}

export function resolveOppositeFlavor(
  flavor: PackageFlavor = resolvePackageFlavor(),
): PackageFlavor {
  return flavor === 'local' ? 'cloud' : 'local'
}

export function resolveUpdateTrack(): UpdateTrack {
  return loadAppUpdatePrefsNormalized().track
}

export function getActiveDownloadId(): number | null {
  return activeDownloadId
}

async function ensureNativeListeners(): Promise<void> {
  if (nativeListenersBound || !isAppUpdateSupported()) return
  nativeListenersBound = true
  await AppUpdateNative.addListener('downloadComplete', ({ downloadId }) => {
    if (activeDownloadId !== downloadId) return
    activeDownloadId = null
    setUi({ downloading: false, downloadMessage: undefined, lastManualMessage: undefined })
  })
  await AppUpdateNative.addListener('downloadRedirected', ({ fromDownloadId, toDownloadId, message }) => {
    if (activeDownloadId !== fromDownloadId) return
    activeDownloadId = toDownloadId
    setUi({
      downloading: true,
      downloadMessage: message
        ? `增量更新未完成，已切换全量下载：${message}`
        : '增量更新未完成，已切换全量下载',
      lastManualMessage: undefined,
    })
  })
  await AppUpdateNative.addListener('downloadFailed', ({ downloadId, message, kind }) => {
    if (activeDownloadId !== downloadId) return
    activeDownloadId = null
    const fallback =
      kind === 'install' ? '安装失败，可稍后在关于页重试' : '下载失败，点按重试'
    setUi({
      downloading: false,
      downloadMessage: undefined,
      lastManualMessage: message || fallback,
    })
  })
}

/**
 * 更新通道严格隔离：Stable 只消费 Stable，Beta 只消费 Beta。
 * 即使调用方误传了另一通道的结果，也必须在这里丢弃，避免跨通道更新。
 */
export function selectEligibleUpdateResult(
  localVersion: string,
  subscriptionTrack: UpdateTrack,
  results: UpdateCheckResult[],
): UpdateCheckResult {
  const eligibleResults = results.filter((result) => {
    if (result.status === 'error') return false
    const sourceTrack = result.status === 'available' ? result.release.track : result.track
    return sourceTrack === subscriptionTrack
  })

  const available = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'available' }> =>
      result.status === 'available',
    )
    .sort((a, b) => compareSemver(b.release.version, a.release.version))

  if (available.length > 0) {
    const best = available[0]!
    return {
      ...best,
      release: { ...best.release, subscriptionTrack },
    }
  }

  const noAsset = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'no-asset' }> =>
      result.status === 'no-asset' && isNewerVersion(result.remoteVersion, localVersion),
    )
    .sort((a, b) => compareSemver(b.remoteVersion, a.remoteVersion))
  if (noAsset.length > 0) return noAsset[0]!

  const upToDate = eligibleResults
    .filter((result): result is Extract<UpdateCheckResult, { status: 'up-to-date' }> =>
      result.status === 'up-to-date',
    )
    .sort((a, b) => compareSemver(b.remoteVersion, a.remoteVersion))
  if (upToDate.length > 0) return upToDate[0]!

  const errors = results.filter(
    (result): result is Extract<UpdateCheckResult, { status: 'error' }> => result.status === 'error',
  )
  return {
    status: 'error',
    message:
      errors.map((result) => result.message).filter(Boolean).join('；') ||
      '更新源通道与当前订阅不匹配',
  }
}

export async function resolveSupportedAbis(
  flavor: PackageFlavor,
): Promise<AndroidAbi[]> {
  if (flavor !== 'local') return []
  try {
    return normalizeSupportedAbis((await AppUpdateNative.getSupportedAbis()).abis)
  } catch {
    // 旧原生壳或异常设备安全回退 universal local APK。
    return []
  }
}

async function fetchEligibleUpdate(
  localVersion: string,
  flavor: PackageFlavor,
  subscriptionTrack: UpdateTrack,
): Promise<UpdateCheckResult> {
  const supportedAbis = await resolveSupportedAbis(flavor)
  const result = await fetchLatestRelease(localVersion, flavor, subscriptionTrack, supportedAbis)
  return selectEligibleUpdateResult(localVersion, subscriptionTrack, [result])
}

export async function checkForUpdate(
  track: UpdateTrack = resolveUpdateTrack(),
): Promise<UpdateCheckResult> {
  if (!isAppUpdateSupported()) {
    return { status: 'error', message: '当前平台不支持应用内更新' }
  }
  await ensureNativeListeners()
  const result = await fetchEligibleUpdate(__APP_VERSION__, resolvePackageFlavor(), track)
  if (result.status !== 'error') {
    touchLastCheck(Date.now(), track)
    if (result.status === 'available') {
      saveAvailableVersion(result.release.version, track)
    } else if (result.status === 'up-to-date') {
      saveAvailableVersion(undefined, track)
    }
  }
  return result
}

export async function checkForAutoUpdate(options?: {
  isColdStart?: boolean
}): Promise<AutoCheckOutcome | null> {
  if (!isAppUpdateSupported()) return null
  if (activeDownloadId != null || pendingStart != null) return null

  const prefs = loadAppUpdatePrefsNormalized()
  const trackPrefs = getUpdateTrackPrefs(prefs)
  if (
    !shouldFetchForAutoCheck({
      prefs: trackPrefs,
      now: Date.now(),
      downloading: false,
      isColdStart: options?.isColdStart,
    })
  ) {
    return null
  }

  const result = await checkForUpdate(prefs.track)
  if (result.status !== 'available') {
    return { result, shouldPrompt: false, subscriptionTrack: prefs.track }
  }

  const refreshed = loadAppUpdatePrefsNormalized()
  const shouldPrompt = shouldAutoPrompt({
    remoteVersion: result.release.version,
    prefs: getUpdateTrackPrefs(refreshed, prefs.track),
    now: Date.now(),
    downloading: false,
  })
  return { result, shouldPrompt, subscriptionTrack: prefs.track }
}

export function beginUpdate(release: LatestReleaseInfo): Promise<BeginUpdateResult> {
  // 包括权限检查和元数据补取阶段，连续点击只能启动一次原生下载。
  if (pendingStart) return pendingStart
  pendingStart = beginUpdateOnce(release).finally(() => { pendingStart = null })
  return pendingStart
}

async function beginUpdateOnce(release: LatestReleaseInfo): Promise<BeginUpdateResult> {
  if (!isAppUpdateSupported()) return { error: '当前平台不支持应用内更新' }
  await ensureNativeListeners()
  if (activeDownloadId != null) {
    setUi({ downloading: true })
    return { downloadId: activeDownloadId }
  }
  try {
    const { value } = await AppUpdateNative.canInstallPackages()
    if (!value) return { needInstallPermission: true }
    const downloadRelease = await refreshReleaseForDownload(release)
    const { downloadId } = await AppUpdateNative.startDownload({
      url: downloadRelease.apkUrl,
      fileName: release.apkFileName,
      sha256: release.sha256,
      size: release.size,
      versionCode: androidVersionCode(release.version) ?? undefined,
      ...(downloadRelease.sha256 && downloadRelease.deltas?.length
        ? { deltas: downloadRelease.deltas } : {}),
    })
    activeDownloadId = downloadId
    setUi({ downloading: true, downloadMessage: undefined, lastManualMessage: undefined })
    return { downloadId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : '开始下载失败' }
  }
}

export async function continueUpdateAfterPermission(
  release: LatestReleaseInfo,
): Promise<BeginUpdateResult> {
  if (!isAppUpdateSupported()) return { error: '当前平台不支持应用内更新' }
  try {
    const { value } = await AppUpdateNative.canInstallPackages()
    if (!value) {
      return { error: '仍未允许安装未知应用，无法继续更新' }
    }
    return beginUpdate(release)
  } catch (error) {
    return { error: error instanceof Error ? error.message : '权限检查失败' }
  }
}

export async function openInstallSettings(): Promise<void> {
  if (!isAppUpdateSupported()) return
  await AppUpdateNative.openInstallSettings()
}

export function setManualMessage(message: string | undefined): void {
  setUi({ lastManualMessage: message })
}
