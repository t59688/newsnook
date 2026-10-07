import type { LinuxDoTopic, LinuxDoTopicSummary } from '../types'

export type LinuxDoTopicReadState = 'new' | 'unread' | 'read'

function positiveInteger(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : undefined
}

export function linuxDoHighestPostNumber(
  topic: Pick<LinuxDoTopicSummary, 'highestPostNumber' | 'postsCount'>,
): number {
  return positiveInteger(topic.highestPostNumber) ?? Math.max(1, Math.trunc(topic.postsCount || 1))
}

/**
 * Discourse's visual state is not equivalent to "has ever been opened":
 * - NEW: the topic has no read cursor yet and is still unseen.
 * - UNREAD: a tracked/watched topic has posts after last_read_post_number.
 * - READ: neither condition applies.
 *
 * List payloads can omit some tracking fields, so retain the server-provided
 * unseen/new_posts/unread_posts signals as authoritative fallbacks.
 */
export function linuxDoTopicReadState(
  topic: Pick<
    LinuxDoTopicSummary,
    | 'unseen'
    | 'unread'
    | 'newPosts'
    | 'lastReadPostNumber'
    | 'highestPostNumber'
    | 'postsCount'
    | 'notificationLevel'
    | 'isSeen'
  >,
): LinuxDoTopicReadState {
  const lastRead = topic.lastReadPostNumber
  const highest = linuxDoHighestPostNumber(topic)
  const unreadPosts = Math.max(0, Math.trunc(topic.unread ?? 0))
  const newPosts = Math.max(0, Math.trunc(topic.newPosts ?? 0))

  const notificationAllowsNew =
    topic.notificationLevel === undefined || topic.notificationLevel >= 2
  if (
    lastRead === null &&
    notificationAllowsNew &&
    (topic.unseen === true || topic.isSeen === false || newPosts > 0)
  ) {
    return 'new'
  }

  if (unreadPosts > 0) return 'unread'

  if (
    typeof lastRead === 'number' &&
    lastRead < highest &&
    (topic.notificationLevel ?? 0) >= 2
  ) {
    return 'unread'
  }

  if (notificationAllowsNew && (topic.unseen === true || newPosts > 0)) return 'new'
  return 'read'
}

export function linuxDoTopicHasUnreadIndicator(
  topic: Parameters<typeof linuxDoTopicReadState>[0],
): boolean {
  return linuxDoTopicReadState(topic) !== 'read'
}

/**
 * Capture the unread boundary from the list row before opening a topic.
 * A topic GET may already reflect a newer server read cursor/read flag, but the
 * detail view still needs to show which posts were unread at the moment the user
 * entered. The boundary is kept until /topics/timings is acknowledged locally.
 */
export function linuxDoOpeningUnreadFloor(
  topic: Parameters<typeof linuxDoTopicReadState>[0],
): number | undefined {
  if (linuxDoTopicReadState(topic) === 'read') return undefined

  if (typeof topic.lastReadPostNumber === 'number') {
    return Math.max(0, Math.trunc(topic.lastReadPostNumber))
  }
  if (topic.lastReadPostNumber === null) return 0

  const pending = Math.max(
    0,
    Math.trunc(topic.unread ?? 0),
    Math.trunc(topic.newPosts ?? 0),
  )
  if (pending > 0) {
    return Math.max(0, linuxDoHighestPostNumber(topic) - pending)
  }
  if (topic.unseen === true || topic.isSeen === false) return 0
  return undefined
}

/**
 * Apply a server-accepted /topics/timings acknowledgement to a cached list row.
 * We only advance the cursor monotonically. A regular (notification level < 2)
 * topic stops being NEW once any post has been read; tracked/watched topics keep
 * their unread indicator until the highest post is reached.
 */
export function applyLinuxDoReadProgress(
  topic: LinuxDoTopicSummary,
  highestSeen: number,
): LinuxDoTopicSummary {
  const seen = positiveInteger(highestSeen)
  if (!seen) return topic

  const highest = Math.max(linuxDoHighestPostNumber(topic), seen)
  const previousLastRead =
    typeof topic.lastReadPostNumber === 'number' ? topic.lastReadPostNumber : 0
  const lastRead = Math.max(previousLastRead, seen)
  const tracked =
    (topic.unread ?? 0) > 0 ||
    (topic.notificationLevel ?? 0) >= 2
  const remaining = tracked ? Math.max(0, highest - lastRead) : 0

  return {
    ...topic,
    unseen: false,
    isSeen: true,
    lastReadPostNumber: lastRead,
    highestPostNumber: highest,
    unread: remaining,
    newPosts: remaining,
  }
}

export function applyLinuxDoTopicReadProgress(
  topic: LinuxDoTopic,
  highestSeen: number,
): LinuxDoTopic {
  const seen = positiveInteger(highestSeen)
  if (!seen) return topic

  const highest = Math.max(
    positiveInteger(topic.highestPostNumber) ?? Math.max(1, topic.postsCount || 1),
    seen,
  )
  const previousLastRead =
    typeof topic.lastReadPostNumber === 'number' ? topic.lastReadPostNumber : 0

  return {
    ...topic,
    lastReadPostNumber: Math.max(previousLastRead, seen),
    highestPostNumber: highest,
  }
}
