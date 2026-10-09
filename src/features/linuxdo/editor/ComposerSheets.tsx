import {
  AlignLeft,
  BarChart3,
  Braces,
  CalendarClock,
  Check,
  ChevronRight,
  ClipboardPaste,
  Code2,
  FileText,
  Hash,
  ListTree,
  Loader2,
  MessageSquareQuote,
  Plus,
  RotateCw,
  Search,
  Sigma,
  Sparkles,
  Table2,
  Tag,
  TextQuote,
  WrapText,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useHardwareBackLayer } from '../../../hooks/useHardwareBackLayer'
import { lockBodyScroll } from '../../../lib/bodyScrollLock'
import { sortLinuxDoTags } from '../discovery/service'
import { linuxDoTemplates } from '../runtime'
import {
  collectLinuxDoTemplateTags,
  filterLinuxDoTemplates,
  type LinuxDoComposerTemplate,
} from '../template/service'
import type { LinuxDoCategory, LinuxDoTag } from '../types'
import { normalizeComposerTag, type ComposerSnippetKind } from './model'
import { renderLinuxDoComposerPreview } from './preview'

function ComposerSheet({ open, title, caption, onClose, children }: {
  open: boolean
  title: string
  caption?: string
  onClose: () => void
  children: ReactNode
}) {
  const titleId = useId()
  useHardwareBackLayer(open, () => {
    onClose()
    return true
  })

  useEffect(() => {
    if (!open) return
    const unlock = lockBodyScroll()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      unlock()
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="linuxdo-composer-sheet flex max-h-[min(78dvh,680px)] w-full max-w-xl flex-col overflow-hidden rounded-t-[26px] border border-haze bg-ink-raised shadow-2xl sm:rounded-[26px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2.5 sm:hidden" aria-hidden><span className="h-1 w-10 rounded-full bg-paper/15" /></div>
        <header className="flex items-start gap-3 border-b border-haze/60 px-4 pb-3 pt-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="font-display text-[18px] font-semibold text-paper">{title}</h3>
            {caption ? <p className="mt-0.5 text-[10.5px] leading-relaxed text-paper-faint">{caption}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="linuxdo-control grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper/6 text-paper-muted" aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(18px,var(--sab))] pt-3 sm:px-4">{children}</div>
      </section>
    </div>,
    document.body,
  )
}

function categoryColor(category: LinuxDoCategory): string | undefined {
  return category.color && /^[0-9a-f]{6}$/i.test(category.color) ? `#${category.color}` : undefined
}

export function CategoryPickerSheet({ open, categories, value, onChange, onClose }: {
  open: boolean
  categories: LinuxDoCategory[]
  value?: number
  onChange: (categoryId?: number) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (open) setQuery('') }, [open])
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    if (!needle) return categories
    return categories.filter((category) => `${category.name} ${category.slug} ${category.description || ''}`.toLocaleLowerCase('zh-CN').includes(needle))
  }, [categories, query])
  const parents = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])

  return (
    <ComposerSheet open={open} title="选择分类" caption="分类会决定主题出现的位置与社区规范。" onClose={onClose}>
      <label className="linuxdo-composer-search flex h-11 items-center gap-2 rounded-2xl border border-haze bg-ink px-3 text-paper-muted">
        <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden><Search size={15} /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索分类名称或说明" className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] leading-[1.25] text-paper outline-none placeholder:text-paper-faint" />
      </label>
      <div className="mt-3 grid gap-1.5">
        <button type="button" onClick={() => { onChange(undefined); onClose() }} className="linuxdo-composer-choice linuxdo-control flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper/5 text-paper-faint"><Hash size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-paper">暂不指定</span><span className="mt-0.5 block text-[10px] text-paper-faint">发布时由 LinuxDo 按站点规则处理</span></span>
          {value === undefined ? <Check size={17} className="text-cinnabar" /> : null}
        </button>
        {visible.map((category) => (
          <button key={category.id} type="button" onClick={() => { onChange(category.id); onClose() }} className="linuxdo-composer-choice linuxdo-control flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left">
            <span className="h-3 w-3 shrink-0 rounded-full ring-4 ring-paper/5" style={{ backgroundColor: categoryColor(category) || 'var(--color-haze)' }} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-paper">{category.parentId ? <span className="text-paper-faint">{parents.get(category.parentId)} /</span> : null}{category.name}</span>
              <span className="mt-0.5 line-clamp-1 block text-[10px] text-paper-faint">{category.description || `${category.topicCount ?? 0} 个主题`}</span>
            </span>
            {category.topicCount !== undefined ? <span className="font-mono text-[9.5px] text-paper-faint">{category.topicCount}</span> : null}
            {value === category.id ? <Check size={17} className="shrink-0 text-cinnabar" /> : null}
          </button>
        ))}
        {!visible.length ? <div className="py-10 text-center text-[12px] text-paper-faint">没有找到匹配的分类</div> : null}
      </div>
    </ComposerSheet>
  )
}

export function TagPickerSheet({ open, tags, value, onChange, onSearch, onClose, max = 5 }: {
  open: boolean
  tags: LinuxDoTag[]
  value: string[]
  onChange: (tags: string[]) => void
  onSearch: (query: string) => Promise<LinuxDoTag[]>
  onClose: () => void
  max?: number
}) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<LinuxDoTag[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  useEffect(() => {
    if (!open) return
    setQuery('')
    setSearchResults([])
    setSearching(false)
    setSearchError('')
  }, [open])
  const normalized = normalizeComposerTag(query)
  useEffect(() => {
    if (!open) return
    let active = true
    if (normalized) setSearchResults([])
    setSearching(true)
    setSearchError('')
    const timer = window.setTimeout(() => {
      void onSearch(query.trim()).then((results) => {
        if (active) setSearchResults(results)
      }).catch(() => {
        if (active) setSearchError(normalized ? '标签搜索失败，请稍后重试' : '最新标签同步失败，已显示本地列表')
      }).finally(() => {
        if (active) setSearching(false)
      })
    }, normalized ? 220 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, normalized, onSearch, query])

  const source = normalized
    ? searchResults
    : (searchResults.length ? searchResults : sortLinuxDoTags(tags))
  const exact = source.some((tag) => normalizeComposerTag(tag.name) === normalized) || value.some((tag) => normalizeComposerTag(tag) === normalized)
  const visible = source
    .filter((tag) => !value.includes(tag.name))
    .slice(0, 60)
  const add = (name: string) => {
    if (value.length >= max || value.includes(name)) return
    onChange([...value, name])
    setQuery('')
  }

  return (
    <ComposerSheet open={open} title="添加标签" caption={`最多选择 ${max} 个；没有匹配项时可以创建新标签。`} onClose={onClose}>
      <label className="linuxdo-composer-search flex h-11 items-center gap-2 rounded-2xl border border-haze bg-ink px-3 text-paper-muted">
        <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden><Search size={15} /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索或输入新标签" className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] leading-[1.25] text-paper outline-none placeholder:text-paper-faint" />
        <span className="shrink-0 self-center font-mono text-[9.5px] leading-none text-paper-faint">{value.length}/{max}</span>
      </label>
      {value.length ? <div className="mt-3 flex flex-wrap gap-2">{value.map((name) => <button key={name} type="button" onClick={() => onChange(value.filter((tag) => tag !== name))} className="linuxdo-control inline-flex items-center gap-1 rounded-full bg-cinnabar/12 px-3 py-1.5 text-[11px] text-cinnabar-soft"><span>#</span>{name}<X size={12} /></button>)}</div> : null}
      <div className="mt-3 grid gap-1.5">
        {normalized && !exact && !searching && !searchError ? (
          <button type="button" disabled={value.length >= max} onClick={() => add(normalized)} className="linuxdo-composer-choice linuxdo-control flex min-h-12 items-center gap-3 rounded-2xl px-3 text-left disabled:opacity-40">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-cinnabar/12 text-cinnabar-soft"><Plus size={15} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-medium text-paper">创建 #{normalized}</span><span className="block text-[9.5px] text-paper-faint">能否创建最终由 LinuxDo 的账号权限决定</span></span>
          </button>
        ) : null}
        {visible.map((tag) => (
          <button key={tag.name} type="button" disabled={value.length >= max || tag.disabled} onClick={() => add(tag.name)} title={tag.disabledReason} className="linuxdo-composer-choice linuxdo-control flex min-h-11 items-center gap-3 rounded-2xl px-3 text-left disabled:opacity-40">
            <Hash size={14} className="shrink-0 text-paper-faint" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-paper">{tag.name}</span>
            {tag.topicCount !== undefined ? <span className="font-mono text-[10px] text-paper-faint">×{tag.topicCount}</span> : null}
            <Plus size={14} className="text-paper-faint" />
          </button>
        ))}
        {searching && normalized ? <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-paper-faint"><Loader2 size={14} className="animate-spin" />正在搜索 LinuxDo 标签</div> : null}
        {searching && !normalized ? <div className="flex items-center justify-center gap-2 py-2 text-[10px] text-paper-faint"><Loader2 size={12} className="animate-spin" />正在同步最新标签</div> : null}
        {searchError ? <div className={(visible.length ? 'py-2' : 'py-10') + ' text-center text-[11px] text-cinnabar-soft'}>{searchError}</div> : null}
        {!searching && !searchError && !visible.length && normalized && exact ? <div className="py-10 text-center text-[12px] text-paper-faint">没有更多匹配标签</div> : null}
        {!visible.length && !normalized ? <div className="py-10 text-center text-[12px] text-paper-faint">输入关键词查找标签</div> : null}
      </div>
    </ComposerSheet>
  )
}

const TEMPLATE_TAG_STORAGE_KEY = 'newsnook-linuxdo-template-selected-tag'
const TEMPLATE_ALL_TAGS = '*'
const TEMPLATE_NO_TAGS = '__none__'

function readTemplateTagPreference(): string {
  try {
    return window.localStorage.getItem(TEMPLATE_TAG_STORAGE_KEY) || TEMPLATE_ALL_TAGS
  } catch {
    return TEMPLATE_ALL_TAGS
  }
}

function saveTemplateTagPreference(value: string): void {
  try {
    if (value === TEMPLATE_ALL_TAGS) window.localStorage.removeItem(TEMPLATE_TAG_STORAGE_KEY)
    else window.localStorage.setItem(TEMPLATE_TAG_STORAGE_KEY, value)
  } catch {
    // Storage can be unavailable in hardened WebViews. Filtering still works in-memory.
  }
}

export function TemplatePickerSheet({
  open,
  onInsert,
  onOpenSource,
  onClose,
}: {
  open: boolean
  onInsert: (template: LinuxDoComposerTemplate) => void
  onOpenSource?: (template: LinuxDoComposerTemplate) => void
  onClose: () => void
}) {
  const [templates, setTemplates] = useState<LinuxDoComposerTemplate[]>([])
  const [query, setQuery] = useState('')
  const [selectedTag, setSelectedTag] = useState(TEMPLATE_ALL_TAGS)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError('')
    void linuxDoTemplates.list({ signal: controller.signal }).then((next) => {
      if (!active) return
      setTemplates(next)
      setLoaded(true)
    }).catch((nextError) => {
      if (!active || (nextError instanceof DOMException && nextError.name === 'AbortError')) return
      setError(nextError instanceof Error ? nextError.message : '模板加载失败')
      setLoaded(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [open, reloadToken])

  const availableTags = useMemo(() => collectLinuxDoTemplateTags(templates), [templates])
  const hasUntagged = useMemo(() => templates.some((template) => template.tags.length === 0), [templates])

  useEffect(() => {
    if (!open || !loaded) return
    const preferred = readTemplateTagPreference()
    const valid = preferred === TEMPLATE_ALL_TAGS
      || (preferred === TEMPLATE_NO_TAGS && hasUntagged)
      || availableTags.some((tag) => tag.name === preferred)
    setSelectedTag(valid ? preferred : TEMPLATE_ALL_TAGS)
  }, [availableTags, hasUntagged, loaded, open])

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const visibleTemplates = useMemo(
    () => filterLinuxDoTemplates(templates, query, selectedTag),
    [templates, query, selectedTag],
  )

  const changeTag = (value: string) => {
    setSelectedTag(value)
    saveTemplateTagPreference(value)
  }

  return (
    <ComposerSheet
      open={open}
      title="插入模板"
      caption="读取 LinuxDO 当前账号可用模板；点击标题可展开预览，右侧粘贴按钮直接插入。"
      onClose={onClose}
    >
      <div className="sticky top-0 z-10 -mx-1 bg-ink-raised/95 px-1 pb-3 backdrop-blur-xl">
        <label className="linuxdo-composer-search flex h-11 items-center gap-2 rounded-2xl border border-haze bg-ink px-3 text-paper-muted">
          <span className="grid h-8 w-8 shrink-0 place-items-center" aria-hidden><Search size={15} /></span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按标题或模板内容搜索"
            aria-label="搜索 LinuxDO 模板"
            className="h-full min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] leading-[1.25] text-paper outline-none placeholder:text-paper-faint"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="linuxdo-control grid h-7 w-7 shrink-0 place-items-center rounded-full bg-paper/7 text-paper-faint hover:text-paper"
              aria-label="清除模板搜索"
            >
              <X size={12} />
            </button>
          ) : null}
        </label>

        {templates.length ? (
          <div className="scrollbar-none mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => changeTag(TEMPLATE_ALL_TAGS)}
              className={'linuxdo-control inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ' + (selectedTag === TEMPLATE_ALL_TAGS ? 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/60 bg-paper/[0.025] text-paper-muted')}
            >
              <Tag size={11} />全部
            </button>
            {hasUntagged ? (
              <button
                type="button"
                onClick={() => changeTag(TEMPLATE_NO_TAGS)}
                className={'linuxdo-control inline-flex min-h-8 shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors ' + (selectedTag === TEMPLATE_NO_TAGS ? 'border-cinnabar/40 bg-cinnabar/12 text-cinnabar-soft' : 'border-haze/60 bg-paper/[0.025] text-paper-muted')}
              >
                无标签
              </button>
            ) : null}
            {availableTags.map((tag) => (
              <button
                key={tag.name}
                type="button"
                onClick={() => changeTag(tag.name)}
                className={'linuxdo-control inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors ' + (selectedTag === tag.name ? 'border-cinnabar/40 bg-cinnabar/12 font-medium text-cinnabar-soft' : 'border-haze/60 bg-paper/[0.025] text-paper-muted')}
              >
                <span># {tag.name}</span><span className="font-mono text-[8.5px] opacity-65">{tag.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading && !loaded ? (
        <div className="space-y-2 py-1" role="status" aria-label="正在加载 LinuxDO 模板">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="linuxdo-skeleton h-14 rounded-2xl border border-haze/50" />)}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-cinnabar/20 bg-cinnabar/[0.06] px-4 py-5 text-center">
          <p className="text-[11.5px] leading-5 text-cinnabar-soft">{error}</p>
          <button
            type="button"
            onClick={() => setReloadToken((value) => value + 1)}
            disabled={loading}
            className="linuxdo-control mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-cinnabar/25 px-3.5 text-[10.5px] font-medium text-cinnabar-soft disabled:opacity-50"
          >
            <RotateCw size={12} className={loading ? 'animate-spin' : ''} />重新加载
          </button>
        </div>
      ) : visibleTemplates.length ? (
        <div className="space-y-1.5">
          {visibleTemplates.map((template) => (
            <details key={template.id} className="group relative overflow-hidden rounded-2xl border border-haze/55 bg-paper/[0.025] open:border-cinnabar/20 open:bg-paper/[0.04]">
              <summary className="linuxdo-control flex min-h-12 cursor-pointer list-none items-center gap-2.5 py-2.5 pl-3 pr-12 text-left [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="shrink-0 text-paper-faint transition-transform group-open:rotate-90" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-paper">{template.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[8.8px] text-paper-faint">
                    <span>使用 {template.usages} 次</span>
                    {template.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                    {template.tags.length > 3 ? <span>+{template.tags.length - 3}</span> : null}
                  </span>
                </span>
              </summary>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onInsert(template)
                  onClose()
                }}
                className="linuxdo-control absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-xl bg-cinnabar/10 text-cinnabar-soft transition-all hover:bg-cinnabar/16 active:scale-90"
                aria-label={'插入模板：' + template.title}
                title="插入模板"
              >
                <ClipboardPaste size={15} />
              </button>
              <div className="border-t border-haze/45 px-3 pb-3 pt-2.5">
                <article
                  className="reader-prose linuxdo-post-prose linuxdo-template-preview select-text text-[11.5px] leading-[1.65] text-paper-muted"
                  dangerouslySetInnerHTML={{ __html: renderLinuxDoComposerPreview(template.content) }}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-haze/40 pt-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {template.tags.map((tag) => <span key={tag} className="rounded-full bg-paper/[0.045] px-2 py-1 text-[8.5px] text-paper-faint">#{tag}</span>)}
                  </div>
                  {onOpenSource ? (
                    <button
                      type="button"
                      onClick={() => onOpenSource(template)}
                      className="linuxdo-control min-h-8 rounded-full px-2.5 text-[9.5px] font-medium text-paper-faint hover:bg-paper/5 hover:text-paper"
                    >
                      查看模板来源
                    </button>
                  ) : null}
                </div>
              </div>
            </details>
          ))}
        </div>
      ) : loaded && templates.length ? (
        <div className="py-12 text-center">
          <Search size={20} className="mx-auto mb-2 text-paper-faint" />
          <p className="text-[12px] font-medium text-paper-muted">没有匹配的模板</p>
          <p className="mt-1 text-[10px] text-paper-faint">可换一个关键词或标签筛选</p>
        </div>
      ) : loaded ? (
        <div className="py-12 text-center">
          <FileText size={20} className="mx-auto mb-2 text-paper-faint" />
          <p className="text-[12px] font-medium text-paper-muted">当前账号没有可用模板</p>
          <p className="mt-1 text-[10px] text-paper-faint">LinuxDO 只返回当前账号有权限读取的模板主题</p>
        </div>
      ) : null}
    </ComposerSheet>
  )
}

const INSERT_ITEMS: Array<{ id: ComposerSnippetKind; label: string; caption: string; icon: LucideIcon }> = [
  { id: 'quote-post', label: '引用整个帖子', caption: '带作者与楼层信息引用当前主题首帖', icon: MessageSquareQuote },
  { id: 'preformatted', label: '预格式化文本', caption: '保持空格与换行的纯文本代码块', icon: Code2 },
  { id: 'table', label: '插入表格', caption: '三列两行，可直接继续编辑', icon: Table2 },
  { id: 'toc', label: '插入目录', caption: '按正文标题自动生成目录', icon: ListTree },
  { id: 'scrolling', label: '插入滚动内容', caption: '折叠超长日志或输出', icon: WrapText },
  { id: 'mermaid', label: 'Mermaid 图表', caption: '插入流程图源码块', icon: Braces },
  { id: 'chart', label: 'Build Chart', caption: '插入可视化图表数据模板', icon: BarChart3 },
  { id: 'details', label: '隐藏详细信息', caption: '创建可展开的 Details 区块', icon: AlignLeft },
  { id: 'graphviz', label: 'Insert Graphviz graph', caption: '插入 DOT 图源码块', icon: Sparkles },
  { id: 'datetime', label: '插入日期/时间', caption: '使用 Asia/Shanghai 本地时间', icon: CalendarClock },
  { id: 'math', label: '插入公式', caption: '创建块级数学公式', icon: Sigma },
  { id: 'footnote', label: '添加脚注', caption: '插入引用标记和脚注内容', icon: Hash },
  { id: 'spoiler', label: '模糊剧透', caption: '发布后点击才会显示内容', icon: TextQuote },
  { id: 'poll', label: '构建投票', caption: '公开单选投票，可继续修改选项', icon: BarChart3 },
  { id: 'line-break', label: '应用换行', caption: '插入明确的 HTML 换行', icon: WrapText },
]

export function InsertMenuSheet({ open, canQuotePost, canUseTemplates, onSelect, onOpenTemplate, onClose }: {
  open: boolean
  canQuotePost: boolean
  canUseTemplates: boolean
  onSelect: (kind: ComposerSnippetKind) => void
  onOpenTemplate: () => void
  onClose: () => void
}) {
  return (
    <ComposerSheet open={open} title="插入内容" caption="插入的是 LinuxDo 兼容源码，可在预览中确认结构。" onClose={onClose}>
      <div className="grid gap-1 sm:grid-cols-2">
        {canUseTemplates ? (
          <button
            type="button"
            onClick={() => { onClose(); onOpenTemplate() }}
            className="linuxdo-composer-choice linuxdo-control flex min-h-[58px] items-center gap-3 rounded-2xl px-3 text-left"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cinnabar/10 text-cinnabar-soft"><FileText size={17} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-paper">插入模板</span>
              <span className="mt-0.5 line-clamp-1 block text-[9.5px] text-paper-faint">读取 LinuxDO 当前账号可用模板</span>
            </span>
            <ChevronRight size={14} className="shrink-0 text-paper-faint" />
          </button>
        ) : null}
        {INSERT_ITEMS.filter((item) => item.id !== 'quote-post' || canQuotePost).map((item) => {
          const Icon = item.icon
          return (
            <button key={item.id} type="button" onClick={() => { onSelect(item.id); onClose() }} className="linuxdo-composer-choice linuxdo-control flex min-h-[58px] items-center gap-3 rounded-2xl px-3 text-left">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-paper/5 text-paper-muted"><Icon size={17} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-medium text-paper">{item.label}</span><span className="mt-0.5 line-clamp-1 block text-[9.5px] text-paper-faint">{item.caption}</span></span>
            </button>
          )
        })}
      </div>
    </ComposerSheet>
  )
}
