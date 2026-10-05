import { applyLinuxDoReadProgress } from '../topic/readState'
import { privateMessageTopicItem } from '../notification/privateMessages'
import type { LinuxDoPrivateMessageFilter, LinuxDoPrivateMessageItem } from '../notification/privateMessages'

export type LinuxDoPrivateMessagesFilter = 'recent' | LinuxDoPrivateMessageFilter
export interface LinuxDoPrivateMessagesEntry { items: LinuxDoPrivateMessageItem[]; nextPage?: number; loaded: boolean; scrollTop: number }
export interface LinuxDoPrivateMessagesCache {
  owner: string
  filter: LinuxDoPrivateMessagesFilter
  groupName?: string
  entries: Record<string, LinuxDoPrivateMessagesEntry>
}
export const createLinuxDoPrivateMessagesCache = (): LinuxDoPrivateMessagesCache => ({ owner: '', filter: 'recent', entries: {} })

/** Called only after the server accepts /topics/timings; preserve all loaded pages. */
export function applyPrivateMessageReadProgress(cache: LinuxDoPrivateMessagesCache, topicId: number, highestSeen: number): void {
  for (const [scope, entry] of Object.entries(cache.entries)) {
    entry.items = entry.items.map((item) => {
      if (item.topic?.id !== topicId) return item
      const topic = applyLinuxDoReadProgress(item.topic, highestSeen)
      const updated = privateMessageTopicItem(topic)
      return { ...item, topic, unread: updated.unread, targetPostNumber: updated.targetPostNumber }
    })
    if (scope.endsWith(':new') || scope.endsWith(':unread')) entry.items = entry.items.filter((item) => item.topic?.id !== topicId || item.unread)
  }
}

export function markPrivateMessageNotificationRead(cache: LinuxDoPrivateMessagesCache, notificationId: number): void {
  for (const entry of Object.values(cache.entries)) {
    entry.items = entry.items.map((item) => item.notification?.id === notificationId
      ? { ...item, notification: { ...item.notification, read: true }, unread: item.topic ? item.unread : false }
      : item)
  }
}
