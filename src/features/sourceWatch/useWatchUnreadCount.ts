import { useSyncExternalStore } from 'react'
import { loadWatchState } from './store'

const subscribe = (callback: () => void): (() => void) => {
  window.addEventListener('newsnook:source-watch-changed', callback)
  return () => window.removeEventListener('newsnook:source-watch-changed', callback)
}

export function getWatchUnreadCount(): number {
  return loadWatchState().events.reduce((count, event) => count + Number(!event.read), 0)
}

/** A primitive snapshot keeps the app shell stable when only cursors change. */
export function useWatchUnreadCount(): number {
  return useSyncExternalStore(subscribe, getWatchUnreadCount, () => 0)
}
