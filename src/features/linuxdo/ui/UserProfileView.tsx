import {
  Award,
  BookOpen,
  CalendarDays,
  ChevronRight,
  Clock3,
  Eye,
  FileText,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Rocket,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  linuxDoDiscovery as discovery,
  linuxDoPeople as peopleApi,
} from '../runtime'
import type {
  LinuxDoBoostListItem,
  LinuxDoUserAction,
  LinuxDoUserActivity,
  LinuxDoUserActivityFilter,
  LinuxDoUserProfile,
  LinuxDoUserSummary,
  LinuxDoUserSummaryReply,
  LinuxDoUserSummaryTopic,
} from '../people/service'
import type { LinuxDoCategory, LinuxDoTopicSummary } from '../types'
import { ago, avatar, compact, readableError, tagGlyph } from './utils'

export type UserProfileTab = 'overview' | 'activity' | 'topics' | 'replies' | 'likes' | 'boosts' | 'responses' | 'badges'
type ActivityTab = Extract<UserProfileTab, 'activity' | 'topics' | 'replies' | 'likes' | 'responses'>
type BoostMode = 'received' | 'given'

interface ActivityCacheEntry {
  items: LinuxDoUserAction[]
  nextOffset?: number
  hasMore: boolean
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  error: string
}

const profileTabs: Array<{ id: UserProfileTab; label: string; icon: typeof UserRound }> = [
  { id: 'overview', label: '概览', icon: UserRound },
  { id: 'activity', label: '所有', icon: Sparkles },
  { id: 'topics', label: '话题', icon: FileText },
  { id: 'replies', label: '回复', icon: MessageCircle },
  { id: 'likes', label: '赞', icon: Heart },
  { id: 'boosts', label: 'Boosts', icon: Rocket },
  { id: 'responses', label: '回应', icon: Sparkles },
  { id: 'badges', label: '徽章', icon: Award },
]

const activityFilter: Record<ActivityTab, LinuxDoUserActivityFilter> = {
  activity: 'all',
  topics: 'topics',
  replies: 'replies',
  likes: 'likes',
  responses: 'responses',
}

function emptyActivity(): ActivityCacheEntry {
  return {
    items: [],
    hasMore: false,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: '',
  }
}

function metric(value: number | undefined): string {
  return value === undefined ? '—' : compact(value)
}

function duration(seconds: number | undefined): string {
  if (seconds === undefined) return '—'
  if (seconds < 60) return seconds + '秒'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes + '分钟'
  const hours = Math.round(minutes / 6) / 10
  return hours + '小时'
}

function dateLabel(value?: string): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function summaryToTopic(topic: LinuxDoUserSummaryTopic): LinuxDoTopicSummary {
  return {
    id: topic.id,
    slug: topic.slug || 'topic',
    title: topic.title,
    postsCount: topic.postsCount ?? 0,
    replyCount: Math.max(0, (topic.postsCount ?? 1) - 1),
    views: 0,
    likeCount: topic.likeCount ?? 0,
    createdAt: topic.createdAt ?? '',
    lastPostedAt: topic.createdAt ?? '',
    categoryId: topic.categoryId,
    tags: [],
    posters: [],
  }
}

function actionToTopic(action: LinuxDoUserAction): LinuxDoTopicSummary | undefined {
  if (!action.topicId) return undefined
  return {
    id: action.topicId,
    slug: action.slug || 'topic',
    title: action.title || 'Linux.do 主题',
    postsCount: 0,
    replyCount: 0,
    views: 0,
    likeCount: 0,
    createdAt: action.createdAt || '',
    lastPostedAt: action.createdAt || '',
    categoryId: action.categoryId,
    tags: [],
    posters: [],
  }
}

function InlineStatus({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="rounded-2xl border border-haze/70 bg-ink-raised/45 px-4 py-4 text-center">
      <p className="text-[12px] leading-5 text-paper-muted">{message}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="linuxdo-control mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-haze px-3.5 py-1.5 text-[11px] font-medium text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-paper"
        >
          <RefreshCcw size={12} />
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="page-x py-4" role="status" aria-label="正在加载用户资料">
      <div className="rounded-[22px] border border-haze/60 bg-ink-raised/40 p-4">
        <div className="flex items-center gap-3">
          <div className="linuxdo-skeleton h-14 w-14 rounded-full" />
          <div className="flex-1">
            <div className="linuxdo-skeleton h-4 w-28 rounded" />
            <div className="linuxdo-skeleton mt-2 h-3 w-20 rounded" />
          </div>
        </div>
        <div className="linuxdo-skeleton mt-4 h-3 w-[90%] rounded" />
        <div className="linuxdo-skeleton mt-2 h-3 w-[72%] rounded" />
        <div className="mt-4 grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="linuxdo-skeleton h-14 rounded-xl" />)}
        </div>
      </div>
    </div>
  )
}

function SummaryTopicCard({
  topic,
  category,
  onOpen,
}: {
  topic: LinuxDoUserSummaryTopic
  category?: LinuxDoCategory
  onOpen: () => void
}) {
  const glyph = category ? tagGlyph(category.name) : ''
  return (
    <button
      type="button"
      onClick={onOpen}
      className="linuxdo-control group flex w-full items-start gap-3 rounded-2xl border border-haze/55 bg-ink-raised/35 px-3.5 py-3 text-left transition-all hover:border-cinnabar/25 hover:bg-ink-raised/55 active:scale-[0.995]"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-paper/[0.045] text-cinnabar-soft">
        <FileText size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-[1.42] text-paper">{topic.title}</span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-paper-faint">
          {category ? <span>{glyph ? glyph + ' ' : ''}{category.name}</span> : null}
          {topic.likeCount !== undefined ? <span className="inline-flex items-center gap-1"><Heart size={10} />{topic.likeCount}</span> : null}
          {topic.createdAt ? <span>{ago(topic.createdAt)}</span> : null}
        </span>
      </span>
      <ChevronRight size={14} className="mt-2 shrink-0 text-paper-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

function SummaryReplyCard({
  reply,
  onOpen,
}: {
  reply: LinuxDoUserSummaryReply
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="linuxdo-control group flex w-full items-start gap-3 rounded-2xl border border-haze/55 bg-ink-raised/35 px-3.5 py-3 text-left transition-all hover:border-cinnabar/25 hover:bg-ink-raised/55 active:scale-[0.995]"
    >
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-paper/[0.045] text-paper-muted">
        <MessageCircle size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-[1.42] text-paper">{reply.topic.title}</span>
        <span className="mt-1.5 flex items-center gap-2 text-[9.5px] text-paper-faint">
          <span>#{reply.postNumber}</span>
          {reply.likeCount !== undefined ? <span className="inline-flex items-center gap-1"><Heart size={10} />{reply.likeCount}</span> : null}
          {reply.createdAt ? <span>{ago(reply.createdAt)}</span> : null}
        </span>
      </span>
      <ChevronRight size={14} className="mt-2 shrink-0 text-paper-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  )
}

function ActivityCard({
  action,
  category,
  tab,
  onOpen,
  onOpenUser,
}: {
  action: LinuxDoUserAction
  category?: LinuxDoCategory
  tab: ActivityTab
  onOpen?: () => void
  onOpenUser: (username: string) => void
}) {
  const actorDriven = tab === 'likes' || tab === 'responses' || (tab === 'activity' && (action.actionType === 1 || action.actionType === 6))
  const actor = actorDriven ? (action.actingUsername || action.username) : action.username
  const actorAvatar = actorDriven ? (action.actingAvatarTemplate || action.avatarTemplate) : action.avatarTemplate
  const semantic = tab === 'activity'
    ? action.actionType === 1
      ? (action.username && action.username !== actor ? '赞了 @' + action.username + ' 的帖子' : '赞了这个帖子')
      : action.actionType === 4
        ? '发布话题'
        : action.actionType === 5
          ? '回复'
          : action.actionType === 6
            ? '收到回应'
            : '社区动态'
    : tab === 'likes'
      ? (action.username && action.username !== actor ? '赞了 @' + action.username + ' 的帖子' : '赞了这个帖子')
      : tab === 'responses'
        ? '回应了这位用户'
        : tab === 'replies'
          ? '回复'
          : '发布话题'

  return (
    <article className="rounded-2xl border border-haze/55 bg-ink-raised/35 px-3.5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.025)]">
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          disabled={!actor}
          onClick={() => actor && onOpenUser(actor)}
          className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-haze bg-paper/5 disabled:pointer-events-none"
        >
          {avatar(actorAvatar, actor)}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {actor ? (
              <button
                type="button"
                onClick={() => onOpenUser(actor)}
                className="linuxdo-control max-w-full truncate text-[11.5px] font-semibold text-paper hover:text-cinnabar-soft"
              >
                @{actor}
              </button>
            ) : null}
            <span className="text-[9.5px] text-paper-faint">{semantic}</span>
          </div>
          {action.createdAt ? <div className="mt-0.5 text-[9px] text-paper-faint">{ago(action.createdAt)}</div> : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label="打开帖子"
            className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper"
          >
            <ChevronRight size={15} />
          </button>
        ) : null}
      </div>
      {action.title ? (
        <button
          type="button"
          disabled={!onOpen}
          onClick={onOpen}
          className="linuxdo-control mt-2.5 block w-full text-left disabled:pointer-events-none"
        >
          <span className="line-clamp-2 text-[13.5px] font-semibold leading-[1.45] text-paper">{action.title}</span>
        </button>
      ) : null}
      {action.excerpt ? (
        <div
          className="linuxdo-post-prose reader-prose mt-2 line-clamp-4 select-text text-[11.5px] leading-[1.65] text-paper-muted"
          dangerouslySetInnerHTML={{ __html: action.excerpt }}
        />
      ) : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9.5px] text-paper-faint">
        {category ? <span>{tagGlyph(category.name) ? tagGlyph(category.name) + ' ' : ''}{category.name}</span> : null}
        {action.postNumber ? <span>#{action.postNumber}</span> : null}
        {(tab === 'responses' || (tab === 'activity' && action.actionType === 6)) && action.targetUsername ? <span>回应 @{action.targetUsername}</span> : null}
      </div>
    </article>
  )
}

function BoostCard({
  item,
  onOpen,
  onOpenUser,
}: {
  item: LinuxDoBoostListItem
  onOpen?: () => void
  onOpenUser: (username: string) => void
}) {
  const who = item.user?.username || item.post?.username
  const whoAvatar = item.user?.avatarTemplate || item.post?.avatarTemplate
  return (
    <article className="rounded-2xl border border-haze/55 bg-ink-raised/35 px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        {who ? (
          <button
            type="button"
            onClick={() => onOpenUser(who)}
            className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-haze bg-paper/5"
          >
            {avatar(whoAvatar, who)}
          </button>
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/5 text-cinnabar-soft"><Rocket size={13} /></span>
        )}
        <div className="min-w-0 flex-1">
          {item.post?.topicTitle ? (
            <button
              type="button"
              disabled={!onOpen}
              onClick={onOpen}
              className="linuxdo-control line-clamp-2 text-left text-[12.5px] font-semibold text-paper disabled:pointer-events-none"
            >
              {item.post.topicTitle}
            </button>
          ) : <div className="text-[12px] font-medium text-paper">Boost</div>}
          <div className="mt-0.5 text-[9px] text-paper-faint">{who ? '@' + who : 'Linux.do'}{item.createdAt ? ' · ' + ago(item.createdAt) : ''}</div>
        </div>
        {onOpen ? <button type="button" onClick={onOpen} className="linuxdo-control grid h-8 w-8 place-items-center rounded-full text-paper-faint"><ChevronRight size={14} /></button> : null}
      </div>
      {item.raw ? <div className="mt-2.5 select-text text-[12px] leading-[1.65] text-paper-muted">{item.raw}</div> : null}
      {item.post?.excerpt ? <div className="mt-2 line-clamp-3 select-text text-[10.5px] leading-5 text-paper-faint">{item.post.excerpt}</div> : null}
    </article>
  )
}

export function UserProfileView({
  username,
  initialTab = 'overview',
  initialBadgeId,
  onOpenTopic,
  onOpenUser,
}: {
  username: string
  initialTab?: UserProfileTab
  initialBadgeId?: number
  onOpenTopic: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenUser: (username: string) => void
}) {
  const [profile, setProfile] = useState<LinuxDoUserProfile | null>(null)
  const [summary, setSummary] = useState<LinuxDoUserSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [activeTab, setActiveTab] = useState<UserProfileTab>(initialTab)
  const [activities, setActivities] = useState<Partial<Record<ActivityTab, ActivityCacheEntry>>>({})
  const [boostMode, setBoostMode] = useState<BoostMode>('received')
  const [boostsReceived, setBoostsReceived] = useState<LinuxDoBoostListItem[]>([])
  const [boostsGiven, setBoostsGiven] = useState<LinuxDoBoostListItem[]>([])
  const [boostReceivedLoaded, setBoostReceivedLoaded] = useState(false)
  const [boostGivenLoaded, setBoostGivenLoaded] = useState(false)
  const [boostLoading, setBoostLoading] = useState(false)
  const [boostReceivedError, setBoostReceivedError] = useState('')
  const [boostGivenError, setBoostGivenError] = useState('')
  const [badges, setBadges] = useState<LinuxDoUserSummary['badges']>([])
  const [badgesLoaded, setBadgesLoaded] = useState(false)
  const [badgesLoading, setBadgesLoading] = useState(false)
  const [badgesError, setBadgesError] = useState('')
  const [categoriesById, setCategoriesById] = useState<Record<number, LinuxDoCategory>>({})
  const generationRef = useRef(0)
  const targetBadgeRef = useRef<HTMLElement | null>(null)

  const loadHeader = useCallback(() => {
    const generation = ++generationRef.current
    const controller = new AbortController()
    setLoading(true)
    setProfile(null)
    setSummary(null)
    setProfileError('')
    setSummaryError('')
    setActiveTab(initialTab)
    setActivities({})
    setBoostsReceived([])
    setBoostsGiven([])
    setBoostReceivedLoaded(false)
    setBoostGivenLoaded(false)
    setBoostReceivedError('')
    setBoostGivenError('')
    setBadges([])
    setBadgesLoaded(false)
    setBadgesLoading(false)
    setBadgesError('')

    const profileRequest = peopleApi.profile(username, { signal: controller.signal }).then((next) => {
      if (generation === generationRef.current) setProfile(next)
    }).catch((error) => {
      if (generation !== generationRef.current) return
      if (!(error instanceof DOMException && error.name === 'AbortError')) setProfileError(readableError(error))
    })
    const summaryRequest = peopleApi.summary(username, { signal: controller.signal }).then((next) => {
      if (generation === generationRef.current) setSummary(next)
    }).catch((error) => {
      if (generation !== generationRef.current) return
      if (!(error instanceof DOMException && error.name === 'AbortError')) setSummaryError(readableError(error))
    })

    void Promise.allSettled([profileRequest, summaryRequest]).finally(() => {
      if (generation === generationRef.current) setLoading(false)
    })

    return () => controller.abort()
  }, [initialTab, username])

  useEffect(() => loadHeader(), [loadHeader])

  useEffect(() => {
    if (!summary?.topCategories.length) return
    setCategoriesById((previous) => ({
      ...previous,
      ...Object.fromEntries(summary.topCategories.map((category) => [category.id, {
        id: category.id,
        name: category.name,
        slug: category.slug,
        color: category.color,
        textColor: category.textColor,
        topicCount: category.topicCount,
      }])),
    }))
  }, [summary])

  const ensureCategories = useCallback(() => {
    if (Object.keys(categoriesById).length > 8) return
    void discovery.categories().then((categories) => {
      setCategoriesById((previous) => ({ ...previous, ...Object.fromEntries(categories.map((category) => [category.id, category])) }))
    }).catch(() => undefined)
  }, [categoriesById])

  const loadActivity = useCallback(async (tab: ActivityTab, append = false) => {
    const current = activities[tab] ?? emptyActivity()
    if ((append && !current.nextOffset) || current.loading || current.loadingMore) return
    const generation = generationRef.current
    const offset = append ? current.nextOffset ?? 0 : 0
    setActivities((previous) => ({
      ...previous,
      [tab]: {
        ...(previous[tab] ?? emptyActivity()),
        loading: !append,
        loadingMore: append,
        error: '',
      },
    }))
    ensureCategories()
    try {
      const result: LinuxDoUserActivity = await peopleApi.activity(username, { offset, filter: activityFilter[tab] })
      if (generation !== generationRef.current) return
      setActivities((previous) => {
        const old = previous[tab] ?? emptyActivity()
        const incoming = result.actions.filter((item) => !append || !old.items.some((existing) => existing.postId === item.postId && existing.actionType === item.actionType && existing.createdAt === item.createdAt))
        return {
          ...previous,
          [tab]: {
            items: append ? old.items.concat(incoming) : incoming,
            nextOffset: result.nextOffset,
            hasMore: result.hasMore,
            loaded: true,
            loading: false,
            loadingMore: false,
            error: '',
          },
        }
      })
    } catch (error) {
      if (generation !== generationRef.current) return
      setActivities((previous) => ({
        ...previous,
        [tab]: {
          ...(previous[tab] ?? emptyActivity()),
          loaded: true,
          loading: false,
          loadingMore: false,
          error: readableError(error),
        },
      }))
    }
  }, [activities, ensureCategories, username])

  const loadBoosts = useCallback(async (force = false) => {
    if (boostLoading || (!force && boostReceivedLoaded && boostGivenLoaded)) return
    const generation = generationRef.current
    setBoostLoading(true)
    setBoostReceivedError('')
    setBoostGivenError('')
    const [received, given] = await Promise.allSettled([
      peopleApi.boostsReceived(username),
      peopleApi.boostsGiven(username),
    ])
    if (generation !== generationRef.current) return
    if (received.status === 'fulfilled') {
      setBoostsReceived(received.value)
      setBoostReceivedLoaded(true)
    } else {
      setBoostReceivedError(readableError(received.reason))
      setBoostReceivedLoaded(true)
    }
    if (given.status === 'fulfilled') {
      setBoostsGiven(given.value)
      setBoostGivenLoaded(true)
    } else {
      setBoostGivenError(readableError(given.reason))
      setBoostGivenLoaded(true)
    }
    setBoostLoading(false)
  }, [boostGivenLoaded, boostLoading, boostReceivedLoaded, username])

  const loadBadges = useCallback(async (force = false) => {
    if (badgesLoading || (!force && badgesLoaded)) return
    const generation = generationRef.current
    setBadgesLoading(true)
    setBadgesError('')
    try {
      const next = await peopleApi.badges(username)
      if (generation !== generationRef.current) return
      setBadges(next)
      setBadgesLoaded(true)
    } catch (error) {
      if (generation !== generationRef.current) return
      setBadgesError(readableError(error))
      setBadgesLoaded(true)
    } finally {
      if (generation === generationRef.current) setBadgesLoading(false)
    }
  }, [badgesLoaded, badgesLoading, username])

  useEffect(() => {
    if (activeTab === 'activity' || activeTab === 'topics' || activeTab === 'replies' || activeTab === 'likes' || activeTab === 'responses') {
      const state = activities[activeTab]
      if (!state?.loaded && !state?.loading) void loadActivity(activeTab)
    } else if (activeTab === 'boosts' && !boostReceivedLoaded && !boostGivenLoaded) {
      void loadBoosts()
    } else if (activeTab === 'badges' && !badgesLoaded) {
      void loadBadges()
    }
  }, [activeTab, activities, badgesLoaded, boostGivenLoaded, boostReceivedLoaded, loadActivity, loadBadges, loadBoosts])

  const summaryCategories = useMemo(() => summary?.topCategories ?? [], [summary])
  const visibleBadges = useMemo(() => {
    const merged = new Map<number, LinuxDoUserSummary['badges'][number]>()
    for (const badge of summary?.badges ?? []) merged.set(badge.badgeId ?? badge.id, badge)
    for (const badge of badges) {
      const key = badge.badgeId ?? badge.id
      merged.set(key, { ...merged.get(key), ...badge })
    }
    return Array.from(merged.values())
  }, [badges, summary])

  useEffect(() => {
    if (activeTab !== 'badges' || !initialBadgeId || !badgesLoaded) return
    const frame = window.requestAnimationFrame(() => {
      targetBadgeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, badgesLoaded, initialBadgeId, visibleBadges])

  const openSummaryReply = (reply: LinuxDoUserSummaryReply) => {
    onOpenTopic(summaryToTopic(reply.topic), reply.postNumber)
  }

  const openAction = (action: LinuxDoUserAction) => {
    const topic = actionToTopic(action)
    if (!topic) return
    onOpenTopic(topic, action.postNumber)
  }

  const openBoostPost = (item: LinuxDoBoostListItem) => {
    const post = item.post
    if (!post?.topicId) return
    let slug = 'topic'
    let postNumber: number | undefined
    if (post.url) {
      try {
        const parsed = new URL(post.url, 'https://linux.do')
        const match = parsed.pathname.match(/^\/t\/([^/]+)\/(\d+)(?:\/(\d+))?/)
        if (match) {
          slug = match[1] || slug
          postNumber = match[3] ? Number(match[3]) : undefined
        }
      } catch {
        // Fall back to topic id/title from the plugin payload.
      }
    }
    onOpenTopic({
      id: post.topicId,
      slug,
      title: post.topicTitle || 'Linux.do 主题',
      postsCount: 0,
      replyCount: 0,
      views: 0,
      likeCount: 0,
      createdAt: item.createdAt || '',
      lastPostedAt: item.createdAt || '',
      tags: [],
      posters: [],
    }, postNumber)
  }

  if (loading && !profile) return <ProfileSkeleton />

  if (!profile) {
    return (
      <div className="page-x py-16">
        <InlineStatus message={profileError || '用户资料暂时无法加载'} actionLabel="重新加载" onAction={() => loadHeader()} />
      </div>
    )
  }

  const summaryMetrics = [
    { label: '主题', value: summary?.topicCount, icon: FileText },
    { label: '帖子', value: summary?.postCount, icon: MessageCircle },
    { label: '获赞', value: summary?.likesReceived, icon: Heart },
    { label: '送出赞', value: summary?.likesGiven, icon: Sparkles },
  ]

  const detailMetrics = [
    { label: '浏览主题', value: summary?.topicsEntered, icon: Eye, format: metric },
    { label: '阅读帖子', value: summary?.postsReadCount, icon: BookOpen, format: metric },
    { label: '访问天数', value: summary?.daysVisited, icon: CalendarDays, format: metric },
    { label: '阅读时长', value: summary?.timeRead, icon: Clock3, format: duration },
  ]

  const currentActivity = activeTab === 'activity' || activeTab === 'topics' || activeTab === 'replies' || activeTab === 'likes' || activeTab === 'responses'
    ? activities[activeTab] ?? emptyActivity()
    : null
  const currentBoosts = boostMode === 'received' ? boostsReceived : boostsGiven
  const currentBoostLoaded = boostMode === 'received' ? boostReceivedLoaded : boostGivenLoaded
  const currentBoostError = boostMode === 'received' ? boostReceivedError : boostGivenError

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-5 pt-3">
      <section className="overflow-hidden rounded-[22px] border border-haze/60 bg-ink-raised/45 shadow-[0_8px_30px_-24px_rgba(0,0,0,0.35)]">
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-3.5">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full border border-haze bg-paper/5 ring-2 ring-paper/[0.025] sm:h-16 sm:w-16">
              {avatar(profile.avatarTemplate, profile.username)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[18px] font-bold tracking-[-0.02em] text-paper sm:text-[20px]">{profile.name || profile.username}</h2>
                {profile.trustLevel !== undefined ? <span className="shrink-0 rounded-full border border-haze bg-paper/[0.035] px-2 py-0.5 font-mono text-[9px] font-semibold text-paper-faint">TL{profile.trustLevel}</span> : null}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-paper-faint">@{profile.username}{profile.title ? ' · ' + profile.title : ''}</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-paper-faint">
                {profile.createdAt ? <span>加入于 {dateLabel(profile.createdAt)}</span> : null}
                {profile.lastSeenAt ? <span>最近活跃 {ago(profile.lastSeenAt)}</span> : null}
                {profile.location ? <span>{profile.location}</span> : null}
              </div>
            </div>
          </div>

          {profile.bioCooked ? <div className="linuxdo-post-prose reader-prose mt-3.5 select-text text-[12px] leading-[1.72] text-paper-muted" dangerouslySetInnerHTML={{ __html: profile.bioCooked }} /> : null}

          <div className="mt-4 grid grid-cols-4 gap-1.5 sm:gap-2">
            {summaryMetrics.map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl border border-haze/45 bg-paper/[0.03] px-1.5 py-2.5 text-center">
                <Icon size={12} className="mx-auto mb-1 text-paper-faint" />
                <div className="font-mono text-[13px] font-semibold text-paper">{metric(value)}</div>
                <div className="mt-0.5 text-[8.5px] text-paper-faint">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-haze/50 sm:grid-cols-4">
          {detailMetrics.map(({ label, value, icon: Icon, format }) => (
            <div key={label} className="flex items-center gap-2 border-b border-haze/40 px-3 py-2.5 last:border-b-0 odd:border-r sm:border-b-0 sm:border-r sm:last:border-r-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-paper/[0.035] text-paper-faint"><Icon size={12} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[8.5px] text-paper-faint">{label}</span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] font-medium text-paper-muted">{format(value)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {loading && !summary && !summaryError ? <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-haze/45 bg-paper/[0.025] px-3 py-2 text-[9.5px] text-paper-faint" role="status"><Loader2 size={12} className="animate-spin" />正在加载公开统计与摘要</div> : null}

      {summaryError ? (
        <div className="mt-3">
          <InlineStatus
            message={'公开统计加载失败：' + summaryError}
            actionLabel="重试统计"
            onAction={() => {
              const generation = generationRef.current
              setSummaryError('')
              setLoading(true)
              void peopleApi.summary(username).then((next) => {
                if (generation === generationRef.current) setSummary(next)
              }).catch((error) => {
                if (generation === generationRef.current) setSummaryError(readableError(error))
              }).finally(() => {
                if (generation === generationRef.current) setLoading(false)
              })
            }}
          />
        </div>
      ) : null}

      <div className="sticky top-0 z-20 -mx-1 mt-3 border-y border-haze/45 bg-ink/95 px-1 py-2 backdrop-blur-xl">
        <div className="scrollbar-none flex gap-1 overflow-x-auto">
          {profileTabs.map((tab) => {
            const Icon = tab.icon
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={'linuxdo-control inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium transition-all ' + (active ? 'bg-cinnabar text-white shadow-sm' : 'text-paper-muted hover:bg-paper/5 hover:text-paper')}
              >
                <Icon size={12.5} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <section className="mt-3">
        {activeTab === 'overview' ? (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[12px] font-semibold text-paper">高信号话题</h3>
                <span className="text-[9px] text-paper-faint">{summary?.topics.length ?? 0} 条</span>
              </div>
              {summary?.topics.length ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {summary.topics.slice(0, 6).map((topic) => <SummaryTopicCard key={topic.id} topic={topic} category={topic.categoryId ? categoriesById[topic.categoryId] : undefined} onOpen={() => onOpenTopic(summaryToTopic(topic))} />)}
                </div>
              ) : <InlineStatus message={summary ? '暂无公开的高信号话题' : '正在等待公开统计数据'} />}
            </div>

            {summary?.replies.length ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[12px] font-semibold text-paper">高信号回复</h3>
                  <span className="text-[9px] text-paper-faint">{summary.replies.length} 条</span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {summary.replies.slice(0, 6).map((reply) => <SummaryReplyCard key={reply.topic.id + ':' + reply.postNumber} reply={reply} onOpen={() => openSummaryReply(reply)} />)}
                </div>
              </div>
            ) : null}

            {summaryCategories.length ? (
              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-paper">常驻领域</h3>
                <div className="flex flex-wrap gap-2">
                  {summaryCategories.slice(0, 8).map((category) => (
                    <span key={category.id} className="inline-flex items-center gap-1.5 rounded-full border border-haze/60 bg-paper/[0.03] px-2.5 py-1.5 text-[10px] text-paper-muted">
                      <span>{tagGlyph(category.name) || '•'}</span>
                      <span>{category.name}</span>
                      <span className="font-mono text-[9px] text-paper-faint">{metric(category.topicCount)}/{metric(category.postCount)}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {(summary?.mostRepliedToUsers.length || summary?.mostLikedUsers.length || summary?.mostLikedByUsers.length) ? (
              <div>
                <h3 className="mb-2 text-[12px] font-semibold text-paper">社区互动</h3>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ['常回复', summary?.mostRepliedToUsers ?? []],
                    ['常点赞', summary?.mostLikedUsers ?? []],
                    ['常获赞于', summary?.mostLikedByUsers ?? []],
                  ].map(([label, users]) => (
                    <div key={String(label)} className="rounded-2xl border border-haze/55 bg-ink-raised/35 p-3">
                      <div className="mb-2 text-[9px] font-semibold tracking-[0.08em] text-paper-faint">{String(label)}</div>
                      <div className="space-y-1.5">
                        {(users as NonNullable<LinuxDoUserSummary['mostLikedUsers']>).slice(0, 4).map((user) => (
                          <button key={user.id} type="button" onClick={() => onOpenUser(user.username)} className="linuxdo-control flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left hover:bg-paper/[0.035]">
                            <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-paper/5">{avatar(user.avatarTemplate, user.username)}</span>
                            <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-paper">@{user.username}</span>
                            <span className="font-mono text-[9px] text-paper-faint">{user.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : activeTab === 'activity' || activeTab === 'topics' || activeTab === 'replies' || activeTab === 'likes' || activeTab === 'responses' ? (
          <div>
            {currentActivity?.loading ? (
              <div className="space-y-2" role="status" aria-label="正在加载用户活动">
                {Array.from({ length: 4 }, (_, index) => <div key={index} className="linuxdo-skeleton h-28 rounded-2xl border border-haze/50" />)}
              </div>
            ) : currentActivity?.error && !currentActivity.items.length ? (
              <InlineStatus message={currentActivity.error} actionLabel="重新加载" onAction={() => void loadActivity(activeTab)} />
            ) : currentActivity?.items.length ? (
              <div className="space-y-2">
                {currentActivity.items.map((action, index) => (
                  <div key={(action.postId ?? action.topicId ?? index) + ':' + action.actionType + ':' + (action.createdAt ?? index)} className="linuxdo-card-in" style={{ animationDelay: Math.min(index, 8) * 24 + 'ms' }}>
                    <ActivityCard
                      action={action}
                      category={action.categoryId ? categoriesById[action.categoryId] : undefined}
                      tab={activeTab}
                      onOpen={action.topicId ? () => openAction(action) : undefined}
                      onOpenUser={onOpenUser}
                    />
                  </div>
                ))}
                {currentActivity.error ? <InlineStatus message={currentActivity.error} actionLabel="重试" onAction={() => void loadActivity(activeTab, true)} /> : null}
                {currentActivity.hasMore ? (
                  <button
                    type="button"
                    disabled={currentActivity.loadingMore}
                    onClick={() => void loadActivity(activeTab, true)}
                    className="linuxdo-control flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-haze text-[10.5px] text-paper-muted disabled:opacity-50"
                  >
                    {currentActivity.loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
                    {currentActivity.loadingMore ? '正在加载更多' : '加载更多'}
                  </button>
                ) : <div className="py-2 text-center text-[9px] text-paper-faint">已显示全部公开内容</div>}
              </div>
            ) : (
              <InlineStatus message="这个分类暂时没有公开内容" actionLabel="刷新" onAction={() => void loadActivity(activeTab)} />
            )}
          </div>
        ) : activeTab === 'boosts' ? (
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex rounded-full border border-haze/60 bg-paper/[0.025] p-1">
                {([
                  ['received', '收到', boostReceivedLoaded ? boostsReceived.length : undefined],
                  ['given', '发出', boostGivenLoaded ? boostsGiven.length : undefined],
                ] as const).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setBoostMode(id)}
                    className={'linuxdo-control min-h-8 rounded-full px-3 py-1 text-[10px] font-medium transition-all ' + (boostMode === id ? 'bg-cinnabar text-white' : 'text-paper-muted')}
                  >
                    {label}{count !== undefined ? ' ' + count : ''}
                  </button>
                ))}
              </div>
              <button type="button" disabled={boostLoading} onClick={() => {
                if (boostMode === 'received') setBoostReceivedLoaded(false)
                else setBoostGivenLoaded(false)
                void loadBoosts(true)
              }} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full border border-haze text-paper-faint disabled:opacity-50" aria-label="刷新 Boost">
                <RefreshCcw size={13} className={boostLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {boostLoading && !currentBoostLoaded ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[11px] text-paper-faint"><Loader2 size={15} className="animate-spin" />正在加载 Boost</div>
            ) : currentBoostError && !currentBoosts.length ? (
              <InlineStatus message={currentBoostError} actionLabel="重新加载" onAction={() => void loadBoosts(true)} />
            ) : currentBoosts.length ? (
              <div className="space-y-2">
                {currentBoosts.map((item) => <BoostCard key={item.id} item={item} onOpen={item.post?.topicId ? () => openBoostPost(item) : undefined} onOpenUser={onOpenUser} />)}
              </div>
            ) : currentBoostLoaded ? (
              <InlineStatus message={boostMode === 'received' ? '暂未收到公开 Boost' : '暂未发出公开 Boost'} />
            ) : null}
          </div>
        ) : activeTab === 'badges' ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[12px] font-semibold text-paper">徽章</h3>
                <p className="mt-0.5 text-[9px] text-paper-faint">
                  {badgesLoaded ? visibleBadges.length + ' 枚公开徽章' : '正在读取公开徽章'}
                  {profile.featuredUserBadgeIds.length ? ' · ' + profile.featuredUserBadgeIds.length + ' 枚设为展示' : ''}
                </p>
              </div>
              <button
                type="button"
                disabled={badgesLoading}
                onClick={() => void loadBadges(true)}
                className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full border border-haze text-paper-faint disabled:opacity-50"
                aria-label="刷新徽章"
              >
                <RefreshCcw size={13} className={badgesLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {badgesLoading && !visibleBadges.length ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[11px] text-paper-faint"><Loader2 size={15} className="animate-spin" />正在加载徽章</div>
            ) : visibleBadges.length ? (
              <>
                {badgesError ? <div className="mb-2"><InlineStatus message={'完整徽章列表加载失败，已显示摘要数据：' + badgesError} actionLabel="重试" onAction={() => void loadBadges(true)} /></div> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleBadges.map((badge) => {
                    const featured = badge.favorite === true || profile.featuredUserBadgeIds.includes(badge.id) || (badge.badgeId ? profile.featuredUserBadgeIds.includes(badge.badgeId) : false)
                    const notificationTarget = initialBadgeId !== undefined && (badge.badgeId === initialBadgeId || badge.id === initialBadgeId)
                    return (
                      <article
                        key={(badge.badgeId ?? badge.id) + ':' + badge.id}
                        ref={notificationTarget ? (node) => { targetBadgeRef.current = node } : undefined}
                        className={'rounded-2xl border p-3.5 ' + (notificationTarget ? 'border-cinnabar bg-cinnabar/[0.09] ring-1 ring-cinnabar/30' : featured ? 'border-cinnabar/35 bg-cinnabar/[0.055]' : 'border-haze/55 bg-ink-raised/35')}
                      >
                        <div className="flex items-start gap-3">
                          <span className={'grid h-10 w-10 shrink-0 place-items-center rounded-xl ' + (notificationTarget || featured ? 'bg-cinnabar/12 text-cinnabar-soft' : 'bg-paper/[0.04] text-paper-muted')}>
                            {badge.imageUrl ? <img src={badge.imageUrl} alt="" className="h-7 w-7 object-contain" /> : <Award size={19} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="truncate text-[12.5px] font-semibold text-paper">{badge.name}</h4>
                              {notificationTarget ? <span className="shrink-0 rounded-full bg-cinnabar/12 px-1.5 py-0.5 text-[8px] font-semibold text-cinnabar-soft">本次获得</span> : featured ? <span className="shrink-0 rounded-full bg-cinnabar/12 px-1.5 py-0.5 text-[8px] font-semibold text-cinnabar-soft">展示中</span> : null}
                            </div>
                            {badge.description ? <p className="mt-1 line-clamp-3 select-text text-[10.5px] leading-5 text-paper-muted">{badge.description}</p> : null}
                            <div className="mt-2 flex flex-wrap gap-x-2 text-[9px] text-paper-faint">
                              {badge.count !== undefined ? <span>获得 {badge.count} 次</span> : null}
                              {badge.grantedAt ? <span>{dateLabel(badge.grantedAt)}</span> : null}
                            </div>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            ) : badgesLoaded ? (
              <InlineStatus message={badgesError || '该用户没有公开徽章'} actionLabel={badgesError ? '重新加载' : undefined} onAction={badgesError ? () => void loadBadges(true) : undefined} />
            ) : summaryError ? (
              <InlineStatus message={summaryError} actionLabel="重试" onAction={() => void loadBadges(true)} />
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}
