export const linuxDoSearchOrders = [
  { id: 'relevance', label: '相关性' },
  { id: 'latest', label: '最新帖子' },
  { id: 'likes', label: '赞最多' },
  { id: 'views', label: '浏览最多' },
  { id: 'latest_topic', label: '最新话题' },
  { id: 'read', label: '最近阅读', personal: true },
] as const
export type LinuxDoSearchOrder = (typeof linuxDoSearchOrders)[number]['id']
export const linuxDoSearchScopes = [
  { id: 'title', label: '仅标题' },
  { id: 'first', label: '仅首帖' },
  { id: 'pinned', label: '置顶' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'images', label: '含图片' },
  { id: 'posted', label: '我参与的', personal: true },
  { id: 'created', label: '我创建的', personal: true },
  { id: 'bookmarks', label: '已收藏', personal: true },
  { id: 'seen', label: '已读', personal: true },
  { id: 'unseen', label: '未读', personal: true },
  { id: 'likes', label: '我赞过的', personal: true },
] as const
export type LinuxDoSearchScope = (typeof linuxDoSearchScopes)[number]['id']
export interface LinuxDoSearchFilters {
  category: string
  tags: string
  allTags: boolean
  author: string
  scopes: LinuxDoSearchScope[]
  status: string
  after: string
  before: string
  minPosts: string
  maxPosts: string
  minViews: string
  maxViews: string
}
export interface LinuxDoSearchQuery {
  text: string
  filters: LinuxDoSearchFilters
  order: LinuxDoSearchOrder
}
export function emptyLinuxDoSearchFilters(): LinuxDoSearchFilters {
  return {
    category: '',
    tags: '',
    allTags: false,
    author: '',
    scopes: [],
    status: '',
    after: '',
    before: '',
    minPosts: '',
    maxPosts: '',
    minViews: '',
    maxViews: '',
  }
}
const numericKeys = {
  min_posts: 'minPosts',
  max_posts: 'maxPosts',
  min_views: 'minViews',
  max_views: 'maxViews',
} as const
const statuses = ['open', 'closed', 'archived', 'noreplies', 'single_user', 'solved', 'unsolved']
function dateValid(value: string): boolean {
  const date = new Date(value)
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  )
}
export function parseLinuxDoSearch(query: string): LinuxDoSearchQuery {
  const filters = emptyLinuxDoSearchFilters()
  let order: LinuxDoSearchOrder = 'relevance'
  const text: string[] = []
  // Quoted phrases stay intact; unknown directives remain editable in the input.
  const tokens = query.match(/(?:[^\s"]|"[^"]*"|")+/g) ?? []
  for (const token of tokens) {
    const match = token.match(
      /^(order|category|tags?|user|in|with|status|after|before|min_posts|max_posts|min_views|max_views):(.+)$/i
    )
    const key = match?.[1].toLowerCase()
    const value = match?.[2] ?? ''
    if (key === 'order' && linuxDoSearchOrders.some((item) => item.id === value))
      order = value as LinuxDoSearchOrder
    else if (key === 'category') filters.category = value.replace(/^"|"$/g, '')
    else if (key === 'tag' || key === 'tags') {
      filters.tags = value.split(/[+,]/).join(', ')
      filters.allTags = value.includes('+')
    } else if ((key === 'user' && /^[\w.-]+$/.test(value)) || /^@[\w.-]+$/.test(token))
      filters.author = key === 'user' ? value : token.slice(1)
    else if (
      (key === 'in' && linuxDoSearchScopes.some((item) => item.id === value && item.id !== 'images')) ||
      (key === 'with' && value === 'images')
    ) {
      if (!filters.scopes.includes(value as LinuxDoSearchScope))
        filters.scopes.push(value as LinuxDoSearchScope)
    } else if (key === 'status' && statuses.includes(value)) filters.status = value
    else if ((key === 'after' || key === 'before') && dateValid(value)) filters[key] = value
    else if (key && key in numericKeys && /^\d+$/.test(value))
      filters[numericKeys[key as keyof typeof numericKeys]] = value
    else text.push(token)
  }
  return { text: text.join(' '), filters, order }
}
export function buildLinuxDoSearch({ text, filters: f, order }: LinuxDoSearchQuery): string {
  if (f.author && !/^[\w.-]+$/.test(f.author)) throw new Error('作者用户名不能包含空格或搜索指令')
  if (f.category && /["\r\n]/.test(f.category)) throw new Error('分类格式无效')
  const tags = [...new Set(f.tags.split(/[,，+\s]+/).filter(Boolean))]
  if (tags.some((tag) => !/^[\p{L}\p{N}_-]+$/u.test(tag))) throw new Error('标签格式无效，请用逗号分隔')
  for (const [key, label] of [
    ['minPosts', '最少帖子数'],
    ['maxPosts', '最多帖子数'],
    ['minViews', '最少浏览量'],
    ['maxViews', '最多浏览量'],
  ] as const) {
    if (f[key] && (!/^\d+$/.test(f[key]) || !Number.isSafeInteger(Number(f[key]))))
      throw new Error(`${label}须为非负整数`)
  }
  if (f.minPosts && f.maxPosts && Number(f.minPosts) > Number(f.maxPosts))
    throw new Error('帖子数下限不能超过上限')
  if (f.minViews && f.maxViews && Number(f.minViews) > Number(f.maxViews))
    throw new Error('浏览量下限不能超过上限')
  if (
    (f.after && !dateValid(f.after)) ||
    (f.before && !dateValid(f.before)) ||
    (f.after && f.before && f.after >= f.before)
  )
    throw new Error('日期范围无效，结束日期须晚于开始日期')
  return [
    text.trim(),
    f.category && `category:${/\s/.test(f.category) ? `"${f.category}"` : f.category}`,
    tags.length && `tags:${tags.join(f.allTags ? '+' : ',')}`,
    f.author && `@${f.author}`,
    ...f.scopes.map((scope) => `${scope === 'images' ? 'with' : 'in'}:${scope}`),
    f.status && `status:${f.status}`,
    f.after && `after:${f.after}`,
    f.before && `before:${f.before}`,
    ...Object.entries(numericKeys).map(([key, field]) => f[field] && `${key}:${f[field]}`),
    order !== 'relevance' && `order:${order}`,
  ]
    .filter(Boolean)
    .join(' ')
}
export function linuxDoSearchFilterLabels(
  f: LinuxDoSearchFilters,
  categories: Record<number, { name: string }> = {}
): Array<{ key: keyof LinuxDoSearchFilters; label: string; scope?: LinuxDoSearchScope }> {
  return [
    ...(f.category
      ? [{ key: 'category' as const, label: `分类：${categories[Number(f.category)]?.name || f.category}` }]
      : []),
    ...(f.tags ? [{ key: 'tags' as const, label: `${f.allTags ? '全部标签' : '任一标签'}：${f.tags}` }] : []),
    ...(f.author ? [{ key: 'author' as const, label: `作者：@${f.author}` }] : []),
    ...f.scopes.map((scope) => ({
      key: 'scopes' as const,
      scope,
      label: linuxDoSearchScopes.find((item) => item.id === scope)!.label,
    })),
    ...(
      [
        ['status', '状态'],
        ['after', '晚于'],
        ['before', '早于'],
        ['minPosts', '最少帖子'],
        ['maxPosts', '最多帖子'],
        ['minViews', '最少浏览'],
        ['maxViews', '最多浏览'],
      ] as const
    )
      .filter(([key]) => f[key])
      .map(([key, label]) => ({ key, label: `${label}：${f[key]}` })),
  ]
}
