import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search } from 'lucide-react'

import { lockBodyScroll } from '../lib/bodyScrollLock'
import { useHardwareBackLayer } from '../hooks/useHardwareBackLayer'

/** 弹窗次要操作：描边取消钮 */
const DIALOG_CANCEL_CLASS =
  'rounded-full border border-haze bg-transparent px-4 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper'

/** 弹窗主操作：朱砂描边 + 浅底，明暗主题下字色都用 cinnabar-soft 保证对比度 */
const DIALOG_CONFIRM_CLASS =
  'rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 disabled:opacity-35'

export interface OptionPickerItem<T extends string = string> {
  id: T
  label: string
  description?: string
}

interface OptionPickerDialogProps<T extends string> {
  open: boolean
  title: string
  value: T
  options: OptionPickerItem<T>[]
  onChange: (value: T) => void
  onCancel: () => void
  /** 大列表（如系统 TTS voice）可启用主题内搜索，避免退回原生 select。 */
  searchPlaceholder?: string
  emptyLabel?: string
}

/** 应用内单选弹窗，替代原生 select（Android WebView 会弹出系统白底对话框） */
export function OptionPickerDialog<T extends string>({
  open,
  title,
  value,
  options,
  onChange,
  onCancel,
  searchPlaceholder,
  emptyLabel = '没有匹配项',
}: OptionPickerDialogProps<T>) {
  const titleId = useId()
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredOptions = searchPlaceholder
    ? options.filter((option) =>
        (option.label + ' ' + (option.description ?? ''))
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
    : options
  useHardwareBackLayer(open, () => {
    onCancel()
    return true
  })

  useEffect(() => {
    if (!open) return
    setQuery('')
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    const unlock = lockBodyScroll()
    window.addEventListener('keydown', onKey)
    return () => {
      unlock()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onCancel])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-4"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(78vh,520px)] w-full max-w-sm flex-col overflow-hidden rounded-t-3xl border border-haze bg-ink-raised shadow-2xl md:rounded-2xl"
        style={{ paddingBottom: 'calc(var(--sab, 0px) + 12px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-haze" />
        </div>
        <h3
          id={titleId}
          className="shrink-0 border-b border-haze/50 px-5 pt-3 pb-3 font-display text-[17px] font-medium text-paper"
        >
          {title}
        </h3>
        {searchPlaceholder && (
          <div className="shrink-0 border-b border-haze/50 px-4 py-3">
            <label className="flex min-h-10 items-center gap-2 rounded-xl border border-haze bg-ink px-3 focus-within:border-cinnabar/50">
              <Search size={14} strokeWidth={1.8} className="shrink-0 text-paper-faint" aria-hidden />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-paper outline-none placeholder:text-paper-faint/55"
                autoComplete="off"
              />
            </label>
          </div>
        )}
        <ul className="scroll-hidden min-h-0 flex-1 divide-y divide-haze overflow-y-auto overscroll-contain" role="listbox">
          {filteredOptions.map((option) => {
            const checked = option.id === value
            return (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => onChange(option.id)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-paper/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] text-paper">{option.label}</span>
                    {option.description && (
                      <span className="mt-0.5 block truncate font-mono text-[9.5px] text-paper-faint">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {checked ? (
                    <Check size={16} strokeWidth={2.2} className="shrink-0 text-cinnabar" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-haze" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
          {filteredOptions.length === 0 && (
            <li className="px-5 py-8 text-center font-mono text-[10.5px] text-paper-faint">
              {emptyLabel}
            </li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** 保留语义标记；视觉与主确认钮统一，避免另套 rose 浅字低对比 */
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

interface AlertDialogProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  onClose: () => void
}

/** 应用内提示弹窗，替代 alert（WebView 原生框不适配 Android 体验） */
export function AlertDialog({
  open,
  title,
  message,
  confirmLabel = '知道了',
  onClose,
}: AlertDialogProps) {
  const titleId = useId()
  useHardwareBackLayer(open, () => {
    onClose()
    return true
  })

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const unlock = lockBodyScroll()
    window.addEventListener('keydown', onKey)
    return () => {
      unlock()
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="font-display text-[17px] font-medium text-paper">
          {title}
        </h3>
        <div className="mt-2 text-[12.5px] leading-relaxed text-paper-muted">{message}</div>
        <div className="mt-5 flex items-center justify-end">
          <button type="button" onClick={onClose} className={DIALOG_CONFIRM_CLASS}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 应用内确认弹窗，替代 window.confirm（WebView 原生框不适配 Android 体验） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useHardwareBackLayer(open, () => {
    onCancel()
    return true
  })
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ink-confirm-title"
        className="w-full max-w-sm rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="ink-confirm-title" className="font-display text-[17px] font-medium text-paper">
          {title}
        </h3>
        <div className="mt-2 text-[12.5px] leading-relaxed text-paper-muted">{message}</div>
        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button type="button" onClick={onCancel} className={DIALOG_CANCEL_CLASS}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={DIALOG_CONFIRM_CLASS}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface PromptDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  label?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** 应用内输入弹窗，替代 window.prompt */
export function PromptDialog({
  open,
  title,
  message,
  label = '名称',
  defaultValue = '',
  confirmLabel = '保存',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const inputId = useId()
  useHardwareBackLayer(open, () => {
    onCancel()
    return true
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    if (!open) return
    setValue(defaultValue)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [open, defaultValue])

  if (!open || typeof document === 'undefined') return null

  const trimmed = value.trim()

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 px-4 backdrop-blur-sm"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ink-prompt-title"
        className="flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-haze bg-ink-raised shadow-2xl"
        style={{
          marginTop: 'max(var(--sat, 0px), 16px)',
          marginBottom: 'max(var(--sab, 0px), 16px)',
          maxHeight:
            'calc(100dvh - max(var(--sat, 0px), 16px) - max(var(--sab, 0px), 16px))',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="ink-prompt-title"
          className="shrink-0 px-5 pt-5 font-display text-[17px] font-medium text-paper"
        >
          {title}
        </h3>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {message && (
            <div className="mt-2 text-[12.5px] leading-relaxed text-paper-muted">{message}</div>
          )}
          <label htmlFor={inputId} className="mt-4 block font-mono text-[10px] tracking-[0.14em] text-paper-faint">
            {label}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) onConfirm(trimmed)
              if (event.key === 'Escape') onCancel()
            }}
            className="mt-1.5 w-full rounded-xl border border-haze bg-ink px-3 py-2.5 text-[14px] text-paper outline-none focus:border-cinnabar/50"
          />
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2.5 px-5 pt-4 pb-5">
          <button type="button" onClick={onCancel} className={DIALOG_CANCEL_CLASS}>
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={() => onConfirm(trimmed)}
            className={DIALOG_CONFIRM_CLASS}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
