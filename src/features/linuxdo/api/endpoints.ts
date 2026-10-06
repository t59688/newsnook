const ORIGIN = 'https://linux.do'

export const linuxDoEndpoints = {
  origin: ORIGIN,
  sessionCurrent: ORIGIN + '/session/current.json',
  csrf: ORIGIN + '/session/csrf.json',
  latest: (page = 0) => ORIGIN + '/latest.json?page=' + page,
  hot: (page = 0) => ORIGIN + '/hot.json?page=' + page,
  top: (page = 0, period?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'all') => {
    const params = new URLSearchParams({ page: String(page) })
    if (period) params.set('period', period)
    return ORIGIN + '/top.json?' + params.toString()
  },
  // Keep the standalone new tab distinct from Discourse's unified new + unread view.
  newTopics: (page = 0) => ORIGIN + '/new.json?page=' + page + '&subset=topics',
  unread: (page = 0) => ORIGIN + '/unread.json?page=' + page,
  posted: (page = 0) => ORIGIN + '/posted.json?page=' + page,
  read: (page = 0) => ORIGIN + '/read.json?page=' + page,
  bookmarkedTopics: (page = 0) => ORIGIN + '/bookmarks.json?page=' + page,
  categories: ORIGIN + '/categories.json',
  category: (slug: string, id: number, page = 0, order?: 'activity' | 'created' | 'posts' | 'views' | 'likes') => {
    const params = new URLSearchParams({ page: String(page) })
    if (order) params.set('order', order)
    return ORIGIN + '/c/' + encodeURIComponent(slug) + '/' + id + '.json?' + params.toString()
  },
  tags: ORIGIN + '/tags.json',
  tagSearch: (query: string, options: {
    limit?: number
    categoryId?: number
    selectedTagIds?: Array<string | number>
    selectedTags?: string[]
    forInput?: boolean
    prioritizeRecentTags?: boolean
  } = {}) => {
    const params = new URLSearchParams()
    params.set('q', query.trim())
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.categoryId !== undefined) params.set('categoryId', String(options.categoryId))
    if (options.forInput !== undefined) params.set('filterForInput', String(options.forInput))
    if (options.prioritizeRecentTags !== undefined) params.set('prioritizeRecentTags', String(options.prioritizeRecentTags))
    for (const id of options.selectedTagIds ?? []) params.append('selected_tag_ids[]', String(id))
    for (const tag of options.selectedTags ?? []) params.append('selected_tags[]', tag)
    return ORIGIN + '/tags/filter/search.json?' + params.toString()
  },
  tag: (tag: string, page = 0, order?: 'activity' | 'created' | 'posts' | 'views' | 'likes') => {
    const params = new URLSearchParams({ page: String(page) })
    if (order) params.set('order', order)
    return ORIGIN + '/tag/' + encodeURIComponent(tag) + '.json?' + params.toString()
  },
  topic: (slug: string, id: number, postNumber?: number) => ORIGIN + '/t/' + encodeURIComponent(slug) + '/' + id + (postNumber ? '/' + postNumber : '') + '.json',
  posts: (topicId: number, ids: number[]) =>
    ORIGIN + '/t/' + topicId + '/posts.json?' + ids.map((id) => 'post_ids[]=' + encodeURIComponent(String(id))).join('&'),
  search: (q: string, page = 1) => ORIGIN + '/search.json?q=' + encodeURIComponent(q) + '&page=' + page,
  searchUsers: (term: string) => ORIGIN + '/u/search/users.json?' + new URLSearchParams({ term: term.replace(/^@/, ''), limit: '20' }),
  user: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '.json',
  userSummary: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '/summary.json',
  userBadges: (username: string) => ORIGIN + '/user-badges/' + encodeURIComponent(username) + '.json',
  userActivity: (username: string, offset = 0, filter?: number) => {
    const params = new URLSearchParams({ username, offset: String(offset) })
    if (filter !== undefined) params.set('filter', String(filter))
    return ORIGIN + '/user_actions.json?' + params.toString()
  },
  notifications: (offset = 0, limit = 60, filter?: 'read' | 'unread') => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    if (filter) params.set('filter', filter)
    return ORIGIN + '/notifications.json?' + params.toString()
  },
  privateMessageMenu: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '/user-menu-private-messages.json',
  privateMessages: (username: string, page = 0, filter: 'inbox' | 'new' | 'unread' | 'sent' | 'archive' = 'inbox', groupName?: string) => {
    const params = page > 0 ? '?page=' + encodeURIComponent(String(page)) : ''
    const suffix = filter === 'inbox' ? '' : '-' + filter
    const user = encodeURIComponent(username)
    if (groupName) return ORIGIN + '/topics/private-messages-group/' + user + '/' + encodeURIComponent(groupName) + (filter === 'inbox' ? '' : '/' + filter) + '.json' + params
    return ORIGIN + '/topics/private-messages' + suffix + '/' + user + '.json' + params
  },
  markNotificationsRead: ORIGIN + '/notifications/mark-read',
  topicTimings: ORIGIN + '/topics/timings',
  postsCreate: ORIGIN + '/posts.json',
  post: (id: number) => ORIGIN + '/posts/' + id + '.json',
  postRaw: (id: number) => ORIGIN + '/posts/' + id + '/raw',
  postAction: ORIGIN + '/post_actions.json',
  postActionDelete: (id: number) => ORIGIN + '/post_actions/' + id + '.json',
  topicNotification: (id: number) => ORIGIN + '/t/' + id + '/notifications.json',
  bookmarks: ORIGIN + '/bookmarks.json',
  bookmarkDelete: (bookmarkId: number) => ORIGIN + '/bookmarks/' + bookmarkId + '.json',
  templates: ORIGIN + '/discourse_templates',
  templateUse: (templateId: number) => ORIGIN + '/discourse_templates/' + templateId + '/use',
  drafts: ORIGIN + '/drafts.json',
  draft: (key: string) => ORIGIN + '/drafts/' + encodeURIComponent(key) + '.json',
  uploads: ORIGIN + '/uploads.json',
  uploadLookupUrls: ORIGIN + '/uploads/lookup-urls.json',
  userBookmarks: (username: string) => ORIGIN + '/u/' + encodeURIComponent(username) + '/bookmarks.json',
  boostCreate: (postId: number) => ORIGIN + '/discourse-boosts/posts/' + postId + '/boosts.json',
  boost: (boostId: number) => ORIGIN + '/discourse-boosts/boosts/' + boostId + '.json',
  boostsGiven: (username: string) => ORIGIN + '/discourse-boosts/users/' + encodeURIComponent(username) + '/boosts-given.json',
  boostsReceived: (username: string) => ORIGIN + '/discourse-boosts/users/' + encodeURIComponent(username) + '/boosts-received.json',
} as const
