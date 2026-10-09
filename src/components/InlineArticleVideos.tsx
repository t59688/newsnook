import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { RefreshCw } from 'lucide-react'

import { describeInlineVideo, type InlineVideoDescriptor } from '../lib/inlineVideos'
import { watchInlineVideoFullscreenHost } from '../lib/inlineVideoFullscreenHost'
import type { MediaResourceDescriptor } from '../features/mediaSniffer/types'
import { InkVideoPlayer, type InkVideoPlayerFullscreenHandle } from './InkVideoPlayer'

interface Props {
  rootRef: RefObject<HTMLElement | null>
  html: string
  enabled: boolean
  fallbackTitle: string
  sourcePage?: string
  deferLoad?: boolean
  onUnlocked?: (src: string) => void
  onRefreshSource?: () => void
  /** 播放器全屏句柄：让阅读器返回键在全屏时先退出全屏 */
  fullscreenHandleRef?: MutableRefObject<InkVideoPlayerFullscreenHandle | null>
  /** 阅读器浮层打开时隐藏嗅探 FAB */
  suppressResourceFab?: boolean
}

interface MountedInlineVideo extends InlineVideoDescriptor {
  key: string
  usesFallbackTitle: boolean
  host: HTMLDivElement
  anchor: Comment
  stopFullscreenWatch: () => void
  original: HTMLVideoElement
}

function releaseInlineVideo({ host, anchor, stopFullscreenWatch, original }: MountedInlineVideo): void {
  stopFullscreenWatch()
  const parent = anchor.parentNode
  if (!parent) { host.remove(); return }
  if (host.parentNode !== parent || host.previousSibling !== anchor) {
    parent.insertBefore(host, anchor.nextSibling)
  }
  host.replaceWith(original)
  anchor.remove()
}

/**
 * Article bodies arrive as sanitized HTML, so inline videos cannot be rendered
 * as React components directly. Replace each playable native video with a host
 * and portal the shared player into it. Videos without a usable source remain
 * untouched as a safe native fallback.
 */
export function InlineArticleVideos({
  rootRef,
  html,
  enabled,
  fallbackTitle,
  sourcePage,
  deferLoad,
  onUnlocked,
  onRefreshSource,
  fullscreenHandleRef,
  suppressResourceFab = false,
}: Props) {
  const [mounted, setMounted] = useState<MountedInlineVideo[]>([])

  const mountedRef = useRef<MountedInlineVideo[]>([])
  const mountSequenceRef = useRef(0)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) {
      for (const item of mountedRef.current) releaseInlineVideo(item)
      mountedRef.current = []
      setMounted([])
      return
    }

    // HTML replacement and metadata updates must not create a new portal container
    // for the same video. Reuse the host before paint; never scan our own <video>.
    const scan = () => {
      const previous = mountedRef.current
      const rawVideos = [...root.querySelectorAll<HTMLVideoElement>('video')]
        .filter(video => !video.closest('[data-reader-inline-video]'))
      const next = previous.filter(item => root.contains(item.anchor))
      if (!rawVideos.length && next.length === previous.length) return

      for (const video of rawVideos) {
        const descriptor = describeInlineVideo(video, '', sourcePage || document.baseURI)
        if (!descriptor) continue
        const src = video.currentSrc?.trim() || descriptor.src
        const reused = previous.find(item => item.src === src
          && !root.contains(item.anchor) && !next.some(entry => entry.host === item.host))
        reused?.stopFullscreenWatch()
        const host = reused?.host ?? document.createElement('div')
        const anchor = document.createComment('reader-inline-video-anchor')
        const usesFallbackTitle = !(
          video.getAttribute('title')?.trim() || video.getAttribute('aria-label')?.trim()
          || video.closest('figure')?.querySelector('figcaption')?.textContent?.trim()
        )
        host.className = 'reader-inline-video'
        host.setAttribute('data-reader-inline-video', String(next.length + 1))
        video.replaceWith(anchor, host)
        const stopFullscreenWatch = watchInlineVideoFullscreenHost(host, anchor)
        next.push({
          ...descriptor, src, host, anchor, stopFullscreenWatch, original: video,
          usesFallbackTitle, key: reused?.key ?? `inline-video-${mountSequenceRef.current++}`,
        })
      }

      const retainedHosts = new Set(next.map(item => item.host))
      for (const item of previous) {
        if (!retainedHosts.has(item.host)) releaseInlineVideo(item)
      }
      mountedRef.current = next
      setMounted(next)
    }

    scan()
    const observer = new MutationObserver(scan)
    observer.observe(root, { childList: true, subtree: true })
    // Changing HTML only reconnects the observer; player teardown belongs to
    // an actual removed source, disable, or component unmount.
    return () => observer.disconnect()
  }, [enabled, html, rootRef, sourcePage])

  useLayoutEffect(() => () => {
    for (const item of mountedRef.current) releaseInlineVideo(item)
    mountedRef.current = []
  }, [])

  return mounted.map(({
    host,
    key,
    usesFallbackTitle,
    anchor: _anchor,
    stopFullscreenWatch: _stopFullscreenWatch,
    original: _original,
    ...video
  }) =>
    createPortal(
      video.pending && !video.src ? (
        <VideoSniffPlaceholder
          state={video.pending}
          poster={video.poster}
          onRetry={onRefreshSource}
        />
      ) : (
        <InkVideoPlayer
          src={video.src}
          poster={video.poster}
          title={usesFallbackTitle ? fallbackTitle || video.title : video.title}
          format={video.format}
          sourcePage={video.sourcePage || sourcePage}
          requestHeaders={video.requestHeaders}
          extraUrls={video.extraUrls}
          resources={video.resources as MediaResourceDescriptor[] | undefined}
          onRefreshSource={onRefreshSource}
          deferLoad={deferLoad}
          onUnlocked={() => onUnlocked?.(video.src)}
          fullscreenHandleRef={fullscreenHandleRef}
          suppressResourceFab={suppressResourceFab}
        />
      ),
      host,
      key,
    ),
  )
}

export function VideoSniffPlaceholder({
  state,
  poster,
  onRetry,
}: {
  state: 'sniffing' | 'failed'
  poster?: string
  onRetry?: () => void
}) {
  const failed = state === 'failed'
  return (
    <div
      className={`reader-video-sniff-placeholder${poster ? ' has-poster' : ''}${failed ? ' is-failed' : ''}`}
      role={failed ? 'alert' : 'status'}
      aria-live="polite"
    >
      {poster ? (
        <img
          className="reader-video-sniff-poster"
          src={poster}
          alt=""
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      {failed ? (
        <div className="reader-video-sniff-failed-stack">
          <p className="reader-video-sniff-failed-text">暂未嗅探到可播放视频</p>
          {onRetry && (
            <button type="button" className="reader-video-sniff-retry" onClick={onRetry}>
              <RefreshCw size={13} strokeWidth={1.8} />
              重新嗅探
            </button>
          )}
        </div>
      ) : (
        <span className="reader-video-sniff-pill">
          <span className="reader-video-sniff-dot" />
          嗅探中
        </span>
      )}
    </div>
  )
}
