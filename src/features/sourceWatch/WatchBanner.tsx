import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import type { Article } from '../../lib/types'
import { subscribeWatchUpdates } from './runtime'
import { loadWatchState, type WatchEvent } from './store'

export function WatchBanner({ onOpen }: { onOpen: (article: Article) => void }) {
  const [event, setEvent] = useState<WatchEvent | null>(null)
  useEffect(() => subscribeWatchUpdates(events => {
    const state = loadWatchState()
    const hour = new Date().getHours()
    if (state.quietHours && (hour >= 23 || hour < 8)) return
    const latest = events.find(item => state.rules.some(rule => rule.enabled && rule.sourceId === item.sourceId && rule.mode === 'instant'))
    if (latest) setEvent(latest)
  }), [])
  useEffect(() => {
    if (!event) return
    const timer = setTimeout(() => setEvent(null), 8500)
    return () => clearTimeout(timer)
  }, [event])
  if (!event) return null
  return <div role="status" className="fixed left-3 right-3 z-[75] mx-auto max-w-md rounded-2xl border border-haze bg-ink-raised p-3 shadow-xl" style={{ top: 'calc(var(--sat, 0px) + 66px)', animation: 'watch-banner-enter 220ms ease-out both' }}>
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cinnabar/15 text-cinnabar"><Bell size={18}/></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setEvent(null); onOpen(event.article) }}>
        <span className="block text-xs font-semibold text-cinnabar">{event.article.sourceName} · 发现新内容</span>
        <span className="mt-1 block text-sm font-medium leading-relaxed text-paper">{event.article.title}</span>
      </button>
      <button type="button" aria-label="关闭提醒" onClick={() => setEvent(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-paper-muted"><X size={17}/></button>
    </div>
    <style>{'@keyframes watch-banner-enter { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }'}</style>
  </div>
}
