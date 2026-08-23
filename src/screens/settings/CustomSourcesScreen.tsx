import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Rss,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'

import { ConfirmDialog, OptionPickerDialog, type OptionPickerItem } from '../../components/ConfirmDialog'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { fetchAbsoluteText } from '../../lib/http'
import {
  discoverFeedsFromHtml,
  downloadOpmlFile,
  exportOpml,
  OPML_IMPORT_SOFT_LIMIT,
  OPML_STARTER_TEMPLATE,
  parseOpml,
  type OpmlParseResult,
} from '../../lib/opml'
import { parseSourcePayload } from '../../lib/parseFeed'
import { extractCatalog } from '../../features/catalogEngine/engine'
import type { CategoryId, NewsCategory } from '../../sources/categories'
import {
  allRegisteredCategories,
  type Preferences,
} from '../../sources/preferences'
import type { NewsSource } from '../../sources/registry'
import { detectFramework } from '../../features/frameworkDetect/detect'
import type { FrameworkHint } from '../../features/frameworkDetect/types'

interface Props {
  prefs: Preferences
  onAddCustomSource: (
    source: {
      name: string
      label: string
      url: string
      siteUrl?: string
      kind?: NewsSource['kind']
      frameworkHint?: FrameworkHint
    },
    targetCategoryId?: CategoryId,
  ) => void
  onUpdateCustomSource: (
    sourceId: string,
    patch: Partial<Pick<NewsSource, 'name' | 'label' | 'url' | 'siteUrl' | 'kind'>>,
  ) => void
  onDeleteCustomSource: (sourceId: string) => void
  onDeleteCustomSources: (sourceIds: string[]) => void
  onBatchImport: (sources: NewsSource[], categories?: NewsCategory[]) => void
  onBack: () => void
}

export function CustomSourcesScreen({
  prefs,
  onAddCustomSource,
  onUpdateCustomSource,
  onDeleteCustomSource,
  onDeleteCustomSources,
  onBatchImport,
  onBack,
}: Props) {
  const customSources = prefs.customSources ?? []
  const categories = allRegisteredCategories(prefs)

  // 新建/编辑自定义订阅弹窗状态
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [inputUrl, setInputUrl] = useState('')
  const [inputName, setInputName] = useState('')
  const [inputLabel, setInputLabel] = useState('')
  const [inputSiteUrl, setInputSiteUrl] = useState('')
  const [targetCategory, setTargetCategory] = useState<string>('none')
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [probeDiscoveredFeeds, setProbeDiscoveredFeeds] = useState<{ title: string; url: string }[]>([])
  const [probeCatalogHit, setProbeCatalogHit] = useState<{
    name: string
    extractor?: string
    frameworkHint?: FrameworkHint
  } | null>(null)

  // OPML 导入状态
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showOpmlImportChooser, setShowOpmlImportChooser] = useState(false)
  const [showOpmlTextEditor, setShowOpmlTextEditor] = useState(false)
  const [opmlDraftText, setOpmlDraftText] = useState(OPML_STARTER_TEMPLATE)
  const [opmlResult, setOpmlResult] = useState<OpmlParseResult | null>(null)
  const [importCategoriesOption, setImportCategoriesOption] = useState(true)
  const [importing, setImporting] = useState(false)
  const [opmlError, setOpmlError] = useState<string | null>(null)
  const [confirmLargeOpmlImport, setConfirmLargeOpmlImport] = useState(false)

  // OPML 导出状态
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportIncludeBuiltin, setExportIncludeBuiltin] = useState(false)

  // 删除与批量管理状态
  const [sourceToDelete, setSourceToDelete] = useState<NewsSource | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set())
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)

  const categoryOptions: OptionPickerItem<string>[] = useMemo(
    () => [
      { id: 'none', label: '暂不归入特定分类 (可在分类设置中按需添加)' },
      ...categories.map((c) => ({ id: c.id, label: c.label })),
    ],
    [categories],
  )

  const selectedCategoryLabel = useMemo(() => {
    if (targetCategory === 'none') {
      return '暂不归入特定分类 (可在分类设置中按需添加)'
    }
    const found = categories.find((c) => c.id === targetCategory)
    return found ? found.label : '暂不归入特定分类'
  }, [targetCategory, categories])

  const filteredCustomSources = useMemo(() => {
    const list = prefs.customSources ?? []
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q) ||
        (s.siteUrl && s.siteUrl.toLowerCase().includes(q)),
    )
  }, [prefs.customSources, searchQuery])
  const filteredSourceIds = useMemo(
    () => filteredCustomSources.map((source) => source.id),
    [filteredCustomSources],
  )
  const selectedSourceCount = selectedSourceIds.size
  const allFilteredSelected =
    filteredSourceIds.length > 0 &&
    filteredSourceIds.every((sourceId) => selectedSourceIds.has(sourceId))
  const selectedSourcePreview = useMemo(
    () =>
      customSources
        .filter((source) => selectedSourceIds.has(source.id))
        .slice(0, 3)
        .map((source) => `「${source.name}」`)
        .join('、'),
    [customSources, selectedSourceIds],
  )

  const urlInputId = useId()
  const nameInputId = useId()
  const labelInputId = useId()

  const resetForm = () => {
    setInputUrl('')
    setInputName('')
    setInputLabel('')
    setInputSiteUrl('')
    setTargetCategory('none')
    setCategoryPickerOpen(false)
    setProbeError(null)
    setProbeDiscoveredFeeds([])
    setProbeCatalogHit(null)
    setEditingSourceId(null)
    setShowAddModal(false)
  }

  const enterSelectionMode = () => {
    setSelectionMode(true)
    setSelectedSourceIds(new Set())
    setSourceToDelete(null)
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelectedSourceIds(new Set())
    setConfirmBatchDelete(false)
  }

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      if (next.has(sourceId)) next.delete(sourceId)
      else next.add(sourceId)
      return next
    })
  }

  const toggleAllFilteredSources = () => {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev)
      const clearFiltered =
        filteredSourceIds.length > 0 && filteredSourceIds.every((sourceId) => next.has(sourceId))
      filteredSourceIds.forEach((sourceId) => {
        if (clearFiltered) next.delete(sourceId)
        else next.add(sourceId)
      })
      return next
    })
  }

  // 如果数据在选择期间发生变化，只保留仍然存在的选中项。
  useEffect(() => {
    if (!selectionMode) return
    const validIds = new Set(customSources.map((source) => source.id))
    setSelectedSourceIds((prev) => {
      const retained = [...prev].filter((sourceId) => validIds.has(sourceId))
      return retained.length === prev.size ? prev : new Set(retained)
    })
  }, [customSources, selectionMode])

  // 监听键盘 Escape 键关闭活动弹窗；无弹窗时退出批量管理。
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showAddModal) resetForm()
      else if (opmlResult) setOpmlResult(null)
      else if (showOpmlTextEditor) setShowOpmlTextEditor(false)
      else if (showOpmlImportChooser) setShowOpmlImportChooser(false)
      else if (showExportModal) setShowExportModal(false)
      else if (selectionMode) exitSelectionMode()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectionMode,
    showAddModal,
    opmlResult,
    showOpmlTextEditor,
    showOpmlImportChooser,
    showExportModal,
  ])

  const openAddModal = () => {
    resetForm()
    setShowAddModal(true)
  }

  const openEditModal = (source: NewsSource) => {
    setEditingSourceId(source.id)
    setInputUrl(source.url)
    setInputName(source.name)
    setInputLabel(source.label)
    setInputSiteUrl(source.siteUrl ?? '')
    setProbeError(null)
    setProbeDiscoveredFeeds([])
    setProbeCatalogHit(
      source.kind === 'web-catalog'
        ? { name: source.name, extractor: '目录' }
        : null,
    )
    setShowAddModal(true)
  }

  /** 智能探测与验证 RSS Feed */
  const probeFeedUrl = async (rawUrl: string) => {
    const url = rawUrl.trim()
    if (!url) return

    setProbing(true)
    setProbeError(null)
    setProbeDiscoveredFeeds([])
    setProbeCatalogHit(null)

    try {
      const normalizedUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
      const text = await fetchAbsoluteText(normalizedUrl)

      // 尝试按 XML Feed 解析
      try {
        const dummySource: NewsSource = {
          id: 'probe_temp',
          name: 'Probe',
          label: 'Probe',
          group: 'custom',
          kind: 'feed',
          url: normalizedUrl,
          enabled: true,
        }
        const articles = parseSourcePayload(dummySource, text)
        if (articles.length > 0) {
          // 成功探测到 RSS / Atom feed
          // 从 XML 中尝试提取 feed title
          const parser = new DOMParser()
          const doc = parser.parseFromString(text, 'text/xml')
          const channelTitle =
            doc.querySelector('channel > title, feed > title')?.textContent?.trim() || ''
          const channelLink =
            doc.querySelector('channel > link, feed > link:not([rel="self"])')?.textContent?.trim() ||
            doc.querySelector('feed > link')?.getAttribute('href') ||
            ''

          if (channelTitle && !inputName) {
            setInputName(channelTitle)
            setInputLabel(channelTitle.slice(0, 4))
          }
          if (channelLink && !inputSiteUrl) {
            setInputSiteUrl(channelLink)
          }
          setInputUrl(normalizedUrl)
          return
        }
      } catch {
        // 不是直接的 XML feed，尝试从 HTML 中寻找 link rel="alternate"
      }

      // 通用目录引擎：JSON-LD → 启发式卡片
      const catalog = extractCatalog(text, normalizedUrl)
      if (catalog.items.length > 0) {
        const displayName = (() => {
          try {
            return new URL(normalizedUrl).hostname
          } catch {
            return '网页目录'
          }
        })()
        const extractorLabel =
          catalog.extractor === 'json-ld'
            ? 'JSON-LD'
            : catalog.extractor === 'heuristic-cards'
              ? '通用卡片'
              : '通用'

        const hint = detectFramework(text, normalizedUrl)
        setProbeCatalogHit({ name: displayName, extractor: extractorLabel, frameworkHint: hint ?? undefined })
        if (!inputName) {
          setInputName(displayName)
          setInputLabel(displayName.slice(0, 4))
        }
        if (!inputSiteUrl) {
          try {
            const parsed = new URL(normalizedUrl)
            setInputSiteUrl(`${parsed.protocol}//${parsed.host}/`)
          } catch {
            // keep empty
          }
        }
        setInputUrl(normalizedUrl)
        return
      }

      // 尝试从网页 HTML 中探测 RSS 地址
      const discovered = discoverFeedsFromHtml(text, normalizedUrl)
      if (discovered.length > 0) {
        setProbeDiscoveredFeeds(discovered)
        if (discovered[0]) {
          setInputUrl(discovered[0].url)
          if (!inputName) {
            setInputName(discovered[0].title)
            setInputLabel(discovered[0].title.slice(0, 4))
          }
          setInputSiteUrl(normalizedUrl)
        }
      } else {
        setProbeError(
          '未能在此地址中检测到 RSS / Atom 订阅源或可解析的网页目录，请确认 URL 是否正确。',
        )
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : '网络请求失败，无法连接到该地址')
    } finally {
      setProbing(false)
    }
  }

  const handleSaveSource = (e?: React.FormEvent) => {
    e?.preventDefault()
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }
    const name = inputName.trim() || url
    const label = inputLabel.trim() || name.slice(0, 4)
    let siteUrl = inputSiteUrl.trim() || undefined
    if (siteUrl && !siteUrl.startsWith('http://') && !siteUrl.startsWith('https://')) {
      siteUrl = `https://${siteUrl}`
    }

    const hint = probeCatalogHit?.frameworkHint

    if (editingSourceId) {
      onUpdateCustomSource(editingSourceId, {
        url,
        name,
        label,
        siteUrl,
        ...(probeCatalogHit ? { kind: 'web-catalog' as const } : {}),
      })
    } else {
      const targetCatId =
        targetCategory !== 'none' ? (targetCategory as CategoryId) : undefined
      onAddCustomSource(
        {
          name,
          label,
          url,
          siteUrl,
          ...(probeCatalogHit ? { kind: 'web-catalog' as const } : {}),
          ...(hint ? { frameworkHint: hint } : {}),
        },
        targetCatId,
      )
    }

    resetForm()
  }

  // 解析 OPML 文本（文件与编辑器共用）
  const parseOpmlText = async (text: string) => {
    setOpmlError(null)
    setImporting(true)
    try {
      const result = parseOpml(text)
      if (result.sources.length === 0) {
        throw new Error('OPML 中未找到任何有效的 RSS / Atom 订阅条目（需要带 xmlUrl 的 outline）')
      }
      setShowOpmlImportChooser(false)
      setShowOpmlTextEditor(false)
      setOpmlResult(result)
    } catch (err) {
      setOpmlError(err instanceof Error ? err.message : '解析 OPML 失败')
    } finally {
      setImporting(false)
    }
  }

  // OPML 文件导入选择触发
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      await parseOpmlText(text)
    } catch (err) {
      setOpmlError(err instanceof Error ? err.message : '读取 OPML 文件失败')
    } finally {
      // 重置 input 以便再次选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openOpmlImportChooser = () => {
    setOpmlError(null)
    setShowOpmlImportChooser(true)
  }

  const openOpmlFilePicker = () => {
    setShowOpmlImportChooser(false)
    setOpmlError(null)
    // 等 chooser 收起后再唤起系统文件框，避免部分 WebView 吞掉 click
    window.setTimeout(() => fileInputRef.current?.click(), 0)
  }

  const openOpmlTextEditor = (fresh = false) => {
    setShowOpmlImportChooser(false)
    setOpmlError(null)
    if (fresh || !opmlDraftText.trim()) {
      setOpmlDraftText(OPML_STARTER_TEMPLATE)
    }
    setShowOpmlTextEditor(true)
  }

  // 确认导入 OPML
  const commitOpmlImport = () => {
    if (!opmlResult) return
    const categoriesToImport = importCategoriesOption ? opmlResult.categories : undefined
    onBatchImport(opmlResult.sources, categoriesToImport)
    setOpmlResult(null)
    setConfirmLargeOpmlImport(false)
  }

  const handleConfirmOpmlImport = () => {
    if (!opmlResult) return
    if (opmlResult.sources.length > OPML_IMPORT_SOFT_LIMIT) {
      setConfirmLargeOpmlImport(true)
      return
    }
    commitOpmlImport()
  }

  // 触发 OPML 导出
  const handleExportOpml = () => {
    const xml = exportOpml(prefs, {
      includeBuiltin: exportIncludeBuiltin,
      title: 'NewsNook Subscriptions',
    })
    const dateStr = new Date().toISOString().slice(0, 10)
    downloadOpmlFile(`newsnook-subscriptions-${dateStr}.opml`, xml)
    setShowExportModal(false)
  }

  return (
    <SettingsShell
      title="自定义订阅"
      caption={
        selectionMode
          ? `批量管理 · 已选 ${selectedSourceCount} / ${customSources.length}`
          : `${customSources.length} 个自建信源 · 支持 OPML 导入导出`
      }
      onBack={selectionMode ? exitSelectionMode : onBack}
      action={
        selectionMode ? (
          <button
            type="button"
            onClick={exitSelectionMode}
            className="shrink-0 rounded-full border border-haze px-3.5 py-1.5 font-mono text-[10.5px] tracking-[0.1em] text-paper-muted transition-colors hover:text-paper"
          >
            完成
          </button>
        ) : (
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-1 shrink-0 rounded-full border border-cinnabar bg-cinnabar/20 px-3.5 py-1.5 font-mono text-[10.5px] font-medium tracking-[0.1em] text-cinnabar-soft transition-colors hover:bg-cinnabar/30"
          >
            <Plus size={13} strokeWidth={2.4} />
            添加订阅
          </button>
        )
      }
    >
      {/* 隐藏的 OPML 文件上传 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".opml,.xml,text/xml,application/xml"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* 快捷功能卡片：添加 / OPML 导入 / OPML 导出 */}
      <div className="page-x pt-4 pb-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={openAddModal}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-haze/90 bg-ink-raised/60 p-4 text-center transition-all hover:border-cinnabar/60 hover:bg-cinnabar/5"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-cinnabar/40 bg-cinnabar/15 text-cinnabar-soft">
              <Rss size={18} />
            </div>
            <div>
              <span className="block text-[13.5px] font-medium text-paper">添加 RSS 源</span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                直接输入 Feed 或博客网址
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={importing}
            onClick={openOpmlImportChooser}
            className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-haze/90 bg-ink-raised/60 p-4 text-center transition-all hover:border-paper/40 hover:bg-paper/5 disabled:opacity-50"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
              {importing ? (
                <Loader2 size={18} className="animate-spin text-cinnabar-soft" />
              ) : (
                <Upload size={18} />
              )}
            </div>
            <div>
              <span className="block text-[13.5px] font-medium text-paper">
                {importing ? '解析中...' : '导入 OPML'}
              </span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                选文件或粘贴文本
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="col-span-2 sm:col-span-1 flex flex-col items-center justify-center gap-2 rounded-2xl border border-haze/90 bg-ink-raised/60 p-4 text-center transition-all hover:border-paper/40 hover:bg-paper/5"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
              <Download size={18} />
            </div>
            <div>
              <span className="block text-[13.5px] font-medium text-paper">导出 OPML</span>
              <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
                标准格式，随时迁移与备份
              </span>
            </div>
          </button>
        </div>
      </div>

      {opmlError && (
        <div className="page-x pt-2">
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-[12px] text-rose-300">
            <AlertCircle size={15} className="shrink-0" />
            <span>{opmlError}</span>
          </div>
        </div>
      )}

      {/* 自建源列表 */}
      <SettingsSection title={`自建订阅列表 (${customSources.length})`}>
        {customSources.length === 0 ? (
          <div className="page-x py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-faint">
              <Rss size={22} />
            </div>
            <p className="mt-3 text-[14px] font-medium text-paper">暂无自定义订阅源</p>
            <p className="mt-1 text-[12px] text-paper-faint">
              上方可添加 RSS，或导入 OPML（选文件 / 粘贴文本）。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="page-x flex items-center gap-2">
              {customSources.length > 5 ? (
                <div className="relative flex min-w-0 flex-1 items-center">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3.5 text-paper-faint"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索自建信源名称、网址或标签..."
                    className="w-full rounded-xl border border-haze bg-ink-raised/60 py-2 pr-9 pl-9 text-[13px] text-paper placeholder-paper-faint/50 transition-colors focus:border-cinnabar focus:outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="清空搜索"
                      className="absolute right-2.5 rounded-full p-1 text-paper-faint transition-colors hover:bg-paper/10 hover:text-paper"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : (
                <span className="min-w-0 flex-1 font-mono text-[10.5px] text-paper-faint">
                  {selectionMode
                    ? '点击条目选择；可一次删除多个订阅'
                    : customSources.length > 1
                      ? '支持批量选择与删除'
                      : '点击订阅可编辑，右侧可删除'}
                </span>
              )}

              {!selectionMode && customSources.length > 1 && (
                <button
                  type="button"
                  onClick={enterSelectionMode}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-haze bg-paper/5 px-3 py-2 font-mono text-[10.5px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper"
                >
                  <Check size={12} strokeWidth={2.2} />
                  批量管理
                </button>
              )}
            </div>

            {selectionMode && (
              <div className="page-x sticky top-0 z-10 bg-ink py-1">
                <div className="flex items-center gap-2 rounded-xl border border-cinnabar/30 bg-ink-raised px-3 py-2 shadow-sm">
                  <span
                    role="status"
                    aria-live="polite"
                    className="min-w-0 flex-1 font-mono text-[10.5px] text-paper-muted"
                  >
                    已选 <strong className="font-semibold text-paper">{selectedSourceCount}</strong> /{' '}
                    {customSources.length}
                  </span>
                  <button
                    type="button"
                    disabled={filteredSourceIds.length === 0}
                    onClick={toggleAllFilteredSources}
                    className="shrink-0 rounded-full border border-haze px-2.5 py-1.5 font-mono text-[10px] text-paper-muted transition-colors hover:text-paper disabled:opacity-35"
                  >
                    {allFilteredSelected
                      ? '取消全选'
                      : searchQuery.trim()
                        ? `全选结果 ${filteredSourceIds.length}`
                        : '全选'}
                  </button>
                  <button
                    type="button"
                    disabled={selectedSourceCount === 0}
                    onClick={() => setConfirmBatchDelete(true)}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/5 px-2.5 py-1.5 font-mono text-[10px] text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-35"
                  >
                    <Trash2 size={12} />
                    删除{selectedSourceCount > 0 ? ` ${selectedSourceCount}` : ''}
                  </button>
                </div>
              </div>
            )}

            {filteredCustomSources.length === 0 ? (
              <div className="page-x py-8 text-center">
                <p className="text-[13px] text-paper-faint">
                  未找到与「{searchQuery}」匹配的自建订阅源
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-haze">
                {filteredCustomSources.map((source) => {
                  const timeStr = source.createdAt
                    ? new Date(source.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })
                    : ''
                  const selected = selectedSourceIds.has(source.id)

                  return (
                    <li
                      key={source.id}
                      className={`page-x flex items-center gap-3 py-4 transition-colors ${
                        selectionMode && selected
                          ? 'bg-cinnabar/5'
                          : 'bg-ink hover:bg-ink-raised/40'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          selectionMode
                            ? toggleSourceSelection(source.id)
                            : openEditModal(source)
                        }
                        aria-pressed={selectionMode ? selected : undefined}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        {selectionMode && (
                          <span
                            aria-hidden
                            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                              selected
                                ? 'border-cinnabar bg-cinnabar text-ink'
                                : 'border-haze bg-paper/5 text-transparent'
                            }`}
                          >
                            <Check size={13} strokeWidth={2.5} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="rounded-md border border-cinnabar/30 bg-cinnabar/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-cinnabar-soft">
                              {source.kind === 'web-catalog' ? '目录' : source.label || '自定义'}
                            </span>
                            <span className="truncate text-[14.5px] font-medium text-paper">
                              {source.name}
                            </span>
                          </span>
                          <span className="mt-1 block truncate font-mono text-[10.5px] text-paper-faint">
                            {source.url.replace(/^https?:\/\//, '')}
                          </span>
                          {timeStr && (
                            <span className="mt-0.5 block font-mono text-[9.5px] text-paper-faint/60">
                              添加于 {timeStr}
                            </span>
                          )}
                        </span>
                      </button>

                      {!selectionMode && (
                        <div className="flex shrink-0 items-center gap-1">
                          {source.siteUrl && (
                            <a
                              href={source.siteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg p-2 text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper"
                              title="打开站点"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => setSourceToDelete(source)}
                            className="rounded-lg p-2 text-paper-faint transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                            title="删除订阅"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </SettingsSection>

      {/* 添加 / 编辑订阅源 模态框 */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={resetForm}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-haze bg-ink p-6 shadow-2xl transition-all"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze pb-4">
              <h2 className="font-display text-[18px] font-medium text-paper">
                {editingSourceId ? '编辑自定义订阅' : '添加订阅源'}
              </h2>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full border border-haze px-3 py-1 font-mono text-[11px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleSaveSource} className="space-y-4 pt-4">
              {/* URL 输入框与探测按钮 */}
              <div>
                <label htmlFor={urlInputId} className="block text-[13px] font-medium text-paper">
                  Feed 链接、视频站列表页或博客主页
                </label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id={urlInputId}
                    type="url"
                    required
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="https://example.com/feed.xml 或 https://example.com"
                    className="min-w-0 flex-1 rounded-xl border border-haze bg-ink-raised px-3.5 py-2.5 text-[14px] text-paper placeholder-paper-faint/45 transition-colors focus:border-cinnabar focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={probing || !inputUrl.trim()}
                    onClick={() => probeFeedUrl(inputUrl)}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-haze bg-paper/5 px-3.5 py-2.5 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/60 hover:text-paper disabled:opacity-40"
                  >
                    {probing ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    探测
                  </button>
                </div>

                {probeError && (
                  <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-rose-400">
                    <AlertCircle size={12} />
                    {probeError}
                  </p>
                )}

                {probeCatalogHit && (
                  <div className="mt-2 rounded-xl border border-emerald-600/40 bg-emerald-900/20 p-2.5">
                    <span className="block font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                      已识别为网页目录（{probeCatalogHit.extractor ?? '通用'}）。将重排为 App 信息流；点进条目后在
                      Android 上嗅探播放。
                    </span>

                    {probeCatalogHit.frameworkHint && (
                      <div className="mt-1.5 font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                        已识别为 {probeCatalogHit.frameworkHint.framework.toUpperCase()}
                        {probeCatalogHit.frameworkHint.themeVariant
                          ? ` · ${probeCatalogHit.frameworkHint.themeVariant} 主题`
                          : ''}
                        {' '}站点
                        {probeCatalogHit.frameworkHint.categories?.length
                          ? ` · ${probeCatalogHit.frameworkHint.categories.length} 个分类`
                          : ''}
                        {probeCatalogHit.frameworkHint.searchTemplate ? ' · 支持站内搜索' : ''}
                        {probeCatalogHit.frameworkHint.sortOptions?.length
                          ? ' · 支持排序'
                          : ''}
                      </div>
                    )}
                  </div>
                )}

                {probeDiscoveredFeeds.length > 0 && (
                  <div className="mt-2 rounded-xl border border-cinnabar/30 bg-cinnabar/5 p-2.5">
                    <span className="block font-mono text-[10px] text-cinnabar-soft">
                      发现以下 Feed，点击应用：
                    </span>
                    <div className="mt-1 space-y-1">
                      {probeDiscoveredFeeds.map((feed) => (
                        <button
                          key={feed.url}
                          type="button"
                          onClick={() => {
                            setInputUrl(feed.url)
                            if (!inputName) {
                              setInputName(feed.title)
                              setInputLabel(feed.title.slice(0, 4))
                            }
                          }}
                          className="flex w-full items-center justify-between rounded-lg bg-ink/70 px-2.5 py-1.5 text-left text-[12px] text-paper hover:bg-cinnabar/15"
                        >
                          <span className="truncate">{feed.title}</span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] text-paper-faint">
                            {feed.url.slice(0, 30)}...
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 源名称与标签 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor={nameInputId} className="block text-[13px] font-medium text-paper">
                    订阅源名称
                  </label>
                  <input
                    id={nameInputId}
                    type="text"
                    required
                    value={inputName}
                    onChange={(e) => {
                      setInputName(e.target.value)
                      if (!inputLabel) setInputLabel(e.target.value.slice(0, 4))
                    }}
                    placeholder="如：少数派、阮一峰网络日志"
                    className="mt-1.5 w-full rounded-xl border border-haze bg-ink-raised px-3.5 py-2.5 text-[14px] text-paper placeholder-paper-faint/45 transition-colors focus:border-cinnabar focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor={labelInputId} className="block text-[13px] font-medium text-paper">
                    短标签
                  </label>
                  <input
                    id={labelInputId}
                    type="text"
                    maxLength={6}
                    value={inputLabel}
                    onChange={(e) => setInputLabel(e.target.value)}
                    placeholder={inputName.slice(0, 4) || '短名'}
                    className="mt-1.5 w-full rounded-xl border border-haze bg-ink-raised px-3 py-2.5 text-[14px] text-paper placeholder-paper-faint/45 transition-colors focus:border-cinnabar focus:outline-none"
                  />
                </div>
              </div>

              {/* 归入分类选项 (新建时可选) */}
              {!editingSourceId && (
                <div>
                  <label className="block text-[13px] font-medium text-paper">
                    同时归入分类 (可选)
                  </label>
                  <button
                    type="button"
                    onClick={() => setCategoryPickerOpen(true)}
                    className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl border border-haze bg-ink-raised px-3.5 py-2.5 text-left text-[13.5px] text-paper transition-colors hover:border-paper-faint/40 focus:border-cinnabar focus:outline-none active:scale-[0.99]"
                  >
                    <span className="min-w-0 flex-1 truncate text-paper">
                      {selectedCategoryLabel}
                    </span>
                    <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-haze">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-full border border-haze px-4 py-2 font-mono text-[12px] text-paper-faint hover:text-paper"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!inputUrl.trim()}
                  className="flex items-center gap-1.5 rounded-full border border-cinnabar bg-cinnabar/25 px-5 py-2 font-mono text-[12px] font-medium text-cinnabar-soft hover:bg-cinnabar/35 disabled:opacity-40"
                >
                  <Check size={14} />
                  {editingSourceId ? '保存修改' : '确认添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OPML 导入方式选择 */}
      {showOpmlImportChooser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowOpmlImportChooser(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-haze bg-ink p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze pb-4">
              <div>
                <h2 className="font-display text-[18px] font-medium text-paper">导入 OPML</h2>
                <p className="mt-0.5 font-mono text-[11px] text-paper-faint">
                  选择文件，或在编辑器中粘贴 / 新建
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOpmlImportChooser(false)}
                className="rounded-full border border-haze p-1.5 text-paper-faint hover:text-paper"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                disabled={importing}
                onClick={openOpmlFilePicker}
                className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised/60 p-4 text-left transition-all hover:border-cinnabar/50 hover:bg-cinnabar/5 disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-haze bg-paper/5 text-paper-muted">
                  <FolderOpen size={20} />
                </div>
                <div className="min-w-0">
                  <span className="block text-[14px] font-medium text-paper">从文件选择</span>
                  <span className="mt-0.5 block text-[12px] text-paper-faint">
                    打开设备上的 .opml / .xml（如 NetNewsWire、Reeder 导出）
                  </span>
                </div>
              </button>

              <button
                type="button"
                disabled={importing}
                onClick={() => openOpmlTextEditor(false)}
                className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised/60 p-4 text-left transition-all hover:border-cinnabar/50 hover:bg-cinnabar/5 disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-haze bg-paper/5 text-paper-muted">
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <span className="block text-[14px] font-medium text-paper">粘贴或编辑文本</span>
                  <span className="mt-0.5 block text-[12px] text-paper-faint">
                    在编辑器中新建骨架，或粘贴完整 OPML 再解析
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OPML 文本编辑器 */}
      {showOpmlTextEditor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowOpmlTextEditor(false)}
        >
          <div
            className="flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col rounded-3xl border border-haze bg-ink p-5 shadow-2xl sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze pb-4">
              <div>
                <h2 className="font-display text-[18px] font-medium text-paper">编辑 OPML</h2>
                <p className="mt-0.5 font-mono text-[11px] text-paper-faint">
                  粘贴导出内容，或改下方骨架后解析
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOpmlTextEditor(false)}
                className="rounded-full border border-haze p-1.5 text-paper-faint hover:text-paper"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <label className="mt-4 block min-h-0 flex-1">
              <span className="sr-only">OPML 文本</span>
              <textarea
                value={opmlDraftText}
                onChange={(e) => setOpmlDraftText(e.target.value)}
                spellCheck={false}
                className="h-[min(48vh,420px)] w-full resize-y rounded-2xl border border-haze bg-ink-raised/50 p-3 font-mono text-[12px] leading-relaxed text-paper placeholder:text-paper-faint focus:border-cinnabar/50 focus:outline-none"
                placeholder="在此粘贴或编写 OPML…"
              />
            </label>

            {opmlError && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-[12px] text-rose-300">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span>{opmlError}</span>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-haze pt-4">
              <button
                type="button"
                onClick={() => setOpmlDraftText(OPML_STARTER_TEMPLATE)}
                className="rounded-full border border-haze px-3.5 py-2 font-mono text-[11px] text-paper-faint hover:text-paper"
              >
                重置为骨架
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowOpmlTextEditor(false)}
                  className="rounded-full border border-haze px-4 py-2 font-mono text-[12px] text-paper-faint hover:text-paper"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={importing || !opmlDraftText.trim()}
                  onClick={() => void parseOpmlText(opmlDraftText)}
                  className="flex items-center gap-1.5 rounded-full border border-cinnabar bg-cinnabar/25 px-5 py-2 font-mono text-[12px] font-medium text-cinnabar-soft hover:bg-cinnabar/35 disabled:opacity-40"
                >
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  解析并预览
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OPML 导入确认模态框 */}
      {opmlResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpmlResult(null)}
        >
          <div
            className="w-full max-w-lg rounded-3xl border border-haze bg-ink p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze pb-4">
              <div>
                <h2 className="font-display text-[18px] font-medium text-paper">导入 OPML 订阅</h2>
                <p className="mt-0.5 font-mono text-[11px] text-paper-faint">
                  {opmlResult.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpmlResult(null)}
                className="rounded-full border border-haze px-3 py-1 font-mono text-[11px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
            </div>

            <div className="space-y-4 py-4">
              <div className="flex items-center justify-between rounded-2xl border border-haze bg-ink-raised p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cinnabar/15 text-cinnabar-soft">
                    <Rss size={20} />
                  </div>
                  <div>
                    <span className="block text-[15px] font-medium text-paper">
                      发现 {opmlResult.sources.length} 个订阅源
                    </span>
                    <span className="block font-mono text-[11px] text-paper-faint">
                      {opmlResult.categories.length > 0
                        ? `包含 ${opmlResult.categories.length} 个分类文件夹`
                        : '未包含文件夹层级'}
                    </span>
                  </div>
                </div>
              </div>

              {opmlResult.categories.length > 0 && (
                <label className="flex items-start gap-3 rounded-2xl border border-haze/80 bg-ink-raised/40 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importCategoriesOption}
                    onChange={(e) => setImportCategoriesOption(e.target.checked)}
                    className="mt-0.5 rounded border-haze text-cinnabar focus:ring-0"
                  />
                  <div>
                    <span className="block text-[13.5px] font-medium text-paper">
                      同时导入并创建分类 ({opmlResult.categories.length} 个)
                    </span>
                    <span className="mt-0.5 block text-[11.5px] text-paper-faint">
                      包含：{opmlResult.categories.map((c) => c.label).join('、')}
                    </span>
                  </div>
                </label>
              )}

              {/* 源列表预览 */}
              <div className="max-h-48 overflow-y-auto rounded-2xl border border-haze/60 bg-ink-raised/20 p-2 divide-y divide-haze/40">
                {opmlResult.sources.slice(0, 50).map((s) => (
                  <div key={s.id} className="py-1.5 px-2 flex items-center justify-between text-[12px]">
                    <span className="truncate text-paper">{s.name}</span>
                    <span className="ml-2 font-mono text-[10px] text-paper-faint shrink-0">
                      {s.url.slice(0, 25)}...
                    </span>
                  </div>
                ))}
                {opmlResult.sources.length > 50 && (
                  <div className="py-2 text-center font-mono text-[11px] text-paper-faint">
                    ... 及其余 {opmlResult.sources.length - 50} 个源
                  </div>
                )}
              </div>

              {opmlResult.sources.length > OPML_IMPORT_SOFT_LIMIT && (
                <p className="rounded-2xl border border-cinnabar/30 bg-cinnabar/10 px-3.5 py-3 text-[12px] leading-relaxed text-cinnabar-soft">
                  本次超过 {OPML_IMPORT_SOFT_LIMIT} 个源，导入后刷新可能较慢、更耗电。可分批导入或拆分分类。
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-haze">
              <button
                type="button"
                onClick={() => setOpmlResult(null)}
                className="rounded-full border border-haze px-4 py-2 font-mono text-[12px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmOpmlImport}
                className="flex items-center gap-1.5 rounded-full border border-cinnabar bg-cinnabar/25 px-5 py-2 font-mono text-[12px] font-medium text-cinnabar-soft hover:bg-cinnabar/35"
              >
                <ArrowDownToLine size={14} />
                导入全部 ({opmlResult.sources.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OPML 导出模态框 */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-haze bg-ink p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-haze pb-4">
              <h2 className="font-display text-[18px] font-medium text-paper">导出 OPML 订阅</h2>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-full border border-haze px-3 py-1 font-mono text-[11px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
            </div>

            <div className="space-y-3 py-5">
              <label className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised p-4 cursor-pointer">
                <input
                  type="radio"
                  name="exportScope"
                  checked={!exportIncludeBuiltin}
                  onChange={() => setExportIncludeBuiltin(false)}
                  className="text-cinnabar focus:ring-0"
                />
                <div>
                  <span className="block text-[14px] font-medium text-paper">
                    仅导出自建订阅源 ({customSources.length} 个)
                  </span>
                  <span className="mt-0.5 block text-[11px] text-paper-faint">
                    轻量备份与换机同步
                  </span>
                </div>
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised p-4 cursor-pointer">
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportIncludeBuiltin}
                  onChange={() => setExportIncludeBuiltin(true)}
                  className="text-cinnabar focus:ring-0"
                />
                <div>
                  <span className="block text-[14px] font-medium text-paper">
                    导出全部已订阅频道与分类
                  </span>
                  <span className="mt-0.5 block text-[11px] text-paper-faint">
                    含内置与自建，按分类树组织
                  </span>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-haze">
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-full border border-haze px-4 py-2 font-mono text-[12px] text-paper-faint hover:text-paper"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExportOpml}
                className="flex items-center gap-1.5 rounded-full border border-cinnabar bg-cinnabar/25 px-5 py-2 font-mono text-[12px] font-medium text-cinnabar-soft hover:bg-cinnabar/35"
              >
                <Download size={14} />
                下载 OPML 文件
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmBatchDelete && selectedSourceCount > 0}
        title={`删除已选的 ${selectedSourceCount} 个订阅？`}
        message={`将删除 ${selectedSourceCount} 个自建订阅${
          selectedSourcePreview
            ? `（${selectedSourcePreview}${selectedSourceCount > 3 ? ' 等' : ''}）`
            : ''
        }，并从所有分类中移除。此操作无法撤销。`}
        confirmLabel={`删除 ${selectedSourceCount} 个`}
        danger
        onCancel={() => setConfirmBatchDelete(false)}
        onConfirm={() => {
          if (selectedSourceCount === 0) return
          onDeleteCustomSources([...selectedSourceIds])
          exitSelectionMode()
        }}
      />

      {/* 删除单个自定义源确认对话框 */}
      <ConfirmDialog
        open={Boolean(sourceToDelete)}
        title="删除此自定义订阅？"
        message={
          sourceToDelete
            ? `确定删除「${sourceToDelete.name}」？删除后该订阅将从所有分类中移除。`
            : ''
        }
        confirmLabel="删除"
        danger
        onCancel={() => setSourceToDelete(null)}
        onConfirm={() => {
          if (sourceToDelete) {
            onDeleteCustomSource(sourceToDelete.id)
            setSourceToDelete(null)
          }
        }}
      />

      <ConfirmDialog
        open={confirmLargeOpmlImport && Boolean(opmlResult)}
        title="导入大量订阅？"
        message={
          opmlResult
            ? `将导入 ${opmlResult.sources.length} 个源（超过建议上限 ${OPML_IMPORT_SOFT_LIMIT}）。刷新可能较慢并增加耗电。确定继续？`
            : ''
        }
        confirmLabel="仍然导入"
        onCancel={() => setConfirmLargeOpmlImport(false)}
        onConfirm={commitOpmlImport}
      />

      <OptionPickerDialog
        open={categoryPickerOpen}
        title="选择归入分类"
        value={targetCategory}
        options={categoryOptions}
        onCancel={() => setCategoryPickerOpen(false)}
        onChange={(val) => {
          setTargetCategory(val)
          setCategoryPickerOpen(false)
        }}
      />
    </SettingsShell>
  )
}
