import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { LinuxDoPost } from '../types'
import {
  captureLinuxDoTopicPosition, rememberLinuxDoTopicPosition, restoreLinuxDoTopicPosition,
  type LinuxDoTopicPosition,
} from '../topic/readingPosition'

export function useTopicPosition(
  topicId: number, userId: number | undefined, rootRef: RefObject<HTMLDivElement | null>,
  opening: LinuxDoTopicPosition | undefined, posts: LinuxDoPost[], ready: boolean,
) {
  const initializedRef = useRef(false)
  const openingRef = useRef<LinuxDoTopicPosition | undefined>(undefined)
  const latestRef = useRef<LinuxDoTopicPosition | undefined>(undefined)
  const pendingRef = useRef<LinuxDoTopicPosition | undefined>(undefined)
  const stabilizingRef = useRef(false)
  const capture = useCallback(() => {
    if (initializedRef.current && rootRef.current) {
      latestRef.current = captureLinuxDoTopicPosition(rootRef.current) ?? latestRef.current
    }
  }, [rootRef])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!ready || !root || !posts.length) return
    if (openingRef.current !== opening || !initializedRef.current) {
      openingRef.current = opening
      if (opening) restoreLinuxDoTopicPosition(root, opening)
      else root.scrollTop = 0
      initializedRef.current = true
      stabilizingRef.current = !!opening
      capture()
    } else if (pendingRef.current) {
      restoreLinuxDoTopicPosition(root, pendingRef.current)
      pendingRef.current = undefined
      capture()
    }
  }, [capture, opening, posts, ready, rootRef])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const save = () => {
      capture()
      if (latestRef.current) rememberLinuxDoTopicPosition(topicId, userId, latestRef.current)
    }
    const background = () => { if (document.visibilityState === 'hidden') save() }
    const stopStabilizing = () => { stabilizingRef.current = false }
    const stabilize = () => {
      if (stabilizingRef.current && openingRef.current) {
        restoreLinuxDoTopicPosition(root, openingRef.current)
        capture()
      }
    }
    // Images/font layout can grow above the target after first paint. Stop correcting
    // as soon as the reader interacts, so delayed media cannot drag them backwards.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(stabilize)
    observer?.observe(root)
    const observePosts = () => root.querySelectorAll('article[data-linuxdo-post-number]').forEach(post => observer?.observe(post))
    observePosts()
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(observePosts)
    mutations?.observe(root, { childList: true, subtree: true })
    for (const event of ['touchstart', 'pointerdown', 'wheel', 'keydown']) root.addEventListener(event, stopStabilizing)
    root.addEventListener('load', stabilize, true)
    root.addEventListener('scroll', capture)
    window.addEventListener('resize', stabilize)
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', background)
    return () => {
      // Use the last sampled anchor if React has already detached the post DOM.
      save()
      observer?.disconnect()
      mutations?.disconnect()
      for (const event of ['touchstart', 'pointerdown', 'wheel', 'keydown']) root.removeEventListener(event, stopStabilizing)
      root.removeEventListener('load', stabilize, true)
      root.removeEventListener('scroll', capture)
      window.removeEventListener('resize', stabilize)
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', background)
    }
  }, [capture, rootRef, topicId, userId])

  return useCallback(() => {
    const root = rootRef.current
    pendingRef.current = root ? captureLinuxDoTopicPosition(root) : undefined
  }, [rootRef])
}
