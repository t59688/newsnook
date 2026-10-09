import { getNativeBattery } from './deviceMediaControls'

export interface BatteryStatus {
  /** 0–1，与系统 BatteryManager / Battery Status API 一致 */
  level: number
  charging: boolean
}

type BatteryManagerLike = {
  level: number
  charging: boolean
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void
  removeEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void
}

const NATIVE_POLL_MS = 15_000

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function normalize(status: BatteryStatus): BatteryStatus {
  return {
    level: clampLevel(status.level),
    charging: Boolean(status.charging),
  }
}

async function readWebBattery(): Promise<BatteryManagerLike | null> {
  const getBattery = (
    navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }
  ).getBattery
  if (typeof getBattery !== 'function') return null
  try {
    return await getBattery.call(navigator)
  } catch {
    return null
  }
}

/**
 * Subscribe to battery level / charging changes.
 * Prefers the Web Battery Status API; falls back to native sticky intent polling on Android.
 */
export function subscribeBatteryStatus(
  onChange: (status: BatteryStatus) => void,
): () => void {
  let cancelled = false
  let cleanup = () => {}

  void (async () => {
    const web = await readWebBattery()
    if (cancelled) return

    if (web) {
      const emit = () => {
        onChange(normalize({ level: web.level, charging: web.charging }))
      }
      emit()
      web.addEventListener('levelchange', emit)
      web.addEventListener('chargingchange', emit)
      cleanup = () => {
        web.removeEventListener('levelchange', emit)
        web.removeEventListener('chargingchange', emit)
      }
      return
    }

    const emitNative = async () => {
      const status = await getNativeBattery()
      if (!cancelled && status) onChange(normalize(status))
    }

    await emitNative()
    if (cancelled) return

    const timer = window.setInterval(() => {
      void emitNative()
    }, NATIVE_POLL_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void emitNative()
    }
    document.addEventListener('visibilitychange', onVisibility)

    cleanup = () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  })()

  return () => {
    cancelled = true
    cleanup()
  }
}
