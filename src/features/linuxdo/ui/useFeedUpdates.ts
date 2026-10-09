import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { log } from '../../../lib/logger'
import { LinuxDoFeedUpdates, type LinuxDoIncomingSnapshot } from '../feed/updates'
import { linuxDoApi } from '../runtime'
import { LinuxDoApiError, type LinuxDoFeedMode, type LinuxDoSessionSnapshot } from '../types'

export function useFeedUpdates(session: LinuxDoSessionSnapshot) {
  const userId = session.authenticated ? session.currentUser?.id : undefined
  const updates = useMemo(() => new LinuxDoFeedUpdates(linuxDoApi, userId), [userId])
  const [, setRevision] = useState(0)
  const notify = useCallback(() => setRevision((revision) => revision + 1), [])

  useEffect(() => {
    // Web cannot POST to the upstream session through the read-only page proxy.
    if (!Capacitor.isNativePlatform()) return
    let stopped = false
    let busy = false
    let failures = 0
    let nextPollAt = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    const schedule = () => {
      if (stopped || busy || document.visibilityState === 'hidden') return
      clearTimeout(timer)
      timer = setTimeout(() => void poll(), Math.max(0, nextPollAt - Date.now()))
    }
    const poll = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return
      busy = true
      let delay = 15_000
      try {
        await updates.poll(controller.signal)
        if (stopped) return
        failures = 0
        notify()
      } catch (error) {
        if (stopped) return
        if (failures++ === 0) log.feed.warn('Linux.do topic update polling failed', error)
        delay = Math.max(
          Math.min(180_000, 15_000 * 2 ** Math.min(failures, 4)),
          error instanceof LinuxDoApiError ? (error.retryAfterSeconds ?? 0) * 1000 : 0,
        )
      } finally {
        busy = false
        nextPollAt = Date.now() + delay
        schedule()
      }
    }
    const onVisibility = () => {
      clearTimeout(timer)
      // Preserve server cooldowns across background/foreground transitions.
      schedule()
    }
    document.addEventListener('visibilitychange', onVisibility)
    schedule()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [updates, notify])

  const acknowledge = useCallback((mode: LinuxDoFeedMode, snapshot: LinuxDoIncomingSnapshot) => {
    updates.acknowledge(mode, snapshot)
    notify()
  }, [updates, notify])

  return { updates, acknowledge }
}
