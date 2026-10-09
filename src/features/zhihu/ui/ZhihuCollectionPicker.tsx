import { useEffect, useState } from 'react'
import { Bookmark, Check, Loader2, Plus, X } from 'lucide-react'

import type { ZhihuCollectionSummary, ZhihuInteractionService } from '../interaction/service'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuEntityRef } from '../types'
import { ZhihuErrorBanner } from './ZhihuUi'
import { useHardwareBackLayer } from '../../../hooks/useHardwareBackLayer'

interface Props {
  refValue: ZhihuEntityRef
  service: ZhihuInteractionService
  authenticated: boolean
  onCollected?: () => void
}

export function ZhihuCollectionPicker({ refValue, service, authenticated, onCollected }: Props) {
  const supported = refValue.kind === 'answer' || refValue.kind === 'article'
  const membershipWritable = canExecuteZhihuOperation('collection.membership')
  const createWritable = canExecuteZhihuOperation('collection.create')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ZhihuCollectionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  useHardwareBackLayer(open && authenticated, () => {
    setOpen(false)
    return true
  })

  useEffect(() => {
    if (!open || !authenticated || !supported) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void service.listContentCollections(refValue, controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) setItems(next)
      },
      (reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '读取收藏夹失败')
      },
    ).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [authenticated, open, refValue, service, supported])

  if (!supported) return null

  const toggle = async (collection: ZhihuCollectionSummary) => {
    if (busyId) return
    setBusyId(collection.id)
    setError(null)
    const nextIncluded = !collection.isFavorited
    try {
      await service.setCollectionMembership(refValue, collection.id, nextIncluded)
      setItems((prev) => prev.map((item) => item.id === collection.id ? { ...item, isFavorited: nextIncluded } : item))
      if (nextIncluded) onCollected?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '收藏操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const createAndAdd = async () => {
    const title = newTitle.trim()
    if (!title || busyId) return
    setBusyId('__new__')
    setError(null)
    try {
      const created = await service.createCollection(title)
      await service.setCollectionMembership(refValue, created.id, true)
      setItems((prev) => [{ ...created, isFavorited: true }, ...prev.filter((item) => item.id !== created.id)])
      setNewTitle('')
      onCollected?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建收藏夹失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!authenticated || !membershipWritable}
        onClick={() => setOpen(true)}
        title={!authenticated ? '登录后可收藏' : !membershipWritable ? '当前版本暂不可收藏' : '收藏'}
        aria-label="收藏"
        className="inline-flex min-h-9 items-center justify-center rounded-full border border-haze bg-ink-raised/55 px-3 text-paper-muted transition-colors hover:border-paper-faint/45 hover:bg-ink-raised hover:text-paper disabled:opacity-35"
      >
        <Bookmark size={14} strokeWidth={1.65} />
      </button>

      {open && authenticated && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center md:p-4" role="presentation" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="收藏到知乎收藏夹"
            className="flex max-h-[78vh] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
            style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center pb-1 pt-2.5 md:hidden" aria-hidden><span className="h-1 w-10 rounded-full bg-haze" /></div>
            <div className="flex items-center gap-3 border-b border-haze/55 px-4 py-3">
              <Bookmark size={16} strokeWidth={1.6} className="text-cinnabar-soft" />
              <h2 className="min-w-0 flex-1 font-display text-[17px] font-medium text-paper">收藏到</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="关闭" title="关闭" className="flex size-8 items-center justify-center rounded-lg text-paper-faint hover:bg-paper/5 hover:text-paper"><X size={16} /></button>
            </div>

            {error && <div className="mx-4 mt-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
            <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {loading && <div className="flex min-h-28 items-center justify-center gap-2 font-mono text-[10.5px] text-paper-faint"><Loader2 size={14} className="animate-spin text-cinnabar-soft" />正在读取收藏夹…</div>}
              {!loading && items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => void toggle(item)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2.5 text-left transition-colors hover:bg-paper/5 disabled:opacity-50"
                >
                  <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${item.isFavorited ? 'border-cinnabar/55 bg-cinnabar/15 text-cinnabar-soft' : 'border-haze text-transparent'}`}><Check size={12} /></span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-paper">{item.title}</span>
                  {busyId === item.id && <Loader2 size={13} className="animate-spin text-paper-faint" />}
                </button>
              ))}
            </div>

            <div className="mx-4 flex items-center gap-2 border-t border-haze/55 pt-3">
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                maxLength={80}
                placeholder="新收藏夹名称"
                className="min-h-10 min-w-0 flex-1 rounded-xl border border-haze/70 bg-ink px-3 text-[12px] text-paper outline-none focus:border-cinnabar/40"
              />
              <button
                type="button"
                disabled={!createWritable || !membershipWritable || !newTitle.trim() || Boolean(busyId)}
                onClick={() => void createAndAdd()}
                aria-label="新建并收藏"
                title="新建并收藏"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-cinnabar/50 bg-cinnabar/12 text-cinnabar-soft disabled:opacity-35"
              >
                {busyId === '__new__' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} strokeWidth={1.7} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
