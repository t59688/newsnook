import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Check, Circle, Eraser, Highlighter, List, MoreHorizontal, PenLine, Pencil, Underline, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import '../../styles/reader/annotations.css'
import {
  createAnchor, documentText, offsetsFromRange, rangeFromOffsets, resolveAnchor, textNodes,
  type AnnotationKind, type ArticleAnnotation, type InkPoint, type TextAnchor,
} from './model'
import { deleteArticleAnnotation, listArticleAnnotations, putArticleAnnotation } from './store'

type Tool = 'select' | 'highlight' | 'underline' | 'circle' | 'ink' | 'eraser'
type Shape = { annotation: ArticleAnnotation; rects: DOMRect[]; origin: DOMRect }
const PALETTE = ['#cf9845', '#ad554b', '#5f8c80', '#8b75a7']
function id() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ann-${Date.now()}-${Math.random().toString(36).slice(2)}` }
function rectFor(range: Range, root: HTMLElement): DOMRect[] {
  const host = root.getBoundingClientRect()
  return Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0).map(rect =>
    new DOMRect(rect.left - host.left, rect.top - host.top, rect.width, rect.height))
}
function textPositionAt(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => CaretPosition | null }
  const range = doc.caretRangeFromPoint?.(x, y)
  const caret = !range ? doc.caretPositionFromPoint?.(x, y) : null
  const node = range?.startContainer || caret?.offsetNode
  const offset = range?.startOffset ?? caret?.offset ?? 0
  if (!node || !root.contains(node)) return null
  const nodes = textNodes(root)
  let position = 0
  for (const item of nodes) {
    if (item === node) return position + offset
    position += item.data.length
  }
  return null
}

export function ReaderAnnotations({ articleId, contentRef, contentKey, overlayCloserRef, panelOpen, onPanelOpenChange }: {
  articleId: string
  contentRef: RefObject<HTMLDivElement | null>
  contentKey: string
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
  panelOpen: boolean
  onPanelOpenChange: (open: boolean) => void
}) {
  const [annotations, setAnnotations] = useState<ArticleAnnotation[]>([])
  const [tool, setTool] = useState<Tool>('underline')
  const [color, setColor] = useState(PALETTE[0]!)
  const [panelTab, setPanelTab] = useState<'notes' | 'tools' | 'selection'>('tools')
  const [penTrayOpen, setPenTrayOpen] = useState(false)
  const setPanelOpen = onPanelOpenChange
  const [noteEditor, setNoteEditor] = useState<{ kind: AnnotationKind; anchor: TextAnchor; id?: string; text: string } | null>(null)
  const [message, setMessage] = useState('')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<{ points: InkPoint[]; anchor: TextAnchor; origin: { x: number; y: number } } | null>(null)
  const [selected, setSelected] = useState<TextAnchor | null>(null)
  useEffect(() => {
    if (!overlayCloserRef || (!noteEditor && !panelOpen && !selected && !penTrayOpen)) return
    const previous = overlayCloserRef.current
    overlayCloserRef.current = () => {
      if (noteEditor) setNoteEditor(null)
      else if (panelOpen) setPanelOpen(false)
      else if (selected) setSelected(null)
      else { setPenTrayOpen(false); setTool('select') }
      return true
    }
    return () => { overlayCloserRef.current = previous }
  }, [overlayCloserRef, noteEditor, panelOpen, selected, penTrayOpen, setPanelOpen])
  const activePointer = useRef<number | null>(null)
  const draftRef = useRef<typeof draft>(null)
  const frameRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const annotationsRef = useRef<ArticleAnnotation[]>([])
  annotationsRef.current = annotations
  const refresh = useCallback(async () => {
    try {
      const items = await listArticleAnnotations(articleId)
      setAnnotations(items)
      setMessage('')
    } catch {
      setMessage('无法读取笔记，请检查设备存储空间')
    }
  }, [articleId])
  useEffect(() => { void refresh() }, [refresh])

  const redraw = useCallback(() => {
    const root = contentRef.current
    if (!root) return
    const text = documentText(root)
    const next: Shape[] = []
    for (const item of annotationsRef.current) {
      const offset = resolveAnchor(text, item.anchor)
      if (!offset) continue
      const range = rangeFromOffsets(root, offset.start, Math.max(offset.start + 1, offset.end))
      if (!range) continue
      const rects = rectFor(range, root)
      if (rects.length) next.push({ annotation: item, rects, origin: rects[0]! })
    }
    setShapes(next)
  }, [contentRef])
  useEffect(() => {
    redraw()
    const root = contentRef.current
    if (!root) return
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redraw) : null
    observer?.observe(root)
    const images = Array.from(root.querySelectorAll('img'))
    images.forEach(image => image.addEventListener('load', redraw))
    window.addEventListener('resize', redraw)
    return () => {
      observer?.disconnect()
      images.forEach(image => image.removeEventListener('load', redraw))
      window.removeEventListener('resize', redraw)
    }
  }, [contentRef, contentKey, annotations, redraw])

  // Inline paper-style marginalia are actual flow blocks, not floating labels covering text.
  // They never alter the source article HTML or the canonical text coordinates.
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const inserted: HTMLElement[] = []
    const text = documentText(root)
    for (const item of annotations) {
      if (!item.note || !(['note', 'replace', 'transpose', 'insert'] as AnnotationKind[]).includes(item.kind)) continue
      const offsets = resolveAnchor(text, item.anchor)
      if (!offsets) continue
      const range = rangeFromOffsets(root, offsets.start, Math.min(text.length, Math.max(offsets.end, offsets.start + 1)))
      if (!range) continue
      const parent = range.startContainer.parentElement
      const block = parent?.closest('p,li,blockquote,h1,h2,h3,h4')
      if (!block || !root.contains(block)) continue
      const note = document.createElement('button')
      note.type = 'button'
      note.dataset.annotationUi = 'true'
      note.className = 'nn-annotation-inline-note'
      note.textContent = (item.kind === 'insert' ? '增补' : item.kind === 'replace' ? '改正' : item.kind === 'transpose' ? '对调' : '旁批') + '　' + item.note
      note.setAttribute('aria-label', '编辑批注：' + item.note)
      note.addEventListener('click', () => setNoteEditor({kind:item.kind,anchor:item.anchor,id:item.id,text:item.note}))
      block.insertAdjacentElement('afterend', note)
      inserted.push(note)
    }
    return () => inserted.forEach(node => node.remove())
  }, [contentRef, contentKey, annotations])

  const save = useCallback(async (item: ArticleAnnotation): Promise<boolean> => {
    try {
      await putArticleAnnotation(item)
      await refresh()
      return true
    } catch {
      setMessage('批注保存失败，请检查存储空间后重试')
      return false
    }
  }, [refresh])
  const remove = useCallback(async (item: ArticleAnnotation) => {
    try { await deleteArticleAnnotation(item.id); await refresh() }
    catch { setMessage('删除失败，请重试') }
  }, [refresh])

  const record = (kind: AnnotationKind, anchor: TextAnchor, note = '', strokes?: ArticleAnnotation['strokes']) => {
    const now = Date.now()
    void save({ id: id(), articleId, kind, anchor, note, color, strokes, createdAt: now, updatedAt: now, schema: 1 })
    setSelected(null)
    window.getSelection()?.removeAllRanges()
  }
  const captureSelection = useCallback(() => {
    const root = contentRef.current
    const selection = window.getSelection()
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount) return
    const range = selection.getRangeAt(0)
    const offsets = offsetsFromRange(root, range)
    if (!offsets) return
    setSelected(createAnchor(documentText(root), offsets.start, offsets.end))
    // Mobile Android already shows its native copy/search menu near the selection.
    // Our actions live at the bottom of the viewport and never compete for that location.
  }, [contentRef])
  useEffect(() => {
    const updateSelection = () => captureSelection()
    document.addEventListener('selectionchange', updateSelection)
    return () => document.removeEventListener('selectionchange', updateSelection)
  }, [captureSelection, contentKey])
  const exportMarkdown = () => {
    const entries = annotations.map(item => `- **${item.kind}** · ${item.anchor.exact.replace(/\s+/g, ' ').slice(0, 300)}\n  ${item.note || ''}`)
    const blob = new Blob([`# 文章标注\n\n${entries.join('\n\n')}\n`], {type:'text/markdown;charset=utf-8'})
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'newsnook-annotations.md'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const locate = (item: ArticleAnnotation) => {
    const root = contentRef.current
    if (!root) return
    const offsets = resolveAnchor(documentText(root), item.anchor)
    if (!offsets) { setMessage('原文已变化，无法可靠定位这条笔记'); return }
    const range = rangeFromOffsets(root, offsets.start, Math.max(offsets.start + 1, offsets.end))
    const rect = range?.getBoundingClientRect()
    const host = root.closest('[data-scroll-surface]') || root
    if (rect) {
      const scrollParent = host instanceof HTMLElement ? host : root
      if (scrollParent.scrollHeight > scrollParent.clientHeight) {
        scrollParent.scrollBy({ top: rect.top - scrollParent.getBoundingClientRect().top - 120, behavior: 'smooth' })
      } else root.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    setPanelOpen(false)
  }
  const pointerDown = (event: PointerEvent) => {
    const root = contentRef.current
    if (!root || event.pointerType !== 'pen' || tool === 'select') return
    // A real pen owns writing while touch pointers continue to scroll normally.
    if (activePointer.current !== null) return
    const start = textPositionAt(root, event.clientX, event.clientY)
    if (start === null) return
    const text = documentText(root)
    const end = Math.min(text.length, start + 1)
    const anchor = createAnchor(text, start, end)
    const originRange = rangeFromOffsets(root, start, end)
    const originRect = originRange?.getBoundingClientRect() || root.getBoundingClientRect()
    const point: InkPoint = { x: event.clientX - originRect.left, y: event.clientY - originRect.top, pressure: event.pressure || 0.5, tiltX: event.tiltX, tiltY: event.tiltY }
    activePointer.current = event.pointerId
    setPenTrayOpen(true)
    draftRef.current = { points: [point], anchor, origin: { x: originRect.left, y: originRect.top } }
    setDraft(draftRef.current)
    root.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const pointerMove = (event: PointerEvent) => {
    if (activePointer.current !== event.pointerId || !draftRef.current) return
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    const samples = coalesced.length ? coalesced : [event]
    const previous = draftRef.current
    draftRef.current = {
      ...previous,
      points: previous.points.concat(samples.map(sample => ({
        x: sample.clientX - previous.origin.x,
        y: sample.clientY - previous.origin.y,
        pressure: sample.pressure || 0.5,
        tiltX: sample.tiltX,
        tiltY: sample.tiltY,
      })).slice(-24)).slice(0, 8000),
    }
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setDraft(draftRef.current)
    })
    event.preventDefault()
  }
  const pointerFinish = (event: PointerEvent, cancelled = false) => {
    if (activePointer.current !== event.pointerId) return
    activePointer.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    const current = draftRef.current
    if (!cancelled && current && current.points.length > 1) {
      if (tool === 'eraser') {
        // Hit-test actual ink points and rendered text rectangles. Empty-space erases nothing.
        const rootRect = contentRef.current?.getBoundingClientRect()
        const sampleStride = Math.max(1, Math.ceil(current.points.length / 64))
        const penSamples = current.points.filter((_, index) => index % sampleStride === 0 || index === current.points.length - 1)
        const closest = shapes.map(shape => {
          let distance = Number.POSITIVE_INFINITY
          for (const sample of penSamples) {
            const x = sample.x + current.origin.x - (rootRect?.left || 0)
            const y = sample.y + current.origin.y - (rootRect?.top || 0)
            if (shape.annotation.kind === 'ink') {
              for (const stroke of shape.annotation.strokes || []) {
                const stride = Math.max(1, Math.ceil(stroke.points.length / 256))
                for (let index = 0; index < stroke.points.length; index += stride) {
                  const point = stroke.points[index]!
                  distance = Math.min(distance, Math.hypot(shape.origin.x + point.x - x, shape.origin.y + point.y - y))
                }
              }
            } else for (const rect of shape.rects) {
              distance = Math.min(distance, Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom)))
            }
          }
          return { item: shape.annotation, distance }
        }).sort((a, b) => a.distance - b.distance)[0]
        if (closest && closest.distance <= 12) void remove(closest.item)
      } else if (tool === 'ink') {
        record('ink', current.anchor, '', [{ points: current.points, color, width: 2.2 }])
      } else {
        const root = contentRef.current
        const last = current.points[current.points.length - 1]
        const at = root && last ? textPositionAt(root, last.x + current.origin.x, last.y + current.origin.y) : null
        if (root && at !== null) {
          const left = Math.min(current.anchor.start, at)
          const right = Math.max(current.anchor.start, at) + 1
          if (tool !== 'select') record(tool, createAnchor(documentText(root), left, Math.min(right, documentText(root).length)))
        }
      }
    }
    draftRef.current = null
    setDraft(null)
  }
  const pointerHandlers = useRef({ pointerDown, pointerMove, pointerFinish })
  pointerHandlers.current = { pointerDown, pointerMove, pointerFinish }
  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const down = (event: PointerEvent) => pointerHandlers.current.pointerDown(event)
    const move = (event: PointerEvent) => pointerHandlers.current.pointerMove(event)
    const up = (event: PointerEvent) => pointerHandlers.current.pointerFinish(event)
    const cancel = (event: PointerEvent) => pointerHandlers.current.pointerFinish(event, true)
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', cancel)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', cancel)
    }
  }, [contentRef, contentKey, annotations])
  const root = contentRef.current
  const layer = root?.getBoundingClientRect()
  const uiRect = rootRef.current?.getBoundingClientRect()
  const overlayTop = layer && uiRect ? layer.top - uiRect.top : 0
  const overlayLeft = layer && uiRect ? layer.left - uiRect.left : 0

  const showContext = Boolean(selected && !panelOpen && !noteEditor)
  const openEditor = (kind: AnnotationKind, anchor: TextAnchor, existing?: ArticleAnnotation) => {
    setPanelOpen(false)
    setSelected(null)
    window.getSelection()?.removeAllRanges()
    setNoteEditor({ kind, anchor, id: existing?.id, text: existing?.note ?? '' })
  }
  const saveEditor = async () => {
    if (!noteEditor) return
    const old = annotations.find(item => item.id === noteEditor.id)
    const now = Date.now()
    const item: ArticleAnnotation = old
      ? { ...old, kind: noteEditor.kind, note: noteEditor.text, updatedAt: now }
      : { id: id(), articleId, kind: noteEditor.kind, anchor: noteEditor.anchor, note: noteEditor.text,
        color, createdAt: now, updatedAt: now, schema: 1 }
    if (await save(item)) setNoteEditor(null)
  }
  const openPenTool = (next: Tool) => {
    setTool(next)
    setPenTrayOpen(next !== 'select')
    setSelected(null)
    setPanelOpen(false)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <>
      {/* Full-size transparent ink layer: never pushes the article or intercepts touch scrolling. */}
      <div ref={rootRef} className="nn-annotation-layer" data-annotation-ui>
        {root && shapes.length > 0 && (
          <svg
            className="nn-annotation-ink"
            style={{ top: overlayTop, left: overlayLeft, height: root.scrollHeight, width: root.offsetWidth }}
            aria-hidden="true"
          >
            {shapes.map(shape => {
              const item = shape.annotation
              if (item.kind === 'ink') return item.strokes?.map((stroke, index) =>
                <g key={item.id + index} fill="none" stroke={stroke.color} strokeLinejoin="round" strokeLinecap="round">
                  {Array.from({ length: Math.ceil((stroke.points.length - 1) / 12) }, (_, chunkIndex) => {
                    const chunk = stroke.points.slice(chunkIndex * 12, (chunkIndex + 1) * 12 + 1)
                    const pressure = chunk.reduce((sum, point) => sum + point.pressure, 0) / chunk.length
                    return <polyline key={chunkIndex}
                      points={chunk.map(point => `${shape.origin.x + point.x},${shape.origin.y + point.y}`).join(' ')}
                      strokeWidth={stroke.width * (0.55 + pressure)} />
                  })}
                </g>)
              return shape.rects.map((rect, index) => {
                const key = item.id + '-' + index
                if (item.kind === 'circle') return <rect key={key} x={rect.x - 2} y={rect.y - 1} width={rect.width + 4}
                  height={rect.height + 2} rx={rect.height / 2} fill="none" stroke={item.color} strokeWidth="1.6" />
                if (item.kind === 'highlight') return <rect key={key} x={rect.x} y={rect.y + rect.height * .56}
                  width={rect.width} height={rect.height * .36} fill={item.color} opacity=".3" />
                if (item.kind === 'insert') {
                  // The proofreading caret is deliberately tiny: notes stay in the following paragraph.
                  return index === shape.rects.length - 1 ?
                    <path key={key} d={`M ${rect.x + rect.width - 4} ${rect.y - 3} l 4 4 l 4 -4`}
                      stroke={item.color} fill="none" strokeWidth="1.3" /> : null
                }
                if (item.kind === 'note' || item.kind === 'replace' || item.kind === 'transpose') {
                  return index === 0 ? <path key={key}
                    d={`M ${rect.x} ${rect.y + rect.height - 2} l 15 0`}
                    stroke={item.color} strokeDasharray="2 2" strokeWidth="1.5" /> : null
                }
                const y = item.kind === 'strike' ? rect.y + rect.height * .53 : rect.y + rect.height - 2
                return <path key={key} d={`M ${rect.x} ${y} L ${rect.x + rect.width} ${y}`}
                  stroke={item.color} strokeWidth="1.6" fill="none" />
              })
            })}
            {draft && <polyline
              points={draft.points.map(point =>
                `${point.x + draft.origin.x - (layer?.left ?? 0)},${point.y + draft.origin.y - (layer?.top ?? 0)}`).join(' ')}
              stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
          </svg>
        )}
      </div>

      {typeof document !== 'undefined' && createPortal(
        <>
          {/* Android's native text context menu remains above the selection; our actions are below. */}
          {showContext && selected && (
            <div className="nn-annotation-context" role="toolbar" aria-label="文字标注操作" data-annotation-ui>
              <button type="button" className="nn-annotation-primary" onClick={() => record('highlight', selected)}>
                <Highlighter size={16} strokeWidth={1.8} />高亮
              </button>
              <button type="button" onClick={() => record('underline', selected)}>
                <Underline size={16} strokeWidth={1.8} />划线
              </button>
              <button type="button" onClick={() => openEditor('note', selected)}>
                <Pencil size={16} strokeWidth={1.8} />笔记
              </button>
              <button type="button" aria-label="更多校对和标注操作" onClick={() => { setPanelTab('selection'); setPanelOpen(true) }}>
                <MoreHorizontal size={18} strokeWidth={1.8} />
              </button>
              <span className="nn-annotation-separator" />
              <button type="button" className="nn-annotation-icon-only" aria-label="关闭标注工具"
                onClick={() => { setSelected(null); window.getSelection()?.removeAllRanges() }}>
                <X size={15} />
              </button>
            </div>
          )}

          {penTrayOpen && !showContext && !panelOpen && !noteEditor && (
            <div className="nn-annotation-pen-dock" role="toolbar" aria-label="触控笔工具" data-annotation-ui>
              <span className="nn-pen-label"><PenLine size={17} />
                <span>{({select:'选字',highlight:'荧光笔',underline:'下划线',circle:'圈注',ink:'手写',eraser:'橡皮擦'})[tool]}</span>
              </span>
              <button type="button" onClick={() => { setPanelTab('tools'); setPanelOpen(true) }}>工具</button>
              <button type="button" className="nn-pen-end" onClick={() => openPenTool('select')}>完成</button>
            </div>
          )}

          {panelOpen && (
            <>
              <div className="nn-annotation-shade" onClick={() => setPanelOpen(false)} data-annotation-ui />
              <section className="nn-annotation-sheet" role="dialog" aria-modal="true" aria-label="文章标注与笔记" data-annotation-ui>
                <div className="nn-annotation-handle" />
                <div className="nn-annotation-sheet-head">
                  <div>
                    <h2>标注与笔记</h2>
                    <p>写在文章旁，留在下次阅读里</p>
                  </div>
                  <button type="button" className="nn-annotation-close" aria-label="关闭批注面板"
                    onClick={() => setPanelOpen(false)}><X size={18} /></button>
                </div>
                <div className="nn-annotation-tabs" role="tablist" aria-label="批注类型">
                  <button type="button" role="tab" aria-selected={panelTab==='tools'} onClick={() => setPanelTab('tools')}>笔工具</button>
                  <button type="button" role="tab" aria-selected={panelTab==='notes'} onClick={() => setPanelTab('notes')}>笔记 {annotations.length}</button>
                  {selected && <button type="button" role="tab" aria-selected={panelTab==='selection'}
                    onClick={() => setPanelTab('selection')}>选中文字</button>}
                </div>

                {panelTab === 'tools' && (
                  <>
                    <div className="nn-annotation-tool-grid">
                      {([
                        ['underline','下划线',Underline],
                        ['highlight','荧光笔',Highlighter],
                        ['circle','圈注',Circle],
                        ['ink','自由手写',Pencil],
                        ['eraser','橡皮擦',Eraser],
                        ['select','普通阅读',PenLine],
                      ] as const).map(([value, label, Icon]) =>
                        <button key={value} type="button" aria-pressed={tool===value && penTrayOpen}
                          onClick={() => openPenTool(value)}>
                          <Icon size={20} strokeWidth={1.6} />{label}
                        </button>
                      )}
                    </div>
                    <div className="nn-annotation-color-row">
                      <span>笔迹颜色</span>
                      <div className="nn-annotation-color-options" role="group" aria-label="笔迹颜色">
                        {PALETTE.map((value, index) =>
                          <button key={value} type="button" aria-label={['赭黄','朱红','竹青','灰紫'][index]}
                            aria-pressed={color===value} onClick={() => setColor(value)}>
                            <span style={{backgroundColor:value}} />
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="nn-annotation-hint">主动式触控笔可直接在原文上落笔。手指仍用于滚动和翻页；普通电容笔可长按选字后标注。</p>
                  </>
                )}

                {panelTab === 'selection' && selected && (
                  <div className="nn-annotation-tool-grid">
                    <button type="button" onClick={() => { record('circle', selected); setPanelOpen(false) }}><Circle size={20}/>圈注</button>
                    <button type="button" onClick={() => { record('strike', selected); setPanelOpen(false) }}><Underline size={20}/>删除线</button>
                    <button type="button" onClick={() => openEditor('insert', selected)}><PenLine size={20}/>增补符号</button>
                    <button type="button" onClick={() => openEditor('replace', selected)}><Pencil size={20}/>改正</button>
                    <button type="button" onClick={() => openEditor('transpose', selected)}><PenLine size={20}/>对调</button>
                    <button type="button" onClick={() => openEditor('note', selected)}><List size={20}/>写批注</button>
                  </div>
                )}

                {panelTab === 'notes' && (
                  <>
                    <div className="nn-annotation-list">
                      {annotations.length === 0 && (
                        <div className="nn-annotation-empty">这篇文章还没有标注。<br/>长按一段文字，或拿起笔直接划写。</div>
                      )}
                      {annotations.map(item =>
                        <div className="nn-annotation-item" key={item.id}>
                          <button type="button" onClick={() => locate(item)}>
                            <small>{({highlight:'荧光笔',underline:'下划线',circle:'圈注',strike:'删除线',note:'旁批',
                              insert:'增补',replace:'改正',transpose:'对调',ink:'手写'})[item.kind]} · 点击回到原文</small>
                            <strong>{item.anchor.exact.slice(0, 100) || '手写批注'}</strong>
                            {item.note && <span className="nn-annotation-item-note">{item.note}</span>}
                          </button>
                          <div className="nn-annotation-item-actions">
                            <button type="button" onClick={() => openEditor(item.kind, item.anchor, item)}>编辑</button>
                            <button type="button" onClick={() => void remove(item)}>删除</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {annotations.length > 0 && <button type="button" className="nn-annotation-export" onClick={exportMarkdown}>
                      导出这篇文章的笔记（Markdown）
                    </button>}
                  </>
                )}
              </section>
            </>
          )}

          {noteEditor && (
            <>
              <div className="nn-annotation-shade" onClick={() => setNoteEditor(null)} data-annotation-ui />
              <section className="nn-annotation-sheet" role="dialog" aria-modal="true" aria-label="编辑批注" data-annotation-ui>
                <div className="nn-annotation-handle" />
                <div className="nn-annotation-sheet-head">
                  <div><h2>{noteEditor.id ? '修改批注' : '写一条批注'}</h2><p>关联原文，不改变文章内容</p></div>
                  <button type="button" className="nn-annotation-close" aria-label="关闭编辑器" onClick={() => setNoteEditor(null)}><X size={18}/></button>
                </div>
                <blockquote className="nn-annotation-quote">{noteEditor.anchor.exact.slice(0,160)}</blockquote>
                <div className="nn-annotation-editor-types" role="group" aria-label="批注类型">
                  {(['note','insert','replace','transpose'] as const).map(kind =>
                    <button type="button" key={kind} aria-pressed={noteEditor.kind===kind}
                      onClick={() => setNoteEditor({...noteEditor,kind})}>
                      {({note:'旁批',insert:'增补 ∨',replace:'改正',transpose:'对调'})[kind]}
                    </button>
                  )}
                </div>
                <textarea className="nn-annotation-textarea" value={noteEditor.text} maxLength={16000}
                  onChange={event => setNoteEditor({...noteEditor,text:event.target.value})}
                  placeholder="写下你的理解、补充或修改建议…" />
                <div className="nn-annotation-editor-actions">
                  <button type="button" onClick={() => setNoteEditor(null)}>取消</button>
                  <button type="button" onClick={() => void saveEditor()}><Check size={15} className="inline mr-1"/>保存批注</button>
                </div>
              </section>
            </>
          )}

          {message && <div className="nn-annotation-toolbar-error" role="alert" data-annotation-ui>{message}</div>}
        </>,
        document.body
      )}
      <span className="sr-only" aria-live="polite">{annotations.length} 条文章标注</span>
    </>
  )
}
