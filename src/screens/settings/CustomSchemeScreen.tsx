import { useEffect, useId, useMemo, useState } from 'react'
import { RotateCcw, Wand2 } from 'lucide-react'

import { SegmentedControl } from '../../components/SegmentedControl'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import {
  DEFAULT_CUSTOM_SCHEME,
  contrastRatio,
  deriveSchemeTokens,
  ensureAccentContrast,
  isHexColor,
  normalizeHexColor,
  relativeLuminance,
  type CustomSchemeColors,
  type CustomSchemePrefs,
} from '../../lib/customScheme'
import type { ResolvedTheme } from '../../lib/theme'

interface Props {
  customScheme: CustomSchemePrefs
  resolved: ResolvedTheme
  onChange: (mode: ResolvedTheme, colors: CustomSchemeColors) => void
  onBack: () => void
}

/** 底色候选：昼读一档给浅底，夜读一档给深底 */
const SURFACE_SWATCHES: Record<ResolvedTheme, string[]> = {
  light: ['#f6f2e9', '#f5f5f2', '#eceae1', '#e6ebe8', '#f0eee2', '#f2e9e4', '#e9eef3', '#efe9d8'],
  dark: ['#0e0f12', '#10151c', '#121711', '#1a1512', '#15131a', '#0f1713', '#1c1c1c', '#101820'],
}

/** 强调色候选：昼读偏深保对比，夜读偏亮 */
const ACCENT_SWATCHES: Record<ResolvedTheme, string[]> = {
  light: ['#b43d26', '#1d4e89', '#3e6663', '#a34e1b', '#6b4e9e', '#2f6b4f', '#9e7b1f', '#8c2f3e'],
  dark: ['#d98474', '#7ea8dd', '#8fb3ae', '#dd8f52', '#9a7ed0', '#6faf8c', '#d9b45a', '#d96b7e'],
}

interface ColorFieldProps {
  name: string
  title: string
  caption: string
  value: string
  swatches: string[]
  onChange: (hex: string) => void
}

/** 单个色槽：预选色板 + 原生取色器 + hex 输入；外部改动（重置/自动修正）同步草稿 */
function ColorField({ name, title, caption, value, swatches, onChange }: ColorFieldProps) {
  const fieldId = useId()
  const pickerId = `${fieldId}-picker`
  const inputId = `${fieldId}-hex`
  const errorId = `${fieldId}-error`
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const draftValid = isHexColor(draft)

  const applyDraft = (raw: string) => {
    setDraft(raw)
    const normalized = normalizeHexColor(raw)
    if (normalized) onChange(normalized)
  }

  return (
    <div className="page-x">
      <div className="rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={inputId} className="font-display text-[15px] font-medium text-paper">
            {title}
          </label>
          <span className="font-mono text-[10px] tracking-[0.12em] text-paper-faint">{caption}</span>
        </div>

        <div className="mt-3 grid grid-cols-8 gap-2">
          {swatches.map((hex) => {
            const active = value === hex
            return (
              <button
                key={hex}
                type="button"
                aria-label={`选择 ${hex}`}
                aria-pressed={active}
                onClick={() => applyDraft(hex)}
                className={`aspect-square rounded-lg border transition-transform duration-150 hover:scale-105 ${
                  active ? 'scale-110 border-cinnabar' : 'border-black/15'
                }`}
                style={{ backgroundColor: hex }}
              />
            )
          })}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <label htmlFor={pickerId} className="sr-only">
            {title}取色器
          </label>
          <input
            id={pickerId}
            name={`${name}-picker`}
            type="color"
            aria-label={`${title}取色器`}
            value={value}
            onChange={(event) => applyDraft(event.target.value)}
            autoComplete="off"
            className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-haze bg-ink p-1 transition-colors hover:border-cinnabar/60"
          />
          <input
            id={inputId}
            name={name}
            type="text"
            aria-label={`${title}十六进制色值`}
            aria-invalid={!draftValid}
            aria-describedby={!draftValid ? errorId : undefined}
            value={draft}
            onChange={(event) => applyDraft(event.target.value)}
            autoComplete="off"
            inputMode="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="#000000"
            className={`min-w-0 flex-1 rounded-lg border bg-ink px-3 py-2 font-mono text-[13px] text-paper transition-colors focus-visible:border-cinnabar/70 ${
              draftValid ? 'border-haze' : 'border-cinnabar/60'
            }`}
          />
        </div>
        {!draftValid && (
          <p
            id={errorId}
            role="status"
            aria-live="polite"
            className="mt-2 text-[11px] leading-relaxed text-cinnabar-soft"
          >
            请输入 3 位或 6 位十六进制色值，例如 #b43d26。
          </p>
        )}
      </div>
    </div>
  )
}

export function CustomSchemeScreen({ customScheme, resolved, onChange, onBack }: Props) {
  const [mode, setMode] = useState<ResolvedTheme>(resolved)
  const colors = customScheme[mode]
  const tokens = useMemo(() => deriveSchemeTokens(colors, mode), [colors, mode])

  const accentRatio = contrastRatio(colors.accent, colors.ink)
  const accentWeak = accentRatio < 3.2
  // 把深底选进昼读档（或反过来）时给个温和提示；推导层仍有可读性兜底
  const surfaceOffMode =
    (mode === 'light' && relativeLuminance(colors.ink) < 0.3) ||
    (mode === 'dark' && relativeLuminance(colors.ink) > 0.55)

  const patch = (colors_: Partial<CustomSchemeColors>) =>
    onChange(mode, { ...colors, ...colors_ })

  return (
    <SettingsShell title="自定义配色" caption="只选底色与强调色，文字与层次自动按对比度生成" onBack={onBack}>
      <div className="page-x pt-5">
        <SegmentedControl
          label="编辑档位"
          options={[
            { label: '昼读（浅色）', value: 'light' },
            { label: '夜读（深色）', value: 'dark' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>

      {/* 实时预览：全部用推导 token 内联取色，不依赖当前生效主题 */}
      <div className="page-x pt-4">
        <div
          className="mx-auto max-w-3xl overflow-hidden rounded-2xl border"
          style={{ backgroundColor: tokens['--tone-ink'], borderColor: tokens['--tone-haze'] }}
        >
          <div className="px-5 pt-5 pb-4" style={{ backgroundColor: tokens['--tone-ink-raised'] }}>
            <p
              className="font-mono text-[10px] tracking-[0.16em]"
              style={{ color: tokens['--tone-cinnabar-soft'] }}
            >
              预览 · {mode === 'light' ? '昼读' : '夜读'}
            </p>
            <h2
              className="mt-3 font-display text-[22px] leading-snug"
              style={{ color: tokens['--tone-paper'] }}
            >
              有所闻
            </h2>
            <p className="mt-2 text-[13px] leading-[1.85]" style={{ color: tokens['--tone-body-text'] }}>
              灯下翻页，字要立得住，行要走得开。
            </p>
          </div>
          <div className="h-px w-full" style={{ backgroundColor: tokens['--tone-haze'] }} />
          <div className="flex items-center gap-2 px-5 py-3">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: tokens['--tone-cinnabar'] }}
              aria-hidden
            />
            <span className="text-[12px]" style={{ color: tokens['--tone-paper-muted'] }}>
              链接与标记
            </span>
          </div>
        </div>
        {surfaceOffMode && (
          <p className="mx-auto mt-2 max-w-3xl text-[11.5px] leading-relaxed text-paper-faint">
            这个底色看起来{mode === 'light' ? '偏深，更像夜读' : '偏浅，更像昼读'}；文字会自动兜底保持可读。
          </p>
        )}
      </div>

      <SettingsSection title="底色">
        <ColorField
          key={`${mode}-surface`}
          name="custom-scheme-surface"
          title="页面底色"
          caption="浮层与文字自动推导"
          value={colors.ink}
          swatches={SURFACE_SWATCHES[mode]}
          onChange={(ink) => patch({ ink })}
        />
      </SettingsSection>

      <SettingsSection title="强调色">
        <ColorField
          key={`${mode}-accent`}
          name="custom-scheme-accent"
          title="链接与标记"
          caption="用于链接、选中与按钮"
          value={colors.accent}
          swatches={ACCENT_SWATCHES[mode]}
          onChange={(accent) => patch({ accent })}
        />
        {accentWeak && (
          <div className="page-x mt-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-cinnabar/40 bg-cinnabar/8 px-4 py-3">
              <p className="text-[12px] leading-relaxed text-paper-muted">
                强调色与底色对比度 {accentRatio.toFixed(1)}:1 偏低，链接可能看不清。
              </p>
              <button
                type="button"
                onClick={() =>
                  patch({
                    accent: ensureAccentContrast(colors.ink, colors.accent).accent,
                  })
                }
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-cinnabar/50 bg-cinnabar/12 px-3 py-1.5 font-mono text-[11px] text-cinnabar-soft transition-colors hover:border-cinnabar/70 hover:bg-cinnabar/18"
              >
                <Wand2 size={13} strokeWidth={1.8} aria-hidden />
                自动修正
              </button>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="重置">
        <div className="page-x">
          <button
            type="button"
            onClick={() => onChange(mode, { ...DEFAULT_CUSTOM_SCHEME[mode] })}
            className="flex items-center gap-2 rounded-full border border-haze px-3.5 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:border-cinnabar/50 hover:text-paper"
          >
            <RotateCcw size={13} strokeWidth={1.8} aria-hidden />
            本档恢复墨问配色
          </button>
        </div>
      </SettingsSection>
    </SettingsShell>
  )
}
