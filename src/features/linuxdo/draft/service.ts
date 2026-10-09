import { linuxDoEndpoints } from '../api/endpoints'
import type { LinuxDoApiClient } from '../api/client'

export type LinuxDoDraftAction = 'createTopic' | 'reply' | 'edit'

export interface LinuxDoDraftData {
  reply: string
  action: LinuxDoDraftAction
  title?: string
  categoryId?: number
  tags?: string[]
  postId?: number
  reply_to_post_number?: number
}

export interface LinuxDoDraftSnapshot {
  data: LinuxDoDraftData | null
  sequence: number
}

export class LinuxDoDraftService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  keyFor(input: { topicId?: number; postId?: number; action: LinuxDoDraftAction }): string {
    if (input.action === 'createTopic') return 'new_topic'
    if (input.action === 'edit' && input.postId) return 'post_' + input.postId
    return input.topicId ? 'topic_' + input.topicId : 'new_topic'
  }

  async get(key: string): Promise<LinuxDoDraftSnapshot> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.draft(key), { auth: 'required', retryRead: false })
    const raw = typeof payload?.draft === 'string' ? payload.draft : ''
    let data: LinuxDoDraftData | null = null
    if (raw) {
      try { data = JSON.parse(raw) as LinuxDoDraftData } catch { data = null }
    }
    return { data, sequence: Number(payload?.draft_sequence ?? 0) }
  }

  async save(key: string, sequence: number, data: LinuxDoDraftData, owner: string): Promise<number> {
    const payload = await this.api.postForm<any>(
      linuxDoEndpoints.drafts,
      {
        draft_key: key,
        sequence,
        data: JSON.stringify(data),
        owner,
        force_save: false,
      },
      { auth: 'required' },
    )
    return Number(payload?.draft_sequence ?? sequence)
  }

  async clear(key: string, sequence: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.draft(key), { draft_key: key, sequence }, { auth: 'required' })
  }
}
