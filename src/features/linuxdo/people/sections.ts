import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoDraftData } from '../draft/service'
import type { LinuxDoTopicSummary } from '../types'

export type LinuxDoProfileSection = 'read' | 'drafts' | 'pending' | 'assigned' | 'votes' | 'solved' | 'reactions'
export interface LinuxDoProfileDraft {
  key: string
  sequence: number
  data: LinuxDoDraftData | null
  topicId?: number
  topicSlug?: string
}
export interface LinuxDoProfileItem {
  id: string
  title: string
  createdAt?: string
  text?: string
  html?: string
  reaction?: string
  topic?: LinuxDoTopicSummary
  postNumber?: number
  draft?: LinuxDoProfileDraft
}
export interface LinuxDoProfilePage {
  items: LinuxDoProfileItem[]
  next?: string
}

type Json = Record<string, any>
function destinationOf(value: Json): { topic?: LinuxDoTopicSummary; postNumber?: number } {
  let postNumber = value.post_number
  let slug = value.slug ?? value.topic?.slug ?? 'topic'
  let id = value.topic_id ?? value.topic?.id
  const url = value.url ?? value.topic_url
  if (typeof url === 'string') {
    const match = new URL(url, linuxDoEndpoints.origin).pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)(?:\/(\d+))?$/)
    if (match) { id ??= Number(match[2]); slug = match[1] ?? slug; postNumber ??= Number(match[3]) || undefined }
  }
  if (!id) return {}
  return { postNumber, topic: { id, slug, title: value.topic_title ?? value.topic?.title ?? value.title ?? 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: value.created_at ?? '', lastPostedAt: '', tags: [], posters: [], categoryId: value.category_id } }
}

export class LinuxDoProfileSectionsService {
  private readonly api: LinuxDoApiClient
  constructor(api: LinuxDoApiClient) { this.api = api }

  async list(section: LinuxDoProfileSection, username: string, next?: string, signal?: AbortSignal): Promise<LinuxDoProfilePage> {
    const first = section === 'read' ? linuxDoEndpoints.read()
      : section === 'drafts' ? linuxDoEndpoints.userDrafts()
        : section === 'pending' ? linuxDoEndpoints.userPending(username)
          : section === 'assigned' ? linuxDoEndpoints.userAssigned(username)
            : section === 'votes' ? linuxDoEndpoints.userVotes(username)
              : section === 'solved' ? linuxDoEndpoints.userSolved(username) : linuxDoEndpoints.userReactions(username)
    const url = new URL(next ?? first, linuxDoEndpoints.origin)
    const expected = new URL(first)
    if (url.pathname === expected.pathname.replace(/\.json$/, '')) url.pathname = expected.pathname
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) throw new Error('无效的个人页分页地址')
    const payload = await this.api.getJson<any>(url.toString(), { auth: ['read', 'drafts', 'pending', 'assigned'].includes(section) ? 'required' : 'optional', signal })
    if (section === 'read' || section === 'assigned' || section === 'votes') {
      if (!Array.isArray(payload?.topic_list?.topics)) throw new Error('Linux.do 返回了无法识别的话题列表')
      return { items: decodeTopics(payload).map(topic => ({ id: String(topic.id), title: topic.title, topic })), next: payload.topic_list.more_topics_url || undefined }
    }
    const rows = section === 'reactions' ? payload : section === 'drafts' ? payload?.drafts : section === 'pending' ? payload?.pending_posts : payload?.user_solved_posts
    if (!Array.isArray(rows)) throw new Error('Linux.do 返回了无法识别的个人页数据')
    const offset = Number(url.searchParams.get('offset') ?? 0)
    let more: string | undefined
    if (section === 'drafts' && rows.length >= 30) more = linuxDoEndpoints.userDrafts(offset + rows.length)
    if (section === 'solved' && rows.length >= 20) more = linuxDoEndpoints.userSolved(username, offset + rows.length)
    if (section === 'reactions' && rows.length >= 20 && rows.at(-1)?.id) more = linuxDoEndpoints.userReactions(username, rows.at(-1).id)
    return { next: more, items: rows.map((row: Json): LinuxDoProfileItem => {
      if (section === 'drafts') {
        let data: LinuxDoDraftData | null = null
        try { data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data } catch { /* Keep an unreadable draft visible without allowing edits. */ }
        return { id: row.draft_key, title: data?.title || row.title || '未命名草稿', text: data?.reply, createdAt: row.created_at, draft: { key: row.draft_key, sequence: row.sequence, data, topicId: row.topic_id, topicSlug: row.slug } }
      }
      const post = section === 'reactions' ? row.post ?? {} : row
      const { topic, postNumber } = destinationOf(post)
      return { id: String(row.id ?? row.post_id), title: topic?.title ?? row.title ?? '待审核话题', createdAt: row.created_at, topic, postNumber, text: section === 'pending' ? row.raw_text : undefined, html: typeof post.excerpt === 'string' ? sanitizeLinuxDoCooked(post.excerpt) : undefined, reaction: row.reaction?.reaction_value }
    }) }
  }
}
