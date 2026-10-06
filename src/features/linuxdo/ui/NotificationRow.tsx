import { Bell, Heart, Link, Loader2, Mail, MessageCircle, Quote, AtSign, Award, UserPlus, Rocket } from 'lucide-react'
import type { LinuxDoNotification } from '../types'
import { linuxDoNotificationActor, linuxDoNotificationLabel, linuxDoNotificationTitle } from '../notification/model'
import { cleanArticleTitleText } from '../../../lib/articleTitle'
import { ago, avatar } from './utils'

export function NotificationRow({ item, marking, onOpen }: { item: LinuxDoNotification; marking: boolean; onOpen: () => void }) {
  const actor = linuxDoNotificationActor(item)
  const title = cleanArticleTitleText(linuxDoNotificationTitle(item))
  const label = linuxDoNotificationLabel(item.notificationType)
  const Icon = [5, 19, 25].includes(item.notificationType) ? Heart
    : [2, 35].includes(item.notificationType) ? MessageCircle
      : [1, 15, 29, 32].includes(item.notificationType) ? AtSign
        : [3, 33].includes(item.notificationType) ? Quote
          : [6, 7, 16].includes(item.notificationType) ? Mail
            : item.notificationType === 11 ? Link
              : item.notificationType === 12 ? Award
                : item.notificationType === 800 ? UserPlus
                  : item.notificationType === 43 ? Rocket : Bell
  const preview = typeof item.data.boost_raw === 'string' ? item.data.boost_raw : undefined
  return <button type="button" onClick={onOpen} aria-label={'打开通知：' + title} className={'linuxdo-control flex min-h-20 w-full items-start gap-3 px-3 py-4 text-left active:bg-paper/5 ' + (item.read ? '' : 'bg-cinnabar/[0.035]')}>
    <span className="relative mt-0.5 h-11 w-11 shrink-0 rounded-full bg-paper/5">
      {actor.username || item.actingUserAvatarTemplate ? avatar(item.actingUserAvatarTemplate, actor.username || actor.name) : <span className="grid h-full w-full place-items-center text-paper-faint"><Bell size={22} /></span>}
      <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-ink-raised text-cinnabar-soft ring-2 ring-ink"><Icon size={12} aria-hidden="true" /></span>
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center justify-between gap-2"><span className="truncate text-[14px] font-semibold text-paper">{actor.name || actor.username || '系统通知'}</span><span className="shrink-0 text-[11px] text-paper-faint">{ago(item.createdAt)}</span></span>
      <span className="mt-0.5 block text-[11px] text-paper-faint">{label}{actor.name && actor.username && actor.name !== actor.username ? ` · @${actor.username}` : ''}</span>
      <span className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-paper-muted">{title}</span>
      {preview ? <span className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-paper-muted">{preview}</span> : null}
    </span>
    {marking ? <Loader2 size={14} role="status" aria-label="正在标记已读" className="mt-1 shrink-0 animate-spin text-paper-faint" /> : !item.read ? <span aria-label="未读通知" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cinnabar" /> : null}
  </button>
}
