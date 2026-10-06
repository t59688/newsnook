import { Bell, Heart, Link, Loader2, Mail, MessageCircle, Quote, AtSign, Award, UserPlus, Rocket } from 'lucide-react'
import type { LinuxDoNotification } from '../types'
import { linuxDoNotificationActor, linuxDoNotificationLabel, linuxDoNotificationTitle } from '../notification/model'
import { cleanArticleTitleText } from '../../../lib/articleTitle'
import { ago, avatar } from './utils'

export function NotificationRow({ item, marking, onOpen }: { item: LinuxDoNotification; marking: boolean; onOpen: () => void }) {
  const actor = linuxDoNotificationActor(item)
  const title = cleanArticleTitleText(linuxDoNotificationTitle(item))
  const label = linuxDoNotificationLabel(item.notificationType)

  const isLike = [5, 19, 25].includes(item.notificationType)
  const isReply = [2, 35].includes(item.notificationType)
  const isMention = [1, 15, 29, 32].includes(item.notificationType)
  const isQuote = [3, 33].includes(item.notificationType)
  const isMail = [6, 7, 16].includes(item.notificationType)
  const isLink = item.notificationType === 11
  const isAward = item.notificationType === 12
  const isFollow = item.notificationType === 800
  const isBoost = item.notificationType === 43

  const Icon = isLike ? Heart
    : isReply ? MessageCircle
      : isMention ? AtSign
        : isQuote ? Quote
          : isMail ? Mail
            : isLink ? Link
              : isAward ? Award
                : isFollow ? UserPlus
                  : isBoost ? Rocket : Bell

  const badgeColor = isLike
    ? 'bg-rose-500/15 text-rose-500 dark:text-rose-400'
    : isReply
      ? 'bg-sky-500/15 text-sky-500 dark:text-sky-400'
      : isMention
        ? 'bg-purple-500/15 text-purple-500 dark:text-purple-400'
        : isQuote
          ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
          : isMail
            ? 'bg-amber-500/15 text-amber-500 dark:text-amber-400'
            : isAward
              ? 'bg-amber-400/20 text-amber-500 dark:text-amber-300'
              : isFollow
                ? 'bg-indigo-500/15 text-indigo-500 dark:text-indigo-400'
                : isBoost
                  ? 'bg-cinnabar/15 text-cinnabar-soft'
                  : 'bg-paper/10 text-paper-muted'

  const preview = typeof item.data.boost_raw === 'string' ? item.data.boost_raw : undefined

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={'打开通知：' + title}
      className={
        'linuxdo-control linuxdo-row group relative flex min-h-[5rem] w-full items-start gap-3.5 px-3.5 py-3.5 text-left transition-colors ' +
        (item.read ? 'hover:bg-paper/[0.03] active:bg-paper/[0.06]' : 'is-unread bg-cinnabar/[0.035] hover:bg-cinnabar/[0.055] active:bg-cinnabar/[0.08]')
      }
    >
      <span className="relative mt-0.5 h-11 w-11 shrink-0">
        <span className="block h-full w-full overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm">
          {actor.username || item.actingUserAvatarTemplate ? (
            avatar(item.actingUserAvatarTemplate, actor.username || actor.name)
          ) : (
            <span className="grid h-full w-full place-items-center text-paper-faint">
              <Bell size={20} />
            </span>
          )}
        </span>
        <span
          className={
            'linuxdo-type-badge absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-ink-raised transition-transform group-hover:scale-110 ' +
            badgeColor
          }
        >
          <Icon size={11} aria-hidden="true" />
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold tracking-[-0.01em] text-paper group-hover:text-cinnabar transition-colors">
              {actor.name || actor.username || '系统通知'}
            </span>
            {actor.name && actor.username && actor.name !== actor.username ? (
              <span className="hidden truncate text-[11px] text-paper-faint sm:inline">@{actor.username}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-paper-faint">{ago(item.createdAt)}</span>
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-paper-faint">
          <span className="inline-flex items-center rounded-md bg-paper/[0.04] px-1.5 py-0.5 font-medium text-paper-muted">
            {label}
          </span>
          {actor.name && actor.username && actor.name !== actor.username ? (
            <span className="sm:hidden text-[10.5px]">@{actor.username}</span>
          ) : null}
        </span>

        <span className="mt-1.5 block line-clamp-2 text-[13.5px] leading-snug font-medium text-paper/85 group-hover:text-paper transition-colors">
          {title}
        </span>

        {preview ? (
          <span className="mt-2 block rounded-xl border border-haze/50 bg-paper/[0.025] px-2.5 py-1.5 text-[12.5px] leading-relaxed text-paper-muted line-clamp-2">
            “{preview}”
          </span>
        ) : null}
      </span>

      {marking ? (
        <Loader2 size={15} role="status" aria-label="正在标记已读" className="mt-1.5 shrink-0 animate-spin text-paper-faint" />
      ) : !item.read ? (
        <span
          aria-label="未读通知"
          className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cinnabar ring-4 ring-cinnabar/20 shadow-sm"
        />
      ) : null}
    </button>
  )
}

