import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

import { resolveContextMenuPosition, type Point } from '../lib/contextActions'
import { useHardwareBackLayer } from '../hooks/useHardwareBackLayer'

export interface ContextActionItem {
  id: string
  label: string
  icon: LucideIcon
  tone?: 'default' | 'accent' | 'danger'
  onSelect: () => void
}

interface Props {
  open: boolean
  anchor: Point
  title: string
  caption?: string
  actions: ContextActionItem[]
  onClose: () => void
}

/** 触点锚定动作菜单：移动端长按与桌面右键共用同一套交互。 */
export function ContextActionMenu({
  open,
  anchor,
  title,
  caption,
  actions,
  onClose,
}: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  useHardwareBackLayer(open, () => {
    onClose()
    return true
  })
  const [position, setPosition] = useState<ReturnType<typeof resolveContextMenuPosition> | null>(
    null,
  )

  const updatePosition = useCallback(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    setPosition(
      resolveContextMenuPosition(
        anchor,
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }, [anchor])

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return
    updatePosition()
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [actions.length, open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('resize', updatePosition)
    }
  }, [onClose, open, updatePosition])

  if (!open || !actions.length) return null

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    )
    if (!buttons.length) return
    event.preventDefault()
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : event.key === 'ArrowUp'
            ? (current - 1 + buttons.length) % buttons.length
            : (current + 1) % buttons.length
    buttons[next]?.focus()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label={`${title}操作菜单`}
        onKeyDown={moveFocus}
        className="context-action-menu fixed w-[220px] overflow-hidden rounded-xl border border-haze/90 bg-ink-raised/98 p-1.5 text-paper shadow-[0_18px_48px_-18px_rgba(0,0,0,0.72),0_2px_10px_rgba(0,0,0,0.28)]"
        style={{
          left: position?.left ?? anchor.x,
          top: position?.top ?? anchor.y,
          visibility: position ? 'visible' : 'hidden',
          transformOrigin: position
            ? `${position.horizontal === 'right' ? 'left' : 'right'} ${position.vertical === 'below' ? 'top' : 'bottom'}`
            : undefined,
        }}
      >
        <div className="border-b border-haze/70 px-2.5 py-2">
          <p className="truncate text-[12.5px] font-medium text-paper">{title}</p>
          {caption && (
            <p className="mt-0.5 truncate font-mono text-[9.5px] tracking-wide text-paper-faint">
              {caption}
            </p>
          )}
        </div>
        <div className="pt-1">
          {actions.map(({ id, label, icon: Icon, tone = 'default', onSelect }) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect()
                onClose()
              }}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] outline-none transition-colors focus-visible:bg-paper/10 ${
                tone === 'danger'
                  ? 'text-cinnabar-soft hover:bg-cinnabar/12 active:bg-cinnabar/18'
                  : tone === 'accent'
                    ? 'text-paper hover:bg-paper/8 active:bg-paper/12'
                    : 'text-paper-muted hover:bg-paper/8 hover:text-paper active:bg-paper/12'
              }`}
            >
              <Icon
                size={15.5}
                strokeWidth={1.7}
                className={tone === 'accent' ? 'text-cinnabar-soft' : undefined}
              />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
