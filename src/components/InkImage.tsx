import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'

import { resolvePlayableImageSrc, revokeBlobUrl } from '../features/proxy/hydrateImages'
import {
  DEFERRED_LOAD_TIMEOUT_MS,
  deferredHostLabel,
  type DeferredHostPhase,
} from '../lib/deferReaderMedia'
import {
  imageProxyUrl,
  imageReferer,
  initialListImageUrl,
  isNeteaseImageUrl,
  normalizeListImageUrl,
} from '../lib/imageProxy'

type LoadState = 'loading' | 'loaded' | 'error'

interface Props {
  src?: string
  alt?: string
  /** 容器尺寸类，必须给出确定高宽，占位才不会引起布局跳动 */
  className?: string
  /** 首屏可见的图（头条、阅读页大图）用 eager，列表缩略图保持 lazy */
  eager?: boolean
  /** 加载失败时是否整块收起；默认保留一块安静的底色 */
  collapseOnError?: boolean
  /** 点击看大图；提供后容器可聚焦并可键盘激活 */
  onOpen?: (src: string) => void
  /** 未允许前不设 src；点击占位后再加载 */
  deferLoad?: boolean
}

/**
 * 异步加载的图片：先按容器尺寸占位并透出扫光，解码完成后墨渗式渐显。
 * 用 span 承载，便于嵌在 button 内部而不破坏 HTML 结构。
 */
export const InkImage = memo(function InkImage({ src, deferLoad, ...rest }: Props) {
  if (!src) return null
  return <InkImageFrame key={`${src}:${deferLoad ? 'defer' : 'auto'}`} src={src} deferLoad={deferLoad} {...rest} />
})

const InkImageFrame = memo(function InkImageFrame({
  src,
  alt = '',
  className = '',
  eager,
  collapseOnError,
  onOpen,
  deferLoad,
}: Props & { src: string }) {
  const native = Capacitor.isNativePlatform()
  const normalizedSrc = normalizeListImageUrl(src)
  const initialPlayable = initialListImageUrl(src, native)
  const [phase, setPhase] = useState<DeferredHostPhase | 'loaded'>(deferLoad ? 'idle' : 'loading')
  const [playable, setPlayable] = useState(initialPlayable)
  const [state, setState] = useState<LoadState>('loading')
  const ownedBlobRef = useRef<string | null>(null)
  const retryAttemptedRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      revokeBlobUrl(ownedBlobRef.current)
      ownedBlobRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!deferLoad && phase === 'idle') setPhase('loading')
  }, [deferLoad, phase])

  useEffect(() => {
    if (!deferLoad || phase !== 'loading') return
    let cancelled = false
    let handedOff = false
    let resolved: string | undefined
    const probe = new Image()
    const timer = window.setTimeout(() => {
      cancelled = true
      probe.src = ''
      setPhase('timeout')
    }, DEFERRED_LOAD_TIMEOUT_MS)

    void resolvePlayableImageSrc(initialPlayable, {
      forceNative: native && isNeteaseImageUrl(normalizedSrc),
      referer: imageReferer(normalizedSrc),
    })
      .then((url) => {
        resolved = url
        if (cancelled) {
          if (url !== ownedBlobRef.current) revokeBlobUrl(url)
          return
        }
        probe.onload = () => {
          if (cancelled) return
          handedOff = true
          if (ownedBlobRef.current && ownedBlobRef.current !== url) revokeBlobUrl(ownedBlobRef.current)
          ownedBlobRef.current = url.startsWith('blob:') ? url : null
          setPlayable(url)
          setState('loaded')
          setPhase('loaded')
        }
        probe.onerror = () => {
          if (url !== ownedBlobRef.current) revokeBlobUrl(url)
          if (!cancelled) {
            setState('error')
            setPhase('failed')
          }
        }
        probe.src = url
      })
      .catch(() => {
        if (!cancelled) {
          setState('error')
          setPhase('failed')
        }
      })

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      probe.onload = null
      probe.onerror = null
      probe.src = ''
      if (!handedOff && resolved && resolved !== ownedBlobRef.current) revokeBlobUrl(resolved)
    }
  }, [deferLoad, initialPlayable, native, normalizedSrc, phase])

  const attach = useCallback((node: HTMLImageElement | null) => {
    if (!node || !node.complete) return
    if (node.naturalWidth > 0) {
      setState('loaded')
      setPhase('loaded')
    } else {
      setState('error')
      setPhase('failed')
    }
  }, [])

  const startLoad = () => {
    if (phase === 'loading') return
    setPhase('loading')
    setState('loading')
  }

  const finishWithError = () => {
    if (!mountedRef.current) return
    setState('error')
    setPhase('failed')
  }

  const retryAfterError = () => {
    if (retryAttemptedRef.current || !normalizedSrc.startsWith('http')) {
      finishWithError()
      return
    }
    retryAttemptedRef.current = true
    setState('loading')

    if (!native) {
      const proxied = imageProxyUrl(normalizedSrc)
      if (proxied === playable) {
        finishWithError()
        return
      }
      setPlayable(proxied)
      return
    }

    void resolvePlayableImageSrc(normalizedSrc, {
      forceNative: true,
      referer: imageReferer(normalizedSrc),
    })
      .then((resolved) => {
        if (!mountedRef.current) {
          if (resolved !== normalizedSrc) revokeBlobUrl(resolved)
          return
        }
        if (resolved === normalizedSrc) {
          finishWithError()
          return
        }
        if (ownedBlobRef.current && ownedBlobRef.current !== resolved) {
          revokeBlobUrl(ownedBlobRef.current)
        }
        ownedBlobRef.current = resolved.startsWith('blob:') ? resolved : null
        setPlayable(resolved)
      })
      .catch(finishWithError)
  }

  if (deferLoad && phase !== 'loaded') {
    return (
      <button
        type="button"
        data-no-page-tap=""
        aria-label={deferredHostLabel(phase)}
        onClick={startLoad}
        className={`reader-deferred-host ${phase === 'loading' ? 'is-loading ink-shimmer' : ''} ${
          phase === 'failed' || phase === 'timeout' ? 'is-failed' : ''
        } ${className}`}
      >
        <span className="reader-deferred-label">{deferredHostLabel(phase)}</span>
      </button>
    )
  }

  if (state === 'error' && collapseOnError && !deferLoad) return null

  const open = onOpen && state === 'loaded' ? () => onOpen(playable) : undefined

  return (
    <span
      role={open ? 'button' : undefined}
      tabIndex={open ? 0 : undefined}
      aria-label={open ? '查看大图' : undefined}
      onClick={open}
      onKeyDown={
        open
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              }
            }
          : undefined
      }
      className={`relative block shrink-0 overflow-hidden ${open ? 'cursor-zoom-in' : ''} ${className}`}
    >
      {state === 'loading' && (
        <span aria-hidden className="ink-shimmer absolute inset-0 block" />
      )}
      {state !== 'error' && (
        <img
          ref={attach}
          src={playable}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState('loaded')}
          onError={retryAfterError}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            // Release the image transform after entry; retained layers can be clipped on WebView re-entry.
            animation: state === 'loaded' ? 'ink-image-in 520ms var(--ease-ink) backwards' : undefined,
            opacity: state === 'loaded' ? 1 : 0,
          }}
        />
      )}
    </span>
  )
})
