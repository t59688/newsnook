import type { ReactNode } from 'react'

/* 手机外壳：高保真硬件容器，内部承载真实复刻的应用界面。
 * 顶部通知栏已下沉至各屏 Header 内部实现 100% 沉浸式同色融合，绝无割裂色差。 */
export function PhoneFrame({
  children,
  className = '',
  time: _time = '21:45',
}: {
  children: ReactNode
  className?: string
  time?: string
}) {
  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-[2.85rem] border-[4.5px] border-paper/15 bg-ink shadow-[0_28px_72px_-16px_rgba(0,0,0,0.72),0_0_0_1px_rgba(255,255,255,0.08),inset_0_1px_1px_rgba(255,255,255,0.18)] ring-1 ring-black/50 ${className}`}
    >
      {/* 玻璃屏幕环境反光（模拟曲面大猩猩玻璃质感） */}
      <div
        className="pointer-events-none absolute inset-0 z-35 bg-gradient-to-tr from-transparent via-white/[0.015] to-white/[0.045] rounded-[2.85rem]"
        aria-hidden
      />

      {/* 顶部灵动胶囊 / 光学前置镜头 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1.5 z-30 flex -translate-x-1/2 items-center justify-center"
        aria-hidden
      >
        <div className="flex h-3.5 w-18 items-center justify-between rounded-full bg-black/95 px-2 ring-1 ring-white/10 shadow-xs">
          <div className="h-1.5 w-1.5 rounded-full bg-indigo-950 ring-1 ring-indigo-400/40" />
          <div className="h-1 w-5 rounded-full bg-paper/20" />
        </div>
      </div>

      {/* 屏幕内实际应用视口（全高沉浸式，顶栏与通知栏完全同色融合） */}
      <div className="relative flex flex-1 flex-col overflow-hidden h-full">
        {children}
      </div>

      {/* 底部系统导航手势横条 */}
      <div
        className="pointer-events-none absolute bottom-1.5 left-1/2 z-30 h-1 w-28 -translate-x-1/2 rounded-full bg-paper/30 backdrop-blur-sm"
        aria-hidden
      />
    </div>
  )
}
