import { memo, useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  BarChart3,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  FlaskConical,
  Globe,
  Layers3,
  Grid2X2,
  LayoutTemplate,
  Newspaper,
  Plus,
  Settings,
  Settings2,
  Trophy,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { useHardwareBackLayer } from '../hooks/useHardwareBackLayer'
import { CmsHelpDialog } from './CmsHelpDialog'
import { CmsGridCard } from './CmsGridCard'

export interface PresetSwitcherItem {
  id: string
  name: string
  description?: string
  /** 内置场景包 */
  builtin?: boolean
  active: boolean
}

export interface SiteSwitcherItem {
  id: string
  name: string
  description?: string
  active: boolean
}

export interface PresetSwitcherProps {
  activeName: string
  items: PresetSwitcherItem[]
  onSelect: (id: string) => void
  onManage: () => void
  onOpenSettings?: () => void
  /** 独立站点工作区；与 preset 完全分离，选择时不得调用 onSelect。 */
  siteItems?: SiteSwitcherItem[]
  onSelectSite?: (id: string) => void
  /** 在 CMS 标签中浏览所有已适配站点（不改变新闻预设）。 */
  onSites?: () => void
  /** 进入自定义源管理以添加受支持的 CMS 站点 */
  onAddCms?: () => void
  cmsSites?: {
    id: string
    name: string
    description?: string
    framework?: string
    url?: string
  }[]
  onSelectCms?: (id: string) => void
  /** CMS 站点页为独立阅读空间，打开切换器时优先定位到该类型。 */
  cmsActive?: boolean
  activeCmsId?: string | null
  variant?: 'pill' | 'card' | 'tabbar' | 'sidebar'
}

/**
 * 场景预设快捷切换：
 * - variant='tabbar': 移动端底栏中央动作入口，轻微抬升但不成为独立页面
 * - variant='sidebar': PC 侧栏中的普通导航动作，与速闻/稍后读同层级
 * - variant='pill': 紧凑胶囊，保留给站点工作区等非首页场景
 * - variant='card': 保留给需要突出展示当前预设的桌面场景
 * - 弹窗在移动端为底部抽屉，在平板/PC 端自适应为居中精美浮窗
 */
export function PresetSwitcher({
  activeName,
  items,
  onSelect,
  onManage,
  onOpenSettings,
  siteItems = [],
  onSelectSite,
  onSites,
  onAddCms,
  cmsSites = [],
  onSelectCms,
  cmsActive = false,
  activeCmsId = null,
  variant = 'pill',
}: PresetSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [presetTab, setPresetTab] = useState<'builtin' | 'custom' | 'cms'>('builtin')
  const titleId = useId()

  useHardwareBackLayer(open, () => {
    setOpen(false)
    return true
  })

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const builtins = useMemo(() => items.filter((item) => item.builtin), [items])
  const mine = useMemo(() => items.filter((item) => !item.builtin), [items])
  const showSiteSection = siteItems.length > 0

  const openSwitcher = () => {
    setPresetTab(cmsActive ? 'cms' : mine.some((item) => item.active) ? 'custom' : 'builtin')
    setOpen(true)
  }

  // 不用 backdrop-blur：全屏毛玻璃在 Android WebView 上会强制栅格化整页信息流，
  // 打开时常卡数百毫秒～1s+。半透明遮罩 + 轻位移入场即可，兼容 Chrome 69。
  const sheet =
    open &&
    createPortal(
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center md:items-center p-0 md:p-6"
        role="presentation"
      >
        <button
          type="button"
          aria-label="关闭"
          className="absolute inset-0 bg-black/55"
          onClick={() => setOpen(false)}
        />

        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="preset-switcher-sheet relative z-10 flex max-h-[min(88vh,680px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl md:rounded-2xl border border-haze/90 bg-ink-raised shadow-lg"
          style={{
            paddingBottom: 'calc(var(--sab, 0px) + 14px)',
          }}
        >
          <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-haze" />
          </div>

          <div className="page-x flex shrink-0 items-center justify-between gap-3 pt-3 pb-3 border-b border-haze/50">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar">
                <LayoutTemplate size={16} />
              </div>
              <div className="min-w-0">
                <h2 id={titleId} className="font-display text-[18px] font-semibold leading-none text-paper">
                  切换布局
                </h2>
                <p className="mt-1 truncate text-[11px] text-paper-faint">
                  当前：<span className="font-medium text-cinnabar">{activeName}</span>
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {presetTab === 'cms' && (
                <button
                  type="button"
                  aria-label="查看 CMS 站点说明"
                  title="CMS 站点使用说明与支持类型"
                  onClick={() => setHelpOpen(true)}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-haze/90 bg-ink text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-cinnabar"
                >
                  <CircleAlert size={15} strokeWidth={1.8} className="text-cinnabar" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onManage()
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-haze/90 bg-ink px-3 py-1.5 font-mono text-[11px] font-medium text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-cinnabar"
              >
                <Settings2 size={13} strokeWidth={1.7} />
                管理预设
              </button>
              {onOpenSettings ? (
                <button
                  type="button"
                  aria-label="设置"
                  title="设置"
                  onClick={() => {
                    setOpen(false)
                    onOpenSettings()
                  }}
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-haze/90 bg-ink text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-cinnabar"
                >
                  <Settings size={16} strokeWidth={1.7} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {/* 上半区：布局预设。内置与自定义只在这里切换，社区不参与 preset 状态。 */}
            <div className="shrink-0 px-3.5 pt-2.5 sm:px-5">
              <div
                role="tablist"
                aria-label="布局类型"
                className="grid grid-cols-3 rounded-xl border border-haze/80 bg-ink p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={presetTab === 'builtin'}
                  onClick={() => setPresetTab('builtin')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all ${
                    presetTab === 'builtin'
                      ? 'bg-ink-raised text-paper shadow-xs'
                      : 'text-paper-faint hover:text-paper-muted'
                  }`}
                >
                  <Grid2X2 size={14} strokeWidth={1.8} />
                  内置预设
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={presetTab === 'custom'}
                  onClick={() => setPresetTab('custom')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all ${
                    presetTab === 'custom'
                      ? 'bg-cinnabar text-white shadow-xs'
                      : 'text-paper-faint hover:text-paper-muted'
                  }`}
                >
                  <UserRound size={14} strokeWidth={1.8} />
                  自定义
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={presetTab === 'cms'}
                  onClick={() => setPresetTab('cms')}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-medium transition-all ${presetTab === 'cms' ? 'bg-ink-raised text-paper shadow-xs' : 'text-paper-faint hover:text-paper-muted'}`}
                >
                  <Layers3 size={14} strokeWidth={1.8} />
                  CMS 站点
                </button>
              </div>
            </div>

            <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-2.5 sm:px-5 sm:py-3">
              {presetTab === 'builtin' ? (
                builtins.length > 0 ? (
                  <ul className="grid grid-cols-2 gap-1.5 sm:gap-2">
                    {builtins.map((item) => (
                      <PresetGridCard
                        key={item.id}
                        item={item}
                        onPick={() => {
                          if (!item.active) onSelect(item.id)
                          setOpen(false)
                        }}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="rounded-xl border border-haze/80 bg-ink/45 px-4 py-6 text-center text-[12px] text-paper-faint">
                    暂无可用内置预设
                  </div>
                )
              ) : presetTab === 'cms' ? (
                cmsSites.length > 0 && onSelectCms ? (
                  <div className="space-y-2.5">
                    <ul className="grid grid-cols-2 gap-1.5 sm:gap-2">
                      {cmsSites.map((site) => (
                        <CmsGridCard
                          key={site.id}
                          site={site}
                          active={Boolean(cmsActive && activeCmsId === site.id)}
                          onPick={() => {
                            setOpen(false)
                            onSelectCms(site.id)
                          }}
                        />
                      ))}
                    </ul>
                      <div className="flex items-center gap-2 pt-0.5">
                        {onSites && cmsSites.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false)
                              onSites()
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-haze/90 bg-ink/30 px-3 py-2 text-[11.5px] font-medium text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-paper active:scale-[0.99]"
                          >
                            <Layers3 size={13} strokeWidth={1.8} />
                            全部站点
                          </button>
                        )}
                        {onAddCms && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false)
                              onAddCms()
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-haze/90 bg-ink/30 px-3 py-2 text-[11.5px] font-medium text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-paper active:scale-[0.99]"
                          >
                            <Plus size={13} strokeWidth={2} />
                            添加更多 CMS 站点
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setHelpOpen(true)}
                          aria-label="查看 CMS 站点说明"
                          title="CMS 站点用途与支持类型"
                          className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-haze/90 bg-ink/30 text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-cinnabar active:scale-95"
                        >
                          <CircleAlert size={14} strokeWidth={1.8} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <CmsPresetEmptyState
                      onAdd={() => {
                        setOpen(false)
                        onAddCms?.()
                      }}
                      onOpenHelp={() => setHelpOpen(true)}
                    />
                  )
              ) : mine.length > 0 ? (
                <ul className="space-y-2">
                  {mine.map((item) => (
                    <PresetPickRow
                      key={item.id}
                      item={item}
                      onPick={() => {
                        if (!item.active) onSelect(item.id)
                        setOpen(false)
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <CustomPresetEmptyState
                  onCreate={() => {
                    setOpen(false)
                    onManage()
                  }}
                />
              )}
            </div>

            {/* 下半区：独立社区入口。Web 无可用站点时整段隐藏，避免展示不可用入口。 */}
            {showSiteSection && <section className="shrink-0 border-t border-haze/65 bg-ink/35 px-3.5 pt-2.5 sm:px-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/12 text-cinnabar">
                    <UsersRound size={14} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-[13px] font-semibold leading-none text-paper">社区入口</span>
                    <span className="mt-1 block truncate text-[10px] text-paper-faint">进入独立社区工作区</span>
                  </span>
                </div>

              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                {siteItems.map((item) => (
                  <CommunityEntryCard
                    key={item.id}
                    item={item}
                    onPick={() => {
                      if (!item.active) onSelectSite?.(item.id)
                      setOpen(false)
                    }}
                  />
                ))}
              </div>
            </section>}
          </div>
        </div>
      </div>,
      document.body,
    )

  const helpModal = (
    <CmsHelpDialog
      open={helpOpen}
      onClose={() => setHelpOpen(false)}
      onAddCms={
        onAddCms
          ? () => {
              setOpen(false)
              onAddCms()
            }
          : undefined
      }
    />
  )

  if (variant === 'tabbar') {
    return (
      <>
        <button
          type="button"
          onClick={openSwitcher}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`布局，当前：${activeName}，点击切换`}
          title={`当前布局：${activeName}`}
          data-tour="preset-switcher"
          className="group relative -mt-2 flex h-[62px] w-full flex-col items-center justify-start gap-0.5 pt-0 text-paper-muted transition-colors duration-200 active:scale-[0.98]"
        >
          <span className="relative flex size-11 items-center justify-center rounded-full border border-haze/90 bg-ink-raised shadow-[0_5px_16px_rgba(0,0,0,0.16)] transition-all duration-200 group-hover:border-cinnabar/45 group-hover:text-cinnabar group-active:translate-y-0.5">
            <span className="absolute inset-1 rounded-full bg-cinnabar/8" aria-hidden />
            <LayoutTemplate
              size={19}
              strokeWidth={1.85}
              className="relative text-cinnabar transition-transform duration-200 group-hover:scale-105"
            />
          </span>
          <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-paper-muted transition-colors group-hover:text-cinnabar">
            布局
          </span>
        </button>
        {sheet}
        {helpModal}
      </>
    )
  }

  if (variant === 'sidebar') {
    return (
      <>
        <button
          type="button"
          onClick={openSwitcher}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`布局，当前：${activeName}，点击切换`}
          title={`当前布局：${activeName}`}
          className="group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-paper-muted transition-all duration-200 hover:bg-ink-raised/50 hover:text-paper"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <LayoutTemplate
              size={16}
              strokeWidth={1.7}
              className="shrink-0 text-cinnabar-soft transition-colors group-hover:text-cinnabar"
            />
            <span className="text-[13.5px] tracking-wide">布局</span>
          </span>
          <span className="max-w-[104px] truncate font-mono text-[9.5px] text-paper-faint transition-colors group-hover:text-paper-muted">
            {activeName}
          </span>
        </button>
        {sheet}
        {helpModal}
      </>
    )
  }

  if (variant === 'card') {
    return (
      <>
        <button
          type="button"
          onClick={openSwitcher}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`当前布局：${activeName}，点击切换`}
          className="group relative w-full rounded-xl border border-haze/90 bg-ink-raised/90 p-2.5 text-left transition-all duration-200 hover:border-cinnabar/60 hover:bg-ink-raised hover:shadow-sm active:scale-[0.99] focus-visible:outline-hidden"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.16em] text-paper-faint">
              <span className="size-1.5 rounded-full bg-cinnabar" />
              布局与场景
            </span>
            <span className="font-mono text-[9.5px] font-medium text-cinnabar group-hover:translate-x-0.5 transition-transform duration-200">
              切换 →
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cinnabar/15 text-cinnabar group-hover:bg-cinnabar group-hover:text-white transition-colors duration-200">
                <LayoutTemplate size={14} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="truncate font-display text-[14.5px] font-semibold text-paper group-hover:text-cinnabar transition-colors duration-200">
                  {activeName}
                </div>
              </div>
            </div>
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink border border-haze/80 text-paper-faint group-hover:border-cinnabar/50 group-hover:text-cinnabar transition-all">
              <ChevronDown size={12} strokeWidth={2} className="group-hover:translate-y-0.5 transition-transform" />
            </div>
          </div>
        </button>
        {sheet}
        {helpModal}
      </>
    )
  }

  // 默认 pill 胶囊形态（用于移动端顶栏）
  return (
    <>
      <button
        type="button"
        onClick={openSwitcher}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`当前布局：${activeName}，点击切换`}
        className="group flex max-w-[8.5rem] sm:max-w-[10.5rem] items-center gap-1.5 rounded-full border border-haze/90 bg-ink-raised/80 px-2.5 py-1 text-paper shadow-2xs transition-all duration-200 hover:border-cinnabar/40 hover:bg-ink-raised active:scale-95"
      >
        <LayoutTemplate
          size={11.5}
          strokeWidth={1.8}
          className="shrink-0 text-cinnabar group-hover:scale-105 transition-transform"
        />
        <span className="min-w-0 truncate font-mono text-[11px] font-medium tracking-wide text-paper group-hover:text-cinnabar transition-colors">
          {activeName}
        </span>
        <ChevronDown
          size={11}
          strokeWidth={1.8}
          className="shrink-0 text-paper-faint group-hover:text-cinnabar group-hover:translate-y-0.5 transition-all"
        />
      </button>
      {sheet}
      {helpModal}
    </>
  )
}

const PRESET_ICONS: Record<string, typeof LayoutTemplate> = {
  中国资讯: Newspaper,
  全球视野: Globe,
  财经商业: BarChart3,
  科技数码: Cpu,
  'AI 前沿': Bot,
  科学知识: FlaskConical,
  深度人文: BookOpen,
  文体生活: Trophy,
}

function PresetGlyph({ name, size = 14 }: { name: string; size?: number }) {
  const Icon = PRESET_ICONS[name] ?? LayoutTemplate
  return <Icon size={size} strokeWidth={1.75} />
}

function ZhihuLogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      data-community-logo="zhihu"
      data-community-logo-glyph="zhi"
      data-community-logo-body-size="24"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      preserveAspectRatio="xMidYMid meet"
      className="block shrink-0"
    >
      {/* 来自用户提供的知乎官方字标 SVG：只保留左侧“知”，移除右侧“乎”。 */}
      <svg
        x="2"
        y="2"
        width="24"
        height="24"
        viewBox="0 0 92 91"
        preserveAspectRatio="xMidYMid meet"
      >
        <path
          fill="#0F88EB"
          d="M53.29 80.035l7.32.002 2.41 8.24 13.128-8.24h15.477v-67.98H53.29v67.978zm7.79-60.598h22.756v53.22h-8.73l-8.718 5.473-1.587-5.46-3.72-.012v-53.22zM46.818 43.162h-16.35c.545-8.467.687-16.12.687-22.955h15.987s.615-7.05-2.68-6.97H16.807c1.09-4.1 2.46-8.332 4.1-12.708 0 0-7.523 0-10.085 6.74-1.06 2.78-4.128 13.48-9.592 24.41 1.84-.2 7.927-.37 11.512-6.94.66-1.84.785-2.08 1.605-4.54h9.02c0 3.28-.374 20.9-.526 22.95H6.51c-3.67 0-4.863 7.38-4.863 7.38H22.14C20.765 66.11 13.385 79.24 0 89.62c6.403 1.828 12.784-.29 15.937-3.094 0 0 7.182-6.53 11.12-21.64L43.92 85.18s2.473-8.402-.388-12.496c-2.37-2.788-8.768-10.33-11.496-13.064l-4.57 3.627c1.363-4.368 2.183-8.61 2.46-12.71H49.19s-.027-7.38-2.372-7.38z"
        />
      </svg>
    </svg>
  )
}

function LinuxDoLogo({ size = 28 }: { size?: number }) {
  const clipId = `linuxdo-logo-${useId().replace(/:/g, '')}`
  return (
    <svg
      data-community-logo="linuxdo"
      data-community-logo-body-size="24"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      preserveAspectRatio="xMidYMid meet"
      className="block shrink-0"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="14" cy="14" r="12" />
        </clipPath>
      </defs>
      {/* 与知乎使用完全相同的 24×24 主体外接框，只保留品牌本身的圆/方差异。 */}
      <circle cx="14" cy="14" r="12" fill="#F0F0F0" />
      <g clipPath={`url(#${clipId})`}>
        <rect x="2" y="2" width="24" height="7.2" fill="#1C1C1E" />
        <rect x="2" y="9.2" width="24" height="9.6" fill="#F0F0F0" />
        <rect x="2" y="18.8" width="24" height="7.2" fill="#FFB003" />
      </g>
    </svg>
  )
}

function CommunityGlyph({ id, size = 28 }: { id: string; size?: number }) {
  if (id === 'zhihu') return <ZhihuLogo size={size} />
  if (id === 'linuxdo') return <LinuxDoLogo size={size} />
  return <Globe size={Math.round(size * 0.55)} strokeWidth={1.75} />
}

function CustomPresetEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-2xl border border-haze/80 bg-ink/45 px-5 py-5 text-center">
      <div className="relative flex size-14 items-center justify-center rounded-2xl border border-haze/80 bg-ink-raised text-paper-muted shadow-xs">
        <LayoutTemplate size={24} strokeWidth={1.5} />
        <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-ink-raised bg-cinnabar text-white">
          <Plus size={13} strokeWidth={2.2} />
        </span>
      </div>
      <h3 className="mt-3 font-display text-[15px] font-semibold text-paper">还没有自定义预设</h3>
      <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-paper-faint">
        按你的阅读偏好组合分类与信源，创建一套自己的首页布局。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cinnabar px-4 py-2 text-[11.5px] font-medium text-white shadow-xs transition-opacity hover:opacity-90"
      >
        <Plus size={13} strokeWidth={2} />
        新建预设
      </button>
    </div>
  )
}

const CommunityEntryCard = memo(function CommunityEntryCard({
  item,
  onPick,
}: {
  item: SiteSwitcherItem
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={item.active}
      className={`group flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
        item.active
          ? 'border-cinnabar/60 bg-cinnabar/10'
          : 'border-haze/80 bg-ink-raised/70 hover:border-cinnabar/35 hover:bg-ink-raised'
      }`}
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center overflow-visible rounded-lg">
        <CommunityGlyph id={item.id} size={28} />
        {item.active && (
          <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-ink-raised bg-cinnabar text-white shadow-xs">
            <Check size={9} strokeWidth={2.6} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-display text-[12.5px] font-semibold ${item.active ? 'text-cinnabar' : 'text-paper'}`}>
          {item.name}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] text-paper-faint">
          {item.id === 'zhihu' ? '问答与观点' : item.id === 'linuxdo' ? '技术社区' : item.description ?? '社区工作区'}
        </span>
      </span>
    </button>
  )
})

const PresetGridCard = memo(function PresetGridCard({
  item,
  onPick,
}: {
  item: PresetSwitcherItem
  onPick: () => void
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-pressed={item.active}
        className={`group relative flex min-h-[78px] w-full flex-col overflow-hidden rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar/45 ${
          item.active
            ? 'border-cinnabar/75 bg-cinnabar/12 shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'border-haze/80 bg-ink/55 hover:-translate-y-px hover:border-cinnabar/40 hover:bg-ink hover:shadow-sm active:translate-y-0'
        }`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${
              item.active
                ? 'border-cinnabar bg-cinnabar text-white shadow-xs'
                : 'border-haze bg-ink-raised text-paper-muted group-hover:border-cinnabar/35 group-hover:text-cinnabar'
            }`}
          >
            <PresetGlyph name={item.name} size={14} />
          </span>

          <span
            className={`min-w-0 flex-1 truncate pb-[2px] font-display text-[13.5px] font-semibold leading-[1.4] transition-colors ${
              item.active ? 'text-cinnabar' : 'text-paper group-hover:text-cinnabar'
            }`}
          >
            {item.name}
          </span>

          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold leading-none tracking-[0.06em] transition-colors ${
              item.active
                ? 'bg-cinnabar/15 text-cinnabar'
                : 'border border-haze/80 bg-ink-raised/70 text-paper-faint group-hover:border-cinnabar/30 group-hover:text-cinnabar'
            }`}
          >
            {item.active ? (
              <span className="inline-flex items-center gap-0.5"><Check size={9} strokeWidth={2.4} />当前</span>
            ) : '选用'}
          </span>
        </span>

        {item.description && (
          <span className="mt-1.5 block line-clamp-2 pl-9 text-[10px] leading-[1.35] text-paper-faint transition-colors group-hover:text-paper-muted">
            {item.description}
          </span>
        )}

        {item.active && (
          <span className="pointer-events-none absolute inset-x-2.5 bottom-0 h-px bg-gradient-to-r from-transparent via-cinnabar/45 to-transparent" aria-hidden />
        )}
      </button>
    </li>
  )
})

const PresetPickRow = memo(function PresetPickRow({
  item,
  onPick,
}: {
  item: PresetSwitcherItem
  onPick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`group relative flex w-full items-center gap-3.5 rounded-xl border p-3 text-left transition-colors ${
          item.active
            ? 'border-cinnabar/60 bg-cinnabar/12'
            : 'border-haze/80 bg-ink/50 hover:border-cinnabar/40 hover:bg-ink-raised'
        }`}
      >
        <div
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
            item.active
              ? 'bg-cinnabar text-white'
              : 'bg-ink-raised border border-haze text-paper-muted group-hover:border-cinnabar/40 group-hover:text-cinnabar'
          }`}
        >
          <UserRound size={15} strokeWidth={1.7} />
        </div>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className={`truncate font-display text-[15px] font-semibold ${
                item.active ? 'text-cinnabar' : 'text-paper group-hover:text-paper'
              }`}
            >
              {item.name}
            </span>
            {item.active && (
              <span className="inline-flex items-center rounded-full bg-cinnabar/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-cinnabar">
                当前生效
              </span>
            )}
          </span>
          {item.description && (
            <span className="mt-0.5 block truncate text-[12px] text-paper-faint group-hover:text-paper-muted transition-colors">
              {item.description}
            </span>
          )}
        </span>

        {!item.active && (
          <span className="shrink-0 rounded-full border border-haze/80 bg-ink px-2.5 py-1 font-mono text-[10.5px] font-medium text-paper-faint group-hover:border-cinnabar/40 group-hover:text-cinnabar transition-colors">
            选用
          </span>
        )}
      </button>
    </li>
  )
})

function CmsPresetEmptyState({
  onAdd,
  onOpenHelp,
}: {
  onAdd: () => void
  onOpenHelp?: () => void
}) {
  return (
    <div className="flex min-h-[190px] flex-col items-center justify-center rounded-2xl border border-haze/80 bg-ink/45 px-5 py-5 text-center">
      <div className="relative flex size-14 items-center justify-center rounded-2xl border border-haze/80 bg-ink-raised text-paper-muted shadow-xs">
        <Layers3 size={24} strokeWidth={1.5} />
        <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-ink-raised bg-cinnabar text-white">
          <Plus size={13} strokeWidth={2.2} />
        </span>
      </div>
      <h3 className="mt-3 font-display text-[15px] font-semibold text-paper">让熟悉的网站成为你的阅读空间</h3>
      <p className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-paper-faint">
        支持识别已适配的 CMS 站点。添加站点后，可在这里集中浏览。
      </p>
      <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-full bg-cinnabar px-4 py-2 text-[11.5px] font-medium text-white shadow-xs transition-opacity hover:opacity-90 active:scale-95"
        >
          <Plus size={13} strokeWidth={2} />
          添加站点
        </button>
        {onOpenHelp && (
          <button
            type="button"
            onClick={onOpenHelp}
            aria-label="查看 CMS 站点说明"
            className="inline-flex items-center gap-1.5 rounded-full border border-haze/90 bg-ink px-3.5 py-2 text-[11.5px] font-medium text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-cinnabar active:scale-95"
          >
            <CircleAlert size={13} strokeWidth={1.8} className="text-cinnabar" />
            了解用途与支持类型
          </button>
        )}
      </div>
    </div>
  )
}
