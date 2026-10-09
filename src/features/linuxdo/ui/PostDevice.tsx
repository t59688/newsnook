import { Smartphone, Tablet } from 'lucide-react'
import type { LinuxDoPostDevice } from '../types'

export function PostDevice({ device, postNumber }: { device?: LinuxDoPostDevice; postNumber: number }) {
  if (!device) return null
  const Icon = /^iPad\b/i.test(device.model) ? Tablet : Smartphone
  return (
    <div data-linuxdo-post-device className="mt-3 flex items-center gap-2 text-[11px] leading-5 text-paper-muted">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-haze/50 bg-paper/[0.035] px-2.5 py-1">
        <Icon size={13} strokeWidth={1.7} className="shrink-0 text-cinnabar-soft" aria-hidden="true" />
        <span className="min-w-0 break-words">{postNumber === 1 ? '发布自 ' : '回复自 '}<span className="font-medium text-paper/85">{device.model}</span></span>
      </span>
    </div>
  )
}
