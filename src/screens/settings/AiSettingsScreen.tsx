import { useMemo } from 'react'

import { SettingsShell } from '../../components/SettingsShell'
import { aiProviderById } from '../../features/translation/aiConfig'
import type { TranslationPrefs } from '../../features/translation/types'
import { AiProviderSettings } from './AiProviderSettings'

interface Props {
  prefs: TranslationPrefs
  onChange: (prefs: TranslationPrefs) => void
  onBack: () => void
}

export function AiSettingsScreen({ prefs, onChange, onBack }: Props) {
  const caption = useMemo(() => {
    const { providers, translation, speedRead } = prefs.ai
    const translationProvider = aiProviderById(prefs.ai, translation.providerId)
    const speedReadProvider = aiProviderById(prefs.ai, speedRead.providerId)
    const translationModel = translation.model.trim() || '未选模型'
    const speedReadModel = speedRead.model.trim() || '未选模型'
    return `${providers.length} 个提供商 · 翻译 ${translationProvider.name}/${translationModel} · 速读 ${speedReadProvider.name}/${speedReadModel}`
  }, [prefs.ai])

  return (
    <SettingsShell title="AI" caption={caption} onBack={onBack}>
      <AiProviderSettings prefs={prefs} onChange={onChange} />
    </SettingsShell>
  )
}
