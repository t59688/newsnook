import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Calendar,
  Check,
  ChevronDown,
  Hash,
  RotateCcw,
  SlidersHorizontal,
  Tag,
  User,
  X,
} from 'lucide-react'
import { useHardwareBackLayer } from '../../../hooks/useHardwareBackLayer'
import { lockBodyScroll } from '../../../lib/bodyScrollLock'
import {
  buildLinuxDoSearch,
  emptyLinuxDoSearchFilters,
  linuxDoSearchScopes,
  type LinuxDoSearchFilters,
  type LinuxDoSearchQuery,
} from '../search/query'
import { linuxDoDiscovery } from '../runtime'
import { readableError } from './utils'
import type { LinuxDoCategory, LinuxDoTag } from '../types'

const fieldClass =
  'linuxdo-control min-h-11 w-full rounded-xl border border-haze/70 bg-ink/70 px-3.5 py-2.5 text-[14px] text-paper placeholder:text-paper-faint/60 outline-none transition focus:border-cinnabar/60 focus:bg-ink focus:ring-2 focus:ring-cinnabar/15'

export function SearchFilters({
  value,
  categories,
  authenticated,
  onApply,
  onClose,
}: {
  value: LinuxDoSearchQuery
  categories: LinuxDoCategory[]
  authenticated: boolean
  onApply: (query: string) => void
  onClose: () => void
}) {
  const [filters, setFilters] = useState(value.filters)
  const [error, setError] = useState('')
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [tagOptions, setTagOptions] = useState<LinuxDoTag[]>([])
  const [tagError, setTagError] = useState('')
  const [tagLoading, setTagLoading] = useState(false)
  const tagTerm =
    filters.tags
      .split(/[,，+]/)
      .at(-1)
      ?.trim() ?? ''
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const id = useId()
  const matchingCategories = categories.filter((category) =>
    `${category.name} ${category.slug} ${category.id}`
      .toLocaleLowerCase()
      .includes(categorySearch.toLocaleLowerCase())
  )

  useEffect(() => {
    setTagOptions([])
    setTagError('')
    setTagLoading(false)
    if (!tagTerm) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setTagLoading(true)
      void linuxDoDiscovery
        .searchTags(tagTerm, { limit: 8 }, controller.signal)
        .then((options) => {
          if (!controller.signal.aborted) setTagOptions(options)
        })
        .catch((nextError) => {
          if (!controller.signal.aborted) setTagError(readableError(nextError))
        })
        .finally(() => {
          if (!controller.signal.aborted) setTagLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [tagTerm])

  const change = <K extends keyof LinuxDoSearchFilters>(key: K, next: LinuxDoSearchFilters[K]) => {
    setFilters((previous) => ({ ...previous, [key]: next }))
    setError('')
  }

  useHardwareBackLayer(true, () => {
    closeRef.current()
    return true
  })

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const unlock = lockBodyScroll()
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (event.key !== 'Tab') return
      const controls = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
        ) ?? []
      )
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      unlock()
      previousFocus?.focus()
    }
  }, [])

  const selectedCategoryName =
    categories.find((category) => String(category.id) === filters.category)?.name ||
    filters.category ||
    '全部分类'

  return createPortal(
    <div
      className="linuxdo-sheet-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-stretch sm:justify-end"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="linuxdo-sheet flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-t border-haze/80 bg-ink-raised shadow-2xl sm:max-h-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="linuxdo-sheet-grabber mx-auto sm:hidden" />

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-haze/60 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cinnabar/10 text-cinnabar">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h2 id={id} className="text-[17px] font-semibold tracking-tight text-paper">
                高级筛选
              </h2>
              <p className="mt-0.5 text-[11px] text-paper-faint">组合条件，缩小搜索范围</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭高级筛选"
            className="linuxdo-control grid h-9 w-9 place-items-center rounded-full bg-paper/5 text-paper-muted hover:bg-paper/10 hover:text-paper transition active:scale-95"
          >
            <X size={17} />
          </button>
        </div>

        {/* Form Body */}
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            try {
              onApply(buildLinuxDoSearch({ ...value, filters }))
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : '筛选条件无效')
            }
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 scrollbar-thin">
            {/* Category, Tags, Author */}
            <div className="linuxdo-group p-4 space-y-4">
              <div className="linuxdo-section-label !px-0 !py-0">分类、标签与作者</div>

              {/* Category */}
              <div className="space-y-1.5 text-[12px] text-paper-muted">
                <span className="font-medium text-paper">分类</span>
                <button
                  type="button"
                  aria-label="选择搜索分类"
                  aria-expanded={categoryOpen}
                  onClick={() => setCategoryOpen(!categoryOpen)}
                  className={
                    fieldClass +
                    ' flex items-center justify-between text-left ' +
                    (filters.category ? 'text-cinnabar-soft font-medium' : 'text-paper')
                  }
                >
                  <span className="truncate">{selectedCategoryName}</span>
                  <ChevronDown
                    size={16}
                    className={
                      'shrink-0 text-paper-muted transition-transform duration-200 ' +
                      (categoryOpen ? 'rotate-180' : '')
                    }
                  />
                </button>

                {categoryOpen ? (
                  <div className="mt-2 rounded-2xl border border-haze/80 bg-ink p-2.5 shadow-xl">
                    <input
                      aria-label="搜索分类"
                      value={categorySearch}
                      onChange={(event) => setCategorySearch(event.target.value)}
                      placeholder="搜索分类名称"
                      className={fieldClass}
                    />
                    <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
                      <button
                        type="button"
                        onClick={() => {
                          change('category', '')
                          setCategoryOpen(false)
                        }}
                        className={
                          'linuxdo-control min-h-10 w-full rounded-xl px-3 text-left text-[13px] transition ' +
                          (!filters.category
                            ? 'bg-cinnabar/10 text-cinnabar-soft font-medium'
                            : 'text-paper-muted hover:bg-paper/5')
                        }
                      >
                        全部分类
                      </button>
                      {matchingCategories.map((category) => {
                        const isSelected = String(category.id) === filters.category
                        const parentPrefix =
                          category.parentId && categories.some((parent) => parent.id === category.parentId)
                            ? (categories.find((parent) => parent.id === category.parentId)?.name ?? '') + ' / '
                            : ''
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => {
                              change('category', String(category.id))
                              setCategoryOpen(false)
                            }}
                            className={
                              'linuxdo-control flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-[13px] transition ' +
                              (isSelected
                                ? 'bg-cinnabar/10 text-cinnabar-soft font-semibold'
                                : 'text-paper-muted hover:bg-paper/5 hover:text-paper')
                            }
                          >
                            <span className="truncate">
                              {parentPrefix}
                              {category.name}
                            </span>
                            {isSelected ? <Check size={14} className="shrink-0 text-cinnabar" /> : null}
                          </button>
                        )
                      })}
                      {!matchingCategories.length ? (
                        <p className="px-3 py-4 text-center text-[12px] text-paper-faint">
                          {categories.length ? '没有匹配分类' : '分类尚未加载，可在搜索框使用 category: 语法'}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Tags */}
              <label className="block space-y-1.5 text-[12px] text-paper-muted">
                <span className="flex items-center gap-1.5 font-medium text-paper">
                  <Tag size={13} className="text-paper-muted" />
                  标签
                </span>
                <input
                  aria-label="筛选标签"
                  value={filters.tags}
                  onChange={(event) => change('tags', event.target.value)}
                  placeholder="多个标签用逗号分隔，如：dev, web"
                  className={fieldClass}
                />
              </label>
              {tagLoading ? (
                <p role="status" className="text-[12px] text-paper-faint">
                  正在查找标签…
                </p>
              ) : null}
              {tagError ? (
                <p className="text-[12px] text-paper-faint">标签建议暂不可用：{tagError}，仍可直接输入标签</p>
              ) : null}
              {tagOptions.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {tagOptions.map((tag) => (
                    <button
                      key={tag.name}
                      type="button"
                      disabled={tag.disabled}
                      title={tag.disabledReason}
                      onClick={() => {
                        const selected = filters.tags
                          .split(/[,，+]/)
                          .slice(0, -1)
                          .map((item) => item.trim())
                          .filter(Boolean)
                        change('tags', [...new Set([...selected, tag.name])].join(', ') + ', ')
                      }}
                      className="linuxdo-control inline-flex min-h-8 items-center gap-1 rounded-full border border-haze/80 bg-paper/[0.03] px-3 text-[12px] text-paper-muted transition hover:border-cinnabar/40 hover:text-paper disabled:opacity-40"
                    >
                      <Hash size={11} className="text-paper-faint" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex min-h-9 items-center gap-2 text-[13px] text-paper-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={filters.allTags}
                  onChange={(event) => change('allTags', event.target.checked)}
                  className="h-4 w-4 rounded accent-cinnabar"
                />
                <span>必须包含全部标签</span>
              </label>

              {/* Author */}
              <label className="block space-y-1.5 text-[12px] text-paper-muted">
                <span className="flex items-center gap-1.5 font-medium text-paper">
                  <User size={13} className="text-paper-muted" />
                  作者
                </span>
                <input
                  aria-label="作者用户名"
                  value={filters.author}
                  onChange={(event) => change('author', event.target.value.replace(/^@/, ''))}
                  placeholder="用户名，无需输入 @"
                  className={fieldClass}
                />
              </label>
            </div>

            {/* Search Scopes */}
            <div className="linuxdo-group p-4 space-y-3">
              <div className="linuxdo-section-label !px-0 !py-0">搜索范围</div>
              <div className="grid grid-cols-2 gap-2">
                {linuxDoSearchScopes.map((scope) => {
                  const personal = 'personal' in scope && scope.personal
                  const checked = filters.scopes.includes(scope.id)
                  return (
                    <label
                      key={scope.id}
                      className={
                        'linuxdo-control flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[13px] transition select-none ' +
                        (personal && !authenticated
                          ? 'opacity-40 border-transparent bg-paper/[0.02]'
                          : checked
                            ? 'border-cinnabar/30 bg-cinnabar/[0.08] text-paper font-medium'
                            : 'border-haze/50 bg-paper/[0.025] text-paper-muted hover:border-haze/80')
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={personal && !authenticated}
                        checked={checked}
                        onChange={(event) =>
                          change(
                            'scopes',
                            event.target.checked
                              ? [
                                  ...filters.scopes.filter(
                                    (item) =>
                                      !(item === 'seen' && scope.id === 'unseen') &&
                                      !(item === 'unseen' && scope.id === 'seen')
                                  ),
                                  scope.id,
                                ]
                              : filters.scopes.filter((item) => item !== scope.id)
                          )
                        }
                        className="h-4 w-4 rounded accent-cinnabar"
                      />
                      <span className="truncate">{scope.label}</span>
                    </label>
                  )
                })}
              </div>
              {!authenticated ? (
                <p className="text-[11px] text-paper-faint">个人阅读与互动条件需登录 LinuxDO</p>
              ) : null}
            </div>

            {/* Topic Status */}
            <div className="linuxdo-group p-4 space-y-3">
              <div className="linuxdo-section-label !px-0 !py-0">主题状态</div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['', '不限'],
                  ['open', '开放'],
                  ['closed', '已关闭'],
                  ['archived', '已归档'],
                  ['noreplies', '无回复'],
                  ['single_user', '仅一人参与'],
                  ['solved', '已解决'],
                  ['unsolved', '未解决'],
                ].map(([statusId, label]) => {
                  const isChecked = filters.status === statusId
                  return (
                    <label
                      key={statusId}
                      className={
                        'linuxdo-control flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] transition select-none ' +
                        (isChecked
                          ? 'border-cinnabar/40 bg-cinnabar/15 text-cinnabar-soft font-semibold shadow-sm'
                          : 'border-haze/70 bg-paper/[0.02] text-paper-muted hover:border-haze hover:text-paper')
                      }
                    >
                      <input
                        type="radio"
                        name="linuxdo-search-status"
                        checked={isChecked}
                        onChange={() => change('status', statusId)}
                        className="sr-only"
                      />
                      {isChecked ? <span className="h-1.5 w-1.5 rounded-full bg-cinnabar" /> : null}
                      <span>{label}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Post Date */}
            <div className="linuxdo-group p-4 space-y-3">
              <div className="linuxdo-section-label !px-0 !py-0 flex items-center gap-1.5">
                <Calendar size={13} className="text-paper-muted" />
                发帖日期
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['after', '晚于'],
                    ['before', '早于'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="min-w-0 space-y-1.5 text-[12px] text-paper-muted">
                    <span className="font-medium text-paper">{label}</span>
                    <input
                      aria-label={label + '日期'}
                      type="date"
                      value={filters[key]}
                      onChange={(event) => change(key, event.target.value)}
                      className={fieldClass + ' min-w-0'}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Counts & Views */}
            <div className="linuxdo-group p-4 space-y-3">
              <div className="linuxdo-section-label !px-0 !py-0">帖子数与浏览量</div>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['minPosts', '最少帖子数'],
                    ['maxPosts', '最多帖子数'],
                    ['minViews', '最少浏览量'],
                    ['maxViews', '最多浏览量'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="space-y-1.5 text-[12px] text-paper-muted">
                    <span className="font-medium text-paper">{label}</span>
                    <input
                      aria-label={label}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={filters[key]}
                      onChange={(event) => change(key, event.target.value)}
                      placeholder="不限"
                      className={fieldClass}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="shrink-0 border-t border-haze/60 bg-ink-raised/95 px-5 pt-3.5 pb-[max(18px,var(--sab,0px))] backdrop-blur-md">
            {error ? (
              <div
                role="alert"
                className="mb-3 rounded-xl border border-cinnabar/30 bg-cinnabar/10 px-3.5 py-2 text-[12.5px] font-medium text-cinnabar-soft"
              >
                {error}
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setFilters(emptyLinuxDoSearchFilters())
                  setError('')
                }}
                className="linuxdo-control inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-haze/80 bg-paper/[0.03] px-5 text-[14px] font-medium text-paper-muted transition hover:bg-paper/[0.08] hover:text-paper active:scale-[0.98]"
              >
                <RotateCcw size={14} />
                重置
              </button>
              <button
                type="submit"
                className="linuxdo-control min-h-11 flex-1 rounded-full bg-gradient-to-r from-cinnabar to-[#d93829] px-6 text-[14px] font-semibold text-white shadow-md shadow-cinnabar/20 transition hover:brightness-105 active:scale-[0.98]"
              >
                应用并搜索
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
