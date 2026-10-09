import { useEffect, useState } from 'react'
import { Bookmark, Eye, Loader2, UsersRound } from 'lucide-react'

import type { ZhihuCollectionDetail, ZhihuCollectionService } from '../collection/service'
import type { ZhihuContentSummary, ZhihuEntityRef } from '../types'
import { ZhihuContentRow, ZhihuErrorBanner, ZhihuLoadingState, ZhihuSectionHeader, ZhihuSurface } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  collectionId: string
  service: ZhihuCollectionService
  onOpen: (ref: ZhihuEntityRef) => void
}

export function ZhihuCollectionScreen({ collectionId, service, onOpen }: Props) {
  const [detail, setDetail] = useState<ZhihuCollectionDetail | null>(null)
  const [items, setItems] = useState<ZhihuContentSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void Promise.all([
      service.read(collectionId, controller.signal),
      service.items(collectionId, undefined, controller.signal),
    ]).then(
      ([nextDetail, page]) => {
        if (controller.signal.aborted) return
        setDetail(nextDetail)
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setHasMore(page.hasMore)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [collectionId, service])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await service.items(collectionId, nextCursor)
      setItems((previous) => {
        const seen = new Set(previous.map((item) => `${item.ref.kind}:${item.ref.id}`))
        return [...previous, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载收藏夹更多内容失败')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      {detail && (
        <header className="mb-5 border-b border-haze/55 pb-5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-cinnabar-soft"><Bookmark size={12} /><span>收藏夹</span></div>
          <h1 className="mt-2 font-display text-[26px] font-medium leading-[1.35] text-paper">{detail.title}</h1>
          {detail.creator?.name && <div className="mt-1.5 text-[11.5px] text-paper-muted">{detail.creator.name}</div>}
          {detail.description && <p className="mt-3 whitespace-pre-wrap text-[13px] leading-[1.75] text-paper-muted">{detail.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-paper-faint">
            {typeof detail.itemCount === 'number' && <span>{formatZhihuCount(detail.itemCount)} 条内容</span>}
            {typeof detail.followerCount === 'number' && <span className="inline-flex items-center gap-1"><UsersRound size={11} />{formatZhihuCount(detail.followerCount)}</span>}
            {typeof detail.viewCount === 'number' && <span className="inline-flex items-center gap-1"><Eye size={11} />{formatZhihuCount(detail.viewCount)}</span>}
            <span>{detail.isPublic ? '公开' : '私密'}</span>
          </div>
        </header>
      )}

      <ZhihuSectionHeader icon={<Bookmark size={17} />} title="内容" detail={items.length > 0 ? `${items.length} 条已载入` : undefined} />
      {loading && items.length === 0 && <ZhihuLoadingState label="正在读取收藏夹…" />}
      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {items.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((item) => <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={(value) => onOpen(value.ref)} showReason={false} />)}
        </ZhihuSurface>
      )}
      {hasMore && nextCursor && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 font-mono text-[10.5px] text-paper-muted transition-colors hover:bg-ink-raised disabled:opacity-45">
          {loadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '正在加载…' : '加载更多'}</span>
        </button>
      )}
    </div>
  )
}
