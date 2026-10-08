import { Eye, Flame, Heart, MessageCircle } from 'lucide-react'
import type { CSSProperties, KeyboardEvent } from 'react'

import type { LinuxDoCategory, LinuxDoTopicSummary } from '../types'
import { linuxDoTopicReadState } from '../topic/readState'
import { ago, avatar, compact, tagGlyph } from './utils'

function getCategoryColor(category?: LinuxDoCategory): string {
  if (!category?.color) return 'var(--color-cinnabar)'
  return category.color.startsWith('#') ? category.color : `#${category.color}`
}

export function TopicCard({
  topic,
  onOpen,
  category,
  onOpenCategory,
  onOpenTag,
}: {
  topic: LinuxDoTopicSummary
  onOpen: () => void
  category?: LinuxDoCategory
  onOpenCategory?: (category: LinuxDoCategory) => void
  onOpenTag?: (tag: string) => void
}) {
  const author = topic.posters[0]
  const last = topic.posters[topic.posters.length - 1]
  const readState = linuxDoTopicReadState(topic)
  const isUnread = readState !== 'read'
  const unreadLabel = readState === 'new'
    ? '新主题'
    : readState === 'unread'
      ? `${Math.max(1, topic.unread ?? 0, topic.newPosts ?? 0)} 条未读`
      : ''

  const openFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }

  const catColor = category ? getCategoryColor(category) : undefined
  const isHot = (topic.replyCount >= 30) || (topic.views >= 1000)

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={'打开主题：' + topic.title}
      onClick={onOpen}
      onKeyDown={openFromKeyboard}
      className={
        'linuxdo-control group relative w-full rounded-xl sm:rounded-2xl border border-haze/50 bg-ink-raised/85 p-3 sm:p-4 text-left transition-all duration-150 select-none active:scale-[0.988] shadow-[0_1px_3px_rgba(0,0,0,0.03)] ' +
        (isUnread
          ? 'hover:border-cinnabar/30'
          : 'opacity-[0.92] hover:opacity-100')
      }
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        {/* 头像 */}
        <div className="relative mt-0.5 flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-paper/10 bg-ink-deep shadow-2xs">
          {avatar(author?.avatarTemplate, author?.username)}
        </div>

        {/* 主体内容 */}
        <div className="min-w-0 flex-1">
          {/* 顶栏信息：作者、时间、热度微标 */}
          <div className="mb-1 flex items-center justify-between gap-2 text-[11px] leading-tight">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-semibold text-paper/90 group-hover:text-paper transition-colors">
                {author?.username || 'Linux.do'}
              </span>
              {isHot ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-cinnabar/12 border border-cinnabar/25 px-1.5 py-0.2 font-mono text-[9px] font-bold text-cinnabar">
                  <Flame size={9.5} className="fill-cinnabar text-cinnabar" />
                  <span>HOT</span>
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[10.5px] tabular-nums text-paper-faint">
              {topic.lastPostedAt ? ago(topic.lastPostedAt) : ''}
            </span>
          </div>

          {/* 标题 */}
          <div className="flex items-start gap-1.5">
            <h3 className={
              'line-clamp-2 flex-1 text-[15px] sm:text-[16px] font-semibold leading-[1.38] tracking-[-0.015em] transition-colors ' +
              (isUnread ? 'text-paper group-hover:text-cinnabar-soft' : 'text-paper-muted/85 group-hover:text-paper')
            }>
              {topic.title}
            </h3>
            {isUnread ? (
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.7)] ring-2 ring-sky-400/20"
                role="status"
                aria-label={unreadLabel}
                title={unreadLabel}
              />
            ) : null}
          </div>

          {/* 分类与标签 */}
          {(category || topic.tags.length > 0) ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {category ? (
                <button
                  type="button"
                  disabled={!onOpenCategory}
                  onClick={(event) => {
                    event.stopPropagation()
                    onOpenCategory?.(category)
                  }}
                  style={{
                    backgroundColor: catColor ? `color-mix(in srgb, ${catColor} 12%, transparent)` : 'color-mix(in srgb, var(--color-paper) 6%, transparent)',
                    color: catColor || 'var(--color-paper)',
                    borderColor: catColor ? `color-mix(in srgb, ${catColor} 25%, transparent)` : 'transparent',
                  } as CSSProperties}
                  className="linuxdo-control group/cat inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold transition-all active:scale-95 disabled:pointer-events-none"
                >
                  <span className="font-mono text-[9.5px] font-bold opacity-90">
                    {category.slug === 'develop' ? '</>' : '■'}
                  </span>
                  <span>{category.name}</span>
                </button>
              ) : null}

              {topic.tags.slice(0, 3).map((tag) => {
                const glyph = tagGlyph(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={!onOpenTag}
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenTag?.(tag)
                    }}
                    className="linuxdo-control inline-flex items-center gap-1 rounded-md border border-paper/[0.06] bg-paper/[0.03] px-2 py-0.5 text-[10.5px] font-medium text-paper-muted/90 transition-all hover:border-cinnabar/30 hover:bg-paper/[0.07] hover:text-paper active:scale-95 disabled:pointer-events-none"
                  >
                    {glyph ? (
                      <span className="text-[9.5px] leading-none">{glyph}</span>
                    ) : (
                      <span className="font-mono text-[9px] text-paper-faint">#</span>
                    )}
                    <span>{tag}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {/* 底部信息：最后回复与互动数据 */}
          <div className="mt-2.5 flex items-center justify-between gap-2 text-[10.5px] text-paper-faint">
            <span className="min-w-0 truncate text-[10px] sm:text-[10.5px]">
              {last?.username
                ? `最后回复 @${last.username}`
                : author?.username || 'Linux.do'}
            </span>

            <span className="flex shrink-0 items-center gap-2.5 sm:gap-3 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1 font-medium text-paper-muted group-hover:text-paper transition-colors">
                <MessageCircle size={11.5} className="text-paper-faint" />
                <span>{compact(topic.replyCount)}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-paper-faint">
                <Eye size={11} className="opacity-70" />
                <span>{compact(topic.views)}</span>
              </span>
              {topic.likeCount > 0 ? (
                <span className="inline-flex items-center gap-1 font-medium text-rose-400/90">
                  <Heart size={10.5} className="fill-rose-400/20 text-rose-400" />
                  <span>{compact(topic.likeCount)}</span>
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}
