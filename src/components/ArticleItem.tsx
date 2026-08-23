import { memo, useState } from 'react'
import { BookmarkCheck, Cloud } from 'lucide-react'

import { InkImage } from './InkImage'
import { articleCoverUrl } from '../lib/articleAudio'
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
  /** 布局变体：单列横排 (row) / 网格卡片 (card) / 自适应 (auto) */
  variant?: 'row' | 'card' | 'auto'
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
  const showCard = variant === 'card' || variant === 'auto'
  const hasTranslation = Boolean(translated?.title)
  const isTranslated = hasTranslation && !showOriginal
  const activeTitle = isTranslated ? (translated?.title || article.title) : article.title
  const displaySummary = cleanSummaryText(article.summary, activeTitle)
  const cover = articleCoverUrl(article.image)

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
    <li
      data-reveal={revealed ? undefined : true}
      className={`article-row-item relative transition-colors duration-300 ${
        variant === 'card' ? 'h-full bg-transparent' : read ? 'bg-ink/30' : 'bg-ink-raised/60 md:bg-transparent'
      }`}
    >
      {/* 移动端横排布局 (Mobile: < md) */}
      {showRow && (
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={`group relative flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition-all duration-200 sm:px-5 sm:py-4 ${
            variant === 'auto' ? 'md:hidden' : ''
          } ${
            read
              ? 'bg-transparent hover:bg-ink/50 group-active:bg-ink-deep/40'
              : 'bg-gradient-to-b from-ink-raised/40 to-transparent hover:bg-ink-raised group-active:bg-ink-deep/20'
          }`}
        >
          <span className="min-w-0 flex-1">
            {/* 顶部信源与时间元数据 */}
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] tracking-[0.08em] ${
                read ? 'text-paper-faint/80' : 'text-paper-faint'
              }`}
            >
              {!read && (
                <span
                  className="h-1 w-1 rounded-full bg-cinnabar/90 shrink-0"
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
                  read ? 'text-paper-faint' : 'text-paper-muted font-medium'
                } ${onSourceClick ? 'hover:text-cinnabar transition-colors cursor-pointer' : ''}`}
              >
                {article.sourceLabel}
              </span>
              <span aria-hidden className="text-paper-faint/50">·</span>
              <span>{articleRelativeTime(article)}</span>
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

            {/* 文章标题 */}
            <span
              className={`row-title mt-1.5 block text-[17px] leading-[1.46] tracking-[0.005em] transition-colors ${
                read
                  ? 'font-normal text-paper-muted/75'
                  : 'font-medium text-paper group-hover:text-cinnabar'
              }`}
            >
              {activeTitle}
            </span>

            {/* 双语对照模式下的外文原标题 */}
            {isTranslated && displayMode === 'compare' && (
              <span className="mt-0.5 block font-sans text-[12px] leading-snug text-paper-faint/85 line-clamp-1 italic">
                {article.title}
              </span>
            )}

            {/* 清洗后的正文摘要 */}
            {displaySummary && (
              <span
                className={`mt-1.5 line-clamp-2 text-[13px] leading-[1.62] ${
                  read ? 'text-paper-faint/80' : 'text-paper-muted'
                }`}
              >
                {displaySummary}
              </span>
            )}
          </span>

          {/* 缩略图容器：微圆角与极细边框，强制满幅裁切消除 Letterboxing */}
          {cover && (
            <span className="relative shrink-0 overflow-hidden rounded-lg border border-haze/70 bg-ink-deep/30 shadow-2xs mt-0.5 h-16 w-16 sm:h-17 sm:w-17">
              <InkImage
                src={cover}
                collapseOnError
                className={`h-full w-full object-cover transition-all duration-300 ${
                  read
                    ? 'opacity-[0.62] grayscale-[0.25] saturate-[0.8] group-active:opacity-85'
                    : 'opacity-[0.98] group-active:opacity-100'
                }`}
              />
            </span>
          )}
        </button>
      )}

      {/* 桌面端/平板端杂志卡片布局 (Desktop & Tablet: >= md) */}
      {showCard && (
        <button
          type="button"
          onClick={() => onOpen(article)}
          className={`group relative h-full w-full flex-col justify-between rounded-xl border p-5 text-left transition-all duration-300 ${
            variant === 'auto' ? 'hidden md:flex' : 'flex'
          } ${
            read
              ? 'border-haze/60 bg-ink/40 hover:border-haze hover:bg-ink-raised/40 opacity-85'
              : 'border-haze bg-ink-raised/60 hover:border-paper-faint/35 hover:bg-ink-raised hover:shadow-md'
          }`}
        >
          <div className="w-full">
            {/* 大图展示 (如果有图) */}
            {cover && (
              <div className="mb-3.5 overflow-hidden rounded-lg bg-ink border border-haze/60">
                <InkImage
                  src={cover}
                  collapseOnError
                  className={`h-38 w-full object-cover transition-all duration-500 group-hover:scale-105 ${
                    read
                      ? 'opacity-70 grayscale-[0.2] saturate-[0.8]'
                      : 'opacity-95 group-hover:opacity-100'
                  }`}
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
              className={`row-title mt-2 text-[18px] xl:text-[19px] leading-[1.42] tracking-[0.005em] transition-colors duration-200 ${
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
                {article.title}
              </p>
            )}

            {/* 摘要导读 */}
            {displaySummary && (
              <p
                className={`mt-2 line-clamp-3 text-[13.5px] leading-[1.65] ${
                  read ? 'text-paper-faint/80' : 'text-paper-muted'
                }`}
              >
                {displaySummary}
              </p>
            )}
          </div>

          {/* 卡片底栏提示 */}
          <div className="mt-4 flex items-center justify-between pt-3 border-t border-haze/50 font-mono text-[10.5px] text-paper-faint">
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
  variant = 'auto',
}: LeadProps) {
  const [showOriginal, setShowOriginal] = useState(false)
  const showLead = variant === 'lead' || variant === 'auto'
  const showBanner = variant === 'banner' || variant === 'auto'
  const hasTranslation = Boolean(translated?.title)
  const isTranslated = hasTranslation && !showOriginal
  const activeTitle = isTranslated ? (translated?.title || article.title) : article.title
  const displaySummary = cleanSummaryText(article.summary, activeTitle)
  const cover = articleCoverUrl(article.image)

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
          className={`lead-hero group text-left ${variant === 'auto' ? 'lg:hidden' : ''}`}
        >
          <InkImage
            src={cover || article.image}
            eager
            collapseOnError
            className={`h-[13.75rem] w-full sm:h-[15rem] ${
              read ? 'opacity-[0.78] grayscale-[0.12] saturate-[0.9]' : 'opacity-100'
            }`}
          />
          <span className="lead-cover-veil" aria-hidden />
          <span className={`lead-hero-copy page-x pb-3.5 pt-8 sm:pb-4 ${read ? 'is-read' : ''}`}>
            <span className="lead-hero-kicker flex items-center gap-2 font-mono text-[10.5px] tracking-[0.16em]">
              <span className="h-px w-5 bg-cinnabar" aria-hidden />
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
                  className="text-paper-faint/70"
                  aria-label="已预存，可离线阅读"
                />
              )}
              {renderTranslateBadge()}
            </span>
            <span className="lead-title mt-1.5 block text-[20px] font-medium leading-[1.32] sm:text-[22px]">
              {activeTitle}
            </span>
            {isTranslated && displayMode === 'compare' && (
              <span className="lead-hero-summary mt-1 block font-sans text-[12px] leading-snug line-clamp-1 italic">
                {article.title}
              </span>
            )}
            {displaySummary && (
              <span className="lead-hero-summary mt-1.5 line-clamp-1 text-[13px] leading-[1.5]">
                {displaySummary}
              </span>
            )}
            <span className="lead-hero-meta mt-2 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.08em]">
              <span>{articleRelativeTime(article)}</span>
              <span className="h-px w-3 bg-white/25" aria-hidden />
              <span>{read ? '重温正文' : '阅读全文'}</span>
            </span>
          </span>
        </button>
      )}

      {/* 桌面端杂志特写头条 (Desktop: >= lg) */}
      {showBanner && (
        <div
          data-reveal={revealed ? undefined : true}
          className={`${variant === 'auto' ? 'hidden lg:block' : ''} my-6 px-6 xl:px-8 2xl:px-10`}
        >
          <button
            type="button"
            onClick={() => onOpen(article)}
            className={`group relative grid w-full grid-cols-12 gap-8 items-center rounded-2xl border p-6 xl:p-8 2xl:p-10 text-left transition-all duration-300 ${
              read
                ? 'border-haze bg-ink/50 hover:bg-ink-raised/50 opacity-90'
                : 'border-haze bg-ink-raised/60 hover:border-paper-faint/40 hover:bg-ink-raised hover:shadow-xl'
            }`}
          >
            {/* 左侧大图 (7 栅格) */}
            <div className="col-span-7 h-[300px] xl:h-[350px] 2xl:h-[400px] w-full overflow-hidden rounded-xl bg-ink border border-haze/70 relative">
              <InkImage
                src={cover || article.image}
                eager
                collapseOnError
                className={`h-full w-full object-cover transition-all duration-700 ease-ink group-hover:scale-105 ${
                  read ? 'opacity-80 grayscale-[0.15] saturate-[0.88]' : 'opacity-100'
                }`}
              />
            </div>

            {/* 右侧深度排版区 (5 栅格) */}
            <div className="col-span-5 flex flex-col justify-between h-full py-2">
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
                  className={`lead-title mt-4 text-[26px] xl:text-[30px] leading-[1.32] font-medium transition-colors duration-200 ${
                    read
                      ? 'text-paper-muted/90'
                      : 'text-paper group-hover:text-cinnabar'
                  }`}
                >
                  {activeTitle}
                </h1>

                {isTranslated && displayMode === 'compare' && (
                  <p className="mt-1.5 font-sans text-[13px] leading-snug text-paper-faint/85 line-clamp-1 italic">
                    {article.title}
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

