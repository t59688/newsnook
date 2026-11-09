import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Check, Circle, Eraser, Highlighter, List, PenLine, Pencil, Underline, X } from 'lucide-react'
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

export function ReaderAnnotations({ articleId, contentRef, contentKey, overlayCloserRef }: {
  articleId: string
  contentRef: RefObject<HTMLDivElement | null>
  contentKey: string
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
}) {
  const [annotations, setAnnotations] = useState<ArticleAnnotation[]>([])
  const [tool, setTool] = useState<Tool>('underline')
  const [color, setColor] = useState(PALETTE[0]!)
  const [panelOpen, setPanelOpen] = useState(false)
  const [noteEditor, setNoteEditor] = useState<{ kind: AnnotationKind; anchor: TextAnchor; id?: string; text: string } | null>(null)
  const [message, setMessage] = useState('')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<{ points: InkPoint[]; anchor: TextAnchor; origin: { x: number; y: number } } | null>(null)
  const [selected, setSelected] = useState<TextAnchor | null>(null)
  const [selectionPosition, setSelectionPosition] = useState<{left:number;top:number}|null>(null)
  useEffect(() => {
    if (!overlayCloserRef || (!noteEditor && !panelOpen && !selected)) return
    const previous = overlayCloserRef.current
    overlayCloserRef.current = () => {
      if (noteEditor) setNoteEditor(null)
      else if (panelOpen) setPanelOpen(false)
      else { setSelected(null); setSelectionPosition(null) }
      return true
    }
    return () => { overlayCloserRef.current = previous }
  }, [overlayCloserRef, noteEditor, panelOpen, selected])
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
      note.className = 'reader-annotations-inline-note'
      note.textContent = (item.kind === 'insert' ? '增补' : item.kind === 'replace' ? '改正' : item.kind === 'transpose' ? '对调' : '批注') + ' · ' + item.note
      note.setAttribute('aria-label', '编辑批注：' + item.note)
      note.addEventListener('click', () => setNoteEditor({kind:item.kind,anchor:item.anchor,id:item.id,text:item.note}))
      block.insertAdjacentElement('afterend', note)
      inserted.push(note)
    }
    return () => inserted.forEach(node => node.remove())
  }, [contentRef, contentKey, annotations])

  const save = useCallback(async (item: ArticleAnnotation) => {
    try {
      await putArticleAnnotation(item)
      await refresh()
    } catch {
      setMessage('保存失败，原有笔记未被覆盖；请检查可用空间')
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
    setSelectionPosition(null)
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
    const rect = range.getClientRects()[0] || range.getBoundingClientRect()
    setSelectionPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - 286)),
      top: rect.bottom + 72 < window.innerHeight ? rect.bottom + 8 : Math.max(8,rect.top - 52),
    })
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

  return (
    <div ref={rootRef} className="reader-annotations-ui" data-annotation-ui>
      <style>{`
        .reader-annotations-ui{--ann-ink:#a95148;position:relative;z-index:12;font-family:inherit}
        .reader-annotations-toolbar{display:flex;align-items:center;gap:4px;overflow-x:auto;scrollbar-width:none;padding:7px 4px;background:var(--ink-raised,var(--ink));border:1px solid var(--haze);border-radius:14px}
        .reader-annotations-toolbar button{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:34px;height:34px;border-radius:9px;padding:0 8px;color:var(--paper);font-size:12px}
        .reader-annotations-toolbar button[data-active="true"]{background:rgba(166,71,55,.14);color:var(--cinnabar)}
        .reader-annotations-sheet{position:fixed;z-index:100;left:0;right:0;bottom:var(--sab,0px);max-height:65vh;overflow:auto;border-radius:20px 20px 0 0;border:1px solid var(--haze);background:var(--ink);color:var(--paper);padding:18px;box-shadow:0 -10px 45px #0003}
        .reader-annotations-sheet textarea{width:100%;min-height:95px;padding:12px;border-radius:12px;border:1px solid var(--haze);background:var(--ink-raised);color:var(--paper);font-size:15px;resize:vertical}
        .reader-annotations-action{padding:9px 12px;border-radius:10px;background:var(--ink-raised);color:var(--paper);font-size:13px}
        .reader-annotations-ink{pointer-events:none;position:absolute;inset:0;overflow:visible}
        .reader-annotations-inline-note{display:block;width:100%;margin:10px 0 14px;padding:7px 12px;text-align:left;border-left:2px solid var(--cinnabar);background:rgba(166,71,55,.06);border-radius:0 9px 9px 0;font-family:inherit;font-size:12px;line-height:1.65;color:var(--paper-muted);white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer}
        .reader-annotations-inline-note::first-letter{color:var(--cinnabar)}
      `}</style>
      <div className="reader-annotations-toolbar" role="toolbar" aria-label="文章标注工具">
        {([
          ['select', '选字', PenLine], ['highlight', '荧光', Highlighter], ['underline', '划线', Underline],
          ['circle', '圈注', Circle], ['ink', '手写', Pencil], ['eraser', '擦除', Eraser],
        ] as const).map(([value, label, Icon]) =>
          <button key={value} type="button" data-active={tool === value} title={label} onClick={() => setTool(value)}><Icon size={17} />{tool === value ? label : ''}</button>)}
        <button type="button" title="选择笔迹颜色" onClick={() => setColor(PALETTE[(PALETTE.indexOf(color) + 1) % PALETTE.length]!)}><span style={{ width: 16, height: 16, backgroundColor: color, borderRadius: '50%', border: '1px solid #888' }} /></button>
        <button type="button" onClick={() => setPanelOpen(true)} title="文章笔记"><List size={17} /><span>{annotations.length}</span></button>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ transform: 'translateY(0)' }}
      />
      <div
        className={selected ? 'flex gap-1 items-center p-1.5 rounded-xl border border-haze bg-ink shadow-xl overflow-x-auto max-w-[calc(100vw-24px)]' : 'flex gap-2 items-center py-2'}
        style={selected && selectionPosition ? {position:'fixed',left:selectionPosition.left,top:selectionPosition.top,zIndex:120} : undefined}
        data-annotation-ui
      >
        {!selected && <button type="button" className="reader-annotations-action" onClick={captureSelection}>标注选中文字</button>}
        {selected && (
          <>
            <button type="button" className="reader-annotations-action" onClick={() => record('highlight', selected)}>高亮</button>
            <button type="button" className="reader-annotations-action" onClick={() => record('underline', selected)}>下划线</button>
            <button type="button" className="reader-annotations-action" onClick={() => record('circle', selected)}>圈注</button>
            <button type="button" className="reader-annotations-action" onClick={() => record('strike', selected)}>删除线</button>
            <button type="button" className="reader-annotations-action" onClick={() => {setSelected(null);setSelectionPosition(null);setNoteEditor({ kind: 'note', anchor: selected, text: '' })}}>写批注</button>
            <button type="button" className="reader-annotations-action" onClick={() => {setSelected(null);setSelectionPosition(null);setNoteEditor({ kind: 'insert', anchor: selected, text: '' })}}>校对</button>
            <button type="button" className="reader-annotations-action" onClick={() => {setSelected(null);setSelectionPosition(null)}} aria-label="关闭文字标注工具"><X size={15}/></button>
          </>
        )}
      </div>
      {message && <div role="alert" className="text-sm text-cinnabar py-2">{message}</div>}
      {root && shapes.length > 0 && (
        <svg className="reader-annotations-ink" style={{ top: overlayTop, left: overlayLeft, height: root.scrollHeight, width: root.offsetWidth }} aria-hidden="true">
          {shapes.map(shape => {
            const item = shape.annotation
            if (item.kind === 'ink') return item.strokes?.map((stroke, i) =>
              <g key={item.id + i} fill="none" stroke={stroke.color} strokeLinejoin="round" strokeLinecap="round">
                {Array.from({ length: Math.ceil((stroke.points.length - 1) / 12) }, (_, index) => {
                  const chunk = stroke.points.slice(index * 12, (index + 1) * 12 + 1)
                  const averagePressure = chunk.reduce((total, point) => total + point.pressure, 0) / chunk.length
                  return <polyline key={index} points={chunk.map(p => `${shape.origin.x + p.x},${shape.origin.y + p.y}`).join(' ')} strokeWidth={stroke.width * (0.55 + averagePressure)} />
                })}
              </g>)
            return shape.rects.map((rect, i) => item.kind === 'circle'
              ? <rect key={item.id + i} x={rect.x - 3} y={rect.y - 2} width={rect.width + 6} height={rect.height + 4} rx={rect.height / 2} fill="none" stroke={item.color} strokeWidth="1.7" />
              : item.kind === 'highlight' ? <rect key={item.id + i} x={rect.x} y={rect.y + rect.height * 0.47} width={rect.width} height={rect.height * 0.48} fill={item.color} opacity=".28" />
              : item.kind === 'strike' ? <path key={item.id + i} d={`M ${rect.x} ${rect.y + rect.height / 2} L ${rect.x + rect.width} ${rect.y + rect.height / 2}`} stroke={item.color} strokeWidth="1.6" />
              : item.kind === 'insert' ? <g key={item.id+i} fill={item.color} stroke={item.color}><path d={`M ${rect.x+rect.width-5} ${rect.y-3} l 5 5 l 5 -5`} fill="none" strokeWidth="1.4"/><text x={rect.x+rect.width} y={rect.y-9} fontSize="10" fontWeight="500" textAnchor="middle" stroke="none">{item.note.slice(0,4)}</text></g>
              : <path key={item.id + i} d={`M ${rect.x} ${rect.y + rect.height - 3} L ${rect.x + rect.width} ${rect.y + rect.height - 3}`} stroke={item.color} strokeWidth="1.8" />)
          })}
          {draft && <polyline points={draft.points.map(p => `${p.x + (draft.origin.x - (layer?.left || 0))},${p.y + (draft.origin.y - (layer?.top || 0))}`).join(' ')} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
      )}
      {shapes.filter(shape => shape.annotation.kind === 'note' || shape.annotation.kind === 'replace' || shape.annotation.kind === 'transpose').map(shape => (
        <button
          type="button"
          key={shape.annotation.id}
          data-annotation-ui
          title={shape.annotation.note || '查看批注'}
          onClick={() => setNoteEditor({ kind: shape.annotation.kind, anchor: shape.annotation.anchor, id: shape.annotation.id, text: shape.annotation.note })}
          style={{position:'absolute',left:overlayLeft + Math.min(shape.origin.x + shape.origin.width + 2, Math.max(0, (root?.offsetWidth || 0) - 30)),top:overlayTop + Math.max(0,shape.origin.y-18),zIndex:3,minWidth:24,minHeight:24,borderRadius:8,background:'var(--ink-raised)',color:shape.annotation.color,border:'1px solid var(--haze)',fontSize:11}}
          aria-label={'查看正文批注：' + (shape.annotation.note || '无文字')}
        >{shape.annotation.kind==='transpose' ? '⇄' : shape.annotation.kind==='replace' ? '改' : '✎'}</button>
      ))}
      {panelOpen && <div className="reader-annotations-sheet" role="dialog" aria-label="文章笔记" data-annotation-ui>
        <div className="flex justify-between items-center mb-3"><strong>我的标注 · {annotations.length}</strong><div className="flex gap-3 items-center"><button type="button" onClick={exportMarkdown} className="text-xs">导出 MD</button><button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭"><X size={20}/></button></div></div>
        {annotations.length === 0 && <p className="text-sm text-paper-muted">选中文字，或用触控笔直接在正文上划写。</p>}
        {annotations.map(item => <div key={item.id} className="py-3 border-b border-haze/40">
          <button type="button" className="text-left block w-full" onClick={() => locate(item)}>
            <span className="block text-xs text-paper-muted">{item.kind} · 点击定位原文</span>
            <span className="block text-sm leading-relaxed mt-1">{item.anchor.exact.slice(0, 90) || '手写批注'}</span>
            {item.note && <span className="block text-xs mt-2 text-cinnabar">{item.note}</span>}
          </button>
          <div className="flex gap-3 mt-2">
            <button type="button" className="text-xs" onClick={() => { setNoteEditor({kind:item.kind,anchor:item.anchor,id:item.id,text:item.note});setPanelOpen(false) }}>编辑</button>
            <button type="button" className="text-xs text-cinnabar" onClick={() => void remove(item)}>删除</button>
          </div>
        </div>)}
      </div>}
      {noteEditor && <div className="reader-annotations-sheet" role="dialog" aria-label="编辑批注" data-annotation-ui>
        <div className="flex justify-between items-center mb-3"><strong>{noteEditor.kind === 'insert' ? '校对建议' : '文字批注'}</strong><button type="button" onClick={() => setNoteEditor(null)} aria-label="关闭"><X size={20}/></button></div>
        <p className="text-xs text-paper-muted mb-3">原文：{noteEditor.anchor.exact.slice(0, 100)}</p>
        <div className="flex gap-2 mb-3 flex-wrap">
          {(['note', 'insert', 'replace', 'transpose'] as const).map(kind => <button key={kind} type="button" className="reader-annotations-action" style={{outline:noteEditor.kind===kind ? '1px solid var(--cinnabar)' : undefined}} onClick={() => setNoteEditor({...noteEditor,kind})}>{({note:'旁批',insert:'增补 ∨',replace:'改正',transpose:'对调'})[kind]}</button>)}
        </div>
        <textarea autoFocus value={noteEditor.text} maxLength={16000} onChange={event => setNoteEditor({ ...noteEditor, text: event.target.value })} placeholder="写下你的想法…" />
        <div className="flex gap-3 justify-end mt-3">
          <button type="button" className="reader-annotations-action" onClick={() => setNoteEditor(null)}>取消</button>
          <button type="button" className="reader-annotations-action" onClick={() => {
            const old = annotations.find(a => a.id === noteEditor.id)
            if (old) void save({ ...old, note: noteEditor.text, updatedAt: Date.now() })
            else record(noteEditor.kind, noteEditor.anchor, noteEditor.text)
            setNoteEditor(null)
          }}><Check size={15} className="inline mr-1"/>保存</button>
        </div>
      </div>}
      <div className="sr-only" aria-live="polite">{annotations.length} 条文章标注</div>
    </div>
  )
}
