import { Loader2, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { linuxDoSearch } from '../runtime'
import type { LinuxDoPost, LinuxDoTopicSummary } from '../types'
import type { LinuxDoSearchCache, LinuxDoSearchTab } from './searchCache'
import { ago, avatar, readableError } from './utils'

export function SearchView({ onOpen, onOpenUser, cacheRef }: {
  onOpen: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string) => void
  cacheRef: MutableRefObject<LinuxDoSearchCache>
}) {
  const [state, setState] = useState(() => cacheRef.current)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [retryPage, setRetryPage] = useState(1)
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('newsnook-linuxdo-search-history') || '[]')
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 8) : []
    } catch { return [] }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const pendingRef = useRef('')
  const stateRef = useRef(state)
  stateRef.current = state
  const update = (patch: Partial<LinuxDoSearchCache>) => {
    const next = { ...stateRef.current, ...patch }
    stateRef.current = next
    cacheRef.current = next
    setState(next)
  }
  useLayoutEffect(() => { if (scrollerRef.current) scrollerRef.current.scrollTop = cacheRef.current.scrollTop }, [cacheRef])
  useEffect(() => () => { generationRef.current++; requestRef.current?.abort() }, [])

  const clear = () => {
    generationRef.current++; requestRef.current?.abort(); pendingRef.current = ''
    setLoading(false); setLoadingMore(false); setError('')
    update({ query: '', lastQuery: '', topics: [], posts: [], users: [], page: 1, hasMore: false, scrollTop: 0 })
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0
  }
  const run = async (nextPage = 1, searchTerm = stateRef.current.query) => {
    const normalized = searchTerm.trim()
    const requestKey = `${normalized}:${nextPage}`
    if (!normalized || pendingRef.current === requestKey) return
    if (nextPage > 1 && normalized !== stateRef.current.lastQuery) return
    requestRef.current?.abort()
    const controller = new AbortController(); requestRef.current = controller
    const generation = ++generationRef.current
    pendingRef.current = requestKey
    if (nextPage === 1) inputRef.current?.blur()
    update({ query: searchTerm })
    setLoading(nextPage === 1); setLoadingMore(nextPage > 1); setError(''); setRetryPage(nextPage)
    try {
      const result = await linuxDoSearch.search(normalized, nextPage, controller.signal)
      if (controller.signal.aborted || generation !== generationRef.current) return
      const previous = stateRef.current
      const merge = <T extends { id: number }>(old: T[], incoming: T[]) => {
        const byId = new Map(old.map(item => [item.id, item]))
        for (const item of incoming) byId.set(item.id, item)
        return [...byId.values()]
      }
      update({
        lastQuery: normalized, page: nextPage, hasMore: result.hasMore,
        topics: nextPage === 1 ? result.topics : merge(previous.topics, result.topics),
        posts: nextPage === 1 ? result.posts : merge(previous.posts, result.posts),
        users: nextPage === 1 ? result.users : merge(previous.users, result.users),
        ...(nextPage === 1 ? { scrollTop: 0 } : {}),
      })
      if (nextPage === 1) {
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
        const nextHistory = [normalized, ...history.filter(item => item !== normalized)].slice(0, 8)
        setHistory(nextHistory)
        try { localStorage.setItem('newsnook-linuxdo-search-history', JSON.stringify(nextHistory)) } catch { /* history is optional */ }
      }
    } catch (nextError) {
      if (!controller.signal.aborted && generation === generationRef.current) setError(readableError(nextError))
    } finally {
      if (generation === generationRef.current) { pendingRef.current = ''; setLoading(false); setLoadingMore(false) }
    }
  }
  const selectTab = (activeTab: LinuxDoSearchTab) => update({ activeTab })
  const { query, lastQuery, activeTab, topics, posts, users, hasMore, page } = state
  const visibleCount = activeTab === 'topics' ? topics.length : activeTab === 'posts' ? posts.length : users.length
  const openPost = (post: LinuxDoPost) => {
    if (!post.topicId) return
    const topic = topics.find(item => item.id === post.topicId) ?? { id: post.topicId, slug: post.topicSlug || 'topic', title: post.topicTitle || '搜索结果', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: post.createdAt, lastPostedAt: post.createdAt, tags: [], posters: [] }
    onOpen(topic, post.postNumber)
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-haze/50 bg-ink/95 page-x pb-3 pt-3 backdrop-blur-xl">
        <form onSubmit={event => { event.preventDefault(); void run() }} role="search">
          <div className="flex h-11 items-center gap-2 rounded-full border border-haze/70 bg-ink-raised pl-3.5 pr-1.5 focus-within:border-cinnabar/50">
            <Search size={16} className="shrink-0 text-paper-faint" aria-hidden />
            <input
              ref={inputRef}
              autoFocus={!lastQuery}
              type="search"
              enterKeyHint="search"
              aria-label="搜索主题、帖子、用户"
              value={query}
              onChange={event => update({ query: event.target.value })}
              placeholder="搜索主题、帖子、用户"
              className="min-w-0 flex-1 bg-transparent py-2 text-[16px] leading-none text-paper outline-none placeholder:text-paper-faint"
            />
            {query ? (
              <button type="button" onClick={clear} aria-label="清空搜索词" className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full text-paper-faint hover:bg-paper/5 hover:text-paper">
                <X size={15} />
              </button>
            ) : null}
            <button type="submit" className="linuxdo-control h-8 shrink-0 rounded-full bg-cinnabar px-3.5 text-[13px] font-medium text-white">
              搜索
            </button>
          </div>
          <div role="tablist" aria-label="搜索类型" className="mt-3 grid grid-cols-3 gap-0.5 rounded-full bg-paper/[0.045] p-1">
            {([['topics', '主题'], ['posts', '帖子'], ['users', '用户']] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => selectTab(tab)}
                className={'linuxdo-control h-9 rounded-full text-[13px] font-medium transition-colors ' + (activeTab === tab ? 'bg-ink-raised text-paper shadow-sm' : 'text-paper-muted')}
              >
                {label}
              </button>
            ))}
          </div>
        </form>
      </div>

      <div
        ref={scrollerRef}
        onScroll={event => { cacheRef.current.scrollTop = event.currentTarget.scrollTop; stateRef.current.scrollTop = event.currentTarget.scrollTop }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-6 pt-2"
      >
        {!lastQuery && history.length ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 px-0.5">
            <span className="text-[12px] font-medium text-paper-faint">最近</span>
            {history.map(item => (
              <button type="button" key={item} onClick={() => void run(1, item)} className="linuxdo-control h-8 max-w-[11rem] truncate rounded-full bg-paper/[0.05] px-3 text-[12.5px] text-paper-muted">
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setHistory([]); localStorage.removeItem('newsnook-linuxdo-search-history') }}
              className="linuxdo-control h-8 px-1.5 text-[12px] text-paper-faint"
            >
              清除
            </button>
          </div>
        ) : null}

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-[12px] text-paper-faint">
            <Loader2 size={15} className="animate-spin" />搜索中…
          </div>
        ) : null}

        {error ? (
          <button type="button" onClick={() => void run(retryPage)} className="linuxdo-control my-2 min-h-11 w-full rounded-2xl bg-cinnabar/10 px-3 py-3 text-[13px] text-cinnabar-soft">
            {error} · 点击重试
          </button>
        ) : null}

        <div role="tabpanel" aria-busy={loading || loadingMore} className="divide-y divide-haze/40">
          {activeTab === 'topics' ? topics.map(topic => {
            const match = posts.find(post => post.topicId === topic.id)
            return <SearchResultRow key={topic.id} topic={topic} post={match} onOpen={() => onOpen(topic, match?.postNumber)} />
          }) : null}
          {activeTab === 'posts' ? posts.map(post => (
            <SearchResultRow key={post.id} topic={topics.find(topic => topic.id === post.topicId)} post={post} onOpen={() => openPost(post)} />
          )) : null}
          {activeTab === 'users' ? users.map(user => (
            <button
              type="button"
              key={user.id}
              onClick={() => onOpenUser(user.username)}
              className="linuxdo-control flex min-h-[64px] w-full items-center gap-3 py-3 text-left active:bg-paper/[0.035]"
            >
              <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10">
                {avatar(user.avatarTemplate, user.username)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-medium leading-snug text-paper">{user.name || user.username}</span>
                <span className="mt-0.5 block text-[12.5px] text-paper-faint">@{user.username}</span>
              </span>
            </button>
          )) : null}
        </div>

        {!loading && !error && lastQuery && !visibleCount ? (
          <p className="py-16 text-center text-[13px] text-paper-muted">
            没有找到相关{activeTab === 'topics' ? '主题' : activeTab === 'posts' ? '帖子' : '用户'}，试试其他关键词
          </p>
        ) : null}
        {!lastQuery && !loading && !error && !history.length ? (
          <p className="py-16 text-center text-[13px] text-paper-muted">搜索社区主题、回复和成员</p>
        ) : null}
        {lastQuery && hasMore ? (
          <button
            type="button"
            disabled={loading || loadingMore || query.trim() !== lastQuery}
            onClick={() => void run(page + 1)}
            className="linuxdo-control mt-3 min-h-11 w-full rounded-full bg-paper/[0.045] text-[13px] text-paper-muted disabled:opacity-40"
          >
            {loadingMore ? '加载中…' : '加载更多结果'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SearchResultRow({ topic, post, onOpen }: { topic?: LinuxDoTopicSummary; post?: LinuxDoPost; onOpen: () => void }) {
  const author = post ?? topic?.posters[0]
  const title = topic?.title || post?.topicTitle || '搜索结果'
  const displayName = post?.name || author?.username || '作者信息暂缺'
  const showHandle = Boolean(post?.name && post.username && post.username !== post.name)
  return (
    <button
      type="button"
      aria-label={'打开搜索结果：' + title}
      disabled={!topic && !post?.topicId}
      onClick={onOpen}
      className="linuxdo-control flex w-full items-start gap-3 py-3.5 text-left active:bg-paper/[0.035] disabled:opacity-50"
    >
      <span className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-full bg-paper/5 ring-1 ring-black/5 dark:ring-white/10">
        {avatar(author?.avatarTemplate, author?.username)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] font-medium text-paper-muted">{displayName}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-paper-faint">{ago(post?.createdAt || topic?.lastPostedAt || '')}</span>
        </span>
        {showHandle ? <span className="mt-0.5 block text-[12px] text-paper-faint">@{post?.username}</span> : null}
        <span className="mt-1.5 line-clamp-2 text-[15px] font-medium leading-[1.35] tracking-[-0.01em] text-paper">{title}</span>
        {post?.cooked ? (
          <span
            className="mt-1.5 block line-clamp-2 text-[13px] leading-[1.45] text-paper-muted [&_b]:font-medium [&_b]:text-cinnabar-soft [&_mark]:bg-cinnabar/15 [&_.search-highlight]:font-medium [&_.search-highlight]:text-cinnabar-soft"
            dangerouslySetInnerHTML={{ __html: post.cooked }}
          />
        ) : null}
        <span className="mt-2 block text-[12px] text-paper-faint">
          {post ? `匹配楼层 #${post.postNumber}` : `${topic?.replyCount || 0} 条回复`}
        </span>
      </span>
    </button>
  )
}
