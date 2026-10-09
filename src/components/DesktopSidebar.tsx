import { memo } from 'react'
import {
  Bookmark,
  History,
  Info,
  Moon,
  Newspaper,
  Settings,
  Sun,
} from 'lucide-react'

import { PresetSwitcher, type PresetSwitcherProps } from './PresetSwitcher'
import { BrandLogo } from './BrandLogo'
import { chineseDate } from '../lib/time'
import type { CategoryId, NewsCategory } from '../sources/categories'
import type { ThemeMode } from '../lib/theme'
import type { TabKey } from './TabBar'

interface Props {
  categories: NewsCategory[]
  activeCategoryId: CategoryId
  onCategoryChange: (id: CategoryId) => void
  activeTab: TabKey
  settingsRouteName: string | null
  laterCount: number
  historyCount: number
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  onToggleTheme: () => void
  hasUpdate?: boolean
  presetSwitcher?: Omit<PresetSwitcherProps, 'variant'>
  onNavigateHome: () => void
  onNavigateLater: () => void
  onNavigateHistory: () => void
  onNavigateSettings: () => void
  onNavigateAbout: () => void
  onBrandTap?: () => void
}

export const DesktopSidebar = memo(function DesktopSidebar({
  categories,
  activeCategoryId,
  onCategoryChange,
  activeTab,
  settingsRouteName,
  laterCount,
  historyCount,
  resolvedTheme,
  onToggleTheme,
  hasUpdate,
  presetSwitcher,
  onNavigateHome,
  onNavigateLater,
  onNavigateHistory,
  onNavigateSettings,
  onNavigateAbout,
  onBrandTap,
}: Props) {
  const isHomeActive = activeTab === 'today' && !settingsRouteName
  const isLaterActive = settingsRouteName === 'later'
  const isHistoryActive = settingsRouteName === 'history'
  const isAboutBranch =
    settingsRouteName === 'about' ||
    settingsRouteName === 'changelog' ||
    settingsRouteName === 'licenses'
  const isSettingsActive =
    activeTab === 'me' ||
    (Boolean(settingsRouteName) &&
      settingsRouteName !== 'later' &&
      settingsRouteName !== 'history' &&
      !isAboutBranch)
  const isAboutActive = isAboutBranch

  return (
    <aside
      aria-label="桌面导航"
      className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-haze bg-ink select-none h-full overflow-hidden"
    >
      {/* 顶部品牌与题头 */}
      <div className="p-5 pb-3">
        <div className="flex items-center gap-3">
          <BrandLogo
            resolvedTheme={resolvedTheme}
            size={48}
            className="h-12 w-12 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {onBrandTap ? (
                <button
                  type="button"
                  onClick={onBrandTap}
                  className="font-display text-[21px] font-medium tracking-wide text-paper"
                >
                  有所闻
                </button>
              ) : (
                <span className="font-display text-[21px] font-medium tracking-wide text-paper">
                  有所闻
                </span>
              )}
              <span className="font-mono text-[9px] tracking-[0.14em] text-cinnabar-soft font-semibold">
                NEWSNOOK
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] tracking-[0.12em] text-paper-faint">
              {chineseDate()} · 案头静读
            </p>
          </div>
        </div>
      </div>

      {/* 中间主导航与分类列表 */}
      <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-3 py-2 space-y-5">
        {/* 核心主视图 */}
        <section>
          <div className="px-2 pb-1.5 font-mono text-[9.5px] tracking-[0.2em] text-paper-faint">
            阅读概览
          </div>
          <ul className="space-y-0.5">
            <li>
              <button
                type="button"
                onClick={onNavigateHome}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                  isHomeActive
                    ? 'bg-ink-raised text-paper font-medium shadow-xs border border-haze'
                    : 'text-paper-muted hover:bg-ink-raised/50 hover:text-paper'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Newspaper
                    size={16}
                    strokeWidth={isHomeActive ? 2 : 1.6}
                    className={isHomeActive ? 'text-cinnabar' : 'text-paper-faint group-hover:text-paper-muted'}
                  />
                  <span className="text-[13.5px] tracking-wide">速闻</span>
                </div>
                {isHomeActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-cinnabar" aria-hidden />
                )}
              </button>
            </li>

            {presetSwitcher && (
              <li>
                <PresetSwitcher variant="sidebar" {...presetSwitcher} />
              </li>
            )}

            <li>
              <button
                type="button"
                onClick={onNavigateLater}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                  isLaterActive
                    ? 'bg-ink-raised text-paper font-medium shadow-xs border border-haze'
                    : 'text-paper-muted hover:bg-ink-raised/50 hover:text-paper'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Bookmark
                    size={16}
                    strokeWidth={isLaterActive ? 2 : 1.6}
                    className={isLaterActive ? 'text-cinnabar' : 'text-paper-faint group-hover:text-paper-muted'}
                  />
                  <span className="text-[13.5px] tracking-wide">稍后读</span>
                </div>
                {laterCount > 0 && (
                  <span className="flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-cinnabar px-1.5 font-mono text-[9.5px] font-semibold text-white">
                    {laterCount > 99 ? '99+' : laterCount}
                  </span>
                )}
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={onNavigateHistory}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                  isHistoryActive
                    ? 'bg-ink-raised text-paper font-medium shadow-xs border border-haze'
                    : 'text-paper-muted hover:bg-ink-raised/50 hover:text-paper'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <History
                    size={16}
                    strokeWidth={isHistoryActive ? 2 : 1.6}
                    className={isHistoryActive ? 'text-cinnabar' : 'text-paper-faint group-hover:text-paper-muted'}
                  />
                  <span className="text-[13.5px] tracking-wide">最近阅读</span>
                </div>
                {historyCount > 0 && (
                  <span className="font-mono text-[10px] text-paper-faint">
                    {historyCount} 篇
                  </span>
                )}
              </button>
            </li>

            <li>
              <button
                type="button"
                onClick={onNavigateSettings}
                className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                  isSettingsActive
                    ? 'bg-ink-raised text-paper font-medium shadow-xs border border-haze'
                    : 'text-paper-muted hover:bg-ink-raised/50 hover:text-paper'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Settings
                    size={16}
                    strokeWidth={isSettingsActive ? 2 : 1.6}
                    className={isSettingsActive ? 'text-cinnabar' : 'text-paper-faint group-hover:text-paper-muted'}
                  />
                  <span className="text-[13.5px] tracking-wide">偏好与设置</span>
                </div>
                {hasUpdate && (
                  <span className="flex h-4 items-center justify-center rounded-full bg-cinnabar px-1.5 font-mono text-[9px] font-semibold text-white shadow-xs">
                    NEW
                  </span>
                )}
              </button>
            </li>
          </ul>
        </section>

        {/* 频道分类专区 */}
        <section>
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="font-mono text-[9.5px] tracking-[0.2em] text-paper-faint">
              频道分类
            </span>
            <span className="font-mono text-[9px] text-paper-faint">
              {categories.length} 个
            </span>
          </div>

          <div className="space-y-0.5">
            {categories.map((category) => {
              const isCategoryActive = isHomeActive && category.id === activeCategoryId
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onCategoryChange(category.id)}
                  className={`group relative flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all duration-200 ${
                    isCategoryActive
                      ? 'bg-ink-raised text-paper font-medium shadow-xs border border-haze/90'
                      : 'text-paper-muted/90 hover:bg-ink-raised/40 hover:text-paper'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-200 ${
                        isCategoryActive
                          ? 'bg-cinnabar shadow-[0_0_6px_rgba(196,92,74,0.4)]'
                          : 'bg-transparent group-hover:bg-paper-faint/40'
                      }`}
                    />
                    <span className="truncate font-display text-[14.5px] tracking-wide">
                      {category.label || category.short}
                    </span>
                  </div>
                  {category.caption && (
                    <span className="truncate max-w-[80px] font-mono text-[9.5px] text-paper-faint text-right">
                      {category.short}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
      </div>

      {/* 底部实用工具栏 */}
      <div className="shrink-0 border-t border-haze/60 p-3">
        <div className="flex items-center justify-between gap-1">
          {/* 主题切换按钮 */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={`当前主题：${resolvedTheme === 'dark' ? '夜读冷墨' : '昼读宣纸'}，点击切换`}
            className="group flex flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-ink-raised text-paper-muted hover:text-paper"
          >
            {resolvedTheme === 'dark' ? (
              <Moon size={15} strokeWidth={1.7} className="text-cinnabar-soft" />
            ) : (
              <Sun size={15} strokeWidth={1.7} className="text-cinnabar-soft" />
            )}
            <span className="font-mono text-[11px] tracking-wide">
              {resolvedTheme === 'dark' ? '夜读·墨' : '昼读·纸'}
            </span>
          </button>

          {/* 关于有所闻 */}
          <button
            type="button"
            onClick={onNavigateAbout}
            aria-label="关于有所闻"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
              isAboutActive
                ? 'bg-ink-raised text-cinnabar border border-haze'
                : 'text-paper-faint hover:bg-ink-raised hover:text-paper'
            }`}
          >
            <Info size={15} strokeWidth={1.7} />
            {hasUpdate && (
              <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-cinnabar ring-2 ring-ink shadow-xs" />
            )}
          </button>
        </div>
      </div>
    </aside>
  )
})
