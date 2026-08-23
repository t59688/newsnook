import { Capacitor, registerPlugin } from '@capacitor/core'

export interface DlnaCastDevice {
  id: string
  name: string
  manufacturer?: string
  model?: string
  address: string
  supportsVolume: boolean
}

export type DlnaCastState =
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'transitioning'
  | 'unknown'

export type DlnaCastMode = 'direct' | 'proxy'

export interface DlnaCastSession {
  id: string
  deviceId: string
  deviceName: string
  mode: DlnaCastMode
}

export interface DlnaCastStatus {
  state: DlnaCastState
  current: number
  duration: number
  volume?: number
  deviceName: string
}

export interface DlnaCastRestoreResult {
  session?: DlnaCastSession
  status?: DlnaCastStatus
}

type CastFormat = 'progressive' | 'hls' | 'dash'
type CastAction = 'play' | 'pause' | 'seek' | 'volume'

interface DlnaCastPlugin {
  discover(options: { timeoutMs: number }): Promise<{ devices: DlnaCastDevice[] }>
  start(options: {
    deviceId: string
    url: string
    title?: string
    format: CastFormat
    positionSeconds?: number
  }): Promise<DlnaCastSession>
  restore(): Promise<DlnaCastRestoreResult>
  getStatus(options: { sessionId: string }): Promise<DlnaCastStatus>
  control(options: {
    sessionId: string
    action: CastAction
    value?: number
  }): Promise<void>
  stop(options: { sessionId: string }): Promise<void>
}

const NativeDlnaCast = registerPlugin<DlnaCastPlugin>('DlnaCast')

export function isDlnaCastAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('DlnaCast')
}

function requireNativeCast(): void {
  if (!isDlnaCastAvailable()) {
    throw new Error('投屏仅支持 Android 真机')
  }
}

export async function discoverDlnaDevices(timeoutMs = 2600): Promise<DlnaCastDevice[]> {
  requireNativeCast()
  const result = await NativeDlnaCast.discover({ timeoutMs })
  return Array.isArray(result.devices) ? result.devices : []
}

export async function startDlnaCast(options: {
  deviceId: string
  url: string
  title?: string
  format: CastFormat
  positionSeconds?: number
}): Promise<DlnaCastSession> {
  requireNativeCast()
  return NativeDlnaCast.start(options)
}

export async function restoreDlnaCast(): Promise<DlnaCastRestoreResult> {
  if (!isDlnaCastAvailable()) return {}
  return NativeDlnaCast.restore()
}

export async function getDlnaCastStatus(sessionId: string): Promise<DlnaCastStatus> {
  requireNativeCast()
  return NativeDlnaCast.getStatus({ sessionId })
}

export async function controlDlnaCast(
  sessionId: string,
  action: CastAction,
  value?: number,
): Promise<void> {
  requireNativeCast()
  await NativeDlnaCast.control({
    sessionId,
    action,
    ...(value == null ? {} : { value }),
  })
}

export async function stopDlnaCast(sessionId: string): Promise<void> {
  if (!isDlnaCastAvailable()) return
  await NativeDlnaCast.stop({ sessionId })
}
