import { Browser } from '@capacitor/browser'
import { ArrowLeft, Bookmark, Check, ChevronDown, Hash, Heart, Link, Loader2, MessageCircle, MoreHorizontal, Pencil, Quote, Reply, Rocket, Send, Trash2, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react'

import { ImageLightbox } from '../../../components/ImageLightbox'
import { ContextActionMenu } from '../../../components/ContextActionMenu'
import { ConfirmDialog, OptionPickerDialog } from '../../../components/ConfirmDialog'
import type { Point } from '../../../lib/contextActions'
import { log } from '../../../lib/logger'
import { useProgressiveImages } from '../../../hooks/useProgressiveImages'
import {
  linuxDoApi,
  linuxDoDiscovery,
  linuxDoDrafts,
  linuxDoInteractions,
  linuxDoTemplates,
  linuxDoTopics,
  linuxDoUploads,
} from '../runtime'
import type {
  LinuxDoBoost,
  LinuxDoCategory,
  LinuxDoPost,
  LinuxDoReaction,
  LinuxDoSessionSnapshot,
  LinuxDoTag,
  LinuxDoTopic,
  LinuxDoTopicSummary,
} from '../types'
import { decodeTagNames } from '../api/decode'
import { LinuxDoApiError } from '../types'
import { ago, avatar, compact, readableError, tagGlyph } from './utils'
import { resolveReplyTarget } from './threadModel'
import { boostText, reactionGlyph, reactionTotal } from './engagementModel'
import { ComposerEditor, type ComposerEditorHandle, type ComposerUploadVisualItem } from '../editor/ComposerEditor'
import { CategoryPickerSheet, InsertMenuSheet, TagPickerSheet, TemplatePickerSheet } from '../editor/ComposerSheets'
import { buildComposerDraftData, validateComposer } from '../editor/model'
import { resolveLinuxDoTemplate, type LinuxDoComposerTemplate, type LinuxDoTemplateVariables } from '../template/service'
import { LinuxDoReadTracker } from '../topic/readTracker'
import { verifyLinuxDoBrowserSession } from '../session/native'
import { ReadSyncStatus } from './ReadSyncStatus'
import { PostDevice } from './PostDevice'
import { readSyncDiagnostic, type ReadSyncFailure } from '../topic/readSyncDiagnostic'
import { applyLinuxDoTopicReadProgress, linuxDoOpeningUnreadFloor } from '../topic/readState'
import { LINUXDO_UPLOAD_BATCH_LIMIT } from '../upload/service'
import { adjacentLinuxDoPostIds, linuxDoServerResumePosition, linuxDoTopicPositionOf, type LinuxDoTopicPosition } from '../topic/readingPosition'
import { useTopicPosition } from './useTopicPosition'
import type { LinuxDoProfileDraft } from '../people/sections'

async function openExternal(url: string): Promise<void> {
  try {
    await Browser.open({ url })
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

function buildComposerTemplateVariables(
  topic: LinuxDoTopic | undefined,
  session: LinuxDoSessionSnapshot,
  replyToPostNumber?: number,
): LinuxDoTemplateVariables {
  const posts = topic?.postStream.posts ?? []
  const firstPost = posts.reduce<LinuxDoPost | undefined>((first, post) => !first || post.postNumber < first.postNumber ? post : first, undefined)
  const lastPost = posts.reduce<LinuxDoPost | undefined>((last, post) => !last || post.postNumber > last.postNumber ? post : last, undefined)
  const replyTo = replyToPostNumber ? posts.find((post) => post.postNumber === replyToPostNumber) : undefined
  const topicUrl = topic ? `https://linux.do/t/${encodeURIComponent(topic.slug || 'topic')}/${topic.id}` : undefined
  return {
    my_username: session.currentUser?.username,
    my_name: session.currentUser?.name,
    context_title: topic?.title,
    context_url: topicUrl,
    topic_title: topic?.title,
    topic_url: topicUrl,
    original_poster_username: topic?.details?.createdBy?.username || firstPost?.username,
    original_poster_name: topic?.details?.createdBy?.name || firstPost?.name,
    reply_to_username: replyTo?.username,
    reply_to_name: replyTo?.name,
    last_poster_username: topic?.lastPosterUsername || lastPost?.username,
    reply_to_or_last_poster_username: replyTo?.username || topic?.lastPosterUsername || lastPost?.username,
  }
}

function LinuxDoPostBody({ html, onClick }: { html: string; onClick: (event: ReactMouseEvent<HTMLDivElement>) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useProgressiveImages(rootRef, html, Boolean(html), {
    autoLoad: true,
    forceNativeFallback: true,
    imageReferer: 'https://linux.do/',
  })

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-linuxdo-role="poll-bar"]').forEach((bar) => {
      const percent = bar.getAttribute('data-linuxdo-poll-percent')
      if (percent) {
        bar.style.width = `${percent}%`
      }
    })
    root.querySelectorAll<HTMLElement>('[data-linuxdo-role="quote-category-dot"]').forEach((dot) => {
      const color = dot.getAttribute('data-linuxdo-category-color')
      if (color) {
        dot.style.backgroundColor = color
      }
    })
  }, [html])

  return (
    <div
      ref={rootRef}
      className="reader-prose linuxdo-post-prose mt-3 text-paper"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ReactionSummary({ reactions, fallbackCount }: { reactions: LinuxDoReaction[]; fallbackCount: number }) {
  const total = reactionTotal(reactions) || fallbackCount
  if (!reactions.length) {
    return (
      <>
        <Heart size={13} className="text-paper-muted" />
        <span className="font-mono text-[11px] font-medium leading-none">{total || '赞'}</span>
      </>
    )
  }
  return (
    <>
      <span className="flex -space-x-1" aria-hidden="true">
        {reactions.slice(0, 4).map((reaction) => (
          <span
            key={reaction.id}
            title={reaction.id + ' · ' + reaction.count}
            className="grid h-[20px] min-w-[20px] place-items-center rounded-full bg-ink-raised px-0.5 text-[12px] leading-none shadow-[0_0_0_1.5px_var(--color-ink-raised)]"
          >
            {reactionGlyph(reaction.id)}
          </span>
        ))}
      </span>
      <span className="font-mono text-[11.5px] font-medium leading-none">{total}</span>
    </>
  )
}

function BoostCloud({ boosts, onOpenUser }: { boosts: LinuxDoBoost[]; onOpenUser: (username: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const items = useMemo(() => boosts.map((boost) => ({ boost, text: boostText(boost.cooked) })), [boosts])
  if (!items.length) return null

  const limit = 12
  const showAll = expanded || items.length <= limit + 2
  const visible = showAll ? items : items.slice(0, limit)
  const remaining = items.length - visible.length

  return (
    <div className="linuxdo-boost-cloud mt-3 pt-1" aria-label={items.length + ' 条社区回应'}>
      <div className="flex flex-wrap items-center gap-1.5">
        {visible.map(({ boost, text }) => (
          <button
            key={boost.id}
            type="button"
            disabled={!boost.user.username}
            onClick={() => boost.user.username && onOpenUser(boost.user.username)}
            className="linuxdo-boost-chip linuxdo-control inline-flex max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1 pr-2.5 text-left disabled:pointer-events-none"
            title={boost.user.name ? `${boost.user.name} (@${boost.user.username})` : boost.user.username}
          >
            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-deep ring-1 ring-black/10 dark:ring-white/10">
              {avatar(boost.user.avatarTemplate, boost.user.username || 'boost')}
            </span>
            <span className="max-w-[16rem] truncate text-[11px] font-normal leading-tight text-paper/90">
              {text}
            </span>
          </button>
        ))}
        {remaining > 0 && !showAll ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="linuxdo-control inline-flex items-center rounded-full border border-dashed border-cinnabar/35 bg-cinnabar/[0.04] px-2.5 py-1 text-[10px] font-medium text-cinnabar-soft transition-all hover:bg-cinnabar/[0.08] active:scale-95"
          >
            +{remaining} 展开
          </button>
        ) : null}
        {expanded && items.length > limit + 2 ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="linuxdo-control inline-flex items-center rounded-full border border-haze/50 bg-paper/[0.03] px-2 py-1 text-[10px] text-paper-faint transition-all hover:text-paper-muted active:scale-95"
          >
            收起
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function LinuxDoComposer({
  open,
  topic,
  session,
  onClose,
  onSent,
  initialRaw,
  replyToPostNumber,
  editPost,
  onEdited,
  requestCloseRef,
  resumedDraft,
}: {
  open: boolean
  topic?: LinuxDoTopic
  session: LinuxDoSessionSnapshot
  onClose: () => void
  onSent: (post: LinuxDoPost, kind: 'reply' | 'create') => void
  initialRaw?: string
  replyToPostNumber?: number
  editPost?: LinuxDoPost
  onEdited?: (post: LinuxDoPost) => void
  requestCloseRef?: MutableRefObject<(() => void) | null>
  resumedDraft?: LinuxDoProfileDraft
}) {
  const [title, setTitle] = useState('')
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [categories, setCategories] = useState<LinuxDoCategory[]>([])
  const [tags, setTags] = useState<LinuxDoTag[]>([])
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [draftSequence, setDraftSequence] = useState(0)
  const draftSequenceRef = useRef(0)
  const lastSavedDraftRef = useRef('')
  const [draftKey, setDraftKey] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadItems, setUploadItems] = useState<ComposerUploadVisualItem[]>([])
  const [failedUploadFiles, setFailedUploadFiles] = useState<File[]>([])
  const [uploadNotice, setUploadNotice] = useState<{ tone: 'success' | 'warning'; message: string } | null>(null)
  const [previewUploadUrls, setPreviewUploadUrls] = useState<Record<string, string>>({})
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [insertMenuOpen, setInsertMenuOpen] = useState(false)
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [closeConfirmMode, setCloseConfirmMode] = useState<'save' | 'save-failed'>('save')
  const [draftCloseError, setDraftCloseError] = useState('')
  const [closing, setClosing] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<ComposerEditorHandle | null>(null)

  useEffect(() => {
    if (!open) {
      setTitle('')
      setRaw('')
      setError('')
      setPreview(false)
      setCategoryId(undefined)
      setSelectedTags([])
      setDraftSequence(0)
      draftSequenceRef.current = 0
      lastSavedDraftRef.current = ''
      setDraftKey('')
      setUploading(false)
      setUploadItems([])
      setFailedUploadFiles([])
      setUploadNotice(null)
      setPreviewUploadUrls({})
      setCategoryPickerOpen(false)
      setTagPickerOpen(false)
      setInsertMenuOpen(false)
      setTemplatePickerOpen(false)
      setCloseConfirmOpen(false)
      setCloseConfirmMode('save')
      setDraftCloseError('')
      setClosing(false)
      return
    }
    const action = editPost ? 'edit' : topic ? 'reply' : 'createTopic'
    const key = resumedDraft?.key ?? linuxDoDrafts.keyFor({ action, topicId: topic?.id, postId: editPost?.id })
    setDraftKey(key)
    if (initialRaw) setRaw((previous) => previous || initialRaw)
    if (resumedDraft?.data) {
      setDraftSequence(resumedDraft.sequence)
      draftSequenceRef.current = resumedDraft.sequence
      setRaw(resumedDraft.data.reply)
      setTitle(resumedDraft.data.title || '')
      setCategoryId(resumedDraft.data.categoryId)
      setSelectedTags(decodeTagNames(resumedDraft.data.tags || []))
    } else if (session.authenticated) {
      void linuxDoDrafts.get(key).then((snapshot) => {
        setDraftSequence(snapshot.sequence)
        draftSequenceRef.current = snapshot.sequence
        if (snapshot.data) {
          setRaw((previous) => previous || snapshot.data?.reply || '')
          setTitle((previous) => previous || snapshot.data?.title || '')
          setCategoryId((previous) => previous ?? snapshot.data?.categoryId)
          setSelectedTags((previous) => previous.length ? previous : decodeTagNames(snapshot.data?.tags || []))
        }
      }).catch(() => undefined)
    }
    if (!topic) {
      void Promise.all([linuxDoDiscovery.categories(), linuxDoDiscovery.tags()]).then(([nextCategories, nextTags]) => {
        setCategories(nextCategories)
        setTags(nextTags)
      }).catch(() => undefined)
    }
  }, [open, topic, session.authenticated, initialRaw, editPost, resumedDraft])

  useEffect(() => {
    if (!open || !session.authenticated || !draftKey || (!raw.trim() && !title.trim())) return
    const draftData = buildComposerDraftData({
      mode: editPost ? 'edit' : topic ? 'reply' : 'create',
      title,
      raw,
      categoryId,
      tags: selectedTags,
      postId: editPost?.id,
      replyToPostNumber,
    })
    const fingerprint = JSON.stringify(draftData)
    if (fingerprint === lastSavedDraftRef.current) return
    const timer = window.setTimeout(() => {
      void linuxDoDrafts.save(
        draftKey,
        draftSequenceRef.current,
        draftData,
        'newsnook-linuxdo',
      ).then((nextSequence) => {
        draftSequenceRef.current = nextSequence
        setDraftSequence(nextSequence)
        lastSavedDraftRef.current = fingerprint
      }).catch((nextError) => {
        if (nextError instanceof LinuxDoApiError && nextError.status === 409) {
          setError('草稿已在其他设备更新。当前内容未被覆盖，请关闭后重新打开以加载服务端版本。')
        } else {
          setError(readableError(nextError))
        }
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [open, session.authenticated, draftKey, raw, title, categoryId, selectedTags, topic, editPost, replyToPostNumber])

  useEffect(() => {
    if (!open || !preview || !session.authenticated) return
    const unresolved = linuxDoUploads.shortUrls(raw).filter((shortUrl) => !previewUploadUrls[shortUrl])
    if (!unresolved.length) return
    let active = true
    const timer = window.setTimeout(() => {
      void linuxDoUploads.lookupPreviewUrls(unresolved).then((resolved) => {
        if (!active || !Object.keys(resolved).length) return
        setPreviewUploadUrls((previous) => ({ ...previous, ...resolved }))
      }).catch((nextError) => {
        if (active) setError(`图片预览地址解析失败：${readableError(nextError)}。正文中的上传引用仍会正常提交。`)
      })
    }, 120)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, preview, previewUploadUrls, raw, session.authenticated])

  const searchComposerTags = useCallback((query: string) => {
    const selectedTagIds: Array<string | number> = []
    const selectedTagNames: string[] = []
    for (const name of selectedTags) {
      const match = tags.find((tag) => tag.name === name)
      if (match?.id !== undefined) selectedTagIds.push(match.id)
      else selectedTagNames.push(name)
    }
    return linuxDoDiscovery.searchTags(query, {
      categoryId,
      selectedTagIds,
      selectedTags: selectedTagNames,
      forInput: true,
      prioritizeRecentTags: !query.trim(),
    })
  }, [categoryId, selectedTags, tags])

  const openTemplatePicker = () => {
    if (!session.authenticated) {
      setError('请先登录 Linux.do，模板列表由 LinuxDO 按当前账号权限返回。')
      return
    }
    if (session.currentUser?.canUseTemplates === false) {
      setError('当前 LinuxDO 账号没有可用模板权限。')
      return
    }
    setInsertMenuOpen(false)
    setTemplatePickerOpen(true)
  }

  const insertTemplate = (template: LinuxDoComposerTemplate) => {
    const resolved = resolveLinuxDoTemplate(
      template,
      buildComposerTemplateVariables(topic, session, replyToPostNumber),
    )
    if (!title.trim() && resolved.title.trim()) setTitle(resolved.title.trim())
    editorRef.current?.insertBlock(resolved.content)
    setTemplatePickerOpen(false)
    void linuxDoTemplates.recordUse(template.id).catch((nextError) => {
      setError(`模板已插入，但使用次数同步失败：${readableError(nextError)}`)
    })
  }

  if (!open) return null

  const mode = editPost ? 'edit' : topic ? 'reply' : 'create'
  const validation = validateComposer({ mode, title, raw })
  const selectedCategory = categories.find((category) => category.id === categoryId)
  const hasContent = Boolean(title.trim() || raw.trim() || categoryId || selectedTags.length)
  const requestClose = () => {
    if (sending || closing || uploading) return
    if (hasContent) {
      setCloseConfirmMode('save')
      setDraftCloseError('')
      setCloseConfirmOpen(true)
    } else onClose()
  }

  if (requestCloseRef) requestCloseRef.current = requestClose

  const send = async () => {
    if (!session.authenticated) {
      setError('请先登录 Linux.do')
      return
    }
    if (!validation.canSubmit) {
      setError(mode === 'create' && validation.titleRemaining > 0
        ? `标题还需 ${validation.titleRemaining} 个字`
        : `正文还需 ${validation.bodyRemaining} 个字`)
      return
    }
    setSending(true)
    setError('')
    try {
      if (editPost) {
        const updated = await linuxDoTopics.editPost(editPost.id, raw.trim())
        onEdited?.(updated)
      } else if (topic) {
        const created = await linuxDoTopics.reply(topic.id, raw.trim(), replyToPostNumber)
        onSent(created, 'reply')
      } else {
        const created = await linuxDoTopics.createTopic({ title: title.trim(), raw: raw.trim(), category: categoryId, tags: selectedTags })
        onSent(created, 'create')
      }
      if (draftKey) await linuxDoDrafts.clear(draftKey, draftSequenceRef.current).catch(() => undefined)
      onClose()
    } catch (nextError) {
      setError(readableError(nextError))
    } finally {
      setSending(false)
    }
  }

  const closeAfterSavingDraft = async () => {
    setCloseConfirmOpen(false)
    setCloseConfirmMode('save')
    setDraftCloseError('')
    if (!session.authenticated || !draftKey) {
      onClose()
      return
    }

    const draftData = buildComposerDraftData({
      mode,
      title,
      raw,
      categoryId,
      tags: selectedTags,
      postId: editPost?.id,
      replyToPostNumber,
    })
    const fingerprint = JSON.stringify(draftData)
    if (fingerprint === lastSavedDraftRef.current) {
      onClose()
      return
    }

    setClosing(true)
    setError('')
    try {
      const nextSequence = await linuxDoDrafts.save(draftKey, draftSequenceRef.current, draftData, 'newsnook-linuxdo')
      draftSequenceRef.current = nextSequence
      lastSavedDraftRef.current = fingerprint
      onClose()
    } catch (nextError) {
      const message = nextError instanceof LinuxDoApiError && nextError.status === 409
        ? '草稿已在其他设备更新，NewsNook 不能安全覆盖服务端草稿。'
        : `草稿保存失败：${readableError(nextError)}`
      setDraftCloseError(message)
      setCloseConfirmMode('save-failed')
      setCloseConfirmOpen(true)
    } finally {
      setClosing(false)
    }
  }

  const quotePost = topic?.postStream.posts[0]
  const quoteText = quotePost
    ? (quotePost.raw || new DOMParser().parseFromString(quotePost.cooked, 'text/html').body.textContent || '').trim()
    : undefined

  const chooseFile = () => fileRef.current?.click()

  const startUploadBatch = async (files: File[]) => {
    if (!files.length || uploading) return
    if (files.length > LINUXDO_UPLOAD_BATCH_LIMIT) {
      setError(`一次最多选择 ${LINUXDO_UPLOAD_BATCH_LIMIT} 个文件，请分批上传。`)
      return
    }

    const batchId = Date.now().toString(36)
    setUploading(true)
    setError('')
    setUploadNotice(null)
    setFailedUploadFiles([])
    setUploadItems(files.map((file, index) => ({
      id: `${batchId}-${index}`,
      name: file.name || `文件 ${index + 1}`,
      size: file.size,
      state: 'queued',
      progress: 0,
    })))

    try {
      const results = await linuxDoUploads.uploadMany(files, {
        onProgress: (event) => {
          setUploadItems((previous) => previous.map((item, index) => index === event.index ? {
            ...item,
            state: event.state,
            progress: event.progress,
          } : item))
        },
      })

      const successful = results.filter((result) => result.upload)
      const failed = results.filter((result) => !result.upload).map((result) => result.file)
      setFailedUploadFiles(failed)

      if (successful.length) {
        const nextPreviewUrls: Record<string, string> = {}
        const markdown = successful.map(({ file, upload }) => {
          if (upload?.shortUrl) nextPreviewUrls[upload.shortUrl] = upload.url
          return linuxDoUploads.markdown(upload!, file)
        }).join('\n')
        if (Object.keys(nextPreviewUrls).length) {
          setPreviewUploadUrls((previous) => ({ ...previous, ...nextPreviewUrls }))
        }
        editorRef.current?.insertBlock(markdown)
      }

      if (!failed.length) {
        setUploadNotice({
          tone: 'success',
          message: files.length === 1
            ? '文件上传成功，已插入正文。'
            : `${files.length} 个文件已全部上传，并按选择顺序插入正文。`,
        })
      } else {
        const failedNames = failed.slice(0, 2).map((file) => file.name).join('、')
        setUploadNotice({
          tone: 'warning',
          message: `${successful.length}/${files.length} 上传成功，${failed.length} 个失败${failedNames ? `：${failedNames}${failed.length > 2 ? ' 等' : ''}` : ''}。`,
        })
      }
    } catch (nextError) {
      setError(`上传失败：${readableError(nextError)}`)
      setFailedUploadFiles(files)
      setUploadItems((previous) => previous.map((item) => ({ ...item, state: 'error', progress: 1 })))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="linuxdo-composer absolute inset-0 z-40 flex bg-black/55 sm:items-center sm:justify-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label={editPost ? '编辑帖子' : topic ? '回复主题' : '发布新主题'} className="linuxdo-composer-shell flex h-full min-h-0 w-full flex-col overflow-hidden border-haze bg-ink-raised shadow-2xl sm:h-[min(92dvh,840px)] sm:max-w-4xl sm:rounded-[28px] sm:border">
        <div className="shrink-0 border-b border-haze/60 bg-ink-raised/95 px-3 pt-[max(8px,var(--sat))] backdrop-blur-xl sm:px-5 sm:pt-3">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-paper/15 sm:hidden" aria-hidden />
          <div className="flex min-h-12 items-center gap-3 pb-2.5">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-[18px] font-semibold tracking-[-0.01em] text-paper">{editPost ? '编辑帖子' : topic ? '回复主题' : '发布新主题'}</h3>
              <p className="mt-0.5 truncate text-[10px] text-paper-faint">{topic ? topic.title : editPost ? `帖子 #${editPost.postNumber}` : 'Markdown 与富文本工具 · 自动保存草稿'}</p>
            </div>
            <button type="button" onClick={requestClose} disabled={uploading || sending || closing} className="linuxdo-control grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted disabled:opacity-35" aria-label={uploading ? '文件上传中，暂不能关闭编辑器' : '关闭编辑器'}><X size={17} /></button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden px-3 py-3 sm:px-5 sm:py-4">
        {!topic && !editPost ? (
          <>
            <div className={'linuxdo-composer-title relative shrink-0 rounded-[18px] border bg-ink transition-colors ' + (validation.titleRemaining > 0 && title ? 'border-cinnabar/45' : 'border-haze focus-within:border-cinnabar/45')}>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入标题，清楚说明你想讨论什么" className="h-12 w-full bg-transparent px-3.5 pr-16 text-[14px] font-medium text-paper outline-none placeholder:font-normal placeholder:text-paper-faint" />
              <span className={'absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[9.5px] ' + (validation.titleRemaining > 0 ? 'text-cinnabar-soft' : 'text-paper-faint')}>{validation.titleCount}/6</span>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <button type="button" onClick={() => setCategoryPickerOpen(true)} className="linuxdo-composer-field linuxdo-control flex min-h-11 min-w-0 items-center gap-2 rounded-[16px] border border-haze bg-ink px-3 text-left">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-paper/5 text-paper-faint"><Hash size={13} /></span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-paper-muted">{selectedCategory?.name || '选择分类'}</span>
                <ChevronDown size={13} className="shrink-0 text-paper-faint" />
              </button>
              <button type="button" onClick={() => setTagPickerOpen(true)} className="linuxdo-composer-field linuxdo-control flex min-h-11 min-w-0 items-center gap-2 rounded-[16px] border border-haze bg-ink px-3 text-left">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-paper/5 text-paper-faint"><Hash size={13} /></span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-paper-muted">{selectedTags.length ? selectedTags.map((name) => `#${name}`).join(' · ') : '添加标签'}</span>
                <span className="shrink-0 font-mono text-[9px] text-paper-faint">{selectedTags.length}/5</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-haze/60 bg-paper/[0.035] px-3.5 py-2.5 text-[11.5px] text-paper-muted"><Check size={13} className="text-cinnabar" />{editPost ? '正在编辑 #' + editPost.postNumber : (replyToPostNumber ? `回复 #${replyToPostNumber} · ` : '回复主题 · ') + topic?.title}</div>
        )}
        <ComposerEditor
          ref={editorRef}
          value={raw}
          onChange={setRaw}
          preview={preview}
          onPreviewChange={setPreview}
          placeholder={editPost ? '编辑帖子内容…' : topic ? '写下你的回复…' : '在此输入正文。支持 Markdown、BBCode 与 HTML；也可以用工具栏快速排版。'}
          uploading={uploading}
          uploadItems={uploadItems}
          previewUploadUrls={previewUploadUrls}
          onUpload={chooseFile}
          onOpenInsert={() => setInsertMenuOpen(true)}
          onOpenTemplate={openTemplatePicker}
          footer={<span className={'block truncate whitespace-nowrap font-mono text-[9.5px] ' + (validation.bodyRemaining > 0 ? 'text-cinnabar-soft' : 'text-paper-faint')}>{validation.bodyCount}/20{draftSequence > 0 ? ' · 草稿已保存' : ''}</span>}
        />
        <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,.pdf,.zip,.txt" onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.currentTarget.value = ''
          if (!files.length) return
          void startUploadBatch(files)
        }} />
        {uploadNotice ? (
          <div role={uploadNotice.tone === 'warning' ? 'alert' : 'status'} aria-live="polite" className={'flex shrink-0 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-[10.5px] ' + (uploadNotice.tone === 'warning' ? 'border-cinnabar/25 bg-cinnabar/[0.06] text-cinnabar-soft' : 'border-haze/60 bg-paper/[0.035] text-paper-muted')}>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {uploadNotice.tone === 'warning' ? <TriangleAlert size={12} className="shrink-0" /> : <Check size={12} className="shrink-0 text-cinnabar-soft" />}
              <span className="truncate">{uploadNotice.message}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {failedUploadFiles.length ? <button type="button" disabled={uploading} onClick={() => void startUploadBatch(failedUploadFiles)} className="linuxdo-control rounded-full bg-paper/[0.06] px-2.5 py-1 text-[9.5px] font-medium text-paper disabled:opacity-40">重试失败项</button> : null}
              <button type="button" onClick={() => setPreview(true)} className="linuxdo-control rounded-full bg-paper/[0.05] px-2.5 py-1 text-[9.5px] font-medium text-paper">预览</button>
            </span>
          </div>
        ) : null}
        {error ? <button type="button" onClick={() => setError('')} className="linuxdo-control shrink-0 rounded-xl border border-cinnabar/20 bg-cinnabar/8 px-3 py-2 text-left text-[10.5px] leading-relaxed text-cinnabar-soft">{error} · 点击关闭</button> : null}
        <div className="flex shrink-0 items-center justify-between gap-3 pb-[max(4px,var(--sab))] sm:pb-0">
          <span className="min-w-0 flex-1 truncate text-[9.5px] text-paper-faint">写操作不会自动重试 · 发布前请在预览中检查</span>
          <button type="button" disabled={sending || closing || uploading || !validation.canSubmit} onClick={() => void send()} className="linuxdo-control inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-cinnabar px-5 text-[12px] font-semibold text-white shadow-[0_8px_24px_color-mix(in_srgb,var(--color-cinnabar)_24%,transparent)] disabled:opacity-35">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {editPost ? '保存' : topic ? '回复' : '发布'}
          </button>
        </div>
        </div>
      </div>

      <CategoryPickerSheet open={categoryPickerOpen} categories={categories} value={categoryId} onChange={setCategoryId} onClose={() => setCategoryPickerOpen(false)} />
      <TagPickerSheet open={tagPickerOpen} tags={tags} value={selectedTags} onChange={setSelectedTags} onSearch={searchComposerTags} onClose={() => setTagPickerOpen(false)} />
      <InsertMenuSheet
        open={insertMenuOpen}
        canQuotePost={Boolean(topic && quotePost)}
        canUseTemplates={Boolean(session.authenticated && session.currentUser?.canUseTemplates === true)}
        onOpenTemplate={openTemplatePicker}
        onClose={() => setInsertMenuOpen(false)}
        onSelect={(kind) => editorRef.current?.insertSnippet(kind, {
          topicId: topic?.id,
          postNumber: quotePost?.postNumber,
          username: quotePost?.username,
          quotedRaw: quoteText,
        })}
      />
      <TemplatePickerSheet
        open={templatePickerOpen}
        onInsert={insertTemplate}
        onOpenSource={(template) => void openExternal(`https://linux.do/t/${encodeURIComponent(template.slug || 'topic')}/${template.id}`)}
        onClose={() => setTemplatePickerOpen(false)}
      />
      <ConfirmDialog
        open={closeConfirmOpen}
        title={closeConfirmMode === 'save-failed' ? '草稿保存失败' : '关闭编辑器？'}
        message={closeConfirmMode === 'save-failed'
          ? <><span>{draftCloseError}</span><br /><span>当前内容仍保留在编辑器中。可以继续编辑后再次关闭重试保存；也可以直接关闭，但本次未保存的修改会丢失。</span></>
          : session.authenticated
            ? '关闭前会先尝试保存到 LinuxDO 草稿；如果保存失败，你仍可以选择直接关闭。'
            : '当前未登录，关闭后输入内容不会保留。'}
        confirmLabel={closeConfirmMode === 'save-failed' || !session.authenticated ? '直接关闭' : '保存并关闭'}
        cancelLabel="继续编辑"
        onConfirm={() => {
          if (closeConfirmMode === 'save-failed') {
            setCloseConfirmOpen(false)
            setDraftCloseError('')
            onClose()
            return
          }
          void closeAfterSavingDraft()
        }}
        onCancel={() => {
          if (closeConfirmMode === 'save-failed' && draftCloseError) {
            setError(`${draftCloseError}。当前内容仍保留在编辑器中。`)
          }
          setCloseConfirmOpen(false)
          setCloseConfirmMode('save')
          setDraftCloseError('')
        }}
      />
    </div>
  )
}

export function LinuxDoBoostComposer({ post, onClose, onCreated }: { post: LinuxDoPost; onClose: () => void; onCreated: (post: LinuxDoPost, boost: LinuxDoBoost) => void }) {
  const [raw, setRaw] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const remaining = 16 - Array.from(raw).length

  const send = async () => {
    const text = raw.trim()
    if (!text || remaining < 0) return
    setSending(true)
    setError('')
    try {
      const created = await linuxDoInteractions.boost(post.id, text)
      onCreated(post, created)
      onClose()
    } catch (nextError) {
      setError('Boost 发送失败：' + readableError(nextError) + '。内容已保留，可直接重试。')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/55 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-[26px] border border-haze bg-ink-raised p-4 pb-[max(18px,var(--sab))] shadow-2xl sm:max-w-md sm:rounded-[26px]">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-[15px] font-semibold text-paper"><Rocket size={15} className="text-cinnabar-soft" />Boost</h3>
            <p className="mt-1 text-[10.5px] text-paper-faint">对 #{post.postNumber} 留下最多 16 个字符的轻量回应</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="linuxdo-control grid h-9 w-9 place-items-center rounded-full bg-paper/6 text-paper-muted disabled:opacity-35" aria-label={sending ? 'Boost 发送中' : '关闭 Boost 编辑器'}><X size={15} /></button>
        </div>
        <textarea
          autoFocus
          value={raw}
          onChange={(event) => { setRaw(event.target.value); if (error) setError('') }}
          rows={3}
          placeholder="写点简短的…"
          className="mt-4 w-full resize-none rounded-2xl border border-haze bg-ink px-4 py-3 text-[13px] leading-6 text-paper outline-none placeholder:text-paper-faint focus:border-cinnabar/50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className={remaining < 0 ? 'text-[10px] text-cinnabar-soft' : 'text-[10px] text-paper-faint'}>{remaining} 字</span>
          <button type="button" disabled={sending || !raw.trim() || remaining < 0} onClick={() => void send()} className="linuxdo-control inline-flex items-center gap-2 rounded-full bg-cinnabar px-4 py-2 text-[11.5px] font-medium text-white disabled:opacity-40">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}
            {sending ? '发送中…' : 'Boost'}
          </button>
        </div>
        {error ? (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-cinnabar/25 bg-cinnabar/[0.07] px-3 py-2.5 text-[10.5px] leading-5 text-cinnabar-soft">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function LinuxDoTopicView({
  summary,
  session,
  onBack,
  onCompose,
  onBoost,
  onOpenUser,
  onOpenTopic,
  onOpenTag,
  onOpenCategory,
  categoriesById,
  onEdit,
  targetPostNumber,
  postMutation,
  overlayBackHandlerRef,
  onReadProgress,
  onSession,
}: {
  summary: LinuxDoTopicSummary
  session: LinuxDoSessionSnapshot
  onBack: () => void
  onCompose: (topic: LinuxDoTopic, options?: { initialRaw?: string; replyToPostNumber?: number }) => void
  onBoost: (post: LinuxDoPost) => void
  onOpenUser: (username: string) => void
  onOpenTopic: (topic: LinuxDoTopicSummary, targetPostNumber?: number) => void
  onOpenTag: (name: string) => void
  onOpenCategory?: (category: LinuxDoCategory) => void
  categoriesById?: Record<number, LinuxDoCategory>
  onEdit: (topic: LinuxDoTopic, post: LinuxDoPost) => void
  targetPostNumber?: number
  postMutation?: LinuxDoPost
  overlayBackHandlerRef: MutableRefObject<(() => boolean) | null>
  onReadProgress?: (topicId: number, highestSeen: number) => void
  onSession?: (session: LinuxDoSessionSnapshot) => void
}) {
  const [categoryMap, setCategoryMap] = useState<Record<number, LinuxDoCategory>>(categoriesById ?? {})
  useEffect(() => {
    if (categoriesById && Object.keys(categoriesById).length > 0) {
      setCategoryMap(categoriesById)
      return
    }
    void linuxDoDiscovery.categories().then((cats) => {
      setCategoryMap(Object.fromEntries(cats.map((c) => [c.id, c])))
    }).catch(() => undefined)
  }, [categoriesById])
  const [topic, setTopic] = useState<LinuxDoTopic | null>(null)
  const [posts, setPosts] = useState<LinuxDoPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [jumpingPostNumber, setJumpingPostNumber] = useState<number | undefined>()
  const [lightbox, setLightbox] = useState<{ items: Array<{ src: string; actionSrc?: string; alt: string }>; index: number } | null>(null)
  const [returnPostNumber, setReturnPostNumber] = useState<number | undefined>()
  const [actionMenu, setActionMenu] = useState<{ anchor: Point; post: LinuxDoPost } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingPostIds, setPendingPostIds] = useState<Set<number>>(new Set())
  const [readPostNumbers, setReadPostNumbers] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<LinuxDoPost | null>(null)
  const [notificationPickerOpen, setNotificationPickerOpen] = useState(false)
  const toastTimerRef = useRef<number | null>(null)
  const topicScrollerRef = useRef<HTMLDivElement | null>(null)
  const readTrackerRef = useRef<LinuxDoReadTracker | null>(null)
  const [readSyncFailure, setReadSyncFailure] = useState<ReadSyncFailure | null>(null)
  const [readSyncBusy, setReadSyncBusy] = useState(false)
  const visibleReadKeyRef = useRef('')
  const userId = session.authenticated ? session.currentUser?.id : undefined
  const [openingPosition, setOpeningPosition] = useState<LinuxDoTopicPosition | undefined>()
  const openingUnreadFloorRef = useRef(linuxDoOpeningUnreadFloor(summary))
  const loadRequestRef = useRef(0)
  const preservePosition = useTopicPosition(summary.id, userId, topicScrollerRef, openingPosition, posts, !loading && !error && topic?.id === summary.id)

  const syncVisibleReadPosts = useCallback(() => {
    const root = topicScrollerRef.current
    const tracker = readTrackerRef.current
    if (!root || !tracker) return
    const viewport = root.getBoundingClientRect()
    const visible = new Set<number>()
    const readVisible = new Set<number>()
    root.querySelectorAll<HTMLElement>('article[data-linuxdo-post-number]').forEach((element) => {
      const postNumber = Number(element.dataset.linuxdoPostNumber)
      if (!Number.isInteger(postNumber) || postNumber <= 0) return
      const rect = element.getBoundingClientRect()
      const overlap = Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top)
      const required = Math.min(32, Math.max(1, rect.height * 0.2))
      if (overlap >= required) {
        visible.add(postNumber)
        if (element.dataset.linuxdoRead === 'true') readVisible.add(postNumber)
      }
    })
    tracker.setVisiblePosts(visible, readVisible)
    const key = Array.from(visible).sort((a, b) => a - b).join(',')
    if (key !== visibleReadKeyRef.current) {
      visibleReadKeyRef.current = key
      log.sync.debug('LinuxDO read tracker visible posts', { posts: Array.from(visible).sort((a, b) => a - b) })
    }
  }, [])

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 2000)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    }
  }, [])

  const toggleLike = useCallback(async (post: LinuxDoPost) => {
    if (!session.authenticated || pendingPostIds.has(post.id)) return
    const previousPost = post
    const like = post.actions.find((action) => action.id === 2)
    const nextActed = !like?.acted
    setPendingPostIds((previous) => new Set(previous).add(post.id))
    setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? {
      ...candidate,
      actions: candidate.actions.some((action) => action.id === 2)
        ? candidate.actions.map((action) => action.id === 2 ? { ...action, acted: nextActed, count: Math.max(0, (action.count ?? 0) + (nextActed ? 1 : -1)) } : action)
        : candidate.actions.concat({ id: 2, acted: true, count: 1, canAct: true }),
    } : candidate))
    try {
      if (like?.acted) await linuxDoInteractions.unlike(post.id)
      else await linuxDoInteractions.like(post.id)
    } catch (nextError) {
      setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? previousPost : candidate))
      showToast('操作失败：' + readableError(nextError))
    } finally {
      setPendingPostIds((previous) => {
        const next = new Set(previous)
        next.delete(post.id)
        return next
      })
    }
  }, [pendingPostIds, session.authenticated, showToast])

  const toggleBookmark = useCallback(async (post: LinuxDoPost) => {
    if (!session.authenticated || pendingPostIds.has(post.id)) return
    const previousPost = post
    const nextBookmarked = !post.bookmarked
    setPendingPostIds((previous) => new Set(previous).add(post.id))
    setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, bookmarked: nextBookmarked } : candidate))
    try {
      if (post.bookmarked && post.bookmarkId) {
        await linuxDoInteractions.deleteBookmark(post.bookmarkId)
        setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, bookmarked: false, bookmarkId: undefined, bookmarkName: undefined, bookmarkReminderAt: undefined } : candidate))
        showToast('已取消收藏')
      } else {
        const created = await linuxDoInteractions.bookmarkPost(post.id)
        const bookmarkId = Number(created?.id ?? created?.bookmark?.id ?? 0)
        setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? { ...candidate, bookmarked: true, bookmarkId: bookmarkId > 0 ? bookmarkId : candidate.bookmarkId } : candidate))
        showToast('已加入书签')
      }
    } catch (nextError) {
      setPosts((previous) => previous.map((candidate) => candidate.id === post.id ? previousPost : candidate))
      showToast('收藏操作失败：' + readableError(nextError))
    } finally {
      setPendingPostIds((previous) => {
        const next = new Set(previous)
        next.delete(post.id)
        return next
      })
    }
  }, [pendingPostIds, session.authenticated, showToast])

  const deletePost = useCallback(async (post: LinuxDoPost) => {
    setDeleteTarget(post)
  }, [])

  const confirmDeletePost = useCallback(async () => {
    const post = deleteTarget
    if (!post || pendingPostIds.has(post.id)) return
    setPendingPostIds((previous) => new Set(previous).add(post.id))
    try {
      await linuxDoTopics.deletePost(post.id)
      setPosts((previous) => previous.filter((candidate) => candidate.id !== post.id))
      setDeleteTarget(null)
      showToast('帖子已删除')
    } catch (nextError) {
      showToast('删除失败：' + readableError(nextError))
    } finally {
      setPendingPostIds((previous) => {
        const next = new Set(previous)
        next.delete(post.id)
        return next
      })
    }
  }, [deleteTarget, pendingPostIds, showToast])

  useEffect(() => {
    if (!lightbox) return
    for (const item of [lightbox.items[lightbox.index - 1], lightbox.items[lightbox.index + 1]]) {
      if (!item?.src) continue
      const image = new Image()
      image.referrerPolicy = 'no-referrer'
      image.src = item.src
    }
  }, [lightbox])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setReadPostNumbers(new Set())
    setReadSyncFailure(null)
    const request = ++loadRequestRef.current
    const local = linuxDoTopicPositionOf(summary.id, userId)
    let position = targetPostNumber ? { postNumber: targetPostNumber, offset: 0 } : local
    try {
      const requestedPostNumber = position?.postNumber
      let next = await linuxDoTopics.get(summary.slug, summary.id, requestedPostNumber)
      if (!position && session.authenticated) position = linuxDoServerResumePosition(next)
      if (position && position.postNumber !== requestedPostNumber && !next.postStream.posts.some(post => post.postNumber === position?.postNumber)) {
        next = await linuxDoTopics.get(summary.slug, summary.id, position.postNumber)
      }
      if (request !== loadRequestRef.current) return
      setOpeningPosition(position)
      setTopic(next)
      let initialPosts = next.postStream.posts
      // Keep a deep opening window contiguous; earlier replies are loaded on upward scroll.
      if (!position || position.postNumber === 1) {
        const present = new Set(initialPosts.map(post => post.id))
        const firstBatch = next.postStream.stream.filter(id => !present.has(id)).slice(0, 40)
        if (firstBatch.length) {
          const extra = await linuxDoTopics.loadPosts(next.id, firstBatch)
          initialPosts = initialPosts.concat(extra).sort((a, b) => a.postNumber - b.postNumber)
        }
      }
      if (request === loadRequestRef.current) setPosts(initialPosts)
    } catch (nextError) {
      if (request === loadRequestRef.current) setError(nextError)
    } finally {
      if (request === loadRequestRef.current) setLoading(false)
    }
  }, [summary.id, summary.slug, targetPostNumber, userId, session.authenticated])

  useEffect(() => {
    void load()
    return () => { loadRequestRef.current += 1 }
  }, [load])

  useEffect(() => {
    if (!session.authenticated || !topic?.id || topic.id !== summary.id) return
    const tracker = new LinuxDoReadTracker({
      send: async (batch) => {
        log.sync.info('LinuxDO timings sending', {
          topicId: batch.topicId,
          topicTime: batch.topicTime,
          postNumbers: Object.keys(batch.timings).map(Number),
          timings: batch.timings,
          transport: 'session-chain',
        })
        await linuxDoTopics.reportTimings(batch.topicId, batch.topicTime, batch.timings)
        log.sync.info('LinuxDO timings acknowledged', {
          topicId: batch.topicId,
          postNumbers: Object.keys(batch.timings).map(Number),
        })
      },
      onSent: (topicId, highestSeen, postNumbers) => {
        if (readTrackerRef.current === tracker) {
          log.sync.info('LinuxDO read state applied', { topicId, highestSeen, postNumbers })
          setReadSyncFailure(null)
          const acknowledged = new Set(postNumbers)
          // Match Discourse topicController.readPosts(): the authoritative post
          // model itself becomes read after /topics/timings succeeds. Keeping the
          // separate session set as well makes the state robust while pages are
          // incrementally loaded or reconciled.
          setPosts((current) => current.map((post) => acknowledged.has(post.postNumber) ? { ...post, read: true } : post))
          setReadPostNumbers((current) => {
            const next = new Set(current)
            postNumbers.forEach((postNumber) => next.add(postNumber))
            return next
          })
          setTopic((current) => current?.id === topicId ? applyLinuxDoTopicReadProgress(current, highestSeen) : current)
        }
        // The parent cache is safe to advance even if this view was just closed:
        // the server has already accepted the timing batch at this point.
        onReadProgress?.(topicId, highestSeen)
      },
      onError: (nextError, batch, retrying) => {
        if (readTrackerRef.current !== tracker) return
        setReadSyncFailure({ error: nextError, batch, retrying })
        const status = nextError instanceof LinuxDoApiError ? nextError.status : undefined
        log.sync.warn('LinuxDO timings failed', {
          topicId: batch.topicId,
          postNumbers: Object.keys(batch.timings).map(Number),
          status,
          retrying,
          error: readableError(nextError),
          diagnostics: nextError instanceof LinuxDoApiError ? nextError.diagnostics : undefined,
        })
      },
    })
    readTrackerRef.current = tracker
    tracker.start(topic.id)

    const syncVisibility = () => tracker.setFocused(document.visibilityState !== 'hidden')
    const handleFocus = () => tracker.setFocused(document.visibilityState !== 'hidden')
    const handleBlur = () => tracker.setFocused(false)
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      tracker.stop()
      if (readTrackerRef.current === tracker) readTrackerRef.current = null
    }
  }, [onReadProgress, session.authenticated, session.currentUser?.id, summary.id, topic?.id])

  useEffect(() => {
    if (!session.authenticated || !topic?.id || !posts.length) return
    const root = topicScrollerRef.current
    if (!root || !readTrackerRef.current) return

    const frame = window.requestAnimationFrame(syncVisibleReadPosts)
    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(() => syncVisibleReadPosts(), {
        root,
        threshold: [0, 0.2, 0.5, 1],
      })
      root.querySelectorAll<HTMLElement>('article[data-linuxdo-post-number]').forEach((element) => observer?.observe(element))
    }
    window.addEventListener('resize', syncVisibleReadPosts)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', syncVisibleReadPosts)
    }
  }, [posts, session.authenticated, syncVisibleReadPosts, topic?.id])

  useEffect(() => {
    if (!postMutation || (postMutation.topicId && postMutation.topicId !== topic?.id)) return
    setPosts((previous) => {
      const exists = previous.some((post) => post.id === postMutation.id)
      return (exists
        ? previous.map((post) => post.id === postMutation.id ? { ...post, ...postMutation } : post)
        : previous.concat(postMutation)).sort((a, b) => a.postNumber - b.postNumber)
    })
  }, [postMutation, topic?.id])

  const jumpToPost = useCallback(async (postNumber: number, fromPostNumber?: number) => {
    const request = loadRequestRef.current
    if (fromPostNumber) setReturnPostNumber(fromPostNumber)
    setJumpingPostNumber(postNumber)
    if (!posts.some((post) => post.postNumber === postNumber)) {
      try {
        const windowTopic = await linuxDoTopics.get(summary.slug, summary.id, postNumber)
        if (request !== loadRequestRef.current) return
        setPosts((previous) => {
          const byId = new Map(previous.map((post) => [post.id, post]))
          for (const post of windowTopic.postStream.posts) byId.set(post.id, post)
          return Array.from(byId.values()).sort((a, b) => a.postNumber - b.postNumber)
        })
      } catch (nextError) {
        if (request !== loadRequestRef.current) return
        setError(nextError)
        setJumpingPostNumber(undefined)
        return
      }
    }
    window.setTimeout(() => {
      if (request !== loadRequestRef.current) return
      topicScrollerRef.current?.querySelector<HTMLElement>('#linuxdo-post-' + postNumber)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setJumpingPostNumber(undefined)
    }, 80)
  }, [posts, summary.id, summary.slug])

  const recoverReadSession = async () => {
    const tracker = readTrackerRef.current
    if (!tracker || readSyncBusy) return
    setReadSyncBusy(true)
    try {
      const error = readSyncFailure?.error
      const readSyncChallenge = error instanceof LinuxDoApiError && error.kind === 'browser-verification'
        && error.diagnostics?.transport === 'browser-firstparty'
      const next = await verifyLinuxDoBrowserSession('https://linux.do/', { readSyncChallenge })
      if (!next.authenticated || !next.currentUser) throw new Error('请先完成 Linux.do 登录')
      if (next.currentUser.id !== session.currentUser?.id) {
        tracker.stop(false)
        linuxDoApi.setSession(next)
        onSession?.(next)
        onBack()
        return
      }
      linuxDoApi.setSession(next)
      onSession?.(next)
      if (readTrackerRef.current === tracker) {
        setReadSyncFailure(current => current ? { ...current, retrying: true } : null)
        tracker.resume()
      }
    } catch (nextError) {
      showToast('会话恢复未完成：' + readableError(nextError))
    } finally { setReadSyncBusy(false) }
  }

  return (
    <div data-linuxdo-topic-view className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-haze/45 bg-ink/90 page-x backdrop-blur-2xl">
        <button
          type="button"
          onClick={onBack}
          className="linuxdo-control grid h-8 w-8 shrink-0 place-items-center rounded-full bg-paper/[0.05] text-paper-muted hover:bg-paper/10 hover:text-paper transition active:scale-90"
          aria-label="返回"
        >
          <ArrowLeft size={16} />
        </button>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="truncate text-[13.5px] font-semibold text-paper leading-tight">{summary.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-paper-faint">
            <span>{String(summary.replyCount) + ' 回复'}</span>
            <span aria-hidden="true">·</span>
            <span>{compact(summary.views) + ' 浏览'}</span>
          </div>
        </div>

        {topic && session.authenticated ? (
          <>
            <button
              type="button"
              onClick={() => setNotificationPickerOpen(true)}
              className="linuxdo-control rounded-full border border-haze/60 bg-paper/[0.03] px-2.5 py-1 text-[10px] font-medium text-paper-muted transition-colors hover:border-cinnabar/35 active:scale-95"
            >
              {['静音', '普通', '跟踪', '关注'][topic.details?.notificationLevel ?? 1] || '普通'}
            </button>
            <OptionPickerDialog
              open={notificationPickerOpen}
              title="主题通知"
              value={String(topic.details?.notificationLevel ?? 1)}
              options={[{ id: '0', label: '静音' }, { id: '1', label: '普通' }, { id: '2', label: '跟踪' }, { id: '3', label: '关注' }]}
              onCancel={() => setNotificationPickerOpen(false)}
              onChange={(value) => {
                const nextLevel = Number(value)
                const previous = topic.details?.notificationLevel ?? 1
                setNotificationPickerOpen(false)
                setTopic({ ...topic, details: { ...topic.details, notificationLevel: nextLevel } })
                void linuxDoTopics.setNotificationLevel(topic.id, nextLevel).then(() => showToast('通知设置已更新')).catch((nextError) => {
                  setTopic((current) => current ? { ...current, details: { ...current.details, notificationLevel: previous } } : current)
                  showToast('通知设置失败：' + readableError(nextError))
                })
              }}
            />
          </>
        ) : null}

        {topic ? (
          <button
            type="button"
            onClick={() => onCompose(topic)}
            className="linuxdo-control inline-flex items-center gap-1 rounded-full bg-cinnabar px-3 py-1.5 text-[11px] font-semibold text-white shadow-xs shadow-cinnabar/20 active:scale-95"
          >
            <MessageCircle size={12.5} />
            <span>回复</span>
          </button>
        ) : null}
      </div>

      {readSyncFailure ? <ReadSyncStatus
        failure={readSyncFailure}
        busy={readSyncBusy}
        onRetry={() => readTrackerRef.current?.resume()}
        onVerify={() => void recoverReadSession()}
        onCopy={() => {
          if (!navigator.clipboard?.writeText) { showToast('复制不可用，请截图保留错误信息'); return }
          void navigator.clipboard.writeText(readSyncDiagnostic(readSyncFailure))
            .then(() => showToast('已复制阅读同步诊断'))
            .catch(() => showToast('复制失败，请截图保留上方错误信息'))
        }}
      /> : null}
      <div ref={topicScrollerRef} data-linuxdo-topic-scroller className="min-h-0 flex-1 overflow-y-auto overscroll-contain page-x pb-4" onScroll={(event) => {
        readTrackerRef.current?.scrolled()
        if (typeof IntersectionObserver === 'undefined') syncVisibleReadPosts()
        if (!topic || loading || loadingPosts) return
        const node = event.currentTarget
        let remaining = adjacentLinuxDoPostIds(topic.postStream.stream, posts, 'gap')
        if (!remaining.length) {
          const direction = node.scrollTop < 80 ? 'before'
            : node.scrollHeight - node.scrollTop - node.clientHeight < 500 ? 'after' : undefined
          if (!direction) return
          remaining = adjacentLinuxDoPostIds(topic.postStream.stream, posts, direction)
        }
        if (!remaining.length) return
        const request = loadRequestRef.current
        setLoadingPosts(true)
        void linuxDoTopics.loadPosts(topic.id, remaining).then((extra) => {
          if (request !== loadRequestRef.current) return
          preservePosition()
          setPosts((previous) => previous.concat(extra).sort((a, b) => a.postNumber - b.postNumber))
        }).catch(nextError => {
          if (request === loadRequestRef.current) showToast('回复加载失败：' + readableError(nextError))
        }).finally(() => { if (request === loadRequestRef.current) setLoadingPosts(false) })
      }}>
        {loading ? <div className="space-y-2.5 sm:space-y-3 py-4 sm:py-5" role="status" aria-label="正在加载主题回复">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-xl sm:rounded-2xl border border-haze/50 bg-ink-raised/35 p-3 sm:p-4"><div className="flex items-center gap-2.5 sm:gap-3"><div className="linuxdo-skeleton h-8 w-8 sm:h-9 sm:w-9 rounded-full" /><div className="flex-1"><div className="linuxdo-skeleton h-3 w-28 rounded" /><div className="linuxdo-skeleton mt-2 h-2.5 w-20 rounded" /></div></div><div className="linuxdo-skeleton mt-4 sm:mt-5 h-3 w-[92%] rounded" /><div className="linuxdo-skeleton mt-2.5 sm:mt-3 h-3 w-[76%] rounded" /><div className="linuxdo-skeleton mt-2.5 sm:mt-3 h-28 sm:h-32 rounded-lg sm:rounded-xl" /></div>)}</div> : null}
        {error ? <div className="py-24 text-center text-[13px] text-paper-muted">{readableError(error)}</div> : null}
        {topic ? (
          <>
            <header className="px-1.5 sm:px-0 py-3.5 sm:py-5 border-b border-haze/30 mb-2.5 sm:mb-3">
              <h1 className="font-sans font-bold text-[20px] sm:text-[22px] leading-[1.32] tracking-[-0.015em] text-paper">{topic.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {(() => {
                  const catId = topic.categoryId ?? summary.categoryId
                  const category = catId ? categoryMap[catId] : undefined
                  if (!category) return null
                  const catColor = category.color ? (category.color.startsWith('#') ? category.color : '#' + category.color) : undefined
                  return (
                    <button
                      type="button"
                      onClick={() => onOpenCategory?.(category)}
                      className="linuxdo-control group inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all duration-150 active:scale-95"
                      style={{
                        backgroundColor: catColor ? `color-mix(in srgb, ${catColor} 15%, transparent)` : 'color-mix(in srgb, var(--color-paper) 8%, transparent)',
                        color: catColor || 'var(--color-paper)',
                      }}
                    >
                      <span className="font-mono text-[11px] font-bold opacity-90">
                        {category.slug === 'develop' ? '</>' : '■'}
                      </span>
                      <span>{category.name}</span>
                    </button>
                  )
                })()}
                {topic.tags.map((name) => {
                  const glyph = tagGlyph(name)
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => onOpenTag(name)}
                      className="linuxdo-control inline-flex items-center gap-1 rounded-md border border-haze/70 bg-paper/[0.04] px-2.5 py-1 text-[11px] font-medium text-paper-muted transition-all duration-150 hover:border-cinnabar/30 hover:bg-paper/[0.08] hover:text-paper active:scale-95"
                    >
                      {glyph ? (
                        <span className="text-[10px] leading-none">{glyph}</span>
                      ) : (
                        <span className="font-mono text-[10px] text-paper-faint">#</span>
                      )}
                      <span>{name}</span>
                    </button>
                  )
                })}
              </div>
            </header>
            <div className="space-y-2.5 sm:space-y-3">
              {posts.map((post) => {
                const like = post.actions.find((action) => action.id === 2)
                const replyTarget = resolveReplyTarget(post, posts)
                const readByServerCursor = post.read === undefined && typeof topic.lastReadPostNumber === 'number' && post.postNumber <= topic.lastReadPostNumber
                const unreadAtOpen = openingUnreadFloorRef.current !== undefined && post.postNumber > openingUnreadFloorRef.current
                const showUnreadDot = session.authenticated && !readPostNumbers.has(post.postNumber) && (unreadAtOpen || (post.read !== true && !readByServerCursor))
                const isTopicOwner = (summary?.posters?.[0]?.username && summary.posters[0].username === post.username) || post.postNumber === 1
                return (
                  <article key={post.id} id={'linuxdo-post-' + post.postNumber} data-linuxdo-post-number={post.postNumber} data-linuxdo-read={showUnreadDot ? 'false' : 'true'} className="group rounded-xl sm:rounded-2xl border border-haze/45 bg-ink-raised/85 p-3 sm:p-4 shadow-[0_1px_3px_rgba(0,0,0,0.03)] backdrop-blur-sm transition-all duration-150 hover:border-paper/[0.12]">
                    <header className="linuxdo-control flex items-start gap-2.5 sm:gap-3 select-none">
                      <button type="button" onClick={() => onOpenUser(post.username)} className="relative mt-0.5 flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-black/5 dark:ring-white/10 bg-ink-deep transition-transform active:scale-95">
                        {avatar(post.avatarTemplate, post.username)}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => onOpenUser(post.username)} className="truncate text-[13.5px] font-semibold text-paper hover:underline">
                            {post.name || post.username}
                          </button>
                          {isTopicOwner && (
                            <span className="shrink-0 rounded-[5px] bg-cinnabar/12 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-cinnabar dark:bg-cinnabar/20 dark:text-cinnabar-soft">
                              楼主
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-paper-faint">
                          <span className="truncate">{'@' + post.username}</span>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0">{ago(post.createdAt)}</span>
                          {session.authenticated ? (
                            <span
                              data-linuxdo-unread-dot
                              className={'h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400 ring-1 ring-sky-400/20 transition-[opacity,transform] duration-300 ease-out ' + (showUnreadDot ? 'scale-100 opacity-100' : 'scale-75 opacity-0')}
                              role={showUnreadDot ? 'status' : undefined}
                              aria-label={showUnreadDot ? '帖子 #' + post.postNumber + ' 未读' : undefined}
                              aria-hidden={showUnreadDot ? undefined : true}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                        {post.replyToPostNumber && replyTarget ? (
                          <button
                            type="button"
                            onClick={() => void jumpToPost(post.replyToPostNumber!, post.postNumber)}
                            className="linuxdo-control inline-flex max-w-28 sm:max-w-32 items-center gap-1 rounded-full border border-haze/60 bg-paper/[0.03] py-0.5 pl-1 pr-2 text-[10px] text-paper-muted transition-colors hover:border-cinnabar/30 hover:text-cinnabar"
                            aria-label={'跳转到 ' + replyTarget.username + ' 的帖子 #' + post.replyToPostNumber}
                          >
                            <Reply size={11} className="shrink-0 text-cinnabar-soft" />
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-deep">
                              {avatar(replyTarget.avatarTemplate, replyTarget.username)}
                            </span>
                            <span className="truncate">{replyTarget.name || replyTarget.username}</span>
                            <span className="font-mono text-[9px] text-paper-faint">#{post.replyToPostNumber}</span>
                          </button>
                        ) : null}
                        <span className="font-mono text-[11px] font-medium text-paper-faint/70 tracking-tight">
                          {'#' + post.postNumber}
                        </span>
                      </div>
                    </header>
                    <LinuxDoPostBody html={post.cooked} onClick={(event) => {
                      const target = event.target as HTMLElement
                      const imageRole = target instanceof HTMLImageElement ? target.dataset.linuxdoRole : undefined
                      if (imageRole === 'emoji') return
                      if (target instanceof HTMLImageElement && target.src && imageRole === 'content-image') {
                        event.preventDefault()
                        event.stopPropagation()
                        const scope = event.currentTarget.closest<HTMLElement>('[data-linuxdo-topic-view]') ?? event.currentTarget
                        const images = Array.from(scope.querySelectorAll<HTMLImageElement>('img[data-linuxdo-role="content-image"]'))
                          .filter((image) => Boolean(image.src))
                          .map((image) => ({
                            src: image.src,
                            actionSrc: image.dataset.linuxdoOriginalSrc || image.src,
                            alt: image.alt || post.topicTitle || topic.title,
                          }))
                        const currentIndex = Math.max(0, images.findIndex((image) => image.src === target.src))
                        setLightbox({ items: images.length ? images : [{ src: target.src, actionSrc: target.dataset.linuxdoOriginalSrc || target.src, alt: target.alt || post.topicTitle || topic.title }], index: currentIndex })
                        return
                      }

                      const spoiler = target.closest<HTMLElement>('[data-linuxdo-role="spoiler"]')
                      if (spoiler) {
                        event.preventDefault()
                        event.stopPropagation()
                        spoiler.dataset.linuxdoRevealed = spoiler.dataset.linuxdoRevealed === 'true' ? 'false' : 'true'
                        return
                      }

                      const quoteCategory = target.closest<HTMLElement>('[data-linuxdo-role="quote-category"]')
                      if (!quoteCategory) {
                        const quoteHeader = target.closest<HTMLElement>('[data-linuxdo-role="quote-header"]')
                        if (quoteHeader) {
                          const quote = quoteHeader.closest<HTMLElement>('[data-linuxdo-role="quote"]')
                          const quotedPost = Number(quote?.dataset.linuxdoPostNumber || 0)
                          const quotedTopic = Number(quote?.dataset.linuxdoTopicId || topic.id)
                          if (quotedPost > 0) {
                            event.preventDefault()
                            event.stopPropagation()
                            if (!quotedTopic || quotedTopic === topic.id) void jumpToPost(quotedPost, post.postNumber)
                            else onOpenTopic({ id: quotedTopic, slug: 'topic', title: quote?.dataset.linuxdoUsername ? '@' + quote.dataset.linuxdoUsername + ' 的引用' : '引用主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: '', lastPostedAt: '', tags: [], posters: [] }, quotedPost)
                            return
                          }
                        }
                      }

                      const onebox = target.closest<HTMLElement>('[data-linuxdo-role="onebox"], [data-linuxdo-role="onebox-topic"]')
                      if (onebox?.dataset.linuxdoHref) {
                        event.preventDefault()
                        event.stopPropagation()
                        try {
                          const oneboxUrl = new URL(onebox.dataset.linuxdoHref, 'https://linux.do')
                          const topicMatch = oneboxUrl.hostname === 'linux.do' ? oneboxUrl.pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)(?:\/(\d+))?/) : null
                          if (topicMatch) {
                            onOpenTopic({ id: Number(topicMatch[2]), slug: topicMatch[1] || 'topic', title: onebox.textContent?.trim().slice(0, 100) || 'Linux.do 主题', postsCount: 0, replyCount: 0, views: 0, likeCount: 0, createdAt: '', lastPostedAt: '', tags: [], posters: [] }, topicMatch[3] ? Number(topicMatch[3]) : undefined)
                          } else {
                            void openExternal(oneboxUrl.toString())
                          }
                        } catch {
                          // Invalid onebox target is inert.
                        }
                        return
                      }

                      const link = target.closest('a') as HTMLAnchorElement | null
                      if (!link?.href) return
                      try {
                        const url = new URL(link.href, 'https://linux.do')
                        if (url.protocol !== 'https:' && url.protocol !== 'http:') return
                        event.preventDefault()

                        if (url.hostname === 'linux.do') {
                          const topicMatch = url.pathname.match(/^\/t\/(?:([^/]+)\/)?(\d+)(?:\/(\d+))?/)
                          if (topicMatch) {
                            const targetTopicId = Number(topicMatch[2])
                            const targetPost = topicMatch[3] ? Number(topicMatch[3]) : undefined
                            if (targetTopicId === topic.id && targetPost) {
                              void jumpToPost(targetPost, post.postNumber)
                            } else {
                              onOpenTopic({
                                id: targetTopicId,
                                slug: topicMatch[1] || 'topic',
                                title: link.textContent?.trim() || 'Linux.do 主题',
                                postsCount: 0,
                                replyCount: 0,
                                views: 0,
                                likeCount: 0,
                                createdAt: '',
                                lastPostedAt: '',
                                tags: [],
                                posters: [],
                              }, targetPost)
                            }
                            return
                          }

                          const userMatch = url.pathname.match(/^\/u\/([^/?#]+)/)
                          if (userMatch) {
                            onOpenUser(decodeURIComponent(userMatch[1]))
                            return
                          }

                          const tagMatch = url.pathname.match(/^\/tag\/([^/?#]+)/)
                          if (tagMatch) {
                            onOpenTag(decodeURIComponent(tagMatch[1]))
                            return
                          }

                          const catMatch = url.pathname.match(/^\/c\/(?:([^/?#]+)\/)?(\d+)/)
                          if (catMatch) {
                            const catId = Number(catMatch[2])
                            const cat = categoryMap[catId] || (catMatch[1] ? { id: catId, name: decodeURIComponent(catMatch[1]), slug: catMatch[1] } : undefined)
                            if (cat && onOpenCategory) {
                              onOpenCategory(cat)
                              return
                            }
                          }
                        }

                        void openExternal(url.toString())
                      } catch {
                        // Invalid links remain inert instead of navigating the app WebView.
                      }
                    }} />
                    <PostDevice device={post.device} postNumber={post.postNumber} />
                    <BoostCloud boosts={post.boosts ?? []} onOpenUser={onOpenUser} />
                    <footer className="linuxdo-control mt-3 sm:mt-3.5 flex items-center justify-between gap-1.5 sm:gap-2 border-t border-haze/40 pt-2 sm:pt-2.5 select-none">
                      <button
                        type="button"
                        disabled={!session.authenticated || pendingPostIds.has(post.id)}
                        aria-busy={pendingPostIds.has(post.id)}
                        onClick={() => void toggleLike(post)}
                        aria-label={(post.reactionUsersCount ?? like?.count ?? 0) + ' 个回应'}
                        className={'linuxdo-reaction-button inline-flex min-h-[30px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ' + (like?.acted || post.currentUserReaction ? 'is-active' : 'text-paper-muted hover:text-paper')}
                      >
                        <ReactionSummary reactions={post.reactions ?? []} fallbackCount={like?.count ?? 0} />
                      </button>
                      <div className="flex items-center gap-0.5 sm:gap-1">
                        <button
                          type="button"
                          disabled={!session.authenticated || pendingPostIds.has(post.id)}
                          aria-busy={pendingPostIds.has(post.id)}
                          onClick={() => void toggleLike(post)}
                          aria-label={like?.acted ? '取消赞' : '赞'}
                          className="linuxdo-control grid h-8 w-8 place-items-center rounded-full text-paper-muted transition-all hover:bg-paper/8 hover:text-cinnabar active:scale-90 disabled:opacity-35"
                        >
                          <Heart
                            size={15.5}
                            strokeWidth={like?.acted ? 2 : 1.75}
                            className={like?.acted ? 'text-cinnabar fill-cinnabar' : 'text-paper-muted'}
                          />
                        </button>
                        {post.canBoost ? (
                          <button
                            type="button"
                            disabled={!session.authenticated}
                            onClick={() => onBoost(post)}
                            aria-label="Boost 轻回应"
                            className="linuxdo-control flex h-8 items-center gap-1 rounded-full px-2 text-[11px] text-paper-muted transition-all hover:bg-paper/8 hover:text-cinnabar active:scale-95 disabled:opacity-35"
                          >
                            <Rocket size={14.5} strokeWidth={1.75} className="text-cinnabar-soft" />
                            <span className="hidden min-[360px]:inline">Boost</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={!session.authenticated}
                          onClick={() => topic && onCompose(topic, { replyToPostNumber: post.postNumber })}
                          aria-label="回复此楼"
                          className="linuxdo-control flex h-8 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-medium text-paper-muted transition-all hover:bg-paper/8 hover:text-paper active:scale-95 disabled:opacity-35"
                        >
                          <Reply size={14.5} strokeWidth={1.8} />
                          <span>回复</span>
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect()
                            setActionMenu({
                              anchor: { x: rect.right, y: rect.bottom + 4 },
                              post,
                            })
                          }}
                          aria-label="更多操作"
                          className="linuxdo-control grid h-8 w-8 place-items-center rounded-full text-paper-muted transition-all hover:bg-paper/8 hover:text-paper active:scale-90"
                        >
                          <MoreHorizontal size={16} strokeWidth={1.8} />
                        </button>
                      </div>
                    </footer>
                  </article>
                )
              })}
              {loadingPosts ? <div className="flex items-center justify-center gap-2 py-5 text-[10.5px] text-paper-faint" role="status" aria-live="polite"><Loader2 size={15} className="animate-spin" />正在加载更多回复</div> : null}
            </div>
          </>
        ) : null}
      </div>

      {jumpingPostNumber ? <div className="pointer-events-none absolute bottom-16 left-1/2 z-30 -translate-x-1/2 rounded-full border border-haze bg-ink-raised/95 px-3 py-2 text-[10px] text-paper-muted shadow-xl"><span className="inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" />正在定位 #{jumpingPostNumber}</span></div> : null}
      {returnPostNumber ? <button type="button" onClick={() => { const target = returnPostNumber; setReturnPostNumber(undefined); void jumpToPost(target) }} className="linuxdo-control absolute bottom-4 right-4 z-30 rounded-full border border-haze bg-ink-raised/95 px-3 py-2 text-[10.5px] text-paper shadow-xl">返回引用处 #{returnPostNumber}</button> : null}
      {toast ? (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full border border-haze/70 bg-ink-raised/95 px-4 py-2 text-[12px] font-medium text-paper shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
          {toast}
        </div>
      ) : null}
      {actionMenu ? (
        <ContextActionMenu
          open={Boolean(actionMenu)}
          anchor={actionMenu.anchor}
          title={`#${actionMenu.post.postNumber} · @${actionMenu.post.username}`}
          caption={actionMenu.post.name || undefined}
          onClose={() => setActionMenu(null)}
          actions={[
            ...(session.authenticated ? [
              {
                id: 'quote',
                label: '引用此楼',
                icon: Quote,
                onSelect: () => {
                  const p = actionMenu.post
                  if (!topic) return
                  const text = new DOMParser().parseFromString(p.cooked, 'text/html').body.textContent?.trim().slice(0, 240) || ''
                  const quoted = '> @' + p.username + '：' + text + '\n\n'
                  onCompose(topic, { initialRaw: quoted, replyToPostNumber: p.postNumber })
                },
              },
              {
                id: 'bookmark',
                label: actionMenu.post.bookmarked ? '取消收藏' : '添加书签',
                icon: Bookmark,
                tone: (actionMenu.post.bookmarked ? 'accent' : 'default') as 'accent' | 'default',
                onSelect: () => void toggleBookmark(actionMenu.post),
              },
              ...(actionMenu.post.canBoost ? [{
                id: 'boost',
                label: 'Boost 回应',
                icon: Rocket,
                onSelect: () => onBoost(actionMenu.post),
              }] : []),
            ] : []),
            {
              id: 'copy-link',
              label: '复制楼层链接',
              icon: Link,
              onSelect: () => {
                const p = actionMenu.post
                const url = `https://linux.do/t/${topic?.slug || summary.slug || 'topic'}/${topic?.id || summary.id}/${p.postNumber}`
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(url).then(() => showToast('已复制楼层链接'))
                } else {
                  showToast('已复制链接')
                }
              },
            },
            ...(actionMenu.post.canEdit ? [{
              id: 'edit',
              label: '编辑帖子',
              icon: Pencil,
              onSelect: () => topic && onEdit(topic, actionMenu.post),
            }] : []),
            ...(actionMenu.post.canDelete ? [{
              id: 'delete',
              label: '删除帖子',
              icon: Trash2,
              tone: 'danger' as const,
              onSelect: () => void deletePost(actionMenu.post),
            }] : []),
          ]}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除帖子？"
        message="删除后将同步到 Linux.do，且无法在 NewsNook 中撤销。"
        confirmLabel={deleteTarget && pendingPostIds.has(deleteTarget.id) ? '删除中…' : '删除'}
        cancelLabel="取消"
        danger
        onCancel={() => {
          if (deleteTarget && pendingPostIds.has(deleteTarget.id)) return
          setDeleteTarget(null)
        }}
        onConfirm={() => void confirmDeletePost()}
      />
      {lightbox ? (() => {
        const current = lightbox.items[lightbox.index]
        if (!current) return null
        return <ImageLightbox src={current.src} actionSrc={current.actionSrc} alt={current.alt} index={lightbox.index} total={lightbox.items.length} onPrevious={lightbox.index > 0 ? () => setLightbox((state) => state ? { ...state, index: state.index - 1 } : state) : undefined} onNext={lightbox.index < lightbox.items.length - 1 ? () => setLightbox((state) => state ? { ...state, index: state.index + 1 } : state) : undefined} onClose={() => setLightbox(null)} overlayCloserRef={overlayBackHandlerRef} />
      })() : null}
    </div>
  )
}

