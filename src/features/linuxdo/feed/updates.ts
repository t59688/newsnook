import type { LinuxDoApiClient } from '../api/client'
import { linuxDoEndpoints } from '../api/endpoints'
import type { LinuxDoFeedMode } from '../types'

export type LinuxDoIncomingSnapshot = Map<number, number>
type IncomingMode = 'latest' | 'new' | 'unread'

/** Discourse MessageBus cursors and incoming topics belong to one workspace/account. */
export class LinuxDoFeedUpdates {
  private readonly cursors: Record<string, number> = { '/latest': -1, '/delete': -1 }
  private readonly incoming: Record<IncomingMode, LinuxDoIncomingSnapshot> = {
    latest: new Map(), new: new Map(), unread: new Map(),
  }
  private sequence = 0
  private revision = 0
  private readonly api: Pick<LinuxDoApiClient, 'postForm'>
  private readonly clientId: string

  constructor(
    api: Pick<LinuxDoApiClient, 'postForm'>,
    userId?: number,
    clientId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join(''),
  ) {
    this.api = api
    this.clientId = clientId
    if (userId !== undefined) {
      this.cursors['/new'] = -1
      this.cursors['/unread'] = -1
      this.cursors[`/unread/${userId}`] = -1
    }
  }

  count(mode: LinuxDoFeedMode): number {
    return this.forMode(mode)?.size ?? 0
  }

  snapshot(mode: LinuxDoFeedMode): LinuxDoIncomingSnapshot {
    return new Map(this.forMode(mode))
  }

  acknowledge(mode: LinuxDoFeedMode, snapshot: LinuxDoIncomingSnapshot): void {
    const pending = this.forMode(mode)
    for (const [topicId, revision] of snapshot) {
      if (pending?.get(topicId) === revision) pending.delete(topicId)
    }
  }

  private forMode(mode: LinuxDoFeedMode): LinuxDoIncomingSnapshot | undefined {
    return mode === 'latest' || mode === 'new' || mode === 'unread' ? this.incoming[mode] : undefined
  }

  async poll(signal?: AbortSignal): Promise<void> {
    const messages = await this.api.postForm<unknown>(linuxDoEndpoints.messageBusPoll(this.clientId), {
      ...this.cursors, __seq: ++this.sequence,
    }, {
      auth: 'optional', csrf: false, signal,
      headers: { 'Dont-Chunk': 'true', 'X-SILENCE-LOGGER': 'true' },
    })
    // Native HTTP cannot always cancel a request; never apply an abandoned response.
    if (signal?.aborted) return
    if (!Array.isArray(messages)) throw new Error('Linux.do 返回了无法识别的话题更新数据')

    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const { channel, message_id: messageId, data } = message
      if (channel === '/__status' && data && typeof data === 'object') {
        for (const name of Object.keys(this.cursors)) {
          if (Number.isSafeInteger(data[name]) && data[name] >= 0) this.cursors[name] = data[name]
        }
        continue
      }
      if (typeof channel !== 'string' || !Object.prototype.hasOwnProperty.call(this.cursors, channel)
        || !Number.isSafeInteger(messageId) || messageId <= this.cursors[channel]!) continue
      this.cursors[channel] = messageId
      if (!data || !Number.isSafeInteger(data.topic_id) || data.topic_id <= 0) continue
      const topicId = data.topic_id as number
      if (data.message_type === 'delete' || data.message_type === 'muted') {
        for (const pending of Object.values(this.incoming)) pending.delete(topicId)
      } else if (channel === '/latest' && data.message_type === 'latest') {
        this.incoming.latest.set(topicId, ++this.revision)
      } else if (channel === '/new' && data.message_type === 'new_topic') {
        this.incoming.new.set(topicId, ++this.revision)
      } else if (channel.startsWith('/unread') && data.message_type === 'unread') {
        this.incoming.unread.set(topicId, ++this.revision)
      } else if (channel.startsWith('/unread') && data.message_type === 'read') {
        const payload = data.payload
        if (payload?.last_read_post_number >= payload?.highest_post_number) this.incoming.unread.delete(topicId)
      }
    }
  }
}
