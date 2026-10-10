import { useCallback, useContext, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type Hls from 'hls.js'
import {
  AlertCircle,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCw,
  LockOpen,
  SkipBack,
  SkipForward,
  Cast,
  ChevronLeft,
  PictureInPicture2,
} from 'lucide-react'
import { VideoSessionManagerContext, useHasGlobalVideoSurface, useVideoPresentation } from '../features/floatingVideo/context'
import type { VideoSessionManager } from '../features/floatingVideo/session'

import { subscribeBatteryStatus, type BatteryStatus } from '../lib/batteryStatus'
import {
  browserMediaProxyUrl,
  createHotlinkHlsLoader,
  needsMediaHotlinkBypass,
} from '../lib/mediaFetch'
import { setNativeFullScreen } from '../lib/nativeChrome'
import { recoverAppScrollSurfaces } from '../lib/gestureStyles'
import { getVideoStatusMessage } from '../lib/videoStatus'
import {
  createBrightnessControl,
  createVolumeControl,
  lockVideoScreenOrientation,
  setVideoFullscreen,
  unlockVideoScreenOrientation,
  type LevelControl,
} from '../lib/deviceMediaControls'
import {
  clampLevel,
  clampSeekTarget,
  clampVideoPan,
  isThumbZone,
  levelOffset,
  normalizeVideoRotation,
  pinchScale,
  resolveGesture,
  seekOffsetSeconds,
  videoPointForRotation,
  videoSurfaceForRotation,
} from '../lib/videoGestures'
import { Capacitor } from '@capacitor/core'
import {
  collectPlaybackOrigins,
  nativeStreamProxyUrl,
  prepareNativeMediaPlayback,
  releaseNativeMediaPlayback,
} from '../features/mediaSniffer/native'
import type { MediaResourceDescriptor } from '../features/mediaSniffer/types'
import {
  applyPlaybackRate,
  BOOST_RATE,
  DEFAULT_VIDEO_VIEW,
  defaultRotationMode,
  DOUBLE_TAP_MS,
  formatTime,
  hasPlaybackRate,
  HUD_LINGER_MS,
  IDLE_GESTURE,
  LONG_PRESS_MS,
  nextRotationMode,
  PLAYBACK_RATES,
  playableFormatForUrl,
  ROTATION_MODE_LABEL,
  TAP_SLOP_PX,
  type GestureHud,
  type GestureState,
  type PinchState,
  type PlayableFormat,
  type RotationMode,
  type VideoViewState,
} from './inkVideoPlayer/playback'
import {
  liveResourceChoices,
  playbackCheckpoint,
  playbackHeadersKey,
  playbackIdentity,
  type PlaybackCheckpoint,
} from './inkVideoPlayer/lifecycle'
import { log } from '../lib/logger'
import { CastOverlay } from './inkVideoPlayer/CastOverlay'
import { GestureHudOverlay } from './inkVideoPlayer/GestureHudOverlay'
import {
  MediaResourceOverlay,
  MediaResourcePageProvider,
  MediaResourceScreen,
} from './inkVideoPlayer/MediaResourceOverlay'
import { PlayerBatteryIcon } from './inkVideoPlayer/PlayerBatteryIcon'
import { useCastControls } from './inkVideoPlayer/useCastControls'

export interface InkVideoPlayerProps {
  src: string
  poster?: string
  title?: string
  format?: PlayableFormat
  sourcePage?: string
  requestHeaders?: Record<string, string>
  extraUrls?: string[]
  resources?: MediaResourceDescriptor[]
  deferLoad?: boolean
  onUnlocked?: () => void
  onRefreshSource?: () => void
  onPlaybackError?: () => void
  /** 宿主页面（阅读器）读取该句柄，让系统返回键在全屏时先退出全屏而不是关文章 */
  fullscreenHandleRef?: MutableRefObject<InkVideoPlayerFullscreenHandle | null>
  /** 为 false 时仅内嵌切换资源，不打开独立媒体页（媒体页内嵌播放器用） */
  mediaPageHost?: boolean
  /** 阅读器浮层（如 AI 速读）打开时隐藏嗅探 FAB */
  suppressResourceFab?: boolean
}
type Props = InkVideoPlayerProps

type MediaResourcePageState = {
  active: MediaResourceDescriptor
  resources: MediaResourceDescriptor[]
}

/** 宿主页面可读取的全屏句柄：immersive 表示当前是否全屏，exit 请求退出全屏。 */
export interface InkVideoPlayerFullscreenHandle {
  immersive: boolean
  exit: () => void
}

/**
 * 墨砚阅读器视频：单一自定义控件（播放 / 进度 / 倍速 / 静音 / 全屏）。
 * 不使用原生 controls，避免与自定义 UI 叠出多个播放键。
 *
 * 手势分两套：
 * - 内嵌：单击切换控件、双击左右各 ±10s、长按临时 2.5 倍速。
 * - 全屏：下半屏（拇指区）横滑调进度、左下竖滑调亮度、右下竖滑调音量，
 *   双击专职播放 / 暂停；上半屏与内嵌一致。
 * - 通用：双指缩放与双指拖动画面；放大后单指手势仍可调进度 / 亮度 / 音量；顶部按钮旋转 / 还原画面。
 */
export function InkVideoPlayer(props: Props) {
  const manager = useContext(VideoSessionManagerContext)
  return manager ? <ManagedInkVideoSlot props={props} manager={manager} /> : <InkVideoPlayerRuntime {...props} />
}

function ManagedInkVideoSlot({ props, manager }: { props: Props; manager: VideoSessionManager }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const key = useId()
  const [revision, setRevision] = useState(0)
  const id = `${key}:${playbackIdentity(props.src, props.format)}:${revision}`
  const ownerRef = useRef<symbol | null>(null)
  const sessions = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot)
  const session = sessions.find(item => item.id === id)
  const initialProps = useRef(props)
  initialProps.current = props
  useLayoutEffect(() => {
    const owner = manager.register(id, initialProps.current, slotRef.current!)
    const fullscreenHandle = initialProps.current.fullscreenHandleRef
    ownerRef.current = owner
    return () => {
      manager.detach(id, owner)
      if (fullscreenHandle) fullscreenHandle.current = null
    }
  }, [id, manager])
  useLayoutEffect(() => {
    if (ownerRef.current) manager.update(id, ownerRef.current, props)
  }, [id, manager, props])
  return <div data-reader-block="" data-video-session-slot="" ref={slotRef}>
    {session && session.mode !== 'inline' && <div className="reader-video-aspect flex flex-col items-center justify-center gap-3 rounded-xl border border-haze bg-ink-raised text-paper-muted">
      <PictureInPicture2 size={24} />
      <span className="text-[12px]">正在悬浮播放</span>
      <button type="button" className="rounded-lg border border-haze px-3 py-2 text-[12px]" onClick={() => manager.restore(id)}>恢复到此处</button>
    </div>}
    {!session && ownerRef.current && <button type="button" className="reader-video-aspect w-full rounded-xl border border-haze bg-ink-raised text-paper-muted" onClick={() => setRevision(value => value + 1)}>视频已关闭 · 点击重新加载</button>}
  </div>
}

/** Runtime ownership belongs to the application Host when a Provider exists. */
export function InkVideoPlayerRuntime({
  src,
  poster,
  title,
  format,
  sourcePage,
  requestHeaders,
  extraUrls,
  resources,
  deferLoad,
  onUnlocked,
  onRefreshSource,
  onPlaybackError,
  fullscreenHandleRef,
  mediaPageHost = true,
  suppressResourceFab = false,
}: Props) {
  const presentation = useVideoPresentation()
  const [allowed, setAllowed] = useState(!deferLoad)
  const [selectedResource, setSelectedResource] = useState<MediaResourceDescriptor | null>(null)
  const [mediaPage, setMediaPage] = useState<MediaResourcePageState | null>(null)
  const mediaPageRef = useRef(mediaPage)
  mediaPageRef.current = mediaPage
  const innerFullscreenRef = useRef<InkVideoPlayerFullscreenHandle | null>(null)

  const openMediaResourcePage = useCallback((
    resource: MediaResourceDescriptor,
    resourceList: MediaResourceDescriptor[],
  ) => {
    if (presentation) {
      setSelectedResource(resource)
      presentation.openPage()
      return
    }
    setMediaPage({ active: resource, resources: resourceList })
  }, [presentation])

  const syncHostFullscreenHandle = useCallback(() => {
    if (!fullscreenHandleRef || !mediaPageHost) return
    const inner = innerFullscreenRef.current
    fullscreenHandleRef.current = {
      immersive: !!mediaPageRef.current || (inner?.immersive ?? false),
      exit: () => {
        if (mediaPageRef.current) {
          setMediaPage(null)
          return
        }
        inner?.exit()
      },
    }
  }, [fullscreenHandleRef, mediaPageHost])

  const onInnerFullscreenChange = useCallback(() => {
    syncHostFullscreenHandle()
  }, [syncHostFullscreenHandle])

  useEffect(() => {
    syncHostFullscreenHandle()
  }, [syncHostFullscreenHandle, mediaPage])

  const resourceOptions = useMemo<MediaResourceDescriptor[]>(() => {
    if (resources?.length) return resources
    return [{
      id: `direct:${src}`,
      type: playableFormatForUrl(src, format),
      url: src,
      pageUrl: sourcePage || '',
      score: 0,
      videoTracks: [],
      audioTracks: [],
      subtitles: [],
      drm: false,
      drmKeySystems: [],
      requestHeaders,
      relatedUrls: extraUrls,
    }]
  }, [extraUrls, format, requestHeaders, resources, sourcePage, src])

  // Live sniffing refreshes the resource list while the chosen video is playing.
  // Reset the user's selection only when the source itself changes.
  useEffect(() => {
    setSelectedResource(null)
    setMediaPage(null)
  }, [src])

  useEffect(() => {
    if (!deferLoad) setAllowed(true)
  }, [deferLoad])

  if (!allowed) {
    return (
      <div
        data-no-page-tap=""
        data-reader-block
        role="button"
        tabIndex={0}
        className="reader-deferred-host reader-video-aspect"
        onClick={() => {
          setAllowed(true)
          onUnlocked?.()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setAllowed(true)
            onUnlocked?.()
          }
        }}
      >
        <span className="reader-deferred-label">点击加载视频</span>
      </div>
    )
  }

  const active = selectedResource
  const activeExtraUrls = Array.from(new Set([
    ...(active?.relatedUrls ?? []),
    ...(extraUrls ?? []),
  ]))
  const activeFormat = playableFormatForUrl(active?.url || src, active?.type || format)
  const playerKey = playbackIdentity(active?.url || src, activeFormat)
  const player = (
    <InkVideoPlayerReady
      key={playerKey}
      src={active?.url || src}
      poster={poster}
      title={title}
      format={activeFormat}
      sourcePage={active?.pageUrl || sourcePage}
      requestHeaders={active?.requestHeaders || requestHeaders}
      extraUrls={activeExtraUrls.length ? activeExtraUrls : undefined}
      resources={liveResourceChoices(resourceOptions, active)}
      onSelectResource={setSelectedResource}
      onRefreshSource={onRefreshSource}
      onPlaybackError={onPlaybackError}
      fullscreenHandleRef={mediaPageHost ? innerFullscreenRef : fullscreenHandleRef}
      onFullscreenChange={mediaPageHost ? onInnerFullscreenChange : undefined}
      suppressResourceFab={suppressResourceFab}
    />
  )

  if (!mediaPageHost) return player

  const mediaPageResources = mediaPage
    ? liveResourceChoices(resources?.length ? resources : mediaPage.resources, mediaPage.active)
    : []
  const mediaPageExtraUrls = mediaPage
    ? Array.from(new Set([
        ...(mediaPage.active.relatedUrls ?? []),
        ...(extraUrls ?? []),
      ]))
    : undefined

  return (
    <>
      <MediaResourcePageProvider open={openMediaResourcePage}>
        {mediaPage ? (
          <div className="reader-video-aspect w-full bg-[#0c0d10]" aria-hidden data-reader-block />
        ) : (
          player
        )}
      </MediaResourcePageProvider>
      {mediaPage && typeof document !== 'undefined' && createPortal(
        <MediaResourceScreen
          title={title}
          resources={mediaPageResources}
          activeResource={mediaPage.active}
          onClose={() => setMediaPage(null)}
          onSelect={(resource) => {
            setMediaPage((current) => current ? { ...current, active: resource } : current)
          }}
        >
          <InkVideoPlayerRuntime
            mediaPageHost={false}
            key={playbackIdentity(mediaPage.active.url, mediaPage.active.type)}
            src={mediaPage.active.url}
            poster={poster}
            title={title}
            format={mediaPage.active.type}
            sourcePage={mediaPage.active.pageUrl || sourcePage}
            requestHeaders={mediaPage.active.requestHeaders || requestHeaders}
            extraUrls={mediaPageExtraUrls}
            resources={mediaPageResources}
            onRefreshSource={onRefreshSource}
            onPlaybackError={onPlaybackError}
            fullscreenHandleRef={innerFullscreenRef}
            suppressResourceFab={suppressResourceFab}
          />
        </MediaResourceScreen>,
        document.body,
      )}
    </>
  )
}

function InkVideoPlayerReady({
  src,
  poster,
  title,
  format,
  sourcePage,
  requestHeaders,
  extraUrls,
  resources,
  onSelectResource,
  onRefreshSource,
  onPlaybackError,
  fullscreenHandleRef,
  onFullscreenChange,
  suppressResourceFab = false,
}: Props & {
  onSelectResource?: (resource: MediaResourceDescriptor) => void
  onFullscreenChange?: () => void
}) {
  const presentation = useVideoPresentation()
  const rootRef = useRef<HTMLDivElement>(null)
  const lifecycleGeneration = useRef(0)
  const fullscreenOperation = useRef<Promise<void> | null>(null)
  useLayoutEffect(() => {
    const generationRef = lifecycleGeneration
    generationRef.current++
    return () => { generationRef.current++ }
  }, [])
  const stageRef = useRef<HTMLDivElement>(null)
  const gestureSurfaceRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const resumeBlockedRef = useRef(false)
  const hlsRef = useRef<Hls | null>(null)
  const dashRef = useRef<{ reset: () => void } | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const scrubbingRef = useRef(false)
  const rateRef = useRef(1)
  const tapTimerRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const gestureRef = useRef<GestureState>({ ...IDLE_GESTURE })
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<PinchState | null>(null)
  const multiTouchRef = useRef(false)
  const videoViewRef = useRef<VideoViewState>(DEFAULT_VIDEO_VIEW)
  /** 当前生效的旋转模式；null 表示没有改动过 Activity 方向，退出时无需归还 */
  const rotationModeRef = useRef<RotationMode | null>(null)
  /** 始终指向最新的 toggleFullscreen，供返回键句柄在任意时刻调用 */
  const toggleFullscreenRef = useRef<() => Promise<void>>(async () => {})
  const lastTapRef = useRef(0)
  const showChromeRef = useRef(true)
  const toastTimerRef = useRef<number | null>(null)
  const hudTimerRef = useRef<number | null>(null)
  /** 音量 / 亮度手势进行中；松手后迟到的异步写入不能把淡出定时器冲掉。 */
  const levelingRef = useRef(false)
  const levelsRef = useRef({ volume: 1, brightness: 1 })
  const levelWriteRef = useRef<{
    busy: boolean
    pending: { kind: 'volume' | 'brightness'; value: number } | null
  }>({ busy: false, pending: null })

  const [clock, setClock] = useState('')
  const [battery, setBattery] = useState<BatteryStatus | null>(null)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setClock(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`)
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => subscribeBatteryStatus(setBattery), [])
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [, setMuted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false)
  const [scrubbing, setScrubbing] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const [rate, setRate] = useState(1)
  const [rateMenuOpen, setRateMenuOpen] = useState(false)
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false)
  const [playerToast, setPlayerToast] = useState<string | null>(null)
  const [boosting, setBoosting] = useState(false)
  const [gestureHud, setGestureHud] = useState<GestureHud | null>(null)
  const [videoView, setVideoView] = useState<VideoViewState>(DEFAULT_VIDEO_VIEW)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 })
  const [viewInteracting, setViewInteracting] = useState(false)
  const [rotationMode, setRotationMode] = useState<RotationMode | null>(null)
  /** 无原生亮度能力时的兜底压暗层 */
  const [scrim, setScrim] = useState(0)
  const immersive = fullscreen || fallbackFullscreen
  const setSessionImmersive = presentation?.setImmersive
  const bindSessionRuntime = presentation?.bindRuntime
  const compact = presentation?.mode === 'floating' && !immersive
  const globalVideoSurface = useHasGlobalVideoSurface()
  const runTransition = presentation?.runTransition
  const claimPlayback = useEffectEvent(() => presentation?.claimPlayback())
  const compactRef = useRef(compact)
  compactRef.current = compact
  const resourceOptions = resources?.length ? resources : []

  // Resource discovery enriches the picker/origin permissions, not the active engine.
  // Actual authentication changes reconnect while preserving the same media's position.
  const playbackContextKey = playbackHeadersKey(requestHeaders)
  const playbackContext = useMemo(() => ({
    headers: Object.fromEntries(JSON.parse(playbackContextKey) as Array<[string, string]>),
  }), [playbackContextKey])
  const extraOriginsKey = JSON.stringify(collectPlaybackOrigins({ url: src, sourcePage, extraUrls }).sort())
  const currentPlaybackOrigins = useEffectEvent(() => JSON.parse(extraOriginsKey) as string[])
  const refreshNativeOriginsRef = useRef<(() => void) | null>(null)
  const reloadCheckpointRef = useRef<PlaybackCheckpoint | null>(null)
  const reportPlaybackError = useEffectEvent(() => onPlaybackError?.())

  const brightnessControl = useMemo(() => createBrightnessControl(setScrim), [])
  const volumeControl = useMemo(
    () => createVolumeControl(() => videoRef.current),
    [],
  )
  const levelControl = useCallback(
    (kind: 'volume' | 'brightness'): LevelControl =>
      kind === 'volume' ? volumeControl : brightnessControl,
    [brightnessControl, volumeControl],
  )

  const setScrubbingState = (value: boolean) => {
    scrubbingRef.current = value
    setScrubbing(value)
  }

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHideControls = useCallback(() => {
    clearHideTimer()
    const video = videoRef.current
    if (!video || video.paused || scrubbing) return
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false)
    }, 2600)
  }, [clearHideTimer, scrubbing])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    scheduleHideControls()
  }, [scheduleHideControls])

  const showPlayerToast = useCallback((message: string) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    setPlayerToast(message)
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setPlayerToast(null)
    }, 1800)
    revealControls()
  }, [revealControls])

  const {
    castOpen,
    setCastOpen,
    castDevices,
    castSearching,
    castConnectingId,
    castError,
    castSession,
    castStatus,
    castSessionError,
    openCastPicker,
    refreshCastDevices,
    connectCastDevice,
    sendCastControl,
    endCast,
  } = useCastControls({
    src,
    format,
    title,
    sourcePage,
    requestHeaders,
    extraUrls,
    videoRef,
    current,
    duration,
    immersive,
    exitFullscreen: () => toggleFullscreenRef.current(),
    showPlayerToast,
  })
  const dismissOverlay = useEffectEvent(() => {
    if (castOpen) { setCastOpen(false); return true }
    if (resourceMenuOpen) { setResourceMenuOpen(false); return true }
    if (rateMenuOpen) { setRateMenuOpen(false); return true }
    return false
  })

  const syncBoostIndicator = useCallback((video: HTMLVideoElement) => {
    setBoosting(
      gestureRef.current.boosted && hasPlaybackRate(video, BOOST_RATE),
    )
  }, [])

  const updateVideoView = useCallback((next: VideoViewState) => {
    videoViewRef.current = next
    setVideoView(next)
  }, [])

  /**
   * 应用旋转模式：原生平台请求 Activity 锁定 / 跟随方向；
   * 原生生效后清掉 CSS 旋转兜底，避免与 Activity 旋转叠加。
   */
  const applyRotationMode = useCallback(
    async (mode: RotationMode): Promise<boolean> => {
      const generation = lifecycleGeneration.current
      rotationModeRef.current = mode
      setRotationMode(mode)
      const applied = await lockVideoScreenOrientation(mode)
      if (generation !== lifecycleGeneration.current || !rootRef.current) {
        await unlockVideoScreenOrientation()
        return false
      }
      if (applied && videoViewRef.current.rotation !== 0) {
        updateVideoView(DEFAULT_VIDEO_VIEW)
      }
      return applied
    },
    [updateVideoView],
  )

  const releasePlayerScreenOrientation = useCallback(async () => {
    if (rotationModeRef.current == null) return
    rotationModeRef.current = null
    if (rootRef.current) setRotationMode(null)
    await unlockVideoScreenOrientation()
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const syncViewport = () => {
      const rect = stage.getBoundingClientRect()
      setViewport({ width: rect.width, height: rect.height })
    }
    syncViewport()
    const observer = new ResizeObserver(syncViewport)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    updateVideoView(DEFAULT_VIDEO_VIEW)
    setMediaSize({ width: 0, height: 0 })
  }, [src, updateVideoView])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    const url = src
    const isHls = format === 'hls' || /\.m3u8(\?|$)/i.test(url)
    const isDash = format === 'dash' || /\.mpd(\?|$)/i.test(url)
    const { headers } = playbackContext
    let cancelled = false
    const nativeSessionId = `play-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
    const preparations = new Set<Promise<boolean>>()
    const preparePlayback = (options: Parameters<typeof prepareNativeMediaPlayback>[0]) => {
      const request = prepareNativeMediaPlayback({ ...options, sessionId: nativeSessionId })
      preparations.add(request)
      void request.then(() => {
        preparations.delete(request)
        if (cancelled) void releaseNativeMediaPlayback(nativeSessionId)
      }, () => { preparations.delete(request) })
      return request
    }
    let pendingResume = reloadCheckpointRef.current
    reloadCheckpointRef.current = null
    let intendedPlaying = pendingResume ? !pendingResume.paused : !video.paused
    let resettingSource = Boolean(pendingResume)
    let nativePrepared = false
    let registeredOriginsKey = ''
    let progressiveBridgeAttempted = false
    let progressiveProxyUrl: string | null = null
    let directRetryAttempted = false
    let progressiveRecoveryInFlight = false
    let recoveryRequestInFlight = false
    let hlsRecoveries = 0
    let hlsRecoveryTimer: ReturnType<typeof setTimeout> | null = null
    const MAX_HLS_RECOVERIES = 3
    let progressiveRecoveryTimer: ReturnType<typeof window.setTimeout> | undefined
    const effectiveHeaders: Record<string, string> = { ...headers }
    if (sourcePage && !Object.keys(effectiveHeaders).some((key) => key.toLowerCase() === 'referer')) {
      try {
        if (new URL(url).origin !== new URL(sourcePage).origin) {
          effectiveHeaders.Referer = sourcePage
        }
      } catch {
        // ignore
      }
    }
    // Register newly discovered CDN origins without touching video.src or load().
    const refreshNativeOrigins = () => {
      if (cancelled || !nativePrepared || !Capacitor.isNativePlatform()) return
      const origins = currentPlaybackOrigins()
      const key = JSON.stringify(origins)
      if (key === registeredOriginsKey) return
      registeredOriginsKey = key
      void preparePlayback({
        url, sourcePage, format: isDash ? 'dash' : isHls ? 'hls' : 'progressive',
        headers: effectiveHeaders, origins, forceBridge: progressiveBridgeAttempted,
      }).catch(() => {
        if (!cancelled) {
          registeredOriginsKey = ''
          log.sniffer.warn('Unable to refresh playback origin permissions')
        }
      })
    }
    refreshNativeOriginsRef.current = refreshNativeOrigins
    // Keep long-lived playback credentials available without touching the decoder.
    // Re-register the same native session periodically while the document is active.
    const renewPlaybackLease = () => {
      if (cancelled || document.hidden || !nativePrepared) return
      registeredOriginsKey = ''
      refreshNativeOrigins()
    }
    const renewalTimer = window.setInterval(renewPlaybackLease, 4 * 60 * 1000)
    document.addEventListener('visibilitychange', renewPlaybackLease)
    const restoreCheckpoint = () => {
      if (!pendingResume || cancelled || recoveryRequestInFlight || video.readyState < 1) return
      const checkpoint = pendingResume
      if (checkpoint.position > 0) {
        const target = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(checkpoint.position, Math.max(0, video.duration - 0.05))
          : checkpoint.position
        try {
          video.currentTime = target
          setCurrent(target)
        } catch {
          // Keep the checkpoint for loadeddata/canplay when seeking becomes valid.
          return
        }
      }
      pendingResume = null
      if (!checkpoint.paused && !resumeBlockedRef.current) {
        void video.play().catch(() => {
          if (!cancelled) setHint('点击继续播放')
        })
      }
    }
    const failPlayback = (message: string) => {
      if (cancelled) return
      setFatal(message)
      reportPlaybackError()
    }
    const armProgressiveRecovery = () => {
      progressiveRecoveryInFlight = true
      if (progressiveRecoveryTimer !== undefined) window.clearTimeout(progressiveRecoveryTimer)
      progressiveRecoveryTimer = window.setTimeout(() => {
        progressiveRecoveryInFlight = false
        progressiveRecoveryTimer = undefined
      }, 2000)
    }
    const settleProgressiveRecovery = () => {
      progressiveRecoveryInFlight = false
      if (progressiveRecoveryTimer !== undefined) {
        window.clearTimeout(progressiveRecoveryTimer)
        progressiveRecoveryTimer = undefined
      }
    }

    setReady(false)
    setFatal(null)
    setHint(null)
    setPlaying(false)
    setCurrent(pendingResume?.position ?? 0)
    if (!pendingResume) setDuration(0)
    setBuffered(0)
    setControlsVisible(true)
    setWaiting(true)
    setSeeking(false)
    setRateMenuOpen(false)

    const markReady = () => {
      if (cancelled) return
      // canplay can fire again after HLS buffering. Keep a held boost instead of
      // silently restoring the user's normal rate while the boost badge remains.
      video.defaultPlaybackRate = rateRef.current
      applyPlaybackRate(
        video,
        gestureRef.current.boosted ? BOOST_RATE : rateRef.current,
      )
      syncBoostIndicator(video)
      settleProgressiveRecovery()
      setWaiting(false)
      setReady(true)
      if (video.readyState >= 1) resettingSource = false
      restoreCheckpoint()
    }
    const loadProgressiveSource = () => {
      resettingSource = true
      video.src = progressiveProxyUrl || url
      video.load()
    }

    const onFatalMedia = () => {
      if (cancelled || recoveryRequestInFlight || progressiveRecoveryInFlight) return
      if (
        Capacitor.isNativePlatform()
        && !isHls
        && !isDash
        && progressiveBridgeAttempted
        && !directRetryAttempted
      ) {
        directRetryAttempted = true
        recoveryRequestInFlight = true
        pendingResume ??= playbackCheckpoint(video, intendedPlaying)
        setWaiting(true)
        armProgressiveRecovery()
        void preparePlayback({
          url,
          sourcePage,
          format: 'progressive',
          headers: effectiveHeaders,
          origins: currentPlaybackOrigins(),
          forceBridge: true,
        }).then(async () => {
          if (cancelled) return
          settleProgressiveRecovery()
          setFatal(null)
          progressiveProxyUrl = await nativeStreamProxyUrl(
            url,
            nativeSessionId,
          )
          if (cancelled) return
          loadProgressiveSource()
        }).catch(() => {
          if (!cancelled) failPlayback('视频源暂时无法播放')
        }).finally(() => { recoveryRequestInFlight = false })
        return
      }
      if (
        Capacitor.isNativePlatform()
        && !isHls
        && !isDash
        && !progressiveBridgeAttempted
      ) {
        progressiveBridgeAttempted = true
        recoveryRequestInFlight = true
        pendingResume ??= playbackCheckpoint(video, intendedPlaying)
        setWaiting(true)
        armProgressiveRecovery()
        void preparePlayback({
          url,
          sourcePage,
          format: 'progressive',
          headers: effectiveHeaders,
          origins: currentPlaybackOrigins(),
          forceBridge: true,
        }).then(async () => {
          if (cancelled) return
          settleProgressiveRecovery()
          setFatal(null)
          progressiveProxyUrl = await nativeStreamProxyUrl(
            url,
            nativeSessionId,
          )
          if (cancelled) return
          loadProgressiveSource()
        }).catch(() => {
          if (!cancelled) failPlayback('视频源暂时无法播放')
        }).finally(() => { recoveryRequestInFlight = false })
        return
      }
      failPlayback('视频源暂时无法播放')
    }
    const onPlay = () => {
      // Android WebView can emit a late play when its Activity resumes, after
      // JavaScript was frozen during the background notification.
      if (resumeBlockedRef.current) { video.pause(); return }
      claimPlayback()
      if (pendingResume && !resettingSource) pendingResume.paused = false
      intendedPlaying = true
      setPlaying(true)
      setHint(null)
    }
    const onPause = () => {
      // A pause before the asynchronous source reset is user intent. A pause
      // caused by load()/an actual media error must not erase the saved intent.
      if (!resettingSource && !video.error) {
        intendedPlaying = false
        if (pendingResume) pendingResume.paused = true
      }
      setPlaying(false)
      setControlsVisible(true)
      clearHideTimer()
    }
    const onTime = () => {
      if (!scrubbingRef.current) setCurrent(pendingResume?.position ?? video.currentTime)
    }
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration)
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setMediaSize({ width: video.videoWidth, height: video.videoHeight })
      }
      markReady()
    }
    const onDuration = () => {
      if (!pendingResume && Number.isFinite(video.duration)) setDuration(video.duration)
    }
    const onProgress = () => {
      if (!video.buffered.length) return
      try {
        setBuffered(video.buffered.end(video.buffered.length - 1))
      } catch {
        /* ignore */
      }
    }
    const onEnded = () => {
      setPlaying(false)
      setControlsVisible(true)
      clearHideTimer()
      setWaiting(false)
      setSeeking(false)
    }
    const onRateChange = () => syncBoostIndicator(video)
    // 音量手势可能解除静音，静音按钮的状态要跟着走
    const onVolumeChange = () => setMuted(video.muted)
    const onLoadStart = () => {
      setWaiting(true)
      setSeeking(false)
    }
    const onWaiting = () => setWaiting(true)
    const onSeeking = () => setSeeking(true)
    const onSeeked = () => {
      setSeeking(false)
      setWaiting(false)
    }
    const onPlaying = () => {
      resettingSource = false
      settleProgressiveRecovery()
      setWaiting(false)
      setSeeking(false)
    }

    video.addEventListener('loadstart', onLoadStart)
    video.addEventListener('canplay', markReady)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onWaiting)
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('volumechange', onVolumeChange)
    video.addEventListener('loadeddata', markReady)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onProgress)
    video.addEventListener('error', onFatalMedia)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('ratechange', onRateChange)

    void (async () => {
      const origins = currentPlaybackOrigins()
      registeredOriginsKey = JSON.stringify(origins)
      progressiveBridgeAttempted = await preparePlayback({
        url,
        sourcePage,
        format: isDash ? 'dash' : isHls ? 'hls' : 'progressive',
        headers: effectiveHeaders,
        origins,
        forceBridge: !isHls && !isDash && needsMediaHotlinkBypass(url),
      })
      if (cancelled) return
      nativePrepared = true
      refreshNativeOrigins()
      const requestContext = sourcePage || Object.keys(effectiveHeaders).length > 0
        ? { sourcePage, headers: effectiveHeaders }
        : undefined
      const bypass = needsMediaHotlinkBypass(url)
        || Boolean(isHls && sourcePage && !Capacitor.isNativePlatform())
        || Boolean(isHls && progressiveBridgeAttempted && Capacitor.isNativePlatform())
      // Android 原生 MediaPlayer 的 HLS 分片请求不走 WebView 拦截，
      // 无法注入自定义 headers，必须走 hls.js + XHR 由 WebViewClient 补齐
      const useNativeHls = !Capacitor.isNativePlatform() && !bypass && Boolean(video.canPlayType('application/vnd.apple.mpegurl'))
      const HlsClass =
        isHls && !useNativeHls ? (await import('hls.js')).default : null
      if (cancelled) return
      if (!isDash && !isHls && progressiveBridgeAttempted) {
        progressiveProxyUrl = await nativeStreamProxyUrl(
          url,
          nativeSessionId,
        )
        if (cancelled) return
      }

      if (isDash) {
        const module = await import('dashjs')
        if (cancelled) return
        const dash = module.MediaPlayer().create()
        if (Capacitor.isNativePlatform()) dash.addRequestInterceptor(async request => {
          request.headers = { ...request.headers, 'X-NewsNook-Playback-Session': nativeSessionId }
          return request
        })
        dashRef.current = dash
        dash.initialize(video, url, false)
      } else if (isHls) {
        if (useNativeHls) {
          video.src = url
        } else if (HlsClass?.isSupported()) {
          const hls = new HlsClass({
            enableWorker: true,
            lowLatencyMode: false,
            ...(Capacitor.isNativePlatform() ? { xhrSetup: (xhr: XMLHttpRequest) => xhr.setRequestHeader('X-NewsNook-Playback-Session', nativeSessionId) } : {}),
            ...(bypass ? { loader: createHotlinkHlsLoader(requestContext) } : {}),
          })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(HlsClass.Events.MANIFEST_PARSED, markReady)
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return
            if (hlsRecoveries >= MAX_HLS_RECOVERIES) {
              failPlayback('视频流重试失败，请检查网络或更换视频源')
              hls.stopLoad()
              return
            }
            if (hlsRecoveryTimer != null) return
            const attempt = ++hlsRecoveries
            const delayMs = Math.min(8000, 500 * 2 ** (attempt - 1))
            hlsRecoveryTimer = setTimeout(() => {
              hlsRecoveryTimer = null
              if (cancelled) return
              if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) hls.startLoad()
              else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
              else failPlayback('视频流加载失败')
            }, delayMs)
          })
        } else {
          failPlayback('当前环境不支持 HLS 播放')
        }
      } else if (bypass) {
        if (Capacitor.isNativePlatform()) {
          // Android progressive 统一改走 localhost 代理，把 Referer/Cookie 留在原生 OkHttp 侧。
          loadProgressiveSource()
        } else {
          video.src = browserMediaProxyUrl(url)
        }
      } else {
        loadProgressiveSource()
      }
    })().catch(() => {
      failPlayback('视频流加载失败')
    })

    return () => {
      reloadCheckpointRef.current = pendingResume ?? playbackCheckpoint(video, intendedPlaying)
      cancelled = true
      window.clearInterval(renewalTimer)
      document.removeEventListener('visibilitychange', renewPlaybackLease)
      if (!preparations.size) void releaseNativeMediaPlayback(nativeSessionId)
      if (refreshNativeOriginsRef.current === refreshNativeOrigins) refreshNativeOriginsRef.current = null
      settleProgressiveRecovery()
      if (hlsRecoveryTimer != null) clearTimeout(hlsRecoveryTimer)
      clearHideTimer()
      video.removeEventListener('loadstart', onLoadStart)
      video.removeEventListener('canplay', markReady)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onWaiting)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadeddata', markReady)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('error', onFatalMedia)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('ratechange', onRateChange)
      video.removeEventListener('volumechange', onVolumeChange)
      hlsRef.current?.destroy()
      hlsRef.current = null
      dashRef.current?.reset()
      dashRef.current = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [clearHideTimer, format, playbackContext, sourcePage, src, syncBoostIndicator])

  useEffect(() => { refreshNativeOriginsRef.current?.() }, [extraOriginsKey])

  useEffect(() => {
    const onFs = () => {
      const node = rootRef.current
      const active = Boolean(node && document.fullscreenElement === node)
      setFullscreen(active)
      if (active) setFallbackFullscreen(false)
      else {
        updateVideoView(DEFAULT_VIDEO_VIEW)
        void releasePlayerScreenOrientation()
      }
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [releasePlayerScreenOrientation, updateVideoView])

  useEffect(() => {
    const currentView = videoViewRef.current
    const pan = clampVideoPan(
      currentView.x,
      currentView.y,
      videoSurfaceForRotation(viewport, currentView.rotation),
      mediaSize,
      currentView.scale,
    )
    if (pan.x !== currentView.x || pan.y !== currentView.y) {
      updateVideoView({ ...currentView, ...pan })
    }
  }, [mediaSize, updateVideoView, viewport])

  useEffect(() => {
    if (!immersive) return
    const root = rootRef.current
    // Normal exit is already awaited by the transition. Teardown must join the
    // same queue before another session can take ownership of the Activity.
    return () => {
      if (root?.isConnected) return
      const release = async () => {
        if (Capacitor.isNativePlatform()) {
          const applied = await setVideoFullscreen(false)
          if (!applied) await setNativeFullScreen(false)
        } else {
          if (root && document.fullscreenElement === root) {
            try {
              await document.exitFullscreen()
            } catch {
              // Keep current browser fullscreen state if exit is rejected.
            }
          }
          await setNativeFullScreen(false)
        }
        await releasePlayerScreenOrientation()
        recoverAppScrollSurfaces()
      }
      void (runTransition ? runTransition(release) : release())
    }
  }, [immersive, releasePlayerScreenOrientation, runTransition])

  useEffect(() => {
    if (immersive) return
    recoverAppScrollSurfaces()
  }, [immersive])

  /** 进入全屏时对齐当前系统档位，退出时把亮度还给系统。 */
  useEffect(() => {
    if (!immersive) {
      brightnessControl.release()
      volumeControl.release()
      return
    }

    let cancelled = false
    void (async () => {
      const [volume, brightness] = await Promise.all([
        volumeControl.read(),
        brightnessControl.read(),
      ])
      if (cancelled) return
      levelsRef.current = { volume, brightness }
    })()

    return () => {
      cancelled = true
    }
  }, [brightnessControl, immersive, volumeControl])

  useEffect(() => {
    if (playing && !scrubbing) scheduleHideControls()
    else {
      clearHideTimer()
      setControlsVisible(true)
    }
  }, [playing, scrubbing, scheduleHideControls, clearHideTimer])

  useEffect(
    () => () => {
      if (tapTimerRef.current != null) window.clearTimeout(tapTimerRef.current)
      if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
      if (hudTimerRef.current != null) window.clearTimeout(hudTimerRef.current)
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
      const surface = gestureSurfaceRef.current
      if (surface) {
        activePointersRef.current.forEach((_, pointerId) => {
          if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId)
        })
      }
      activePointersRef.current.clear()
      pinchRef.current = null
      // 卸载时若仍在全屏，窗口亮度必须归还系统，否则整个应用会一直停在调暗状态
      brightnessControl.release()
      volumeControl.release()
      if (!runTransition) void releasePlayerScreenOrientation()
      recoverAppScrollSurfaces()
    },
    [brightnessControl, releasePlayerScreenOrientation, runTransition, volumeControl],
  )

  const playWithFallback = async () => {
    const video = videoRef.current
    if (!video) return
    resumeBlockedRef.current = false

    setHint(null)
    try {
      await video.play()
      revealControls()
      return
    } catch {
      /* 部分 WebView 要求先静音 */
    }

    try {
      const wasMuted = video.muted
      video.muted = true
      setMuted(true)
      await video.play()
      if (!wasMuted) {
        video.muted = false
        setMuted(false)
      }
      revealControls()
    } catch {
      setHint('播放被系统拦截，请再点一次')
    }
  }

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video || fatal) return
    if (!video.paused) {
      video.pause()
      return
    }
    await playWithFallback()
  }



  const onSeekInput = (value: number) => {
    if (!duration) return
    setScrubbingState(true)
    setCurrent(value)
  }

  const onSeekCommit = (value: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrent(value)
    setScrubbingState(false)
    revealControls()
  }

  const enterPlayerFullscreen = async (root: HTMLDivElement) => {
    const generation = lifecycleGeneration.current
    const current = () => generation === lifecycleGeneration.current && rootRef.current === root
    // Capacitor owns the Android window. Hide bars before the fixed player is
    // promoted to fullscreen so there is no frame where transparent system-bar
    // icons can sit on top of the video. DOM Fullscreen remains web-only.
    if (Capacitor.isNativePlatform()) {
      const applied = await setVideoFullscreen(true)
      if (!applied) await setNativeFullScreen(true)
      if (!current()) {
        const restored = await setVideoFullscreen(false)
        if (!restored) await setNativeFullScreen(false)
        return false
      }
      setFallbackFullscreen(true)
      return true
    }

    try {
      await root.requestFullscreen()
      if (!current()) {
        if (document.fullscreenElement === root) await document.exitFullscreen()
        return false
      }
    } catch {
      if (!current()) return false
      setFallbackFullscreen(true)
    }
    return true
  }

  const performFullscreenToggle = async () => {
    const root = rootRef.current
    if (!root) return
    const generation = lifecycleGeneration.current
    const current = () => generation === lifecycleGeneration.current && rootRef.current === root
    const exiting = fallbackFullscreen || document.fullscreenElement === root
    if (fallbackFullscreen) {
      if (Capacitor.isNativePlatform()) {
        const applied = await setVideoFullscreen(false)
        if (!applied) await setNativeFullScreen(false)
      }
      if (!current()) return
      setFallbackFullscreen(false)
      updateVideoView(DEFAULT_VIDEO_VIEW)
    } else if (document.fullscreenElement === root) {
      try {
        await document.exitFullscreen()
      } catch {
        // Keep the current browser fullscreen state if the platform rejects exit.
      }
    } else {
      if (!await enterPlayerFullscreen(root)) return
    }

    if (!current()) return

    if (exiting) {
      await releasePlayerScreenOrientation()
      updateVideoView(DEFAULT_VIDEO_VIEW)
    } else {
      // 默认：横屏视频锁横屏，竖屏视频跟随设备（见 defaultRotationMode）
      const mode = defaultRotationMode(mediaSize.width, mediaSize.height)
      if (mode) {
        await applyRotationMode(mode)
        if (!current()) return
        if (Capacitor.isNativePlatform()) {
          await enterPlayerFullscreen(root)
        }
      }
    }
    revealControls()
  }

  const runFullscreenOperation = (operation: () => Promise<void>): Promise<void> => {
    if (fullscreenOperation.current) return fullscreenOperation.current
    const task = Capacitor.isNativePlatform() && runTransition
      ? runTransition(operation) : operation()
    fullscreenOperation.current = task
    void task.then(() => {
      if (fullscreenOperation.current === task) fullscreenOperation.current = null
    }, () => { if (fullscreenOperation.current === task) fullscreenOperation.current = null })
    return task
  }
  const toggleFullscreen = () => runFullscreenOperation(performFullscreenToggle)

  toggleFullscreenRef.current = toggleFullscreen

  useEffect(() => {
    setSessionImmersive?.(immersive)
  }, [immersive, setSessionImmersive])

  useEffect(() => bindSessionRuntime?.({
    pause: () => { resumeBlockedRef.current = true; videoRef.current?.pause() },
    dismissOverlay: () => dismissOverlay(),
    exitFullscreen: async () => {
      if (fullscreenOperation.current) await fullscreenOperation.current
      if (rootRef.current?.dataset.videoFullscreen === 'true') await toggleFullscreenRef.current()
    },
  }), [bindSessionRuntime])

  const floatPlayer = async () => {
    const generation = lifecycleGeneration.current
    if (immersive) await toggleFullscreen()
    if (generation !== lifecycleGeneration.current || !rootRef.current) return
    setRateMenuOpen(false)
    setResourceMenuOpen(false)
    updateVideoView(DEFAULT_VIDEO_VIEW)
    presentation?.float()
  }

  const applyRate = (next: number) => {
    rateRef.current = next
    setRate(next)
    const video = videoRef.current
    if (video) {
      video.defaultPlaybackRate = next
      if (!applyPlaybackRate(video, next)) {
        setHint('当前视频暂不支持此播放速度')
      }
    }
    setRateMenuOpen(false)
    revealControls()
  }

  const startBoost = () => {
    const video = videoRef.current
    if (!video || video.paused || fatal) return
    gestureRef.current.boosted = true
    if (!applyPlaybackRate(video, BOOST_RATE)) {
      gestureRef.current.boosted = false
      setBoosting(false)
      setHint(`当前视频暂不支持 ${BOOST_RATE}x 播放`)
      revealControls()
      return
    }
    setHint(null)
    syncBoostIndicator(video)
    setControlsVisible(false)
    clearHideTimer()
  }

  const endBoost = () => {
    if (!gestureRef.current.boosted) return
    gestureRef.current.boosted = false
    const video = videoRef.current
    if (video) applyPlaybackRate(video, rateRef.current)
    setBoosting(false)
    revealControls()
  }

  const clearGestureTimers = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const showHud = (hud: GestureHud) => {
    if (hudTimerRef.current != null) {
      window.clearTimeout(hudTimerRef.current)
      hudTimerRef.current = null
    }
    setGestureHud(hud)
  }

  const fadeHud = () => {
    if (hudTimerRef.current != null) window.clearTimeout(hudTimerRef.current)
    hudTimerRef.current = window.setTimeout(() => {
      hudTimerRef.current = null
      setGestureHud(null)
    }, HUD_LINGER_MS)
  }

  const showViewHud = (view: VideoViewState) => {
    showHud({ kind: 'zoom', scale: view.scale, rotation: view.rotation })
  }



  const rotateVideoView = () => runFullscreenOperation(async () => {
    const root = rootRef.current
    if (!root) return
    const generation = lifecycleGeneration.current
    const current = () => generation === lifecycleGeneration.current && rootRef.current === root
    if (!immersive) {
      // 内嵌态点旋转：先进全屏并套用默认旋转模式，不额外循环
      if (!await enterPlayerFullscreen(root) || !current()) return
      const mode = defaultRotationMode(mediaSize.width, mediaSize.height)
      if (mode) await applyRotationMode(mode)
      if (!current()) return
      revealControls()
      return
    }

    // 全屏内循环切换旋转模式：锁横 → 跟随设备 → 锁竖
    const nextMode = nextRotationMode(rotationModeRef.current)
    const applied = await applyRotationMode(nextMode)
    if (!current()) return
    showHud({ kind: 'mode', label: ROTATION_MODE_LABEL[nextMode] })
    fadeHud()
    if (!applied && nextMode !== 'sensor') {
      // 浏览器没有方向锁定能力：沿用 CSS 旋转兜底
      const currentView = videoViewRef.current
      const rotation = normalizeVideoRotation(currentView.rotation + 90)
      const pan = clampVideoPan(
        currentView.x,
        currentView.y,
        videoSurfaceForRotation(viewport, rotation),
        mediaSize,
        currentView.scale,
      )
      const next = { ...currentView, ...pan, rotation }
      updateVideoView(next)
      showViewHud(next)
      fadeHud()
    }
    revealControls()
  })

  // 宿主页面读取该句柄：返回键在全屏时先退出全屏，而不是关闭文章
  useEffect(() => {
    if (!fullscreenHandleRef) return
    const handle: InkVideoPlayerFullscreenHandle = {
      immersive,
      exit: () => {
        if (immersive) toggleFullscreenRef.current()
      },
    }
    fullscreenHandleRef.current = handle
    onFullscreenChange?.()
    return () => {
      if (fullscreenHandleRef.current === handle) fullscreenHandleRef.current = null
      onFullscreenChange?.()
    }
  }, [fullscreenHandleRef, immersive, onFullscreenChange])

  const pointerPair = () => {
    const pointers = Array.from(activePointersRef.current.values())
    if (pointers.length < 2) return null
    const [first, second] = pointers
    return {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midpoint: {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      },
    }
  }

  const pointerLocation = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const physicalSurface = { width: rect.width, height: rect.height }
    const point = videoPointForRotation(
      event.clientX - rect.left,
      event.clientY - rect.top,
      physicalSurface,
      videoViewRef.current.rotation,
    )
    return {
      point,
      surface: videoSurfaceForRotation(physicalSurface, videoViewRef.current.rotation),
    }
  }

  /**
   * 档位写入是异步的（原生桥或元素音量），滑动过程中只保留最后一个目标值，
   * 避免每个 pointermove 都排队一次调用。
   */
  const commitLevel = (kind: 'volume' | 'brightness', value: number) => {
    const queue = levelWriteRef.current
    queue.pending = { kind, value }
    if (queue.busy) return
    queue.busy = true
    void (async () => {
      while (queue.pending != null) {
        const next = queue.pending
        queue.pending = null
        const applied = await levelControl(next.kind).write(next.value)
        showHud({ kind: next.kind, value: applied })
      }
      queue.busy = false
      // 松手后最后一次异步写入会取消 fade 定时器，这里重新排程淡出
      if (!levelingRef.current) fadeHud()
    })()
  }

  /** 全屏下半屏才接管滑动；竖屏内嵌播放器保持原有的点按语义。 */
  const lockGesture = (gesture: GestureState, dx: number, dy: number) => {
    const axis = resolveGesture(dx, dy, gesture.localX, gesture.surface)
    if (axis === 'none') return
    gesture.axis = axis
    levelingRef.current = axis === 'volume' || axis === 'brightness'
    const video = videoRef.current
    gesture.fromTime = video ? video.currentTime : 0
    gesture.fromLevel =
      axis === 'volume'
        ? levelsRef.current.volume
        : axis === 'brightness'
          ? levelsRef.current.brightness
          : 0
    setControlsVisible(false)
    clearHideTimer()
    setRateMenuOpen(false)
  }

  const trackGesture = (gesture: GestureState, dx: number, dy: number) => {
    if (gesture.axis === 'seek') {
      const video = videoRef.current
      const total = video && Number.isFinite(video.duration) ? video.duration : 0
      const offset = seekOffsetSeconds(dx, gesture.surface.width, total)
      showHud({
        kind: 'seek',
        target: clampSeekTarget(gesture.fromTime, offset, total),
        offset,
      })
      return
    }

    const kind = gesture.axis === 'volume' ? 'volume' : 'brightness'
    const next = clampLevel(gesture.fromLevel + levelOffset(dy, gesture.surface.height))
    levelsRef.current[kind] = next
    commitLevel(kind, next)
  }

  /** 松手才真正跳转，滑动过程中只做预览，避免 HLS 反复起播。 */
  const finishGesture = (gesture: GestureState, dx: number) => {
    if (gesture.axis === 'seek') {
      const video = videoRef.current
      const total = video && Number.isFinite(video.duration) ? video.duration : 0
      if (video && total > 0) {
        const offset = seekOffsetSeconds(dx, gesture.surface.width, total)
        const target = clampSeekTarget(gesture.fromTime, offset, total)
        video.currentTime = target
        setCurrent(target)
      }
    }
    levelingRef.current = false
    fadeHud()
  }

  /**
   * 触摸落下时再对齐一次真实档位：音量可能刚被物理按键改过。
   * 读取是异步的，手势一旦锁定方向就以自己的连续值为准，不再回填。
   */
  const syncLevels = (gesture: GestureState) => {
    void (async () => {
      const [volume, brightness] = await Promise.all([
        volumeControl.read(),
        brightnessControl.read(),
      ])
      if (gestureRef.current !== gesture || gesture.axis !== 'none') return
      levelsRef.current = { volume, brightness }
    })()
  }

  const onGesturePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compactRef.current) return
    if (fatal) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const { point, surface } = pointerLocation(event)
    activePointersRef.current.set(event.pointerId, point)
    if (activePointersRef.current.size >= 2) {
      const pair = pointerPair()
      if (!pair) return
      multiTouchRef.current = true
      clearGestureTimers()
      endBoost()
      gestureRef.current.moved = true
      gestureRef.current.axis = 'none'
      pinchRef.current = {
        ...pair,
        view: videoViewRef.current,
      }
      setViewInteracting(true)
      setControlsVisible(false)
      setRateMenuOpen(false)
      clearHideTimer()
      return
    }
    const gesture: GestureState = {
      ...IDLE_GESTURE,
      x: point.x,
      y: point.y,
      localX: point.x,
      at: Date.now(),
      thumb: immersive && isThumbZone(point.y, surface.height),
      surface,
      fromView: videoViewRef.current,
    }
    gestureRef.current = gesture
    clearGestureTimers()
    if (videoViewRef.current.scale === 1) {
      longPressTimerRef.current = window.setTimeout(startBoost, LONG_PRESS_MS)
    }
    if (gesture.thumb) syncLevels(gesture)
  }

  const onGesturePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { point } = pointerLocation(event)
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, point)
    }
    if (multiTouchRef.current) {
      const pair = pointerPair()
      const pinch = pinchRef.current
      if (!pair || !pinch) return
      const scale = pinchScale(pinch.view.scale, pinch.distance, pair.distance)
      const pan = clampVideoPan(
        pinch.view.x + pair.midpoint.x - pinch.midpoint.x,
        pinch.view.y + pair.midpoint.y - pinch.midpoint.y,
        videoSurfaceForRotation(viewport, pinch.view.rotation),
        mediaSize,
        scale,
      )
      const next = { ...pinch.view, ...pan, scale }
      updateVideoView(next)
      showViewHud(next)
      return
    }

    const gesture = gestureRef.current
    if (gesture.boosted) return

    const dx = point.x - gesture.x
    const dy = point.y - gesture.y

    if (!gesture.moved && Math.hypot(dx, dy) > TAP_SLOP_PX) {
      gesture.moved = true
      clearGestureTimers()
    }
    if (!gesture.thumb) return

    if (gesture.axis === 'none') lockGesture(gesture, dx, dy)
    if (gesture.axis === 'none') return
    trackGesture(gesture, dx, dy)
  }

  const onGesturePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (compactRef.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const { point } = pointerLocation(event)
    activePointersRef.current.delete(event.pointerId)
    clearGestureTimers()
    if (multiTouchRef.current) {
      if (activePointersRef.current.size < 2) {
        pinchRef.current = null
        multiTouchRef.current = false
        setViewInteracting(false)
      }
      if (activePointersRef.current.size === 0) {
        fadeHud()
        revealControls()
      } else {
        const [remaining] = activePointersRef.current.values()
        if (remaining) {
          const surface = videoSurfaceForRotation(viewport, videoViewRef.current.rotation)
          gestureRef.current = {
            ...IDLE_GESTURE,
            x: remaining.x,
            y: remaining.y,
            localX: remaining.x,
            at: Date.now(),
            thumb: immersive && isThumbZone(remaining.y, surface.height),
            surface,
            fromView: videoViewRef.current,
          }
          if (gestureRef.current.thumb) syncLevels(gestureRef.current)
        }
      }
      return
    }
    const gesture = gestureRef.current
    if (gesture.boosted) {
      endBoost()
      return
    }
    if (gesture.axis !== 'none') {
      finishGesture(gesture, point.x - gesture.x)
      gesture.axis = 'none'
      return
    }
    if (gesture.moved || fatal) return

    const now = Date.now()

    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0
      if (tapTimerRef.current != null) {
        window.clearTimeout(tapTimerRef.current)
        tapTimerRef.current = null
      }
      void togglePlay()
      return
    }

    lastTapRef.current = now
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null
      if (rateMenuOpen) {
        setRateMenuOpen(false)
        return
      }
      if (showChromeRef.current) {
        setControlsVisible(false)
        clearHideTimer()
      } else {
        revealControls()
      }
    }, DOUBLE_TAP_MS)
  }

  const onGesturePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    activePointersRef.current.clear()
    pinchRef.current = null
    multiTouchRef.current = false
    setViewInteracting(false)
    clearGestureTimers()
    const gesture = gestureRef.current
    if (gesture.axis !== 'none') {
      // 取消不提交进度，只收掉 HUD
      gesture.axis = 'none'
      levelingRef.current = false
      fadeHud()
    }
    endBoost()
  }

  const progress = duration > 0 ? current / duration : 0
  const bufferRatio = duration > 0 ? Math.min(1, buffered / duration) : 0
  const showChrome = (controlsVisible || !playing || scrubbing) && !boosting
  const statusMessage = getVideoStatusMessage({
    ready,
    fatal,
    scrubbing,
    waiting,
    seeking,
  })
  const orientedViewport = videoSurfaceForRotation(viewport, videoView.rotation)

  showChromeRef.current = showChrome

  return (
    <>
      <div
      ref={rootRef}
      // 播放器控件叠在画面上，始终按深色配色渲染
      data-theme="dark"
      // 播放器内的横滑属于播放手势，阅读页的滑动返回不应再接管
      data-video-gestures=""
      data-no-font-pinch=""
      data-video-fullscreen={immersive ? 'true' : undefined}
      data-video-compact={compact ? 'true' : undefined}
      style={fallbackFullscreen && presentation ? { zIndex: 130 } : undefined}
      className={`overflow-hidden border border-haze bg-ink-deep ${
        fallbackFullscreen ? 'fixed inset-0 z-[100] border-0' : ''
      } ${
        immersive ? 'rounded-none' : 'rounded-2xl'
      }`}
    >
      <div
        ref={stageRef}
        data-video-stage=""
        className={`relative overflow-hidden bg-black ${immersive ? 'h-full min-h-[240px]' : 'reader-video-aspect'}`}
      >
        <div
          data-video-rotation={videoView.rotation}
          className="absolute left-1/2 top-1/2 overflow-hidden bg-black"
          style={{
            width: orientedViewport.width > 0 ? `${orientedViewport.width}px` : '100%',
            height: orientedViewport.height > 0 ? `${orientedViewport.height}px` : '100%',
            transform: `translate(-50%, -50%) rotate(${videoView.rotation}deg)`,
            transition: 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
          }}
        >
        <video
          ref={videoRef}
          className="ink-video-player-media h-full w-full object-contain will-change-transform"
          style={{
            transform: `translate3d(${videoView.x}px, ${videoView.y}px, 0) scale(${videoView.scale})`,
            transition: viewInteracting ? 'none' : 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
          }}
          poster={poster}
          playsInline
          preload="metadata"
          controls={false}
          disablePictureInPicture
          title={title}
        />

        {ready && !fatal && (
          <div
            ref={gestureSurfaceRef}
            data-video-gesture-surface=""
            className="absolute inset-0 z-[1] touch-none select-none"
          onPointerDown={onGesturePointerDown}
          onClick={compact ? () => {
            if (showChromeRef.current) {
              clearHideTimer()
              setControlsVisible(false)
            } else {
              revealControls()
            }
          } : undefined}
            onPointerMove={onGesturePointerMove}
            onPointerUp={onGesturePointerUp}
            onPointerCancel={onGesturePointerCancel}
            onContextMenu={(event) => event.preventDefault()}
          />
        )}

        {scrim > 0 && (
          <div
            className="pointer-events-none absolute inset-0 z-[2] bg-black"
            style={{ opacity: scrim }}
          />
        )}

        {ready && !fatal && (
          <div
            onPointerDown={(event) => {
              event.stopPropagation()
              revealControls()
            }}
            className={`ink-video-top-chrome pointer-events-none absolute inset-x-0 top-0 z-[6] flex items-center justify-between bg-gradient-to-b from-black/75 via-black/30 to-transparent transition-opacity duration-200 ${showChrome ? 'opacity-100' : 'opacity-0'}`}
          >
            <div className={`flex items-center gap-1 ${showChrome ? 'pointer-events-auto' : ''}`}>
              {immersive && (
                <button
                  type="button"
                  aria-label="退出全屏"
                  onClick={(e) => { e.stopPropagation(); void toggleFullscreen(); }}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <ChevronLeft size={24} strokeWidth={2} />
                </button>
              )}
              <div className="truncate text-[15px] font-medium tracking-wide text-paper/95 drop-shadow-md">
                {title || '文章视频'}
              </div>
            </div>

            <div className={`flex items-center gap-3 pr-2 text-paper/90 ${showChrome ? 'pointer-events-auto' : ''}`}>
              {presentation && <button type="button" aria-label="悬浮播放" title="悬浮播放" onClick={() => void floatPlayer()} className="flex h-10 w-10 items-center justify-center rounded-full active:bg-paper/15"><PictureInPicture2 size={18} /></button>}
              <span className="text-[13px] font-medium tracking-wide drop-shadow-md tabular-nums">{clock}</span>
              <button
                type="button"
                className={`flex h-8 w-8 items-center justify-center rounded-full active:bg-paper/15 ${
                  castSession ? 'bg-paper/15 text-paper' : ''
                }`}
                aria-label={castSession ? `正在投屏到 ${castSession.deviceName}` : '投屏'}
                title={castSession ? `正在投屏到 ${castSession.deviceName}` : '投屏'}
                onClick={(event) => {
                  event.stopPropagation()
                  openCastPicker()
                }}
              >
                <Cast size={18} strokeWidth={2} />
              </button>
              <PlayerBatteryIcon status={battery} />
            </div>
          </div>
        )}

        {ready && !fatal && !playing && !waiting && showChrome && (
          <button
            type="button"
            aria-label="播放"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              void togglePlay()
            }}
            className="ink-video-abs-center z-[5] flex h-14 w-14 items-center justify-center rounded-full border border-paper/20 bg-black/45 text-paper shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md"
          >
            <Play size={25} strokeWidth={1.6} className="ml-1" fill="currentColor" fillOpacity={0.16} />
          </button>
        )}

        {gestureHud && <GestureHudOverlay hud={gestureHud} duration={duration} />}

        {boosting && (
          <div
            className="pointer-events-none absolute inset-x-0 z-[2] flex justify-center"
            style={{ top: 'calc(var(--sat, 0px) + 12px)' }}
          >
            <span className="inline-block whitespace-nowrap rounded-full bg-ink-raised/85 px-3 py-1 text-[11px] leading-none text-paper">
              {BOOST_RATE}x 快进中
            </span>
          </div>
        )}

        {playerToast && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[76px] z-[9] flex justify-center px-4">
            <div
              role="status"
              aria-live="polite"
              className="rounded-full bg-black/85 px-4 py-2 text-[12px] font-medium text-paper shadow-xl"
            >
              {playerToast}
            </div>
          </div>
        )}

        {statusMessage && (
          <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center bg-black/35">
            <div className="flex items-center gap-2 rounded-full bg-ink-raised/85 px-3 py-2 text-[12px] text-paper">
              <LoaderCircle className="h-4 w-4 animate-spin text-paper/80" strokeWidth={1.8} />
              <span>{statusMessage}</span>
            </div>
          </div>
        )}

        {fatal && (
          <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-2 bg-black/70 px-4 text-center">
            <AlertCircle className="h-6 w-6 text-cinnabar-soft" strokeWidth={1.6} />
            <div className="text-[13px] text-paper">{fatal}</div>
            {presentation?.detached && <div className="text-[11px] text-paper/65">地址可能已失效，请返回来源页重新探测</div>}
            {onRefreshSource && (
              <button
                type="button"
                className="rounded-full border border-paper/30 px-3 py-1.5 text-[12px] text-paper"
                onClick={(event) => {
                  event.stopPropagation()
                  onRefreshSource()
                }}
              >
                重新探测
              </button>
            )}
          </div>
        )}

        {presentation && !compact && (!ready || fatal) && <button type="button" aria-label="悬浮播放" title="悬浮播放" onClick={() => void floatPlayer()} className="absolute right-2 top-2 z-[7] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-paper"><PictureInPicture2 size={18} /></button>}

        {ready && !fatal && (
          <div
            onPointerDown={(event) => {
              event.stopPropagation()
              revealControls()
            }}
            className={`ink-video-bottom-chrome pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/95 via-black/50 to-transparent transition-opacity duration-200 ${showChrome ? 'opacity-100' : 'opacity-0'}`}
          >
            {/* Seek Bar Row */}
            <div className={`flex items-center gap-3 mb-1 touch-none ${showChrome ? 'pointer-events-auto' : ''}`}>
              <span className="video-time text-[11px] font-mono tracking-wide text-paper/90 shrink-0 tabular-nums">
                {formatTime(current)}
              </span>
              <div className="relative flex-1 h-5 flex items-center">
                <div className="ink-video-y-center absolute inset-x-0 h-[3px] overflow-hidden rounded-full bg-paper/20">
                  <div
                    className="absolute inset-y-0 left-0 bg-paper/40"
                    style={{ width: `${bufferRatio * 100}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-cinnabar"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={Number.isFinite(current) ? current : 0}
                  disabled={!duration}
                  aria-label="播放进度"
                  className="ink-seek absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
                  onPointerDown={() => setScrubbingState(true)}
                  onPointerUp={(event) => onSeekCommit(Number(event.currentTarget.value))}
                  onChange={(event) => onSeekInput(Number(event.currentTarget.value))}
                  onKeyUp={(event) => {
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                      onSeekCommit(Number(event.currentTarget.value))
                    }
                  }}
                  onClick={(event) => {
                    onSeekCommit(Number(event.currentTarget.value))
                  }}
                />
              </div>
              <span className="video-time text-[11px] font-mono tracking-wide text-paper/90 shrink-0 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls Row */}
            <div className={`flex items-center justify-between mt-1 pb-1 ${showChrome ? 'pointer-events-auto' : ''}`}>
              <div className="flex items-center gap-1 sm:gap-3">
                <button
                  type="button"
                  aria-label={playing ? '暂停' : '播放'}
                  onClick={() => void togglePlay()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper transition-colors active:bg-paper/15"
                >
                  {playing ? (
                    <Pause size={20} strokeWidth={2} fill="currentColor" fillOpacity={0.2} />
                  ) : (
                    <Play size={20} strokeWidth={2} className="ml-0.5" fill="currentColor" fillOpacity={0.2} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSeekCommit(Math.max(0, current - 15))}
                  className="video-extended-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <SkipBack size={18} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => onSeekCommit(Math.min(duration, current + 15))}
                  className="video-extended-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <SkipForward size={18} strokeWidth={2} />
                </button>

                <button
                  type="button"
                  aria-label="锁定控制"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="video-extended-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <LockOpen size={17} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="video-extended-control hidden px-1 text-[13px] font-medium text-paper/80 sm:inline-block"
                >
                  片头
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="video-extended-control hidden px-1 text-[13px] font-medium text-paper/80 sm:inline-block"
                >
                  片尾
                </button>

                {/* Rate Menu */}
                <div className="video-extended-control relative ml-1">
                  <button
                    type="button"
                    aria-label="播放速度"
                    aria-expanded={rateMenuOpen}
                    onClick={() => {
                      setRateMenuOpen((open) => !open)
                      revealControls()
                    }}
                    className="flex h-10 min-w-10 items-center justify-center rounded-full px-2 font-mono text-[13px] tracking-wide text-paper transition-colors active:bg-paper/15"
                  >
                    x{Number.isInteger(rate) ? rate.toFixed(1) : rate}
                  </button>
                  {rateMenuOpen && (
                    <div className="absolute bottom-full left-0 mb-2 flex min-w-[64px] flex-col overflow-hidden rounded-xl border border-haze bg-ink-raised/95 shadow-lg">
                      {PLAYBACK_RATES.map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => applyRate(value)}
                          className={`px-3 py-1.5 text-center font-mono text-[12px] ${
                            value === rate ? 'text-cinnabar-soft' : 'text-paper/80'
                          }`}
                        >
                          {value}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 pr-1">
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="video-extended-control hidden rounded-full border border-paper/40 px-3 py-1 text-[12px] tracking-wide text-paper/95 whitespace-nowrap sm:inline-block"
                >
                  极速播
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="video-extended-control hidden whitespace-nowrap px-2 text-[13px] font-medium tracking-wide text-paper/95 sm:inline-block"
                >
                  选集
                </button>

                <button
                  type="button"
                  aria-label={rotationMode ? `旋转模式：${ROTATION_MODE_LABEL[rotationMode]}，点击切换` : '切换横竖屏'}
                  title={rotationMode ? ROTATION_MODE_LABEL[rotationMode] : '切换横竖屏'}
                  onClick={() => void rotateVideoView()}
                  className="video-extended-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <RotateCw size={17} strokeWidth={2} />
                </button>

                <button
                  type="button"
                  aria-label={immersive ? '退出全屏' : '全屏'}
                  onClick={() => void toggleFullscreen()}
                  className="video-fullscreen-control flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  {immersive ? (
                    <Minimize2 size={18} strokeWidth={2} />
                  ) : (
                    <Maximize2 size={18} strokeWidth={2} />
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {hint && (
        <div className="border-t border-haze px-3 py-2 text-[11px] leading-relaxed text-paper-muted">
          {hint}
        </div>
      )}
    </div>
    {typeof document !== 'undefined' && createPortal(
      <MediaResourceOverlay
        resources={resourceOptions}
        open={resourceMenuOpen}
        immersive={immersive}
        suppressFab={suppressResourceFab || compact || (globalVideoSurface && presentation?.mode === 'inline')}
        layer={presentation ? 140 : undefined}
        onToggle={() => {
          setResourceMenuOpen((open) => !open)
          revealControls()
        }}
        onSelect={(resource) => {
          onSelectResource?.(resource)
          setResourceMenuOpen(false)
          revealControls()
        }}
      />,
      document.body,
      )}
    {typeof document !== 'undefined' && createPortal(
      <CastOverlay
        open={castOpen}
        devices={castDevices}
        searching={castSearching}
        connectingId={castConnectingId}
        error={castError || castSessionError}
        session={castSession}
        status={castStatus}
        fallbackDuration={duration}
        onClose={() => setCastOpen(false)}
        onRefresh={() => void refreshCastDevices()}
        onConnect={(device) => void connectCastDevice(device)}
        onControl={(action, value) => void sendCastControl(action, value)}
        onStop={() => void endCast()}
      />,
      document.body,
    )}
    </>
  )
}

