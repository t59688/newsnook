import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type Hls from 'hls.js'
import {
  AlertCircle,
  ChevronsLeft,
  ChevronsRight,
  LoaderCircle,
  ListVideo,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCw,
  Scan,
  Sun,
  LockOpen,
  SkipBack,
  SkipForward,
  Cast,
  ChevronLeft,
  RefreshCw,
  Tv2,
  X,
  VolumeX,
  Volume2,
} from 'lucide-react'

import { subscribeBatteryStatus, type BatteryStatus } from '../lib/batteryStatus'
import {
  browserMediaProxyUrl,
  createHotlinkHlsLoader,
  needsMediaHotlinkBypass,
} from '../lib/mediaFetch'
import { setNativeFullScreen } from '../lib/nativeChrome'
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
  discoverDlnaDevices,
  isDlnaCastAvailable,
  startDlnaCast,
  type DlnaCastDevice,
  type DlnaCastSession,
  type DlnaCastStatus,
} from '../lib/dlnaCast'
import {
  controlActiveDlnaCast,
  setActiveDlnaCast,
  stopActiveDlnaCast,
  useDlnaCastSession,
} from '../features/cast/session'
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
  type VideoGesture,
  type VideoRotation,
} from '../lib/videoGestures'
import { Capacitor } from '@capacitor/core'
import {
  nativeStreamProxyUrl,
  prepareNativeMediaPlayback,
} from '../features/mediaSniffer/native'
import type { MediaResourceDescriptor } from '../features/mediaSniffer/types'

interface Props {
  src: string
  poster?: string
  title?: string
  format?: 'progressive' | 'hls' | 'dash'
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
}

/** 宿主页面可读取的全屏句柄：immersive 表示当前是否全屏，exit 请求退出全屏。 */
export interface InkVideoPlayerFullscreenHandle {
  immersive: boolean
  exit: () => void
}

/** 全屏旋转模式：锁定横屏 / 跟随设备 / 锁定竖屏 */
type RotationMode = 'landscape' | 'sensor' | 'portrait'

const ROTATION_MODE_LABEL: Record<RotationMode, string> = {
  landscape: '锁定横屏',
  sensor: '跟随设备',
  portrait: '锁定竖屏',
}

/** 旋转按钮循环：锁定横屏 → 跟随设备 → 锁定竖屏 → 锁定横屏 */
function nextRotationMode(mode: RotationMode | null): RotationMode {
  switch (mode) {
    case 'landscape':
      return 'sensor'
    case 'sensor':
      return 'portrait'
    default:
      return 'landscape'
  }
}

/** 进入全屏的默认旋转模式：横屏视频锁横屏，竖屏视频跟随设备，未知尺寸不动方向 */
function defaultRotationMode(width: number, height: number): RotationMode | null {
  if (width > height) return 'landscape'
  if (height > width) return 'sensor'
  return null
}

function playableFormatForUrl(url: string, format?: Props['format']): NonNullable<Props['format']> {
  if (format) return format
  if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls'
  if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash'
  return 'progressive'
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
/** 长按临时倍速；松手回落到用户选定倍速 */
const BOOST_RATE = 2.5
const LONG_PRESS_MS = 380
const DOUBLE_TAP_MS = 320
const TAP_SLOP_PX = 12
const RATE_EPSILON = 0.01
/** 手指离开后 HUD 再停留一瞬，便于确认调到了哪一档。 */
const HUD_LINGER_MS = 460

type GestureHud =
  | { kind: 'seek'; target: number; offset: number }
  | { kind: 'volume' | 'brightness'; value: number }
  | { kind: 'zoom'; scale: number; rotation: VideoRotation }
  | { kind: 'mode'; label: string }

interface VideoViewState {
  scale: number
  x: number
  y: number
  rotation: VideoRotation
}

interface PinchState {
  distance: number
  midpoint: { x: number; y: number }
  view: VideoViewState
}

const DEFAULT_VIDEO_VIEW: VideoViewState = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
}

interface GestureState {
  /** 视口坐标，用于计算位移 */
  x: number
  y: number
  /** 播放器内坐标，用于判定左右半屏与拇指区 */
  localX: number
  at: number
  moved: boolean
  boosted: boolean
  /** 起点是否落在全屏拇指手势区 */
  thumb: boolean
  axis: VideoGesture
  surface: { width: number; height: number }
  fromTime: number
  fromLevel: number
  fromView: VideoViewState
}

const IDLE_GESTURE: GestureState = {
  x: 0,
  y: 0,
  localX: 0,
  at: 0,
  moved: false,
  boosted: false,
  thumb: false,
  axis: 'none',
  surface: { width: 0, height: 0 },
  fromTime: 0,
  fromLevel: 1,
  fromView: DEFAULT_VIDEO_VIEW,
}

function hasPlaybackRate(video: HTMLVideoElement, expected: number): boolean {
  return Math.abs(video.playbackRate - expected) < RATE_EPSILON
}

function applyPlaybackRate(video: HTMLVideoElement, next: number): boolean {
  try {
    video.playbackRate = next
  } catch {
    return false
  }
  return hasPlaybackRate(video, next)
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
export function InkVideoPlayer({ src, poster, title, format, sourcePage, requestHeaders, extraUrls, resources, deferLoad, onUnlocked, onRefreshSource, onPlaybackError, fullscreenHandleRef }: Props) {
  const [allowed, setAllowed] = useState(!deferLoad)
  const [selectedResource, setSelectedResource] = useState<MediaResourceDescriptor | null>(null)
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

  useEffect(() => {
    setSelectedResource(null)
  }, [src, resources])

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
        className="reader-deferred-host aspect-video"
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
  return <InkVideoPlayerReady
    key={`${active?.id || active?.type || format || 'media'}:${active?.url || src}`}
    src={active?.url || src}
    poster={poster}
    title={title}
    format={active?.type || format}
    sourcePage={active?.pageUrl || sourcePage}
    requestHeaders={active?.requestHeaders || requestHeaders}
    extraUrls={activeExtraUrls.length ? activeExtraUrls : undefined}
    resources={resourceOptions}
    onSelectResource={setSelectedResource}
    onRefreshSource={onRefreshSource}
    onPlaybackError={onPlaybackError}
    fullscreenHandleRef={fullscreenHandleRef}
  />
}

function InkVideoPlayerReady({ src, poster, title, format, sourcePage, requestHeaders, extraUrls, resources, onSelectResource, onRefreshSource, onPlaybackError, fullscreenHandleRef }: Props & { onSelectResource?: (resource: MediaResourceDescriptor) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
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
  const toggleFullscreenRef = useRef<() => void>(() => {})
  const lastTapRef = useRef(0)
  const showChromeRef = useRef(true)
  const castSessionRef = useRef<DlnaCastSession | null>(null)
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
  const [castOpen, setCastOpen] = useState(false)
  const [castDevices, setCastDevices] = useState<DlnaCastDevice[]>([])
  const [castSearching, setCastSearching] = useState(false)
  const [castConnectingId, setCastConnectingId] = useState<string | null>(null)
  const [castError, setCastError] = useState<string | null>(null)
  const {
    session: castSession,
    status: castStatus,
    error: castSessionError,
  } = useDlnaCastSession()
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
  const resourceOptions = resources?.length ? resources : []

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

  const refreshCastDevices = useCallback(async () => {
    if (!isDlnaCastAvailable()) {
      setCastError('投屏仅支持 Android 真机')
      return
    }
    setCastSearching(true)
    setCastError(null)
    try {
      const devices = await discoverDlnaDevices()
      setCastDevices(devices)
    } catch (error) {
      setCastDevices([])
      setCastError(error instanceof Error ? error.message : '搜索投屏设备失败')
    } finally {
      setCastSearching(false)
    }
  }, [])

  const openCastPicker = useCallback(() => {
    if (!isDlnaCastAvailable()) {
      showPlayerToast('投屏仅支持 Android 真机')
      return
    }
    setCastError(null)
    setCastOpen(true)
    if (!castSessionRef.current) void refreshCastDevices()
  }, [refreshCastDevices, showPlayerToast])

  const connectCastDevice = useCallback(async (device: DlnaCastDevice) => {
    const castFormat = playableFormatForUrl(src, format)
    if (castFormat === 'dash') {
      setCastError('DASH 视频源暂不支持投屏')
      return
    }

    setCastConnectingId(device.id)
    setCastError(null)
    try {
      // Refresh the native playback context before the TV starts requesting the
      // temporary relay URL. This preserves Referer/Cookie/proxy information
      // captured for custom CMS sources.
      await prepareNativeMediaPlayback({
        url: src,
        sourcePage,
        format: castFormat,
        headers: requestHeaders,
        extraUrls,
        forceBridge: true,
      })

      const video = videoRef.current
      const positionSeconds = video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : current
      const session = await startDlnaCast({
        deviceId: device.id,
        url: src,
        title: title || '文章视频',
        format: castFormat,
        positionSeconds,
      })

      const initialStatus: DlnaCastStatus = {
        state: 'playing',
        current: positionSeconds,
        duration,
        deviceName: session.deviceName,
      }
      castSessionRef.current = session
      setActiveDlnaCast(session, initialStatus)
      video?.pause()
      if (immersive) toggleFullscreenRef.current()
    } catch (error) {
      setCastError(error instanceof Error ? error.message : '无法开始投屏')
    } finally {
      setCastConnectingId(null)
    }
  }, [current, duration, extraUrls, format, immersive, requestHeaders, sourcePage, src, title])

  const sendCastControl = useCallback(async (
    action: 'play' | 'pause' | 'seek' | 'volume',
    value?: number,
  ) => {
    if (!castSessionRef.current) return
    setCastError(null)
    await controlActiveDlnaCast(action, value)
  }, [])

  const endCast = useCallback(async () => {
    castSessionRef.current = null
    setCastError(null)
    setCastOpen(false)
    try {
      await stopActiveDlnaCast()
    } catch {
      // The renderer may already be offline; native cleanup still runs when possible.
    }
    showPlayerToast('已结束投屏')
  }, [showPlayerToast])

  useEffect(() => {
    castSessionRef.current = castSession
  }, [castSession])

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
      rotationModeRef.current = mode
      setRotationMode(mode)
      const applied = await lockVideoScreenOrientation(mode)
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
    setRotationMode(null)
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
    let cancelled = false
    let progressiveBridgeAttempted = false
    let progressiveProxyUrl: string | null = null
    let directRetryAttempted = false
    let progressiveRecoveryInFlight = false
    let progressiveRecoveryTimer: ReturnType<typeof window.setTimeout> | undefined
    const effectiveHeaders: Record<string, string> = { ...requestHeaders }
    if (sourcePage && !Object.keys(effectiveHeaders).some((key) => key.toLowerCase() === 'referer')) {
      try {
        if (new URL(url).origin !== new URL(sourcePage).origin) {
          effectiveHeaders.Referer = sourcePage
        }
      } catch {
        // ignore
      }
    }
    const failPlayback = (message: string) => {
      if (cancelled) return
      setFatal(message)
      onPlaybackError?.()
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
    setCurrent(0)
    setDuration(0)
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
    }
    const loadProgressiveSource = () => {
      video.src = progressiveProxyUrl || url
      video.load()
    }

    const onFatalMedia = () => {
      if (cancelled || progressiveRecoveryInFlight) return
      if (
        Capacitor.isNativePlatform()
        && !isHls
        && !isDash
        && progressiveBridgeAttempted
        && !directRetryAttempted
      ) {
        directRetryAttempted = true
        setWaiting(true)
        armProgressiveRecovery()
        void prepareNativeMediaPlayback({
          url,
          sourcePage,
          format: 'progressive',
          headers: effectiveHeaders,
          extraUrls,
          forceBridge: true,
        }).then(async () => {
          if (cancelled) return
          settleProgressiveRecovery()
          setFatal(null)
          progressiveProxyUrl = await nativeStreamProxyUrl(
            url,
            `recover-${Date.now().toString(36)}`,
          )
          if (cancelled) return
          loadProgressiveSource()
        }).catch(() => {
          if (!cancelled) failPlayback('瑙嗛婧愭殏鏃舵棤娉曟挱鏀?')
        })
        return
      }
      if (
        Capacitor.isNativePlatform()
        && !isHls
        && !isDash
        && !progressiveBridgeAttempted
      ) {
        progressiveBridgeAttempted = true
        setWaiting(true)
        armProgressiveRecovery()
        void prepareNativeMediaPlayback({
          url,
          sourcePage,
          format: 'progressive',
          headers: effectiveHeaders,
          extraUrls,
          forceBridge: true,
        }).then(async () => {
          if (cancelled) return
          settleProgressiveRecovery()
          setFatal(null)
          progressiveProxyUrl = await nativeStreamProxyUrl(
            url,
            `retry-${Date.now().toString(36)}`,
          )
          if (cancelled) return
          loadProgressiveSource()
        }).catch(() => {
          if (!cancelled) failPlayback('视频源暂时无法播放')
        })
        return
      }
      failPlayback('视频源暂时无法播放')
    }
    const onPlay = () => {
      setPlaying(true)
      setHint(null)
    }
    const onPause = () => {
      setPlaying(false)
      setControlsVisible(true)
      clearHideTimer()
    }
    const onTime = () => {
      if (!scrubbingRef.current) setCurrent(video.currentTime)
    }
    const onMeta = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration)
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setMediaSize({ width: video.videoWidth, height: video.videoHeight })
      }
      markReady()
    }
    const onDuration = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration)
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
      progressiveBridgeAttempted = await prepareNativeMediaPlayback({
        url,
        sourcePage,
        format: isDash ? 'dash' : isHls ? 'hls' : 'progressive',
        headers: effectiveHeaders,
        extraUrls,
        forceBridge: !isHls && !isDash && needsMediaHotlinkBypass(url),
      })
      if (cancelled) return
      const requestContext = sourcePage || Object.keys(effectiveHeaders).length > 0
        ? { sourcePage, headers: effectiveHeaders }
        : undefined
      const bypass = needsMediaHotlinkBypass(url)
        || Boolean(isHls && sourcePage && !Capacitor.isNativePlatform())
        || Boolean(isHls && progressiveBridgeAttempted && Capacitor.isNativePlatform())
      // Android 原生 MediaPlayer 的 HLS 分片请求不走 WebView 拦截，
      // 无法注入自定义 headers，必须走 hls.js + XHR 由 WebViewClient 补齐
      const useNativeHls = !bypass && Boolean(video.canPlayType('application/vnd.apple.mpegurl'))
      const HlsClass =
        isHls && !useNativeHls ? (await import('hls.js')).default : null
      if (cancelled) return
      if (!isDash && !isHls && progressiveBridgeAttempted) {
        progressiveProxyUrl = await nativeStreamProxyUrl(
          url,
          `play-${Date.now().toString(36)}`,
        )
        if (cancelled) return
      }

      if (isDash) {
        const module = await import('dashjs')
        if (cancelled) return
        const dash = module.MediaPlayer().create()
        dashRef.current = dash
        dash.initialize(video, url, false)
      } else if (isHls) {
        if (useNativeHls) {
          video.src = url
        } else if (HlsClass?.isSupported()) {
          const hls = new HlsClass({
            enableWorker: true,
            lowLatencyMode: false,
            ...(bypass ? { loader: createHotlinkHlsLoader(requestContext) } : {}),
          })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(HlsClass.Events.MANIFEST_PARSED, markReady)
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (!data.fatal || cancelled) return
            if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad()
              return
            }
            if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError()
              return
            }
            failPlayback('视频流加载失败')
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
      cancelled = true
      settleProgressiveRecovery()
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
      video.removeAttribute('src')
      video.load()
    }
  }, [clearHideTimer, extraUrls, format, onPlaybackError, requestHeaders, sourcePage, src, syncBoostIndicator])

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
    // Entry/exit are awaited in toggleFullscreen so the Activity transition is
    // ordered. This cleanup only covers unmount/source replacement while fullscreen.
    return () => {
      if (!Capacitor.isNativePlatform()) return
      void setVideoFullscreen(false).then((applied) => {
        if (!applied) void setNativeFullScreen(false)
      })
    }
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
      activePointersRef.current.clear()
      pinchRef.current = null
      // Leaving the player only detaches this UI. Television playback belongs to
      // the renderer (direct) or the foreground relay service (compatibility mode).
      castSessionRef.current = null
      // 卸载时若仍在全屏，窗口亮度必须归还系统，否则整个应用会一直停在调暗状态
      brightnessControl.release()
      volumeControl.release()
      void releasePlayerScreenOrientation()
    },
    [brightnessControl, releasePlayerScreenOrientation, volumeControl],
  )

  const playWithFallback = async () => {
    const video = videoRef.current
    if (!video) return

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
    // Capacitor owns the Android window. Hide bars before the fixed player is
    // promoted to fullscreen so there is no frame where transparent system-bar
    // icons can sit on top of the video. DOM Fullscreen remains web-only.
    if (Capacitor.isNativePlatform()) {
      const applied = await setVideoFullscreen(true)
      if (!applied) await setNativeFullScreen(true)
      setFallbackFullscreen(true)
      return
    }

    try {
      await root.requestFullscreen()
    } catch {
      setFallbackFullscreen(true)
    }
  }

  const toggleFullscreen = async () => {
    const root = rootRef.current
    if (!root) return
    const exiting = fallbackFullscreen || document.fullscreenElement === root
    if (fallbackFullscreen) {
      if (Capacitor.isNativePlatform()) {
        const applied = await setVideoFullscreen(false)
        if (!applied) await setNativeFullScreen(false)
      }
      setFallbackFullscreen(false)
      updateVideoView(DEFAULT_VIDEO_VIEW)
    } else if (document.fullscreenElement === root) {
      try {
        await document.exitFullscreen()
      } catch {
        // Keep the current browser fullscreen state if the platform rejects exit.
      }
    } else {
      await enterPlayerFullscreen(root)
    }

    if (exiting) {
      await releasePlayerScreenOrientation()
      updateVideoView(DEFAULT_VIDEO_VIEW)
    } else {
      // 默认：横屏视频锁横屏，竖屏视频跟随设备（见 defaultRotationMode）
      const mode = defaultRotationMode(mediaSize.width, mediaSize.height)
      if (mode) {
        await applyRotationMode(mode)
        if (Capacitor.isNativePlatform()) {
          const applied = await setVideoFullscreen(true)
          if (!applied) await setNativeFullScreen(true)
        }
      }
    }
    revealControls()
  }

  toggleFullscreenRef.current = () => {
    void toggleFullscreen()
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



  const rotateVideoView = async () => {
    const root = rootRef.current
    if (!root) return
    if (!immersive) {
      // 内嵌态点旋转：先进全屏并套用默认旋转模式，不额外循环
      await enterPlayerFullscreen(root)
      const mode = defaultRotationMode(mediaSize.width, mediaSize.height)
      if (mode) await applyRotationMode(mode)
      revealControls()
      return
    }

    // 全屏内循环切换旋转模式：锁横 → 跟随设备 → 锁竖
    const nextMode = nextRotationMode(rotationModeRef.current)
    const applied = await applyRotationMode(nextMode)
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
  }

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
    return () => {
      if (fullscreenHandleRef.current === handle) fullscreenHandleRef.current = null
    }
  }, [fullscreenHandleRef, immersive])

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

  const onGesturePointerCancel = () => {
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
      className={`overflow-hidden border border-haze bg-ink-deep ${
        fallbackFullscreen ? 'fixed inset-0 z-[100] border-0' : ''
      } ${
        immersive ? 'rounded-none' : 'rounded-2xl'
      }`}
    >
      <div
        ref={stageRef}
        className={`relative overflow-hidden bg-black ${immersive ? 'h-full min-h-[240px]' : 'aspect-video'}`}
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
            data-video-gesture-surface=""
            className="absolute inset-0 z-[1] touch-none select-none"
            onPointerDown={onGesturePointerDown}
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
              <span className="text-[11px] font-mono tracking-wide text-paper/90 shrink-0 tabular-nums">
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
              <span className="text-[11px] font-mono tracking-wide text-paper/90 shrink-0 tabular-nums">
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
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <SkipBack size={18} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => onSeekCommit(Math.min(duration, current + 15))}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <SkipForward size={18} strokeWidth={2} />
                </button>
                
                <button
                  type="button"
                  aria-label="锁定控制"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <LockOpen size={17} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="hidden px-1 text-[13px] font-medium text-paper/80 sm:inline-block"
                >
                  片头
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="hidden px-1 text-[13px] font-medium text-paper/80 sm:inline-block"
                >
                  片尾
                </button>

                {/* Rate Menu */}
                <div className="relative ml-1">
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
                  className="hidden rounded-full border border-paper/40 px-3 py-1 text-[12px] tracking-wide text-paper/95 whitespace-nowrap sm:inline-block"
                >
                  极速播
                </button>
                <button
                  type="button"
                  onClick={() => showPlayerToast('功能开发中')}
                  className="hidden whitespace-nowrap px-2 text-[13px] font-medium tracking-wide text-paper/95 sm:inline-block"
                >
                  选集
                </button>

                <button
                  type="button"
                  aria-label={rotationMode ? `旋转模式：${ROTATION_MODE_LABEL[rotationMode]}，点击切换` : '切换横竖屏'}
                  title={rotationMode ? ROTATION_MODE_LABEL[rotationMode] : '切换横竖屏'}
                  onClick={() => void rotateVideoView()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
                >
                  <RotateCw size={17} strokeWidth={2} />
                </button>

                <button
                  type="button"
                  aria-label={immersive ? '退出全屏' : '全屏'}
                  onClick={() => void toggleFullscreen()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper/90 transition-colors active:bg-paper/15"
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

function MediaResourceOverlay({
  resources,
  open,
  immersive,
  onToggle,
  onSelect,
}: {
  resources: MediaResourceDescriptor[]
  open: boolean
  immersive: boolean
  onToggle: () => void
  onSelect: (resource: MediaResourceDescriptor) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onToggle])

  if (!resources.length || immersive) return null

  return (
    <>
      {!open && (
        <button
          type="button"
          data-no-page-tap=""
          aria-label={`选择视频资源，共 ${resources.length} 个`}
          aria-expanded={false}
          title={`视频资源（${resources.length}）`}
          onClick={onToggle}
          className="fixed z-[100] flex items-center gap-2 rounded-full border border-haze bg-ink/95 px-3.5 py-2 text-paper shadow-xl shadow-black/35 backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
          style={{
            bottom: 'calc(var(--sab, 0px) + 76px)',
            right: 'calc(var(--sar, 0px) + 1rem)',
          }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar">
            <ListVideo size={13} strokeWidth={2} />
          </span>
          <span className="font-mono text-[12px] font-medium tracking-[0.03em]">嗅探 {resources.length}</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
          role="presentation"
          data-no-page-tap=""
          onClick={onToggle}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`已嗅探到 ${resources.length} 个资源`}
            className="flex max-h-[min(78vh,520px)] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-haze" />
            </div>
            <h3 className="shrink-0 border-b border-haze/50 px-5 pt-3 pb-3 font-display text-[17px] font-medium text-paper">
              已嗅探到 {resources.length} 个资源
            </h3>
            <ul className="scroll-hidden min-h-0 flex-1 divide-y divide-haze overflow-y-auto overscroll-contain">
              {resources.map((resource, index) => {
                const label = resource.type === 'hls' ? 'HLS' : resource.type === 'dash' ? 'DASH' : 'MP4'
                const detail = resource.videoTracks.find((track) => track.width || track.height)
                return (
                  <li key={`${resource.id || resource.url}:${index}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(resource)}
                      className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-paper transition-colors hover:bg-paper/5 active:bg-paper/10"
                    >
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-paper/10 font-mono text-[10px]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px]">
                          <span className="font-medium">{label}</span>
                          {resource.isAd && (
                            <span className="rounded bg-cinnabar/20 px-1 text-[9px] text-cinnabar-soft">广告</span>
                          )}
                          {detail && (
                            <span className="text-paper/50">
                              {detail.width || '?'}×{detail.height || '?'}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-paper/50">{resource.url}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

function CastOverlay({
  open,
  devices,
  searching,
  connectingId,
  error,
  session,
  status,
  fallbackDuration,
  onClose,
  onRefresh,
  onConnect,
  onControl,
  onStop,
}: {
  open: boolean
  devices: DlnaCastDevice[]
  searching: boolean
  connectingId: string | null
  error: string | null
  session: DlnaCastSession | null
  status: DlnaCastStatus | null
  fallbackDuration: number
  onClose: () => void
  onRefresh: () => void
  onConnect: (device: DlnaCastDevice) => void
  onControl: (action: 'play' | 'pause' | 'seek' | 'volume', value?: number) => void
  onStop: () => void
}) {
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)

  useEffect(() => {
    if (!open) {
      setSeekDraft(null)
      setVolumeDraft(null)
    }
  }, [open])

  if (!open) return null

  const total = Math.max(0, status?.duration || fallbackDuration || 0)
  const remoteCurrent = Math.max(0, Math.min(total || Number.MAX_SAFE_INTEGER, status?.current || 0))
  const seekValue = seekDraft ?? remoteCurrent
  const volumeValue = volumeDraft ?? status?.volume ?? 0
  const stateLabel =
    status?.state === 'playing'
      ? '播放中'
      : status?.state === 'paused'
        ? '已暂停'
        : status?.state === 'transitioning'
          ? '加载中'
          : status?.state === 'stopped'
            ? '已停止'
            : '已连接'

  const commitSeek = (value: number) => {
    setSeekDraft(null)
    onControl('seek', value)
  }
  const commitVolume = (value: number) => {
    setVolumeDraft(null)
    onControl('volume', value)
  }

  return (
    <div
      data-theme="dark"
      data-no-page-tap=""
      className="fixed inset-0 z-[140] flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={session ? '投屏遥控器' : '选择投屏设备'}
        className="w-full max-w-md overflow-hidden rounded-t-3xl border border-haze bg-ink-raised text-paper shadow-2xl md:rounded-3xl"
        style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-haze/60 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper/10 text-paper">
            <Cast size={18} strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-medium">
              {session ? session.deviceName : '投屏到设备'}
            </h3>
            <p className="mt-0.5 text-[11px] text-paper/55">
              {session ? stateLabel : '搜索同一局域网内的电视和播放器'}
            </p>
          </div>
          {!session && (
            <button
              type="button"
              aria-label="重新搜索"
              disabled={searching}
              onClick={onRefresh}
              className="flex size-9 items-center justify-center rounded-full text-paper/80 active:bg-paper/10 disabled:opacity-40"
            >
              <RefreshCw size={17} className={searching ? 'animate-spin' : ''} />
            </button>
          )}
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full text-paper/80 active:bg-paper/10"
          >
            <X size={19} />
          </button>
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-xl border border-cinnabar/30 bg-cinnabar/10 px-3 py-2 text-[12px] leading-relaxed text-cinnabar-soft">
            {error}
          </div>
        )}

        {!session ? (
          <div className="max-h-[58vh] overflow-y-auto overscroll-contain px-3 py-3">
            {searching && devices.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-paper/60">
                <LoaderCircle size={22} className="animate-spin" />
                <span className="text-[12px]">正在搜索局域网投屏设备…</span>
              </div>
            )}

            {!searching && devices.length === 0 && (
              <div className="flex min-h-36 flex-col items-center justify-center gap-2 px-6 text-center text-paper/55">
                <Tv2 size={28} strokeWidth={1.5} />
                <p className="text-[12px] leading-relaxed">
                  未发现可投屏设备。请确认手机和电视连接同一局域网，并在电视上开启投屏或 DLNA。
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              {devices.map((device) => {
                const connecting = connectingId === device.id
                const details = [device.manufacturer, device.model]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <button
                    key={device.id}
                    type="button"
                    disabled={Boolean(connectingId)}
                    onClick={() => onConnect(device)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors active:bg-paper/10 disabled:opacity-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-paper/10">
                      <Tv2 size={20} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{device.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-paper/50">
                        {details || device.address}
                      </span>
                    </span>
                    {connecting ? (
                      <LoaderCircle size={18} className="animate-spin text-paper/70" />
                    ) : (
                      <Cast size={17} className="text-paper/45" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="px-5 py-5">
            <div className="mb-4 rounded-2xl border border-paper/10 bg-paper/5 px-3.5 py-3">
              <div className="text-[12px] font-medium text-paper/90">
                {session.mode === 'direct' ? '电视独立播放' : '兼容模式'}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-paper/55">
                {session.mode === 'direct'
                  ? '电视已直接连接视频源。手机可以熄屏、退出应用或关机，不影响电视继续播放。'
                  : '当前视频需要手机兼容中转。可以熄屏或退出应用，请保持手机开机并连接当前 Wi-Fi。'}
              </p>
            </div>

            <div className="rounded-2xl bg-black/25 px-4 py-4">
              <input
                type="range"
                min={0}
                max={total || 0}
                step={1}
                disabled={!total}
                value={Number.isFinite(seekValue) ? seekValue : 0}
                aria-label="电视播放进度"
                className="ink-seek h-6 w-full appearance-none bg-transparent"
                onChange={(event) => setSeekDraft(Number(event.currentTarget.value))}
                onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
                onKeyUp={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    commitSeek(Number(event.currentTarget.value))
                  }
                }}
              />
              <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-paper/55">
                <span>{formatTime(seekValue)}</span>
                <span>{formatTime(total)}</span>
              </div>

              <div className="mt-4 flex items-center justify-center gap-5">
                <button
                  type="button"
                  aria-label="后退 15 秒"
                  onClick={() => onControl('seek', Math.max(0, remoteCurrent - 15))}
                  className="flex size-12 items-center justify-center rounded-full bg-paper/10 text-paper active:bg-paper/15"
                >
                  <SkipBack size={20} />
                </button>
                <button
                  type="button"
                  aria-label={status?.state === 'playing' ? '暂停电视播放' : '继续电视播放'}
                  onClick={() => onControl(status?.state === 'playing' ? 'pause' : 'play')}
                  className="flex size-16 items-center justify-center rounded-full bg-paper text-ink-deep active:scale-95"
                >
                  {status?.state === 'playing' ? (
                    <Pause size={25} fill="currentColor" fillOpacity={0.2} />
                  ) : (
                    <Play size={26} className="ml-1" fill="currentColor" fillOpacity={0.2} />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="前进 15 秒"
                  onClick={() => onControl('seek', Math.min(total || remoteCurrent + 15, remoteCurrent + 15))}
                  className="flex size-12 items-center justify-center rounded-full bg-paper/10 text-paper active:bg-paper/15"
                >
                  <SkipForward size={20} />
                </button>
              </div>

              {status?.volume != null && (
                <div className="mt-5 flex items-center gap-3">
                  <Volume2 size={17} className="shrink-0 text-paper/60" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={Math.max(0, Math.min(1, volumeValue))}
                    aria-label="电视音量"
                    className="ink-seek h-6 min-w-0 flex-1 appearance-none bg-transparent"
                    onChange={(event) => setVolumeDraft(Number(event.currentTarget.value))}
                    onPointerUp={(event) => commitVolume(Number(event.currentTarget.value))}
                    onKeyUp={(event) => {
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        commitVolume(Number(event.currentTarget.value))
                      }
                    }}
                  />
                  <span className="w-9 text-right font-mono text-[11px] text-paper/55">
                    {Math.round(volumeValue * 100)}%
                  </span>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onStop}
              className="mt-4 w-full rounded-2xl border border-paper/15 py-3 text-[13px] font-medium text-paper/80 active:bg-paper/10"
            >
              结束投屏
            </button>
          </div>
        )}
      </section>
    </div>
  )
}

function LevelBar({ value }: { value: number }) {
  return (
    <div className="h-[3px] w-24 overflow-hidden rounded-full bg-paper/25">
      <div className="h-full rounded-full bg-paper" style={{ width: `${value * 100}%` }} />
    </div>
  )
}

function HudShell({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
      <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-ink-raised/85 px-4 py-2.5">
        {children}
      </div>
    </div>
  )
}

/** 全屏手势的即时反馈：进度预览、音量与亮度档位。 */
function GestureHudOverlay({ hud, duration }: { hud: GestureHud; duration: number }) {
  if (hud.kind === 'zoom') {
    return (
      <HudShell>
        <div className="flex items-center gap-2 text-paper">
          <Scan size={17} strokeWidth={1.8} />
          <span className="font-mono text-[14px] leading-none">
            {Math.round(hud.scale * 100)}%
          </span>
          {hud.rotation !== 0 && (
            <span className="font-mono text-[11px] leading-none text-cinnabar-soft">
              {hud.rotation}°
            </span>
          )}
        </div>
        <span className="text-[10px] leading-none text-paper/55">
          双指缩放/移动 · 单指亮度/音量/进度
        </span>
      </HudShell>
    )
  }

  if (hud.kind === 'mode') {
    return (
      <HudShell>
        <div className="flex items-center gap-2 text-paper">
          <RotateCw size={16} strokeWidth={1.8} />
          <span className="text-[13px] leading-none">{hud.label}</span>
        </div>
        <span className="text-[10px] leading-none text-paper/55">再次点击切换旋转模式</span>
      </HudShell>
    )
  }

  if (hud.kind === 'seek') {
    const seconds = Math.round(hud.offset)
    return (
      <HudShell>
        <div className="flex items-center gap-1.5 font-mono text-[15px] leading-none text-paper">
          {seconds < 0 ? (
            <ChevronsLeft size={16} strokeWidth={1.8} />
          ) : (
            <ChevronsRight size={16} strokeWidth={1.8} />
          )}
          <span>{formatTime(hud.target)}</span>
          <span className="text-paper/55">/ {formatTime(duration)}</span>
        </div>
        <span className="font-mono text-[11px] leading-none text-cinnabar-soft">
          {seconds >= 0 ? `+${seconds}` : seconds}s
        </span>
      </HudShell>
    )
  }

  const percent = Math.round(hud.value * 100)
  return (
    <HudShell>
      <div className="flex items-center gap-2 text-paper">
        {hud.kind === 'brightness' ? (
          <Sun size={16} strokeWidth={1.8} />
        ) : hud.value === 0 ? (
          <VolumeX size={16} strokeWidth={1.8} />
        ) : (
          <Volume2 size={16} strokeWidth={1.8} />
        )}
        <LevelBar value={hud.value} />
        <span className="w-8 text-right font-mono text-[11px] leading-none">{percent}%</span>
      </div>
    </HudShell>
  )
}

/** Lucide Battery 几何内的比例填充，充电时叠闪电。 */
function PlayerBatteryIcon({ status }: { status: BatteryStatus | null }) {
  const level = status?.level ?? null
  const charging = Boolean(status?.charging)
  const fill = level == null ? 0 : Math.max(0, Math.min(1, level))
  const low = level != null && level <= 0.2 && !charging
  const label =
    level == null
      ? '电量未知'
      : `电量 ${Math.round(level * 100)}%${charging ? '，充电中' : ''}`

  return (
    <span
      className="relative inline-flex h-8 w-8 items-center justify-center text-paper/90"
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="7" width="16" height="10" rx="2" ry="2" />
        <line x1="22" x2="22" y1="11" y2="13" />
        {level != null && fill > 0 && (
          <rect
            x="4"
            y="9"
            width={Math.max(1.2, fill * 12)}
            height="6"
            rx="0.8"
            fill={low ? 'var(--cinnabar, #c45c4a)' : 'currentColor'}
            stroke="none"
          />
        )}
      </svg>
      {charging && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
          fill="currentColor"
          aria-hidden
        >
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
      )}
    </span>
  )
}
