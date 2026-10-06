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
    <button type="button" aria-label={title} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)} className="flex min-h-11 max-w-full items-center justify-between gap-2 rounded-md border border-haze bg-ink px-3 text-left text-[12px] text-paper outline-none focus-visible:border-cinnabar disabled:opacity-40">
      <span className="truncate">{options.find((item) => item.id === value)?.label ?? '请选择'}</span><ChevronDown size={14} className="shrink-0" />
    </button>
    <OptionPickerDialog open={open} title={title} value={value} options={options} searchPlaceholder={options.length > 12 ? '搜索选项' : undefined} onCancel={() => setOpen(false)} onChange={(next) => { onChange(next); setOpen(false) }} />
  </>
}
