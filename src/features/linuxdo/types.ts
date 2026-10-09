export type LinuxDoFeedMode = 'latest' | 'hot' | 'new' | 'unread' | 'top' | 'posted' | 'read' | 'bookmarks'
export type LinuxDoTopicOrder = 'activity' | 'created' | 'posts' | 'views' | 'likes'

export interface LinuxDoUser {
  id: number
  username: string
  name?: string
  avatarTemplate?: string
  trustLevel?: number
  unreadNotifications?: number
  allUnreadNotificationsCount?: number
  canUseTemplates?: boolean
}

export interface LinuxDoCategory {
  id: number
  name: string
  slug: string
  parentId?: number
  color?: string
  textColor?: string
  topicCount?: number
  description?: string
}

export interface LinuxDoTag {
  id?: string | number
  name: string
  topicCount?: number
  disabled?: boolean
  disabledReason?: string
}

export interface LinuxDoTopicPage {
  items: LinuxDoTopicSummary[]
  hasMore: boolean
}

export interface LinuxDoTopicSummary {
  id: number
  slug: string
  title: string
  fancyTitle?: string
  lastPosterUsername?: string
  bumpedAt?: string
  postsCount: number
  replyCount: number
  views: number
  likeCount: number
  createdAt: string
  lastPostedAt: string
  categoryId?: number
  tags: string[]
  posters: Array<{ userId?: number; username?: string; avatarTemplate?: string; description?: string }>
  unseen?: boolean
  unread?: number
  newPosts?: number
  lastReadPostNumber?: number | null
  highestPostNumber?: number
  notificationLevel?: number
  isSeen?: boolean
  pinned?: boolean
  closed?: boolean
  archived?: boolean
}

export interface LinuxDoReplyTarget {
  id?: number
  username: string
  name?: string
  avatarTemplate?: string
}

export interface LinuxDoReaction {
  id: string
  type: string
  count: number
}

export interface LinuxDoBoostUser {
  id?: number
  username: string
  name?: string
  avatarTemplate?: string
}

export interface LinuxDoBoost {
  id: number
  cooked: string
  user: LinuxDoBoostUser
  canDelete?: boolean
  canFlag?: boolean
}

export interface LinuxDoPostDevice {
  model: string
  source: 'ios-app'
}

export interface LinuxDoPost {
  id: number
  postNumber: number
  username: string
  name?: string
  avatarTemplate?: string
  createdAt: string
  updatedAt?: string
  /** Discourse per-post timing state for the current account. */
  read?: boolean
  cooked: string
  raw?: string
  device?: LinuxDoPostDevice
  replyToPostNumber?: number
  replyToUser?: LinuxDoReplyTarget
  reactions?: LinuxDoReaction[]
  currentUserReaction?: LinuxDoReaction
  reactionUsersCount?: number
  boosts?: LinuxDoBoost[]
  canBoost?: boolean
  topicId?: number
  topicSlug?: string
  topicTitle?: string
  yours?: boolean
  canEdit?: boolean
  canDelete?: boolean
  bookmarked?: boolean
  bookmarkId?: number
  bookmarkName?: string
  bookmarkReminderAt?: string
  actions: Array<{ id: number; count?: number; acted?: boolean; canAct?: boolean }>
}

export interface LinuxDoTopic {
  id: number
  slug: string
  title: string
  fancyTitle?: string
  categoryId?: number
  tags: string[]
  postsCount: number
  views: number
  likeCount: number
  createdAt: string
  lastPostedAt: string
  lastReadPostNumber?: number | null
  highestPostNumber?: number
  postStream: { stream: number[]; posts: LinuxDoPost[] }
  lastPosterUsername?: string
  details?: {
    canCreatePost?: boolean
    notificationLevel?: number
    createdBy?: { username: string; name?: string }
  }
}

export interface LinuxDoNotification {
  actingUserName?: string
  actingUserAvatarTemplate?: string
  id: number
  notificationType: number
  read: boolean
  createdAt: string
  postNumber?: number
  topicId?: number
  fancyTitle?: string
  slug?: string
  data: Record<string, unknown>
}

export type LinuxDoAuthMode = 'user-api-key' | 'browser-session' | 'none'

export type LinuxDoErrorKind =
  | 'network'
  | 'auth-required'
  | 'forbidden'
  | 'browser-verification'
  | 'csrf'
  | 'rate-limited'
  | 'not-found'
  | 'validation'
  | 'server'
  | 'unknown'

export interface LinuxDoRequestDiagnostics {
  stage: 'csrf' | 'request' | 'session'
  method: string
  path: string
  status?: number
  transport?: 'native' | 'browser' | 'browser-firstparty' | 'web' | 'unknown'
  responsePath?: string
  contentType?: string
  cfMitigated?: string
  cfRay?: string
}

export class LinuxDoApiError extends Error {
  readonly diagnostics?: LinuxDoRequestDiagnostics
  readonly kind: LinuxDoErrorKind
  readonly status?: number
  readonly retryAfterSeconds?: number

  constructor(kind: LinuxDoErrorKind, message: string, status?: number, retryAfterSeconds?: number, diagnostics?: LinuxDoRequestDiagnostics) {
    super(message)
    this.name = 'LinuxDoApiError'
    this.kind = kind
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
    this.diagnostics = diagnostics
  }
}

export interface LinuxDoSessionSnapshot {
  authenticated: boolean
  authMode: LinuxDoAuthMode
  currentUser?: LinuxDoUser
  userAgent?: string
  apiVersion?: number
  expiresAt?: string
}

export interface LinuxDoCapabilities {
  boost: { available: boolean; endpoint?: string; reason?: string }
  drafts: boolean
  uploads: boolean
  bookmarks: boolean
}
