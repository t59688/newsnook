import { useEffect, useRef, type ReactNode } from 'react'
import {
  ArrowLeft,
  Bookmark,
  Bell,
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
  Store,
  ServerCog,
  Search,
  Type,
  Volume2,
  BookOpen,
} from 'lucide-react'

import { useReducedMotion } from '../hooks/useReducedMotion'
import { revealItems } from '../lib/motion'
import type { Article } from '../lib/types'

interface Props {
  later: Article[]
  historyCount: number
  readCount: number
  customSourcesSummary?: string
  categoriesSummary?: string
  presetsSummary: string
  typographySummary: string
  appearanceSummary: string
  translationSummary: string
  readAloudSummary: string
  aiSummary: string
  proxySummary: string
  storageSummary: string
  accountSummary: string
  hasUpdate?: boolean
  availableVersion?: string
  onOpenLater: () => void
  onOpenHistory: () => void
  onOpenLocalSearch: () => void
  onOpenCustomSources: () => void
  onOpenFeedStore: () => void
  onOpenCategories: () => void
  onOpenPresets: () => void
  onOpenSourceWatch: () => void
  watchUnreadCount?: number
  onOpenTypographySettings: () => void
  onOpenAppearanceSettings: () => void
  onOpenTranslationSettings: () => void
  onOpenWikiSettings: () => void
  onOpenReadAloudSettings: () => void
  onOpenAiSettings: () => void
  onOpenProxySettings: () => void
  onOpenStorageSettings: () => void
  onOpenAccountSync: () => void
  onOpenAbout: () => void
  /** 从阅读中区进入时：显示返回并回到原文 */
  onBackToReading?: () => void
}

interface EntryProps {
  icon: typeof Type
  title: string
  subtitle?: string
  badge?: string | number | null
  onClick: () => void
  dataTour?: string
}

function Entry({ icon: Icon, title, subtitle, badge, onClick, dataTour }: EntryProps) {
  return <li className="paper-settings-item" data-tour={dataTour}>
    <button type="button" className="paper-settings-row" onClick={onClick}>
      <span className="paper-settings-icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
      <span className="paper-settings-copy"><span className="paper-settings-name">{title}</span>
        {subtitle && <span className="paper-settings-subtitle">{subtitle}</span>}</span>
      {badge !== undefined && badge !== null && badge !== 0 && <span className="paper-settings-badge">{badge}</span>}
      <ChevronRight size={16} className="paper-settings-chevron" aria-hidden="true" />
    </button>
  </li>
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="paper-settings-group"><h2 className="paper-settings-group-title">{title}</h2>
    <ul className="paper-settings-panel">{children}</ul></section>
}

export function MeScreen({
  later,
  historyCount,
  readCount,
  customSourcesSummary,
  categoriesSummary,
  presetsSummary,
  typographySummary,
  appearanceSummary,
  translationSummary,
  readAloudSummary,
  aiSummary,
  proxySummary,
  storageSummary,
  accountSummary,
  hasUpdate,
  availableVersion,
  onOpenLater,
  onOpenHistory,
  onOpenLocalSearch,
  onOpenCustomSources,
  onOpenFeedStore,
  onOpenCategories,
  onOpenPresets,
  onOpenSourceWatch,
  watchUnreadCount = 0,
  onOpenTypographySettings,
  onOpenAppearanceSettings,
  onOpenTranslationSettings,
  onOpenWikiSettings,
  onOpenReadAloudSettings,
  onOpenAiSettings,
  onOpenProxySettings,
  onOpenStorageSettings,
  onOpenAccountSync,
  onOpenAbout,
  onBackToReading,
}: Props) {
  const reduced = useReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { revealItems(rootRef.current, reduced) }, [historyCount, later.length, reduced])
  return <section className="paper-settings-root flex min-h-0 flex-1 flex-col">
    <header className="paper-settings-header">
      <div className="paper-settings-container">
        <div className="paper-settings-brand">{onBackToReading && <button type="button" onClick={onBackToReading} aria-label="返回阅读" className="paper-settings-back"><ArrowLeft size={20}/></button>}<span className="paper-settings-brand-dot"/>有所闻</div>
        <h1>设置</h1><p className="paper-settings-reading-count">已读 {readCount} 篇</p>
      </div>
    </header>
    <div ref={rootRef} className="paper-settings-scroller scroll-hidden">
      <div className="paper-settings-container paper-settings-grid">
        <section className="paper-settings-group" data-tour="me-reading">
          <h2 className="paper-settings-group-title">阅读与收藏</h2>
          <div className="paper-settings-shortcuts">
            <button type="button" className="paper-settings-shortcut" onClick={onOpenLater}><span className="paper-settings-icon paper-settings-shortcut-icon"><Bookmark size={19}/></span><span><strong>稍后读</strong><small>{later.length ? `${later.length} 篇` : '暂无内容'}</small></span></button>
            <button type="button" className="paper-settings-shortcut" onClick={onOpenHistory}><span className="paper-settings-icon paper-settings-shortcut-icon"><History size={19}/></span><span><strong>最近阅读</strong><small>{historyCount ? `${historyCount} 篇` : '暂无记录'}</small></span></button>
          </div>
          <ul className="paper-settings-panel paper-settings-search-panel"><Entry icon={Search} title="本地搜索" onClick={onOpenLocalSearch}/></ul>
        </section>
        <Group title="订阅与内容">
          <Entry icon={Bell} title="关注动态" subtitle={watchUnreadCount ? `${watchUnreadCount} 篇新动态 · 跨预设提醒` : '跨预设更新提醒 · 按需监控'} badge={watchUnreadCount ? `${watchUnreadCount > 99 ? '99+' : watchUnreadCount} 未读` : null} onClick={onOpenSourceWatch}/>
          <Entry icon={Store} title="RSS 订阅商店" subtitle="发现和添加订阅" onClick={onOpenFeedStore} dataTour="me-feed-store"/>
          <Entry icon={Rss} title="自定义订阅与 OPML" subtitle={customSourcesSummary ?? 'RSS / Atom · OPML 导入导出'} onClick={onOpenCustomSources} dataTour="me-custom-sources"/>
          <Entry icon={LayoutGrid} title="分类与自动刷新" subtitle={categoriesSummary ?? '顺序、信源与刷新方式'} onClick={onOpenCategories}/>
          <Entry icon={LayoutTemplate} title="场景预设" subtitle={presetsSummary} onClick={onOpenPresets} dataTour="me-presets"/>
        </Group>
        <Group title="阅读体验">
          <Entry icon={Type} title="阅读字体" subtitle={typographySummary} onClick={onOpenTypographySettings}/>
          <Entry icon={Contrast} title="外观" subtitle={appearanceSummary} onClick={onOpenAppearanceSettings}/>
          <Entry icon={Languages} title="翻译" subtitle={translationSummary} onClick={onOpenTranslationSettings} dataTour="me-translation"/>
          <Entry icon={BookOpen} title="划词百科" subtitle="划词查询与百科源" onClick={onOpenWikiSettings}/>
          <Entry icon={Volume2} title="朗读" subtitle={readAloudSummary} onClick={onOpenReadAloudSettings}/>
        </Group>
        <Group title="应用与数据">
          <Entry icon={ServerCog} title="AI" subtitle={aiSummary} onClick={onOpenAiSettings}/>
          <Entry icon={Globe} title="网络与代理" subtitle={proxySummary} onClick={onOpenProxySettings}/>
          <Entry icon={Database} title="离线存储与备份" subtitle={storageSummary} onClick={onOpenStorageSettings}/>
          <Entry icon={CloudUpload} title="账户与同步" subtitle={accountSummary} onClick={onOpenAccountSync}/>
          <Entry icon={Info} title="关于有所闻" subtitle={hasUpdate && availableVersion ? `发现新版本 v${availableVersion}` : `v${__APP_VERSION__}`} badge={hasUpdate ? 'NEW' : null} onClick={onOpenAbout} dataTour="me-about"/>
        </Group>
        <footer className="paper-settings-footer">
          <p>有所闻 · NewsNook</p>
          <p>内容版权归原发布方。本应用只做本地阅读，不托管内容库；列表与正文由本机直连来源站点，稍后读与已读仅存本机。</p>
        </footer>
      </div>
    </div>
  </section>
}
