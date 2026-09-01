/**
 * 嗅探资源浮层：内嵌播放时的悬浮胶囊 + 底部资源选择抽屉。
 * 在支持独立媒体页的宿主里，抽屉项目会进入媒体页，而不是直接替换内嵌播放器。
 */

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { ChevronLeft, ListVideo } from 'lucide-react'

import type { MediaResourceDescriptor } from '../../features/mediaSniffer/types'
import { lockBodyScroll } from '../../lib/bodyScrollLock'

type MediaResourcePageContextValue = {
  open?: (resource: MediaResourceDescriptor, resources: MediaResourceDescriptor[]) => void
  suppressOverlay?: boolean
}

const MediaResourcePageContext = createContext<MediaResourcePageContextValue | null>(null)

export function MediaResourcePageProvider({
  open,
  suppressOverlay,
  children,
}: MediaResourcePageContextValue & { children: ReactNode }) {
  return (
    <MediaResourcePageContext.Provider value={{ open, suppressOverlay }}>
      {children}
    </MediaResourcePageContext.Provider>
  )
}

function resourceLabel(resource: MediaResourceDescriptor): string {
  if (resource.type === 'hls') return 'HLS'
  if (resource.type === 'dash') return 'DASH'
  return 'MP4'
}

function isSameResource(
  left: MediaResourceDescriptor,
  right: MediaResourceDescriptor,
): boolean {
  if (left.id && right.id) return left.id === right.id
  return left.type === right.type && left.url === right.url
}

function MediaResourceRow({
  resource,
  index,
  active = false,
  onSelect,
}: {
  resource: MediaResourceDescriptor
  index: number
  active?: boolean
  onSelect: () => void
}) {
  const detail = resource.videoTracks.find((track) => track.width || track.height)
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-paper transition-colors ${
        active ? 'bg-paper/10' : 'hover:bg-paper/5 active:bg-paper/10'
      }`}
    >
      <span
        className={`flex h-7 min-w-7 items-center justify-center rounded-full font-mono text-[10px] ${
          active ? 'bg-cinnabar text-white' : 'bg-paper/10'
        }`}
      >
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="font-medium">{resourceLabel(resource)}</span>
          {resource.isAd && (
            <span className="rounded bg-cinnabar/20 px-1 text-[9px] text-cinnabar-soft">广告</span>
          )}
          {detail && (
            <span className="text-paper/50">
              {detail.width || '?'}×{detail.height || '?'}
            </span>
          )}
          {active && (
            <span className="rounded-full border border-cinnabar/40 px-1.5 py-0.5 text-[9px] leading-none text-cinnabar-soft">
              当前播放
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-paper/50">{resource.url}</span>
      </span>
    </button>
  )
}

export function MediaResourceOverlay({
  resources,
  open,
  immersive,
  onToggle,
  onSelect,
}: {
  resources: MediaResourceDescriptor[]
  open: boolean
  immersive: boolean
  onToggle: () => void
  onSelect: (resource: MediaResourceDescriptor) => void
}) {
  const pageContext = useContext(MediaResourcePageContext)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle()
    }
    const unlock = lockBodyScroll()
    window.addEventListener('keydown', onKey)
    return () => {
      unlock()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onToggle])

  if (!resources.length || immersive || pageContext?.suppressOverlay) return null

  const selectResource = (resource: MediaResourceDescriptor) => {
    if (pageContext?.open) {
      onToggle()
      pageContext.open(resource, resources)
      return
    }
    onSelect(resource)
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          data-no-page-tap=""
          aria-label={`选择视频资源，共 ${resources.length} 个`}
          aria-expanded={false}
          title={`视频资源（${resources.length}）`}
          onClick={onToggle}
          className="fixed z-[100] flex items-center gap-2 rounded-full border border-haze bg-ink/95 px-3.5 py-2 text-paper shadow-xl shadow-black/35 backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
          style={{
            bottom: 'calc(var(--sab, 0px) + 76px)',
            right: 'calc(var(--sar, 0px) + 1rem)',
          }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar">
            <ListVideo size={13} strokeWidth={2} />
          </span>
          <span className="font-mono text-[12px] font-medium tracking-[0.03em]">嗅探 {resources.length}</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
          role="presentation"
          data-no-page-tap=""
          onClick={onToggle}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`已嗅探到 ${resources.length} 个资源`}
            className="flex max-h-[min(78vh,520px)] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-haze" />
            </div>
            <h3 className="shrink-0 border-b border-haze/50 px-5 pt-3 pb-3 font-display text-[17px] font-medium text-paper">
              已嗅探到 {resources.length} 个资源
            </h3>
            <ul className="scroll-hidden min-h-0 flex-1 divide-y divide-haze overflow-y-auto overscroll-contain">
              {resources.map((resource, index) => (
                <li key={`${resource.id || resource.url}:${index}`}>
                  <MediaResourceRow
                    resource={resource}
                    index={index}
                    onSelect={() => selectResource(resource)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

export function MediaResourceScreen({
  title,
  resources,
  activeResource,
  onClose,
  onSelect,
  children,
}: {
  title?: string
  resources: MediaResourceDescriptor[]
  activeResource: MediaResourceDescriptor
  onClose: () => void
  onSelect: (resource: MediaResourceDescriptor) => void
  children: ReactNode
}) {
  useEffect(() => lockBodyScroll(), [])

  return (
    <div
      data-media-resource-screen=""
      data-no-page-tap=""
      role="dialog"
      aria-modal="true"
      aria-label="媒体资源"
      className="fixed inset-0 z-[110] bg-ink text-paper"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col bg-ink">
        <header
          className="flex shrink-0 items-center gap-2 border-b border-haze/70 bg-ink-raised px-2.5 pb-2"
          style={{ paddingTop: 'calc(var(--sat, 0px) + 8px)' }}
        >
          <button
            type="button"
            aria-label="返回文章"
            title="返回文章"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-paper transition-colors hover:bg-paper/5 active:bg-paper/10"
          >
            <ChevronLeft size={24} strokeWidth={2} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-medium leading-tight text-paper">媒体资源</div>
            {title && <div className="mt-0.5 truncate text-[11px] text-paper/50">{title}</div>}
          </div>
          <span className="shrink-0 rounded-full border border-haze px-2.5 py-1 font-mono text-[10px] text-paper-muted">
            {resources.length} 个资源
          </span>
        </header>

        <div className="shrink-0 bg-black">
          <MediaResourcePageProvider suppressOverlay>
            {children}
          </MediaResourcePageProvider>
        </div>

        <section className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-ink-raised">
          <div className="sticky top-0 z-[1] flex items-end justify-between gap-3 border-b border-haze/60 bg-ink-raised/95 px-5 py-3 backdrop-blur-md">
            <div>
              <h2 className="font-display text-[15px] font-medium text-paper">嗅探资源</h2>
              <p className="mt-0.5 text-[10px] text-paper/45">点选资源即可切换播放</p>
            </div>
            <span className="font-mono text-[10px] text-paper/45">{resources.length}</span>
          </div>
          <ul
            className="divide-y divide-haze/70"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 20px)' }}
          >
            {resources.map((resource, index) => (
              <li key={`${resource.id || resource.url}:${index}`}>
                <MediaResourceRow
                  resource={resource}
                  index={index}
                  active={isSameResource(resource, activeResource)}
                  onSelect={() => onSelect(resource)}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
