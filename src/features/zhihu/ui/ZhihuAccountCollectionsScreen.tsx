import { useEffect, useState } from 'react'
import { Bookmark, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '../../../components/ConfirmDialog'

import type { ZhihuCollectionSummary, ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import { ZhihuEmptyState, ZhihuErrorBanner, ZhihuLoadingState, ZhihuSurface } from './ZhihuUi'
import { formatZhihuCount } from './ZhihuUiUtils'

interface Props {
  urlToken: string
  service: ZhihuInteractionService
  onOpenCollection: (collectionId: string) => void
}

function mergeCollections(previous: ZhihuCollectionSummary[], incoming: ZhihuCollectionSummary[]) {
  const seen = new Set(previous.map((item) => item.id))
  return [...previous, ...incoming.filter((item) => !seen.has(item.id))]
}

export function ZhihuAccountCollectionsScreen({ urlToken, service, onOpenCollection }: Props) {
  const [items, setItems] = useState<ZhihuCollectionSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPublic, setNewPublic] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ZhihuCollectionSummary | null>(null)

  const createWritable = canExecuteZhihuOperation('collection.create')
  const deleteWritable = canExecuteZhihuOperation('collection.delete')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])
    setNextCursor(undefined)
    void service.listAccountCollections(urlToken, undefined, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [service, urlToken])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await service.listAccountCollections(urlToken, nextCursor)
      setItems((prev) => mergeCollections(prev, page.items))
      setNextCursor(page.nextCursor)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载更多收藏夹失败')
    } finally {
      setLoadingMore(false)
    }
  }

  const create = async () => {
    const title = newTitle.trim()
    if (!title || !createWritable || busyId) return
    setBusyId('__create__')
    setError(null)
    try {
      const created = await service.createCollection(title, newDescription.trim(), newPublic)
      setItems((prev) => [created, ...prev.filter((item) => item.id !== created.id)])
      setNewTitle('')
      setNewDescription('')
      setNewPublic(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (collection: ZhihuCollectionSummary) => {
    if (!deleteWritable || collection.isDefault || busyId) return
    setPendingDelete(null)
    setBusyId(collection.id)
    setError(null)
    try {
      await service.deleteCollection(collection)
      setItems((prev) => prev.filter((item) => item.id !== collection.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <header className="mb-4 border-b border-haze/55 pb-5">
        <div className="flex items-center gap-2">
          <Bookmark size={17} strokeWidth={1.6} className="text-cinnabar-soft" />
          <h1 className="font-display text-[22px] font-medium text-paper">我的收藏夹</h1>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-paper-faint">创建、查看和管理知乎收藏夹。</p>
        <div className="mt-4 rounded-xl border border-haze/70 bg-ink-raised/40 p-2.5 focus-within:border-cinnabar/35">
          <div className="flex items-center gap-2">
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              disabled={!createWritable}
              maxLength={80}
              placeholder={createWritable ? '新收藏夹名称' : '当前会话暂不可创建'}
              className="min-h-9 min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-paper outline-none placeholder:text-paper-faint/65 disabled:opacity-45"
            />
            <button
              type="button"
              disabled={!createWritable || !newTitle.trim() || Boolean(busyId)}
              onClick={() => void create()}
              aria-label="新建收藏夹"
              title="新建收藏夹"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-cinnabar/50 bg-cinnabar/12 text-cinnabar-soft disabled:opacity-35"
            >
              {busyId === '__create__' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} strokeWidth={1.7} />}
            </button>
          </div>
          <textarea
            value={newDescription}
            onChange={(event) => setNewDescription(event.target.value)}
            disabled={!createWritable}
            maxLength={500}
            rows={2}
            placeholder="描述（可选）"
            className="mt-1.5 min-h-14 w-full resize-none border-t border-haze/45 bg-transparent px-1 pt-2 text-[11.5px] leading-5 text-paper outline-none placeholder:text-paper-faint/65 disabled:opacity-45"
          />
          <label className="mt-1 flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-lg px-1 text-[11px] text-paper-muted">
            <span><span className="block font-medium text-paper">公开收藏夹</span><span className="mt-0.5 block text-[9.5px] text-paper-faint">关闭时按私密收藏夹创建</span></span>
            <input
              type="checkbox"
              checked={newPublic}
              disabled={!createWritable}
              onChange={(event) => setNewPublic(event.target.checked)}
              className="size-4 accent-current"
            />
          </label>
        </div>
      </header>

      {error && <div className="mb-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && <ZhihuLoadingState label="正在读取收藏夹…" />}
      {!loading && items.length === 0 && !error && <ZhihuEmptyState icon={<Bookmark size={28} />} title="还没有收藏夹" />}

      {items.length > 0 && (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((collection) => (
            <div key={collection.id} className="flex items-center gap-2 px-4 py-3.5 transition-colors hover:bg-paper/5">
              <button type="button" onClick={() => onOpenCollection(collection.id)} className="min-w-0 flex-1 text-left">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-display text-[15px] font-medium text-paper">{collection.title}</span>
                  {collection.isDefault && <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-cinnabar-soft">默认</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 font-mono text-[9.5px] text-paper-faint">
                  <span>{collection.isPublic ? '公开' : '私密'}</span>
                  {typeof collection.itemCount === 'number' && <span>{formatZhihuCount(collection.itemCount)} 项</span>}
                </div>
                {collection.description && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-[1.6] text-paper-muted">{collection.description}</p>}
              </button>
              {!collection.isDefault && (
                <button
                  type="button"
                  disabled={!deleteWritable || Boolean(busyId)}
                  onClick={() => setPendingDelete(collection)}
                  title="删除收藏夹"
                  aria-label={`删除收藏夹 ${collection.title}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-cinnabar/8 hover:text-cinnabar-soft disabled:opacity-30"
                >
                  {busyId === collection.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={14} strokeWidth={1.6} />}
                </button>
              )}
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-paper-faint/65" />
            </div>
          ))}
        </ZhihuSurface>
      )}

      {nextCursor && (
        <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 font-mono text-[10.5px] text-paper-muted disabled:opacity-45">
          {loadingMore && <Loader2 size={13} className="animate-spin text-cinnabar-soft" />}
          <span>{loadingMore ? '正在加载…' : '加载更多'}</span>
        </button>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除收藏夹"
        message={pendingDelete ? `删除“${pendingDelete.title}”？其中的知乎内容不会被删除。` : ''}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) void remove(pendingDelete) }}
      />
    </div>
  )
}
