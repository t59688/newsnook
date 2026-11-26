import { BatteryMedium, Signal, Wifi } from 'lucide-react'

export interface PhoneStatusBarProps {
  time?: string
  className?: string
}

/**
 * 沉浸式真机通知栏 / 状态栏 (Immersive Status Bar)
 * 放置在各个手机界面的 <header> 最顶部，与顶栏 100% 同色融合，
 * 绝无色差、无割裂黑边或接缝。
 */
export function PhoneStatusBar({
  time = '21:45',
  className = '',
}: PhoneStatusBarProps) {
  return (
    <div
      className={`relative z-30 flex h-6.5 shrink-0 select-none items-center justify-between px-5 pt-1 text-inherit opacity-85 ${className}`}
      aria-hidden
    >
      {/* 左侧系统时间 */}
      <span className="font-mono text-[10.5px] font-semibold tracking-[0.03em] tabular-nums">
        {time}
      </span>

      {/* 右侧网络信号、5G 与电池指示 */}
      <div className="flex items-center gap-1.5">
        <Signal size={11} strokeWidth={2.2} />
        <span className="font-mono text-[8.5px] font-bold tracking-tight">5G</span>
        <Wifi size={11} strokeWidth={2.2} />
        <BatteryMedium size={14} strokeWidth={2} className="ml-0.5" />
      </div>
    </div>
  )
}
