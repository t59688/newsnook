import { memo, useState } from 'react'
import { BookmarkCheck, Cloud } from 'lucide-react'

import { InkImage } from './InkImage'
import { useArticleCover } from '../hooks/useArticleCover'
import { EditorialCoverPlaceholder } from './EditorialCoverPlaceholder'
import { feedDisplayTitle } from '../lib/articleTitle'
import { cleanSummaryText } from '../lib/cleanSummary'
import type { Article } from '../lib/types'
import { articleRelativeTime } from '../lib/time'

interface RowProps {
  article: Article
  read: boolean
  saved: boolean
  /** 正文已进入持久预存窗口；与普通阅读缓存/稍后读状态分离 */
  prestored?: boolean
  translated?: { title: string; summary?: string }
  displayMode?: 'replace' | 'compare'
  onOpen: (article: Article) => void
  onSourceClick?: (sourceId: string) => void
  /** 邻页预览等场景跳过入场透明，避免横滑露白 */
  revealed?: boolean
  /** 布局变体：单列横排 (row) / 移动端双栏卡片 (compact-card) / 桌面网格卡片 (card) / 自适应 (auto) */
  variant?: 'row' | 'compact-card' | 'card' | 'auto'
}

export const ArticleRow = memo(function ArticleRow({
  article,
  read,
  saved,
  prestored = false,
  translated,
  displayMode = 'replace',
  onOpen,
  onSourceClick,
  revealed = false,
  variant = 'auto',
}: RowProps) {
  const [showOriginal, setShowOriginal] = useState(false)
  const showRow = variant === 'row' || variant === 'auto'
  const showCompactCard = variant === 'compact-card'
  const showCard = variant === 'card' || variant === 'auto'
  const hasTranslation = Boolean(translated?.title)
  const isTranslated = hasTranslation && !showOriginal
  const activeSummary = isTranslated ? (translated?.summary || article.summary) : article.summary
  const activeTitle = feedDisplayTitle(
    isTranslated ? (translated?.title || article.title) : article.title,
    activeSummary,
  )
  const originalDisplayTitle = feedDisplayTitle(article.title, article.summary)
  const displaySummary = cleanSummaryText(activeSummary, activeTitle)
  const { cover, onFailed } = useArticleCover(article)

  const renderTranslateBadge = () => {
    if (!hasTranslation) return null
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          setShowOriginal((prev) => !prev)
        }}
        title={isTranslated ? '点击查看原文' : '点击查看译文'}
        className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-mono font-medium transition-all cursor-pointer select-none active:scale-90 ${
          isTranslated
            ? 'text-cinnabar border border-cinnabar/30 bg-cinnabar/10 shadow-xs'
            : 'text-paper-muted border border-haze bg-paper/5 hover:bg-paper/10 hover:text-paper'
        }`}
      >
        {isTranslated ? '译' : '原'}
      </span>
    )
  }

  return (
    <li
      data-reveal={revealed ? undefined : true}
      data-read={read ? 'true' : 'false'}
      data-variant={variant}
      className={`editorial-article-item article-row-item relative transition-colors duration-300 ${
        variant === 'card'
          ? 'h-full bg-transparent'
          : variant === 'compact-card'
            ? 'bg-transparent'
            : read
              ? 'bg-ink/30'
              : 'bg-ink-raised/60 md:bg-transparent'
      }`}
    >
      {/* 移动端横排布局 (Mobile: < md) */}
      {showRow && (
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={`editorial-article-row group pressable-card relative flex w-full items-center gap-4 px-4 py-3.5 text-left sm:px-5 sm:py-4 ${
            variant === 'auto' ? 'md:hidden' : ''
          } ${
            read
              ? 'bg-transparent hover:bg-ink/50'
              : 'bg-gradient-to-b from-ink-raised/35 to-transparent hover:bg-ink-raised/80'
          }`}
        >
          <span className="min-w-0 flex-1">
            {/* 顶部信源与时间元数据 */}
            <span
              className={`editorial-article-meta flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] ${
                read ? 'text-paper-faint/75' : 'text-paper-faint'
              }`}
            >
              {!read && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-cinnabar/90 shrink-0 shadow-[0_0_5px_rgba(196,92,74,0.4)]"
                  aria-label="未读"
                />
              )}
              <span
                role={onSourceClick ? 'button' : undefined}
                tabIndex={onSourceClick ? 0 : undefined}
                onClick={
                  onSourceClick
                    ? (e) => {
                        e.stopPropagation()
                        onSourceClick(article.sourceId)
                      }
                    : undefined
                }
                className={`${
                  read ? 'text-paper-faint' : 'text-paper-muted font-[450]'
                } ${onSourceClick ? 'hover:text-cinnabar transition-colors cursor-pointer' : ''}`}
              >
                {article.sourceLabel}
              </span>
              <span aria-hidden className="text-paper-faint/45">·</span>
              <span className="tabular-nums">{articleRelativeTime(article)}</span>
              {saved && <BookmarkCheck size={11} strokeWidth={1.8} className="text-cinnabar ml-0.5" />}
              {prestored && (
                <Cloud
                  size={11}
                  strokeWidth={1.35}
                  className="ml-0.5 text-paper-faint/70"
                  aria-label="已预存，可离线阅读"
                />
              )}
              {renderTranslateBadge()}
            </span>

            {/* 文章标题：450~500 挺拔字重，典雅深墨色，消除暴力加粗 */}
            <span
              className={`editorial-article-title row-title mt-1.5 line-clamp-2 text-[16.5px] leading-[1.5] tracking-[-0.012em] transition-colors ${
                read
                  ? 'font-normal text-paper-muted/70'
                  : 'font-medium text-paper/93 group-hover:text-cinnabar'
              }`}
            >
              {activeTitle}
            </span>

            {/* 双语对照模式下的外文原标题 */}
            {isTranslated && displayMode === 'compare' && (
              <span className="mt-0.5 font-sans text-[12px] leading-snug text-paper-faint/85 line-clamp-1 italic">
                {originalDisplayTitle}
              </span>
            )}

            {/* 清洗后的正文摘要：灰度回填至 92%，消除黑度断层 */}
            {displaySummary && (
              <span
                className={`editorial-article-summary mt-2 line-clamp-2 text-[13px] leading-[1.62] ${
                  read ? 'text-paper-faint/75' : 'text-paper-muted/92'
                }`}
              >
                {displaySummary}
              </span>
            )}
          </span>

          {/* 缩略图容器：升级为 4:3 比例杂志画幅，配合微倒角与轻柔阴影 */}
          {cover && (
            <span className="editorial-article-cover relative h-16 w-[5.35rem] shrink-0 overflow-hidden rounded-[10px] border border-haze/60 bg-ink-deep/25 shadow-[0_2px_8px_rgba(0,0,0,0.04)] sm:h-[4.5rem] sm:w-[6rem]">
              <InkImage
                src={cover}
                onFailed={onFailed}
                collapseOnError
                className={`h-full w-full object-cover transition-all duration-300 ${
                  read
                    ? 'opacity-[0.62] grayscale-[0.25] saturate-[0.8] group-active:opacity-85'
                    : 'opacity-[0.98] group-active:opacity-100'
                }`}
              />
              {article.contentType === 'video' && (
                <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 font-mono text-[8.5px] leading-none text-white/90 backdrop-blur-sm">
                  视频
                </span>
              )}
            </span>
          )}
        </button>
      )}

      {/* 移动端双栏杂志卡片：首页主信息流使用；窄屏由外层网格退回单列 */}
      {showCompactCard && (
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={`group pressable-card chamfer-surface relative flex w-full flex-col overflow-hidden rounded-[13px] border text-left transition-[transform,background-color,border-color,box-shadow] duration-150 ${
            read
              ? 'border-haze/65 bg-ink-raised/30 active:bg-ink-raised/55'
              : 'border-haze/85 bg-ink-raised/65 active:border-cinnabar/25 active:bg-ink-raised/90'
          }`}
        >
          {cover ? (
            <span className={`relative block w-full overflow-hidden border-b border-haze/55 bg-ink-deep/30 ${article.contentType === 'video' ? 'aspect-video' : 'aspect-[4/3]'}`}>
              <InkImage
                src={cover}
                onFailed={onFailed}
                collapseOnError
                className={`h-full w-full object-cover transition-[transform,filter,opacity] duration-300 ${
                  read
                    ? 'opacity-[0.76] saturate-[0.72] contrast-[0.96]'
                    : 'opacity-[0.98] group-active:opacity-90'
                }`}
              />
              {!read && (
                <span
                  className="absolute left-2 top-2 h-1.5 w-1.5 rounded-full bg-cinnabar shadow-[0_0_0_2px_rgb(var(--tone-ink-rgb)/0.66)]"
                  aria-label="未读"
                />
              )}
              {article.contentType === 'video' && (
                <span className="absolute bottom-2 right-2 rounded-full border border-white/12 bg-black/55 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-white/85 backdrop-blur-sm">
                  视频
                </span>
              )}
            </span>
          ) : (
            <EditorialCoverPlaceholder
              article={article}
              read={read}
              className={`relative block w-full overflow-hidden border-b border-haze/55 ${article.contentType === 'video' ? 'aspect-video' : 'aspect-[4/3]'}`}
            />
          )}

          <span className="flex min-w-0 flex-1 flex-col p-2.5 sm:p-3">
            <span
              className={`row-title line-clamp-3 text-[15px] leading-[1.42] tracking-[0.005em] transition-colors min-[430px]:text-[15.5px] ${
                read ? 'font-normal text-paper-muted/78' : 'font-medium text-paper'
              }`}
            >
              {activeTitle}
            </span>

            {isTranslated && displayMode === 'compare' && (
              <span className="mt-1 line-clamp-1 font-sans text-[10.5px] leading-snug text-paper-faint/80 italic">
                {originalDisplayTitle}
              </span>
            )}

            {displaySummary && (
              <span
                className={`mt-1.5 line-clamp-2 text-[11.5px] leading-[1.55] min-[430px]:text-[12px] ${
                  read ? 'text-paper-faint/75' : 'text-paper-muted/92'
                }`}
              >
                {displaySummary}
              </span>
            )}

            <span className="mt-2.5 flex min-w-0 items-center gap-1 border-t border-haze/45 pt-2 font-mono text-[9.5px] leading-none tracking-[0.04em] text-paper-faint min-[430px]:text-[10px]">
              <span
                role={onSourceClick ? 'button' : undefined}
                tabIndex={onSourceClick ? 0 : undefined}
                onClick={
                  onSourceClick
                    ? (e) => {
                        e.stopPropagation()
                        onSourceClick(article.sourceId)
                      }
                    : undefined
                }
                className={`min-w-0 truncate ${
                  read ? 'text-paper-faint' : 'text-paper-muted'
                } ${onSourceClick ? 'transition-colors hover:text-cinnabar' : ''}`}
              >
                {article.sourceLabel}
              </span>
              <span aria-hidden className="shrink-0 text-paper-faint/45">·</span>
              <span className="shrink-0">{articleRelativeTime(article)}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1 text-paper-faint/75">
                {saved && <BookmarkCheck size={11} strokeWidth={1.65} className="text-cinnabar/85" aria-label="已收藏" />}
                {prestored && <Cloud size={10.5} strokeWidth={1.35} aria-label="已预存，可离线阅读" />}
                {renderTranslateBadge()}
              </span>
            </span>
          </span>
        </button>
      )}

      {/* 桌面端/平板端杂志卡片布局 (Desktop & Tablet: >= md) */}
      {showCard && (
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={`editorial-story-tile group pressable-card chamfer-surface relative h-full w-full flex-col justify-between rounded-xl border p-5 text-left transition-all duration-300 ${
            variant === 'auto' ? 'hidden md:flex' : 'flex'
          } ${
            read
              ? 'border-haze/60 bg-ink/40 hover:border-haze hover:bg-ink-raised/40'
              : 'border-haze bg-ink-raised/60 hover:-translate-y-0.5 hover:border-paper-faint/35 hover:bg-ink-raised hover:shadow-md'
          }`}
        >
          <div className="w-full">
            {/* 大图展示 (如果有图)，无图时展示形式化编辑封面以维持网格对齐 */}
            {cover ? (
              <div className="editorial-card-media relative mb-3.5 overflow-hidden rounded-lg bg-ink border border-haze/60">
                <InkImage
                  src={cover}
                  onFailed={onFailed}
                  collapseOnError
                  className={`${article.contentType === 'video' ? 'aspect-video h-auto' : 'h-38'} w-full object-cover transition-all duration-500 group-hover:scale-105 ${
                    read
                      ? 'opacity-70 grayscale-[0.2] saturate-[0.8]'
                      : 'opacity-95 group-hover:opacity-100'
                  }`}
                />
                {article.contentType === 'video' && (
                  <span className="absolute bottom-2 right-2 rounded-full border border-white/12 bg-black/55 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] text-white/85 backdrop-blur-sm">
                    视频
                  </span>
                )}
              </div>
            ) : (
              <div className="editorial-card-media relative mb-3.5 overflow-hidden rounded-lg border border-haze/60">
                <EditorialCoverPlaceholder
                  article={article}
                  read={read}
                  className={`${article.contentType === 'video' ? 'aspect-video h-auto' : 'h-38'} w-full`}
                  showUnreadDot={false}
                />
              </div>
            )}

            {/* 信源与时间 */}
            <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] tracking-[0.1em] text-paper-faint">
              <div className="flex items-center gap-1.5 min-w-0">
                {!read && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-cinnabar/90 shrink-0"
                    aria-hidden
                  />
                )}
                <span
                  role={onSourceClick ? 'button' : undefined}
                  tabIndex={onSourceClick ? 0 : undefined}
                  onClick={
                    onSourceClick
                      ? (e) => {
                          e.stopPropagation()
                          onSourceClick(article.sourceId)
                        }
                      : undefined
                  }
                  className={`truncate ${
                    read ? 'text-paper-faint' : 'text-paper-muted font-medium'
                  } ${onSourceClick ? 'hover:text-cinnabar transition-colors cursor-pointer' : ''}`}
                >
                  {article.sourceLabel}
                </span>
                {renderTranslateBadge()}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span>{articleRelativeTime(article)}</span>
                {saved && <BookmarkCheck size={12} strokeWidth={1.8} className="text-cinnabar" />}
                {prestored && (
                  <Cloud
                    size={11}
                    strokeWidth={1.35}
                    className="text-paper-faint/70"
                    aria-label="已预存，可离线阅读"
                  />
                )}
              </div>
            </div>

            {/* 文章标题 */}
            <h2
              className={`editorial-card-title row-title mt-2 line-clamp-3 text-[18px] xl:text-[19px] leading-[1.42] tracking-[0.005em] transition-colors duration-200 ${
                read
                  ? 'font-normal text-paper-muted/80'
                  : 'font-medium text-paper group-hover:text-cinnabar'
              }`}
            >
              {activeTitle}
            </h2>

            {/* 双语对照模式下的外文原标题 */}
            {isTranslated && displayMode === 'compare' && (
              <p className="mt-1 font-sans text-[12px] leading-snug text-paper-faint/85 line-clamp-1 italic">
                {originalDisplayTitle}
              </p>
            )}

            {/* 摘要导读 */}
            {displaySummary && (
              <p
                className={`editorial-card-summary mt-2 line-clamp-3 text-[13.5px] leading-[1.65] ${
                  read ? 'text-paper-faint/80' : 'text-paper-muted'
                }`}
              >
                {displaySummary}
              </p>
            )}
          </div>

          {/* 卡片底栏提示 */}
          <div className="editorial-card-footer mt-4 flex items-center justify-between pt-3 border-t border-haze/50 font-mono text-[10.5px] text-paper-faint">
            <span>{read ? '已读 · 点击重温' : '点击阅读全文'}</span>
            <span className="text-paper-muted group-hover:text-cinnabar group-hover:translate-x-0.5 transition-all">
              →
            </span>
          </div>
        </button>
      )}
    </li>
  )
})

interface LeadProps {
  article: Article
  read?: boolean
  saved?: boolean
  /** 正文已进入持久预存窗口 */
  prestored?: boolean
  translated?: { title: string; summary?: string }
  displayMode?: 'replace' | 'compare'
  onOpen: (article: Article) => void
  onSourceClick?: (sourceId: string) => void
  revealed?: boolean
  /** 新版双栏首页使用带边距/圆角的头条卡；经典布局保持原来的全宽头条。 */
  framed?: boolean
  /** 布局变体：移动端全宽 (lead) / 桌面端横幅 (banner) / 自适应 (auto) */
  variant?: 'lead' | 'banner' | 'auto'
}

/**
 * 头条：移动端为杂志封面感全宽图文；桌面端为精美双栏杂志特写卡片。
 */
export const LeadStory = memo(function LeadStory({
  article,
  read = false,
  saved = false,
  prestored = false,
  translated,
  displayMode = 'replace',
  onOpen,
  onSourceClick,
  revealed = false,
  framed = false,
  variant = 'auto',
}: LeadProps) {
  const [showOriginal, setShowOriginal] = useState(false)
  const showLead = variant === 'lead' || variant === 'auto'
  const showBanner = variant === 'banner' || variant === 'auto'
  const hasTranslation = Boolean(translated?.title)
  const isTranslated = hasTranslation && !showOriginal
  const activeSummary = isTranslated ? (translated?.summary || article.summary) : article.summary
  const activeTitle = feedDisplayTitle(
    isTranslated ? (translated?.title || article.title) : article.title,
    activeSummary,
  )
  const originalDisplayTitle = feedDisplayTitle(article.title, article.summary)
  const displaySummary = cleanSummaryText(activeSummary, activeTitle)
  const { cover, onFailed } = useArticleCover(article)

  const renderTranslateBadge = () => {
    if (!hasTranslation) return null
    return (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          setShowOriginal((prev) => !prev)
        }}
        title={isTranslated ? '点击查看原文' : '点击查看译文'}
        className={`inline-flex items-center px-1.5 py-0.2 rounded text-[9.5px] font-sans font-normal transition-all cursor-pointer select-none ${
          isTranslated
            ? 'text-cinnabar/90 border border-cinnabar/25 bg-cinnabar/5 hover:bg-cinnabar/15 active:scale-95'
            : 'text-paper-muted border border-haze bg-paper/5 hover:bg-paper/10 hover:text-paper active:scale-95'
        }`}
      >
        {isTranslated ? '译' : '原'}
      </span>
    )
  }

  return (
    <>
      {/* 移动端头条 (Mobile: < lg) */}
      {showLead && (
        <button
          data-reveal={revealed ? undefined : true}
          type="button"
          onClick={() => onOpen(article)}
          className={`editorial-lead-mobile lead-hero h-[14.5rem] sm:h-[16rem] group text-left ${framed ? 'is-framed' : ''} ${variant === 'auto' ? 'lg:hidden' : ''}`}
        >
          {/* 外层固定高度：封面补救失败后 InkImage 可能卸载，头条框仍须占位 */}
          <span className="editorial-lead-mobile-photo block h-[14.5rem] w-full overflow-hidden sm:h-[16rem]" aria-hidden={!cover}>
            {cover ? (
              <InkImage
                src={cover}
                onFailed={onFailed}
                eager
                className={`h-full w-full ${
                  read ? 'opacity-[0.78] grayscale-[0.12] saturate-[0.9]' : 'opacity-100'
                }`}
              />
            ) : null}
          </span>
          <span className="editorial-lead-mobile-veil lead-cover-veil" aria-hidden />
          <span className={`editorial-lead-mobile-copy lead-hero-copy page-x pb-4 pt-10 sm:pb-4.5 ${read ? 'is-read' : ''}`}>
            <span className="editorial-lead-kicker lead-hero-kicker flex items-center gap-2 font-mono text-[11px] tracking-[0.14em]">
              <span className="h-[2px] w-3.5 rounded-full bg-cinnabar" aria-hidden />
              <span
                role={onSourceClick ? 'button' : undefined}
                tabIndex={onSourceClick ? 0 : undefined}
                onClick={
                  onSourceClick
                    ? (e) => {
                        e.stopPropagation()
                        onSourceClick(article.sourceId)
                      }
                    : undefined
                }
                className={onSourceClick ? 'hover:text-[#f4efe6] transition-colors cursor-pointer' : ''}
              >
                头条 · {article.sourceLabel}
              </span>
              {saved && <BookmarkCheck size={11} strokeWidth={1.8} className="text-cinnabar" />}
              {prestored && (
                <Cloud
                  size={11}
                  strokeWidth={1.35}
                  className="text-white/60"
                  aria-label="已预存，可离线阅读"
                />
              )}
              {renderTranslateBadge()}
            </span>
            <span className="editorial-lead-mobile-title lead-title mt-2 line-clamp-2 sm:line-clamp-3 text-[19px] font-medium leading-[1.42] tracking-[-0.01em] sm:text-[21px]">
              {activeTitle}
            </span>
            {isTranslated && displayMode === 'compare' && (
              <span className="lead-hero-summary mt-1 font-sans text-[12px] leading-snug line-clamp-1 italic">
                {originalDisplayTitle}
              </span>
            )}
            {displaySummary && (
              <span className="lead-hero-summary mt-1.5 line-clamp-1 text-[12.5px] leading-[1.58] text-white/75">
                {displaySummary}
              </span>
            )}
            <span className="lead-hero-meta mt-2.5 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.06em] text-white/60">
              <span>{articleRelativeTime(article)}</span>
              <span className="h-2 w-px bg-white/20" aria-hidden />
              <span className="text-white/80 font-medium">{read ? '重温正文' : '阅读全文'}</span>
            </span>
          </span>
        </button>
      )}

      {/* 桌面端杂志特写头条 (Desktop: >= lg) */}
      {showBanner && (
        <div
          data-reveal={revealed ? undefined : true}
          className={`editorial-lead-desktop ${variant === 'auto' ? 'hidden lg:block' : ''} my-6 px-6 xl:px-8 2xl:px-10`}
        >
          <button
            type="button"
            onClick={() => onOpen(article)}
            className={`editorial-lead-spread group relative grid w-full grid-cols-12 gap-8 items-center rounded-2xl border p-6 xl:p-8 2xl:p-10 text-left transition-all duration-300 ${
              read
                ? 'border-haze bg-ink/50 hover:bg-ink-raised/50 opacity-90'
                : 'border-haze bg-ink-raised/60 hover:border-paper-faint/40 hover:bg-ink-raised hover:shadow-xl'
            }`}
          >
            {/* 左侧大图 (7 栅格) */}
            <div className="editorial-lead-desktop-photo col-span-7 h-[300px] xl:h-[350px] 2xl:h-[400px] w-full overflow-hidden rounded-xl bg-ink border border-haze/70 relative">
              <InkImage
                src={cover}
                onFailed={onFailed}
                eager
                collapseOnError
                className={`h-full w-full object-cover transition-all duration-700 ease-ink group-hover:scale-105 ${
                  read ? 'opacity-80 grayscale-[0.15] saturate-[0.88]' : 'opacity-100'
                }`}
              />
            </div>

            {/* 右侧深度排版区 (5 栅格) */}
            <div className="editorial-lead-desktop-copy col-span-5 flex flex-col justify-between h-full py-2">
              <div>
                <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-cinnabar-soft">
                  <span className="h-px w-6 bg-cinnabar" aria-hidden />
                  <span
                    role={onSourceClick ? 'button' : undefined}
                    tabIndex={onSourceClick ? 0 : undefined}
                    onClick={
                      onSourceClick
                        ? (e) => {
                            e.stopPropagation()
                            onSourceClick(article.sourceId)
                          }
                        : undefined
                    }
                    className={onSourceClick ? 'hover:text-paper transition-colors cursor-pointer' : ''}
                  >
                    头条特写 · {article.sourceLabel}
                  </span>
                  {saved && <BookmarkCheck size={13} strokeWidth={1.8} className="text-cinnabar" />}
                  {prestored && (
                    <Cloud
                      size={11}
                      strokeWidth={1.35}
                      className="text-paper-faint/70"
                      aria-label="已预存，可离线阅读"
                    />
                  )}
                  {renderTranslateBadge()}
                </div>

                <h1
                  className={`editorial-lead-desktop-title lead-title mt-4 line-clamp-3 text-[26px] xl:text-[30px] leading-[1.32] font-medium transition-colors duration-200 ${
                    read
                      ? 'text-paper-muted/90'
                      : 'text-paper group-hover:text-cinnabar'
                  }`}
                >
                  {activeTitle}
                </h1>

                {isTranslated && displayMode === 'compare' && (
                  <p className="mt-1.5 font-sans text-[13px] leading-snug text-paper-faint/85 line-clamp-1 italic">
                    {originalDisplayTitle}
                  </p>
                )}

                {displaySummary && (
                  <p className={`mt-3.5 line-clamp-4 text-[14px] leading-[1.7] ${read ? 'text-paper-faint/80' : 'text-paper-muted'}`}>
                    {displaySummary}
                  </p>
                )}
              </div>

              <div className="mt-6 flex items-center justify-between pt-4 border-t border-haze/60 font-mono text-[11px] text-paper-faint">
                <span className="flex items-center gap-2">
                  <span>{articleRelativeTime(article)}</span>
                  <span className="h-px w-3 bg-haze" aria-hidden />
                  <span>{read ? '已读' : '精选要闻'}</span>
                </span>
                <span className="flex items-center gap-1 font-medium text-cinnabar group-hover:translate-x-1 transition-transform">
                  <span>{read ? '重温正文' : '展开阅读'}</span>
                  <span>→</span>
                </span>
              </div>
            </div>
          </button>
        </div>
      )}
    </>
  )
})

