import { useState, type ReactNode } from 'react'

import { LinuxDoApiError } from '../types'

export function compact(value: number): string {
  if (value < 1000) return String(value)
  return (value / 1000).toFixed(value < 10000 ? 1 : 0).replace('.0', '') + 'k'
}

export function ago(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 60) return String(minutes) + ' 分钟前'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return String(hours) + ' 小时前'
  const days = Math.floor(hours / 24)
  if (days < 30) return String(days) + ' 天前'
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export function readableError(error: unknown): string {
  if (error instanceof LinuxDoApiError && error.kind === 'rate-limited' && error.retryAfterSeconds !== undefined) {
    return '请求过于频繁，请在 ' + Math.max(1, Math.ceil(error.retryAfterSeconds)) + ' 秒后重试'
  }
  if (error instanceof Error) return error.message
  return '加载失败'
}

export function LinuxDoAvatar({
  url,
  name,
}: {
  url?: string
  name?: string
}) {
  const [failed, setFailed] = useState(false)
  const initial = (name || '?').trim().slice(0, 1).toUpperCase() || '?'

  return (
    <span className="flex h-full w-full items-center justify-center overflow-hidden select-none">
      {url && !failed ? (
        <img
          src={url}
          alt={name || ''}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="font-semibold text-paper-muted leading-none text-[11px] sm:text-[12px]">{initial}</span>
      )}
    </span>
  )
}

export function avatar(url?: string, name?: string): ReactNode {
  return <LinuxDoAvatar key={url || name} url={url} name={name} />
}

export function tagGlyph(name: string): string {
  if (!name || /^[\p{Extended_Pictographic}]/u.test(name)) return ''
  const map: Record<string, string> = {
    '人工智能': '🟣',
    'AI': '🟣',
    '软件开发': '📗',
    '开源推广': '📗',
    '资源荟萃': '📦',
    '福利羊毛': '🎁',
    '羊毛': '🎁',
    '快问快答': '💡',
    '精选': '⭐',
    '职场': '💼',
    '硬件': '💻',
    '日常': '☕',
  }
  return map[name] || ''
}
