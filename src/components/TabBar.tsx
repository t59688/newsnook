import { memo, useRef } from 'react'
import { Bookmark, Newspaper } from 'lucide-react'

import { PresetSwitcher, type PresetSwitcherProps } from './PresetSwitcher'

const TODAY_DOUBLE_TAP_MS = 360

export type TabKey = 'today' | 'sites' | 'me'

const TABS: { key: TabKey; label: string; Icon: typeof Newspaper }[] = [
  { key: 'today', label: '速闻', Icon: Newspaper },
  { key: 'me', label: '我的', Icon: Bookmark },
]

interface Props {
  active: TabKey
  laterCount: number
  hasUpdate?: boolean
  onChange: (key: TabKey) => void
  onTodayDoubleTap?: () => void
  /** 中央“布局”是动作入口，不参与 TabKey / active 状态。 */
  presetSwitcher?: Omit<PresetSwitcherProps, 'variant'>
}

/**
 * 底栏导航：经典竖向图文布局，朱砂色彩点睛，配色温润纯净，无多余胶囊或杂质。
 */
export const TabBar = memo(function TabBar({
  active,
  laterCount,
  hasUpdate,
  onChange,
  onTodayDoubleTap,
  presetSwitcher,
}: Props) {
  const lastTodayTapAt = useRef(0)

  const renderTab = ({ key, label, Icon }: (typeof TABS)[number]) => {
    const isActive = key === active
    return (
      <li key={key} className="flex-1">
        <button
          type="button"
          onClick={() => {
            if (key === 'today' && isActive && onTodayDoubleTap) {
              const now = performance.now()
              if (now - lastTodayTapAt.current < TODAY_DOUBLE_TAP_MS) {
                lastTodayTapAt.current = 0
                onTodayDoubleTap()
                return
              }
              lastTodayTapAt.current = now
            }
            onChange(key)
          }}
          aria-current={isActive ? 'page' : undefined}
          aria-label={key === 'today' && isActive ? '速闻，双击刷新' : undefined}
          className="group relative flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors duration-200"
        >
          <span className="relative flex items-center justify-center">
            <Icon
              size={20}
              strokeWidth={isActive ? 2 : 1.5}
              className={`transition-all duration-200 ${
                isActive
                  ? 'scale-105 text-cinnabar'
                  : 'text-paper-muted/75 group-hover:text-paper group-active:scale-95'
              }`}
            />
            {key === 'me' && (
              laterCount > 0 ? (
                <span className="absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cinnabar px-1 font-mono text-[9px] font-medium leading-none text-white shadow-sm">
                  {laterCount > 99 ? '99+' : laterCount}
                </span>
              ) : hasUpdate ? (
                <span className="absolute -top-0.5 -right-1 flex h-2 w-2 rounded-full bg-cinnabar ring-2 ring-ink shadow-xs" />
              ) : null
            )}
          </span>
          <span
            className={`font-mono text-[10.5px] tracking-[0.14em] transition-colors duration-200 ${
              isActive
                ? 'font-medium text-cinnabar'
                : 'text-paper-muted/75 group-hover:text-paper'
            }`}
          >
            {label}
          </span>
        </button>
      </li>
    )
  }

  return (
    <nav
      data-surface="tabbar"
      data-tour="tab-bar"
      className="relative z-20 shrink-0 overflow-visible border-t border-haze/50 bg-ink/94 backdrop-blur-xl transition-colors duration-300 lg:hidden"
      style={{ paddingBottom: 'var(--sab)' }}
    >
      <ul className="flex h-14 items-stretch px-2">
        {renderTab(TABS[0])}
        <li className="flex flex-1 justify-center">
          {presetSwitcher ? (
            <PresetSwitcher variant="tabbar" {...presetSwitcher} />
          ) : (
            <span className="h-full" aria-hidden />
          )}
        </li>
        {renderTab(TABS[1])}
      </ul>
    </nav>
  )
})
