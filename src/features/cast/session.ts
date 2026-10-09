import { useSyncExternalStore } from 'react'

import {
  controlDlnaCast,
  getDlnaCastStatus,
  restoreDlnaCast,
  stopDlnaCast,
  type DlnaCastSession,
  type DlnaCastStatus,
} from '../../lib/dlnaCast'

interface DlnaCastSnapshot {
  session: DlnaCastSession | null
  status: DlnaCastStatus | null
  restoring: boolean
  error: string | null
}

let snapshot: DlnaCastSnapshot = {
  session: null,
  status: null,
  restoring: false,
  error: null,
}
let restorePromise: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(next: DlnaCastSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function update(patch: Partial<DlnaCastSnapshot>): void {
  emit({ ...snapshot, ...patch })
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): DlnaCastSnapshot {
  return snapshot
}

export function useDlnaCastSession(): DlnaCastSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function setActiveDlnaCast(
  session: DlnaCastSession,
  status: DlnaCastStatus,
): void {
  emit({ session, status, restoring: false, error: null })
}

export function setDlnaCastStatus(status: DlnaCastStatus): void {
  if (!snapshot.session) return
  update({ status, error: null })
}

export function clearActiveDlnaCast(): void {
  emit({ session: null, status: null, restoring: false, error: null })
}

export async function restoreActiveDlnaCast(): Promise<void> {
  if (snapshot.session || restorePromise) return restorePromise ?? Promise.resolve()

  update({ restoring: true, error: null })
  restorePromise = (async () => {
    try {
      const restored = await restoreDlnaCast()
      // A user may start a new cast while SSDP restore is still in flight.
      // Never let a stale restore overwrite the newer explicit session.
      if (snapshot.session) {
        update({ restoring: false })
        return
      }
      if (restored.session && restored.status) {
        emit({
          session: restored.session,
          status: restored.status,
          restoring: false,
          error: null,
        })
      } else {
        update({ restoring: false })
      }
    } catch {
      // Restore is opportunistic. Discovery can fail briefly while Wi-Fi wakes;
      // keep the saved native resume state so the next foreground transition can retry.
      update({ restoring: false })
    } finally {
      restorePromise = null
    }
  })()
  return restorePromise
}

export async function refreshActiveDlnaCast(): Promise<void> {
  const session = snapshot.session
  if (!session) return
  try {
    const status = await getDlnaCastStatus(session.id)
    if (snapshot.session?.id === session.id) setDlnaCastStatus(status)
  } catch {
    // One missed SOAP poll must not tear down a healthy TV session.
  }
}

export async function controlActiveDlnaCast(
  action: 'play' | 'pause' | 'seek' | 'volume',
  value?: number,
): Promise<void> {
  const session = snapshot.session
  if (!session) return

  const previous = snapshot.status
  if (previous) {
    if (action === 'play') update({ status: { ...previous, state: 'playing' }, error: null })
    if (action === 'pause') update({ status: { ...previous, state: 'paused' }, error: null })
    if (action === 'seek' && value != null) {
      update({ status: { ...previous, current: value }, error: null })
    }
    if (action === 'volume' && value != null) {
      update({ status: { ...previous, volume: value }, error: null })
    }
  }

  try {
    await controlDlnaCast(session.id, action, value)
  } catch (error) {
    if (snapshot.session?.id !== session.id) return
    update({
      status: previous,
      error: errorMessage(error, '投屏控制失败'),
    })
  }
}

export async function stopActiveDlnaCast(): Promise<void> {
  const session = snapshot.session
  if (!session) return
  try {
    await stopDlnaCast(session.id)
  } finally {
    if (snapshot.session?.id === session.id) clearActiveDlnaCast()
  }
}
