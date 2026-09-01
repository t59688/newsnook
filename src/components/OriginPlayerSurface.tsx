import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { X } from 'lucide-react'

import {
  prepareNativeMediaPlayback,
  setNativeLiveSessionBounds,
  setNativeLiveSessionVisible,
  startNativeLiveSniffSession,
} from '../features/mediaSniffer/native'
import { reduceLiveObservations } from '../features/mediaSniffer/liveCandidate'
import type { MediaDescriptor, MediaObservation } from '../features/mediaSniffer/types'
import { InkVideoPlayer, type InkVideoPlayerFullscreenHandle } from './InkVideoPlayer'

type Mode = 'origin' | 'custom'

/** Match Tailwind `rounded-xl` used by Reader cover / related cards. */
const SLOT_CORNER_RADIUS_PX = 12

export type OriginPlayerCloseHandle = {
  /** Returns true when the custom layer was closed. */
  closeCustom: () => boolean
}

interface Props {
  pageUrl: string
  referrer?: string
  title: string
  poster?: string
  openOriginal?: () => void
  closeHandleRef?: MutableRefObject<OriginPlayerCloseHandle | null>
}

/** Reader scrolls an overflow div; window capture alone can miss those events on WebView. */
function findScrollParents(el: HTMLElement): EventTarget[] {
  const targets: EventTarget[] = [window]
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    const oy = style.overflowY
    const ox = style.overflowX
    if (
      oy === 'auto' ||
      oy === 'scroll' ||
      oy === 'overlay' ||
      ox === 'auto' ||
      ox === 'scroll' ||
      ox === 'overlay'
    ) {
      targets.push(node)
    }
    node = node.parentElement
  }
  return targets
}

function pushLiveSessionBounds(
  el: HTMLElement,
  lastKeyRef: { current: string },
  force = false,
): void {
  const rect = el.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return
  const key = [
    rect.left.toFixed(1),
    rect.top.toFixed(1),
    rect.width.toFixed(1),
    rect.height.toFixed(1),
  ].join(',')
  if (!force && key === lastKeyRef.current) return
  lastKeyRef.current = key
  void setNativeLiveSessionBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    cornerRadius: SLOT_CORNER_RADIUS_PX,
  })
}

/**
 * Android custom-source video: visible origin WebView (native) + live sniff.
 * Float button switches to InkVideoPlayer only after an eligible descriptor.
 */
export function OriginPlayerSurface({
  pageUrl,
  referrer,
  title,
  poster,
  openOriginal,
  closeHandleRef,
}: Props) {
  const [mode, setMode] = useState<Mode>('origin')
  const [candidate, setCandidate] = useState<MediaDescriptor | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const observationsRef = useRef<MediaObservation[]>([])
  const slotRef = useRef<HTMLDivElement | null>(null)
  const lastBoundsKeyRef = useRef('')
  const sessionReadyRef = useRef(false)
  const playerFullscreenRef = useRef<InkVideoPlayerFullscreenHandle | null>(null)

  useEffect(() => {
    if (!closeHandleRef) return
    closeHandleRef.current = {
      closeCustom: () => {
        const fullscreen = playerFullscreenRef.current
        if (fullscreen?.immersive) {
          fullscreen.exit()
          return true
        }
        if (mode !== 'custom') return false
        setMode('origin')
        void setNativeLiveSessionVisible(true)
        lastBoundsKeyRef.current = ''
        const el = slotRef.current
        if (el && sessionReadyRef.current) {
          pushLiveSessionBounds(el, lastBoundsKeyRef, true)
        }
        return true
      },
    }
    return () => {
      closeHandleRef.current = null
    }
  }, [closeHandleRef, mode])

  useEffect(() => {
    let stopped = false
    let stopSession: (() => Promise<void>) | undefined
    const lateTimers: number[] = []
    observationsRef.current = []
    setCandidate(null)
    setSessionError(null)
    setMode('origin')
    sessionReadyRef.current = false
    lastBoundsKeyRef.current = ''

    const syncAfterNativeReady = () => {
      const el = slotRef.current
      if (!el || stopped) return
      pushLiveSessionBounds(el, lastBoundsKeyRef, true)
    }

    void startNativeLiveSniffSession({
      url: pageUrl,
      referrer,
      onObservation: (observation) => {
        if (stopped) return
        observationsRef.current.push(observation)
        const next = reduceLiveObservations(observationsRef.current)
        if (next) setCandidate(next)
      },
    })
      .then((session) => {
        if (stopped) {
          void session.stop()
          return
        }
        stopSession = session.stop
        // Native WebView starts off-screen; bounds calls before this are no-ops.
        sessionReadyRef.current = true
        syncAfterNativeReady()
        requestAnimationFrame(() => {
          syncAfterNativeReady()
          requestAnimationFrame(syncAfterNativeReady)
        })
        // Title / fonts / reader chrome can shift the slot after first paint.
        lateTimers.push(window.setTimeout(syncAfterNativeReady, 120))
        lateTimers.push(window.setTimeout(syncAfterNativeReady, 400))
      })
      .catch(() => {
        if (!stopped) setSessionError('原站播放器未能启动')
      })

    return () => {
      stopped = true
      sessionReadyRef.current = false
      for (const id of lateTimers) window.clearTimeout(id)
      void stopSession?.()
    }
  }, [pageUrl, referrer])

  useEffect(() => {
    if (mode !== 'origin') return

    const syncBounds = () => {
      const el = slotRef.current
      if (!el || !sessionReadyRef.current) return
      pushLiveSessionBounds(el, lastBoundsKeyRef)
    }

    lastBoundsKeyRef.current = ''
    syncBounds()
    const el = slotRef.current
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncBounds) : null
    if (el && ro) ro.observe(el)
    const scrollTargets = el ? findScrollParents(el) : [window]
    for (const target of scrollTargets) {
      target.addEventListener('scroll', syncBounds, { passive: true, capture: true })
    }
    window.addEventListener('resize', syncBounds)
    const vv = window.visualViewport
    vv?.addEventListener('resize', syncBounds)
    vv?.addEventListener('scroll', syncBounds)
    return () => {
      ro?.disconnect()
      for (const target of scrollTargets) {
        target.removeEventListener('scroll', syncBounds, true)
      }
      window.removeEventListener('resize', syncBounds)
      vv?.removeEventListener('resize', syncBounds)
      vv?.removeEventListener('scroll', syncBounds)
    }
  }, [mode, pageUrl])

  const openCustom = async () => {
    if (!candidate) return
    await prepareNativeMediaPlayback({
      url: candidate.url,
      sourcePage: candidate.pageUrl,
      format: candidate.type,
      headers: candidate.requestHeaders,
      origins: candidate.origins,
      extraUrls: candidate.relatedUrls,
    }).catch(() => undefined)
    await setNativeLiveSessionVisible(false)
    setMode('custom')
  }

  const backToOrigin = () => {
    setMode('origin')
    void setNativeLiveSessionVisible(true)
    lastBoundsKeyRef.current = ''
    const el = slotRef.current
    if (el && sessionReadyRef.current) {
      pushLiveSessionBounds(el, lastBoundsKeyRef, true)
    }
  }

  return (
    <div className="mt-5 page-x lg:px-8">
      <div className="overflow-hidden rounded-xl border border-haze bg-ink-raised/80">
        <div ref={slotRef} className="relative aspect-video w-full bg-[#0c0d10]">
          {mode === 'custom' && candidate ? (
            <InkVideoPlayer
              src={candidate.url}
              poster={poster}
              title={title}
              format={candidate.type}
              sourcePage={candidate.pageUrl}
              requestHeaders={candidate.requestHeaders}
              extraUrls={candidate.relatedUrls}
              resources={candidate.resources}
              onRefreshSource={backToOrigin}
              onPlaybackError={backToOrigin}
              fullscreenHandleRef={playerFullscreenRef}
            />
          ) : null}
        </div>

        {mode === 'origin' && (
          <div className="flex items-center gap-2 px-2.5 py-2.5">
            {sessionError ? (
              <>
                <p className="min-w-0 flex-1 text-[12px] leading-snug text-paper-muted" role="alert">
                  {sessionError}
                </p>
                {openOriginal && (
                  <button
                    type="button"
                    onClick={openOriginal}
                    className="shrink-0 rounded-lg border border-haze bg-ink px-3 py-1.5 font-mono text-[11px] text-paper-muted hover:text-paper active:scale-95 transition-all"
                  >
                    打开原文
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] text-paper-muted">
                  {candidate ? null : (
                    <span className="size-1.5 shrink-0 rounded-full bg-cinnabar-soft animate-pulse" />
                  )}
                  <span className="truncate">{candidate ? '已识别正片' : '原站播放中'}</span>
                </span>
                {candidate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void openCustom()}
                      className="shrink-0 rounded-lg bg-cinnabar px-3 py-1.5 font-mono text-[11px] font-medium text-white hover:bg-cinnabar-soft active:scale-95 transition-all"
                    >
                      用阅读器播放
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCustom()}
                      aria-label="关闭原站并使用阅读器播放"
                      title="关闭原站并使用阅读器播放"
                      className="shrink-0 rounded-lg p-1.5 text-paper-muted hover:bg-ink hover:text-paper active:scale-95 transition-all"
                    >
                      <X size={15} strokeWidth={2} />
                    </button>
                  </>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {mode === 'custom' && (
        <button
          type="button"
          onClick={backToOrigin}
          className="mt-2 px-0.5 text-[12px] text-paper-muted underline-offset-2 hover:underline"
        >
          返回原站播放器
        </button>
      )}
    </div>
  )
}
