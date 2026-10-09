import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Clock,
  FileText,
  Flame,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  X,
} from 'lucide-react'

import { fetchArticleComments } from '../service'
import type {
  CommentItem,
  CommentTab,
  CommentTabId,
} from '../types'
import { CommentCard } from './CommentCard'

interface Props {
  open: boolean
  onClose: () => void
  article: {
    id: string
    title: string
    sourceId?: string
    originUrl?: string
    neteaseDocId?: string
  }
}

function renderTabIcon(tabId: CommentTabId) {
  switch (tabId) {
    case 'hot':
      return <Flame size={13} className="shrink-0" />
    case 'latest':
      return <Clock size={13} className="shrink-0" />
    case 'short':
      return <MessageSquare size={13} className="shrink-0" />
    case 'long':
      return <FileText size={13} className="shrink-0" />
    default:
      return null
  }
}

function getDefaultTabForArticle(article: { sourceId?: string; originUrl?: string }): CommentTabId {
  if (article.sourceId?.includes('zhihu') || article.originUrl?.includes('zhihu.com')) {
    return 'short'
  }
  if (article.sourceId === 'jandan' || article.originUrl?.includes('jandan.net')) {
    return 'latest'
  }
  return 'hot'
}

export function CommentsDrawer({ open, onClose, article }: Props) {
  const [activeTab, setActiveTab] = useState<CommentTabId>(() => getDefaultTabForArticle(article))
  const [availableTabs, setAvailableTabs] = useState<CommentTab[]>([])
  const [comments, setComments] = useState<CommentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | string | undefined>(0)
  const [error, setError] = useState<string | null>(null)

  // 当 article 改变或打开时，同步默认 tab
  useEffect(() => {
    if (open) {
      const defTab = getDefaultTabForArticle(article)
      setActiveTab(defTab)
    }
  }, [open, article.id, article.sourceId, article.originUrl])

  const loadComments = useCallback(
    async (tab: CommentTabId, isRefresh = false) => {
      if (!open) return
      setLoading(true)
      setError(null)
      if (isRefresh) {
        setComments([])
      }

      try {
        const res = await fetchArticleComments(article, tab, 0)
        setComments(res.comments)
        setAvailableTabs(res.availableTabs)
        setHasMore(res.hasMore)
        setNextOffset(res.nextOffset)
        if (res.availableTabs.length > 0 && !res.availableTabs.some((t) => t.id === tab)) {
          setActiveTab(res.availableTabs[0].id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载评论失败，请重试')
      } finally {
        setLoading(false)
      }
    },
    [open, article],
  )

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || nextOffset == null) return
    setLoadingMore(true)
    try {
      const res = await fetchArticleComments(article, activeTab, nextOffset)
      setComments((prev) => {
        const existingIds = new Set(prev.map((c) => c.id))
        const newItems = res.comments.filter((c) => !existingIds.has(c.id))
        return [...prev, ...newItems]
      })
      setHasMore(res.hasMore)
      setNextOffset(res.nextOffset)
    } catch {
      // 忽略分页加载失败
    } finally {
      setLoadingMore(false)
    }
  }, [article, activeTab, hasMore, loadingMore, nextOffset])

  const handleListScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el || loading || loadingMore || !hasMore) return
    // 距离底部 250px 以内自动触发无感上拉加载
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 250) {
      void handleLoadMore()
    }
  }, [handleLoadMore, hasMore, loading, loadingMore])

  useEffect(() => {
    if (open) {
      void loadComments(activeTab, true)
    }
  }, [open, activeTab, loadComments])

  // 按 Esc 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩背景 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* 抽屉面板 */}
      <div
        className="relative flex h-full w-full max-w-lg flex-col bg-ink text-paper shadow-2xl z-10 border-l border-haze"
        style={{ animation: 'drawer-slide-in 240ms var(--ease-ink, cubic-bezier(0.22, 1, 0.36, 1)) both' }}
      >
        <style>{`@keyframes drawer-slide-in { from { opacity: 0.6; transform: translateX(20px) } to { opacity: 1; transform: none } }`}</style>

        {/* 顶部标题栏 */}
        <div
          className="flex shrink-0 items-center justify-between border-b border-haze bg-ink px-4 py-3.5"
          style={{ paddingTop: 'calc(0.875rem + var(--sat, 0px))' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <MessageSquare size={18} className="text-cinnabar shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-paper truncate">
                网友跟贴讨论
              </h2>
              <p className="text-[11px] text-paper-faint truncate max-w-xs">
                {article.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void loadComments(activeTab, true)}
              disabled={loading}
              title="刷新评论"
              className="rounded-lg p-2 text-paper-muted hover:bg-ink-raised hover:text-paper disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="关闭"
              className="rounded-lg p-2 text-paper-muted hover:bg-ink-raised hover:text-paper"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab 栏（如有多个分类，如 热门 / 最新 / 短评 / 长评） */}
        {availableTabs.length > 1 && (
          <div className="flex shrink-0 border-b border-haze bg-ink px-4 py-2 gap-2">
            {availableTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-cinnabar text-white shadow-sm'
                    : 'bg-ink-raised border border-haze/60 text-paper-muted hover:bg-haze hover:text-paper'
                }`}
              >
                {renderTabIcon(tab.id)}
                <span>{tab.label}</span>
                {tab.count != null && tab.count > 0 && (
                  <span className="opacity-80 text-[11px]">({tab.count})</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* 评论列表区域 */}
        <div
          ref={scrollContainerRef}
          onScroll={handleListScroll}
          className="flex-1 overflow-y-auto bg-ink px-4 py-2 safe-pb-24"
        >
          {loading && comments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-paper-faint">
              <LoaderCircle size={28} className="animate-spin text-cinnabar" />
              <p className="mt-3 text-[13px]">正在探索跟贴与讨论...</p>
            </div>
          )}

          {error && comments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <AlertCircle size={32} className="text-cinnabar" />
              <p className="mt-2 text-[13px] text-paper-muted">{error}</p>
              <button
                type="button"
                onClick={() => void loadComments(activeTab, true)}
                className="mt-3 rounded-lg bg-ink-raised border border-haze px-3.5 py-1.5 text-[12px] font-medium text-paper hover:bg-haze"
              >
                重试加载
              </button>
            </div>
          )}

          {!loading && !error && comments.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center text-paper-faint">
              <MessageSquare size={36} className="opacity-30 mb-2" />
              <p className="text-[13px]">暂无跟贴评论或该报道讨论已关闭</p>
            </div>
          )}

          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}

          {/* 自动连续触底加载 / 加载中指示器 */}
          {hasMore && (
            <div className="py-4 text-center">
              {loadingMore ? (
                <div className="inline-flex items-center gap-2 rounded-xl border border-haze bg-ink-raised px-4 py-2 text-[12px] font-medium text-paper-muted">
                  <LoaderCircle size={13} className="animate-spin text-cinnabar" />
                  <span>正在加载更多跟贴...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-haze bg-ink-raised px-4 py-2 text-[12px] font-medium text-paper-muted hover:bg-haze hover:text-paper"
                >
                  <span>继续上拉或点击加载更多</span>
                </button>
              )}
            </div>
          )}

          {/* 已加载完毕提示 */}
          {!hasMore && !loading && comments.length > 0 && (
            <div className="py-6 text-center text-[11px] font-mono tracking-wider text-paper-faint">
              — 已展示全部跟贴讨论 —
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
