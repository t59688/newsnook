import { useState } from 'react'
import { Bookmark, BookmarkCheck, CircleMinus, FolderInput, Pencil } from 'lucide-react'

import { useLongPressAction } from '../hooks/useLongPressAction'
import type { Point } from '../lib/contextActions'
import type { NewsCategory } from '../sources/categories'
import type { NewsSource } from '../sources/registry'
import { ContextActionMenu, type ContextActionItem } from './ContextActionMenu'
import { OptionPickerDialog, PromptDialog } from './ConfirmDialog'

interface Props {
  sources: NewsSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string | null) => void
  favoriteSourceIds?: readonly string[]
  onToggleFavorite?: (sourceId: string) => void
  onRemoveSource?: (sourceId: string) => void
  onRenameSource?: (sourceId: string, name: string) => void
  moveTargets?: NewsCategory[]
  onMoveSource?: (sourceId: string, targetCategoryId: string) => void
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
  onRenameSource,
  moveTargets = [],
  onMoveSource,
  counts,
}: Props) {
  const [actionMenu, setActionMenu] = useState<{ sourceId: string; anchor: Point } | null>(null)
  const [renameSourceId, setRenameSourceId] = useState<string | null>(null)
  const [moveSourceId, setMoveSourceId] = useState<string | null>(null)
  const [moveTargetCategoryId, setMoveTargetCategoryId] = useState('')
  const longPress = useLongPressAction<string>((sourceId, anchor) => {
    setActionMenu({ sourceId, anchor })
  })

  if (!sources.length) return null

  const actionSource = actionMenu
    ? sources.find((source) => source.id === actionMenu.sourceId)
    : undefined
  const actionIsFavorite = actionSource ? favoriteSourceIds.includes(actionSource.id) : false
  const renameSource = sources.find((source) => source.id === renameSourceId)
  const actionItems: ContextActionItem[] = actionSource
    ? [
        ...(onRenameSource ? [{
          id: 'rename',
          label: '重命名信源',
          icon: Pencil,
          onSelect: () => setRenameSourceId(actionSource.id),
        }] : []),
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
        ...(onMoveSource && moveTargets.length
          ? [{
              id: 'move',
              label: '移动到分类',
              icon: FolderInput,
              onSelect: () => {
                setMoveSourceId(actionSource.id)
                setMoveTargetCategoryId(moveTargets[0]?.id ?? '')
              },
            }]
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
    <div className="editorial-source-filters relative w-full">
      <div
        className="page-x horizontal-scroll-rail scroll-hidden max-w-[2400px] mx-auto flex items-center gap-1.5 overflow-x-auto lg:px-6 xl:px-8 2xl:px-10 py-1 select-none"
      >
        {sources.length > 1 && (
          <button
            type="button"
            aria-pressed={selectedSourceId === null}
            onClick={() => onSelect(null)}
            className={`group flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px] transition-all duration-200 active:scale-95 ${
              selectedSourceId === null
                ? 'bg-paper text-ink font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-paper/20'
                : 'border border-haze/60 bg-ink-raised/40 text-paper-muted/80 hover:border-paper-faint/40 hover:bg-ink-raised hover:text-paper'
            }`}
          >
            <span>全部</span>
            <span className={`font-mono text-[9.5px] leading-none ${selectedSourceId === null ? 'text-ink/70 font-semibold' : 'text-paper-faint/70 group-hover:text-paper-muted'}`}>
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
              aria-pressed={isSelected}
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
              className={`custom-long-press-target group flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-all duration-200 active:scale-95 ${
                isSelected
                  ? 'bg-paper text-ink font-medium shadow-[0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-paper/20'
                  : 'border border-haze/60 bg-ink-raised/40 text-paper-muted/80 hover:border-paper-faint/40 hover:bg-ink-raised hover:text-paper'
              }`}
              style={{ WebkitTouchCallout: 'none', touchAction: 'pan-x' }}
            >
              <span className="truncate max-w-[140px]">{source.name}</span>
              {favorite && <BookmarkCheck size={10} strokeWidth={1.8} className={isSelected ? 'text-ink/75' : 'text-cinnabar-soft'} />}
              {typeof count === 'number' && (
                <span className={`font-mono text-[9.5px] leading-none ${isSelected ? 'text-ink/70 font-semibold' : 'text-paper-faint/70 group-hover:text-paper-muted'}`}>
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
      <OptionPickerDialog
        open={Boolean(moveSourceId && onMoveSource && moveTargets.length)}
        title="移动到分类"
        value={moveTargets.some((category) => category.id === moveTargetCategoryId)
          ? moveTargetCategoryId
          : moveTargets[0]?.id ?? ''}
        options={moveTargets.map((category) => ({ id: category.id, label: category.label }))}
        onCancel={() => setMoveSourceId(null)}
        onChange={(targetCategoryId) => {
          if (moveSourceId && onMoveSource) onMoveSource(moveSourceId, targetCategoryId)
          setMoveSourceId(null)
        }}
      />
      <PromptDialog
        open={Boolean(renameSource && onRenameSource)}
        title="重命名信源"
        message="修改显示名称，不影响订阅地址和内容。"
        label="信源名称"
        defaultValue={renameSource?.name ?? ''}
        confirmLabel="保存名称"
        onConfirm={(value) => {
          const name = value.trim()
          if (!renameSource || !onRenameSource || !name) return
          onRenameSource(renameSource.id, name)
          setRenameSourceId(null)
        }}
        onCancel={() => setRenameSourceId(null)}
      />
    </div>
  )
}
