import { Bookmark, Newspaper } from 'lucide-react'

/* 底部 Tab 栏 —— 复刻 src/components/TabBar.tsx：
 * 速闻 / 预设切换位 / 我的；选中朱砂，稍后读计数徽章。 */
export function TabBar({
  active,
  onChange,
  laterCount = 3,
}: {
  active: 'today' | 'me'
  onChange?: (t: 'today' | 'me') => void
  laterCount?: number
}) {
  const tabs = [
    { key: 'today' as const, label: '速闻', Icon: Newspaper },
    { key: 'me' as const, label: '我的', Icon: Bookmark },
  ]
  return (
    <nav
      data-surface="tabbar"
      className="relative z-20 shrink-0 overflow-visible border-t border-haze/50 bg-ink/94 backdrop-blur-xl transition-colors duration-300"
    >
      <ul className="flex h-14 items-stretch px-2">
        {tabs.map(({ key, label, Icon }, i) => {
          const isActive = key === active
          return (
            <li key={key} className="flex-1">
              {i === 1 && (
                <span className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-haze bg-ink-raised/70 px-3 py-1 font-mono text-[10px] tracking-[0.12em] text-paper-muted sm:flex">
                  场景预设
                </span>
              )}
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onChange?.(key)}
                className="group relative flex h-full w-full flex-col items-center justify-center gap-0.5 transition-transform duration-100 active:scale-[0.93]"
              >
                <span className="relative flex items-center justify-center">
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2 : 1.5}
                    className={`transition-all duration-200 ${
                      isActive ? 'scale-105 text-cinnabar' : 'text-paper-muted/75 group-hover:text-paper'
                    }`}
                  />
                  {key === 'me' && laterCount > 0 && (
                    <span className="absolute -top-1 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cinnabar px-1 font-mono text-[9px] font-medium leading-none text-white shadow-sm">
                      {laterCount}
                    </span>
                  )}
                </span>
                <span
                  className={`font-mono text-[10.5px] tracking-[0.14em] transition-colors duration-200 ${
                    isActive ? 'font-medium text-cinnabar' : 'text-paper-muted/75 group-hover:text-paper'
                  }`}
                >
                  {label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
