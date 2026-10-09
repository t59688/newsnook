/**
 * 播放器纯逻辑：格式判定、倍速/手势常量、旋转模式与视图/手势状态模型。
 * 不含 React 依赖，供 InkVideoPlayer 主组件与 HUD 子组件共用。
 */

import type { VideoGesture, VideoRotation } from '../../lib/videoGestures'

export type PlayableFormat = 'progressive' | 'hls' | 'dash'

/** 全屏旋转模式：锁定横屏 / 跟随设备 / 锁定竖屏 */
export type RotationMode = 'landscape' | 'sensor' | 'portrait'

export const ROTATION_MODE_LABEL: Record<RotationMode, string> = {
  landscape: '锁定横屏',
  sensor: '跟随设备',
  portrait: '锁定竖屏',
}

/** 旋转按钮循环：锁定横屏 → 跟随设备 → 锁定竖屏 → 锁定横屏 */
export function nextRotationMode(mode: RotationMode | null): RotationMode {
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
export function defaultRotationMode(width: number, height: number): RotationMode | null {
  if (width > height) return 'landscape'
  if (height > width) return 'sensor'
  return null
}

export function playableFormatForUrl(url: string, format?: PlayableFormat): PlayableFormat {
  if (format) return format
  if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls'
  if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash'
  return 'progressive'
}

export const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const
/** 长按临时倍速；松手回落到用户选定倍速 */
export const BOOST_RATE = 2.5
export const LONG_PRESS_MS = 380
export const DOUBLE_TAP_MS = 320
export const TAP_SLOP_PX = 12
export const RATE_EPSILON = 0.01
/** 手指离开后 HUD 再停留一瞬，便于确认调到了哪一档。 */
export const HUD_LINGER_MS = 460

export type GestureHud =
  | { kind: 'seek'; target: number; offset: number }
  | { kind: 'volume' | 'brightness'; value: number }
  | { kind: 'zoom'; scale: number; rotation: VideoRotation }
  | { kind: 'mode'; label: string }

export interface VideoViewState {
  scale: number
  x: number
  y: number
  rotation: VideoRotation
}

export interface PinchState {
  distance: number
  midpoint: { x: number; y: number }
  view: VideoViewState
}

export const DEFAULT_VIDEO_VIEW: VideoViewState = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
}

export interface GestureState {
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

export const IDLE_GESTURE: GestureState = {
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

export function hasPlaybackRate(video: HTMLVideoElement, expected: number): boolean {
  return Math.abs(video.playbackRate - expected) < RATE_EPSILON
}

export function applyPlaybackRate(video: HTMLVideoElement, next: number): boolean {
  try {
    video.playbackRate = next
  } catch {
    return false
  }
  return hasPlaybackRate(video, next)
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
