import { useEffect, useRef, useState } from 'react'
import {
  Bold,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Eye,
  Heading2,
  Hash,
  Italic,
  Link2,
  List,
  Loader2,
  ImagePlus,
  Lightbulb,
  MessageSquareQuote,
  Pencil,
  Quote,
  RotateCcw,
  Save,
  Send,
  Trash2,
  X,
} from 'lucide-react'

import { ConfirmDialog, PromptDialog } from '../../../components/ConfirmDialog'
import { sanitizeArticleHtml } from '../../../lib/sanitize'
import { ZHIHU_PIN_IMAGE_LIMIT } from '../editor/codec'
import type { ZhihuDraftStore } from '../editor/draftStore'
import type { ZhihuEditorService, ZhihuPinTopicSuggestion, ZhihuPublishResult } from '../editor/service'
import { createZhihuLocalId, type ZhihuDraftSnapshot } from '../editor/schema'
import type { ZhihuImageUploadService } from '../editor/upload'
import { canExecuteZhihuOperation } from '../protocol'
import type { ZhihuEntityRef } from '../types'
import { ZhihuEmptyState, ZhihuErrorBanner, ZhihuSurface } from './ZhihuUi'

interface Props {
  accountId: string
  localDraftId: string
  store: ZhihuDraftStore
  service: ZhihuEditorService
  uploadService: ZhihuImageUploadService
  onOpenDraft: (localDraftId: string) => void
  onPublished: (ref: ZhihuEntityRef) => void
  onDeleted: () => void
}

function draftLabel(draft: ZhihuDraftSnapshot): string {
  if (draft.kind === 'answer') return `回答 · 问题 ${draft.targetId ?? '未知'}`
  return draft.title?.trim() ? `想法 · ${draft.title.trim()}` : '想法'
}

function stateLabel(draft: ZhihuDraftSnapshot): string {
  switch (draft.publishState) {
    case 'remote-draft': return '远端草稿已保存'
    case 'publishing': return '正在发布'
    case 'unknown': return '发布结果待确认'
    case 'published': return '已发布'
    case 'failed': return '上次发布失败'
    default: return '仅本机草稿'
  }
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function DraftManager({ accountId, store, onOpenDraft }: Pick<Props, 'accountId' | 'store' | 'onOpenDraft'>) {
  const [items, setItems] = useState<ZhihuDraftSnapshot[]>([])
  const [questionId, setQuestionId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void store.list(accountId).then(
      (value) => alive && setItems(value),
      (reason) => alive && setError(reason instanceof Error ? reason.message : '读取本机草稿失败'),
    )
    return () => { alive = false }
  }, [accountId, store])

  const create = async (kind: 'answer' | 'pin') => {
    if (creating) return
    const target = kind === 'answer' ? questionId.trim() : undefined
    if (kind === 'answer' && !target) {
      setError('创建回答草稿需要问题 ID')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const draft = await store.create(accountId, kind, target)
      onOpenDraft(draft.localDraftId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建草稿失败')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-5 sm:px-6">
      <header className="mb-5 border-b border-haze/55 pb-5">
        <div className="flex items-center gap-2">
          <Pencil size={17} strokeWidth={1.6} className="text-cinnabar-soft" />
          <h1 className="font-display text-[22px] font-medium text-paper">创作与草稿</h1>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-paper-faint">继续已有草稿，或新建回答和想法。</p>
        {error && <div className="mt-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={creating}
            onClick={() => void create('pin')}
            aria-label="新建想法"
            title="新建想法"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-cinnabar/50 bg-cinnabar/12 text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35"
          >
            {creating ? <Loader2 size={15} className="animate-spin" /> : <Lightbulb size={17} strokeWidth={1.65} />}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-haze/70 bg-ink-raised/40 p-2 focus-within:border-cinnabar/35">
            <MessageSquareQuote size={15} strokeWidth={1.6} className="shrink-0 text-paper-faint" />
            <input
              value={questionId}
              onChange={(event) => setQuestionId(event.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="问题 ID"
              className="min-h-9 min-w-0 flex-1 bg-transparent text-[12.5px] text-paper outline-none placeholder:text-paper-faint/65"
            />
            <button
              type="button"
              disabled={creating || !questionId.trim()}
              onClick={() => void create('answer')}
              aria-label="新建回答草稿"
              title="新建回答草稿"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-cinnabar-soft disabled:opacity-30"
            >
              <ChevronRight size={16} strokeWidth={1.6} />
            </button>
          </div>
        </div>
      </header>

      <div className="mb-2 px-1 font-display text-[15px] font-medium text-paper">本机草稿</div>
      {items.length === 0 ? (
        <ZhihuEmptyState icon={<Pencil size={28} />} title="还没有草稿" description="新建想法，或输入问题 ID 开始写回答。" />
      ) : (
        <ZhihuSurface className="divide-y divide-haze/55">
          {items.map((draft) => (
            <button key={draft.localDraftId} type="button" onClick={() => onOpenDraft(draft.localDraftId)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-paper/5 text-paper-muted">
                {draft.kind === 'answer' ? <MessageSquareQuote size={15} /> : <Lightbulb size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-paper">{draftLabel(draft)}</span>
                <span className="mt-1 line-clamp-2 block text-[10.5px] leading-[1.55] text-paper-faint">{draft.document.text.slice(0, 140) || '空草稿'}</span>
              </span>
              <span className="shrink-0 text-right font-mono text-[9px] text-paper-faint"><span className="block">{stateLabel(draft)}</span><span className="mt-1 block">{formatTime(draft.updatedAt)}</span></span>
              <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 text-paper-faint/65" />
            </button>
          ))}
        </ZhihuSurface>
      )}
    </div>
  )
}

export function ZhihuEditorScreen(props: Props) {
  const { accountId, localDraftId, store, service, uploadService, onOpenDraft, onPublished, onDeleted } = props
  const [draft, setDraft] = useState<ZhihuDraftSnapshot | null>(null)
  const [title, setTitle] = useState('')
  const [topicQuery, setTopicQuery] = useState('')
  const [topicSuggestions, setTopicSuggestions] = useState<ZhihuPinTopicSuggestion[]>([])
  const [topicBusy, setTopicBusy] = useState(false)
  const [topicSaving, setTopicSaving] = useState(false)
  const [topicError, setTopicError] = useState<string | null>(null)
  const [loading, setLoading] = useState(localDraftId !== 'new')
  const [saving, setSaving] = useState(false)
  const [remoteBusy, setRemoteBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  const [editVersion, setEditVersion] = useState(0)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const [deletePromptOpen, setDeletePromptOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const loadedIdRef = useRef<string | null>(null)
  const remoteDraftWritable = Boolean(draft && canExecuteZhihuOperation(draft.kind === 'answer' ? 'draft.answer.save' : 'draft.pin.save'))
  const publishWritable = Boolean(draft && canExecuteZhihuOperation(draft.kind === 'answer' ? 'answer.publish' : 'pin.publish'))
  const imageWritable = canExecuteZhihuOperation('image.upload')
    && canExecuteZhihuOperation('image.oss.put')
    && canExecuteZhihuOperation('image.status.set')
  const pinImageCount = draft?.kind === 'pin'
    ? draft.assets.filter((asset) => asset.uploadState !== 'failed').length
    : 0
  const pinImageLimitReached = draft?.kind === 'pin' && pinImageCount >= ZHIHU_PIN_IMAGE_LIMIT
  const topicRecommendationWritable = Boolean(draft?.kind === 'pin' && canExecuteZhihuOperation('pin.topic.recommend'))

  useEffect(() => {
    if (localDraftId === 'new') {
      setDraft(null)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    void store.get(accountId, localDraftId).then((value) => {
      if (!alive) return
      if (!value) {
        setError('这个草稿不存在，或属于另一个知乎账号')
        setDraft(null)
        return
      }
      setDraft(value)
      setTitle(value.title ?? '')
      setTopicQuery('')
      setTopicSuggestions([])
      setTopicError(null)
      loadedIdRef.current = null
    }, (reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : '读取草稿失败')
    }).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [accountId, localDraftId, store])

  useEffect(() => {
    if (!draft || !editorRef.current || loadedIdRef.current === draft.localDraftId) return
    editorRef.current.innerHTML = draft.document.html
    loadedIdRef.current = draft.localDraftId
  }, [draft])

  const readEditor = (): { html: string; text: string } => ({
    html: editorRef.current?.innerHTML ?? draft?.document.html ?? '',
    text: editorRef.current?.innerText ?? draft?.document.text ?? '',
  })

  const saveLocal = async (quiet = false): Promise<ZhihuDraftSnapshot | null> => {
    if (!draft) return null
    setSaving(true)
    if (!quiet) setError(null)
    try {
      const document = readEditor()
      const saved = await store.save({ ...draft, title: draft.kind === 'pin' ? title : undefined, document: { version: 1, ...document } })
      setDraft(saved)
      if (!quiet) setNotice('已保存到本机')
      return saved
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '本机草稿保存失败')
      return null
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const normalized = topicQuery.trim().replace(/^#+/, '')
    if (!topicRecommendationWritable || !normalized) {
      setTopicSuggestions([])
      setTopicBusy(false)
      setTopicError(null)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setTopicBusy(true)
      setTopicError(null)
      void service.recommendPinTopics(
        normalized,
        title,
        editorRef.current?.innerHTML ?? '',
        controller.signal,
      ).then((items) => {
        if (!controller.signal.aborted) setTopicSuggestions(items)
      }, (reason) => {
        if (!controller.signal.aborted) {
          setTopicSuggestions([])
          setTopicError(reason instanceof Error ? reason.message : '读取知乎话题建议失败')
        }
      }).finally(() => {
        if (!controller.signal.aborted) setTopicBusy(false)
      })
    }, 220)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [service, title, topicQuery, topicRecommendationWritable])

  const addTopic = async (suggestion: ZhihuPinTopicSuggestion) => {
    if (!draft || draft.kind !== 'pin' || topicSaving) return
    if ((draft.topics ?? []).some((topic) => topic.topicId === suggestion.topicId)) {
      setTopicQuery('')
      setTopicSuggestions([])
      return
    }
    setTopicSaving(true)
    setError(null)
    try {
      const base = await saveLocal(true)
      if (!base) return
      const next = await store.save({
        ...base,
        topics: [...(base.topics ?? []), { topicId: suggestion.topicId, name: suggestion.name }],
      })
      setDraft(next)
      setTopicQuery('')
      setTopicSuggestions([])
      setTopicError(null)
      setNotice(`已添加话题 #${suggestion.name}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存想法话题失败')
    } finally {
      setTopicSaving(false)
    }
  }

  const removeTopic = async (topicId: string) => {
    if (!draft || draft.kind !== 'pin' || topicSaving) return
    setTopicSaving(true)
    setError(null)
    try {
      const base = await saveLocal(true)
      if (!base) return
      const topics = (base.topics ?? []).filter((topic) => topic.topicId !== topicId)
      const next = await store.save({ ...base, topics: topics.length > 0 ? topics : undefined })
      setDraft(next)
      setNotice('已移除话题')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除想法话题失败')
    } finally {
      setTopicSaving(false)
    }
  }

  const uploadImage = async (file: File) => {
    if (uploadingImage || !draft || !imageWritable) return
    if (draft.kind === 'pin' && pinImageLimitReached) {
      setError(`想法最多添加 ${ZHIHU_PIN_IMAGE_LIMIT} 张图片`)
      return
    }
    setUploadingImage(true)
    setError(null)
    setNotice(null)
    const assetId = createZhihuLocalId('asset')
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      await store.putAssetBlob(accountId, saved.localDraftId, assetId, file, file.type, file.name)
      let withLocalAsset = await store.save({
        ...saved,
        assets: [
          ...saved.assets,
          { id: assetId, mediaType: file.type, fileName: file.name, uploadState: 'uploading' as const },
        ],
      })
      setDraft(withLocalAsset)
      try {
        const uploaded = await uploadService.upload(file, saved.kind === 'pin' ? 'pin' : 'article')
        const latest = await store.get(accountId, saved.localDraftId) ?? withLocalAsset
        withLocalAsset = await store.save({
          ...latest,
          assets: latest.assets.map((asset) => asset.id === assetId ? {
            ...asset,
            uploadState: 'ready' as const,
            remoteImageId: uploaded.imageId,
            remoteUrl: uploaded.url,
            remoteOriginalUrl: uploaded.originalUrl,
            remoteWatermarkUrl: uploaded.watermarkUrl,
            watermarkMode: uploaded.watermarkMode,
            width: uploaded.width,
            height: uploaded.height,
            error: undefined,
          } : asset),
        })
        setDraft(withLocalAsset)
        if (editorRef.current) {
          editorRef.current.focus()
          const safeUrl = uploaded.url
            .replaceAll('&', '&amp;')
            .replaceAll('"', '&quot;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
          document.execCommand('insertHTML', false, `<p><img src="${safeUrl}" data-image-id="${uploaded.imageId}" alt=""></p>`)
          setEditVersion((value) => value + 1)
        }
        setNotice('图片上传完成；原图仍保存在本机草稿资源中')
      } catch (reason) {
        const latest = await store.get(accountId, saved.localDraftId) ?? withLocalAsset
        const failed = await store.save({
          ...latest,
          assets: latest.assets.map((asset) => asset.id === assetId ? {
            ...asset,
            uploadState: 'failed' as const,
            error: reason instanceof Error ? reason.message : '图片上传失败',
          } : asset),
        })
        setDraft(failed)
        throw reason
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败')
    } finally {
      setUploadingImage(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }

  // 输入后短延时事务保存；页面退出前还会由 blur/visibilitychange 再触发一次。
  useEffect(() => {
    if (!draft || loadedIdRef.current !== draft.localDraftId) return
    const timer = window.setTimeout(() => { void saveLocal(true) }, 450)
    return () => window.clearTimeout(timer)
    // saveLocal 故意不进依赖：它读取当前 editor DOM + 最新 draft state。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editVersion, title])

  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void saveLocal(true) }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, title])

  if (localDraftId === 'new') return <DraftManager accountId={accountId} store={store} onOpenDraft={onOpenDraft} />
  if (loading) return <div className="py-20 text-center font-mono text-[11px] text-paper-faint">正在恢复本机草稿…</div>
  if (!draft) return <div className="mx-auto max-w-xl px-5 py-16 text-center text-[12px] text-paper-muted">{error ?? '草稿不存在'}</div>

  const command = (name: string, value?: string) => {
    editorRef.current?.focus()
    document.execCommand(name, false, value)
    setEditVersion((version) => version + 1)
  }

  const addLink = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return
    try {
      const url = new URL(normalized)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad scheme')
      command('createLink', url.href)
      setLinkPromptOpen(false)
    } catch {
      setError('只允许 http/https 链接')
    }
  }

  const saveRemote = async () => {
    if (!remoteDraftWritable) {
      setError('当前版本暂不可保存远端草稿；本机草稿仍会正常保存。')
      return
    }
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      const next = await service.saveRemoteDraft(saved)
      setDraft(next)
      setNotice('远端草稿已确认保存')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '远端草稿保存失败')
    } finally {
      setRemoteBusy(false)
    }
  }

  const publish = async () => {
    if (!publishWritable) {
      setError('当前版本暂不可发布；草稿仍会保留在本机。')
      return
    }
    setRemoteBusy(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveLocal(true)
      if (!saved) return
      const result: ZhihuPublishResult = await service.publish(saved)
      const latest = await store.get(accountId, saved.localDraftId)
      if (latest) setDraft(latest)
      if (result.status === 'confirmed') {
        setNotice('知乎已确认发布成功')
        onPublished({ kind: saved.kind === 'answer' ? 'answer' : 'pin', id: result.contentId })
      } else if (result.status === 'unknown') {
        setError(`发布请求已发出，但没有拿到可确认的最终结果。不会自动重发。操作号：${result.operationId}`)
      } else {
        setError(result.error)
      }
    } finally {
      setRemoteBusy(false)
    }
  }

  const copy = async () => {
    const saved = await saveLocal(true)
    if (!saved) return
    const next = await store.copy(accountId, saved.localDraftId)
    onOpenDraft(next.localDraftId)
  }

  const remove = async () => {
    await store.delete(accountId, draft.localDraftId)
    setDeletePromptOpen(false)
    onDeleted()
  }

  const sanitizedPreview = preview ? sanitizeArticleHtml(readEditor().html) : ''

  return (
    <div className="mx-auto w-full max-w-4xl px-3 pb-28 pt-4 sm:px-5">
      <div className="rounded-2xl border border-haze/70 bg-ink-raised/55 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-semibold text-paper">{draft.kind === 'answer' ? `回答问题 ${draft.targetId}` : '发布想法'}</div>
            <div className="mt-0.5 font-mono text-[9px] text-paper-faint">revision {draft.localRevision} · {stateLabel(draft)}</div>
          </div>
          <button type="button" disabled={saving} onClick={() => void saveLocal(false)} aria-label="保存到本机" title="保存到本机" className="flex size-9 items-center justify-center rounded-xl border border-haze/70 text-paper-muted transition-colors hover:bg-paper/5 disabled:opacity-35">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}</button>
          <button type="button" disabled={remoteBusy || !remoteDraftWritable} onClick={() => void saveRemote()} aria-label="保存远端草稿" title={remoteDraftWritable ? '保存远端草稿' : '当前版本暂不可保存远端草稿'} className="flex size-9 items-center justify-center rounded-xl border border-haze/70 text-paper-muted transition-colors hover:bg-paper/5 disabled:opacity-35"><RotateCcw size={14} /></button>
          <button type="button" disabled={remoteBusy || !publishWritable} onClick={() => void publish()} aria-label="发布" title={publishWritable ? '发布' : '当前版本暂不可发布'} className="flex size-9 items-center justify-center rounded-xl border border-cinnabar/50 bg-cinnabar/14 text-cinnabar-soft transition-colors hover:bg-cinnabar/20 disabled:opacity-35">{remoteBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}</button>
        </div>
        {notice && <div className="mt-3 flex items-center gap-2 rounded-xl border border-haze/60 bg-ink px-3 py-2 text-[10.5px] text-paper-muted"><Check size={13} className="text-cinnabar" />{notice}</div>}
        {error && <div role="alert" className="mt-3 rounded-xl border border-cinnabar/35 bg-cinnabar/8 px-3 py-2 text-[11px] leading-5 text-paper-muted">{error}</div>}
      </div>

      {draft.kind === 'pin' && (
        <>
          <input value={title} onChange={(event) => { setTitle(event.target.value); setEditVersion((value) => value + 1) }} maxLength={100} placeholder="想法标题（可选）" className="mt-3 min-h-12 w-full rounded-xl border border-haze/70 bg-ink-raised/45 px-3 text-[15px] font-medium text-paper outline-none focus:border-cinnabar/50" />
          <div className="mt-3 rounded-2xl border border-haze/70 bg-ink-raised/40 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-paper-muted">
              <Hash size={14} strokeWidth={1.7} className="text-cinnabar-soft" />
              <span>想法话题</span>
              {(draft.topics?.length ?? 0) > 0 && <span className="font-mono text-[9px] text-paper-faint">{draft.topics?.length} 个</span>}
            </div>
            {(draft.topics?.length ?? 0) > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {draft.topics?.map((topic) => (
                  <span key={topic.topicId} className="inline-flex items-center gap-1 rounded-full border border-cinnabar/25 bg-cinnabar/8 px-2.5 py-1 text-[10.5px] text-cinnabar-soft">
                    #{topic.name.replace(/^#+|#+$/g, '')}
                    <button type="button" disabled={topicSaving} onClick={() => void removeTopic(topic.topicId)} aria-label={`移除话题 ${topic.name}`} title="移除话题" className="rounded-full p-0.5 text-paper-faint hover:bg-paper/8 hover:text-paper disabled:opacity-35">
                      <X size={11} strokeWidth={1.8} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2.5 flex min-h-10 items-center gap-2 rounded-xl border border-haze/65 bg-ink px-2.5 focus-within:border-cinnabar/40">
              <Hash size={13} strokeWidth={1.6} className="shrink-0 text-paper-faint" />
              <input
                value={topicQuery}
                disabled={!topicRecommendationWritable || topicSaving}
                onChange={(event) => setTopicQuery(event.target.value)}
                placeholder={topicRecommendationWritable ? '搜索并添加知乎话题' : '当前协议暂不可读取话题建议'}
                className="min-w-0 flex-1 bg-transparent text-[11.5px] text-paper outline-none placeholder:text-paper-faint/65 disabled:opacity-45"
              />
              {(topicBusy || topicSaving) && <Loader2 size={13} className="shrink-0 animate-spin text-paper-faint" />}
            </div>
            {topicError && <div className="mt-2 text-[10px] leading-4 text-cinnabar-soft">{topicError}</div>}
            {topicQuery.trim() && !topicBusy && !topicError && topicSuggestions.length === 0 && (
              <div className="mt-2 text-[10px] text-paper-faint">没有找到可添加的话题</div>
            )}
            {topicSuggestions.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-haze/55 bg-ink">
                {topicSuggestions.map((suggestion) => {
                  const selected = (draft.topics ?? []).some((topic) => topic.topicId === suggestion.topicId)
                  return (
                    <button
                      key={suggestion.topicId}
                      type="button"
                      disabled={selected || topicSaving}
                      onClick={() => void addTopic(suggestion)}
                      className="flex w-full items-center gap-2 border-b border-haze/45 px-3 py-2.5 text-left last:border-b-0 hover:bg-paper/5 disabled:opacity-45"
                    >
                      <Hash size={13} strokeWidth={1.6} className="shrink-0 text-cinnabar-soft" />
                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-paper">{suggestion.name}</span>
                      {suggestion.discussCount && <span className="shrink-0 font-mono text-[9px] text-paper-faint">{suggestion.discussCount}</span>}
                      {selected && <Check size={12} className="shrink-0 text-cinnabar-soft" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <div className="sticky top-0 z-[5] mt-3 flex flex-wrap gap-1 rounded-xl border border-haze/70 bg-ink-raised/95 p-1.5">
        <button type="button" onClick={() => command('bold')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="加粗"><Bold size={14} /></button>
        <button type="button" onClick={() => command('italic')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="斜体"><Italic size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'h2')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="二级标题"><Heading2 size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'blockquote')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="引用"><Quote size={14} /></button>
        <button type="button" onClick={() => command('insertUnorderedList')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="列表"><List size={14} /></button>
        <button type="button" onClick={() => command('formatBlock', 'pre')} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="代码块"><Code2 size={14} /></button>
        <button type="button" onClick={() => setLinkPromptOpen(true)} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="链接"><Link2 size={14} /></button>
        <button type="button" disabled={uploadingImage || !imageWritable || pinImageLimitReached} onClick={() => imageInputRef.current?.click()} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink disabled:opacity-40" title={!imageWritable ? '当前版本暂不可上传图片' : pinImageLimitReached ? `想法最多添加 ${ZHIHU_PIN_IMAGE_LIMIT} 张图片` : '上传图片'}>{uploadingImage ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}</button>
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file) }} />
        <span className="mx-1 w-px bg-haze" />
        <button type="button" onClick={() => setPreview((value) => !value)} aria-label={preview ? '继续编辑' : '预览'} title={preview ? '继续编辑' : '预览'} className="flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink">{preview ? <Pencil size={14} /> : <Eye size={14} />}</button>
        <button type="button" onClick={() => void copy()} className="ml-auto flex size-9 items-center justify-center rounded-lg text-paper-muted hover:bg-ink" title="复制草稿"><Copy size={14} /></button>
        <button type="button" onClick={() => setDeletePromptOpen(true)} className="flex size-9 items-center justify-center rounded-lg text-paper-faint hover:bg-ink hover:text-cinnabar" title="删除本机草稿"><Trash2 size={14} /></button>
      </div>

      {preview ? (
        <article className="reader-prose zhihu-prose mt-3 min-h-[320px] rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-5 text-paper" data-article-lang="zh" dangerouslySetInnerHTML={{ __html: sanitizedPreview }} />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder="开始写作…"
          onInput={() => { setEditVersion((value) => value + 1); setNotice(null) }}
          onBlur={() => void saveLocal(true)}
          className="article-content mt-3 min-h-[45vh] rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-5 text-[14px] leading-7 text-paper outline-none focus:border-cinnabar/45 [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-paper-faint"
        />
      )}

      <PromptDialog
        open={linkPromptOpen}
        title="插入链接"
        message="支持 http / https 链接。"
        label="链接地址"
        confirmLabel="插入"
        cancelLabel="取消"
        onCancel={() => setLinkPromptOpen(false)}
        onConfirm={addLink}
      />
      <ConfirmDialog
        open={deletePromptOpen}
        title="删除本机草稿"
        message="将删除这个本机草稿及其本地媒体，不会删除已经发布到知乎的内容。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onCancel={() => setDeletePromptOpen(false)}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
