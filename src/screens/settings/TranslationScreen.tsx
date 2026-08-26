import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Cloud,
  CloudCog,
  Download,
  Eye,
  EyeOff,
  FileText,
  Languages,
  LoaderCircle,
  Smartphone,
  Trash2,
} from 'lucide-react'

import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { ConfirmDialog, OptionPickerDialog } from '../../components/ConfirmDialog'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_PROVIDERS,
  TRANSLATION_SOURCE_LANGUAGES,
  translationDisplayModeLabel,
  translationLanguageLabel,
  translationProviderLabel,
} from '../../features/translation/config'
import {
  BergamotTranslation,
  isBergamotTranslationAvailable,
  isLocalTranslationAvailable,
  MlKitTranslation,
  type BergamotModelState,
  type MlKitModelState,
} from '../../features/translation/native'
import { createTranslationProvider, mlKitLanguage } from '../../features/translation/providers'
import { listOpenAiModels } from '../../features/translation/openai'
import type {
  CloudTranslationConfig,
  TranslationPrefs,
  TranslationProviderId,
} from '../../features/translation/types'
import { isLocalTranslationProviderId } from '../../features/translation/types'
import { clearFeedTranslations } from '../../features/translation/feedTranslationStorage'

interface Props {
  prefs: TranslationPrefs
  onChange: (prefs: TranslationPrefs) => void
  onBack: () => void
}

type AsyncState = 'idle' | 'working' | 'success' | 'error'

const PROVIDER_ICONS: Record<TranslationProviderId, typeof Cloud> = {
  mlkit: Smartphone,
  bergamot: Smartphone,
  google: Languages,
  azure: CloudCog,
  deepl: Cloud,
  deeplx: CloudCog,
  openai: CloudCog,
}

function Field({
  label,
  value,
  placeholder,
  type = 'text',
  min,
  max,
  onChange,
  suffix,
}: {
  label: string
  value: string
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  min?: number
  max?: number
  onChange: (value: string) => void
  suffix?: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] tracking-[0.12em] text-paper-faint">
        {label}
      </span>
      <span className="flex min-h-12 items-center rounded-xl border border-haze bg-ink px-3.5 focus-within:border-cinnabar/55">
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          min={min}
          max={max}
          inputMode={type === 'number' ? 'numeric' : undefined}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-paper outline-none placeholder:text-paper-faint/65"
        />
        {suffix}
      </span>
    </label>
  )
}

export function TranslationScreen({ prefs, onChange, onBack }: Props) {
  const localTranslationAvailable = isLocalTranslationAvailable()
  const bergamotAvailable = isBergamotTranslationAvailable()
  const [modelState, setModelState] = useState<MlKitModelState | null>(null)
  const [bergamotState, setBergamotState] = useState<BergamotModelState | null>(null)
  const [modelAction, setModelAction] = useState<AsyncState>('idle')
  const [modelMessage, setModelMessage] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<AsyncState>('idle')
  const [testMessage, setTestMessage] = useState('')
  const [confirmDeleteModel, setConfirmDeleteModel] = useState(false)
  const [languagePicker, setLanguagePicker] = useState<'source' | 'target' | null>(null)
  const [modelListState, setModelListState] = useState<AsyncState>('idle')
  const [modelListMessage, setModelListMessage] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [clearedFeedCache, setClearedFeedCache] = useState(false)

  const autoSource = prefs.sourceLanguage === 'auto'
  const source = prefs.sourceLanguage === 'auto' ? null : mlKitLanguage(prefs.sourceLanguage)
  const target = mlKitLanguage(prefs.targetLanguage)

  useEffect(() => {
    let disposed = false
    setModelState(null)
    if (prefs.provider !== 'mlkit' || !localTranslationAvailable || !source) return
    void MlKitTranslation.getModelState({ sourceLanguage: source, targetLanguage: target })
      .then((state) => {
        if (!disposed) setModelState(state)
      })
      .catch(() => {
        if (!disposed) setModelState({ ready: false, downloadedLanguages: [] })
      })
    return () => {
      disposed = true
    }
  }, [prefs.provider, localTranslationAvailable, source, target])

  useEffect(() => {
    let disposed = false
    setBergamotState(null)
    if (prefs.provider !== 'bergamot' || !bergamotAvailable || !source) return
    void BergamotTranslation.getModelState({
      sourceLanguage: source,
      targetLanguage: target,
    })
      .then((state) => {
        if (!disposed) setBergamotState(state)
      })
      .catch((error) => {
        if (!disposed) {
          setBergamotState({
            ready: false,
            engineReady: false,
            engineError: error instanceof Error ? error.message : '无法读取 Bergamot 状态',
          })
        }
      })
    return () => {
      disposed = true
    }
  }, [prefs.provider, bergamotAvailable, source, target])

  const activeCloud = isLocalTranslationProviderId(prefs.provider)
    ? null
    : prefs.cloud[prefs.provider]
  const providerName = translationProviderLabel(prefs.provider)
  const availableProviders = TRANSLATION_PROVIDERS.filter(
    (provider) =>
      (provider.id !== 'mlkit' || localTranslationAvailable) &&
      (provider.id !== 'bergamot' || bergamotAvailable),
  )
  const apiKeyOptional = prefs.provider === 'deeplx'
  const modelCaption = useMemo(() => {
    if (!localTranslationAvailable) return '当前版本不支持本地翻译'
    if (autoSource) return '预下载请先指定原文语言'
    if (!modelState) return '正在检查语言包…'
    return modelState.ready ? '语言包已就绪' : '尚未下载语言包'
  }, [autoSource, localTranslationAvailable, modelState])

  const bergamotCaption = useMemo(() => {
    if (!bergamotAvailable) return '当前版本不支持 Bergamot 离线翻译'
    if (autoSource) return '预下载请先指定原文语言'
    if (!bergamotState) return '正在检查引擎…'
    if (bergamotState.ready && bergamotState.engineReady) {
      return '语对已就绪'
    }
    if (bergamotState.ready && !bergamotState.engineReady) {
      return bergamotState.engineError ?? '模型已下载，但当前版本无法使用离线引擎'
    }
    return '尚未下载该语对（约 40–50 MB）'
  }, [autoSource, bergamotAvailable, bergamotState])

  const updateCloud = (patch: Partial<CloudTranslationConfig>) => {
    if (isLocalTranslationProviderId(prefs.provider)) return
    onChange({
      ...prefs,
      cloud: {
        ...prefs.cloud,
        [prefs.provider]: { ...prefs.cloud[prefs.provider], ...patch },
      },
    })
    setTestState('idle')
    setTestMessage('')
  }

  const downloadModel = async () => {
    if (!source) return
    setModelAction('working')
    setModelMessage('正在下载语言包（通常约 30 MB），请保持页面开启…')
    try {
      const state = await MlKitTranslation.downloadModel({
        sourceLanguage: source,
        targetLanguage: target,
        wifiOnly: false,
      })
      setModelState(state)
      setModelAction('success')
      setModelMessage('语言包下载完成，现在可以离线翻译。')
    } catch (error) {
      setModelAction('error')
      setModelMessage(error instanceof Error ? error.message : '语言包下载失败')
    }
  }

  const deleteModel = async () => {
    if (!source) return
    setModelAction('working')
    setModelMessage('正在删除语言包…')
    try {
      const state = await MlKitTranslation.deleteModel({
        sourceLanguage: source,
        targetLanguage: target,
      })
      setModelState(state)
      setModelAction('idle')
      setModelMessage('语言包已删除。')
    } catch (error) {
      setModelAction('error')
      setModelMessage(error instanceof Error ? error.message : '语言包删除失败')
    }
  }

  const downloadBergamot = async () => {
    if (!source) return
    setModelAction('working')
    setModelMessage('正在下载 Bergamot 语对模型（约 40–50 MB）…')
    try {
      const state = await BergamotTranslation.downloadModel({
        sourceLanguage: source,
        targetLanguage: target,
        wifiOnly: false,
      })
      setBergamotState(state)
      setModelAction('success')
      setModelMessage(
        state.engineReady
          ? '语对模型下载完成，现在可以离线翻译。'
          : state.engineError ?? '语对模型已下载，但当前设备上的 Bergamot 引擎不可用。',
      )
    } catch (error) {
      setModelAction('error')
      setModelMessage(error instanceof Error ? error.message : 'Bergamot 模型下载失败')
    }
  }

  const deleteBergamot = async () => {
    if (!source) return
    setModelAction('working')
    setModelMessage('正在删除 Bergamot 语对模型…')
    try {
      const state = await BergamotTranslation.deleteModel({
        sourceLanguage: source,
        targetLanguage: target,
      })
      setBergamotState(state)
      setModelAction('idle')
      setModelMessage('Bergamot 语对模型已删除。')
    } catch (error) {
      setModelAction('error')
      setModelMessage(error instanceof Error ? error.message : 'Bergamot 模型删除失败')
    }
  }

  const testCloud = async () => {
    if (isLocalTranslationProviderId(prefs.provider)) return
    setTestState('working')
    setTestMessage('正在连接…')
    try {
      const provider = createTranslationProvider(prefs.provider, prefs.cloud[prefs.provider])
      const [translated] = await provider.translate({
        texts: ['The world is full of stories.'],
        sourceLanguage: prefs.sourceLanguage,
        targetLanguage: prefs.targetLanguage,
      })
      setTestState('success')
      setTestMessage(`连接成功 · ${translated}`)
    } catch (error) {
      setTestState('error')
      setTestMessage(error instanceof Error ? error.message : '连接失败')
    }
  }

  const fetchOpenAiModels = async () => {
    if (!activeCloud || prefs.provider !== 'openai') return
    setModelListState('working')
    setModelListMessage('正在拉取模型列表…')
    try {
      const models = await listOpenAiModels(activeCloud)
      setRemoteModels(models)
      setModelPickerOpen(true)
      setModelListState('success')
      setModelListMessage(models.length ? `已获取 ${models.length} 个模型` : '列表为空，请手填 Model')
    } catch (error) {
      setModelListState('error')
      setModelListMessage(error instanceof Error ? error.message : '拉取模型失败')
    }
  }

  return (
    <SettingsShell title="翻译" caption={`${providerName} · ${translationDisplayModeLabel(prefs.displayMode)}`} onBack={onBack}>
      <SettingsSection title="信息流外文翻译">
        <div className="divide-y divide-haze border-y border-haze bg-ink">
          <div className="page-x flex items-center justify-between py-4">
            <div className="pr-4">
              <span className="block text-[14px] text-paper">自动翻译外文标题</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-paper-faint">
                仅翻译列表标题
              </span>
            </div>
            <ToggleSwitch
              checked={prefs.translateFeed !== false}
              label={prefs.translateFeed !== false ? '关闭自动翻译外文标题' : '开启自动翻译外文标题'}
              onChange={() => onChange({ ...prefs, translateFeed: prefs.translateFeed === false })}
            />
          </div>

          <div className="page-x flex items-center justify-between py-3 bg-ink/40">
            <div>
              <span className="block text-[13px] text-paper">清空信息流翻译缓存</span>
              <span className="text-[11px] text-paper-faint">
                重置所有已缓存的标题译文
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                clearFeedTranslations()
                setClearedFeedCache(true)
                setTimeout(() => setClearedFeedCache(false), 2000)
              }}
              className="rounded-full border border-haze bg-paper/5 px-3 py-1 text-[11.5px] text-paper-muted hover:border-paper-faint hover:text-paper transition-colors"
            >
              {clearedFeedCache ? '已清空缓存' : '立即清空'}
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="译文呈现">
        <ul className="grid grid-cols-2 gap-px border-y border-haze bg-haze">
          {([
            {
              id: 'compare' as const,
              label: '对比翻译',
              caption: '段下附译文',
              icon: Languages,
            },
            {
              id: 'replace' as const,
              label: '全文替代',
              caption: '只显示译文',
              icon: FileText,
            },
          ]).map((mode) => {
            const Icon = mode.icon
            const checked = prefs.displayMode === mode.id
            return (
              <li key={mode.id} className="bg-ink">
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onChange({ ...prefs, displayMode: mode.id })}
                  className="flex min-h-[104px] w-full flex-col items-start justify-between px-4 py-3.5 text-left"
                >
                  <span className="flex w-full items-center justify-between">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full border ${checked ? 'border-cinnabar/60 bg-cinnabar/15' : 'border-haze bg-paper/5'}`}>
                      <Icon size={17} strokeWidth={1.6} className={checked ? 'text-cinnabar-soft' : 'text-paper-muted'} />
                    </span>
                    {checked && <Check size={15} strokeWidth={2.2} className="text-cinnabar" />}
                  </span>
                  <span>
                    <span className="block text-[14px] text-paper">{mode.label}</span>
                    <span className="mt-1 block text-[10.5px] leading-snug text-paper-faint">{mode.caption}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </SettingsSection>

      <SettingsSection title="语言">
        <div className="page-x grid grid-cols-[1fr_auto_1fr] items-end gap-2 border-y border-haze bg-ink py-4">
          <div>
            <span className="mb-1.5 block font-mono text-[10px] text-paper-faint">原文</span>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={languagePicker === 'source'}
              onClick={() => setLanguagePicker('source')}
              className="flex h-12 w-full items-center gap-2 rounded-xl border border-haze bg-ink-raised px-3 text-left text-[13px] text-paper outline-none transition-colors hover:border-cinnabar/40"
            >
              <span className="min-w-0 flex-1 truncate">{translationLanguageLabel(prefs.sourceLanguage)}</span>
              <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
            </button>
          </div>
          <span className="pb-3 font-mono text-[12px] text-paper-faint">→</span>
          <div>
            <span className="mb-1.5 block font-mono text-[10px] text-paper-faint">译文</span>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={languagePicker === 'target'}
              onClick={() => setLanguagePicker('target')}
              className="flex h-12 w-full items-center gap-2 rounded-xl border border-haze bg-ink-raised px-3 text-left text-[13px] text-paper outline-none transition-colors hover:border-cinnabar/40"
            >
              <span className="min-w-0 flex-1 truncate">{translationLanguageLabel(prefs.targetLanguage)}</span>
              <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
            </button>
          </div>
        </div>
      </SettingsSection>

      <OptionPickerDialog
        open={languagePicker === 'source'}
        title="选择原文语言"
        value={prefs.sourceLanguage}
        options={TRANSLATION_SOURCE_LANGUAGES}
        onCancel={() => setLanguagePicker(null)}
        onChange={(sourceLanguage) => {
          const targetLanguage =
            sourceLanguage !== 'auto' && sourceLanguage === prefs.targetLanguage
              ? sourceLanguage === 'en'
                ? 'zh-Hans'
                : 'en'
              : prefs.targetLanguage
          onChange({ ...prefs, sourceLanguage, targetLanguage })
          setLanguagePicker(null)
        }}
      />
      <OptionPickerDialog
        open={languagePicker === 'target'}
        title="选择译文语言"
        value={prefs.targetLanguage}
        options={TRANSLATION_LANGUAGES}
        onCancel={() => setLanguagePicker(null)}
        onChange={(targetLanguage) => {
          const sourceLanguage =
            prefs.sourceLanguage !== 'auto' && targetLanguage === prefs.sourceLanguage
              ? targetLanguage === 'en'
                ? 'zh-Hans'
                : 'en'
              : prefs.sourceLanguage
          onChange({ ...prefs, sourceLanguage, targetLanguage })
          setLanguagePicker(null)
        }}
      />

      <SettingsSection title="翻译方式">
        <ul className="divide-y divide-haze border-y border-haze md:grid md:grid-cols-2 md:gap-px md:divide-y-0 md:bg-haze">
          {availableProviders.map((provider) => {
            const Icon = PROVIDER_ICONS[provider.id]
            const checked = prefs.provider === provider.id
            return (
              <li key={provider.id} className="bg-ink">
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => {
                    onChange({ ...prefs, provider: provider.id })
                    setTestState('idle')
                    setTestMessage('')
                  }}
                  className="page-x flex min-h-[72px] w-full items-center gap-3 py-3.5 text-left"
                >
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${checked ? 'border-cinnabar/60 bg-cinnabar/15' : 'border-haze bg-paper/5'}`}>
                    <Icon size={17} strokeWidth={1.6} className={checked ? 'text-cinnabar-soft' : 'text-paper-muted'} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-paper">{provider.label}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-snug text-paper-faint">{provider.caption}</span>
                  </span>
                  {checked && <Check size={15} strokeWidth={2.2} className="shrink-0 text-cinnabar" />}
                </button>
              </li>
            )
          })}
        </ul>
      </SettingsSection>

      {prefs.provider === 'mlkit' ? (
        <div className="page-x pt-5">
          <div className="mx-auto max-w-3xl rounded-2xl border border-haze bg-ink-raised p-5 shadow-[var(--shadow-lift)]">
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${modelState?.ready ? 'bg-emerald-500' : 'bg-cinnabar'}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[19px] text-paper">离线语言包</span>
                <span className="mt-1 block text-[11.5px] text-paper-faint">{modelCaption}</span>
              </span>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={
                  autoSource ||
                  !localTranslationAvailable ||
                  modelAction === 'working' ||
                  Boolean(modelState?.ready)
                }
                onClick={() => void downloadModel()}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 text-[12.5px] text-paper disabled:opacity-35"
              >
                {modelAction === 'working' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
                {autoSource ? '请先指定原文' : modelState?.ready ? '已下载' : '下载语言包'}
              </button>
              {!autoSource && modelState?.ready && (
                <button type="button" aria-label="删除语言包" disabled={modelAction === 'working'} onClick={() => setConfirmDeleteModel(true)} className="flex h-12 w-12 items-center justify-center rounded-full border border-haze disabled:opacity-35">
                  <Trash2 size={15} className="text-paper-faint" />
                </button>
              )}
            </div>
            {modelMessage && <p className={`mt-3 text-[11px] leading-relaxed ${modelAction === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>{modelMessage}</p>}
          </div>
        </div>
      ) : prefs.provider === 'bergamot' ? (
        <div className="page-x pt-5">
          <div className="mx-auto max-w-3xl rounded-2xl border border-haze bg-ink-raised p-5 shadow-[var(--shadow-lift)]">
            <div className="flex items-start gap-3">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  bergamotState?.ready && bergamotState.engineReady ? 'bg-emerald-500' : 'bg-cinnabar'
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[19px] text-paper">Bergamot 语对模型</span>
                <span className="mt-1 block text-[11.5px] text-paper-faint">{bergamotCaption}</span>
              </span>
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                disabled={
                  autoSource ||
                  !bergamotAvailable ||
                  bergamotState?.engineReady === false ||
                  modelAction === 'working' ||
                  Boolean(bergamotState?.ready)
                }
                onClick={() => void downloadBergamot()}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 text-[12.5px] text-paper disabled:opacity-35"
              >
                {modelAction === 'working' ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}
                {autoSource
                  ? '请先指定原文'
                  : bergamotState?.ready
                    ? '已下载'
                    : bergamotState?.engineReady === false
                      ? '引擎不可用'
                      : '下载语对'}
              </button>
              {!autoSource && bergamotState?.ready && (
                <button
                  type="button"
                  aria-label="删除 Bergamot 语对"
                  disabled={modelAction === 'working'}
                  onClick={() => setConfirmDeleteModel(true)}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-haze disabled:opacity-35"
                >
                  <Trash2 size={15} className="text-paper-faint" />
                </button>
              )}
            </div>
            {modelMessage && (
              <p className={`mt-3 text-[11px] leading-relaxed ${modelAction === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>
                {modelMessage}
              </p>
            )}
          </div>
        </div>
      ) : activeCloud ? (
        <div className="page-x pt-5">
          <div className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-haze bg-ink-raised p-5 shadow-[var(--shadow-lift)]">
            <Field
              label={
                prefs.provider === 'deeplx'
                  ? 'DEEPLX API URL'
                  : prefs.provider === 'openai'
                    ? 'BASE URL'
                    : 'API URL'
              }
              value={activeCloud.endpoint}
              placeholder={
                prefs.provider === 'deeplx'
                  ? 'https://你的服务/translate'
                  : prefs.provider === 'openai'
                    ? 'https://api.openai.com/v1'
                    : 'https://…'
              }
              onChange={(endpoint) => updateCloud({ endpoint })}
            />
            <Field
              label={apiKeyOptional ? '访问令牌（可选）' : 'API KEY'}
              value={activeCloud.apiKey}
              type={showKey ? 'text' : 'password'}
              placeholder={apiKeyOptional ? 'URL 已包含令牌时可留空' : '仅保存在这台设备'}
              onChange={(apiKey) => updateCloud({ apiKey })}
              suffix={
                <button type="button" aria-label={showKey ? '隐藏 API Key' : '显示 API Key'} onClick={() => setShowKey((value) => !value)} className="ml-2 p-2">
                  {showKey ? <EyeOff size={15} className="text-paper-faint" /> : <Eye size={15} className="text-paper-faint" />}
                </button>
              }
            />
            {prefs.provider === 'azure' && (
              <Field
                label="AZURE REGION（可选）"
                value={activeCloud.region ?? ''}
                placeholder="例如 eastasia"
                onChange={(region) => updateCloud({ region })}
              />
            )}
            {prefs.provider === 'openai' && (
              <>
                <Field
                  label="MODEL"
                  value={activeCloud.model ?? ''}
                  placeholder="例如 gpt-4o-mini"
                  onChange={(model) => updateCloud({ model })}
                />
                <Field
                  label="最大并发"
                  type="number"
                  min={1}
                  max={10}
                  value={String(activeCloud.concurrency ?? 2)}
                  placeholder="2"
                  onChange={(raw) => {
                    const trimmed = raw.trim()
                    if (!trimmed) {
                      updateCloud({ concurrency: 2 })
                      return
                    }
                    const n = Number(trimmed)
                    if (!Number.isFinite(n)) return
                    const truncated = Math.trunc(n)
                    if (truncated < 1 || truncated > 10) return
                    updateCloud({ concurrency: truncated })
                  }}
                />
                <button
                  type="button"
                  disabled={
                    modelListState === 'working' ||
                    !activeCloud.endpoint.trim() ||
                    !activeCloud.apiKey.trim()
                  }
                  onClick={() => void fetchOpenAiModels()}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-haze bg-ink px-4 text-[12.5px] text-paper disabled:opacity-35"
                >
                  {modelListState === 'working' ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <Download size={15} />
                  )}
                  拉取模型列表
                </button>
                {modelListMessage && (
                  <p
                    className={`text-[11px] leading-relaxed ${modelListState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}
                  >
                    {modelListMessage}
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              disabled={
                testState === 'working' ||
                !activeCloud.endpoint.trim() ||
                (!apiKeyOptional && !activeCloud.apiKey.trim()) ||
                (prefs.provider === 'openai' && !(activeCloud.model ?? '').trim())
              }
              onClick={() => void testCloud()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 text-[12.5px] text-paper disabled:opacity-35"
            >
              {testState === 'working' ? <LoaderCircle size={15} className="animate-spin" /> : <Cloud size={15} />}
              测试连接
            </button>
            {testMessage && <p className={`text-[11px] leading-relaxed ${testState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>{testMessage}</p>}
          </div>
        </div>
      ) : null}

      <OptionPickerDialog
        open={modelPickerOpen && remoteModels.length > 0}
        title="选择模型"
        value={(activeCloud?.model && remoteModels.includes(activeCloud.model)
          ? activeCloud.model
          : remoteModels[0]) as string}
        options={remoteModels.map((id) => ({ id, label: id }))}
        onCancel={() => setModelPickerOpen(false)}
        onChange={(model) => {
          updateCloud({ model })
          setModelPickerOpen(false)
        }}
      />

      <ConfirmDialog
        open={confirmDeleteModel}
        title={prefs.provider === 'bergamot' ? '删除 Bergamot 语对？' : '删除语言包？'}
        message={
          prefs.provider === 'bergamot'
            ? '删除当前语对模型后，Bergamot 离线翻译需要重新下载才能使用。'
            : '删除当前原文与译文语言包后，本地翻译需要重新下载才能使用。'
        }
        confirmLabel="删除"
        danger
        onCancel={() => setConfirmDeleteModel(false)}
        onConfirm={() => {
          setConfirmDeleteModel(false)
          if (prefs.provider === 'bergamot') void deleteBergamot()
          else void deleteModel()
        }}
      />
    </SettingsShell>
  )
}
