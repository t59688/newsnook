import { App as CapacitorApp } from '@capacitor/app'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { shouldShowUpdateBadge } from './gate'
import {
  getUpdateTrackPrefs,
  loadAppUpdatePrefsNormalized,
  saveSkippedVersion,
  saveSnooze,
  saveUpdateTrack,
} from './prefs'
import { isNewerVersion } from './semver'
import { fetchReleaseApkForFlavor } from './github'
import {
  beginUpdate,
  checkForAutoUpdate,
  checkForUpdate,
  continueUpdateAfterPermission,
  getActiveDownloadId,
  getAppUpdateUiState,
  isAppUpdateSupported,
  openInstallSettings,
  resolveOppositeFlavor,
  resolvePackageFlavor,
  resolveSupportedAbis,
  setManualMessage,
  subscribeAppUpdateUi,
} from './service'
import type { LatestReleaseInfo, PackageFlavor, UpdateTrack } from './types'

export type ManualUpdateStatus = 'idle' | 'checking' | 'downloading' | 'latest' | 'error'

type Options = {
  settingsOpen: boolean
}

const AUTO_CHECK_DELAY_MS = 800
const RETRY_DELAYS_MS = [4000, 12000]
const SUPPRESS_AUTO_CHECK_MS = 2500

export function useAppUpdate({ settingsOpen }: Options) {
  const supported = isAppUpdateSupported()
  const initialPrefs = useMemo(() => loadAppUpdatePrefsNormalized(), [])
  const [updateTrack, setUpdateTrackState] = useState<UpdateTrack>(initialPrefs.track)
  const [trackPickerOpen, setTrackPickerOpen] = useState(false)
  const [betaConfirmOpen, setBetaConfirmOpen] = useState(false)
  const [dialogRelease, setDialogRelease] = useState<LatestReleaseInfo | null>(null)
  const [dialogOrigin, setDialogOrigin] = useState<'auto' | 'manual'>('auto')
  const [installPermissionOpen, setInstallPermissionOpen] = useState(false)
  const [pendingAfterPermission, setPendingAfterPermission] = useState<LatestReleaseInfo | null>(
    null,
  )
  const [manualStatus, setManualStatus] = useState<ManualUpdateStatus>('idle')
  const [manualHint, setManualHint] = useState<string | undefined>()
  const [downloading, setDownloading] = useState(() => getAppUpdateUiState().downloading)
  const [flavorConfirmOpen, setFlavorConfirmOpen] = useState(false)
  const [flavorErrorOpen, setFlavorErrorOpen] = useState(false)
  const [flavorErrorMessage, setFlavorErrorMessage] = useState('')
  const [flavorBusy, setFlavorBusy] = useState(false)
  const [flavorHint, setFlavorHint] = useState<string | undefined>()

  const currentFlavor: PackageFlavor = resolvePackageFlavor()
  const oppositeFlavor = resolveOppositeFlavor(currentFlavor)

  const [availableVersion, setAvailableVersion] = useState<string | undefined>(() => {
    const prefs = loadAppUpdatePrefsNormalized()
    const trackPrefs = getUpdateTrackPrefs(prefs)
    if (
      trackPrefs.availableVersion &&
      isNewerVersion(trackPrefs.availableVersion, __APP_VERSION__) &&
      shouldShowUpdateBadge({ remoteVersion: trackPrefs.availableVersion, prefs: trackPrefs })
    ) {
      return trackPrefs.availableVersion
    }
    return undefined
  })

  const pendingWhileSettings = useRef<LatestReleaseInfo | null>(null)
  const latestPromptRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const awaitingSettingsReturn = useRef(false)
  const suppressAutoCheckUntil = useRef(0)
  const settingsOpenRef = useRef(settingsOpen)
  const downloadingRef = useRef(downloading)
  const updateTrackRef = useRef(updateTrack)
  const checkGenerationRef = useRef(0)
  const showReleaseRef = useRef<(
    release: LatestReleaseInfo,
    options?: { force?: boolean; origin?: 'auto' | 'manual' },
  ) => void>(() => {})

  settingsOpenRef.current = settingsOpen
  downloadingRef.current = downloading
  updateTrackRef.current = updateTrack

  const hasUpdate = useMemo(() => {
    if (!supported || !availableVersion) return false
    if (!isNewerVersion(availableVersion, __APP_VERSION__)) return false
    const prefs = loadAppUpdatePrefsNormalized()
    const trackPrefs = getUpdateTrackPrefs(prefs, updateTrack)
    return shouldShowUpdateBadge({ remoteVersion: availableVersion, prefs: trackPrefs })
  }, [supported, availableVersion, updateTrack])

  useEffect(() => {
    if (!supported) return
    return subscribeAppUpdateUi((state) => {
      setDownloading(state.downloading)
      if (state.downloading) setManualStatus('downloading')
      if (state.lastManualMessage) {
        setManualStatus('error')
        setManualHint(state.lastManualMessage)
      }
    })
  }, [supported])

  const showRelease = useCallback(
    (release: LatestReleaseInfo, options?: { force?: boolean; origin?: 'auto' | 'manual' }) => {
      if (settingsOpen && !options?.force) {
        pendingWhileSettings.current = release
        return
      }
      setDialogOrigin(options?.origin ?? 'auto')
      setDialogRelease(release)
    },
    [settingsOpen],
  )
  showReleaseRef.current = showRelease

  useEffect(() => {
    if (!supported || settingsOpen) return
    const pending = pendingWhileSettings.current
    if (pending) {
      pendingWhileSettings.current = null
      setDialogOrigin('auto')
      setDialogRelease(pending)
    }
  }, [settingsOpen, supported])

  const runAutoCheck = useCallback(
    async (isColdStart = false): Promise<boolean> => {
      if (!supported) return false
      if (Date.now() < suppressAutoCheckUntil.current) return false
      if (downloadingRef.current || getActiveDownloadId() != null) return false
      if (awaitingSettingsReturn.current) return false
      try {
        const generation = ++checkGenerationRef.current
        const outcome = await checkForAutoUpdate({ isColdStart })
        if (!outcome) return false
        if (
          generation !== checkGenerationRef.current ||
          outcome.subscriptionTrack !== updateTrackRef.current
        ) {
          return false
        }
        const { result, shouldPrompt, subscriptionTrack } = outcome
        if (result.status === 'error') return false

        if (result.status === 'available') {
          const prefs = loadAppUpdatePrefsNormalized()
          const trackPrefs = getUpdateTrackPrefs(prefs, subscriptionTrack)
          if (shouldShowUpdateBadge({ remoteVersion: result.release.version, prefs: trackPrefs })) {
            setAvailableVersion(result.release.version)
          } else {
            setAvailableVersion(undefined)
          }
          if (shouldPrompt) showReleaseRef.current(result.release, { origin: 'auto' })
        } else if (result.status === 'up-to-date') {
          setAvailableVersion(undefined)
        }
        return true
      } catch {
        return false
      }
    },
    [supported],
  )

  useEffect(() => {
    if (!supported) return
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let retryIndex = 0
    let isSuccess = false

    const triggerColdStartCheck = async () => {
      if (isSuccess) return
      const ok = await runAutoCheck(true)
      if (ok) {
        isSuccess = true
        return
      }
      if (retryIndex < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[retryIndex]!
        retryIndex += 1
        retryTimer = window.setTimeout(() => {
          void triggerColdStartCheck()
        }, delay)
      }
    }

    const initialTimer = window.setTimeout(() => {
      void triggerColdStartCheck()
    }, AUTO_CHECK_DELAY_MS)

    const handleOnline = () => {
      if (!isSuccess) void triggerColdStartCheck()
    }
    window.addEventListener('online', handleOnline)

    return () => {
      window.clearTimeout(initialTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
      window.removeEventListener('online', handleOnline)
    }
  }, [supported, runAutoCheck])

  useEffect(() => {
    if (!supported) return
    let handle: { remove: () => Promise<void> } | undefined
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return

      if (awaitingSettingsReturn.current && pendingAfterPermission) {
        awaitingSettingsReturn.current = false
        suppressAutoCheckUntil.current = Date.now() + SUPPRESS_AUTO_CHECK_MS
        const release = pendingAfterPermission
        void continueUpdateAfterPermission(release).then((result) => {
          setPendingAfterPermission(null)
          if ('error' in result) {
            setManualStatus('error')
            setManualHint(result.error)
            setManualMessage(result.error)
            return
          }
          if ('needInstallPermission' in result && result.needInstallPermission) {
            setManualStatus('error')
            setManualHint('仍未允许安装未知应用，无法继续更新')
            return
          }
          setManualStatus('downloading')
          setDialogRelease(null)
        })
        return
      }

      if (!settingsOpenRef.current) void runAutoCheck(false)
    }).then((listener) => {
      handle = listener
    })
    return () => {
      void handle?.remove()
    }
  }, [supported, pendingAfterPermission, runAutoCheck])

  const closeDialog = useCallback(() => setDialogRelease(null), [])

  const onLater = useCallback(() => {
    if (dialogRelease) saveSnooze(Date.now(), dialogRelease.subscriptionTrack)
    closeDialog()
  }, [closeDialog, dialogRelease])

  const onSkip = useCallback(() => {
    // Permanent ignore is only valid after an explicit manual update check.
    // Cold-start prompts may be dismissed by accessibility/ad-skip automation;
    // that must never be interpreted as a durable user preference.
    if (dialogOrigin !== 'manual') {
      if (dialogRelease) saveSnooze(Date.now(), dialogRelease.subscriptionTrack)
      closeDialog()
      return
    }
    if (dialogRelease) {
      saveSkippedVersion(dialogRelease.version, dialogRelease.subscriptionTrack)
      setAvailableVersion(undefined)
    }
    closeDialog()
  }, [closeDialog, dialogOrigin, dialogRelease])

  const startDownload = useCallback(
    async (release: LatestReleaseInfo) => {
      const result = await beginUpdate(release)
      if ('needInstallPermission' in result && result.needInstallPermission) {
        setPendingAfterPermission(release)
        setInstallPermissionOpen(true)
        return
      }
      if ('error' in result) {
        setManualStatus('error')
        setManualHint(result.error)
        setManualMessage(result.error)
        return
      }
      setManualStatus('downloading')
      closeDialog()
    },
    [closeDialog],
  )

  const onUpdate = useCallback(() => {
    if (dialogRelease) void startDownload(dialogRelease)
  }, [dialogRelease, startDownload])

  const onConfirmInstallPermission = useCallback(() => {
    setInstallPermissionOpen(false)
    awaitingSettingsReturn.current = true
    suppressAutoCheckUntil.current = Date.now() + SUPPRESS_AUTO_CHECK_MS
    void openInstallSettings()
  }, [])

  const onCancelInstallPermission = useCallback(() => {
    setInstallPermissionOpen(false)
    setPendingAfterPermission(null)
    awaitingSettingsReturn.current = false
  }, [])

  const runManualCheck = useCallback(
    async (track: UpdateTrack) => {
      const generation = ++checkGenerationRef.current
      if (latestPromptRef.current) {
        window.clearTimeout(latestPromptRef.current)
        latestPromptRef.current = null
      }
      setManualStatus('checking')
      setManualHint(undefined)
      setManualMessage(undefined)
      const result = await checkForUpdate(track)
      if (generation !== checkGenerationRef.current || track !== updateTrackRef.current) return

      if (result.status === 'available') {
        setManualStatus('idle')
        setAvailableVersion(result.release.version)
        showRelease(result.release, { force: true, origin: 'manual' })
        return
      }
      if (result.status === 'up-to-date') {
        setAvailableVersion(undefined)
        setManualStatus('latest')
        if (latestPromptRef.current) window.clearTimeout(latestPromptRef.current)
        latestPromptRef.current = window.setTimeout(() => setManualStatus('idle'), 2500)
        return
      }
      if (result.status === 'no-asset') {
        setManualStatus('error')
        setManualHint('未找到适合当前安装包的更新文件')
        return
      }
      setManualStatus('error')
      setManualHint(result.message || '检查失败，点按重试')
    },
    [showRelease],
  )

  const promptManualCheck = useCallback(async () => {
    if (!supported) return
    if (downloading || getAppUpdateUiState().downloading || getActiveDownloadId() != null) {
      setManualStatus('downloading')
      setManualHint('下载进行中')
      return
    }
    await runManualCheck(updateTrackRef.current)
  }, [supported, downloading, runManualCheck])

  const onOpenTrackPicker = useCallback(() => {
    if (!supported) return
    if (downloading || getAppUpdateUiState().downloading || getActiveDownloadId() != null) {
      setManualStatus('downloading')
      setManualHint('更新下载进行中，完成后再切换更新通道')
      return
    }
    setTrackPickerOpen(true)
  }, [supported, downloading])

  const onCloseTrackPicker = useCallback(() => setTrackPickerOpen(false), [])

  const applyUpdateTrack = useCallback(
    (track: UpdateTrack) => {
      if (track === updateTrackRef.current) return

      ++checkGenerationRef.current
      if (latestPromptRef.current) {
        window.clearTimeout(latestPromptRef.current)
        latestPromptRef.current = null
      }
      saveUpdateTrack(track)
      updateTrackRef.current = track
      setUpdateTrackState(track)
      pendingWhileSettings.current = null
      setDialogRelease(null)
      setManualStatus('idle')
      setManualHint(undefined)

      const prefs = loadAppUpdatePrefsNormalized()
      const targetPrefs = getUpdateTrackPrefs(prefs, track)
      const cached =
        targetPrefs.availableVersion &&
        isNewerVersion(targetPrefs.availableVersion, __APP_VERSION__) &&
        shouldShowUpdateBadge({
          remoteVersion: targetPrefs.availableVersion,
          prefs: targetPrefs,
        })
          ? targetPrefs.availableVersion
          : undefined
      setAvailableVersion(cached)

      // 用户主动切换发布通道后立即检查；不等待下一次冷启动/前台恢复。
      void runManualCheck(track)
    },
    [runManualCheck],
  )

  const onChangeUpdateTrack = useCallback((track: UpdateTrack) => {
    setTrackPickerOpen(false)
    if (track === updateTrackRef.current) return
    if (track === 'beta') {
      setBetaConfirmOpen(true)
      return
    }
    applyUpdateTrack(track)
  }, [applyUpdateTrack])

  const onConfirmBetaTrack = useCallback(() => {
    setBetaConfirmOpen(false)
    applyUpdateTrack('beta')
  }, [applyUpdateTrack])

  const onCancelBetaTrack = useCallback(() => setBetaConfirmOpen(false), [])

  const onPromptFlavorSwitch = useCallback(() => {
    if (!supported) return
    if (downloading || getAppUpdateUiState().downloading || getActiveDownloadId() != null) {
      setFlavorErrorMessage('已有下载任务进行中，请稍后再试')
      setFlavorErrorOpen(true)
      return
    }
    setFlavorHint(undefined)
    setFlavorConfirmOpen(true)
  }, [supported, downloading])

  const onCancelFlavorSwitch = useCallback(() => setFlavorConfirmOpen(false), [])

  const onDismissFlavorError = useCallback(() => {
    setFlavorErrorOpen(false)
    setFlavorErrorMessage('')
  }, [])

  const onConfirmFlavorSwitch = useCallback(async () => {
    setFlavorConfirmOpen(false)
    if (!supported) return
    if (downloading || getAppUpdateUiState().downloading || getActiveDownloadId() != null) {
      setFlavorErrorMessage('已有下载任务进行中，请稍后再试')
      setFlavorErrorOpen(true)
      return
    }
    const target = resolveOppositeFlavor(resolvePackageFlavor())
    setFlavorBusy(true)
    setFlavorHint('正在查找安装包…')
    const supportedAbis = await resolveSupportedAbis(target)
    const result = await fetchReleaseApkForFlavor(__APP_VERSION__, target, supportedAbis)
    setFlavorBusy(false)
    if (result.status === 'no-asset') {
      setFlavorHint('当前版本暂无对应安装包')
      setFlavorErrorMessage('当前版本暂无对应安装包')
      setFlavorErrorOpen(true)
      return
    }
    if (result.status === 'error') {
      setFlavorHint(result.message)
      setFlavorErrorMessage(result.message)
      setFlavorErrorOpen(true)
      return
    }
    setFlavorHint(undefined)
    await startDownload(result.release)
  }, [supported, downloading, startDownload])

  const flavorSwitchCaption = useMemo(() => {
    if (flavorBusy) return '正在查找安装包…'
    if (flavorHint) return flavorHint
    return undefined
  }, [flavorBusy, flavorHint])

  const flavorConfirmMessage = useMemo(() => {
    const ver = __APP_VERSION__
    if (oppositeFlavor === 'local') {
      return `将下载并安装当前版本（v${ver}）的离线翻译版安装包。离线版体积更大，支持本地翻译引擎。覆盖安装后设置与数据通常保留。`
    }
    return `将下载并安装当前版本（v${ver}）的云端版安装包。云端版更轻量，不含本地翻译引擎。覆盖安装后设置与数据通常保留。`
  }, [oppositeFlavor])

  const manualCaption = useMemo(() => {
    if (manualStatus === 'checking') return '检查中…'
    if (manualStatus === 'downloading' || downloading) return '正在下载…'
    if (manualStatus === 'latest') return `已是${updateTrack === 'beta' ? '内测' : '正式'}通道最新`
    if (manualStatus === 'error') return manualHint || '检查失败，点按重试'
    if (hasUpdate && availableVersion) return `发现新版本 v${availableVersion} · 点按更新`
    return `当前 v${__APP_VERSION__}`
  }, [manualStatus, manualHint, downloading, hasUpdate, availableVersion, updateTrack])

  return {
    supported,
    dialogRelease,
    dialogOpen: dialogRelease != null,
    dialogOrigin,
    localVersion: __APP_VERSION__,
    hasUpdate,
    availableVersion,
    onUpdate,
    onLater,
    onSkip,
    installPermissionOpen,
    onConfirmInstallPermission,
    onCancelInstallPermission,
    promptManualCheck,
    manualCaption,
    manualStatus,
    updateTrack,
    trackPickerOpen,
    betaConfirmOpen,
    onOpenTrackPicker,
    onCloseTrackPicker,
    onChangeUpdateTrack,
    onConfirmBetaTrack,
    onCancelBetaTrack,
    currentFlavor,
    oppositeFlavor,
    flavorSwitchCaption,
    flavorConfirmOpen,
    flavorConfirmMessage,
    flavorErrorOpen,
    flavorErrorMessage,
    onPromptFlavorSwitch,
    onConfirmFlavorSwitch,
    onCancelFlavorSwitch,
    onDismissFlavorError,
  }
}
