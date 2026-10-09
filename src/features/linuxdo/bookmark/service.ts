import { linuxDoEndpoints } from '../api/endpoints'
import type { LinuxDoApiClient } from '../api/client'

export interface LinuxDoBookmark {
  id: number
  name?: string
  createdAt?: string
  reminderAt?: string
  postId?: number
  postNumber?: number
  topicId?: number
  topicTitle?: string
  topicSlug?: string
  username?: string
}

export class LinuxDoBookmarkService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async update(id: number, input: { name?: string; reminderAt?: string }): Promise<void> {
    await this.api.putForm(linuxDoEndpoints.bookmarkDelete(id), {
      id,
      name: input.name ?? '',
      reminder_at: input.reminderAt ?? '',
    }, { auth: 'required' })
  }

  async delete(id: number): Promise<void> {
    await this.api.deleteJson(linuxDoEndpoints.bookmarkDelete(id), undefined, { auth: 'required' })
  }

  async list(username: string, url?: string): Promise<{ items: LinuxDoBookmark[]; nextUrl?: string }> {
    const target = url
      ? new URL(url, linuxDoEndpoints.origin).toString()
      : linuxDoEndpoints.userBookmarks(username)
    if (!target.startsWith(linuxDoEndpoints.origin + '/')) throw new Error('无效的书签分页地址')
    const payload = await this.api.getJson<any>(target, { auth: 'required' })
    const list = payload?.bookmarks ?? payload?.user_bookmark_list?.bookmarks ?? []
    if (!Array.isArray(list)) return { items: [] }
    const items = list.map((item: any) => ({
      id: Number(item.id ?? item.bookmark_id ?? 0),
      name: typeof item.name === 'string' ? item.name : undefined,
      createdAt: typeof item.created_at === 'string' ? item.created_at : undefined,
      reminderAt: typeof item.reminder_at === 'string' ? item.reminder_at : undefined,
      postId: typeof item.post_id === 'number' ? item.post_id : undefined,
      postNumber: typeof item.post_number === 'number' ? item.post_number : undefined,
      topicId: typeof item.topic_id === 'number' ? item.topic_id : undefined,
      topicTitle: typeof item.title === 'string' ? item.title : typeof item.topic_title === 'string' ? item.topic_title : undefined,
      topicSlug: typeof item.slug === 'string' ? item.slug : undefined,
      username: typeof item.username === 'string' ? item.username : undefined,
    })).filter((item: LinuxDoBookmark) => item.id > 0)
    const more = payload?.user_bookmark_list?.more_bookmarks_url
    return {
      items,
      nextUrl: typeof more === 'string' && more ? more : undefined,
    }
  }
}
