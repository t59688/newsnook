import { SegmentedControl } from '../../components/SegmentedControl'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import {
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  PARAGRAPH_GAP_OPTIONS,
  type FontFamilyId,
  type Preferences,
  type TypographyPrefs,
} from '../../sources/preferences'

interface Props {
  prefs: Preferences
  onChange: (patch: Partial<TypographyPrefs>) => void
  onReset: () => void
  onBack: () => void
}

const PREVIEW_PARAGRAPHS = [
  '夜读讲究一个静字。灯下翻页，字要立得住，行要走得开，眼睛才不至于在半页之间就先累了。',
  '字距疏密、行距开合，都在下面几项里，调到看着顺眼为止。',
]

export function TypographyScreen({ prefs, onChange, onReset, onBack }: Props) {
  const { fontScale, lineHeight, paragraphGap, fontFamily, firstLineIndent } = prefs.typography
  const activeFamily = FONT_FAMILY_OPTIONS.find((option) => option.id === fontFamily)
  const activeScale = FONT_SCALE_OPTIONS.find((option) => option.value === fontScale)

  return (
    <SettingsShell
      title="阅读字体"
      caption={`${activeFamily?.label ?? '黑体'} · ${activeScale?.label ?? '自定义'} · 行高 ${lineHeight}${
        firstLineIndent ? ' · 首行缩进' : ''
      }`}
      onBack={onBack}
      action={
        <button
          type="button"
          onClick={onReset}
          className="shrink-0 rounded-full border border-haze px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-paper-muted"
        >
          恢复默认
        </button>
      }
    >
      <div className="page-x pt-5">
        <div className="mx-auto max-w-3xl rounded-2xl border border-haze bg-ink-raised/60 px-5 py-5">
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
            <span className="h-px w-5 bg-cinnabar" aria-hidden />
            预览
          </p>
          <h2 className="reader-title mt-3 text-paper">有所闻</h2>
          <div className="reader-prose mt-3" data-article-lang="zh">
            {PREVIEW_PARAGRAPHS.map((text) => (
              <p key={text} data-cjk="true">{text}</p>
            ))}
          </div>
        </div>
      </div>

      <SettingsSection title="字号">
        <div className="page-x">
          <SegmentedControl
            label="正文字号"
            options={FONT_SCALE_OPTIONS}
            value={fontScale}
            onChange={(value) => onChange({ fontScale: value })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="字体">
        <div className="page-x">
          <SegmentedControl
            label="阅读字体"
            options={FONT_FAMILY_OPTIONS.map((option) => ({
              label: option.label,
              value: option.id,
            }))}
            value={fontFamily}
            onChange={(value) => onChange({ fontFamily: value as FontFamilyId })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="行高">
        <div className="page-x">
          <SegmentedControl
            label="正文行高"
            options={LINE_HEIGHT_OPTIONS}
            value={lineHeight}
            onChange={(value) => onChange({ lineHeight: value })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="段落间距">
        <div className="page-x">
          <SegmentedControl
            label="段落间距"
            options={PARAGRAPH_GAP_OPTIONS}
            value={paragraphGap}
            onChange={(value) => onChange({ paragraphGap: value })}
          />
        </div>
      </SettingsSection>

      <SettingsSection title="段落">
        <div className="page-x flex items-center gap-3 border-y border-haze py-4">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] text-paper">首行缩进</span>
            <span className="mt-0.5 block font-mono text-[10px] text-paper-faint">
              中文段落空两字；英文与列表顶格
            </span>
          </span>
          <ToggleSwitch
            checked={firstLineIndent}
            label={firstLineIndent ? '关闭首行缩进' : '开启首行缩进'}
            onChange={() => onChange({ firstLineIndent: !firstLineIndent })}
          />
        </div>
      </SettingsSection>
    </SettingsShell>
  )
}
