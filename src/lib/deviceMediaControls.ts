import { Capacitor, registerPlugin } from '@capacitor/core'

import { clampLevel } from './videoGestures'

interface DeviceMediaControlsPlugin {
  getBrightness(): Promise<{ value: number }>
  setBrightness(options: { value: number }): Promise<{ value: number }>
  clearBrightness(): Promise<void>
  getVolume(): Promise<{ value: number }>
  setVolume(options: { value: number }): Promise<{ value: number }>
  getBattery(): Promise<{ level: number; charging: boolean }>
  lockOrientation(options: { orientation: VideoScreenOrientation }): Promise<void>
  unlockOrientation(): Promise<void>
  setVideoFullscreen(options: { active: boolean }): Promise<void>
}

/** portrait / landscape 为锁定方向；sensor 跟随设备横竖屏（覆盖系统自动旋转开关） */
export type VideoScreenOrientation = 'portrait' | 'landscape' | 'sensor'

const DeviceMediaControls = registerPlugin<DeviceMediaControlsPlugin>('DeviceMediaControls')

/** 真机才有原生实现；浏览器与未重新编译的旧包都走 Web 兜底。 */
function nativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('DeviceMediaControls')
}

/**
 * Switch the Android Activity into/out of the video immersive state.
 * Returns false only when the current binary does not expose the native method,
 * allowing callers to retain a compatibility fallback for older installations.
 */
export async function setVideoFullscreen(active: boolean): Promise<boolean> {
  if (!nativeAvailable()) return false
  try {
    await DeviceMediaControls.setVideoFullscreen({ active })
    return true
  } catch {
    return false
  }
}

interface LockableScreenOrientation {
  lock?: (orientation: VideoScreenOrientation) => Promise<void>
  unlock?: () => void
}

function webScreenOrientation(): LockableScreenOrientation | null {
  if (typeof screen === 'undefined') return null
  return screen.orientation as unknown as LockableScreenOrientation
}

/**
 * 优先请求 Android Activity 真正旋转，让系统导航栏、手势区和安全区一起换边。
 * 浏览器实现仅作渐进增强；两条路径都失败时由播放器保留 CSS 旋转兜底。
 */
export async function lockVideoScreenOrientation(
  orientation: VideoScreenOrientation,
): Promise<boolean> {
  if (nativeAvailable()) {
    try {
      await DeviceMediaControls.lockOrientation({ orientation })
      return true
    } catch {
      return false
    }
  }

  // 浏览器没有「跟随设备」可锁：解锁方向锁即回到系统默认行为，视为成功
  if (orientation === 'sensor') {
    try {
      webScreenOrientation()?.unlock?.()
    } catch {
      /* ignore */
    }
    return true
  }

  const controller = webScreenOrientation()
  if (!controller?.lock) return false
  try {
    await controller.lock(orientation)
    return true
  } catch {
    return false
  }
}

/** 退出播放器全屏时归还方向控制权，不把阅读页锁死在横屏。 */
export async function unlockVideoScreenOrientation(): Promise<void> {
  if (nativeAvailable()) {
    try {
      await DeviceMediaControls.unlockOrientation()
    } catch {
      /* 旧安装包尚未包含此方法时安全降级。 */
    }
    return
  }

  try {
    webScreenOrientation()?.unlock?.()
  } catch {
    /* 浏览器可能在离开全屏后自动解锁，视为已完成。 */
  }
}

/**
 * 0~1 的可调档位。全屏手势只依赖这个抽象：
 * 有原生插件时调系统亮度 / 媒体音量，否则退回蒙层与 video 元素音量。
 */
export interface LevelControl {
  /** 手势开始前读取基准值。 */
  read(): Promise<number>
  /** 返回实际生效的值（系统音量是有级的，可能与请求值不同）。 */
  write(next: number): Promise<number>
  /** 退出全屏时归还控制权。 */
  release(): void
}

/** 屏幕最低不压到全黑，否则用户看不到把亮度调回来的手势区。 */
const MIN_BRIGHTNESS = 0.02
/** 蒙层兜底时最多压暗到这个程度，保留可辨识的画面。 */
const MAX_SCRIM = 0.82

/**
 * @param applyScrim 蒙层兜底的渲染回调，入参为 0~1 的压暗程度。
 */
export function createBrightnessControl(applyScrim: (dim: number) => void): LevelControl {
  if (!nativeAvailable()) {
    let level = 1
    return {
      async read() {
        return level
      },
      async write(next) {
        level = clampLevel(next)
        applyScrim((1 - level) * MAX_SCRIM)
        return level
      },
      release() {
        level = 1
        applyScrim(0)
      },
    }
  }

  return {
    async read() {
      try {
        const { value } = await DeviceMediaControls.getBrightness()
        return clampLevel(value)
      } catch {
        return 1
      }
    },
    async write(next) {
      const target = Math.max(MIN_BRIGHTNESS, clampLevel(next))
      try {
        const { value } = await DeviceMediaControls.setBrightness({ value: target })
        return clampLevel(value)
      } catch {
        return target
      }
    },
    release() {
      void DeviceMediaControls.clearBrightness().catch(() => {})
    },
  }
}

/**
 * 音量优先走系统媒体音量：只改 video 元素音量的话，系统音量本身很低时
 * 用户把手势拉满仍然听不见，体验是坏的。
 *
 * @param resolveVideo 兜底路径需要的当前 video 元素。
 */
export function createVolumeControl(
  resolveVideo: () => HTMLVideoElement | null,
): LevelControl {
  const writeElement = (next: number): number => {
    const video = resolveVideo()
    const level = clampLevel(next)
    if (!video) return level
    try {
      video.volume = level
      // 上滑找回声音时不该被静音状态挡住
      if (level > 0 && video.muted) video.muted = false
      if (level === 0) video.muted = true
    } catch {
      /* 部分 WebView 只读，忽略 */
    }
    return level
  }

  if (!nativeAvailable()) {
    return {
      async read() {
        const video = resolveVideo()
        if (!video) return 1
        return video.muted ? 0 : clampLevel(video.volume)
      },
      async write(next) {
        return writeElement(next)
      },
      release() {},
    }
  }

  return {
    async read() {
      try {
        const { value } = await DeviceMediaControls.getVolume()
        return clampLevel(value)
      } catch {
        const video = resolveVideo()
        return video ? clampLevel(video.volume) : 1
      }
    },
    async write(next) {
      const target = clampLevel(next)
      try {
        const { value } = await DeviceMediaControls.setVolume({ value: target })
        const applied = clampLevel(value)
        // 系统音量已经打开时，元素自身不能还停在静音上
        const video = resolveVideo()
        if (video && applied > 0 && video.muted) video.muted = false
        return applied
      } catch {
        return writeElement(target)
      }
    },
    release() {},
  }
}

/** Sticky battery intent; returns null on Web / older APKs without getBattery. */
export async function getNativeBattery(): Promise<{ level: number; charging: boolean } | null> {
  if (!nativeAvailable()) return null
  try {
    const result = await DeviceMediaControls.getBattery()
    return {
      level: clampLevel(result.level),
      charging: Boolean(result.charging),
    }
  } catch {
    return null
  }
}
