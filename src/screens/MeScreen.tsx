import { useEffect, useRef } from 'react'
import {
  ArrowLeft,
  Bookmark,
  ChevronRight,
  CloudUpload,
  Contrast,
  Database,
  Globe,
  History,
  Info,
  Languages,
  LayoutGrid,
  LayoutTemplate,
  Rss,
  Search,
  Type,
} from 'lucide-react'

import { useReducedMotion } from '../hooks/useReducedMotion'
import { revealItems } from '../lib/motion'
import type { Article } from '../lib/types'

interface Props {
  later: Article[]
  history: Article[]
  readCount: number
  customSourcesSummary?: string
  categoriesSummary?: string
  presetsSummary: string
  typographySummary: string
  appearanceSummary: string
  translationSummary: string
  proxySummary: string
  storageSummary: string
  accountSummary: string
  hasUpdate?: boolean
  availableVersion?: string
  onOpenLater: () => void
  onOpenHistory: () => void
  onOpenLocalSearch: () => void
  onOpenCustomSources: () => void
  onOpenCategories: () => void
  onOpenPresets: () => void
  onOpenTypographySettings: () => void
  onOpenAppearanceSettings: () => void
  onOpenTranslationSettings: () => void
  onOpenProxySettings: () => void
  onOpenStorageSettings: () => void
  onOpenAccountSync: () => void
  onOpenAbout: () => void
  /** 从阅读中区进入时：显示返回并回到原文 */
  onBackToReading?: () => void
}

interface SettingsRowProps {
  icon: typeof Type
  title: string
  caption: string
  badge?: number | string | null
  onClick: () => void
  /** 功能引导锚点，见 features/productTour/steps.ts */
  dataTour?: string
}

function SettingsRow({ icon: Icon, title, caption, badge, onClick, dataTour }: SettingsRowProps) {
  return (
    <li className="bg-ink" data-tour={dataTour}>
      <button
        type="button"
        onClick={onClick}
        className="page-x flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-ink-raised/30 active:bg-ink-raised/50"
      >
        <Icon size={17} strokeWidth={1.5} className="shrink-0 text-paper-muted" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[14px] font-medium text-paper">{title}</span>
            {badge !== undefined && badge !== null && badge !== 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-cinnabar px-1.5 font-mono text-[10px] font-semibold leading-none text-white shadow-sm">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-paper-faint">
            {caption}
          </span>
        </span>
        <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-paper-faint" />
      </button>
    </li>
  )
}

export function MeScreen({
  later,
  history,
  readCount,
  customSourcesSummary,
  categoriesSummary,
  presetsSummary,
  typographySummary,
  appearanceSummary,
  translationSummary,
  proxySummary,
  storageSummary,
  accountSummary,
  hasUpdate,
  availableVersion,
  onOpenLater,
  onOpenHistory,
  onOpenLocalSearch,
  onOpenCustomSources,
  onOpenCategories,
  onOpenPresets,
  onOpenTypographySettings,
  onOpenAppearanceSettings,
  onOpenTranslationSettings,
  onOpenProxySettings,
  onOpenStorageSettings,
  onOpenAccountSync,
  onOpenAbout,
  onBackToReading,
}: Props) {
  const reduced = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    revealItems(rootRef.current, reduced)
  }, [history.length, later.length, reduced])

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 pt-2 pb-3">
        <div className="page-x lg:px-8 max-w-4xl mx-auto w-full">
          <div className="flex items-start gap-2">
            {onBackToReading && (
              <button
                type="button"
                onClick={onBackToReading}
                aria-label="返回阅读"
                className="-ml-1.5 shrink-0 p-1.5 hover:text-paper"
              >
                <ArrowLeft size={19} strokeWidth={1.6} className="text-paper" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[26px] leading-none text-paper md:text-[30px]">我的</h1>
              <p className="mt-1.5 font-mono text-[10px] tracking-[0.16em] text-paper-faint">
                {onBackToReading
                  ? '返回可继续阅读 · 稍后读 ' + later.length + ' · 已读 ' + readCount
                  : `稍后读 ${later.length} · 已读 ${readCount}`}
              </p>
            </div>
          </div>
          <div className="mt-3 h-px w-full bg-haze" />
        </div>
      </header>

      <div ref={rootRef} className="scroll-hidden min-h-0 flex-1 overflow-y-auto pb-8">
        <div className="max-w-4xl mx-auto w-full">
          <div className="page-x lg:px-8 flex items-center gap-3 pt-6 pb-2">
            <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">阅读与收藏</span>
            <span className="h-px flex-1 bg-haze" aria-hidden />
          </div>

        <ul
          data-tour="me-reading"
          className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-haze"
        >
          <SettingsRow
            icon={Bookmark}
            title="稍后读"
            caption={later.length ? `${later.length} 篇待读` : '阅读器顶栏可收藏'}
            badge={later.length > 0 ? later.length : null}
            onClick={onOpenLater}
          />
          <SettingsRow
            icon={History}
            title="最近阅读"
            caption={history.length ? `${history.length} 篇` : '打开过的文章会出现在这里'}
            onClick={onOpenHistory}
          />
          <SettingsRow
            icon={Search}
            title="本地搜索"
            caption="在已缓存的列表、稍后读与历史里查找 · 不联网"
            onClick={onOpenLocalSearch}
          />
        </ul>

        <div className="page-x flex items-center gap-3 pt-8 pb-2">
          <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">偏好设置</span>
          <span className="h-px flex-1 bg-haze" aria-hidden />
        </div>

        <ul
          data-tour="me-settings"
          className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-haze"
        >
          <SettingsRow
            icon={Rss}
            title="自定义订阅与 OPML"
            caption={customSourcesSummary ?? 'RSS / Atom · OPML 导入导出'}
            onClick={onOpenCustomSources}
            dataTour="me-custom-sources"
          />
          <SettingsRow
            icon={LayoutGrid}
            title="分类与自动刷新"
            caption={categoriesSummary ?? '顺序、信源与切换刷新'}
            onClick={onOpenCategories}
          />
          <SettingsRow
            icon={LayoutTemplate}
            title="场景预设"
            caption={presetsSummary}
            onClick={onOpenPresets}
            dataTour="me-presets"
          />
          <SettingsRow
            icon={Type}
            title="阅读字体"
            caption={typographySummary}
            onClick={onOpenTypographySettings}
          />
          <SettingsRow
            icon={Contrast}
            title="外观"
            caption={appearanceSummary}
            onClick={onOpenAppearanceSettings}
          />
          <SettingsRow
            icon={Languages}
            title="翻译"
            caption={translationSummary}
            onClick={onOpenTranslationSettings}
            dataTour="me-translation"
          />
          <SettingsRow
            icon={Globe}
            title="网络与代理"
            caption={proxySummary}
            onClick={onOpenProxySettings}
          />
          <SettingsRow
            icon={Database}
            title="离线存储与备份"
            caption={storageSummary}
            onClick={onOpenStorageSettings}
          />
          <SettingsRow
            icon={CloudUpload}
            title="账户与同步"
            caption={accountSummary}
            onClick={onOpenAccountSync}
          />
        </ul>

        <div className="page-x flex items-center gap-3 pt-8 pb-2">
          <span className="font-mono text-[10px] tracking-[0.28em] text-paper-faint">关于与项目</span>
          <span className="h-px flex-1 bg-haze" aria-hidden />
        </div>

        <ul className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-haze">
          <SettingsRow
            icon={Info}
            title="关于有所闻"
            caption={
              hasUpdate && availableVersion
                ? `发现新版本 v${availableVersion} · 开源仓库与专栏文章`
                : `v${__APP_VERSION__} · 开源仓库与专栏文章`
            }
            badge={hasUpdate ? (availableVersion ? `v${availableVersion}` : 'NEW') : null}
            onClick={onOpenAbout}
          />
        </ul>

        <div data-reveal className="page-x lg:px-8 max-w-2xl pt-8">
          <p className="font-display text-[15px] text-paper">权利和免责</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-paper-faint">
            内容版权归原发布方。本应用只做本地阅读，不托管内容库；列表与正文由本机直连来源站点，稍后读与已读仅存本机。
          </p>
        </div>
        </div>
      </div>
    </section>
  )
}
