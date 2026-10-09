import { useEffect, useState } from 'react'
import { Browser } from '@capacitor/browser'
import { Ban, ExternalLink, Loader2, MessageCircle, RefreshCw, Search, UserPlus, UserRound } from 'lucide-react'

import type { PeopleContentKind, ZhihuPeopleColumn, ZhihuPeopleProfile, ZhihuPeopleService } from '../people/service'
import type { ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import type { ZhihuAccountRef } from '../session/types'
import { ZhihuContentRow, ZhihuEmptyState, ZhihuErrorBanner, ZhihuLoadingState, ZhihuSurface } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  token: string
  service: ZhihuPeopleService
  onOpen: (ref: ZhihuEntityRef) => void
  interaction: ZhihuInteractionService
  authenticated: boolean
  viewer?: ZhihuAccountRef | null
  onMessage: (peerId: string) => void
  onSearchCreations?: (memberHashId: string, memberName: string) => void
}

type Tab =
  | PeopleContentKind
  | 'activities'
  | 'followers'
  | 'following'
  | 'following-questions'
  | 'following-topics'
  | 'columns'
  | 'following-columns'
  | 'collections'
  | 'following-collections'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'answers', label: '回答' },
  { id: 'articles', label: '文章' },
  { id: 'questions', label: '提问' },
  { id: 'pins', label: '想法' },
  { id: 'activities', label: '动态' },
  { id: 'followers', label: '粉丝' },
  { id: 'following', label: '关注的人' },
  { id: 'following-questions', label: '关注问题' },
  { id: 'following-topics', label: '关注话题' },
  { id: 'columns', label: '专栏' },
  { id: 'following-columns', label: '关注专栏' },
  { id: 'collections', label: '收藏夹' },
  { id: 'following-collections', label: '关注收藏夹' },
]

const EMPTY_TITLES: Record<Tab, string> = {
  answers: '还没有回答',
  articles: '还没有文章',
  questions: '还没有提问',
  pins: '还没有想法',
  activities: '暂无公开动态',
  followers: '还没有粉丝',
  following: '还没有关注的人',
  'following-questions': '还没有关注问题',
  'following-topics': '还没有关注话题',
  columns: '还没有专栏',
  'following-columns': '还没有关注专栏',
  collections: '还没有公开收藏夹',
  'following-collections': '还没有关注收藏夹',
}

function isContentTab(tab: Tab): tab is PeopleContentKind {
  return tab === 'answers' || tab === 'articles' || tab === 'questions' || tab === 'pins'
}

function isRelationTab(tab: Tab): tab is 'followers' | 'following' {
  return tab === 'followers' || tab === 'following'
}

function isColumnTab(tab: Tab): tab is 'columns' | 'following-columns' {
  return tab === 'columns' || tab === 'following-columns'
}

async function openZhihuColumn(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function fallbackProfileForViewer(token: string, viewer?: ZhihuAccountRef | null): ZhihuPeopleProfile | null {
  if (!viewer) return null
  const viewerToken = viewer.urlToken?.trim() || viewer.id
  if (token !== viewerToken && token !== viewer.id) return null
  return {
    id: viewer.id,
    token: viewerToken,
    name: viewer.name?.trim() || viewerToken,
    avatarUrl: viewer.avatarUrl,
    headline: viewer.headline,
    isFollowing: false,
    isBlocking: false,
  }
}

export function ZhihuPeopleScreen({ token, service, onOpen, interaction, authenticated, viewer, onMessage, onSearchCreations }: Props) {
  const viewerFallback = fallbackProfileForViewer(token, viewer)
  const [profile, setProfile] = useState<ZhihuPeopleProfile | null>(() => viewerFallback)
  const [tab, setTab] = useState<Tab>('answers')
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [peopleItems, setPeopleItems] = useState<ZhihuPeopleProfile[]>([])
  const [columnItems, setColumnItems] = useState<ZhihuPeopleColumn[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileWarning, setProfileWarning] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const localFallback = fallbackProfileForViewer(token, viewer)
    setLoading(true)
    setError(null)
    setProfileWarning(null)
    setProfile((current) => current?.token === token || current?.id === token ? current : localFallback)
    setItems([])
    setPeopleItems([])
    setColumnItems([])
    setNextCursor(undefined)
    setHasMore(false)
    void (async () => {
      try {
        // 回答/文章/提问/想法只依赖用户 token。资料接口偶发超时或握手失败时，
        // 不能让整个内容页一起失效，因此资料与内容并行读取；当前账号还可先用
        // 已验证登录会话里的快照即时绘制头像/昵称。
        if (isContentTab(tab)) {
          const [profileResult, pageResult] = await Promise.allSettled([
            service.read(token, controller.signal),
            service.listContent(token, tab, undefined, controller.signal),
          ])
          if (controller.signal.aborted) return
          if (profileResult.status === 'fulfilled') {
            setProfile(profileResult.value)
          } else {
            setProfileWarning(profileResult.reason instanceof Error ? profileResult.reason.message : '用户资料刷新失败')
          }
          if (pageResult.status === 'rejected') throw pageResult.reason
          setItems(pageResult.value.items)
          setNextCursor(pageResult.value.nextCursor)
          setHasMore(pageResult.value.hasMore)
          return
        }

        let nextProfile: ZhihuPeopleProfile
        try {
          nextProfile = await service.read(token, controller.signal)
          if (controller.signal.aborted) return
          setProfile(nextProfile)
        } catch (reason) {
          if (!localFallback) throw reason
          nextProfile = localFallback
          setProfile(localFallback)
          setProfileWarning(reason instanceof Error ? reason.message : '用户资料刷新失败')
        }

        if (tab === 'activities') {
          const page = await service.listActivities(nextProfile.token, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (isRelationTab(tab)) {
          const page = await service.listRelations(nextProfile, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setPeopleItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (tab === 'following-questions' || tab === 'following-topics') {
          const page = await service.listFollowingEntities(
            nextProfile.token,
            tab === 'following-questions' ? 'questions' : 'topics',
            undefined,
            controller.signal,
          )
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else if (isColumnTab(tab)) {
          const page = await service.listColumns(nextProfile.token, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setColumnItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        } else {
          const page = await service.listCollections(nextProfile.token, tab, undefined, controller.signal)
          if (controller.signal.aborted) return
          setItems(page.items)
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取用户页失败')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => controller.abort()
  }, [reloadNonce, service, tab, token, viewer])

  const loadMore = () => {
    if (!profile || loadingMore || !hasMore) return
    setLoadingMore(true)
    const request = isContentTab(tab)
      ? !nextCursor
        ? Promise.resolve(null)
        : service.listContent(token, tab, nextCursor)
      : tab === 'activities'
        ? nextCursor
          ? service.listActivities(profile.token, nextCursor)
          : Promise.resolve(null)
        : isRelationTab(tab)
          ? nextCursor
            ? service.listRelations(profile, tab, nextCursor)
            : Promise.resolve(null)
          : tab === 'following-questions' || tab === 'following-topics'
            ? nextCursor
              ? service.listFollowingEntities(profile.token, tab === 'following-questions' ? 'questions' : 'topics', nextCursor)
              : Promise.resolve(null)
            : isColumnTab(tab)
              ? nextCursor
                ? service.listColumns(profile.token, tab, nextCursor)
                : Promise.resolve(null)
              : nextCursor
                ? service.listCollections(profile.token, tab, nextCursor)
                : Promise.resolve(null)
    void request.then(
      (page) => {
        if (!page) {
          setLoadingMore(false)
          return
        }
        if (isRelationTab(tab)) {
          setPeopleItems((prev) => {
            const seen = new Set(prev.map((item) => item.id))
            return [...prev, ...(page.items as ZhihuPeopleProfile[]).filter((item) => !seen.has(item.id))]
          })
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
          setLoadingMore(false)
          return
        }
        if (isColumnTab(tab)) {
          setColumnItems((prev) => {
            const seen = new Set(prev.map((item) => item.id))
            return [...prev, ...(page.items as ZhihuPeopleColumn[]).filter((item) => !seen.has(item.id))]
          })
          setNextCursor(page.nextCursor)
          setHasMore(page.hasMore)
          setLoadingMore(false)
          return
        }
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...(page.items as ZhihuContentSummary[]).filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
        setLoadingMore(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  const isSelf = Boolean(profile && viewer && (
    profile.id === viewer.id ||
    (viewer.urlToken && profile.token === viewer.urlToken)
  ))

  const toggleBlock = async () => {
    if (!profile || !authenticated || blockBusy) return
    const target = !profile.isBlocking
    setBlockBusy(true)
    setError(null)
    try {
      await interaction.setPersonBlocked(profile.token, target)
      setProfile((prev) => prev ? { ...prev, isBlocking: target } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '屏蔽操作失败')
    } finally {
      setBlockBusy(false)
    }
  }

  const toggleFollow = async () => {
    if (!profile || !authenticated || followBusy) return
    const target = !profile.isFollowing
    setFollowBusy(true)
    setError(null)
    try {
      await interaction.setFollowing('person', profile.token, target)
      setProfile((prev) => prev ? {
        ...prev,
        isFollowing: target,
        followerCount: typeof prev.followerCount === 'number'
          ? Math.max(0, prev.followerCount + (target ? 1 : -1))
          : prev.followerCount,
      } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关注操作失败')
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {profile && (
        <header className="mb-5 overflow-hidden rounded-3xl border border-haze/50 bg-gradient-to-b from-ink-raised/60 to-ink-raised/20 p-4 sm:p-5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
          <div className="flex items-start gap-4">
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt="" className="size-16 rounded-2xl border border-haze/60 object-cover shadow-sm sm:size-18" loading="lazy" />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-haze/60 bg-ink-deep text-paper-muted sm:size-18"><UserRound size={26} strokeWidth={1.5} /></span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="min-w-0 flex-1 truncate font-sans text-[20px] font-bold leading-tight text-paper sm:text-[22px]">{profile.name}</h1>
                {onSearchCreations && (
                  <button
                    type="button"
                    onClick={() => onSearchCreations(profile.id, profile.name)}
                    aria-label={`搜索 ${profile.name} 的创作`}
                    title="搜索 TA 的创作"
                    className="flex size-8.5 shrink-0 items-center justify-center rounded-xl border border-haze/60 bg-ink-raised/50 text-paper-faint transition-colors hover:border-sky-500/40 hover:text-sky-500 active:scale-95"
                  >
                    <Search size={14.5} strokeWidth={1.8} />
                  </button>
                )}
              </div>
              {profile.headline && <p className="mt-1 text-[12.5px] leading-relaxed text-paper-muted">{profile.headline}</p>}
            </div>
          </div>

          {profile.description && (
            <p className="mt-3 whitespace-pre-wrap rounded-xl bg-ink/40 p-2.5 text-[12px] leading-[1.7] text-paper-muted/90">
              {profile.description}
            </p>
          )}

          {/* 四栏数据统计看板 */}
          <div className="mt-4 grid grid-cols-4 gap-1.5 rounded-2xl border border-haze/45 bg-ink/50 p-2 text-center">
            <div className="min-w-0 py-1">
              <div className="font-mono text-[15px] font-bold text-paper">
                {typeof profile.followerCount === 'number' ? formatZhihuCount(profile.followerCount) : '—'}
              </div>
              <div className="text-[10.5px] text-paper-faint">关注者</div>
            </div>
            <div className="min-w-0 py-1">
              <div className="font-mono text-[15px] font-bold text-paper">
                {typeof profile.followingCount === 'number' ? formatZhihuCount(profile.followingCount) : '—'}
              </div>
              <div className="text-[10.5px] text-paper-faint">关注</div>
            </div>
            <div className="min-w-0 py-1">
              <div className="font-mono text-[15px] font-bold text-paper">
                {typeof profile.answerCount === 'number' ? formatZhihuCount(profile.answerCount) : '—'}
              </div>
              <div className="text-[10.5px] text-paper-faint">回答</div>
            </div>
            <div className="min-w-0 py-1">
              <div className="font-mono text-[15px] font-bold text-paper">
                {typeof profile.articleCount === 'number' ? formatZhihuCount(profile.articleCount) : '—'}
              </div>
              <div className="text-[10.5px] text-paper-faint">文章</div>
            </div>
          </div>

          {authenticated && !isSelf && (
            <div className="mt-3.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onMessage(profile.id)}
                aria-label="发送私信"
                title="私信"
                className="flex h-9 items-center gap-1.5 rounded-full border border-haze/65 bg-ink-raised/50 px-4 font-sans text-[12px] text-paper-muted transition-colors hover:border-sky-500/40 hover:text-paper active:scale-95"
              >
                <MessageCircle size={14} strokeWidth={1.8} />
                <span>发私信</span>
              </button>

              <button
                type="button"
                disabled={followBusy || !canExecuteZhihuOperation(profile.isFollowing ? 'follow.person.clear' : 'follow.person.set')}
                onClick={() => void toggleFollow()}
                aria-label={profile.isFollowing ? '取消关注' : '关注'}
                title={profile.isFollowing ? '取消关注' : '关注'}
                className={`flex h-9 min-w-20 items-center justify-center gap-1.5 rounded-full px-4 font-sans text-[12px] font-medium transition-[background-color,border-color,color,transform] active:scale-95 disabled:opacity-35 ${
                  profile.isFollowing
                    ? 'border border-haze/70 bg-ink-raised/60 text-paper-muted'
                    : 'bg-[#0066FF] text-white shadow-sm hover:bg-[#005ce6]'
                }`}
              >
                {followBusy ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13.5} strokeWidth={2} />}
                <span>{profile.isFollowing ? '已关注' : '关注'}</span>
              </button>

              <button
                type="button"
                disabled={blockBusy || !canExecuteZhihuOperation(profile.isBlocking ? 'block.person.clear' : 'block.person.set')}
                onClick={() => void toggleBlock()}
                aria-label={profile.isBlocking ? '取消屏蔽' : '屏蔽'}
                title={profile.isBlocking ? '取消屏蔽' : '屏蔽'}
                className={`ml-auto flex size-9 items-center justify-center rounded-full border transition-colors disabled:opacity-35 ${profile.isBlocking ? 'border-cinnabar/35 bg-cinnabar/8 text-cinnabar-soft' : 'border-haze/60 text-paper-faint hover:bg-paper/5 hover:text-paper-muted active:scale-95'}`}
              >
                {blockBusy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14.5} strokeWidth={1.7} />}
              </button>
            </div>
          )}
        </header>
      )}

      <div className="scroll-hidden -mx-1 mb-3.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`h-8 shrink-0 rounded-full border px-3.5 font-sans text-[11.5px] transition-[background-color,border-color,color] ${
              tab === item.id
                ? 'border-sky-500/40 bg-sky-500/12 font-medium text-sky-500 shadow-2xs'
                : 'border-haze/60 bg-ink-raised/35 text-paper-faint hover:bg-paper/5 hover:text-paper-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {profileWarning && profile && !error && (
        <div className="mb-3">
          <ZhihuErrorBanner>用户资料暂未刷新：{profileWarning}</ZhihuErrorBanner>
        </div>
      )}
      {loading && <ZhihuLoadingState label="正在读取用户内容…" />}
      {error && (
        <div className="mb-3">
          <ZhihuErrorBanner>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setReloadNonce((value) => value + 1)}
                aria-label="重试读取用户内容"
                title="重试"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-cinnabar/25 text-cinnabar-soft transition-colors hover:bg-cinnabar/10"
              >
                <RefreshCw size={14} strokeWidth={1.7} />
              </button>
            </span>
          </ZhihuErrorBanner>
        </div>
      )}

      {peopleItems.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {peopleItems.map((person) => (
            <button key={person.id} type="button" onClick={() => onOpen({ kind: 'people', id: person.token })} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/5">
              {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="size-10 rounded-xl object-cover" loading="lazy" /> : <span className="flex size-10 items-center justify-center rounded-xl bg-paper/5"><UserRound size={17} className="text-paper-faint" /></span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[15px] font-medium text-paper">{person.name}</span>
                {person.headline && <span className="mt-0.5 line-clamp-2 block text-[11px] leading-[1.55] text-paper-faint">{person.headline}</span>}
              </span>
              {typeof person.followerCount === 'number' && <span className="shrink-0 font-mono text-[9.5px] text-paper-faint">{formatZhihuCount(person.followerCount)} 关注者</span>}
            </button>
          ))}
        </ZhihuSurface>
      )}

      {columnItems.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {columnItems.map((column) => (
            <button
              key={column.id}
              type="button"
              onClick={() => void openZhihuColumn(column.url)}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/5"
            >
              {column.avatarUrl ? (
                <img src={column.avatarUrl} alt="" className="size-10 shrink-0 rounded-xl object-cover" loading="lazy" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-haze/60 bg-paper/5 font-display text-[15px] text-paper-faint">栏</span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-display text-[15px] font-medium text-paper">{column.title}</span>
                  <ExternalLink size={12} strokeWidth={1.6} className="shrink-0 text-paper-faint" />
                </span>
                {(column.description || column.intro) && <span className="mt-1 line-clamp-2 block text-[11px] leading-[1.6] text-paper-faint">{column.description || column.intro}</span>}
                <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9.5px] text-paper-faint">
                  <span>{formatZhihuCount(column.articlesCount)} 文章</span>
                  <span>{formatZhihuCount(column.followerCount)} 关注</span>
                  {column.isFollowing && <span className="text-cinnabar-soft">已关注</span>}
                </span>
              </span>
            </button>
          ))}
        </ZhihuSurface>
      )}

      {items.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((item) => <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={(value) => onOpen(value.ref)} showReason={false} />)}
        </ZhihuSurface>
      )}
      {!loading && !error && items.length === 0 && peopleItems.length === 0 && columnItems.length === 0 && (
        <ZhihuEmptyState title={EMPTY_TITLES[tab]} />
      )}
      {hasMore && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 font-mono text-[10.5px] text-paper-muted transition-colors hover:bg-ink-raised disabled:opacity-45">
          {loadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '正在加载…' : '加载更多'}</span>
        </button>
      )}
    </div>
  )
}
