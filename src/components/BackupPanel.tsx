import { useRef, useState } from 'react'
import { AlertCircle, ArrowDownToLine, Check, Download, Loader2, Upload, X } from 'lucide-react'

import { SettingsHint, SettingsSection } from './SettingsShell'
import {
  BACKUP_SECTIONS,
  BACKUP_SECTION_LABELS,
  backupFileName,
  collectBackup,
  exportBackupFile,
  parseBackup,
  restoreBackup,
  serializeBackup,
  summarizeBackup,
  type BackupPayload,
  type BackupSection,
  type BackupSummary,
} from '../lib/backup'
import { relativeTime } from '../lib/time'

interface PendingImport {
  payload: BackupPayload
  summary: BackupSummary
}

function sectionDetail(section: BackupSection, summary: BackupSummary): string {
  switch (section) {
    case 'preferences':
      return `外观、排版、翻译、代理、分类布局 · ${summary.customSourceCount} 个自建源 · ${summary.customCategoryCount} 个自建分类`
    case 'presets':
      return summary.presetCount ? `含 ${summary.presetCount} 个自建预设` : '仅内置预设的改动'
    case 'enabledSources':
      return `${summary.enabledSourceCount} 个已启用信源`
    case 'laterItems':
      return `${summary.laterCount} 篇稍后读（正文需联网重新下载）`
    case 'readIds':
      return `${summary.readCount} 条已读标记`
    case 'readingPositions':
      return `${summary.readingPositionCount} 篇文章的阅读位置`
    default:
      return ''
  }
}

/** 「离线存储」里的配置备份区：导出/导入本机 JSON，不涉及任何云端 */
export function BackupPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [selected, setSelected] = useState<Set<BackupSection>>(() => new Set(BACKUP_SECTIONS))

  const handleExport = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const payload = collectBackup(__APP_VERSION__)
      const result = await exportBackupFile(backupFileName(), serializeBackup(payload))
      setNotice(result === 'shared' ? '备份已生成，请在分享面板中保存。' : '备份文件已下载。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setNotice(null)
    try {
      const payload = parseBackup(await file.text())
      const summary = summarizeBackup(payload)
      const available = BACKUP_SECTIONS.filter((section) => summary.present[section])
      setSelected(new Set(available))
      setPending({ payload, summary })
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取备份文件失败。')
    } finally {
      // 重置 input 以便再次选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleSection = (section: BackupSection) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const commitImport = () => {
    if (!pending || selected.size === 0) return
    restoreBackup(pending.payload, [...selected])
    setPending(null)
    // 偏好、预设等运行态都在内存里，重载才能让界面与刚写回的配置一致
    window.location.reload()
  }

  const availableSections = pending
    ? BACKUP_SECTIONS.filter((section) => pending.summary.present[section])
    : []

  return (
    <SettingsSection title="配置备份">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="page-x">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleExport()}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-haze/90 bg-ink-raised/60 p-4 text-center transition-all hover:border-cinnabar/60 hover:bg-cinnabar/5 disabled:opacity-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
              {busy ? <Loader2 size={18} className="animate-spin text-cinnabar-soft" /> : <Download size={18} />}
            </div>
            <div>
              <span className="block text-[13.5px] font-medium text-paper">导出配置</span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                生成本机 JSON 备份
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-haze/90 bg-ink-raised/60 p-4 text-center transition-all hover:border-paper/40 hover:bg-paper/5 disabled:opacity-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
              <Upload size={18} />
            </div>
            <div>
              <span className="block text-[13.5px] font-medium text-paper">导入配置</span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                选择备份文件后可挑分区
              </span>
            </div>
          </button>
        </div>

        {notice && (
          <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-paper-muted">
            <Check size={12} strokeWidth={2} className="shrink-0 text-cinnabar-soft" />
            {notice}
          </p>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-cinnabar/35 bg-cinnabar/10 p-3 text-[12px] leading-relaxed text-cinnabar-soft">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
          </div>
        )}
      </div>

      <SettingsHint>
        备份包含偏好、场景预设、自建订阅与分类、启用信源、稍后读、已读标记与阅读位置，只落本机文件，不会上传。
        正文与列表缓存可再生，不进备份。只想迁移订阅源时用「自定义订阅」里的 OPML 更通用。
      </SettingsHint>

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setPending(null)}
        >
          <div
            className="flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col rounded-3xl border border-haze bg-ink p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-haze pb-4">
              <div className="min-w-0">
                <h2 className="font-display text-[18px] font-medium text-paper">导入配置备份</h2>
                <p className="mt-0.5 font-mono text-[11px] text-paper-faint">
                  {pending.summary.exportedAt
                    ? `导出于 ${relativeTime(pending.summary.exportedAt)}`
                    : '导出时间未知'}
                  {pending.summary.appVersion ? ` · v${pending.summary.appVersion}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPending(null)}
                aria-label="关闭"
                className="shrink-0 rounded-full border border-haze p-1.5 text-paper-faint hover:text-paper"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-4">
              {availableSections.map((section) => (
                <label
                  key={section}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border border-haze/80 bg-ink-raised/40 p-3.5"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(section)}
                    onChange={() => toggleSection(section)}
                    className="mt-0.5 rounded border-haze text-cinnabar focus:ring-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-paper">
                      {BACKUP_SECTION_LABELS[section]}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-paper-faint">
                      {sectionDetail(section, pending.summary)}
                    </span>
                  </span>
                </label>
              ))}

              <p className="rounded-2xl border border-cinnabar/30 bg-cinnabar/10 px-3.5 py-3 text-[12px] leading-relaxed text-cinnabar-soft">
                所选分区会整段覆盖本机现有配置，不做合并。导入完成后应用会自动重载。
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-haze pt-4">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded-full border border-haze px-4 py-2 font-mono text-[12px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={commitImport}
                className="flex items-center gap-1.5 rounded-full border border-cinnabar bg-cinnabar/25 px-5 py-2 font-mono text-[12px] font-medium text-cinnabar-soft hover:bg-cinnabar/35 disabled:opacity-40"
              >
                <ArrowDownToLine size={14} />
                覆盖导入 ({selected.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
