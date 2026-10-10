import { memo } from 'react'
import { BookOpen, Check, Film, Layers3, UsersRound } from 'lucide-react'
import {
  formatSiteBrandName,
  getSiteCleanDomain,
  getSiteFrameworkInfo,
} from '../features/siteCatalog/uiUtils'

export interface CmsGridCardItem {
  id: string
  name: string
  description?: string
  framework?: string
  url?: string
}

export interface CmsGridCardProps {
  site: CmsGridCardItem
  active: boolean
  onPick: () => void
}

/**
 * 统一 CMS 站点网格卡片：
 * 用于外部布局切换（PresetSwitcher）与内部站点切换抽屉（SiteScreen），
 * 保持完全一致的 2 列网格视觉风格、微图标、品牌标题、分类角标与高亮反馈。
 */
export const CmsGridCard = memo(function CmsGridCard({
  site,
  active,
  onPick,
}: CmsGridCardProps) {
  const fw = getSiteFrameworkInfo(site.framework)
  const domain = site.description || getSiteCleanDomain(site.url)
  const brand = formatSiteBrandName({ name: site.name, url: site.url || site.description })

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? 'page' : undefined}
        aria-pressed={active}
        className={`group relative flex min-h-[78px] w-full flex-col overflow-hidden rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cinnabar/45 ${
          active
            ? 'border-cinnabar/75 bg-cinnabar/12 shadow-[0_4px_12px_rgba(0,0,0,0.08)]'
            : 'border-haze/80 bg-ink/55 hover:-translate-y-px hover:border-cinnabar/40 hover:bg-ink hover:shadow-sm active:translate-y-0'
        }`}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-200 ${
              active
                ? 'border-cinnabar bg-cinnabar text-white shadow-xs'
                : 'border-haze bg-ink-raised text-paper-muted group-hover:border-cinnabar/35 group-hover:text-cinnabar'
            }`}
          >
            {fw.isVideo ? (
              <Film size={14} strokeWidth={1.75} />
            ) : site.framework === 'wordpress' || site.framework === 'typecho' ? (
              <BookOpen size={14} strokeWidth={1.75} />
            ) : site.framework === 'discuz' ? (
              <UsersRound size={14} strokeWidth={1.75} />
            ) : (
              <Layers3 size={14} strokeWidth={1.75} />
            )}
          </span>

          <span
            className={`min-w-0 flex-1 truncate font-display text-[13.5px] font-semibold leading-none transition-colors ${
              active ? 'text-cinnabar' : 'text-paper group-hover:text-cinnabar'
            }`}
          >
            {brand}
          </span>

          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[8.5px] font-semibold leading-none tracking-[0.06em] transition-colors ${
              active
                ? 'bg-cinnabar/15 text-cinnabar'
                : 'border border-haze/80 bg-ink-raised/70 text-paper-faint group-hover:border-cinnabar/30 group-hover:text-cinnabar'
            }`}
          >
            {active ? (
              <span className="inline-flex items-center gap-0.5">
                <Check size={9} strokeWidth={2.4} />当前
              </span>
            ) : (
              '选用'
            )}
          </span>
        </span>

        <span className="mt-1.5 block line-clamp-1 pl-9 text-[10px] leading-[1.35] text-paper-faint transition-colors group-hover:text-paper-muted">
          {fw.categoryBadge !== '目录' ? `${fw.categoryBadge} · ` : ''}{domain || '独立空间'}
        </span>

        {active && (
          <span
            className="pointer-events-none absolute inset-x-2.5 bottom-0 h-px bg-gradient-to-r from-transparent via-cinnabar/45 to-transparent"
            aria-hidden
          />
        )}
      </button>
    </li>
  )
})
