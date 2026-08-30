/**
 * 嗅探资源浮层：内嵌播放时的悬浮胶囊 + 底部资源选择抽屉。
 */

import { useEffect } from 'react'
import { ListVideo } from 'lucide-react'

import type { MediaResourceDescriptor } from '../../features/mediaSniffer/types'
import { lockBodyScroll } from '../../lib/bodyScrollLock'

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

  if (!resources.length || immersive) return null

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
              {resources.map((resource, index) => {
                const label = resource.type === 'hls' ? 'HLS' : resource.type === 'dash' ? 'DASH' : 'MP4'
                const detail = resource.videoTracks.find((track) => track.width || track.height)
                return (
                  <li key={`${resource.id || resource.url}:${index}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(resource)}
                      className="flex w-full items-center gap-2.5 px-5 py-3.5 text-left text-paper transition-colors hover:bg-paper/5 active:bg-paper/10"
                    >
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-paper/10 font-mono text-[10px]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px]">
                          <span className="font-medium">{label}</span>
                          {resource.isAd && (
                            <span className="rounded bg-cinnabar/20 px-1 text-[9px] text-cinnabar-soft">广告</span>
                          )}
                          {detail && (
                            <span className="text-paper/50">
                              {detail.width || '?'}×{detail.height || '?'}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-paper/50">{resource.url}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
