import type {
  LinuxDoBoost,
  LinuxDoCategory,
  LinuxDoNotification,
  LinuxDoPost,
  LinuxDoTopic,
  LinuxDoTopicSummary,
  LinuxDoUser,
} from '../types'
import { sanitizeLinuxDoCooked } from '../content/sanitize'

type Json = Record<string, any>

function tagName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized || /^\[object\s+Object\]$/i.test(normalized)) return undefined
    return normalized
  }
  if (!value || typeof value !== 'object') return undefined
  const tag = value as Json
  for (const candidate of [tag.name, tag.text, tag.id, tag.slug]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

export function decodeTagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names = value.map(tagName).filter((name): name is string => Boolean(name))
  return Array.from(new Set(names))
}

export function decodeLinuxDoAvatar(template: unknown): string | undefined {
  if (typeof template !== 'string' || !template.trim()) return undefined
  const raw = template.trim().replace('{size}', '96')
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw
  if (raw.startsWith('//')) return 'https:' + raw
  if (raw.startsWith('/')) return 'https://linux.do' + raw
  return 'https://linux.do/' + raw
}

export function decodeCurrentUser(input: unknown): LinuxDoUser | undefined {
  const root = input as Json
  const user = (root?.current_user ?? root?.user) as Json | undefined
  if (!user || typeof user.id !== 'number' || typeof user.username !== 'string') return undefined
  return {
    id: user.id,
    username: user.username,
    name: typeof user.name === 'string' ? user.name : undefined,
    avatarTemplate: decodeLinuxDoAvatar(user.avatar_template),
    trustLevel: typeof user.trust_level === 'number' ? user.trust_level : undefined,
    unreadNotifications: typeof user.unread_notifications === 'number' ? user.unread_notifications : undefined,
    allUnreadNotificationsCount: typeof user.all_unread_notifications_count === 'number' ? user.all_unread_notifications_count : undefined,
    canUseTemplates: typeof user.can_use_templates === 'boolean' ? user.can_use_templates : undefined,
  }
}

export function decodeTopics(input: unknown): LinuxDoTopicSummary[] {
  const root = input as Json
  const list = root?.topic_list?.topics
  const users = new Map<number, Json>()
  for (const user of Array.isArray(root?.users) ? root.users : []) if (typeof user?.id === 'number') users.set(user.id, user)
  if (!Array.isArray(list)) return []
  return list.filter(Boolean).map((topic: Json) => ({
    id: Number(topic.id),
    slug: String(topic.slug ?? ''),
    title: String(topic.title ?? ''),
    fancyTitle: typeof topic.fancy_title === 'string' ? topic.fancy_title : undefined,
    lastPosterUsername: typeof topic.last_poster_username === 'string' ? topic.last_poster_username : undefined,
    bumpedAt: typeof topic.bumped_at === 'string' ? topic.bumped_at : undefined,
    postsCount: Number(topic.posts_count ?? 0),
    replyCount: Number(topic.reply_count ?? Math.max(0, Number(topic.posts_count ?? 1) - 1)),
    views: Number(topic.views ?? 0),
    likeCount: Number(topic.like_count ?? 0),
    createdAt: String(topic.created_at ?? ''),
    lastPostedAt: String(topic.last_posted_at ?? topic.created_at ?? ''),
    categoryId: typeof topic.category_id === 'number' ? topic.category_id : undefined,
    tags: decodeTagNames(topic.tags),
    posters: Array.isArray(topic.posters) ? topic.posters.map((p: Json) => {
      const u = users.get(Number(p.user_id))
      return { userId: p.user_id, username: u?.username, avatarTemplate: decodeLinuxDoAvatar(u?.avatar_template), description: p.description }
    }) : [],
    unseen: Boolean(topic.unseen),
    unread: typeof topic.unread_posts === 'number'
      ? topic.unread_posts
      : typeof topic.unread === 'number'
        ? topic.unread
        : undefined,
    newPosts: typeof topic.new_posts === 'number' ? topic.new_posts : undefined,
    lastReadPostNumber: typeof topic.last_read_post_number === 'number'
      ? topic.last_read_post_number
      : topic.last_read_post_number === null
        ? null
        : undefined,
    highestPostNumber: typeof topic.highest_post_number === 'number' ? topic.highest_post_number : undefined,
    notificationLevel: typeof topic.notification_level === 'number' ? topic.notification_level : undefined,
    isSeen: typeof topic.is_seen === 'boolean' ? topic.is_seen : undefined,
    pinned: Boolean(topic.pinned),
    closed: Boolean(topic.closed),
    archived: Boolean(topic.archived),
  })).filter((topic: LinuxDoTopicSummary) => Number.isFinite(topic.id) && topic.id > 0)
}

export function decodeBoost(input: unknown): LinuxDoBoost | undefined {
  const boost = input as Json | undefined
  const user = boost?.user as Json | undefined
  const id = Number(boost?.id)
  if (!Number.isFinite(id) || id <= 0 || !user || typeof user.username !== 'string' || !user.username.trim()) return undefined
  return {
    id,
    cooked: sanitizeLinuxDoCooked(String(boost?.cooked ?? '')),
    canDelete: Boolean(boost?.can_delete),
    canFlag: Boolean(boost?.can_flag),
    user: {
      id: typeof user.id === 'number' ? user.id : undefined,
      username: user.username,
      name: typeof user.name === 'string' ? user.name : undefined,
      avatarTemplate: decodeLinuxDoAvatar(user.avatar_template),
    },
  }
}

export function decodePost(post: Json): LinuxDoPost {
  const replyToUser = post.reply_to_user as Json | undefined
  const currentUserReaction = post.current_user_reaction as Json | undefined
  return {
    id: Number(post.id),
    postNumber: Number(post.post_number ?? 0),
    username: String(post.username ?? ''),
    name: typeof post.name === 'string' ? post.name : undefined,
    avatarTemplate: decodeLinuxDoAvatar(post.avatar_template),
    createdAt: String(post.created_at ?? ''),
    updatedAt: typeof post.updated_at === 'string' ? post.updated_at : undefined,
    read: typeof post.read === 'boolean' ? post.read : undefined,
    cooked: sanitizeLinuxDoCooked(String(post.cooked ?? '')),
    raw: typeof post.raw === 'string' ? post.raw : undefined,
    replyToPostNumber: typeof post.reply_to_post_number === 'number' ? post.reply_to_post_number : undefined,
    replyToUser: replyToUser && typeof replyToUser.username === 'string' ? {
      id: typeof replyToUser.id === 'number' ? replyToUser.id : undefined,
      username: replyToUser.username,
      name: typeof replyToUser.name === 'string' ? replyToUser.name : undefined,
      avatarTemplate: decodeLinuxDoAvatar(replyToUser.avatar_template),
    } : undefined,
    reactions: Array.isArray(post.reactions)
      ? post.reactions.map((reaction: Json) => ({
        id: String(reaction.id ?? ''),
        type: String(reaction.type ?? 'emoji'),
        count: Number(reaction.count ?? 0),
      })).filter((reaction) => reaction.id && Number.isFinite(reaction.count) && reaction.count > 0)
      : [],
    currentUserReaction: currentUserReaction && typeof currentUserReaction.id === 'string' ? {
      id: currentUserReaction.id,
      type: String(currentUserReaction.type ?? 'emoji'),
      count: Number(currentUserReaction.count ?? 0),
    } : undefined,
    reactionUsersCount: typeof post.reaction_users_count === 'number' ? post.reaction_users_count : undefined,
    boosts: Array.isArray(post.boosts)
      ? post.boosts.map(decodeBoost).filter((boost): boost is LinuxDoBoost => Boolean(boost))
      : [],
    canBoost: Boolean(post.can_boost),
    topicId: typeof post.topic_id === 'number' ? post.topic_id : undefined,
    topicSlug: typeof post.topic_slug === 'string' ? post.topic_slug : typeof post.slug === 'string' ? post.slug : undefined,
    topicTitle: typeof post.topic_title === 'string' ? post.topic_title : typeof post.blurb === 'string' ? undefined : typeof post.title === 'string' ? post.title : undefined,
    yours: Boolean(post.yours),
    canEdit: Boolean(post.can_edit),
    canDelete: Boolean(post.can_delete),
    bookmarked: Boolean(post.bookmarked),
    bookmarkId: typeof post.bookmark_id === 'number' ? post.bookmark_id : undefined,
    bookmarkName: typeof post.bookmark_name === 'string' ? post.bookmark_name : undefined,
    bookmarkReminderAt: typeof post.bookmark_reminder_at === 'string' ? post.bookmark_reminder_at : undefined,
    actions: Array.isArray(post.actions_summary)
      ? post.actions_summary.map((a: Json) => ({ id: Number(a.id), count: Number(a.count ?? 0), acted: Boolean(a.acted), canAct: a.can_act !== false }))
      : [],
  }
}

export function decodeTopic(input: unknown): LinuxDoTopic {
  const root = input as Json
  const stream = root?.post_stream ?? {}
  return {
    id: Number(root.id),
    slug: String(root.slug ?? ''),
    title: String(root.title ?? ''),
    fancyTitle: typeof root.fancy_title === 'string' ? root.fancy_title : undefined,
    categoryId: typeof root.category_id === 'number' ? root.category_id : undefined,
    tags: decodeTagNames(root.tags),
    postsCount: Number(root.posts_count ?? 0),
    views: Number(root.views ?? 0),
    likeCount: Number(root.like_count ?? 0),
    createdAt: String(root.created_at ?? ''),
    lastPostedAt: String(root.last_posted_at ?? ''),
    lastReadPostNumber: typeof root.last_read_post_number === 'number'
      ? root.last_read_post_number
      : root.last_read_post_number === null
        ? null
        : undefined,
    highestPostNumber: typeof root.highest_post_number === 'number' ? root.highest_post_number : undefined,
    postStream: {
      stream: Array.isArray(stream.stream) ? stream.stream.map(Number) : [],
      posts: Array.isArray(stream.posts) ? stream.posts.map(decodePost) : [],
    },
    lastPosterUsername: typeof root.last_poster_username === 'string' ? root.last_poster_username : undefined,
    details: root.details ? {
      canCreatePost: Boolean(root.details.can_create_post),
      notificationLevel: typeof root.details.notification_level === 'number' ? root.details.notification_level : undefined,
      createdBy: root.details.created_by && typeof root.details.created_by.username === 'string' ? {
        username: root.details.created_by.username,
        name: typeof root.details.created_by.name === 'string' ? root.details.created_by.name : undefined,
      } : undefined,
    } : undefined,
  }
}

export function decodeCategories(input: unknown): LinuxDoCategory[] {
  const list = (input as Json)?.category_list?.categories
  if (!Array.isArray(list)) return []
  return list.map((c: Json) => ({
    id: Number(c.id),
    name: String(c.name ?? ''),
    slug: String(c.slug ?? ''),
    parentId: typeof c.parent_category_id === 'number' ? c.parent_category_id : undefined,
    color: typeof c.color === 'string' ? c.color : undefined,
    textColor: typeof c.text_color === 'string' ? c.text_color : undefined,
    topicCount: typeof c.topic_count === 'number' ? c.topic_count : undefined,
    description: typeof c.description_text === 'string' ? c.description_text : undefined,
  }))
}

function decodeNotificationData(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function notificationInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

export function decodeNotifications(input: unknown): LinuxDoNotification[] {
  const list = (input as Json)?.notifications
  if (!Array.isArray(list)) return []
  return list.flatMap((n: Json) => {
    const id = notificationInteger(n.id)
    if (!id) return []
    return [{
      id,
      actingUserAvatarTemplate: decodeLinuxDoAvatar(n.acting_user_avatar_template),
      actingUserName: typeof n.acting_user_name === 'string' ? n.acting_user_name : undefined,
      notificationType: Number(n.notification_type ?? 0),
      read: n.read === true,
      createdAt: String(n.created_at ?? ''),
      postNumber: notificationInteger(n.post_number),
      topicId: notificationInteger(n.topic_id),
      fancyTitle: typeof n.fancy_title === 'string' ? n.fancy_title : undefined,
      slug: typeof n.slug === 'string' ? n.slug : undefined,
      data: decodeNotificationData(n.data),
    }]
  })
}
