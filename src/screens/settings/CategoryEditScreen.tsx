import { useId, useMemo, useState } from 'react'
import { AlertCircle, PanelTop, Trash2 } from 'lucide-react'

import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { SourcePicker } from '../../components/SourcePicker'
import {
  isReservedCategoryLabel,
  type CategoryId,
  type NewsCategory,
} from '../../sources/categories'
import {
  allRegisteredSources,
  describeSources,
  sourceUsageByOtherCategories,
  type Preferences,
} from '../../sources/preferences'

interface Props {
  categoryId?: CategoryId
  prefs: Preferences
  onSave: (draft: { label: string; short: string; sourceIds: string[] }) => void
  onDelete?: (categoryId: CategoryId) => void
  onBack: () => void
}

const PRESET_INSPIRATIONS = [
  { label: '海外精选', short: '海外' },
  { label: '极客深度', short: '深度' },
  { label: 'AI 前沿', short: 'AI精选' },
  { label: '财经观察', short: '财经' },
  { label: '每日读物', short: '阅读' },
  { label: '专栏周刊', short: '周刊' },
]

export function CategoryEditScreen({
  categoryId,
  prefs,
  onSave,
  onDelete,
  onBack,
}: Props) {
  const allSources = allRegisteredSources(prefs)
  const isEditing = Boolean(categoryId)
  const usageBySourceId = useMemo(
    () => sourceUsageByOtherCategories(prefs, categoryId),
    [prefs, categoryId],
  )
  const existingCategory = useMemo<NewsCategory | undefined>(() => {
    if (!categoryId) return undefined
    return prefs.customCategories?.find((category) => category.id === categoryId)
  }, [categoryId, prefs.customCategories])

  const [label, setLabel] = useState(existingCategory?.label ?? '')
  const [short, setShort] = useState(existingCategory?.short ?? '')
  const [shortManuallyEdited, setShortManuallyEdited] = useState(
    Boolean(existingCategory?.short && existingCategory.short !== existingCategory.label),
  )
  const [selectedIds, setSelectedIds] = useState<string[]>(
    existingCategory?.sourceIds ?? [],
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  const nameInputId = useId()
  const shortInputId = useId()

  const handleLabelChange = (text: string) => {
    setLabel(text)
    if (!shortManuallyEdited) {
      setShort(text.trim().slice(0, 4))
    }
  }

  const handleShortChange = (text: string) => {
    setShortManuallyEdited(true)
    setShort(text.trim().slice(0, 6))
  }

  const handleApplyPreset = (preset: { label: string; short: string }) => {
    setLabel(preset.label)
    setShort(preset.short)
    setShortManuallyEdited(true)
  }

  const toggleSource = (sourceId: string) => {
    setSelectedIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId],
    )
  }

  const toggleGroup = (groupSourceIds: string[]) => {
    const allSelected = groupSourceIds.every((id) => selectedIds.includes(id))
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !groupSourceIds.includes(id)))
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...groupSourceIds])])
    }
  }

  const displayShort = short.trim() || label.trim().slice(0, 4) || '预览'
  // 「推荐」是阅读达标后自动出现的动态栏位，自建分类名称与短名都不得占用
  const reservedLabel = isReservedCategoryLabel(label)
  const reservedShort = !reservedLabel && isReservedCategoryLabel(displayShort)
  const isValid =
    label.trim().length > 0 && selectedIds.length > 0 && !reservedLabel && !reservedShort

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!isValid) return
    onSave({
      label: label.trim(),
      short: displayShort,
      sourceIds: selectedIds,
    })
  }

  const handleDelete = () => {
    if (!categoryId || !onDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete(categoryId)
  }

  return (
    <SettingsShell
      title={isEditing ? '编辑分类' : '新建分类'}
      caption={
        selectedIds.length
          ? `已选 ${selectedIds.length} 个信源 · ${describeSources(selectedIds, prefs.customSources)}`
          : '自选信源组合'
      }
      onBack={onBack}
      action={
        <button
          type="button"
          disabled={!isValid}
          onClick={() => handleSubmit()}
          className="shrink-0 rounded-full border border-cinnabar bg-cinnabar/20 px-4 py-1.5 font-mono text-[11px] font-medium tracking-[0.12em] text-cinnabar-soft transition-all duration-150 hover:bg-cinnabar/30 disabled:border-haze disabled:bg-transparent disabled:text-paper-faint/50"
        >
          {isEditing ? '保存' : '创建'}
        </button>
      }
    >
      {/* 首页 Tab 即时预览 */}
      <div className="page-x pt-3 pb-1">
        <div className="rounded-2xl border border-haze/80 bg-ink-raised/60 p-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 text-[11px] text-paper-faint">
            <PanelTop size={13} className="text-cinnabar-soft" />
            <span className="font-mono tracking-wider">顶栏预览</span>
          </div>

          <div className="mt-3 flex items-center justify-center gap-6 overflow-hidden rounded-xl border border-haze/60 bg-ink/70 py-3.5 px-4">
            <span className="font-display text-[15px] text-paper-faint/40">综合</span>
            <span className="font-display text-[15px] text-paper-faint/40">热点</span>

            <div className="relative flex flex-col items-center">
              <span className="font-display text-[16px] font-medium text-paper transition-all duration-150">
                {displayShort}
              </span>
              <span className="mt-1 h-[2px] w-3.5 rounded-full bg-cinnabar" />
            </div>

            <span className="font-display text-[15px] text-paper-faint/40">科技</span>
            <span className="font-display text-[15px] text-paper-faint/40">商业</span>
          </div>
        </div>
      </div>

      {/* 分类基本信息 */}
      <SettingsSection title="基本信息">
        <div className="page-x space-y-4 pt-1">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={nameInputId} className="block text-[13px] font-medium text-paper">
                分类名称
              </label>
              <span className="font-mono text-[10px] text-paper-faint">
                {label.trim().length} / 16
              </span>
            </div>
            <input
              id={nameInputId}
              type="text"
              value={label}
              maxLength={16}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="例如：海外精选、深度阅读、我的专栏"
              className="mt-1.5 w-full rounded-xl border border-haze bg-ink-raised px-3.5 py-2.5 text-[14.5px] text-paper placeholder-paper-faint/45 transition-colors focus:border-cinnabar focus:outline-none"
            />
            {reservedLabel && (
              <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-rose-400">
                <AlertCircle size={12} />
                「推荐」留给自动出现的推荐栏了，请换一个名字。
              </p>
            )}
          </div>

          {/* 灵感快捷标签 */}
          <div>
            <span className="block font-mono text-[10.5px] tracking-wider text-paper-faint">
              快捷填入
            </span>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESET_INSPIRATIONS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleApplyPreset(preset)}
                  className="rounded-lg border border-haze/70 bg-ink px-2.5 py-1 text-[11.5px] text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-paper"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={shortInputId} className="block text-[13px] font-medium text-paper">
                首页顶栏标签短名
              </label>
              <span className="font-mono text-[10px] text-paper-faint">建议 2~4 个字</span>
            </div>
            <input
              id={shortInputId}
              type="text"
              value={short}
              maxLength={6}
              onChange={(e) => handleShortChange(e.target.value)}
              placeholder={label.trim().slice(0, 4) || '自动截取前 4 字'}
              className="mt-1.5 w-full rounded-xl border border-haze bg-ink-raised px-3.5 py-2.5 text-[14.5px] text-paper placeholder-paper-faint/45 transition-colors focus:border-cinnabar focus:outline-none"
            />
            {reservedShort && (
              <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-rose-400">
                <AlertCircle size={12} />
                短名「推荐」留给自动出现的推荐栏了，请换一个短名。
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      {/* 信源选择与管理 */}
      <SettingsSection title="信源组合">
        <SourcePicker
          sources={allSources}
          selectedIds={selectedIds}
          usageBySourceId={usageBySourceId}
          onToggleSource={toggleSource}
          onToggleGroup={toggleGroup}
        />
      </SettingsSection>

      {/* 删除自建分类操作区 */}
      {isEditing && onDelete && (
        <div className="page-x pt-8 pb-4">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-950/10 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[13.5px] font-medium text-paper">删除此自定义分类</h3>
                <p className="mt-0.5 text-[11px] text-paper-faint">
                  将从首页顶栏移除，不影响信源本身。
                </p>
              </div>

              {confirmDelete ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-full border border-haze px-3 py-1.5 font-mono text-[10px] text-paper-faint"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="flex items-center gap-1 rounded-full border border-rose-500/60 bg-rose-600/30 px-3.5 py-1.5 font-mono text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-600/40"
                  >
                    <Trash2 size={12} />
                    确认删除
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="shrink-0 rounded-full border border-rose-500/30 px-3.5 py-1.5 font-mono text-[11px] text-rose-400/90 transition-colors hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  删除分类
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </SettingsShell>
  )
}
