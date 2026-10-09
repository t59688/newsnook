import { decodeBoost } from '../api/decode'
import { linuxDoEndpoints } from '../api/endpoints'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoBoost } from '../types'

const LIKE_ACTION_ID = 2

export class LinuxDoInteractionService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async like(postId: number): Promise<void> {
    await this.api.postForm(linuxDoEndpoints.postAction, { id: postId, post_action_type_id: LIKE_ACTION_ID }, { auth: 'required' })
  }

  async unlike(postId: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.postActionDelete(postId), { post_action_type_id: LIKE_ACTION_ID }, { auth: 'required' })
  }

  async bookmarkPost(postId: number, name?: string): Promise<any> {
    return this.api.postForm(
      linuxDoEndpoints.bookmarks,
      { bookmarkable_id: postId, bookmarkable_type: 'Post', name },
      { auth: 'required' },
    )
  }

  async deleteBookmark(bookmarkId: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.bookmarkDelete(bookmarkId), undefined, { auth: 'required' })
  }

  async boost(postId: number, raw: string): Promise<LinuxDoBoost> {
    const text = raw.trim()
    if (!text) throw new Error('Boost 内容不能为空')
    if (Array.from(text).length > 16) throw new Error('Boost 最多 16 个字符')
    const payload = await this.api.postForm<unknown>(
      linuxDoEndpoints.boostCreate(postId),
      { raw: text },
      { auth: 'required' },
    )
    const boost = decodeBoost(payload)
    if (!boost) throw new Error('Linux.do 已响应，但未返回有效的 Boost 数据')
    return boost
  }

  async deleteBoost(boostId: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.boost(boostId), undefined, { auth: 'required' })
  }
}
