import { Bell } from 'lucide-react'

/**
 * A persistent inbox shortcut in the NewsNook feed toolbar. It remains visible
 * when zero sources are watched, and uses a bounded numeric badge for updates.
 */
export function WatchInboxButton({
  unreadCount,
  onOpen,
}: {
  unreadCount: number
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={unreadCount > 0 ? `关注动态，${unreadCount} 篇未读` : '关注动态'}
      className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-transparent text-paper-muted transition-[color,background,transform] duration-150 hover:border-haze/60 hover:bg-ink-raised/60 hover:text-paper active:scale-[0.94]"
    >
      <Bell size={19} strokeWidth={1.65} className={unreadCount ? 'text-cinnabar' : undefined} aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-ink bg-cinnabar px-[2px] text-[10px] font-semibold leading-none text-white"
          aria-hidden="true"
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}
