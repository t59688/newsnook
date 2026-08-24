import { useState } from 'react'
import { Cloud, FileText, ListTree, RefreshCw, Trash2 } from 'lucide-react'

import { BackupPanel } from '../../components/BackupPanel'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SettingsHint, SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { clearBodyCache, type BodyCacheStats } from '../../lib/bodyCache'
import { clearListCache } from '../../lib/storage'
import { relativeTime } from '../../lib/time'
import type { PrestoreProgress } from '../../features/prestore/service'
import type { PrestoreStats } from '../../features/prestore/store'
import { PRESTORE_PER_SOURCE_OPTIONS } from '../../sources/preferences'

interface PrestoreStorageState {
  enabled: boolean
  perSourceLimit: number
  sourceCount: number
  presetName: string
  stats: PrestoreStats
  syncing: boolean
  progress: PrestoreProgress | null
  error: string | null
  onEnabledChange: (enabled: boolean) => void
  onPerSourceLimitChange: (limit: number) => void
  onSync: () => void
  onClear: () => Promise<void>
}

interface Props {
  laterCount: number
  usage: Usage
  prestore: PrestoreStorageState
  onCacheChange: () => void
  onBack: () => void
}

interface Usage {
  bodies: BodyCacheStats
  lists: { count: number; bytes: number }
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface CacheRowProps {
  icon: typeof FileText
  title: string
  detail: string
  bytes: number
  disabled: boolean
  actionLabel?: string
  onClear: () => void
}

function CacheRow({
  icon: Icon,
  title,
  detail,
  bytes,
  disabled,
  actionLabel,
  onClear,
}: CacheRowProps) {
  return (
    <li className="page-x flex items-center gap-3 bg-ink py-4">
      <Icon size={17} strokeWidth={1.5} className="shrink-0 text-paper-muted" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-paper">{title}</span>
        <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">{detail}</span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-paper-muted">{formatBytes(bytes)}</span>
      <button
        type="button"
        onClick={onClear}
        disabled={disabled}
        aria-label={actionLabel ?? `清除${title}`}
        className="shrink-0 p-1.5 disabled:opacity-30"
      >
        <Trash2 size={15} strokeWidth={1.5} className="text-paper-faint" />
      </button>
    </li>
  )
}

function PrestoreControls({ prestore }: { prestore: PrestoreStorageState }) {
  const progress = prestore.progress
  const progressText = prestore.syncing && progress
    ? `${progress.sourceName} · ${progress.storedInSource}/${progress.targetPerSource} 篇 · ${progress.completedSources}/${progress.totalSources} 源`
    : prestore.stats.updatedAt
      ? `上次完成于 ${relativeTime(prestore.stats.updatedAt)}`
      : '开启后联网自动补齐，也可手动更新'

  return (
    <SettingsSection title="预存阅读">
      <div className="page-x space-y-3">
        <div className="rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="block font-display text-[15px] font-medium text-paper">开启预存</span>
              <span className="mt-1 block text-[12px] leading-relaxed text-paper-muted">
                仅维护当前预设，按分类与信源顺序依次补齐正文。
              </span>
            </div>
            <ToggleSwitch
              checked={prestore.enabled}
              label="开启预存"
              onChange={() => prestore.onEnabledChange(!prestore.enabled)}
            />
          </div>

          <div className="mt-4 flex items-center justify-between gap-4 border-t border-haze pt-4">
            <label htmlFor="prestore-limit" className="min-w-0 flex-1">
              <span className="block text-[13px] text-paper">每个信源预存</span>
              <span className="mt-0.5 block truncate font-mono text-[10px] text-paper-faint">
                {prestore.presetName} · {prestore.sourceCount} 个信源
              </span>
            </label>
            <select
              id="prestore-limit"
              value={prestore.perSourceLimit}
              disabled={prestore.syncing}
              onChange={(event) => prestore.onPerSourceLimitChange(Number(event.target.value))}
              className="rounded-xl border border-haze bg-ink px-3 py-2 text-[12.5px] text-paper outline-none disabled:opacity-50"
            >
              {PRESTORE_PER_SOURCE_OPTIONS.map((count) => (
                <option key={count} value={count}>{count} 篇</option>
              ))}
            </select>
          </div>

          {prestore.enabled && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-haze pt-4">
              <span className={`min-w-0 flex-1 font-mono text-[10px] ${prestore.error ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>
                {prestore.error ?? progressText}
              </span>
              <button
                type="button"
                onClick={prestore.onSync}
                disabled={prestore.syncing || prestore.sourceCount === 0}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-haze px-3 py-1.5 text-[11px] text-paper-muted disabled:opacity-35"
              >
                <RefreshCw size={12} strokeWidth={1.6} className={prestore.syncing ? 'animate-spin' : ''} />
                {prestore.syncing ? '预存中' : '立即补齐'}
              </button>
            </div>
          )}
        </div>
      </div>
      <SettingsHint>
        关闭只停止后续自动补齐，不会删除已经预存的正文。新文章成功落盘后才会滚动淘汰旧文章。
      </SettingsHint>
    </SettingsSection>
  )
}

export function StorageScreen({ laterCount: _laterCount, usage, prestore, onCacheChange, onBack }: Props) {
  const total = usage.bodies.bytes + usage.lists.bytes + prestore.stats.bytes
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  return (
    <SettingsShell
      title="离线存储"
      caption={`可管理缓存约 ${formatBytes(total)}`}
      onBack={onBack}
    >
      <PrestoreControls prestore={prestore} />

      <SettingsSection title="缓存用量">
        <ul className="divide-y divide-haze border-y border-haze">
          <CacheRow
            icon={Cloud}
            title="预存正文"
            detail={
              prestore.stats.articleCount
                ? `${prestore.stats.articleCount} 篇 · ${prestore.stats.sourceCount} 个信源${prestore.stats.updatedAt ? ` · ${relativeTime(prestore.stats.updatedAt)}更新` : ''}`
                : '当前没有预存正文'
            }
            bytes={prestore.stats.bytes}
            disabled={prestore.stats.articleCount === 0}
            onClear={() => void prestore.onClear()}
          />
          <CacheRow
            icon={FileText}
            title="正文缓存"
            detail={
              usage.bodies.count
                ? `${usage.bodies.count} 篇已缓存${usage.bodies.pinned ? ` · ${usage.bodies.pinned} 篇随稍后读保留` : ''}`
                : '读过的文章会自动存下来'
            }
            bytes={usage.bodies.bytes}
            disabled={usage.bodies.count === usage.bodies.pinned}
            actionLabel="清除非稍后读正文"
            onClear={() => {
              clearBodyCache({ includePinned: false })
              onCacheChange()
            }}
          />
          <CacheRow
            icon={ListTree}
            title="列表缓存"
            detail={
              usage.lists.count
                ? `${usage.lists.count} 个来源的最近条目`
                : '刷新后自动写入'
            }
            bytes={usage.lists.bytes}
            disabled={usage.lists.count === 0}
            onClear={() => {
              clearListCache()
              onCacheChange()
            }}
          />
        </ul>
      </SettingsSection>

      <div className="page-x pt-6">
        <button
          type="button"
          disabled={usage.bodies.count === 0 && usage.lists.count === 0 && prestore.stats.articleCount === 0}
          onClick={() => setConfirmClearAll(true)}
          className="flex w-full items-center justify-center gap-2 rounded-full border border-haze py-3 text-[12.5px] text-paper-muted disabled:opacity-30"
        >
          <Trash2 size={14} strokeWidth={1.6} />
          清除全部可管理缓存
        </button>
      </div>

      <BackupPanel />

      <ConfirmDialog
        open={confirmClearAll}
        title="清除全部缓存？"
        message="将清除预存正文、普通离线正文和列表缓存。稍后读标题会保留，但其正文需要联网重新下载。"
        confirmLabel="清除"
        danger
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={() => {
          setConfirmClearAll(false)
          clearBodyCache({ includePinned: true })
          clearListCache()
          void prestore.onClear()
          onCacheChange()
        }}
      />
    </SettingsShell>
  )
}
