/* 开关 —— 复刻 src/components/ToggleSwitch.tsx */
export function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange?: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange?.(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full border p-[2px] transition-all duration-300 active:scale-[0.94] ${
        checked
          ? 'border-cinnabar/60 bg-cinnabar/25 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]'
          : 'border-haze bg-paper/5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.15)]'
      }`}
    >
      <span
        className={`block h-[16px] w-[16px] rounded-full shadow-xs transition-transform duration-300 ease-[var(--ease-ink,cubic-bezier(0.22,1,0.36,1))] ${
          checked ? 'bg-cinnabar' : 'bg-paper/45'
        }`}
        style={{ transform: checked ? 'translate3d(16px, 0, 0)' : 'translate3d(0, 0, 0)' }}
      />
    </button>
  )
}
