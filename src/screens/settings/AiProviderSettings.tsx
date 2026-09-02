import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  Languages,
  ListRestart,
  LoaderCircle,
  Plus,
  ServerCog,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { ConfirmDialog, OptionPickerDialog } from '../../components/ConfirmDialog'
import { SettingsSection } from '../../components/SettingsShell'
import {
  aiProviderById,
  createAiProviderId,
  resolveAiFeatureConfig,
  withLegacyOpenAiMirror,
  type AiFeatureId,
} from '../../features/translation/aiConfig'
import { listOpenAiModels } from '../../features/translation/openai'
import { createTranslationProvider } from '../../features/translation/providers'
import type { AiPrefs, AiProviderConfig, TranslationPrefs } from '../../features/translation/types'

interface Props {
  prefs: TranslationPrefs
  onChange: (prefs: TranslationPrefs) => void
}

type AsyncState = 'idle' | 'working' | 'success' | 'error'

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
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-paper outline-none placeholder:text-paper-faint/65"
        />
        {suffix}
      </span>
    </label>
  )
}

export function AiProviderSettings({ prefs, onChange }: Props) {
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set())
  const [pendingDeleteProviderId, setPendingDeleteProviderId] = useState<string | null>(null)
  const modelRequestRef = useRef(0)
  const [providerPicker, setProviderPicker] = useState<AiFeatureId | null>(null)
  const [modelPicker, setModelPicker] = useState<AiFeatureId | null>(null)
  const [remoteModels, setRemoteModels] = useState<string[]>([])
  const [modelListState, setModelListState] = useState<AsyncState>('idle')
  const [modelListMessage, setModelListMessage] = useState('')
  const [testState, setTestState] = useState<AsyncState>('idle')
  const [testMessage, setTestMessage] = useState('')

  const providerOptions = useMemo(
    () => prefs.ai.providers.map((provider) => ({ id: provider.id, label: provider.name })),
    [prefs.ai.providers],
  )

  const commitAi = (ai: AiPrefs) => {
    onChange(withLegacyOpenAiMirror({ ...prefs, ai }))
    setTestState('idle')
    setTestMessage('')
  }

  const updateProvider = (providerId: string, patch: Partial<AiProviderConfig>) => {
    modelRequestRef.current += 1
    commitAi({
      ...prefs.ai,
      providers: prefs.ai.providers.map((provider) =>
        provider.id === providerId ? { ...provider, ...patch } : provider,
      ),
    })
    setModelListState('idle')
    setModelListMessage('')
  }

  const addProvider = () => {
    const id = createAiProviderId(prefs.ai.providers.map((provider) => provider.id))
    commitAi({
      ...prefs.ai,
      providers: [
        ...prefs.ai.providers,
        { id, name: `AI 提供商 ${prefs.ai.providers.length + 1}`, endpoint: '', apiKey: '' },
      ],
    })
  }

  const deleteProvider = (providerId: string) => {
    if (prefs.ai.providers.length <= 1) return
    modelRequestRef.current += 1
    const providers = prefs.ai.providers.filter((provider) => provider.id !== providerId)
    const fallbackId = providers[0].id
    commitAi({
      providers,
      translation:
        prefs.ai.translation.providerId === providerId
          ? { ...prefs.ai.translation, providerId: fallbackId, model: '' }
          : prefs.ai.translation,
      speedRead:
        prefs.ai.speedRead.providerId === providerId
          ? { ...prefs.ai.speedRead, providerId: fallbackId, model: '' }
          : prefs.ai.speedRead,
    })
  }

  const updateFeature = (
    feature: AiFeatureId,
    patch: { providerId?: string; model?: string; concurrency?: number },
  ) => {
    if (feature === 'translation') {
      commitAi({
        ...prefs.ai,
        translation: { ...prefs.ai.translation, ...patch },
      })
      return
    }
    commitAi({
      ...prefs.ai,
      speedRead: {
        ...prefs.ai.speedRead,
        ...(patch.providerId !== undefined ? { providerId: patch.providerId } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
      },
    })
  }

  const fetchModels = async (feature: AiFeatureId) => {
    const requestId = ++modelRequestRef.current
    setModelListState('working')
    setModelListMessage('正在拉取模型列表…')
    setRemoteModels([])
    try {
      const models = await listOpenAiModels(resolveAiFeatureConfig(prefs, feature))
      if (requestId !== modelRequestRef.current) return
      setRemoteModels(models)
      setModelPicker(feature)
      setModelListState('success')
      setModelListMessage(models.length ? `已获取 ${models.length} 个模型` : '模型列表为空，可直接填写 Model')
    } catch (error) {
      if (requestId !== modelRequestRef.current) return
      setModelListState('error')
      setModelListMessage(error instanceof Error ? error.message : '拉取模型失败')
    }
  }

  const testAiTranslation = async () => {
    setTestState('working')
    setTestMessage('正在连接…')
    try {
      const provider = createTranslationProvider('openai', resolveAiFeatureConfig(prefs, 'translation'))
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

  const features = [
    {
      id: 'translation' as const,
      title: 'AI 翻译',
      caption: '正文与信息流翻译使用；与 AI 速读的模型互不影响',
      icon: Languages,
    },
    {
      id: 'speedRead' as const,
      title: 'AI 速读',
      caption: '文章重点提炼使用；可选择另一家提供商和独立模型',
      icon: Sparkles,
    },
  ]

  const activePickerSelection = providerPicker ? prefs.ai[providerPicker] : null
  const modelSelection = modelPicker ? prefs.ai[modelPicker] : null

  return (
    <>
      <SettingsSection title="AI 提供商">
        <div className="page-x space-y-3 border-y border-haze bg-ink py-4">
          <div className="flex items-start gap-3 rounded-2xl border border-haze bg-ink-raised/55 p-3.5">
            <ServerCog size={17} strokeWidth={1.6} className="mt-0.5 shrink-0 text-cinnabar-soft" />
            <p className="text-[11.5px] leading-relaxed text-paper-faint">
              可添加多个 OpenAI 兼容提供商。名称、Base URL 与 Key 属于提供商；具体 Model 由下方每项 AI 功能单独选择。
            </p>
          </div>

          {prefs.ai.providers.map((provider, index) => {
            const showKey = visibleKeys.has(provider.id)
            return (
              <div key={provider.id} className="space-y-3 rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-haze bg-paper/5 text-paper-muted">
                    <Bot size={17} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[14px] text-paper">{provider.name || `AI 提供商 ${index + 1}`}</span>
                    <span className="mt-0.5 block truncate font-mono text-[9.5px] text-paper-faint">{provider.endpoint || '尚未填写 Base URL'}</span>
                  </div>
                  <button
                    type="button"
                    disabled={prefs.ai.providers.length <= 1}
                    aria-label={`删除 ${provider.name || `AI 提供商 ${index + 1}`}`}
                    onClick={() => setPendingDeleteProviderId(provider.id)}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-haze text-paper-faint transition-colors hover:border-cinnabar/40 hover:text-cinnabar-soft disabled:opacity-25"
                  >
                    <Trash2 size={15} strokeWidth={1.7} />
                  </button>
                </div>
                <Field
                  label="名称"
                  value={provider.name}
                  placeholder="例如 OpenAI、DeepSeek、自建网关"
                  onChange={(name) => updateProvider(provider.id, { name })}
                />
                <Field
                  label="BASE URL"
                  value={provider.endpoint}
                  placeholder="https://api.example.com/v1"
                  onChange={(endpoint) => updateProvider(provider.id, { endpoint })}
                />
                <Field
                  label="API KEY"
                  value={provider.apiKey}
                  type={showKey ? 'text' : 'password'}
                  placeholder="仅密钥使用安全存储与加密同步"
                  onChange={(apiKey) => updateProvider(provider.id, { apiKey })}
                  suffix={
                    <button
                      type="button"
                      aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                      onClick={() => {
                        setVisibleKeys((current) => {
                          const next = new Set(current)
                          if (next.has(provider.id)) next.delete(provider.id)
                          else next.add(provider.id)
                          return next
                        })
                      }}
                      className="ml-2 p-2"
                    >
                      {showKey ? <EyeOff size={15} className="text-paper-faint" /> : <Eye size={15} className="text-paper-faint" />}
                    </button>
                  }
                />
              </div>
            )
          })}

          <button
            type="button"
            onClick={addProvider}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-haze bg-ink-raised/55 px-4 text-[12px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper"
          >
            <Plus size={14} strokeWidth={1.8} />
            添加 AI 提供商
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title="AI 功能模型">
        <div className="page-x space-y-3 border-y border-haze bg-ink py-4">
          {features.map((feature) => {
            const Icon = feature.icon
            const selection = prefs.ai[feature.id]
            const provider = aiProviderById(prefs.ai, selection.providerId)
            const fetching = modelListState === 'working' && modelPicker === feature.id
            return (
              <div key={feature.id} className="space-y-3 rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-cinnabar/35 bg-cinnabar/10 text-cinnabar-soft">
                    <Icon size={17} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block text-[14px] text-paper">{feature.title}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-relaxed text-paper-faint">{feature.caption}</span>
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block font-mono text-[10px] tracking-[0.12em] text-paper-faint">AI 提供商</span>
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={providerPicker === feature.id}
                    onClick={() => setProviderPicker(feature.id)}
                    className="flex h-12 w-full items-center gap-2 rounded-xl border border-haze bg-ink px-3.5 text-left transition-colors hover:border-cinnabar/40"
                  >
                    <ServerCog size={15} strokeWidth={1.6} className="shrink-0 text-paper-faint" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-paper">{provider.name}</span>
                    <ChevronDown size={15} strokeWidth={1.8} className="shrink-0 text-paper-faint" />
                  </button>
                </div>

                <Field
                  label="MODEL"
                  value={selection.model}
                  placeholder="例如 gpt-4.1-mini"
                  onChange={(model) => updateFeature(feature.id, { model })}
                />

                {feature.id === 'translation' && (
                  <Field
                    label="最大并发"
                    type="number"
                    min={1}
                    max={10}
                    value={String(prefs.ai.translation.concurrency)}
                    onChange={(raw) => {
                      const value = Number(raw)
                      if (!Number.isInteger(value) || value < 1 || value > 10) return
                      updateFeature('translation', { concurrency: value })
                    }}
                  />
                )}

                <button
                  type="button"
                  disabled={modelListState === 'working' || !provider.endpoint.trim() || !provider.apiKey.trim()}
                  onClick={() => {
                    setModelPicker(feature.id)
                    void fetchModels(feature.id)
                  }}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-haze bg-ink px-4 text-[12px] text-paper-muted disabled:opacity-35"
                >
                  {fetching ? <LoaderCircle size={14} className="animate-spin" /> : <ListRestart size={14} />}
                  拉取模型列表
                </button>

                {modelListMessage && modelPicker === feature.id && (
                  <p className={`text-[11px] leading-relaxed ${modelListState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>
                    {modelListMessage}
                  </p>
                )}

                {feature.id === 'translation' && (
                  <>
                    <button
                      type="button"
                      disabled={testState === 'working' || !provider.endpoint.trim() || !provider.apiKey.trim() || !selection.model.trim()}
                      onClick={() => void testAiTranslation()}
                      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-4 text-[12px] text-paper disabled:opacity-35"
                    >
                      {testState === 'working' ? <LoaderCircle size={14} className="animate-spin" /> : <Languages size={14} />}
                      测试 AI 翻译
                    </button>
                    {testMessage && (
                      <p className={`text-[11px] leading-relaxed ${testState === 'error' ? 'text-cinnabar-soft' : 'text-paper-faint'}`}>
                        {testMessage}
                      </p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </SettingsSection>

      <OptionPickerDialog
        open={Boolean(providerPicker && activePickerSelection)}
        title={providerPicker === 'speedRead' ? 'AI 速读提供商' : 'AI 翻译提供商'}
        value={activePickerSelection?.providerId ?? prefs.ai.providers[0].id}
        options={providerOptions}
        onCancel={() => setProviderPicker(null)}
        onChange={(providerId) => {
          if (!providerPicker) return
          modelRequestRef.current += 1
          updateFeature(providerPicker, { providerId, model: '' })
          setProviderPicker(null)
          setModelListState('idle')
          setModelListMessage('')
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeleteProviderId)}
        title="删除 AI 提供商？"
        message={
          pendingDeleteProviderId
            ? `将删除“${prefs.ai.providers.find((provider) => provider.id === pendingDeleteProviderId)?.name ?? 'AI 提供商'}”及其 API Key。使用它的功能会自动切换到首个剩余提供商并清空模型选择。`
            : ''
        }
        confirmLabel="删除"
        danger
        onCancel={() => setPendingDeleteProviderId(null)}
        onConfirm={() => {
          if (pendingDeleteProviderId) deleteProvider(pendingDeleteProviderId)
          setPendingDeleteProviderId(null)
        }}
      />

      <OptionPickerDialog
        open={Boolean(modelPicker && remoteModels.length)}
        title={modelPicker === 'speedRead' ? '选择 AI 速读模型' : '选择 AI 翻译模型'}
        value={modelSelection?.model && remoteModels.includes(modelSelection.model) ? modelSelection.model : remoteModels[0] ?? ''}
        options={remoteModels.map((model) => ({ id: model, label: model }))}
        onCancel={() => {
          setModelPicker(null)
          setRemoteModels([])
        }}
        onChange={(model) => {
          if (!modelPicker) return
          updateFeature(modelPicker, { model })
          setModelPicker(null)
          setRemoteModels([])
        }}
      />
    </>
  )
}
