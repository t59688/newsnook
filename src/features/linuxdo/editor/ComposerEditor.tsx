import {
  Bold,
  CheckCircle2,
  Code2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  Loader2,
  ListOrdered,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent, type ReactNode } from 'react'

import {
  applyComposerCommand,
  insertComposerBlock,
  insertComposerSnippet,
  insertComposerText,
  type ComposerCommand,
  type ComposerEdit,
  type ComposerSelection,
  type ComposerSnippetContext,
  type ComposerSnippetKind,
} from './model'
import { renderLinuxDoComposerPreview } from './preview'

export interface ComposerEditorHandle {
  insertText: (text: string) => void
  insertBlock: (text: string) => void
  insertSnippet: (kind: ComposerSnippetKind, context?: ComposerSnippetContext) => void
  selection: () => ComposerSelection
  focus: () => void
}

export interface ComposerUploadVisualItem {
  id: string
  name: string
  size: number
  state: 'queued' | 'uploading' | 'success' | 'error'
  progress: number
}

interface ComposerEditorProps {
  value: string
  onChange: (value: string) => void
  preview: boolean
  onPreviewChange: (preview: boolean) => void
  placeholder: string
  uploading: boolean
  uploadItems: ComposerUploadVisualItem[]
  previewUploadUrls: Record<string, string>
  onUpload: () => void
  onOpenInsert: () => void
  onOpenTemplate: () => void
  footer?: ReactNode
}

const TOOLBAR: Array<{ command: ComposerCommand; label: string; icon: typeof Bold }> = [
  { command: 'heading', label: '标题', icon: Heading2 },
  { command: 'bold', label: '粗体', icon: Bold },
  { command: 'italic', label: '斜体', icon: Italic },
  { command: 'strike', label: '删除线', icon: Strikethrough },
  { command: 'link', label: '链接', icon: Link2 },
  { command: 'quote', label: '引用', icon: Quote },
  { command: 'code', label: '行内代码', icon: Code2 },
  { command: 'bullet-list', label: '无序列表', icon: List },
  { command: 'ordered-list', label: '有序列表', icon: ListOrdered },
]

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(function ComposerEditor({
  value,
  onChange,
  preview,
  onPreviewChange,
  placeholder,
  uploading,
  uploadItems,
  previewUploadUrls,
  onUpload,
  onOpenInsert,
  onOpenTemplate,
  footer,
}, forwardedRef) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const selectionRef = useRef<ComposerSelection>({ start: value.length, end: value.length })
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const lastInputAtRef = useRef(0)

  const uploadCompleted = uploadItems.filter((item) => item.state === 'success' || item.state === 'error').length
  const uploadFailed = uploadItems.filter((item) => item.state === 'error').length
  const uploadTotalBytes = uploadItems.reduce((total, item) => total + Math.max(1, item.size), 0)
  const uploadWeightedProgress = uploadItems.length
    ? uploadItems.reduce((total, item) => total + Math.max(1, item.size) * (item.state === 'error' ? 1 : Math.max(0, Math.min(1, item.progress))), 0) / uploadTotalBytes
    : 0
  const uploadPercent = Math.round(uploadWeightedProgress * 100)
  const uploadButtonLabel = uploading ? `正在上传 ${uploadItems.length} 个文件` : '图片 / 附件'

  const selection = () => {
    const textarea = textareaRef.current
    if (textarea) return { start: textarea.selectionStart, end: textarea.selectionEnd }
    return selectionRef.current
  }

  const restoreSelection = (next: ComposerSelection) => {
    selectionRef.current = next
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.start, next.end)
    })
  }

  const commit = (edit: ComposerEdit, record = true) => {
    if (record && edit.value !== value) {
      undoRef.current = [...undoRef.current.slice(-49), value]
      redoRef.current = []
    }
    onChange(edit.value)
    if (preview) onPreviewChange(false)
    restoreSelection(edit.selection)
  }

  useImperativeHandle(forwardedRef, () => ({
    insertText: (text) => commit(insertComposerText(value, selection(), text)),
    insertBlock: (text) => commit(insertComposerBlock(value, selection(), text)),
    insertSnippet: (kind, context) => commit(insertComposerSnippet(value, selection(), kind, context)),
    selection,
    focus: () => textareaRef.current?.focus(),
  }))

  const apply = (command: ComposerCommand) => commit(applyComposerCommand(value, selection(), command))
  const undo = () => {
    const previous = undoRef.current.at(-1)
    if (previous === undefined) return
    undoRef.current = undoRef.current.slice(0, -1)
    redoRef.current = [...redoRef.current.slice(-49), value]
    commit({ value: previous, selection: { start: previous.length, end: previous.length } }, false)
  }
  const redo = () => {
    const next = redoRef.current.at(-1)
    if (next === undefined) return
    redoRef.current = redoRef.current.slice(0, -1)
    undoRef.current = [...undoRef.current.slice(-49), value]
    commit({ value: next, selection: { start: next.length, end: next.length } }, false)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (event.shiftKey && key === 'i') {
      event.preventDefault()
      onOpenTemplate()
      return
    }
    if (key === 'b' || key === 'i' || key === 'k') {
      event.preventDefault()
      apply(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'link')
    }
  }

  return (
    <section className="linuxdo-composer-editor flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-haze bg-ink">
      <div className="linuxdo-composer-toolbar flex shrink-0 items-center border-b border-haze/60 px-1.5">
        <div className="linuxdo-composer-toolbar-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5">
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={undo} disabled={!undoRef.current.length} className="linuxdo-composer-tool" aria-label="撤销" title="撤销"><Undo2 size={16} /></button>
          <button type="button" onPointerDown={(event) => event.preventDefault()} onClick={redo} disabled={!redoRef.current.length} className="linuxdo-composer-tool" aria-label="重做" title="重做"><Redo2 size={16} /></button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-haze/70" aria-hidden />
          {TOOLBAR.map((item) => {
            const Icon = item.icon
            return <button key={item.command} type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => apply(item.command)} className="linuxdo-composer-tool" aria-label={item.label} title={item.label}><Icon size={16} /></button>
          })}
        </div>
        <span className="mx-1 h-6 w-px shrink-0 bg-haze/70" aria-hidden />
        <div className="flex shrink-0 items-center gap-1 py-1.5">
          <button type="button" onClick={onUpload} disabled={uploading} className="linuxdo-composer-tool" aria-label={uploadButtonLabel} title={uploadButtonLabel}>{uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}</button>
          <button type="button" onClick={onOpenInsert} className="linuxdo-composer-tool is-accent" aria-label="更多插入功能" title="更多插入功能"><Plus size={17} /></button>
        </div>
      </div>

      {uploading && uploadItems.length ? (
        <div className="shrink-0 border-b border-haze/55 bg-paper/[0.025] px-3 py-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-[10px]">
            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-paper-muted">
              <Loader2 size={12} className="shrink-0 animate-spin text-cinnabar-soft" />
              <span className="truncate">正在上传 {uploadItems.length} 个文件 · 已完成 {uploadCompleted}/{uploadItems.length}</span>
            </span>
            <span className="shrink-0 font-mono text-paper-faint">{uploadPercent}%</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent}>
            <div className="h-full rounded-full bg-cinnabar transition-[width] duration-150" style={{ width: `${Math.max(2, Math.min(100, uploadPercent))}%` }} />
          </div>
          <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {uploadItems.map((item) => (
              <span key={item.id} className={'inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] ' + (item.state === 'error' ? 'border-cinnabar/25 bg-cinnabar/[0.06] text-cinnabar-soft' : 'border-haze/55 bg-paper/[0.035] text-paper-faint')}>
                {item.state === 'success' ? <CheckCircle2 size={10} className="shrink-0 text-cinnabar-soft" /> : item.state === 'error' ? <TriangleAlert size={10} className="shrink-0" /> : item.state === 'uploading' ? <Loader2 size={10} className="shrink-0 animate-spin" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-paper-faint/50" />}
                <span className="truncate">{item.name}</span>
                {item.state === 'uploading' ? <span className="shrink-0 font-mono">{Math.round(item.progress * 100)}%</span> : null}
              </span>
            ))}
          </div>
          {uploadFailed ? <div className="mt-1.5 text-[9px] text-cinnabar-soft">已有 {uploadFailed} 个文件失败，其余文件继续上传</div> : null}
        </div>
      ) : null}

      <div className="relative min-h-[240px] flex-1">
        {preview ? (
          value.trim() ? (
            <article className="reader-prose linuxdo-post-prose linuxdo-composer-preview absolute inset-0 overflow-y-auto px-4 py-4 text-paper" dangerouslySetInnerHTML={{ __html: renderLinuxDoComposerPreview(value, previewUploadUrls) }} />
          ) : (
            <div className="absolute inset-0 grid place-items-center px-8 text-center text-[12px] text-paper-faint"><span><Eye size={21} className="mx-auto mb-2 opacity-60" />输入正文后可在这里检查排版</span></div>
          )
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              const now = Date.now()
              if (now - lastInputAtRef.current > 700) {
                undoRef.current = [...undoRef.current.slice(-49), value]
                redoRef.current = []
              }
              lastInputAtRef.current = now
              selectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }
              onChange(event.target.value)
            }}
            onSelect={(event) => { selectionRef.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd } }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="absolute inset-0 h-full w-full resize-none bg-transparent px-4 py-4 font-body text-[14px] leading-7 text-paper outline-none placeholder:text-paper-faint"
          />
        )}
      </div>

      <footer className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-t border-haze/60 px-3 py-1.5">
        <div className="flex shrink-0 items-center whitespace-nowrap rounded-full bg-paper/5 p-0.5">
          <button type="button" onClick={() => onPreviewChange(false)} className={'linuxdo-control whitespace-nowrap rounded-full px-3 py-1.5 text-[10.5px] transition-colors ' + (!preview ? 'bg-cinnabar text-white' : 'text-paper-muted')}>编辑</button>
          <button type="button" onClick={() => onPreviewChange(true)} className={'linuxdo-control inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[10.5px] transition-colors ' + (preview ? 'bg-cinnabar text-white' : 'text-paper-muted')}><Eye size={12} />预览</button>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden text-right">{footer}</div>
      </footer>
    </section>
  )
})
