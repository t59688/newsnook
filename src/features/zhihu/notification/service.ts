import { asRecord } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { validateZhihuCursor } from '../api/endpoints'
import { encryptZhihuMessageBody } from '../crypto/messageBody'
import { ANDROID_PUBLIC_HEADERS } from '../feed/service'

export type ZhihuNotificationCategory = 'comment' | 'like' | 'favlist_me' | 'follow'
export type ZhihuNotificationTimelineEntry = ZhihuNotificationCategory | 'invite'

export interface ZhihuNotificationItem {
  id: string
  title: string
  text: string
  createdAt?: number
  unread: boolean
  targetUrl?: string
  avatarUrl?: string
  author?: {
    id?: string
    token?: string
    name: string
    avatarUrl?: string
  }
}

export interface ZhihuNotificationInvitation {
  id: string
  title: string
  text: string
  targetUrl?: string
  avatarUrl?: string
  unreadCount: number
  createdAt?: number
}

export interface ZhihuNotificationOverview {
  items: ZhihuNotificationItem[]
  nextCursor?: string
  hasMore: boolean
  unread: Record<ZhihuNotificationCategory, number>
  /** message/v3 顶层 unread.message.count 是消息页总未读，不是“私信未读”。 */
  totalUnread: number
  invitation?: ZhihuNotificationInvitation
}

export interface ZhihuNotificationPage {
  items: ZhihuNotificationItem[]
  nextCursor?: string
  hasMore: boolean
}

export interface ZhihuNotificationApi {
  getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown>
  getJsonWithHeaders?(
    operation: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown>
  postJson(operation: string, url: string, body?: unknown, signal?: AbortSignal): Promise<unknown>
  postJsonWithHeaders?(
    operation: string,
    url: string,
    headers: Record<string, string>,
    body?: unknown,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown>
  requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown>
}

export function mergeZhihuNotificationItems(
  previous: ZhihuNotificationItem[],
  incoming: ZhihuNotificationItem[],
): ZhihuNotificationItem[] {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...incoming.filter((item) => !seen.has(item.id) && seen.add(item.id))]
}

export interface ZhihuMessagePeer {
  id: string
  token?: string
  name: string
  avatarUrl?: string
  headline?: string
}

export interface ZhihuPrivateMessage {
  id: string
  content: string
  createdAt?: number
  sender?: ZhihuMessagePeer
  receiver?: ZhihuMessagePeer
}

export interface ZhihuPrivateMessagePage {
  items: ZhihuPrivateMessage[]
  nextCursor?: string
  hasMore: boolean
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function decodePeer(value: unknown): ZhihuMessagePeer | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  const id = stringValue(root.id) ?? stringValue(root.url_token)
  const name = stringValue(root.name)
  if (!id || !name) return undefined
  return {
    id,
    token: stringValue(root.url_token),
    name,
    avatarUrl: stringValue(root.avatar_url),
    headline: stringValue(root.headline),
  }
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)?.trim()
    if (text) return text
  }
  return ''
}

function notificationTargetUrl(...values: unknown[]): string | undefined {
  const urls = values
    .map((value) => stringValue(value)?.trim())
    .filter((value): value is string => Boolean(value))
  // message/v3 的会话卡片有时同时携带普通通知链接和 inbox 链接；私信会话必须优先。
  return urls.find((url) => /(?:^|\/)inbox\//i.test(url)) ?? urls[0]
}

function decodeNotification(value: unknown): ZhihuNotificationItem | null {
  const root = asRecord(value)
  if (!root || root.type === 'empty') return null
  const content = asRecord(root.content)
  const head = asRecord(root.head)
  const author = decodePeer(head?.author)
  const targetSource = asRecord(root.target_source)
  const target = asRecord(root.target)
  const createdAt = (numberValue(root.created) ?? Number(stringValue(root.created_str))) || undefined
  const id = firstText(root.unique_id, root.id) || `${createdAt ?? 0}-${firstText(root.card_type, root.type)}`
  if (!id) return null

  const title = firstText(content?.title, root.detail_title, target?.name, author?.name) || '通知'
  const text = firstText(content?.text, content?.sub_text, content?.abstract_text, targetSource?.full_text, targetSource?.text)
  const targetUrl = notificationTargetUrl(
    content?.target_link,
    content?.sub_target_link,
    targetSource?.target_link,
    head?.target_link,
    target?.url,
  )
  const avatarUrl = firstText(head?.avatar_url, author?.avatarUrl, target?.avatar_url, content?.sub_icon) || undefined
  return {
    id,
    title,
    text,
    createdAt,
    unread: root.is_read === false || (numberValue(root.unread_count) ?? 0) > 0,
    targetUrl,
    avatarUrl,
    author: author ? {
      id: author.id,
      token: author.token,
      name: author.name,
      avatarUrl: author.avatarUrl,
    } : undefined,
  }
}

function decodeInvitation(value: unknown): ZhihuNotificationInvitation | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  const id = firstText(root.id) || 'invite'
  const title = firstText(root.title) || '邀请回答'
  const text = `${stringValue(root.text_prefix) ?? ''}${stringValue(root.text) ?? ''}`.trim()
  const avatarUrls = Array.isArray(root.avatar_urls) ? root.avatar_urls : []
  const firstAvatar = asRecord(avatarUrls[0])
  return {
    id,
    title,
    text,
    targetUrl: firstText(root.target_link) || undefined,
    avatarUrl: firstText(firstAvatar?.url, firstAvatar?.night_url) || undefined,
    unreadCount: numberValue(root.unread_count) ?? 0,
    createdAt: numberValue(root.created),
  }
}

function decodeMessage(value: unknown): ZhihuPrivateMessage | null {
  const root = asRecord(value)
  if (!root) return null
  const createdAt = numberValue(root.created_time)
  const explicitId = firstText(root.id)
  const content = firstText(root.content)
  // ACK（例如 {msg:"success"}）不是消息实体，不能伪造 id=0 后让 UI 当成已发送。
  if ((!explicitId && createdAt === undefined) || !content) return null
  return {
    id: explicitId || String(createdAt),
    content,
    createdAt,
    sender: decodePeer(root.sender),
    receiver: decodePeer(root.receiver),
  }
}

function pagingFrom(root: Record<string, unknown>): { nextCursor?: string; hasMore: boolean } {
  const paging = asRecord(root.paging)
  const next = stringValue(paging?.next)
  const hasMore = paging?.is_end !== true && Boolean(next)
  return { nextCursor: hasMore && next ? validateZhihuCursor(next) : undefined, hasMore }
}

const CATEGORY_TITLES: Record<ZhihuNotificationCategory, string> = {
  comment: '评论转发@',
  like: '赞同喜欢',
  favlist_me: '收藏了我',
  follow: '关注订阅',
}

export class ZhihuNotificationService {
  private readonly api: ZhihuNotificationApi

  constructor(api: ZhihuNotificationApi) {
    this.api = api
  }

  private getMobileJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown> {
    if (this.api.getJsonWithHeaders) {
      return this.api.getJsonWithHeaders(operation, url, ANDROID_PUBLIC_HEADERS, signal, { signing: 'none' })
    }
    return this.api.getJson(operation, url, signal)
  }

  async overview(cursor?: string, signal?: AbortSignal): Promise<ZhihuNotificationOverview> {
    const url = cursor ? validateZhihuCursor(cursor) : 'https://api.zhihu.com/notifications/v3/message/v3?limit=20'
    const raw = await this.getMobileJson('notification.list', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎通知响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    const head = Array.isArray(root.head) ? root.head : []
    const unread = Object.fromEntries(
      Object.entries(CATEGORY_TITLES).map(([key, title]) => {
        const item = head.map(asRecord).find((entry) => entry?.detail_title === title)
        return [key, numberValue(item?.unread_count) ?? 0]
      }),
    ) as Record<ZhihuNotificationCategory, number>
    const unreadRoot = asRecord(root.unread)
    const totalUnread = numberValue(asRecord(unreadRoot?.message)?.count) ?? 0
    const columnHead = Array.isArray(root.column_head) ? root.column_head : []
    const invitation = columnHead.map(decodeInvitation).find((item): item is ZhihuNotificationInvitation => Boolean(item))
    const paging = pagingFrom(root)
    return {
      items: data.map(decodeNotification).filter((item): item is ZhihuNotificationItem => Boolean(item)),
      ...paging,
      unread,
      totalUnread,
      invitation,
    }
  }

  async markCategoryRead(category: ZhihuNotificationCategory, signal?: AbortSignal): Promise<void> {
    const url = `https://api.zhihu.com/notifications/v3/timeline/entry/${category}/actions/readall`
    if (this.api.postJsonWithHeaders) {
      await this.api.postJsonWithHeaders(
        'notification.readall',
        url,
        ANDROID_PUBLIC_HEADERS,
        undefined,
        signal,
        { signing: 'none' },
      )
      return
    }
    await this.api.postJson('notification.readall', url, undefined, signal)
  }

  async timeline(
    category: ZhihuNotificationTimelineEntry,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<ZhihuNotificationPage> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : category === 'invite'
        ? 'https://api.zhihu.com/notifications/v3/timeline/entry/invite?invite_with_time_slice=1&limit=20'
        : `https://api.zhihu.com/notifications/v3/timeline/entry/${category}?limit=20`
    const raw = await this.getMobileJson('notification.timeline', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎分类通知响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    return {
      items: data.map(decodeNotification).filter((item): item is ZhihuNotificationItem => Boolean(item)),
      ...pagingFrom(root),
    }
  }

  async readPeer(peerId: string, signal?: AbortSignal): Promise<ZhihuMessagePeer> {
    const raw = await this.getMobileJson(
      'message.peer',
      `https://api.zhihu.com/messages/user/${encodeURIComponent(peerId)}`,
      signal,
    )
    const peer = decodePeer(raw)
    if (!peer) throw new ZhihuApiError('invalid-response', '知乎私信用户资料缺少必要字段')
    return peer
  }

  async conversation(peerId: string, cursor?: string, signal?: AbortSignal): Promise<ZhihuPrivateMessagePage> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://api.zhihu.com/messages?limit=20&sender_id=${encodeURIComponent(peerId)}`
    const raw = await this.getMobileJson('message.list', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎私信响应不是 JSON object')
    const data = Array.isArray(root.data) ? root.data : []
    return {
      items: data.map(decodeMessage).filter((item): item is ZhihuPrivateMessage => Boolean(item)),
      ...pagingFrom(root),
    }
  }

  async sendMessage(peerId: string, content: string, signal?: AbortSignal): Promise<ZhihuPrivateMessage> {
    const normalizedPeer = peerId.trim()
    const normalizedContent = content.trim()
    if (!normalizedPeer) throw new ZhihuApiError('invalid-response', '私信接收者不能为空')
    if (!normalizedContent) throw new ZhihuApiError('invalid-response', '私信内容不能为空')

    // 官方 Android 11.3.0 协议：先按 form-url-encoded 生成明文，再用本地协议表加密。
    // 非幂等发送只允许一次 POST；不对“结果未知”做任何自动重发。
    const form = new URLSearchParams([
      ['receiver_id', normalizedPeer],
      ['content', normalizedContent],
      ['content_type', '0'],
      ['source_type', 'message_list'],
    ]).toString()
    const raw = await this.api.requestRawJson(
      'message.send',
      'https://api.zhihu.com/messages',
      'POST',
      encryptZhihuMessageBody(form),
      {
        ...ANDROID_PUBLIC_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Zse-93': '101_1_1.0',
      },
      signal,
      { signing: 'none' },
    )
    const root = asRecord(raw)
    const direct = decodeMessage(raw) ?? decodeMessage(root?.data) ?? decodeMessage(root?.message)
    if (direct) return direct

    const error = asRecord(root?.error)
    const errorMessage = firstText(error?.message, root?.message)
    if (error) throw new ZhihuApiError('forbidden', errorMessage || '知乎拒绝发送私信')
    throw new ZhihuApiError(
      'conflict',
      '私信请求已经提交，但服务端没有返回可确认的消息实体。请刷新会话确认后再决定是否重发。',
    )
  }
}
