import type { BatteryStatus } from '../../lib/batteryStatus'

/** Lucide Battery 几何内的比例填充，充电时叠闪电。 */
export function PlayerBatteryIcon({ status }: { status: BatteryStatus | null }) {
  const level = status?.level ?? null
  const charging = Boolean(status?.charging)
  const fill = level == null ? 0 : Math.max(0, Math.min(1, level))
  const low = level != null && level <= 0.2 && !charging
  const label =
    level == null
      ? '电量未知'
      : `电量 ${Math.round(level * 100)}%${charging ? '，充电中' : ''}`

  return (
    <span
      className="relative inline-flex h-8 w-8 items-center justify-center text-paper/90"
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="2" y="7" width="16" height="10" rx="2" ry="2" />
        <line x1="22" x2="22" y1="11" y2="13" />
        {level != null && fill > 0 && (
          <rect
            x="4"
            y="9"
            width={Math.max(1.2, fill * 12)}
            height="6"
            rx="0.8"
            fill={low ? 'var(--cinnabar, #c45c4a)' : 'currentColor'}
            stroke="none"
          />
        )}
      </svg>
      {charging && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
          fill="currentColor"
          aria-hidden
        >
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
      )}
    </span>
  )
}
