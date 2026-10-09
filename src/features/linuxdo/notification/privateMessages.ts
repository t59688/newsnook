import { decodeNotifications, decodeTopics } from '../api/decode'
import { linuxDoHighestPostNumber, linuxDoTopicHasUnreadIndicator } from '../topic/readState'
import type { LinuxDoNotification, LinuxDoTopicSummary } from '../types'
import { linuxDoNotificationTitle } from './model'

export type LinuxDoPrivateMessageFilter = 'inbox' | 'new' | 'unread' | 'sent' | 'archive'
export interface LinuxDoPrivateMessageItem {
  key: string
  title: string
  sender: string
  avatarTemplate?: string
  createdAt: string
  unread: boolean
  topic?: LinuxDoTopicSummary
  targetPostNumber?: number
  notification?: LinuxDoNotification
  groupName?: string
}

export function privateMessageTopicItem(topic: LinuxDoTopicSummary): LinuxDoPrivateMessageItem {
  const poster = topic.posters.at(-1)
  return {
    key: 'topic:' + topic.id,
    title: topic.title,
    sender: topic.lastPosterUsername || poster?.username || '私信',
    avatarTemplate: poster?.avatarTemplate,
    createdAt: topic.bumpedAt || topic.lastPostedAt,
    unread: linuxDoTopicHasUnreadIndicator(topic),
    topic,
    targetPostNumber: Math.min(Math.max(1, (topic.lastReadPostNumber ?? 0) + 1), linuxDoHighestPostNumber(topic)),
  }
}

export function decodePrivateMessageMenu(input: unknown): LinuxDoPrivateMessageItem[] {
  const payload = input as Record<string, unknown> | null
  if (!payload || !Array.isArray(payload.topics) || !Array.isArray(payload.unread_notifications) || !Array.isArray(payload.read_notifications)) {
    throw new Error('Linux.do 返回了无法识别的私信数据')
  }
  const notifications = (list: unknown[]): LinuxDoPrivateMessageItem[] => decodeNotifications({ notifications: list }).map((notification) => {
    const data = notification.data
    const sender = [data.display_username, data.username, data.original_username, data.group_name].find((value): value is string => typeof value === 'string' && value.length > 0) || '系统'
    const topic = notification.topicId ? {
      id: notification.topicId, slug: notification.slug || 'topic', title: linuxDoNotificationTitle(notification),
      postsCount: notification.postNumber ?? 1, highestPostNumber: notification.postNumber,
      unread: notification.read ? 0 : 1, notificationLevel: 3,
      replyCount: 0, views: 0, likeCount: 0,
      createdAt: notification.createdAt, lastPostedAt: notification.createdAt, tags: [], posters: [],
    } : undefined
    return {
      key: topic ? 'topic:' + topic.id : 'notification:' + notification.id,
      title: linuxDoNotificationTitle(notification), sender, avatarTemplate: notification.actingUserAvatarTemplate, createdAt: notification.createdAt,
      unread: !notification.read, topic, targetPostNumber: notification.postNumber, notification,
      groupName: !topic && typeof data.group_name === 'string' ? data.group_name : undefined,
    }
  })
  const recent = [
    ...notifications(payload.read_notifications),
    ...decodeTopics({ users: payload.users, topic_list: { topics: payload.topics } }).map(privateMessageTopicItem),
  ].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
  // The official menu puts unread notifications first and excludes their topics
  // from the remaining conversations. Deduplicate defensively across both shapes.
  const seen = new Set<string>()
  return [...notifications(payload.unread_notifications), ...recent].filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}
