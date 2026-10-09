import { useEffect, useState } from 'react'
import { Hash, Loader2, UserPlus } from 'lucide-react'

import type { ZhihuTopicDetail, ZhihuTopicService } from '../topic/service'
import type { ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import { ZhihuContentRow, ZhihuErrorBanner, ZhihuLoadingState, ZhihuSectionHeader, ZhihuSurface } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  topicId: string
  service: ZhihuTopicService
  onOpen: (ref: ZhihuEntityRef) => void
  interaction: ZhihuInteractionService
  authenticated: boolean
}

export function ZhihuTopicScreen({ topicId, service, onOpen, interaction, authenticated }: Props) {
  const [detail, setDetail] = useState<ZhihuTopicDetail | null>(null)
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followBusy, setFollowBusy] = useState(false)
  const followWritable = canExecuteZhihuOperation(detail?.isFollowing ? 'follow.topic.clear' : 'follow.topic.set')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.read(topicId, controller.signal),
      service.listHot(topicId, undefined, controller.signal),
    ]).then(
      ([nextDetail, page]) => {
        if (controller.signal.aborted) return
        setDetail(nextDetail)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : '读取话题失败')
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [service, topicId])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    const cursor = nextCursor
    setLoadingMore(true)
    void service.listHot(topicId, cursor).then(
      (page) => {
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setLoadingMore(false)
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  const toggleFollow = async () => {
    if (!detail || !authenticated || followBusy) return
    const target = !detail.isFollowing
    setFollowBusy(true)
    setError(null)
    try {
      await interaction.setFollowing('topic', detail.id, target)
      setDetail((prev) => prev ? {
        ...prev,
        isFollowing: target,
        followersCount: typeof prev.followersCount === 'number'
          ? Math.max(0, prev.followersCount + (target ? 1 : -1))
          : prev.followersCount,
      } : prev)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '关注话题失败')
    } finally {
      setFollowBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {detail && (
        <header className="mb-5 border-b border-haze/55 pb-5">
          <div className="flex items-start gap-3.5">
            {detail.avatarUrl ? (
              <img src={detail.avatarUrl} alt="" className="size-14 rounded-2xl object-cover" loading="lazy" />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-haze/70 bg-ink-raised/45 text-cinnabar-soft"><Hash size={22} strokeWidth={1.5} /></div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-cinnabar-soft"><Hash size={12} /><span>话题</span></div>
              <h1 className="mt-1.5 font-display text-[25px] font-medium leading-tight text-paper">{detail.name}</h1>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-paper-faint">
                {typeof detail.followersCount === 'number' && <span>{formatZhihuCount(detail.followersCount)} 关注者</span>}
                {typeof detail.questionsCount === 'number' && <span>{formatZhihuCount(detail.questionsCount)} 问题</span>}
                {typeof detail.discussCount === 'number' && <span>{formatZhihuCount(detail.discussCount)} 讨论</span>}
              </div>
            </div>
            {authenticated && (
              <button
                type="button"
                disabled={followBusy || !followWritable}
                onClick={() => void toggleFollow()}
                aria-label={detail.isFollowing ? '取消关注话题' : '关注话题'}
                title={detail.isFollowing ? '取消关注话题' : '关注话题'}
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors disabled:opacity-35 ${detail.isFollowing ? 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/70 bg-ink-raised/45 text-paper-muted hover:border-cinnabar/35 hover:text-cinnabar-soft'}`}
              >
                {followBusy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={16} strokeWidth={1.6} />}
              </button>
            )}
          </div>
          {detail.excerpt && <p className="mt-4 text-[13px] leading-[1.75] text-paper-muted">{detail.excerpt}</p>}
        </header>
      )}

      <ZhihuSectionHeader icon={<Hash size={17} />} title="热门讨论" detail={items.length > 0 ? `${items.length} 条已载入` : undefined} />
      {loading && items.length === 0 && <ZhihuLoadingState label="正在读取话题…" />}
      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {items.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((item) => <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={(value) => onOpen(value.ref)} showReason={false} />)}
        </ZhihuSurface>
      )}
      {nextCursor && (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 font-mono text-[10.5px] text-paper-muted transition-colors hover:bg-ink-raised disabled:opacity-45">
          {loadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '正在加载…' : '加载更多'}</span>
        </button>
      )}
    </div>
  )
}
