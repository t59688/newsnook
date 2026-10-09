import { LoaderCircle, Play } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { discoverMediaDescriptor } from '../features/mediaSniffer/service'
import type { MediaDescriptor } from '../features/mediaSniffer/types'
import { InkVideoPlayer } from './InkVideoPlayer'
import { OriginPlayerSurface } from './OriginPlayerSurface'

interface Props {
  rootRef: RefObject<HTMLElement | null>
  html: string
  enabled: boolean
  fallbackTitle: string
  sourcePage?: string
  /** 站点已知协议可先直接给出播放源；失败时再回退到通用媒体嗅探。 */
  resolveDirect?: (pageUrl: string, signal: AbortSignal) => Promise<MediaDescriptor | null>
}

interface MountedVideoPage {
  key: string
  pageUrl: string
  title: string
  poster?: string
  host: HTMLDivElement
  shell: HTMLElement
  fallbackMarkup: string
}

type LoadPhase = 'preview' | 'sniffing' | 'custom' | 'origin'

function InlineVideoPage({
  video,
  active,
  onActivate,
  sourcePage,
  resolveDirect,
}: {
  video: MountedVideoPage
  active: boolean
  onActivate: () => void
  sourcePage?: string
  resolveDirect?: Props['resolveDirect']
}) {
  const [phase, setPhase] = useState<LoadPhase>('preview')
  const [media, setMedia] = useState<MediaDescriptor | null>(null)
  const runRef = useRef(0)

  useEffect(() => {
    if (!active) {
      runRef.current += 1
      setMedia(null)
      setPhase('preview')
      return
    }

    const run = runRef.current + 1
    runRef.current = run
    const controller = new AbortController()
    setMedia(null)
    setPhase('sniffing')

    const discover = async () => {
      if (resolveDirect) {
        const direct = await resolveDirect(video.pageUrl, controller.signal).catch(() => null)
        if (runRef.current !== run || controller.signal.aborted) return
        if (direct && !direct.drm) {
          setMedia(direct)
          setPhase('custom')
          return
        }
      }

      const descriptor = await discoverMediaDescriptor({
        pageUrl: video.pageUrl,
        referrer: sourcePage,
        runtime: true,
        timeoutMs: 9000,
        signal: controller.signal,
        onDescriptor: (candidate) => {
          if (runRef.current !== run || candidate.drm) return
          setMedia(candidate)
          setPhase('custom')
        },
      }).catch(() => null)
      if (runRef.current !== run || controller.signal.aborted) return
      if (descriptor && !descriptor.drm) {
        setMedia(descriptor)
        setPhase('custom')
      } else {
        setPhase('origin')
      }
    }
    void discover()

    return () => {
      runRef.current += 1
      controller.abort()
    }
  }, [active, resolveDirect, sourcePage, video.pageUrl])

  const relatedUrls = useMemo(() => media?.relatedUrls, [media])

  if (!active || phase === 'preview') {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="reader-video-aspect group relative block w-full overflow-hidden rounded-xl border border-haze/70 bg-[#0c0d10] text-left shadow-[0_12px_30px_-20px_rgba(0,0,0,0.7)]"
        aria-label={`播放视频：${video.title}`}
      >
        {video.poster ? (
          <img
            src={video.poster}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : null}
        <span className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full border border-white/35 bg-black/55 text-white shadow-xl backdrop-blur-sm transition-transform group-active:scale-95">
            <Play size={25} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3.5 pb-3 pt-8 text-[12.5px] font-medium leading-snug text-white">
          {video.title}
        </span>
      </button>
    )
  }

  if (phase === 'custom' && media) {
    return (
      <div className="overflow-hidden rounded-xl border border-haze/70 bg-[#0c0d10]">
        <InkVideoPlayer
          src={media.url}
          poster={video.poster}
          title={video.title}
          format={media.type}
          sourcePage={media.pageUrl || video.pageUrl}
          requestHeaders={media.requestHeaders}
          extraUrls={relatedUrls}
          resources={media.resources}
          onPlaybackError={() => setPhase('origin')}
          onRefreshSource={() => setPhase('origin')}
          suppressResourceFab
        />
      </div>
    )
  }

  if (phase === 'origin') {
    return (
      <OriginPlayerSurface
        pageUrl={video.pageUrl}
        referrer={sourcePage}
        title={video.title}
        poster={video.poster}
        autoUseReader
        embedded
        suppressResourceFab
      />
    )
  }

  return (
    <div className="reader-video-aspect relative w-full overflow-hidden rounded-xl border border-haze/70 bg-[#0c0d10]">
      {video.poster ? (
        <img
          src={video.poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-75"
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
        <LoaderCircle size={28} className="animate-spin" />
        <span className="text-[11px] tracking-[0.08em] text-white/80">正在准备视频</span>
      </div>
    </div>
  )
}

/**
 * 将正文预处理阶段生成的稳定 video-page 宿主升级为 React 播放器。
 *
 * 关键约束：不要再 replaceWith 整个第三方正文节点。正文由 dangerouslySetInnerHTML
 * 所有，替换根节点会让 React、Android WebView 与其它正文增强 effect 对实际 DOM 的认知分叉。
 * 这里只清空宿主内部的静态预览并挂入 portal；宿主节点本身始终保持稳定。
 */
export function InlineVideoPages({ rootRef, html, enabled, fallbackTitle, sourcePage, resolveDirect }: Props) {
  const [mounted, setMounted] = useState<MountedVideoPage[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)

  useLayoutEffect(() => {
    if (!enabled) {
      setMounted([])
      setActiveKey(null)
      return
    }

    let disposed = false
    let frame = 0
    let mountSequence = 0
    let current: MountedVideoPage[] = []
    let observedRoot: HTMLElement | null = null
    let observer: MutationObserver | null = null

    const publish = () => {
      if (disposed) return
      const connected = current.filter((item) => item.shell.isConnected && item.host.isConnected)
      current = connected
      setMounted([...connected])
      setActiveKey((active) => active && connected.some((item) => item.key === active)
        ? active
        : connected[0]?.key ?? null)
    }

    const mountShell = (shell: HTMLElement, index: number) => {
      if (shell.getAttribute('data-reader-inline-video-mounted') === 'true') return false
      const pageUrl = shell.getAttribute('data-source-page')?.trim()
      if (!pageUrl) return false

      const title = shell.getAttribute('data-related-title')?.trim() || fallbackTitle || '视频'
      const posterImage = shell.querySelector<HTMLImageElement>('img')
      const poster = posterImage?.currentSrc || posterImage?.getAttribute('src') || undefined
      const fallbackMarkup = shell.innerHTML
      const host = document.createElement('div')
      const key = `${index}:${pageUrl}:${mountSequence++}`
      host.className = 'reader-inline-video-page'
      host.setAttribute('data-reader-inline-video-page', String(index + 1))

      shell.setAttribute('data-reader-inline-video-mounted', 'true')
      while (shell.firstChild) shell.removeChild(shell.firstChild)
      shell.appendChild(host)
      current.push({ key, pageUrl, title, poster, host, shell, fallbackMarkup })
      return true
    }

    const scan = () => {
      if (disposed) return
      const root = rootRef.current
      if (!root) {
        if (!frame) {
          frame = window.requestAnimationFrame(() => {
            frame = 0
            scan()
          })
        }
        return
      }

      if (observedRoot !== root) {
        observer?.disconnect()
        observedRoot = root
        observer = new MutationObserver(() => scan())
        observer.observe(root, { childList: true, subtree: true })
      }

      const previousCount = current.length
      current = current.filter((item) => item.shell.isConnected && item.host.isConnected)
      let changed = current.length !== previousCount
      root.querySelectorAll<HTMLElement>('[data-media-format="video-page"][data-source-page]').forEach((shell, index) => {
        if (mountShell(shell, index)) changed = true
      })
      if (changed) publish()
    }

    scan()

    return () => {
      disposed = true
      observer?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      current.forEach(({ shell, fallbackMarkup }) => {
        shell.removeAttribute('data-reader-inline-video-mounted')
        if (shell.isConnected) shell.innerHTML = fallbackMarkup
      })
    }
  }, [enabled, fallbackTitle, html, rootRef])

  return mounted.map((video) => createPortal(
    <InlineVideoPage
      video={video}
      active={video.key === activeKey}
      onActivate={() => setActiveKey(video.key)}
      sourcePage={sourcePage}
      resolveDirect={resolveDirect}
    />,
    video.host,
    video.key,
  ))
}
