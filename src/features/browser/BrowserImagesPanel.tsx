import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from 'react'
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { ChevronLeft, ChevronRight, ImageOff, Images, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { ImageLightbox } from '../../components/ImageLightbox'
import { saveImageBlob, shareImageBlob, type ImageActionResult } from '../../lib/imageActions'
import { BrowserIconButton, BrowserPageHeader } from './BrowserPrimitives'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'
import {
  BROWSER_IMAGE_PAGE_SIZE,
  BrowserImageLoader,
  browserImageSourceLabel,
  browserImageTitle,
  type BrowserImageCandidate,
  type BrowserImageCancelRequest,
  type BrowserImageData,
  type BrowserImageLoadRequest,
  type BrowserImageSnapshot,
} from './browserImages'

export interface BrowserImagesPanelProps {
  snapshot: BrowserImageSnapshot | null
  scanning: boolean
  error: string | null
  onScan: () => void
  onClose: () => void
  loadImage: (request: BrowserImageLoadRequest) => Promise<BrowserImageData>
  cancelImageRequests: (request: BrowserImageCancelRequest) => Promise<void>
  privateMode?: boolean
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
}

function ImageThumbnail({ item, loader, revision, enabled = true }: {
  item: BrowserImageCandidate
  loader: BrowserImageLoader
  revision: number
  enabled?: boolean
}) {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!enabled) { setVisible(false); return }
    const target = element.current
    if (!target) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)),
      { rootMargin: '64px', threshold: 0 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [enabled])
  const source = visible && enabled ? loader.cached(item, true) : undefined
  const error = loader.error(item, true)
  useEffect(() => {
    if (visible && enabled && !source && !error) void loader.load(item, true).catch(() => {})
  }, [visible, enabled, item, loader, source, error, revision])
  return <span ref={element} className="relative grid h-full w-full place-items-center bg-haze/35 text-paper-faint">
    {source
      ? <img src={source} alt="" draggable={false} decoding="async" className="h-full w-full object-cover"/>
      : error ? <ImageOff size={22} aria-hidden/> : visible && enabled ? <LoaderCircle size={20} className="animate-spin" aria-hidden/> : <Images size={22} aria-hidden/>}
  </span>
}

function ExportConfirmation({ action, onAnswer }: { action: 'save' | 'share'; onAnswer: (answer: boolean) => void }) {
  const focus = useBrowserDialogFocus<HTMLElement>()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onAnswer(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onAnswer])
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/70 p-5">
    <section ref={focus} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="browser-image-export-title"
      className="w-full max-w-sm rounded-3xl border border-haze bg-ink-raised p-5 outline-none">
      <ShieldCheck size={26} className="text-cinnabar-soft"/>
      <h3 id="browser-image-export-title" className="mt-4 text-lg font-semibold text-paper">将图片带出私密会话？</h3>
      <p className="mt-2 text-sm leading-6 text-paper-muted">{action === 'save'
        ? '保存后的图片会留在系统相册，结束私密浏览不会删除它。'
        : '分享会把图片交给你选择的应用，结束私密浏览不会撤回已经分享的内容。'}</p>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={() => onAnswer(false)} className="min-h-11 flex-1 rounded-xl border border-haze text-sm text-paper">取消</button>
        <button type="button" onClick={() => onAnswer(true)} className="min-h-11 flex-1 rounded-xl bg-paper text-sm font-medium text-ink">{action === 'save' ? '继续保存' : '继续分享'}</button>
      </div>
    </section>
  </div>
}

async function exportImage(blob: Blob, action: 'save' | 'share', title: string): Promise<ImageActionResult> {
  const extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
    'image/svg+xml': 'svg', 'image/bmp': 'bmp' } as Record<string, string>)[blob.type] || 'jpg'
  const fileName = 'newsnook-image-' + Date.now().toString(36) + '.' + extension
  try {
    return action === 'save' ? await saveImageBlob(blob, fileName) : await shareImageBlob(blob, fileName, title)
  } finally {
    if (Capacitor.isNativePlatform()) {
      const cleanup = () => { void Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }).catch(() => {}) }
      // Android's chooser may return before the receiving application opens the
      // granted URI. Keep this explicitly exported file briefly, then remove it.
      if (action === 'share') setTimeout(cleanup, 60_000)
      else cleanup()
    }
  }
}

export function BrowserImagesPanel({ snapshot, scanning, error, onScan, onClose, loadImage,
  cancelImageRequests, privateMode = false, overlayCloserRef }: BrowserImagesPanelProps) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0)
  const callbacks = useRef({ loadImage, cancelImageRequests })
  callbacks.current = { loadImage, cancelImageRequests }
  const [ownedLoader, setOwnedLoader] = useState<{ snapshot: BrowserImageSnapshot; loader: BrowserImageLoader } | null>(null)
  useEffect(() => {
    if (!snapshot) { setOwnedLoader(null); return }
    const owner = new BrowserImageLoader(snapshot, request => callbacks.current.loadImage(request),
      request => callbacks.current.cancelImageRequests(request), refresh)
    setOwnedLoader({ snapshot, loader: owner })
    return () => owner.close()
  }, [snapshot])
  // Allocate the resource owner inside its effect. StrictMode can replay setup
  // and cleanup, so a memoized instance must never survive after being closed.
  const loader = ownedLoader?.snapshot === snapshot ? ownedLoader.loader : null
  const [filter, setFilter] = useState<'content' | 'all'>('content')
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'save' | 'share' | null>(null)
  const confirmAnswer = useRef<((answer: boolean) => void) | null>(null)
  const lightboxCloser = useRef<(() => boolean) | null>(null)
  const actionEpoch = useRef(0)
  const contentCount = snapshot?.items.filter(item => item.content).length ?? 0
  const items = useMemo(() => snapshot?.items.filter(item => filter === 'all' || item.content) ?? [], [snapshot, filter])
  const pageCount = Math.max(1, Math.ceil(items.length / BROWSER_IMAGE_PAGE_SIZE))
  const currentPage = Math.min(pageIndex, pageCount - 1)
  const pageItems = items.slice(currentPage * BROWSER_IMAGE_PAGE_SIZE, (currentPage + 1) * BROWSER_IMAGE_PAGE_SIZE)
  const selected = items.findIndex(item => item.id === selectedId)
  const current = items[selected]
  const closeViewer = useCallback(() => {
    actionEpoch.current++
    loader?.cancelExports()
    loader?.displayWindow([])
    setSelectedId(null)
  }, [loader])
  const answerExport = useCallback((answer: boolean) => {
    confirmAnswer.current?.(answer)
    confirmAnswer.current = null
    setConfirmation(null)
  }, [])
  const focus = useBrowserDialogFocus<HTMLElement>(selected < 0)
  useEffect(() => {
    actionEpoch.current++
    answerExport(false)
    setSelectedId(null)
    setPageIndex(0)
    setFilter(snapshot?.items.some(item => item.content) ? 'content' : 'all')
  }, [snapshot, answerExport])
  useEffect(() => () => { actionEpoch.current++; confirmAnswer.current?.(false); confirmAnswer.current = null }, [])
  useEffect(() => {
    if (!overlayCloserRef) return
    overlayCloserRef.current = () => {
      if (confirmation) { answerExport(false); return true }
      return selected >= 0 ? lightboxCloser.current?.() ?? false : false
    }
    return () => { overlayCloserRef.current = null }
  }, [confirmation, answerExport, overlayCloserRef, selected])
  useEffect(() => {
    if (!loader || selected < 0) return
    // Only the current image and its two neighbours request display-size bytes.
    const window = [selected, selected - 1, selected + 1].map(position => items[position]).filter(Boolean)
    loader.displayWindow(window)
    for (const item of window) void loader.load(item, false).catch(() => {})
  }, [loader, selected, items])
  const select = (position: number) => {
    const next = items[position]
    if (next) {
      actionEpoch.current++
      loader?.cancelExports()
      setSelectedId(next.id)
    }
  }
  const beforeAction = async (action: 'save' | 'share'): Promise<boolean> => {
    if (!loader || !current) return false
    if (!privateMode) return true
    const generation = actionEpoch.current
    const approved = await new Promise<boolean>(resolve => {
      confirmAnswer.current = resolve
      setConfirmation(action)
    })
    return approved && generation === actionEpoch.current
  }
  const runAction = async (action: 'save' | 'share'): Promise<ImageActionResult> => {
    if (!loader || !current) return 'cancelled'
    const generation = actionEpoch.current
    try {
      const blob = await loader.original(current)
      if (generation !== actionEpoch.current) return 'cancelled'
      return exportImage(blob, action, browserImageTitle(current, selected))
    } catch (failure) {
      if (generation !== actionEpoch.current || failure instanceof Error && /已取消|已关闭/.test(failure.message)) return 'cancelled'
      throw failure
    }
  }
  const scanAgain = () => {
    closeViewer()
    onScan()
  }
  return <section ref={focus} tabIndex={-1} role="dialog" aria-modal="true" aria-label="看图模式"
    className="browser-overlay absolute inset-0 z-50 flex flex-col bg-ink outline-none"
    style={{paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)'}}>
    <div inert={selected >= 0} className="flex min-h-0 flex-1 flex-col">
      <BrowserPageHeader title="看图模式" subtitle={privateMode ? '隐私会话' : undefined} onBack={onClose}>
        <BrowserIconButton label="重新扫描图片" onClick={scanAgain} disabled={scanning}>
          <RefreshCw size={20} className={scanning ? 'animate-spin' : ''}/>
        </BrowserIconButton>
      </BrowserPageHeader>
      <div className="shrink-0 border-b border-haze px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[13px] text-paper-muted">{snapshot
            ? (() => { try { return new URL(snapshot.pageUrl).hostname } catch { return '当前网页' } })()
            : '当前网页'}</p>
          <span aria-live="polite" className="shrink-0 text-[13px] text-paper-muted tabular-nums">{scanning ? '扫描中…' : (snapshot?.items.length ?? 0) + ' 张图片'}</span>
        </div>
        <div role="group" aria-label="图片筛选" className="mt-3 flex gap-2">
          {([['content', '内容图片 ' + contentCount], ['all', '全部图片 ' + (snapshot?.items.length ?? 0)]] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPageIndex(0) }}
              className={'min-h-11 flex-1 rounded-xl border px-3 text-sm transition-colors ' +
                (filter === value ? 'border-cinnabar/40 bg-cinnabar/10 text-cinnabar-soft' : 'border-haze text-paper-muted active:bg-haze/40')}>{label}</button>)}
        </div>
        <p className="mt-2 text-[13px] leading-5 text-paper-muted">{privateMode ? '仅在私密会话内查看 · 保存或分享时需确认' : '点击缩略图查看 · 支持缩放、前后切换和分享'}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {error ? <div role="status" className="mb-4 rounded-2xl border border-haze bg-ink-raised p-4">
          <p className="text-sm leading-6 text-paper-muted">{error}</p>
          <button type="button" disabled={scanning} onClick={scanAgain} className="mt-2 min-h-11 text-sm text-cinnabar-soft disabled:opacity-40">重试扫描</button>
        </div> : null}
        {scanning && !snapshot ? <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-4 text-paper-muted">
          <LoaderCircle size={30} className="animate-spin"/><p className="text-sm">正在扫描当前网页的图片</p>
        </div> : !items.length ? <div className="flex min-h-64 flex-col items-center justify-center text-center">
          <Images size={36} className="text-paper-faint"/>
          <h3 className="mt-5 text-base font-medium text-paper">{filter === 'content' && (snapshot?.items.length ?? 0) > 0 ? '暂未识别到内容图片' : '暂未发现可查看的图片'}</h3>
          <p className="mt-2 max-w-xs text-sm leading-6 text-paper-muted">{filter === 'content' && (snapshot?.items.length ?? 0) > 0
            ? '可以切换到全部图片，查看图标、背景和其他配图。' : '返回网页滚动或等待图片加载，再扫描一次。受限制的跨站框架可能无法读取。'}</p>
          <button type="button" disabled={scanning} onClick={filter === 'content' && (snapshot?.items.length ?? 0) > 0 ? () => setFilter('all') : scanAgain}
            className="mt-5 min-h-11 rounded-xl border border-haze px-5 text-sm text-paper disabled:opacity-40">{filter === 'content' && (snapshot?.items.length ?? 0) > 0 ? '查看全部图片' : '重新扫描'}</button>
        </div> : <div className="grid grid-cols-2 gap-3 min-[361px]:grid-cols-3 sm:grid-cols-4">
          {pageItems.map((item, offset) => {
            const position = currentPage * BROWSER_IMAGE_PAGE_SIZE + offset
            return <button key={item.id} type="button" disabled={scanning} aria-label={'查看：' + browserImageTitle(item, position)} onClick={() => setSelectedId(item.id)}
              className="min-h-11 overflow-hidden rounded-2xl border border-haze bg-ink-raised text-left active:border-cinnabar/50">
              <span className="block aspect-square overflow-hidden">{loader ? <ImageThumbnail item={item} loader={loader} revision={revision} enabled={selected < 0 && !scanning}/> : null}</span>
              <span className="block truncate px-2 pt-2 text-sm text-paper">{browserImageTitle(item, position)}</span>
              <span className="block truncate px-2 pt-1 pb-2 text-[13px] text-paper-muted tabular-nums">{item.width && item.height ? item.width + '×' + item.height : browserImageSourceLabel(item)}</span>
            </button>
          })}
        </div>}
        {snapshot?.truncated ? <p className="mt-4 text-[13px] leading-5 text-paper-muted">本次扫描达到页面大小预算。可在网页加载完成后再次扫描。</p> : null}
        {(snapshot?.inaccessibleFrames ?? 0) > 0 ? <p className="mt-2 text-[13px] leading-5 text-paper-muted">有 {snapshot?.inaccessibleFrames} 个跨站或未加载框架无法读取，已展示能够访问的图片。</p> : null}
      </div>
      {pageCount > 1 ? <nav aria-label="图片分页" className="flex shrink-0 items-center justify-center gap-4 border-t border-haze bg-ink-raised p-2">
        <BrowserIconButton label="上一页图片" onClick={() => setPageIndex(currentPage - 1)} disabled={currentPage === 0}><ChevronLeft size={20}/></BrowserIconButton>
        <span className="text-[13px] text-paper-muted tabular-nums">{currentPage + 1} / {pageCount}</span>
        <BrowserIconButton label="下一页图片" onClick={() => setPageIndex(currentPage + 1)} disabled={currentPage === pageCount - 1}><ChevronRight size={20}/></BrowserIconButton>
      </nav> : null}
    </div>
    {current && loader ? <ImageLightbox src={loader.cached(current, false) || ''} alt={browserImageTitle(current, selected)}
      index={selected} total={items.length} onClose={closeViewer} onPrevious={selected > 0 ? () => select(selected - 1) : undefined}
      onNext={selected < items.length - 1 ? () => select(selected + 1) : undefined} onSelect={select}
      items={items.map(item => ({ src: loader.cached(item, false) || '', alt: item.alt }))}
      loadError={loader.error(current, false) || null} onRetry={() => { void loader.load(current, false, true).catch(() => {}); refresh() }}
      onBeforeAction={beforeAction} onAction={runAction} browserMode contextLabel={privateMode ? '隐私' : undefined} overlayCloserRef={lightboxCloser}
      renderThumbnail={(_, position) => <ImageThumbnail item={items[position]} loader={loader} revision={revision}/>}/> : null}
    {confirmation ? <ExportConfirmation action={confirmation} onAnswer={answerExport}/> : null}
  </section>
}
