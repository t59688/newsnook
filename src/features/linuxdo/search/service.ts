import { linuxDoEndpoints } from '../api/endpoints'
import { decodeLinuxDoAvatar, decodeTopics } from '../api/decode'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoPost, LinuxDoTopicSummary, LinuxDoUser } from '../types'

export interface LinuxDoSearchResult {
  topics: LinuxDoTopicSummary[]
  posts: LinuxDoPost[]
  users: LinuxDoUser[]
  hasMore: boolean
}

export class LinuxDoSearchService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) { this.api = api }

  async search(query: string, page = 1, signal?: AbortSignal): Promise<LinuxDoSearchResult> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.search(query, page), { auth: 'optional', signal })
    if (!payload || typeof payload !== 'object') throw new Error('Linux.do 返回了无法识别的搜索数据')
    const metadata = payload.grouped_search_result ?? payload
    const error = metadata.error || payload.error
    if (typeof error === 'string' && error) throw new Error(error)
    // Discourse sideloads topics from SearchPostSerializer. Depending on the
    // serializer mode, the association is topic_id + topics[] or nested topic.
    // users[] is a separate user-search result, not the authors of posts[].
    const rawPosts: any[] = Array.isArray(payload.posts) ? payload.posts : []
    const topicById = new Map<number, any>()
    for (const topic of Array.isArray(payload.topics) ? payload.topics : []) {
      if (topic && Number(topic.id) > 0) topicById.set(Number(topic.id), topic)
    }
    for (const post of rawPosts) {
      if (post?.topic && Number(post.topic.id) > 0) topicById.set(Number(post.topic.id), post.topic)
    }
    const topics = decodeTopics({ topic_list: { topics: [...topicById.values()] }, users: payload.users })
    const posts: LinuxDoPost[] = rawPosts.filter(Boolean).map((post): LinuxDoPost => {
      const topic = post.topic ?? topicById.get(Number(post.topic_id))
      return {
        id: Number(post.id), postNumber: Number(post.post_number),
        username: typeof post.username === 'string' ? post.username : '',
        name: typeof post.name === 'string' ? post.name : undefined,
        avatarTemplate: decodeLinuxDoAvatar(post.avatar_template),
        // A preview is inline text/highlighting, never an embedded web page.
        cooked: sanitizeLinuxDoCooked(typeof post.blurb === 'string' ? post.blurb : '').replace(/<(?!\/?(?:b|strong|em|mark|span|br)\b)[^>]*>/gi, ''),
        createdAt: String(post.created_at ?? ''),
        topicId: Number(topic?.id ?? post.topic_id) > 0 ? Number(topic?.id ?? post.topic_id) : undefined,
        topicSlug: typeof topic?.slug === 'string' ? topic.slug : undefined,
        topicTitle: typeof topic?.title === 'string' ? topic.title : undefined,
        actions: [],
      }
    }).filter((post) => Number.isFinite(post.id) && post.id > 0 && Number.isFinite(post.postNumber) && post.postNumber > 0)
    const users: LinuxDoUser[] = (Array.isArray(payload.users) ? payload.users : []).filter(Boolean).map((user: any) => ({
      id: Number(user.id), username: String(user.username ?? ''),
      name: typeof user.name === 'string' ? user.name : undefined,
      avatarTemplate: decodeLinuxDoAvatar(user.avatar_template),
    })).filter((user: LinuxDoUser) => Number.isFinite(user.id) && user.username)
    return { topics, posts, users, hasMore: metadata.more_full_page_results === true || metadata.more_posts === true || metadata.more_users === true }
  }
}
