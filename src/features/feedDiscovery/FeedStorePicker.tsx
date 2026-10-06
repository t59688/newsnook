import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { OptionPickerDialog, type OptionPickerItem } from '../../components/ConfirmDialog'

export function FeedStorePicker({ title, value, options, onChange, disabled = false }: {
  title: string
  value: string
  options: OptionPickerItem[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <>
    <button
      type="button"
      aria-label={title}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen(true)}
      className="flex min-h-11 w-full max-w-full items-center justify-between gap-2 rounded-xl border border-haze bg-ink/40 px-3.5 text-left text-[13px] text-paper outline-none transition-colors hover:border-cinnabar/35 focus-visible:border-cinnabar disabled:opacity-40"
    >
      <span className="truncate">{options.find((item) => item.id === value)?.label ?? '请选择'}</span>
      <ChevronDown size={15} strokeWidth={1.7} className="shrink-0 text-paper-faint" />
    </button>
    <OptionPickerDialog open={open} title={title} value={value} options={options} searchPlaceholder={options.length > 12 ? '搜索选项' : undefined} onCancel={() => setOpen(false)} onChange={(next) => { onChange(next); setOpen(false) }} />
  </>
}
