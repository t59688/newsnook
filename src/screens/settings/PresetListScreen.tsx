import { useState } from 'react'
import {
  Bot,
  BookOpen,
  Check,
  ChevronRight,
  CopyPlus,
  Cpu,
  FlaskConical,
  FolderPlus,
  Gamepad2,
  Globe,
  Layers,
  Newspaper,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
} from 'lucide-react'

import { ConfirmDialog, PromptDialog } from '../../components/ConfirmDialog'
import { SettingsHint, SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { CATEGORIES, type NewsCategory } from '../../sources/categories'
import {
  BUILTIN_AI_ID,
  BUILTIN_BIZ_ID,
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEPTH_ID,
  BUILTIN_LIFE_ID,
  BUILTIN_SCIENCE_ID,
  BUILTIN_TECH_ID,
  BUILTIN_WORLD_ID,
  findBuiltinPreset,
  isBuiltinOverridden,
  resolvePreset,
  type LayoutPreset,
  type LayoutSnapshot,
  type PresetsState,
} from '../../sources/presets'

interface Props {
  state: PresetsState
  builtins: readonly LayoutPreset[]
  onApply: (id: string) => void
  /** 编辑指定用户预设：未激活时会先应用再进入布局编辑 */
  onEditPreset: (id: string) => void
  onEditLayout: () => void
  onSaveAs: (name: string) => void
  onCreateBlank: (name: string) => void
  onRestoreFactory: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onBack: () => void
}

type DialogState =
  | { type: 'apply'; id: string; name: string }
  | { type: 'edit'; id: string; name: string }
  | { type: 'delete'; id: string; name: string }
  | { type: 'saveAs' }
  | { type: 'createBlank' }
  | { type: 'restore'; id: string; name: string }
  | { type: 'rename'; id: string; name: string }
  | null

/** 计算预设快照内的分类流与统计信息 */
function getPresetSummary(snapshot: LayoutSnapshot) {
  const customMap = new Map((snapshot.customCategories ?? []).map((c) => [c.id, c]))
  const builtinMap = new Map(CATEGORIES.map((c) => [c.id, c]))
  const hiddenSet = new Set(snapshot.hiddenCategoryIds ?? [])

  const orderedIds: string[] = []
  const seen = new Set<string>()

  // 1. 按 categoryOrder 排序
  for (const id of snapshot.categoryOrder ?? []) {
    if ((builtinMap.has(id) || customMap.has(id)) && !seen.has(id)) {
      orderedIds.push(id)
      seen.add(id)
    }
  }
  // 2. 剩余内置分类
  for (const c of CATEGORIES) {
    if (!seen.has(c.id)) {
      orderedIds.push(c.id)
      seen.add(c.id)
    }
  }
  // 3. 剩余自定义分类
  for (const c of snapshot.customCategories ?? []) {
    if (!seen.has(c.id)) {
      orderedIds.push(c.id)
      seen.add(c.id)
    }
  }

  const visibleCategories = orderedIds
    .filter((id) => !hiddenSet.has(id))
    .map((id) => customMap.get(id) ?? builtinMap.get(id))
    .filter((c): c is NewsCategory => Boolean(c))

  const visibleSourceIds = new Set<string>()
  for (const category of visibleCategories) {
    const ids =
      category.id === 'mix'
        ? (snapshot.enabledSourceIds ?? [])
        : (snapshot.categorySources?.[category.id] ?? category.sourceIds ?? [])
    ids.forEach((id) => visibleSourceIds.add(id))
  }

  return {
    visibleCategories,
    visibleCount: visibleCategories.length,
    enabledSourcesCount: visibleSourceIds.size,
    customCount: snapshot.customCategories?.length ?? 0,
  }
}

/** 内置预设主题图标与装饰 */
function getBuiltinIcon(id: string) {
  switch (id) {
    case BUILTIN_DEFAULT_ID:
      return Newspaper
    case BUILTIN_WORLD_ID:
      return Globe
    case BUILTIN_BIZ_ID:
      return TrendingUp
    case BUILTIN_TECH_ID:
      return Cpu
    case BUILTIN_AI_ID:
      return Bot
    case BUILTIN_SCIENCE_ID:
      return FlaskConical
    case BUILTIN_DEPTH_ID:
      return BookOpen
    case BUILTIN_LIFE_ID:
      return Gamepad2
    default:
      return Layers
  }
}

/** 格式化相对时间 */
function formatUpdateTime(timestamp: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / (3600 * 1000))} 小时前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/** 顶部 Hero 卡片：当前运行态预设与快捷配置入口 */
function ActivePresetHero({
  activePreset,
  basedOnBuiltinName,
  modified,
  onEditLayout,
  onSaveAs,
  onRestore,
}: {
  activePreset?: LayoutPreset
  basedOnBuiltinName?: string
  modified?: boolean
  onEditLayout: () => void
  onSaveAs: () => void
  onRestore?: () => void
}) {
  if (!activePreset) return null

  const summary = getPresetSummary(activePreset.snapshot)
  const displayTags = summary.visibleCategories.slice(0, 6)
  const remainingCount = summary.visibleCategories.length - displayTags.length

  return (
    <div className="page-x pt-4">
      <div className="relative overflow-hidden rounded-2xl border border-cinnabar/35 bg-gradient-to-br from-ink-raised via-ink-raised to-cinnabar/[0.07] p-4.5 shadow-[var(--shadow-lift)] sm:p-5">
        {/* 背景微光装饰 */}
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-cinnabar/10 blur-2xl"
          aria-hidden="true"
        />

        {/* 顶部状态条 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cinnabar/40 bg-cinnabar/15 px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.1em] text-cinnabar-soft">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cinnabar" />
              正在使用
            </span>
            {activePreset.builtin ? (
              <span className="font-mono text-[10px] tracking-[0.1em] text-paper-faint">
                {modified ? '内置 · 已修改' : '内置场景'}
              </span>
            ) : basedOnBuiltinName ? (
              <span className="font-mono text-[10px] tracking-[0.1em] text-paper-faint">
                来自「{basedOnBuiltinName}」
              </span>
            ) : (
              <span className="font-mono text-[10px] tracking-[0.1em] text-paper-faint">
                自定义布局
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="inline-flex items-center gap-1 rounded-full border border-haze bg-paper/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper"
              >
                <RotateCcw size={11.5} strokeWidth={1.7} />
                恢复出厂
              </button>
            )}
            <button
              type="button"
              onClick={onSaveAs}
              className="inline-flex items-center gap-1 rounded-full border border-haze bg-paper/5 px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper"
            >
              <CopyPlus size={11.5} strokeWidth={1.7} />
              另存为新预设
            </button>
          </div>
        </div>

        {/* 预设标题与描述 */}
        <div className="mt-3">
          <h2 className="font-display text-[21px] leading-tight text-paper sm:text-[23px]">
            {activePreset.name}
          </h2>
          {activePreset.description && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-muted">
              {activePreset.description}
            </p>
          )}
        </div>

        {/* 分类标签流预览 */}
        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {displayTags.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center rounded-lg border border-haze bg-ink/70 px-2 py-0.5 font-mono text-[10px] tracking-wide text-paper-muted"
            >
              {cat.label}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="font-mono text-[10px] text-paper-faint">+{remainingCount}</span>
          )}
        </div>

        {/* 底部指标与编辑入口 */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-haze/80 pt-3.5">
          <div className="flex items-center gap-3 font-mono text-[10.5px] text-paper-faint">
            <span>{summary.visibleCount} 个可见分类</span>
            <span className="h-1 w-1 rounded-full bg-paper-faint/40" />
            <span>{summary.enabledSourcesCount} 个启用信源</span>
          </div>

          <button
            type="button"
            onClick={onEditLayout}
            className="inline-flex items-center gap-1.5 rounded-full border border-cinnabar/60 bg-cinnabar/15 px-3.5 py-1.5 font-mono text-[11px] font-medium tracking-wide text-cinnabar-soft shadow-sm transition-all hover:bg-cinnabar/25 active:scale-[0.98]"
          >
            <SlidersHorizontal size={12.5} strokeWidth={1.8} />
            调整分类与信源
            <ChevronRight size={12} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** 内置场景包卡片 */
function BuiltinPresetCard({
  preset,
  isCurrent,
  modified,
  onApply,
  onCustomize,
  onRestore,
}: {
  preset: LayoutPreset
  isCurrent: boolean
  modified: boolean
  onApply: () => void
  onCustomize: () => void
  onRestore?: () => void
}) {
  const Icon = getBuiltinIcon(preset.id)
  const summary = getPresetSummary(preset.snapshot)
  const displayTags = summary.visibleCategories.slice(0, 5)
  const remainingCount = summary.visibleCategories.length - displayTags.length

  return (
    <li
      className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 sm:p-4.5 ${
        isCurrent
          ? 'border-cinnabar/40 bg-gradient-to-br from-ink-raised via-ink-raised to-cinnabar/[0.04] shadow-[var(--shadow-lift)]'
          : 'border-haze bg-ink-raised/60 hover:border-cinnabar/30 hover:bg-ink-raised'
      }`}
    >
      <div>
        {/* 头部：图标 + 标题 + 状态 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                isCurrent
                  ? 'border-cinnabar/50 bg-cinnabar/15 text-cinnabar-soft'
                  : 'border-haze bg-paper/5 text-paper-muted group-hover:border-cinnabar/40 group-hover:text-paper'
              }`}
            >
              <Icon size={16} strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-[16.5px] leading-tight text-paper">{preset.name}</h3>
                {isCurrent && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-cinnabar/20 px-1.5 py-0.5 font-mono text-[9px] font-medium text-cinnabar-soft">
                    <Check size={9} strokeWidth={2.4} />
                    使用中
                  </span>
                )}
                {modified && (
                  <span className="rounded-full bg-paper/5 px-1.5 py-0.5 font-mono text-[9px] text-paper-faint">
                    已修改
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 描述 */}
        {preset.description && (
          <p className="mt-2 text-[12px] leading-relaxed text-paper-muted">{preset.description}</p>
        )}

        {/* 分类流预览 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {displayTags.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center rounded-md border border-haze/80 bg-ink/50 px-1.5 py-0.5 font-mono text-[9.5px] text-paper-muted"
            >
              {cat.label}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="font-mono text-[9.5px] text-paper-faint">+{remainingCount}</span>
          )}
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="mt-4 flex items-center justify-between border-t border-haze/60 pt-3">
        <span className="font-mono text-[10px] text-paper-faint">
          {summary.visibleCount} 分类 · {summary.enabledSourcesCount} 信源
        </span>

        {isCurrent ? (
          <div className="flex items-center gap-1.5">
            {onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="inline-flex items-center gap-1 rounded-full border border-haze bg-transparent px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper-muted transition-colors hover:border-cinnabar/30 hover:text-paper"
              >
                <RotateCcw size={11} strokeWidth={1.7} />
                出厂
              </button>
            )}
            <button
              type="button"
              onClick={onCustomize}
              className="inline-flex items-center gap-1 rounded-full border border-cinnabar/50 bg-cinnabar/10 px-2.5 py-1 font-mono text-[10px] tracking-wide text-cinnabar-soft transition-colors hover:bg-cinnabar/20"
            >
              <SlidersHorizontal size={11} strokeWidth={1.7} />
              去编辑
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="inline-flex items-center gap-1 rounded-full border border-haze bg-transparent px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper-muted transition-colors hover:border-cinnabar/30 hover:text-paper"
              >
                <RotateCcw size={11} strokeWidth={1.7} />
                出厂
              </button>
            )}
            <button
              type="button"
              onClick={onApply}
              className="inline-flex items-center gap-1 rounded-full border border-haze bg-transparent px-3 py-1 font-mono text-[10px] tracking-wide text-paper transition-colors hover:border-cinnabar/50 hover:bg-cinnabar/10 hover:text-cinnabar"
            >
              应用此预设
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

/** 用户自定义预设卡片 */
function UserPresetCard({
  preset,
  isCurrent,
  onApply,
  onEdit,
  onRename,
  onDelete,
}: {
  preset: LayoutPreset
  isCurrent: boolean
  onApply: () => void
  onEdit: () => void
  onRename: () => void
  onDelete?: () => void
}) {
  const summary = getPresetSummary(preset.snapshot)
  const displayTags = summary.visibleCategories.slice(0, 6)
  const remainingCount = summary.visibleCategories.length - displayTags.length
  const basedOnBuiltin = preset.basedOnBuiltinId
    ? findBuiltinPreset(preset.basedOnBuiltinId)
    : undefined

  return (
    <li
      className={`group relative flex flex-col justify-between rounded-2xl border p-4 transition-all duration-200 sm:p-4.5 ${
        isCurrent
          ? 'border-cinnabar/40 bg-gradient-to-br from-ink-raised via-ink-raised to-cinnabar/[0.04] shadow-[var(--shadow-lift)]'
          : 'border-haze bg-ink-raised/60 hover:border-cinnabar/30 hover:bg-ink-raised'
      }`}
    >
      <div>
        {/* 头部：标题 + 来源标签 + 状态 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-[17px] leading-tight text-paper">{preset.name}</h3>
            {isCurrent && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-cinnabar/20 px-1.5 py-0.5 font-mono text-[9px] font-medium text-cinnabar-soft">
                <Check size={9} strokeWidth={2.4} />
                使用中
              </span>
            )}
            {basedOnBuiltin ? (
              <span className="rounded-full bg-paper/5 px-2 py-0.5 font-mono text-[9px] text-paper-faint">
                来自 {basedOnBuiltin.name}
              </span>
            ) : (
              <span className="rounded-full bg-paper/5 px-2 py-0.5 font-mono text-[9px] text-paper-faint">
                自定义
              </span>
            )}
          </div>

          {preset.updatedAt > 0 && (
            <span className="font-mono text-[9.5px] text-paper-faint">
              {formatUpdateTime(preset.updatedAt)}
            </span>
          )}
        </div>

        {/* 描述 */}
        {preset.description && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-paper-muted">{preset.description}</p>
        )}

        {/* 分类流预览 */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {displayTags.map((cat) => (
            <span
              key={cat.id}
              className="inline-flex items-center rounded-md border border-haze/80 bg-ink/50 px-1.5 py-0.5 font-mono text-[9.5px] text-paper-muted"
            >
              {cat.label}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="font-mono text-[9.5px] text-paper-faint">+{remainingCount}</span>
          )}
        </div>
      </div>

      {/* 底部操作工具栏 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-haze/60 pt-3">
        <span className="font-mono text-[10px] text-paper-faint">
          {summary.visibleCount} 分类 · {summary.enabledSourcesCount} 信源
        </span>

        <div className="flex items-center gap-1.5">
          {isCurrent ? (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 rounded-full border border-cinnabar/50 bg-cinnabar/15 px-3 py-1 font-mono text-[10px] font-medium tracking-wide text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
            >
              <SlidersHorizontal size={11} strokeWidth={1.7} />
              编辑分类
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onApply}
                className="inline-flex items-center gap-1 rounded-full border border-haze bg-transparent px-3 py-1 font-mono text-[10px] tracking-wide text-paper transition-colors hover:border-cinnabar/50 hover:bg-cinnabar/10 hover:text-cinnabar"
              >
                应用
              </button>
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1 rounded-full border border-haze bg-transparent px-2.5 py-1 font-mono text-[10px] tracking-wide text-paper-muted transition-colors hover:border-cinnabar/30 hover:text-paper"
              >
                <SlidersHorizontal size={11} strokeWidth={1.7} />
                编辑
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onRename}
            title="重命名预设"
            aria-label="重命名预设"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-haze text-paper-faint transition-colors hover:border-paper-muted hover:text-paper"
          >
            <Pencil size={11} strokeWidth={1.6} />
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="删除预设"
              aria-label="删除预设"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-haze text-paper-faint transition-colors hover:border-cinnabar/40 hover:text-cinnabar"
            >
              <Trash2 size={11} strokeWidth={1.6} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 自定义预设为空时的引导卡片 */
function PresetEmptyState({
  onSaveAs,
  onCreateBlank,
}: {
  onSaveAs: () => void
  onCreateBlank: () => void
}) {
  return (
    <div className="page-x pt-2">
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-haze/90 bg-ink-raised/30 px-4 py-7 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
          <FolderPlus size={18} strokeWidth={1.75} className="text-cinnabar-soft" />
        </div>
        <h3 className="mt-3 font-display text-[16px] text-paper">还没有自定义预设</h3>
        <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-paper-muted">
          另存当前布局，或从空白开始搭一套。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onCreateBlank}
            className="inline-flex items-center gap-1.5 rounded-full border border-haze bg-transparent px-4 py-1.5 font-mono text-[11px] text-paper transition-colors hover:border-cinnabar/50 hover:text-cinnabar-soft"
          >
            <Plus size={13} strokeWidth={2} />
            创建空白
          </button>
          <button
            type="button"
            onClick={onSaveAs}
            className="inline-flex items-center gap-1.5 rounded-full border border-cinnabar/60 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
          >
            <CopyPlus size={13} strokeWidth={2} />
            另存当前
          </button>
        </div>
      </div>
    </div>
  )
}

export function PresetListScreen({
  state,
  builtins,
  onApply,
  onEditPreset,
  onEditLayout,
  onSaveAs,
  onCreateBlank,
  onRestoreFactory,
  onRename,
  onDelete,
  onBack,
}: Props) {
  const [dialog, setDialog] = useState<DialogState>(null)

  const activePreset = resolvePreset(state, state.activePresetId)
  const basedOnBuiltin = activePreset?.basedOnBuiltinId
    ? findBuiltinPreset(activePreset.basedOnBuiltinId)
    : undefined
  const activeModified = Boolean(
    activePreset?.builtin && isBuiltinOverridden(state, activePreset.id),
  )

  return (
    <SettingsShell
      title="场景预设"
      caption={`当前「${activePreset?.name ?? '场景预设'}」`}
      onBack={onBack}
      action={
        <button
          type="button"
          onClick={() => setDialog({ type: 'createBlank' })}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-haze bg-ink-raised/60 px-3 py-1.5 font-mono text-[10.5px] tracking-[0.08em] text-paper transition-colors hover:border-cinnabar/50 hover:text-cinnabar-soft"
        >
          <Plus size={12.5} strokeWidth={2} />
          创建空白
        </button>
      }
    >
      <ActivePresetHero
        activePreset={activePreset}
        basedOnBuiltinName={basedOnBuiltin?.name}
        modified={activeModified}
        onEditLayout={onEditLayout}
        onSaveAs={() => setDialog({ type: 'saveAs' })}
        onRestore={
          activeModified
            ? () =>
                setDialog({
                  type: 'restore',
                  id: activePreset!.id,
                  name: activePreset!.name,
                })
            : undefined
        }
      />

      <SettingsHint>切换会整包替换；改分类写回当前预设，内置可恢复出厂。</SettingsHint>

      {/* 内置场景包 */}
      <SettingsSection variant="plain" title="内置场景包">
        <ul className="page-x grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {builtins.map((preset) => {
            const isCurrent = preset.id === state.activePresetId
            const modified = isBuiltinOverridden(state, preset.id)

            return (
              <BuiltinPresetCard
                key={preset.id}
                preset={preset}
                isCurrent={isCurrent}
                modified={modified}
                onApply={() => setDialog({ type: 'apply', id: preset.id, name: preset.name })}
                onCustomize={() => {
                  if (isCurrent) {
                    onEditPreset(preset.id)
                    return
                  }
                  setDialog({ type: 'apply', id: preset.id, name: preset.name })
                }}
                onRestore={
                  modified
                    ? () => setDialog({ type: 'restore', id: preset.id, name: preset.name })
                    : undefined
                }
              />
            )
          })}
        </ul>
      </SettingsSection>

      {/* 我的自定义预设 */}
      <SettingsSection variant="plain" title="我的预设">
        {state.userPresets.length === 0 ? (
          <PresetEmptyState
            onSaveAs={() => setDialog({ type: 'saveAs' })}
            onCreateBlank={() => setDialog({ type: 'createBlank' })}
          />
        ) : (
          <ul className="page-x grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {state.userPresets.map((preset) => {
              const isCurrent = preset.id === state.activePresetId
              return (
                <UserPresetCard
                  key={preset.id}
                  preset={preset}
                  isCurrent={isCurrent}
                  onEdit={() => {
                    if (isCurrent) {
                      onEditPreset(preset.id)
                      return
                    }
                    setDialog({ type: 'edit', id: preset.id, name: preset.name })
                  }}
                  onApply={() => setDialog({ type: 'apply', id: preset.id, name: preset.name })}
                  onRename={() => setDialog({ type: 'rename', id: preset.id, name: preset.name })}
                  onDelete={() => setDialog({ type: 'delete', id: preset.id, name: preset.name })}
                />
              )
            })}
          </ul>
        )}
      </SettingsSection>

      {/* 弹窗：确认应用 */}
      <ConfirmDialog
        open={dialog?.type === 'apply'}
        title="应用场景预设？"
        message={
          dialog?.type === 'apply' ? (
            <>将用「{dialog.name}」整包替换当前分类顺序、显隐与综合频道设置。</>
          ) : null
        }
        confirmLabel="应用"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'apply') return
          const { id } = dialog
          setDialog(null)
          onApply(id)
        }}
      />

      {/* 弹窗：确认切换并编辑 */}
      <ConfirmDialog
        open={dialog?.type === 'edit'}
        title="编辑该预设？"
        message={
          dialog?.type === 'edit' ? (
            <>
              「{dialog.name}」当前未使用。编辑前会先切换到该预设（替换当前布局），随后进入分类与信源设置。
            </>
          ) : null
        }
        confirmLabel="切换并编辑"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'edit') return
          const { id } = dialog
          setDialog(null)
          onEditPreset(id)
        }}
      />

      {/* 弹窗：确认删除 */}
      <ConfirmDialog
        open={dialog?.type === 'delete'}
        title="删除预设？"
        message={
          dialog?.type === 'delete' ? (
            <>删除「{dialog.name}」后不可恢复。若正在使用，将切换到其它预设或内置场景。</>
          ) : null
        }
        confirmLabel="删除"
        danger
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'delete') return
          const { id } = dialog
          setDialog(null)
          onDelete(id)
        }}
      />

      {/* 弹窗：另存为 */}
      <PromptDialog
        open={dialog?.type === 'saveAs'}
        title="另存为新预设"
        message="以当前预设为蓝本复制一份自定义预设。"
        label="预设名称"
        defaultValue={activePreset ? `${activePreset.name} 副本` : '我的预设'}
        confirmLabel="保存"
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          setDialog(null)
          onSaveAs(name)
        }}
      />

      {/* 弹窗：创建空白 */}
      <PromptDialog
        open={dialog?.type === 'createBlank'}
        title="创建空白预设"
        message="从空白开始：信源全空，包含一个初始「我的关注」分类，不基于任何内置场景。"
        label="预设名称"
        defaultValue="未命名预设"
        confirmLabel="创建"
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          setDialog(null)
          onCreateBlank(name)
        }}
      />

      {/* 弹窗：恢复出厂 */}
      <ConfirmDialog
        open={dialog?.type === 'restore'}
        title="恢复出厂配置？"
        message={
          dialog?.type === 'restore' ? (
            <>将「{dialog.name}」恢复为内置出厂分类与信源。当前改动会丢掉。</>
          ) : null
        }
        confirmLabel="恢复出厂"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'restore') return
          const { id } = dialog
          setDialog(null)
          onRestoreFactory(id)
        }}
      />

      {/* 弹窗：重命名 */}
      <PromptDialog
        open={dialog?.type === 'rename'}
        title="重命名预设"
        label="预设名称"
        defaultValue={dialog?.type === 'rename' ? dialog.name : ''}
        confirmLabel="保存"
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          if (dialog?.type !== 'rename') return
          const { id } = dialog
          setDialog(null)
          onRename(id, name)
        }}
      />
    </SettingsShell>
  )
}
