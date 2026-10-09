import type { LinuxDoNotification } from '../types'

const LINUXDO_ORIGIN = 'https://linux.do'

const notificationLabels: Record<number, string> = {
  1: '有人提到了你',
  2: '有人回复了你',
  3: '有人引用了你',
  4: '帖子被编辑',
  5: '有人点赞',
  6: '收到私信',
  7: '收到私信邀请',
  8: '邀请已被接受',
  9: '关注主题有新帖',
  10: '帖子已移动',
  11: '有人链接了你的内容',
  12: '获得徽章',
  13: '收到主题邀请',
  14: '系统通知',
  15: '群组中提到了你',
  16: '群组消息摘要',
  17: '关注内容有新主题',
  18: '主题提醒',
  19: '收到多个赞',
  20: '帖子已通过审核',
  21: '代码审核已通过',
  22: '成员申请已通过',
  23: '成员申请汇总',
  24: '书签提醒',
  25: '收到 Reaction',
  26: '投票结果已发布',
  27: '活动提醒',
  28: '活动邀请',
  29: '聊天中提到了你',
  30: '收到聊天消息',
  31: '收到聊天邀请',
  32: '聊天群组中提到了你',
  33: '聊天中引用了你',
  34: '收到主题指派',
  35: '问答有新评论',
  36: '关注的分类或标签有新内容',
  37: 'Linux.do 有新功能',
  38: 'Linux.do 管理通知',
  39: '链接通知汇总',
  40: '关注的聊天有新内容',
  43: '收到 Boost',
  800: '有人关注了你',
  801: '关注的人发布了新主题',
  802: '关注的人有新回复',
  900: '圈子有新动态',
}

const systemNotificationTypes = new Set([
  12, 14, 16, 18, 20, 21, 22, 23, 24, 26, 27, 34, 37, 38,
])

function stringData(notification: LinuxDoNotification, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = notification.data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

function integerData(notification: LinuxDoNotification, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = notification.data[key]
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    if (Number.isInteger(number) && number > 0) return number
  }
  return undefined
}

function normalizeLinuxDoUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value, LINUXDO_ORIGIN)
    if (url.origin !== LINUXDO_ORIGIN) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function topicTargetFromUrl(value: string | undefined): Extract<LinuxDoNotificationTarget, { kind: 'topic' }> | undefined {
  const normalized = normalizeLinuxDoUrl(value)
  if (!normalized) return undefined
  const url = new URL(normalized)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 't') return undefined

  if (parts.length >= 3) {
    const topicId = Number(parts[2])
    const postNumber = parts[3] ? Number(parts[3]) : undefined
    if (Number.isInteger(topicId) && topicId > 0) {
      return {
        kind: 'topic',
        topicId,
        slug: parts[1] || 'topic',
        postNumber: Number.isInteger(postNumber) && (postNumber ?? 0) > 0 ? postNumber : undefined,
      }
    }
  }

  const topicId = Number(parts[1])
  if (Number.isInteger(topicId) && topicId > 0) {
    return { kind: 'topic', topicId, slug: 'topic' }
  }
  return undefined
}

export type LinuxDoNotificationFilter = 'all' | 'mentions' | 'replies' | 'private' | 'system'

export type LinuxDoNotificationTarget =
  | { kind: 'topic'; topicId: number; slug: string; postNumber?: number }
  | { kind: 'user'; username: string; tab?: 'badges'; badgeId?: number }
  | { kind: 'external'; url: string }
  | { kind: 'detail' }

export function linuxDoNotificationLabel(type: number): string {
  return notificationLabels[type] || '新通知'
}

export function linuxDoNotificationTitle(notification: LinuxDoNotification): string {
  if (notification.notificationType === 12) {
    const badgeName = stringData(notification, 'badge_name')
    if (badgeName) return '获得徽章 · ' + badgeName
  }

  return notification.fancyTitle
    || stringData(notification, 'topic_title', 'title')
    || linuxDoNotificationLabel(notification.notificationType)
}

export function linuxDoNotificationDetail(notification: LinuxDoNotification): string {
  const username = stringData(notification, 'display_username', 'username', 'original_username')
  const badgeName = stringData(notification, 'badge_name')
  const groupName = stringData(notification, 'group_name')
  const boostRaw = stringData(notification, 'boost_raw')

  if (badgeName) return '徽章：' + badgeName + (username ? ' · @' + username : '')
  if (boostRaw) return (username ? '@' + username + '：' : '') + boostRaw
  if (groupName) return '群组：' + groupName + (username ? ' · @' + username : '')
  if (username) return '来自 @' + username
  return '这是一条 Linux.do 系统通知，没有独立内容页。通知本身仍可正常标记为已读。'
}

export function linuxDoNotificationMatchesFilter(notification: LinuxDoNotification, filter: LinuxDoNotificationFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'mentions') return [1, 3, 15, 29, 32].includes(notification.notificationType)
  if (filter === 'replies') return [2, 35].includes(notification.notificationType)
  if (filter === 'private') return [6, 7].includes(notification.notificationType)
  return systemNotificationTypes.has(notification.notificationType)
}

export function linuxDoNotificationUnreadCount(items: LinuxDoNotification[]): number {
  return items.reduce((count, item) => count + (item.read ? 0 : 1), 0)
}

export function mergeLinuxDoNotifications(
  previous: LinuxDoNotification[],
  incoming: LinuxDoNotification[],
): LinuxDoNotification[] {
  const byId = new Map<number, LinuxDoNotification>()
  for (const item of previous) byId.set(item.id, item)
  for (const item of incoming) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing ? {
      ...item,
      // A response that started before a successful mark-read must never
      // resurrect the unread dot when it completes later.
      read: item.read || existing.read,
    } : item)
  }

  return [...byId.values()].sort((a, b) => {
    const timeA = Date.parse(a.createdAt)
    const timeB = Date.parse(b.createdAt)
    const safeA = Number.isFinite(timeA) ? timeA : 0
    const safeB = Number.isFinite(timeB) ? timeB : 0
    return safeB - safeA || b.id - a.id
  })
}

export function markLinuxDoNotificationRead(
  items: LinuxDoNotification[],
  notificationId: number,
): LinuxDoNotification[] {
  return items.map((item) => item.id === notificationId ? { ...item, read: true } : item)
}

export function markAllLinuxDoNotificationsRead(items: LinuxDoNotification[]): LinuxDoNotification[] {
  return items.map((item) => item.read ? item : { ...item, read: true })
}

export function resolveLinuxDoNotificationTarget(
  notification: LinuxDoNotification,
  currentUsername?: string,
): LinuxDoNotificationTarget {
  const dataUrl = stringData(notification, 'post_url', 'url', 'href')

  // System/user notifications have their own semantic destinations and must
  // not accidentally fall through to an incidental topic_id in the payload.
  if (notification.notificationType === 12) {
    const username = currentUsername
      || stringData(notification, 'username', 'display_username', 'original_username')
    if (username) {
      return {
        kind: 'user',
        username,
        tab: 'badges',
        badgeId: integerData(notification, 'badge_id'),
      }
    }
  }

  if (notification.notificationType === 8 || notification.notificationType === 800) {
    const username = stringData(notification, 'username', 'display_username', 'original_username')
    if (username) return { kind: 'user', username }
  }

  const topicId = notification.topicId ?? integerData(notification, 'topic_id')
  if (topicId && topicId > 0) {
    return {
      kind: 'topic',
      topicId,
      slug: notification.slug || 'topic',
      postNumber: notification.postNumber,
    }
  }

  const topicFromUrl = topicTargetFromUrl(dataUrl)
  if (topicFromUrl) return topicFromUrl

  const externalUrl = normalizeLinuxDoUrl(dataUrl)
  if (externalUrl) return { kind: 'external', url: externalUrl }

  return { kind: 'detail' }
}

/** Actor fields differ from the topic title and notification label. */
export function linuxDoNotificationActor(notification: LinuxDoNotification): { username?: string; name?: string } {
  return {
    username: stringData(notification, 'display_username', 'username', 'original_username'),
    name: notification.actingUserName || stringData(notification, 'display_name'),
  }
}
