/**
 * 全屏手势 HUD：进度预览、音量与亮度档位、双指缩放与旋转模式提示。
 */

import type { ReactNode } from 'react'
import {
  ChevronsLeft,
  ChevronsRight,
  RotateCw,
  Scan,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { formatTime, type GestureHud } from './playback'

function LevelBar({ value }: { value: number }) {
  return (
    <div className="h-[3px] w-24 overflow-hidden rounded-full bg-paper/25">
      <div className="h-full rounded-full bg-paper" style={{ width: `${value * 100}%` }} />
    </div>
  )
}

function HudShell({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center">
      <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-ink-raised/85 px-4 py-2.5">
        {children}
      </div>
    </div>
  )
}

/** 全屏手势的即时反馈：进度预览、音量与亮度档位。 */
export function GestureHudOverlay({ hud, duration }: { hud: GestureHud; duration: number }) {
  if (hud.kind === 'zoom') {
    return (
      <HudShell>
        <div className="flex items-center gap-2 text-paper">
          <Scan size={17} strokeWidth={1.8} />
          <span className="font-mono text-[14px] leading-none">
            {Math.round(hud.scale * 100)}%
          </span>
          {hud.rotation !== 0 && (
            <span className="font-mono text-[11px] leading-none text-cinnabar-soft">
              {hud.rotation}°
            </span>
          )}
        </div>
        <span className="text-[10px] leading-none text-paper/55">
          双指缩放/移动 · 单指亮度/音量/进度
        </span>
      </HudShell>
    )
  }

  if (hud.kind === 'mode') {
    return (
      <HudShell>
        <div className="flex items-center gap-2 text-paper">
          <RotateCw size={16} strokeWidth={1.8} />
          <span className="text-[13px] leading-none">{hud.label}</span>
        </div>
        <span className="text-[10px] leading-none text-paper/55">再次点击切换旋转模式</span>
      </HudShell>
    )
  }

  if (hud.kind === 'seek') {
    const seconds = Math.round(hud.offset)
    return (
      <HudShell>
        <div className="flex items-center gap-1.5 font-mono text-[15px] leading-none text-paper">
          {seconds < 0 ? (
            <ChevronsLeft size={16} strokeWidth={1.8} />
          ) : (
            <ChevronsRight size={16} strokeWidth={1.8} />
          )}
          <span>{formatTime(hud.target)}</span>
          <span className="text-paper/55">/ {formatTime(duration)}</span>
        </div>
        <span className="font-mono text-[11px] leading-none text-cinnabar-soft">
          {seconds >= 0 ? `+${seconds}` : seconds}s
        </span>
      </HudShell>
    )
  }

  const percent = Math.round(hud.value * 100)
  return (
    <HudShell>
      <div className="flex items-center gap-2 text-paper">
        {hud.kind === 'brightness' ? (
          <Sun size={16} strokeWidth={1.8} />
        ) : hud.value === 0 ? (
          <VolumeX size={16} strokeWidth={1.8} />
        ) : (
          <Volume2 size={16} strokeWidth={1.8} />
        )}
        <LevelBar value={hud.value} />
        <span className="w-8 text-right font-mono text-[11px] leading-none">{percent}%</span>
      </div>
    </HudShell>
  )
}
