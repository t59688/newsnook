/* 分段选择器 —— 复刻 src/components/SegmentedControl.tsx：
 * 选中项是一块会滑动的朱砂底板，不是旧的熄灭新的点亮。 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  label: string
}) {
  const activeIndex = options.findIndex((o) => o.value === value)
  return (
    <div role="group" aria-label={label} className="relative flex rounded-xl border border-haze bg-ink-raised/50 p-1">
      {activeIndex >= 0 && (
        <div
          aria-hidden
          className="absolute inset-y-1 left-1 rounded-lg border border-cinnabar/30 bg-cinnabar/20 shadow-xs transition-transform duration-[260ms] ease-[var(--ease-ink,cubic-bezier(0.22,1,0.36,1))]"
          style={{
            width: `calc((100% - 8px) / ${options.length})`,
            transform: `translate3d(calc(${activeIndex} * 100%), 0, 0)`,
          }}
        />
      )}
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`relative z-10 flex-1 rounded-lg py-2 text-[12.5px] font-medium transition-all duration-200 active:scale-[0.96] ${
              active ? 'text-paper' : 'text-paper-faint hover:text-paper-muted'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
