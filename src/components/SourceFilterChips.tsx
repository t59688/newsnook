import { useState } from 'react'
import { Bookmark, BookmarkCheck, CircleMinus } from 'lucide-react'

import { useLongPressAction } from '../hooks/useLongPressAction'
import type { Point } from '../lib/contextActions'
import type { NewsSource } from '../sources/registry'
import { ContextActionMenu, type ContextActionItem } from './ContextActionMenu'

interface Props {
  sources: NewsSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string | null) => void
  favoriteSourceIds?: readonly string[]
  onToggleFavorite?: (sourceId: string) => void
  onRemoveSource?: (sourceId: string) => void
  /** 可选：每个信源的文章数量统计 */
  counts?: Record<string, number>
}

export function SourceFilterChips({
  sources,
  selectedSourceId,
  onSelect,
  favoriteSourceIds = [],
  onToggleFavorite,
  onRemoveSource,
  counts,
}: Props) {
  const [actionMenu, setActionMenu] = useState<{ sourceId: string; anchor: Point } | null>(null)
  const longPress = useLongPressAction<string>((sourceId, anchor) => {
    setActionMenu({ sourceId, anchor })
  })

  if (!sources.length) return null

  const actionSource = actionMenu
    ? sources.find((source) => source.id === actionMenu.sourceId)
    : undefined
  const actionIsFavorite = actionSource ? favoriteSourceIds.includes(actionSource.id) : false
  const actionItems: ContextActionItem[] = actionSource
    ? [
        ...(onToggleFavorite
          ? [
              {
                id: 'favorite',
                label: actionIsFavorite ? '取消收藏' : '收藏到当前预设',
                icon: actionIsFavorite ? BookmarkCheck : Bookmark,
                tone: 'accent' as const,
                onSelect: () => onToggleFavorite(actionSource.id),
              },
            ]
          : []),
        ...(onRemoveSource
          ? [
              {
                id: 'remove',
                label: '从当前分类移出',
                icon: CircleMinus,
                tone: 'danger' as const,
                onSelect: () => onRemoveSource(actionSource.id),
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="relative w-full">
      <div
        className="horizontal-scroll-rail scroll-hidden max-w-[2400px] mx-auto flex items-center gap-1.5 overflow-x-auto px-4 lg:px-6 xl:px-8 2xl:px-10 py-0.5 select-none"
      >
        {sources.length > 1 && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 font-mono text-[10.5px] transition-all duration-200 active:scale-95 ${
              selectedSourceId === null
                ? 'bg-paper text-ink font-medium shadow-2xs ring-1 ring-paper/25'
                : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
            }`}
          >
            <span>全部</span>
            <span className={`font-mono text-[9px] leading-none ${selectedSourceId === null ? 'text-ink/75 font-semibold' : 'text-paper-faint/80 group-hover:text-paper-muted'}`}>
              {sources.length}
            </span>
          </button>
        )}

        {sources.map((source) => {
          const isSelected = selectedSourceId === source.id
          const count = counts?.[source.id]
          const favorite = favoriteSourceIds.includes(source.id)
          return (
            <button
              key={source.id}
              type="button"
              onClick={() => {
                if (longPress.consumeClick(source.id)) return
                onSelect(isSelected ? null : source.id)
              }}
              onPointerDown={(event) => longPress.start(source.id, event)}
              onPointerMove={longPress.move}
              onPointerUp={longPress.cancel}
              onPointerCancel={longPress.cancel}
              onPointerLeave={longPress.cancel}
              onContextMenu={(event) => {
                event.preventDefault()
                setActionMenu({
                  sourceId: source.id,
                  anchor: { x: event.clientX, y: event.clientY },
                })
              }}
              aria-haspopup="menu"
              aria-label={`${source.name}${favorite ? '，已收藏' : ''}，长按管理`}
              className={`custom-long-press-target group flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[10.5px] transition-all duration-200 active:scale-95 ${
                isSelected
                  ? 'bg-paper text-ink font-medium shadow-2xs ring-1 ring-paper/25'
                  : 'border border-haze/80 bg-ink-raised/60 text-paper-muted/90 hover:border-paper-faint/50 hover:bg-ink-raised hover:text-paper'
              }`}
              style={{ WebkitTouchCallout: 'none', touchAction: 'pan-x' }}
            >
              <span className="truncate max-w-[140px]">{source.name}</span>
              {favorite && <BookmarkCheck size={10} strokeWidth={1.8} className={isSelected ? 'text-ink/75' : 'text-cinnabar-soft'} />}
              {typeof count === 'number' && (
                <span className={`font-mono text-[9px] leading-none ${isSelected ? 'text-ink/75 font-semibold' : 'text-paper-faint/80 group-hover:text-paper-muted'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <ContextActionMenu
        open={Boolean(actionSource && actionMenu)}
        anchor={actionMenu?.anchor ?? { x: 0, y: 0 }}
        title={actionSource?.name ?? ''}
        caption="当前预设 · 信源管理"
        actions={actionItems}
        onClose={() => setActionMenu(null)}
      />
    </div>
  )
}
