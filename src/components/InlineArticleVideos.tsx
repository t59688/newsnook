import { useEffect, useState, type MutableRefObject, type RefObject } from 'react'
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
}

interface MountedInlineVideo extends InlineVideoDescriptor {
  host: HTMLDivElement
  anchor: Comment
  stopFullscreenWatch: () => void
  original: HTMLVideoElement
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
}: Props) {
  const [mounted, setMounted] = useState<MountedInlineVideo[]>([])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) {
      setMounted([])
      return
    }

    const next: MountedInlineVideo[] = []
    root.querySelectorAll<HTMLVideoElement>('video').forEach((video, index) => {
      const descriptor = describeInlineVideo(
        video,
        fallbackTitle,
        sourcePage || document.baseURI,
      )
      if (!descriptor) return

      // currentSrc reflects the browser-selected <source> when it is already
      // available; otherwise the sanitized attribute parsed above is reliable.
      const src = video.currentSrc?.trim() || descriptor.src
      const host = document.createElement('div')
      const anchor = document.createComment('reader-inline-video-anchor')
      host.className = 'reader-inline-video'
      host.setAttribute('data-reader-inline-video', String(index + 1))
      video.replaceWith(anchor, host)
      const stopFullscreenWatch = watchInlineVideoFullscreenHost(host, anchor)
      next.push({ ...descriptor, src, host, anchor, stopFullscreenWatch, original: video })
    })

    setMounted(next)

    return () => {
      // Native/fallback fullscreen temporarily promotes the portal host to <body>
      // so reader containment cannot clip a fixed player. Put it back before
      // restoring the original article DOM; this also keeps Strict Mode replay safe.
      next.forEach(({ host, anchor, stopFullscreenWatch, original }) => {
        stopFullscreenWatch()
        const parent = anchor.parentNode
        if (!parent) {
          host.remove()
          return
        }
        if (host.parentNode !== parent || host.previousSibling !== anchor) {
          parent.insertBefore(host, anchor.nextSibling)
        }
        host.replaceWith(original)
        anchor.remove()
      })
    }
  }, [enabled, fallbackTitle, html, rootRef, sourcePage])

  return mounted.map(({
    host,
    anchor: _anchor,
    stopFullscreenWatch: _stopFullscreenWatch,
    original: _original,
    ...video
  }, index) =>
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
          title={video.title}
          format={video.format}
          sourcePage={video.sourcePage || sourcePage}
          requestHeaders={video.requestHeaders}
          extraUrls={video.extraUrls}
          resources={video.resources as MediaResourceDescriptor[] | undefined}
          onRefreshSource={onRefreshSource}
          deferLoad={deferLoad}
          onUnlocked={() => onUnlocked?.(video.src)}
          fullscreenHandleRef={fullscreenHandleRef}
        />
      ),
      host,
      `${index}:${video.src}`,
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
