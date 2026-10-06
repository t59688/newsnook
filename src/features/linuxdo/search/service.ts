import { linuxDoEndpoints } from '../api/endpoints'
import { decodeCategories, decodeLinuxDoAvatar, decodeTopics } from '../api/decode'
import { LinuxDoDiscoveryService } from '../discovery/service'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoCategory, LinuxDoTag, LinuxDoPost, LinuxDoTopicSummary, LinuxDoUser } from '../types'

export interface LinuxDoSearchResult {
  topics: LinuxDoTopicSummary[]
  posts: LinuxDoPost[]
  users: LinuxDoUser[]
  categories?: LinuxDoCategory[]
  tags?: LinuxDoTag[]
  hasMore: boolean
}

export class LinuxDoSearchService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) { this.api = api }

  async searchUsers(query: string, signal?: AbortSignal): Promise<LinuxDoSearchResult> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.searchUsers(query.trim()), { auth: 'optional', signal })
    if (!Array.isArray(payload?.users)) throw new Error('Linux.do 返回了无法识别的用户搜索数据')
    const users: LinuxDoUser[] = payload.users.filter(Boolean).map((user: any) => ({
      id: Number(user.id), username: String(user.username ?? ''),
      name: typeof user.name === 'string' ? user.name : undefined,
      avatarTemplate: decodeLinuxDoAvatar(user.avatar_template),
    })).filter((user: LinuxDoUser) => Number.isFinite(user.id) && user.id > 0 && user.username)
    return { topics: [], posts: [], users, hasMore: false }
  }

  async searchCategories(query: string, signal?: AbortSignal): Promise<LinuxDoSearchResult> {
    const [payload, tags] = await Promise.all([
      this.api.getJson(linuxDoEndpoints.categories, { auth: 'optional', signal }),
      new LinuxDoDiscoveryService(this.api).searchTags(query, { limit: 30 }, signal),
    ])
    if (!Array.isArray((payload as any)?.category_list?.categories)) throw new Error('Linux.do 返回了无法识别的分类数据')
    const term = query.trim().toLocaleLowerCase()
    const categories = decodeCategories(payload).filter(category => `${category.name} ${category.slug} ${category.description ?? ''}`.toLocaleLowerCase().includes(term))
    return { topics: [], posts: [], users: [], categories, tags, hasMore: false }
  }

  async search(query: string, page = 1, signal?: AbortSignal): Promise<LinuxDoSearchResult> {
    if (!Number.isInteger(page) || page < 1 || page > 10) throw new Error('搜索页数须在 1 到 10 之间')
    const payload = await this.api.getJson<any>(linuxDoEndpoints.search(query, page), { auth: 'optional', signal })
    if (!payload || typeof payload !== 'object') throw new Error('Linux.do 返回了无法识别的搜索数据')
    const metadata = payload.grouped_search_result ?? payload
    const error = metadata.error || payload.error
    if (typeof error === 'string' && error) throw new Error(error)
    if (!Array.isArray(payload.posts) && !Array.isArray(payload.topics)) throw new Error('Linux.do 返回了无法识别的搜索数据')
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
    return { topics, posts, users, hasMore: page < 10 && (metadata.more_full_page_results === true || metadata.more_posts === true) }
  }
}
