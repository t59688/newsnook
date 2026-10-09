import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

/**
 * 移动端优先应用壳：始终占满视口宽度。
 * 顶部 fixed 条涂满 safe-area，补回 Android 边到边后消失的状态栏底色。
 */
export function AppShell({ children }: Props) {
  return (
    <div
      className="ink-grain relative flex h-full h-dvh w-full flex-col overflow-hidden bg-ink"
      // 使用 CSS 变量控制 paddingTop，全屏时设为 0
      style={{ paddingTop: 'var(--app-pt, var(--sat))' }}
    >
      <style>{`.is-video-fullscreen { --app-pt: 0px; }`}</style>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] bg-ink [.is-video-fullscreen_&]:hidden"
        style={{ height: 'var(--sat)' }}
      />
      {children}
    </div>
  )
}
