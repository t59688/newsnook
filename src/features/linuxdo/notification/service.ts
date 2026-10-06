import { decodePrivateMessageMenu, type LinuxDoPrivateMessageFilter, type LinuxDoPrivateMessageItem } from './privateMessages'
import { linuxDoEndpoints } from '../api/endpoints'
import { decodeCurrentUser, decodeNotifications, decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoNotification, LinuxDoTopicSummary } from '../types'

export class LinuxDoNotificationService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(
    offset = 0,
    limit = 60,
    options: { signal?: AbortSignal; filter?: 'read' | 'unread' } = {},
  ): Promise<{ items: LinuxDoNotification[]; nextOffset?: number; totalRows?: number }> {
    const payload = await this.api.getJson<any>(
      linuxDoEndpoints.notifications(offset, limit, options.filter),
      { auth: 'required', signal: options.signal },
    )
    const loadMore = typeof payload?.load_more_notifications === 'string' ? payload.load_more_notifications : ''
    let nextOffset: number | undefined
    if (loadMore) {
      try {
        const parsed = new URL(loadMore, linuxDoEndpoints.origin)
        const value = Number(parsed.searchParams.get('offset'))
        if (Number.isFinite(value) && value >= 0) nextOffset = value
      } catch {
        nextOffset = undefined
      }
    }
    const totalRowsValue = Number(payload?.total_rows_notifications)
    const totalRows = Number.isFinite(totalRowsValue) && totalRowsValue >= 0 ? totalRowsValue : undefined
    return { items: decodeNotifications(payload), nextOffset, totalRows }
  }

  async recentPrivateMessages(username: string, signal?: AbortSignal): Promise<LinuxDoPrivateMessageItem[]> {
    const payload = await this.api.getJson<unknown>(linuxDoEndpoints.privateMessageMenu(username), { auth: 'required', signal })
    return decodePrivateMessageMenu(payload)
  }

  async privateMessages(
    username: string,
    page = 0,
    signal?: AbortSignal,
    filter: LinuxDoPrivateMessageFilter = 'inbox',
    groupName?: string,
  ): Promise<{ items: LinuxDoTopicSummary[]; nextPage?: number }> {
    const payload = await this.api.getJson<any>(
      linuxDoEndpoints.privateMessages(username, page, filter, groupName),
      { auth: 'required', signal },
    )
    if (!Array.isArray(payload?.topic_list?.topics)) throw new Error('Linux.do 返回了无法识别的私信数据')
    const items = decodeTopics(payload)
    const moreTopicsUrl = typeof payload?.topic_list?.more_topics_url === 'string'
      ? payload.topic_list.more_topics_url
      : ''
    let nextPage: number | undefined
    if (moreTopicsUrl) {
      try {
        const parsed = new URL(moreTopicsUrl, linuxDoEndpoints.origin)
        const value = Number(parsed.searchParams.get('page'))
        nextPage = Number.isInteger(value) && value > page ? value : undefined
      } catch {
        nextPage = undefined
      }
    }
    return { items, nextPage }
  }

  async unreadCount(signal?: AbortSignal): Promise<number> {
    try {
      const current = decodeCurrentUser(await this.api.getJson<any>(
        linuxDoEndpoints.sessionCurrent,
        { auth: 'required', signal },
      ))
      const count = current?.allUnreadNotificationsCount ?? current?.unreadNotifications
      if (count !== undefined) return Math.max(0, Math.trunc(count))
    } catch {
      // Some sessions can still read notifications when session/current is
      // temporarily unavailable. Fall back to the filtered notification list,
      // but never use total_rows_notifications: that is pagination metadata,
      // not the Discourse unread badge count.
    }

    const result = await this.list(0, 99, { signal, filter: 'unread' })
    return result.items.reduce((count, item) => count + (item.read ? 0 : 1), 0)
  }

  async markRead(id: number): Promise<void> {
    await this.api.putForm(
      linuxDoEndpoints.markNotificationsRead,
      { id },
      { auth: 'required' },
    )
  }

  async markAllRead(): Promise<void> {
    await this.api.putForm(
      linuxDoEndpoints.markNotificationsRead,
      {},
      { auth: 'required' },
    )
  }
}
