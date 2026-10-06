import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
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
  'linuxdo-control min-h-11 w-full rounded-xl border border-haze/70 bg-ink px-3 py-2 text-[14px] text-paper outline-none focus:border-cinnabar/60'
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
      const first = controls[0],
        last = controls.at(-1)
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
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-stretch sm:justify-end"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl sm:max-h-full sm:max-w-md sm:rounded-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-haze/60 px-5 py-4">
          <div>
            <h2 id={id} className="text-[18px] font-semibold text-paper">
              高级筛选
            </h2>
            <p className="mt-1 text-[12px] text-paper-faint">组合条件，缩小搜索范围</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭高级筛选"
            className="linuxdo-control grid h-10 w-10 place-items-center rounded-full bg-paper/5 text-paper-muted"
          >
            <X size={18} />
          </button>
        </div>
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
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
            <fieldset className="space-y-3">
              <legend className="mb-3 text-[13px] font-semibold text-paper-muted">分类、标签与作者</legend>
              <div className="space-y-1.5 text-[12px] text-paper-muted">
                <span>分类</span>
                <button
                  type="button"
                  aria-label="选择搜索分类"
                  aria-expanded={categoryOpen}
                  onClick={() => setCategoryOpen(!categoryOpen)}
                  className={fieldClass + ' text-left'}
                >
                  {categories.find((category) => String(category.id) === filters.category)?.name ||
                    filters.category ||
                    '全部分类'}
                </button>
                {categoryOpen ? (
                  <div className="rounded-xl border border-haze/70 bg-ink p-2">
                    <input
                      aria-label="搜索分类"
                      value={categorySearch}
                      onChange={(event) => setCategorySearch(event.target.value)}
                      placeholder="搜索分类名称"
                      className={fieldClass}
                    />
                    <div className="mt-2 max-h-48 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          change('category', '')
                          setCategoryOpen(false)
                        }}
                        className="linuxdo-control min-h-10 w-full rounded-lg px-3 text-left text-paper-muted"
                      >
                        全部分类
                      </button>
                      {matchingCategories.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => {
                            change('category', String(category.id))
                            setCategoryOpen(false)
                          }}
                          className={
                            'linuxdo-control min-h-11 w-full rounded-lg px-3 text-left text-[13px] ' +
                            (String(category.id) === filters.category
                              ? 'bg-cinnabar/10 text-cinnabar-soft'
                              : 'text-paper-muted hover:bg-paper/5')
                          }
                        >
                          {category.parentId && categories.some((parent) => parent.id === category.parentId)
                            ? categories.find((parent) => parent.id === category.parentId)?.name + ' / '
                            : ''}
                          {category.name}
                        </button>
                      ))}
                      {!matchingCategories.length ? (
                        <p className="px-3 py-4 text-paper-faint">
                          {categories.length ? '没有匹配分类' : '分类尚未加载，可在搜索框使用 category: 语法'}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <label className="block space-y-1.5 text-[12px] text-paper-muted">
                <span>标签</span>
                <input
                  aria-label="筛选标签"
                  value={filters.tags}
                  onChange={(event) => change('tags', event.target.value)}
                  placeholder="多个标签用逗号分隔"
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
                <div className="flex flex-wrap gap-2">
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
                      className="linuxdo-control min-h-9 rounded-full border border-haze/70 px-3 text-[12px] text-paper-muted disabled:opacity-40"
                    >
                      #{tag.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="flex min-h-10 items-center gap-2 text-[13px] text-paper-muted">
                <input
                  type="checkbox"
                  checked={filters.allTags}
                  onChange={(event) => change('allTags', event.target.checked)}
                  className="accent-cinnabar"
                />
                必须包含全部标签
              </label>
              <label className="block space-y-1.5 text-[12px] text-paper-muted">
                <span>作者</span>
                <input
                  aria-label="作者用户名"
                  value={filters.author}
                  onChange={(event) => change('author', event.target.value.replace(/^@/, ''))}
                  placeholder="用户名，无需输入 @"
                  className={fieldClass}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[13px] font-semibold text-paper-muted">搜索范围</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {linuxDoSearchScopes.map((scope) => {
                  const personal = 'personal' in scope && scope.personal
                  return (
                    <label
                      key={scope.id}
                      className={
                        'flex min-h-11 items-center gap-2 rounded-xl bg-paper/[0.035] px-3 text-[13px] text-paper-muted ' +
                        (personal && !authenticated ? 'opacity-45' : '')
                      }
                    >
                      <input
                        type="checkbox"
                        disabled={personal && !authenticated}
                        checked={filters.scopes.includes(scope.id)}
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
                        className="accent-cinnabar"
                      />
                      {scope.label}
                    </label>
                  )
                })}
              </div>
              {!authenticated ? (
                <p className="mt-2 text-[12px] text-paper-faint">个人阅读与互动条件需登录 LinuxDO</p>
              ) : null}
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[13px] font-semibold text-paper-muted">主题状态</legend>
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
                ].map(([id, label]) => (
                  <label
                    key={id}
                    className={
                      'linuxdo-control flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-[12px] ' +
                      (filters.status === id
                        ? 'border-cinnabar/30 bg-cinnabar/10 text-cinnabar-soft'
                        : 'border-haze/60 text-paper-muted')
                    }
                  >
                    <input
                      type="radio"
                      name="linuxdo-search-status"
                      checked={filters.status === id}
                      onChange={() => change('status', id)}
                      className="accent-cinnabar"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[13px] font-semibold text-paper-muted">发帖日期</legend>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ['after', '晚于'],
                    ['before', '早于'],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="min-w-0 space-y-1.5 text-[12px] text-paper-muted">
                    <span>{label}</span>
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
            </fieldset>
            <fieldset>
              <legend className="mb-3 text-[13px] font-semibold text-paper-muted">帖子数与浏览量</legend>
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
                    <span>{label}</span>
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
            </fieldset>
          </div>
          <div className="shrink-0 border-t border-haze/60 px-5 pt-3 pb-[max(16px,var(--sab,0px))]">
            {error ? (
              <p role="alert" className="mb-3 text-[13px] text-cinnabar-soft">
                {error}
              </p>
            ) : null}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setFilters(emptyLinuxDoSearchFilters())
                  setError('')
                }}
                className="linuxdo-control min-h-11 rounded-full border border-haze px-5 text-[14px] text-paper-muted"
              >
                重置
              </button>
              <button
                type="submit"
                className="linuxdo-control min-h-11 flex-1 rounded-full bg-cinnabar px-5 text-[14px] font-medium text-white"
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
