import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import { sanitizeLinuxDoCooked } from '../content/sanitize'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoTopicSummary, LinuxDoUser } from '../types'

const LINUX_DO_ORIGIN = 'https://linux.do'
const USER_ACTION_BATCH_SIZE = 30

type Json = Record<string, any>

export type LinuxDoUserActivityFilter = 'all' | 'topics' | 'replies' | 'likes' | 'responses'

export const linuxDoUserActivityFilterId: Record<Exclude<LinuxDoUserActivityFilter, 'all'>, number> = {
  likes: 1,
  topics: 4,
  replies: 5,
  responses: 6,
}

export interface LinuxDoUserProfile extends LinuxDoUser {
  bioRaw?: string
  bioCooked?: string
  title?: string
  location?: string
  website?: string
  createdAt?: string
  lastSeenAt?: string
  featuredUserBadgeIds: number[]
}

export interface LinuxDoUserSummaryTopic {
  id: number
  slug: string
  title: string
  categoryId?: number
  likeCount?: number
  createdAt?: string
  postsCount?: number
}

export interface LinuxDoUserSummaryReply {
  postNumber: number
  likeCount?: number
  createdAt?: string
  topic: LinuxDoUserSummaryTopic
}

export interface LinuxDoUserSummaryLink {
  url: string
  title?: string
  clicks?: number
  postNumber?: number
  topic?: LinuxDoUserSummaryTopic
}

export interface LinuxDoUserSummaryPerson extends LinuxDoUser {
  count: number
}

export interface LinuxDoUserSummaryCategory {
  id: number
  name: string
  slug: string
  color?: string
  textColor?: string
  topicCount?: number
  postCount?: number
  parentCategoryId?: number
}

export interface LinuxDoUserBadge {
  id: number
  badgeId?: number
  name: string
  description?: string
  icon?: string
  imageUrl?: string
  slug?: string
  count?: number
  grantedAt?: string
  favorite?: boolean
}

export interface LinuxDoUserSummary {
  likesGiven?: number
  likesReceived?: number
  topicsEntered?: number
  postsReadCount?: number
  daysVisited?: number
  topicCount?: number
  postCount?: number
  timeRead?: number
  recentTimeRead?: number
  bookmarkCount?: number
  canSeeSummaryStats?: boolean
  canSeeUserActions?: boolean
  topics: LinuxDoUserSummaryTopic[]
  replies: LinuxDoUserSummaryReply[]
  links: LinuxDoUserSummaryLink[]
  mostLikedByUsers: LinuxDoUserSummaryPerson[]
  mostLikedUsers: LinuxDoUserSummaryPerson[]
  mostRepliedToUsers: LinuxDoUserSummaryPerson[]
  topCategories: LinuxDoUserSummaryCategory[]
  badges: LinuxDoUserBadge[]
}

export interface LinuxDoUserAction {
  actionType: number
  createdAt?: string
  username?: string
  name?: string
  avatarTemplate?: string
  actingUsername?: string
  actingName?: string
  actingAvatarTemplate?: string
  targetUsername?: string
  targetName?: string
  slug?: string
  topicId?: number
  title?: string
  postNumber?: number
  postId?: number
  replyToPostNumber?: number
  categoryId?: number
  excerpt?: string
  deleted?: boolean
  hidden?: boolean
}

export interface LinuxDoUserActivity {
  actions: LinuxDoUserAction[]
  topics: LinuxDoTopicSummary[]
  offset: number
  nextOffset?: number
  hasMore: boolean
}

export interface LinuxDoBoostListItem {
  id: number
  raw: string
  cooked: string
  createdAt?: string
  postId?: number
  user?: LinuxDoUser
  post?: {
    id: number
    url?: string
    excerpt?: string
    username?: string
    avatarTemplate?: string
    topicId?: number
    topicTitle?: string
    categoryId?: number
  }
}

interface ReadOptions {
  signal?: AbortSignal
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function absoluteUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return new URL(value.trim(), LINUX_DO_ORIGIN).toString()
  } catch {
    return undefined
  }
}

function absoluteAvatar(template: unknown, size = 96): string | undefined {
  if (typeof template !== 'string' || !template.trim()) return undefined
  return absoluteUrl(template.replace('{size}', String(size)))
}

function summaryTopic(value: unknown): LinuxDoUserSummaryTopic | undefined {
  const topic = value as Json | undefined
  const id = numberValue(topic?.id)
  if (!id) return undefined
  return {
    id,
    slug: typeof topic?.slug === 'string' && topic.slug ? topic.slug : 'topic',
    title: String(topic?.title ?? topic?.fancy_title ?? 'Linux.do 主题'),
    categoryId: numberValue(topic?.category_id),
    likeCount: numberValue(topic?.like_count),
    createdAt: typeof topic?.created_at === 'string' ? topic.created_at : undefined,
    postsCount: numberValue(topic?.posts_count),
  }
}

function summaryPerson(value: unknown): LinuxDoUserSummaryPerson | undefined {
  const user = value as Json | undefined
  const id = numberValue(user?.id)
  const username = typeof user?.username === 'string' ? user.username : ''
  if (!id || !username) return undefined
  return {
    id,
    username,
    name: typeof user?.name === 'string' ? user.name : undefined,
    avatarTemplate: absoluteAvatar(user?.avatar_template),
    trustLevel: numberValue(user?.trust_level),
    count: numberValue(user?.count) ?? 0,
  }
}

function summaryCategory(value: unknown): LinuxDoUserSummaryCategory | undefined {
  const category = value as Json | undefined
  const id = numberValue(category?.id)
  const name = typeof category?.name === 'string' ? category.name : ''
  if (!id || !name) return undefined
  return {
    id,
    name,
    slug: typeof category?.slug === 'string' ? category.slug : String(id),
    color: typeof category?.color === 'string' ? category.color : undefined,
    textColor: typeof category?.text_color === 'string' ? category.text_color : undefined,
    topicCount: numberValue(category?.topic_count),
    postCount: numberValue(category?.post_count),
    parentCategoryId: numberValue(category?.parent_category_id),
  }
}

function userBadge(value: unknown): LinuxDoUserBadge | undefined {
  const item = value as Json | undefined
  const badge = (item?.badge ?? item) as Json | undefined
  const id = numberValue(item?.id) ?? numberValue(badge?.id)
  const badgeId = numberValue(badge?.id) ?? numberValue(item?.badge_id)
  const name = typeof badge?.name === 'string' ? badge.name : typeof item?.name === 'string' ? item.name : ''
  if (!id || !name) return undefined
  return {
    id,
    badgeId,
    name,
    description: typeof badge?.description === 'string' ? badge.description : undefined,
    icon: typeof badge?.icon === 'string' ? badge.icon : undefined,
    imageUrl: absoluteUrl(badge?.image_url),
    slug: typeof badge?.slug === 'string' ? badge.slug : undefined,
    count: numberValue(item?.count),
    grantedAt: typeof item?.granted_at === 'string' ? item.granted_at : undefined,
    favorite: booleanValue(item?.is_favorite),
  }
}

function userAction(value: unknown): LinuxDoUserAction | undefined {
  const action = value as Json | undefined
  const actionType = numberValue(action?.action_type)
  if (actionType === undefined) return undefined
  return {
    actionType,
    createdAt: typeof action?.created_at === 'string' ? action.created_at : undefined,
    username: typeof action?.username === 'string' ? action.username : undefined,
    name: typeof action?.name === 'string' ? action.name : undefined,
    avatarTemplate: absoluteAvatar(action?.avatar_template),
    actingUsername: typeof action?.acting_username === 'string' ? action.acting_username : undefined,
    actingName: typeof action?.acting_name === 'string' ? action.acting_name : undefined,
    actingAvatarTemplate: absoluteAvatar(action?.acting_avatar_template),
    targetUsername: typeof action?.target_username === 'string' ? action.target_username : undefined,
    targetName: typeof action?.target_name === 'string' ? action.target_name : undefined,
    slug: typeof action?.slug === 'string' ? action.slug : undefined,
    topicId: numberValue(action?.topic_id),
    title: typeof action?.title === 'string' ? action.title : undefined,
    postNumber: numberValue(action?.post_number),
    postId: numberValue(action?.post_id),
    replyToPostNumber: numberValue(action?.reply_to_post_number),
    categoryId: numberValue(action?.category_id),
    excerpt: typeof action?.excerpt === 'string' ? sanitizeLinuxDoCooked(action.excerpt) : undefined,
    deleted: booleanValue(action?.deleted),
    hidden: booleanValue(action?.hidden),
  }
}

export class LinuxDoPeopleService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async profile(username: string, options: ReadOptions = {}): Promise<LinuxDoUserProfile> {
    const payload = await this.api.getJson<Json>(linuxDoEndpoints.user(username), { auth: 'optional', signal: options.signal })
    const user = (payload?.user ?? payload) as Json
    return {
      id: Number(user?.id ?? 0),
      username: String(user?.username ?? username),
      name: typeof user?.name === 'string' ? user.name : undefined,
      avatarTemplate: absoluteAvatar(user?.avatar_template, 144),
      trustLevel: numberValue(user?.trust_level),
      bioRaw: typeof user?.bio_raw === 'string' ? user.bio_raw : undefined,
      bioCooked: typeof user?.bio_cooked === 'string' ? sanitizeLinuxDoCooked(user.bio_cooked) : undefined,
      title: typeof user?.title === 'string' ? user.title : undefined,
      location: typeof user?.location === 'string' ? user.location : undefined,
      website: absoluteUrl(user?.website ?? user?.website_name),
      createdAt: typeof user?.created_at === 'string' ? user.created_at : undefined,
      lastSeenAt: typeof user?.last_seen_at === 'string' ? user.last_seen_at : undefined,
      featuredUserBadgeIds: Array.isArray(user?.featured_user_badge_ids)
        ? user.featured_user_badge_ids.map(Number).filter((id: number) => Number.isFinite(id) && id > 0)
        : [],
    }
  }

  async summary(username: string, options: ReadOptions = {}): Promise<LinuxDoUserSummary> {
    const payload = await this.api.getJson<Json>(linuxDoEndpoints.userSummary(username), { auth: 'optional', signal: options.signal })
    const root = (payload?.user_summary ?? payload) as Json
    return {
      likesGiven: numberValue(root?.likes_given),
      likesReceived: numberValue(root?.likes_received),
      topicsEntered: numberValue(root?.topics_entered),
      postsReadCount: numberValue(root?.posts_read_count),
      daysVisited: numberValue(root?.days_visited),
      topicCount: numberValue(root?.topic_count),
      postCount: numberValue(root?.post_count),
      timeRead: numberValue(root?.time_read),
      recentTimeRead: numberValue(root?.recent_time_read),
      bookmarkCount: numberValue(root?.bookmark_count),
      canSeeSummaryStats: booleanValue(root?.can_see_summary_stats),
      canSeeUserActions: booleanValue(root?.can_see_user_actions),
      topics: (Array.isArray(root?.topics) ? root.topics : []).map(summaryTopic).filter((item): item is LinuxDoUserSummaryTopic => Boolean(item)),
      replies: (Array.isArray(root?.replies) ? root.replies : []).flatMap((value: unknown): LinuxDoUserSummaryReply[] => {
        const reply = value as Json
        const topic = summaryTopic(reply?.topic)
        const postNumber = numberValue(reply?.post_number)
        if (!topic || postNumber === undefined) return []
        return [{
          postNumber,
          likeCount: numberValue(reply?.like_count),
          createdAt: typeof reply?.created_at === 'string' ? reply.created_at : undefined,
          topic,
        }]
      }),
      links: (Array.isArray(root?.links) ? root.links : []).flatMap((value: unknown): LinuxDoUserSummaryLink[] => {
        const link = value as Json
        const url = absoluteUrl(link?.url)
        if (!url) return []
        return [{
          url,
          title: typeof link?.title === 'string' ? link.title : undefined,
          clicks: numberValue(link?.clicks),
          postNumber: numberValue(link?.post_number),
          topic: summaryTopic(link?.topic),
        }]
      }),
      mostLikedByUsers: (Array.isArray(root?.most_liked_by_users) ? root.most_liked_by_users : []).map(summaryPerson).filter((item): item is LinuxDoUserSummaryPerson => Boolean(item)),
      mostLikedUsers: (Array.isArray(root?.most_liked_users) ? root.most_liked_users : []).map(summaryPerson).filter((item): item is LinuxDoUserSummaryPerson => Boolean(item)),
      mostRepliedToUsers: (Array.isArray(root?.most_replied_to_users) ? root.most_replied_to_users : []).map(summaryPerson).filter((item): item is LinuxDoUserSummaryPerson => Boolean(item)),
      topCategories: (Array.isArray(root?.top_categories) ? root.top_categories : []).map(summaryCategory).filter((item): item is LinuxDoUserSummaryCategory => Boolean(item)),
      badges: (Array.isArray(root?.badges) ? root.badges : []).map(userBadge).filter((item): item is LinuxDoUserBadge => Boolean(item)),
    }
  }

  async badges(username: string, options: ReadOptions = {}): Promise<LinuxDoUserBadge[]> {
    const payload = await this.api.getJson<Json>(linuxDoEndpoints.userBadges(username), { auth: 'optional', signal: options.signal })
    const list = Array.isArray(payload?.user_badges)
      ? payload.user_badges
      : Array.isArray(payload?.badges)
        ? payload.badges
        : []
    const badges = list.map(userBadge).filter((item): item is LinuxDoUserBadge => Boolean(item))
    const byBadgeId = new Map<number, LinuxDoUserBadge>()
    for (const badge of badges) {
      const key = badge.badgeId ?? badge.id
      const previous = byBadgeId.get(key)
      if (!previous) {
        byBadgeId.set(key, badge)
        continue
      }
      byBadgeId.set(key, {
        ...previous,
        count: Math.max(previous.count ?? 1, badge.count ?? 1),
        grantedAt: previous.grantedAt && badge.grantedAt
          ? (previous.grantedAt > badge.grantedAt ? previous.grantedAt : badge.grantedAt)
          : previous.grantedAt ?? badge.grantedAt,
        favorite: previous.favorite || badge.favorite,
      })
    }
    return Array.from(byBadgeId.values())
  }

  async activity(
    username: string,
    options: { offset?: number; filter?: LinuxDoUserActivityFilter; signal?: AbortSignal } = {},
  ): Promise<LinuxDoUserActivity> {
    const offset = options.offset ?? 0
    const filterId = options.filter && options.filter !== 'all' ? linuxDoUserActivityFilterId[options.filter] : undefined
    const payload = await this.api.getJson<Json>(
      linuxDoEndpoints.userActivity(username, offset, filterId),
      { auth: 'optional', signal: options.signal },
    )
    const rawActions = Array.isArray(payload?.user_actions) ? payload.user_actions : []
    const actions = rawActions.map(userAction).filter((item): item is LinuxDoUserAction => Boolean(item))
    const topicsPayload = { topic_list: { topics: payload?.topics ?? [] }, users: payload?.users ?? [] }
    const hasMore = rawActions.length >= USER_ACTION_BATCH_SIZE
    return {
      actions,
      topics: decodeTopics(topicsPayload),
      offset,
      nextOffset: hasMore ? offset + rawActions.length : undefined,
      hasMore,
    }
  }

  async boostsGiven(username: string, options: ReadOptions = {}): Promise<LinuxDoBoostListItem[]> {
    return this.boostList(linuxDoEndpoints.boostsGiven(username), options)
  }

  async boostsReceived(username: string, options: ReadOptions = {}): Promise<LinuxDoBoostListItem[]> {
    return this.boostList(linuxDoEndpoints.boostsReceived(username), options)
  }

  private async boostList(url: string, options: ReadOptions): Promise<LinuxDoBoostListItem[]> {
    const payload = await this.api.getJson<Json>(url, { auth: 'optional', signal: options.signal })
    const list = Array.isArray(payload?.boosts) ? payload.boosts : []
    return list.map((boost: Json): LinuxDoBoostListItem => ({
      id: Number(boost?.id ?? 0),
      raw: String(boost?.raw ?? ''),
      cooked: sanitizeLinuxDoCooked(typeof boost?.cooked === 'string' ? boost.cooked : ''),
      createdAt: typeof boost?.created_at === 'string' ? boost.created_at : undefined,
      postId: numberValue(boost?.post_id),
      user: boost?.user ? {
        id: Number(boost.user.id ?? 0),
        username: String(boost.user.username ?? ''),
        name: typeof boost.user.name === 'string' ? boost.user.name : undefined,
        avatarTemplate: absoluteAvatar(boost.user.avatar_template),
      } : undefined,
      post: boost?.post ? {
        id: Number(boost.post.id ?? 0),
        url: absoluteUrl(boost.post.url),
        excerpt: typeof boost.post.excerpt === 'string' ? boost.post.excerpt : undefined,
        username: typeof boost.post.username === 'string' ? boost.post.username : undefined,
        avatarTemplate: absoluteAvatar(boost.post.avatar_template),
        topicId: numberValue(boost.post.topic_id),
        topicTitle: typeof boost.post.topic_title === 'string' ? boost.post.topic_title : undefined,
        categoryId: numberValue(boost.post.category_id),
      } : undefined,
    })).filter((boost: LinuxDoBoostListItem) => boost.id > 0)
  }
}
