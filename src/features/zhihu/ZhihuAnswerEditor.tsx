import { useEffect, useMemo, useRef, useState } from 'react'
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Save, Send, X } from 'lucide-react'

import { sanitizeArticleHtml } from '../../lib/sanitize'
import { loadMyAnswer, publishZhihuAnswer, saveZhihuAnswerDraft } from './service'

interface Props {
  open: boolean
  initialQuestionId?: string
  onClose: () => void
  onPublished?: (answerId: string, questionId: string) => void
}

function parseQuestionId(value: string): string | undefined {
  const source = value.trim()
  if (/^\d{4,}$/.test(source)) return source
  try {
    const url = new URL(source)
    if (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com') return undefined
    return url.pathname.match(/^\/question\/(\d+)/)?.[1]
  } catch {
    return undefined
  }
}

function toolbarCommand(command: string, value?: string) {
  document.execCommand(command, false, value)
}

export function ZhihuAnswerEditor({ open, initialQuestionId, onClose, onPublished }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [questionInput, setQuestionInput] = useState(initialQuestionId || '')
  const questionId = useMemo(() => parseQuestionId(questionInput), [questionInput])
  const [answerId, setAnswerId] = useState<string | undefined>()
  const [tocEnabled, setTocEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) setQuestionInput(initialQuestionId || '')
  }, [initialQuestionId, open])

  useEffect(() => {
    if (!open || !questionId) return
    let cancelled = false
    setLoading(true); setMessage('')
    void loadMyAnswer(questionId)
      .then((existing) => {
        if (cancelled) return
        setAnswerId(existing?.id)
        setTocEnabled(existing?.tocEnabled ?? true)
        if (editorRef.current) editorRef.current.innerHTML = sanitizeArticleHtml(existing?.html || '')
        setMessage(existing ? '已载入你现有的回答，可直接编辑' : '这是一个新回答')
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : '无法读取已有回答') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, questionId])

  if (!open) return null

  const html = () => sanitizeArticleHtml(editorRef.current?.innerHTML || '')
  const execute = (command: string, value?: string) => {
    editorRef.current?.focus()
    toolbarCommand(command, value)
  }
  const save = async (publish: boolean) => {
    if (!questionId) { setMessage('请输入有效的知乎问题链接或问题 ID'); return }
    const content = html()
    if (!content.replace(/<[^>]+>/g, '').trim()) { setMessage('回答内容不能为空'); return }
    setSaving(true); setMessage('')
    try {
      if (publish) {
        const id = await publishZhihuAnswer(questionId, content, tocEnabled, answerId)
        setAnswerId(id); setMessage('回答已发布'); onPublished?.(id, questionId)
      } else {
        await saveZhihuAnswerDraft(questionId, content, tocEnabled, answerId)
        setMessage('草稿已保存到知乎')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : publish ? '发布失败' : '保存失败')
    } finally { setSaving(false) }
  }

  const addLink = () => {
    const href = window.prompt('链接地址')?.trim()
    if (href && /^https?:\/\//i.test(href)) execute('createLink', href)
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink" data-no-page-tap>
      <header className="shrink-0 border-b border-haze bg-ink/95 backdrop-blur-md" style={{ paddingTop: 'var(--sat)' }}>
        <div className="page-x mx-auto flex h-14 max-w-4xl items-center gap-3">
          <button type="button" onClick={onClose} aria-label="关闭回答编辑器" className="flex h-9 w-9 items-center justify-center text-paper-muted hover:text-paper"><X size={18} /></button>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[16px] text-paper">{answerId ? '编辑知乎回答' : '写知乎回答'}</p>
            <p className="font-mono text-[9px] text-paper-faint">正文与草稿直接保存到知乎 · NewsNook 不上传副本</p>
          </div>
          <button type="button" disabled={saving || !questionId} onClick={() => void save(true)} className="inline-flex items-center gap-1.5 rounded-sm bg-cinnabar px-3 py-2 text-[12px] font-medium text-white disabled:opacity-40"><Send size={14} />发布</button>
        </div>
      </header>

      <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto">
        <div className="page-x mx-auto max-w-4xl py-5">
          <label className="block font-mono text-[10px] tracking-[0.12em] text-paper-faint">知乎问题</label>
          <input value={questionInput} onChange={(event) => setQuestionInput(event.target.value)} placeholder="粘贴 https://www.zhihu.com/question/... 或输入问题 ID" className="mt-2 w-full rounded-sm border border-haze bg-ink-raised px-3 py-2.5 text-[13px] text-paper outline-none transition focus:border-cinnabar/60" />

          <div className="mt-5 flex flex-wrap items-center gap-1 border-y border-haze py-2">
            <button type="button" onClick={() => execute('bold')} aria-label="加粗" className="editor-tool"><Bold size={15} /></button>
            <button type="button" onClick={() => execute('italic')} aria-label="斜体" className="editor-tool"><Italic size={15} /></button>
            <button type="button" onClick={() => execute('formatBlock', 'h2')} aria-label="二级标题" className="editor-tool"><Heading2 size={15} /></button>
            <button type="button" onClick={() => execute('formatBlock', 'blockquote')} aria-label="引用" className="editor-tool"><Quote size={15} /></button>
            <button type="button" onClick={() => execute('insertUnorderedList')} aria-label="无序列表" className="editor-tool"><List size={15} /></button>
            <button type="button" onClick={() => execute('insertOrderedList')} aria-label="有序列表" className="editor-tool"><ListOrdered size={15} /></button>
            <button type="button" onClick={addLink} aria-label="插入链接" className="editor-tool"><Link2 size={15} /></button>
            <label className="ml-auto inline-flex items-center gap-2 text-[11px] text-paper-muted"><input type="checkbox" checked={tocEnabled} onChange={(event) => setTocEnabled(event.target.checked)} />目录</label>
          </div>

          <div ref={editorRef} contentEditable={!loading} suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder="写下你的回答…" className="reader-prose mt-4 min-h-[45vh] rounded-sm border border-haze bg-ink-raised/25 px-4 py-4 text-paper outline-none focus:border-cinnabar/45 empty:before:pointer-events-none empty:before:text-paper-faint empty:before:content-[attr(data-placeholder)]" />

          {message && <p className="mt-3 rounded-sm bg-ink-raised px-3 py-2 text-[11px] text-paper-muted">{loading ? '正在读取已有回答…' : message}</p>}
          <div className="mt-5 flex items-center justify-between gap-3 pb-[calc(var(--sab)+24px)]">
            <p className="text-[10px] leading-relaxed text-paper-faint">发布前仍会由知乎服务端执行内容审核与风控；若需要验证，重新登录即可恢复会话。</p>
            <button type="button" disabled={saving || !questionId} onClick={() => void save(false)} className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-haze bg-ink-raised px-3 py-2 text-[12px] text-paper disabled:opacity-40"><Save size={14} />保存草稿</button>
          </div>
        </div>
      </div>
    </div>
  )
}
