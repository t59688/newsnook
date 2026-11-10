import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, X } from 'lucide-react'
import type { Article } from '../../lib/types'
import { alertableWatchEvents, subscribeWatchAnnouncements } from './announcements'
import { loadWatchState, markWatchArticleRead, type WatchEvent } from './store'

/**
 * Live update banner and a deliberately explicit UI-only preview. The preview
 * never changes the inbox, article cursor, or the Android notification channel.
 */
export function WatchBanner({
  onOpen,
  onOpenInbox,
}: {
  onOpen: (article: Article) => void
  onOpenInbox: () => void
}) {
  const [event, setEvent] = useState<WatchEvent | null>(null)
  const [preview, setPreview] = useState(false)

  useEffect(() => subscribeWatchAnnouncements(events => {
    const latest = alertableWatchEvents(events, loadWatchState())[0]
    if (latest) {
      setPreview(false)
      setEvent(latest)
    }
  }), [])

  useEffect(() => {
    const showPreview = () => {
      setEvent(null)
      setPreview(true)
    }
    window.addEventListener('newsnook:source-watch-preview', showPreview)
    return () => window.removeEventListener('newsnook:source-watch-preview', showPreview)
  }, [])

  useEffect(() => {
    if (!event && !preview) return
    const timer = setTimeout(() => {
      setEvent(null)
      setPreview(false)
    }, 8500)
    return () => clearTimeout(timer)
  }, [event, preview])

  if (!event && !preview) return null

  const dismiss = () => { setEvent(null); setPreview(false) }
  const open = () => {
    if (preview) {
      dismiss()
      onOpenInbox()
    } else if (event) {
      const article = event.article
      dismiss()
      markWatchArticleRead(article)
      onOpen(article)
    }
  }

  return createPortal(
    <div role="status" className="fixed left-3 right-3 z-[75] mx-auto max-w-md rounded-2xl border border-haze bg-ink-raised p-3 shadow-xl" style={{ top: 'calc(var(--sat, 0px) + 66px)', animation: 'watch-banner-enter 220ms ease-out both' }}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cinnabar/15 text-cinnabar">
          <Bell size={18} aria-hidden="true" />
        </span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={open}>
          <span className="block text-xs font-semibold text-cinnabar">
            {preview ? '关注动态 · 横幅预览' : event?.article.sourceName + ' · 发现新内容'}
          </span>
          <span className="mt-1 block text-sm font-medium leading-relaxed text-paper">
            {preview ? '收到关注信源的新文章时，提醒会显示在这里。点击打开收件箱。' : event?.article.title}
          </span>
        </button>
        <button type="button" aria-label="关闭提醒" onClick={dismiss} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-paper-muted">
          <X size={17} />
        </button>
      </div>
      <style>{'@keyframes watch-banner-enter { from { opacity: 0; transform: translateY(-8px) } to { opacity: 1; transform: translateY(0) } }'}</style>
    </div>,
    document.body,
  )
}
