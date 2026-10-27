import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { X } from 'lucide-react'
import { fetchAbsoluteText } from '../lib/http'

import {
  prepareNativeMediaPlayback,
  setNativeLiveSessionBounds,
  setNativeLiveSessionInteractive,
  setNativeLiveSessionVisible,
  startNativeLiveSniffSession,
} from '../features/mediaSniffer/native'
import { reduceLiveObservations, withQualityVariants } from '../features/mediaSniffer/liveCandidate'
import { discoverMediaDescriptor, enrichMediaDescriptorFromObservations } from '../features/mediaSniffer/service'
import { isLikelyAdMediaUrl } from '../features/mediaSniffer/classifier'
import type { MediaDescriptor, MediaObservation } from '../features/mediaSniffer/types'
import { InkVideoPlayer, type InkVideoPlayerFullscreenHandle } from './InkVideoPlayer'
import { useHasGlobalVideoSurface } from '../features/floatingVideo/context'

type Mode = 'origin' | 'custom'

/** Match Tailwind `rounded-xl` used by Reader cover / related cards. */
const SLOT_CORNER_RADIUS_PX = 12
const AUTOMATIC_DISCOVERY_BUDGET_MS = 8_000

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
  /** 阅读器浮层打开时隐藏嗅探 FAB */
  suppressResourceFab?: boolean
  /** 首次识别到可播放资源后自动切到 InkVideoPlayer。播放失败不会循环自动重试。 */
  autoUseReader?: boolean
  /** 嵌入正文时去掉页面级外边距/二级操作条，播放器就地占据正文视频位。 */
  embedded?: boolean
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

function observationKey(observation: MediaObservation): string {
  return [observation.source, observation.url || '', observation.mimeType || '', observation.pageUrl, observation.sourceLabel || ''].join('|')
}

function appendObservations(target: MediaObservation[], incoming: MediaObservation[]): void {
  for (const observation of incoming) {
    if (!observation.url || isLikelyAdMediaUrl(observation.url)) continue
    const key = observationKey(observation)
    const existing = target.findIndex((item) => observationKey(item) === key)
    if (existing >= 0) target[existing] = { ...target[existing], ...observation }
    else target.push(observation)
  }
  if (target.length > 320) target.splice(0, target.length - 320)
}

function observationsFromDescriptor(descriptor: MediaDescriptor): MediaObservation[] {
  const result: MediaObservation[] = []
  const resources = descriptor.resources?.length ? descriptor.resources : [descriptor]
  for (const resource of resources) {
    if (resource.isAd || resource.drm || isLikelyAdMediaUrl(resource.url)) continue
    const firstTrack = resource.videoTracks.find((track) => track.width || track.height || track.quality)
    result.push({
      url: resource.url,
      pageUrl: resource.pageUrl || descriptor.pageUrl,
      source: 'static',
      mimeType: resource.mimeType || (resource.type === 'hls' ? 'application/vnd.apple.mpegurl' : resource.type === 'dash' ? 'application/dash+xml' : 'video/mp4'),
      mediaKind: 'video',
      hasVideo: true,
      hasAudio: resource.hasAudio,
      width: firstTrack?.width,
      height: firstTrack?.height,
      bitrate: firstTrack?.bandwidth,
      quality: firstTrack?.quality,
      sourceLabel: resource.sourceLabel,
      requestHeaders: resource.requestHeaders,
      timestamp: Date.now(),
    })
    for (const track of resource.videoTracks) {
      if (!track.url || track.url === resource.url || isLikelyAdMediaUrl(track.url)) continue
      result.push({
        url: track.url,
        pageUrl: resource.pageUrl || descriptor.pageUrl,
        source: 'static',
        mimeType: resource.type === 'hls' ? 'application/vnd.apple.mpegurl' : resource.type === 'dash' ? 'application/dash+xml' : resource.mimeType,
        mediaKind: 'video',
        hasVideo: true,
        hasAudio: resource.hasAudio,
        width: track.width,
        height: track.height,
        bitrate: track.bandwidth,
        quality: track.quality || (track.height ? `${track.height}p` : undefined),
        sourceLabel: resource.sourceLabel,
        requestHeaders: resource.requestHeaders,
        timestamp: Date.now(),
      })
    }
  }
  return result
}

function pushLiveSessionBounds(
  el: HTMLElement,
  lastKeyRef: { current: string },
  force = false,
  sessionId?: string,
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
    sessionId,
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
  suppressResourceFab = false,
  autoUseReader = false,
  embedded = false,
}: Props) {
  const globalVideoSurface = useHasGlobalVideoSurface()
  const [mode, setMode] = useState<Mode>('origin')
  const [candidate, setCandidate] = useState<MediaDescriptor | null>(null)
  // Live ranking feeds the resource picker; playback stays on the chosen snapshot.
  const [activeCandidate, setActiveCandidate] = useState<MediaDescriptor | null>(null)
  const handoffVersionRef = useRef<object>({})
  const preparingRef = useRef(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [assistAvailable, setAssistAvailable] = useState(false)
  const [assistMode, setAssistMode] = useState(false)
  const observationsRef = useRef<MediaObservation[]>([])
  const slotRef = useRef<HTMLDivElement | null>(null)
  const lastBoundsKeyRef = useRef('')
  const sessionReadyRef = useRef(false)
  const sessionIdRef = useRef<string | undefined>(undefined)
  const playerFullscreenRef = useRef<InkVideoPlayerFullscreenHandle | null>(null)
  const autoSwitchedRef = useRef(false)
  const enrichedManifestRef = useRef<string | null>(null)

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
        handoffVersionRef.current = {}
        preparingRef.current = false
        setActiveCandidate(null)
        setMode('origin')
        if (sessionIdRef.current) {
          void setNativeLiveSessionVisible(true, sessionIdRef.current)
          void setNativeLiveSessionInteractive(true, sessionIdRef.current)
        }
        setAssistMode(true)
        lastBoundsKeyRef.current = ''
        const el = slotRef.current
        if (el && sessionReadyRef.current) {
          pushLiveSessionBounds(el, lastBoundsKeyRef, true, sessionIdRef.current)
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
    autoSwitchedRef.current = false
    enrichedManifestRef.current = null
    handoffVersionRef.current = {}
    preparingRef.current = false
    setActiveCandidate(null)
    setCandidate(null)
    setSessionError(null)
    setAssistAvailable(false)
    setAssistMode(false)
    setMode('origin')
    sessionReadyRef.current = false
    sessionIdRef.current = undefined
    lastBoundsKeyRef.current = ''

    const syncAfterNativeReady = () => {
      const el = slotRef.current
      if (!el || stopped) return
      pushLiveSessionBounds(el, lastBoundsKeyRef, true, sessionIdRef.current)
    }

    void startNativeLiveSniffSession({
      url: pageUrl,
      referrer,
      onObservation: (observation) => {
        if (stopped) return
        appendObservations(observationsRef.current, [observation])
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
        sessionIdRef.current = session.sessionId
        void setNativeLiveSessionInteractive(false, session.sessionId)
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
      handoffVersionRef.current = {}
      preparingRef.current = false
      sessionReadyRef.current = false
      sessionIdRef.current = undefined
      for (const id of lateTimers) window.clearTimeout(id)
      void stopSession?.()
    }
  }, [pageUrl, referrer])

  useEffect(() => {
    const controller = new AbortController()
    let stopped = false
    const acceptDescriptor = (descriptor: MediaDescriptor) => {
      if (stopped || controller.signal.aborted) return
      appendObservations(observationsRef.current, observationsFromDescriptor(descriptor))
      const next = reduceLiveObservations(observationsRef.current)
      if (next) setCandidate(next)
    }
    void fetchAbsoluteText(pageUrl, {
      signal: controller.signal,
      headers: referrer ? { Referer: referrer } : undefined,
      accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      maxBytes: 2 * 1024 * 1024,
    }).then((html) => {
      if (stopped || controller.signal.aborted || !html) return
      return discoverMediaDescriptor({
        pageUrl,
        html,
        referrer,
        runtime: true,
        timeoutMs: AUTOMATIC_DISCOVERY_BUDGET_MS,
        signal: controller.signal,
        onDescriptor: acceptDescriptor,
      })
    }).then((descriptor) => {
      if (descriptor && !stopped) acceptDescriptor(descriptor)
    }).catch(() => undefined)
    return () => {
      stopped = true
      controller.abort()
    }
  }, [pageUrl, referrer])

  useEffect(() => {
    if (mode !== 'origin' || candidate || sessionError) {
      setAssistAvailable(false)
      return
    }
    const timer = window.setTimeout(() => setAssistAvailable(true), AUTOMATIC_DISCOVERY_BUDGET_MS)
    return () => window.clearTimeout(timer)
  }, [mode, candidate, sessionError, pageUrl])

  useEffect(() => {
    if (mode !== 'origin' || !assistMode || !sessionIdRef.current) return
    void setNativeLiveSessionInteractive(true, sessionIdRef.current)
  }, [mode, assistMode])

  useEffect(() => {
    if (mode !== 'origin') return

    const syncBounds = () => {
      const el = slotRef.current
      if (!el || !sessionReadyRef.current) return
      pushLiveSessionBounds(el, lastBoundsKeyRef, false, sessionIdRef.current)
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

  const openCustom = useCallback(async () => {
    if (!candidate || preparingRef.current) return
    const chosen = candidate
    const version = handoffVersionRef.current
    preparingRef.current = true
    try {
      await prepareNativeMediaPlayback({
        url: chosen.url,
        sourcePage: chosen.pageUrl,
        format: chosen.type,
        headers: chosen.requestHeaders,
        origins: chosen.origins,
        extraUrls: chosen.relatedUrls,
      }).catch(() => undefined)
      if (version !== handoffVersionRef.current) return
      if (sessionIdRef.current) {
        await setNativeLiveSessionInteractive(false, sessionIdRef.current)
        await setNativeLiveSessionVisible(false, sessionIdRef.current)
      }
      if (version !== handoffVersionRef.current) return
      setActiveCandidate(chosen)
      setMode('custom')
    } finally {
      if (version === handoffVersionRef.current) preparingRef.current = false
    }
  }, [candidate])

  const candidateManifestUrl = candidate?.url
  const candidateManifestType = candidate?.type
  const candidateHasVariantTracks = Boolean(candidate?.videoTracks.some((track) => track.url && track.url !== candidate.url))
  useEffect(() => {
    if (!candidateManifestUrl || (candidateManifestType !== 'hls' && candidateManifestType !== 'dash')) return
    if (candidateHasVariantTracks || enrichedManifestRef.current === candidateManifestUrl) return
    enrichedManifestRef.current = candidateManifestUrl
    const manifestUrl = candidateManifestUrl
    const snapshot = observationsRef.current.slice()
    void enrichMediaDescriptorFromObservations(snapshot).then((enriched) => {
      if (!enriched || enriched.url !== manifestUrl) return
      const expanded = withQualityVariants(enriched)
      setCandidate((current) => current?.url === manifestUrl
        ? { ...current, ...expanded, resources: expanded.resources }
        : current)
    }).catch(() => undefined)
  }, [candidateManifestUrl, candidateManifestType, candidateHasVariantTracks])

  useEffect(() => {
    if (!autoUseReader || !candidate || mode !== 'origin' || autoSwitchedRef.current) return
    autoSwitchedRef.current = true
    void openCustom()
  }, [autoUseReader, candidate, mode, openCustom])

  const backToOrigin = () => {
    handoffVersionRef.current = {}
    preparingRef.current = false
    setActiveCandidate(null)
    setMode('origin')
    if (sessionIdRef.current) {
      void setNativeLiveSessionVisible(true, sessionIdRef.current)
      void setNativeLiveSessionInteractive(true, sessionIdRef.current)
    }
    setAssistMode(true)
    lastBoundsKeyRef.current = ''
    const el = slotRef.current
    if (el && sessionReadyRef.current) {
      pushLiveSessionBounds(el, lastBoundsKeyRef, true, sessionIdRef.current)
    }
  }

  return (
    <div className={embedded ? 'w-full' : 'mt-5 page-x lg:px-8'}>
      <div className="overflow-hidden rounded-xl border border-haze bg-ink-raised/80">
        <div
          ref={slotRef}
          className={`relative w-full bg-[#0c0d10] ${mode === 'origin' ? 'reader-video-aspect' : ''}`}
        >
          {mode === 'origin' && globalVideoSurface && <div className="reader-video-aspect flex items-center justify-center px-6 text-center text-[12px] text-paper-muted">关闭悬浮后可使用原站播放器</div>}
          {mode === 'origin' && !globalVideoSurface && !assistMode && !sessionError && (
            <div className="reader-video-aspect flex flex-col items-center justify-center gap-2 px-6 text-center text-paper-muted" aria-live="polite">
              <span className="size-2 rounded-full bg-cinnabar-soft animate-pulse" />
              <span className="text-[13px]">正在自动识别视频资源</span>
              <span className="text-[11px]">识别到可播放线路后将自动切换播放器</span>
            </div>
          )}
          {mode === 'custom' && activeCandidate ? (
            <InkVideoPlayer
              autoPlay={!autoUseReader}
              src={activeCandidate.url}
              poster={poster}
              title={title}
              format={activeCandidate.type}
              sourcePage={activeCandidate.pageUrl}
              requestHeaders={activeCandidate.requestHeaders}
              extraUrls={activeCandidate.relatedUrls}
              resources={candidate?.resources ?? activeCandidate.resources}
              onRefreshSource={backToOrigin}
              fullscreenHandleRef={playerFullscreenRef}
              suppressResourceFab={suppressResourceFab}
            />
          ) : null}
        </div>

        {mode === 'origin' && (!embedded || sessionError) && (
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
                  <span className="truncate">{candidate ? '已识别正片' : assistMode ? '手动辅助识别中' : '正在自动识别视频'}</span>
                </span>
                {candidate ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void openCustom()}
                      className="shrink-0 rounded-lg bg-cinnabar px-3 py-1.5 font-mono text-[11px] font-medium text-white hover:bg-cinnabar-soft active:scale-95 transition-all"
                    >
                      切换播放器
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCustom()}
                      aria-label="关闭原站并切换播放器"
                      title="关闭原站并切换播放器"
                      className="shrink-0 rounded-lg p-1.5 text-paper-muted hover:bg-ink hover:text-paper active:scale-95 transition-all"
                    >
                      <X size={15} strokeWidth={2} />
                    </button>
                  </>
                ) : assistMode ? (
                  <button
                    type="button"
                    onClick={() => { setAssistMode(false); setAssistAvailable(true); void setNativeLiveSessionInteractive(false, sessionIdRef.current) }}
                    className="shrink-0 rounded-lg border border-haze px-3 py-1.5 font-mono text-[11px] text-paper-muted hover:text-paper active:scale-95 transition-all"
                  >
                    隐藏原站
                  </button>
                ) : assistAvailable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAssistMode(true)
                      setAssistAvailable(false)
                      if (sessionIdRef.current) void setNativeLiveSessionInteractive(true, sessionIdRef.current)
                    }}
                    className="shrink-0 rounded-lg bg-cinnabar px-3 py-1.5 font-mono text-[11px] font-medium text-white hover:bg-cinnabar-soft active:scale-95 transition-all"
                  >
                    手动辅助识别
                  </button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {mode === 'custom' && !embedded && (
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
