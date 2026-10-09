export type PackageFlavor = 'cloud' | 'local'
export type AndroidAbi = 'arm64-v8a' | 'armeabi-v7a' | 'x86' | 'x86_64'

/**
 * 更新订阅通道只属于发布基础设施。
 * 业务功能不得根据该值做功能开关；stable/main 与 beta/beta 分支的代码差异由 Git 分支承载。
 */
export type UpdateTrack = 'stable' | 'beta'

export type UpdateTrackPrefs = {
  skippedVersion?: string
  snoozeUntil?: number
  lastCheckAt?: number
  availableVersion?: string
}

export type AppUpdatePrefs = {
  track: UpdateTrack
  tracks: Record<UpdateTrack, UpdateTrackPrefs>
}

/** GDIFF 以源 APK 的精确 SHA-256 寻址，与业务变体和包体大小无关。 */
export type UpdateDelta = {
  algorithm: 'gdiff-gzip-v1'
  fromSha256: string
  fileName: string
  url: string
  sha256: string
  size: number
}

export type LatestReleaseInfo = {
  version: string
  tagName: string
  notes: string
  apkUrl: string
  apkFileName: string
  sha256?: string
  size?: number
  deltas?: UpdateDelta[]
  flavor: PackageFlavor
  /** local APK 命中的设备 ABI；undefined 表示 cloud 或 universal fallback。 */
  abi?: AndroidAbi
  /** APK 实际来自哪个发布通道。 */
  track: UpdateTrack
  /** 用户订阅的更新通道；必须与 APK 实际发布通道一致。 */
  subscriptionTrack: UpdateTrack
}

export type UpdateCheckResult =
  | { status: 'up-to-date'; localVersion: string; remoteVersion: string; track: UpdateTrack }
  | { status: 'available'; localVersion: string; release: LatestReleaseInfo }
  | {
      status: 'no-asset'
      localVersion: string
      remoteVersion: string
      flavor: PackageFlavor
      track: UpdateTrack
    }
  | { status: 'error'; message: string }

export type FetchReleaseApkResult =
  | { status: 'ok'; release: LatestReleaseInfo }
  | { status: 'no-asset'; version: string; flavor: PackageFlavor; track: UpdateTrack }
  | { status: 'error'; message: string }

export type ReleaseNotesResult =
  | { status: 'ok'; version: string; tagName: string; body: string }
  | { status: 'empty'; version: string; tagName: string }
  | { status: 'error'; message: string }
