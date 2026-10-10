import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCcw } from 'lucide-react'
import { linuxDoProfileSections } from '../runtime'
import type { LinuxDoProfileDraft, LinuxDoProfileItem, LinuxDoProfileSection } from '../people/sections'
import type { LinuxDoSessionSnapshot, LinuxDoTopicSummary } from '../types'
import { ago, readableError } from './utils'
import { LinuxDoRequestError, type LinuxDoVerify } from './VerificationAction'
import { reactionGlyph } from './engagementModel'

export function ProfileSectionView({ section, username, session, onOpenTopic, onResumeDraft, onVerify }: {
  section: LinuxDoProfileSection
  username: string
  session: LinuxDoSessionSnapshot
  onOpenTopic: (topic: LinuxDoTopicSummary, postNumber?: number) => void
  onResumeDraft?: (draft: LinuxDoProfileDraft) => Promise<void>
  onVerify?: LinuxDoVerify
}) {
  const [items, setItems] = useState<LinuxDoProfileItem[]>([])
  const [next, setNext] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [requestError, setRequestError] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const [resuming, setResuming] = useState(false)
  const request = useRef<{ controller: AbortController | null; generation: number; failedPage?: string }>({ controller: null, generation: 0 }).current
  const self = session.authenticated && session.currentUser?.username.toLowerCase() === username.toLowerCase()
  const allowed = (!['read', 'drafts', 'pending'].includes(section) || self)
    && (section !== 'assigned' || (session.authenticated && session.currentUser?.canAssignGlobally !== false))

  const load = useCallback(async (page?: string) => {
    if (request.controller) return
    const controller = new AbortController()
    request.controller = controller
    const current = request.generation
    request.failedPage = page
    setLoading(true)
    setError('')
    setRequestError(null)
    try {
      const result = await linuxDoProfileSections.list(section, username, page, controller.signal)
      if (current !== request.generation || controller.signal.aborted) return
      setItems(old => page ? [...old, ...result.items.filter(item => !old.some(existing => existing.id === item.id))] : result.items)
      setNext(result.next)
    } catch (cause) {
      if (current === request.generation && !controller.signal.aborted) { setError(readableError(cause)); setRequestError(cause) }
    } finally {
      if (current === request.generation) { request.controller = null; setLoading(false) }
    }
  }, [request, section, username])

  useEffect(() => {
    request.generation++
    request.controller?.abort()
    request.controller = null
    setItems([])
    setNext(undefined)
    setError('')
    setResuming(false)
    if (allowed) void load()
    else setLoading(false)
    return () => { request.generation++; request.controller?.abort(); request.controller = null }
  }, [load, request, session.authenticated, session.currentUser?.id, allowed, revision])

  if (!allowed) return <p className="py-8 text-center text-[12px] text-paper-muted">{section === 'assigned' ? '当前账号无法查看指定列表' : '此栏目仅本人登录后可查看'}</p>
  return <div className="space-y-2">
    <div className="flex justify-end"><button type="button" aria-label="刷新栏目" disabled={loading || resuming} onClick={() => setRevision(value => value + 1)} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full border border-haze text-paper-faint disabled:opacity-50"><RefreshCcw size={13} /></button></div>
    {items.map(item => <article key={item.id} className="rounded-2xl border border-haze/55 bg-ink-raised/35 px-3.5 py-3">
      <button type="button" disabled={!item.topic || resuming} onClick={() => item.topic && onOpenTopic(item.topic, item.postNumber)} className="linuxdo-control block w-full text-left text-[13px] font-semibold text-paper disabled:cursor-default">{item.title}</button>
      <div className="mt-1 flex gap-2 text-[10px] text-paper-faint">{item.createdAt ? <span>{ago(item.createdAt)}</span> : null}{item.postNumber ? <span>#{item.postNumber}</span> : null}{item.reaction ? <span>{reactionGlyph(item.reaction)} {item.reaction}</span> : null}{section === 'pending' ? <span>等待审核</span> : null}</div>
      {item.text ? <p className="mt-2 line-clamp-4 whitespace-pre-wrap select-text text-[11px] leading-5 text-paper-muted">{item.text}</p> : null}
      {item.html ? <div className="reader-prose mt-2 line-clamp-4 text-[11px] text-paper-muted" dangerouslySetInnerHTML={{ __html: item.html }} /> : null}
      {item.draft ? <button type="button" disabled={resuming || !item.draft.data || !onResumeDraft} onClick={async () => {
        if (!item.draft || !onResumeDraft) return
        const current = request.generation
        setResuming(true)
        setError('')
        try { await onResumeDraft(item.draft) } catch (cause) { if (current === request.generation) setError(readableError(cause)) }
        finally { if (current === request.generation) setResuming(false) }
      }} className="linuxdo-control mt-2 min-h-9 rounded-full border border-haze px-3 text-[11px] text-cinnabar disabled:opacity-50">{resuming ? '正在打开草稿…' : item.draft.data ? '继续编辑' : '草稿格式无法读取'}</button> : null}
    </article>)}
    {loading ? <div role="status" className="flex justify-center gap-2 py-8 text-[11px] text-paper-faint"><Loader2 size={15} className="animate-spin" />正在加载</div> : null}
    {error ? <LinuxDoRequestError error={requestError ?? new Error(error)} onVerify={onVerify} onRetry={() => load(request.failedPage)} busy={loading} /> : null}
    {!loading && !error && !items.length ? <p className="py-8 text-center text-[12px] text-paper-muted">此栏目暂无内容</p> : null}
    {!loading && !error && next ? <button type="button" onClick={() => void load(next)} className="linuxdo-control min-h-10 w-full rounded-full border border-haze text-[11px] text-paper-muted">加载更多</button> : null}
  </div>
}
