import { useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Moon, Palette, Sliders, Sparkles, Sun } from 'lucide-react'
import { SCHEMES, type SchemeKey } from '../../lib/demo'
import { deriveSchemeTokens, contrastRatio } from '../../lib/customScheme'
import { PhoneFrame } from './PhoneFrame'
import { FeedDemo } from './FeedDemo'

/* 外观 —— 复刻 AppearanceScreen：
 * 1. 六套官方精心打磨的双态方案（墨问、竹青、群青、赤霞、紫宸、不二）；
 * 2. 真实数学推导的「自定义配色引擎」（只需两色，自动推导全套 WCAG 达标色彩）。 */
export function AppearanceDemo() {
  const reduced = useReducedMotion()
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets')
  const [scheme, setScheme] = useState<SchemeKey>('ink')
  const [mode, setMode] = useState<'light' | 'dark'>('dark')
  const [glow, setGlow] = useState(false)
  const glowTimer = useRef<number | undefined>(undefined)

  // 自定义配色状态
  const [customInk, setCustomInk] = useState('#0d1b2a')
  const [customAccent, setCustomAccent] = useState('#00b4d8')

  const apply = (fn: () => void) => {
    fn()
    if (reduced) return
    setGlow(true)
    window.clearTimeout(glowTimer.current)
    glowTimer.current = window.setTimeout(() => setGlow(false), 260)
  }

  // 计算自定义配色的实时 WCAG 对比度
  const customTokens = deriveSchemeTokens({ ink: customInk, accent: customAccent }, mode)
  const paperColor = customTokens['--tone-paper'] || '#eae4d8'
  const textContrast = contrastRatio(paperColor, customInk).toFixed(1)
  const accentContrast = contrastRatio(customTokens['--tone-cinnabar'], customInk).toFixed(1)

  const inlineCustomStyle =
    activeTab === 'custom'
      ? (customTokens as unknown as React.CSSProperties)
      : undefined

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px] lg:items-center">
      {/* 实时生效的手机预览 */}
      <div
        data-scheme={activeTab === 'presets' ? scheme : undefined}
        data-theme={mode}
        style={inlineCustomStyle}
        className={`mx-auto w-full max-w-[270px] ${glow ? 'theme-switching' : ''}`}
      >
        <PhoneFrame className="h-[520px]" time="07:12">
          <FeedDemo interactive={false} />
        </PhoneFrame>
      </div>

      <div className="space-y-4">
        {/* 顶部控制栏：昼夜切换 + 模式分段器 */}
        <div className="flex gap-2">
          <div className="flex flex-1 rounded-xl border border-haze bg-ink-raised/50 p-1">
            {(
              [
                { key: 'light', label: '昼读', Icon: Sun },
                { key: 'dark', label: '夜读', Icon: Moon },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={mode === key}
                onClick={() => apply(() => setMode(key))}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-medium transition-colors duration-200 ${
                  mode === key
                    ? 'border border-cinnabar/30 bg-cinnabar/20 text-paper font-semibold'
                    : 'text-paper-faint hover:text-paper-muted'
                }`}
              >
                <Icon size={13} strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded-xl border border-haze bg-ink-raised/50 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-colors ${
                activeTab === 'presets' ? 'bg-paper text-ink font-bold' : 'text-paper-muted'
              }`}
            >
              <Palette size={12} />
              官方方案
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('custom')}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-colors ${
                activeTab === 'custom' ? 'bg-paper text-ink font-bold' : 'text-paper-muted'
              }`}
            >
              <Sliders size={12} />
              自定义推导
            </button>
          </div>
        </div>

        {activeTab === 'presets' ? (
          <motion.div
            className="grid grid-cols-2 gap-2"
            initial={reduced ? undefined : 'hidden'}
            whileInView={reduced ? undefined : 'show'}
            viewport={{ once: true, margin: '-8% 0px' }}
            transition={{ staggerChildren: 0.04, delayChildren: 0.08 }}
          >
            {SCHEMES.map((s) => {
              const checked = s.key === scheme
              return (
                <motion.button
                  key={s.key}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => apply(() => setScheme(s.key))}
                  variants={
                    reduced
                      ? undefined
                      : {
                          hidden: { opacity: 0, scale: 0.94 },
                          show: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
                        }
                  }
                  className={`flex flex-col gap-1.5 rounded-2xl border p-2.5 text-left transition-colors ${
                    checked
                      ? 'border-cinnabar/70 bg-ink-raised shadow-sm'
                      : 'border-haze bg-ink-raised/40 hover:border-paper-faint/40'
                  }`}
                >
                  <span className="flex h-8 overflow-hidden rounded-lg border border-haze/60">
                    <span className="flex flex-1 flex-col justify-between p-1" style={{ background: s.light.ink }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.light.accent }} />
                      <span className="h-px w-full" style={{ background: `${s.light.paper}33` }} />
                    </span>
                    <span className="flex flex-1 flex-col justify-between p-1" style={{ background: s.dark.ink }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dark.accent }} />
                      <span className="h-px w-full" style={{ background: `${s.dark.paper}33` }} />
                    </span>
                  </span>
                  <span>
                    <span className="block font-display text-[13px] text-paper">{s.name}</span>
                    <span className="block truncate font-mono text-[9px] tracking-[0.06em] text-paper-muted">
                      {s.caption.split(' · ')[0]}
                    </span>
                  </span>
                </motion.button>
              )
            })}
          </motion.div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-haze bg-ink-raised/50 p-4">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-cinnabar-soft">
              <Sparkles size={12} />
              <span>WCAG 对比度算法全自动推导</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="font-mono text-[10px] text-paper-muted">底色 (Ink)</span>
                <div className="flex items-center gap-2 rounded-xl border border-haze bg-ink p-1.5">
                  <input
                    type="color"
                    value={customInk}
                    onChange={(e) => setCustomInk(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                  />
                  <span className="font-mono text-[11px] text-paper">{customInk}</span>
                </div>
              </label>

              <label className="block space-y-1">
                <span className="font-mono text-[10px] text-paper-muted">强调色 (Accent)</span>
                <div className="flex items-center gap-2 rounded-xl border border-haze bg-ink p-1.5">
                  <input
                    type="color"
                    value={customAccent}
                    onChange={(e) => setCustomAccent(e.target.value)}
                    className="h-6 w-6 cursor-pointer rounded border-0 bg-transparent"
                  />
                  <span className="font-mono text-[11px] text-paper">{customAccent}</span>
                </div>
              </label>
            </div>

            <div className="rounded-xl border border-haze/60 bg-ink/60 p-2.5 font-mono text-[10px] space-y-1 text-paper-muted">
              <div className="flex justify-between">
                <span>正文字对比度:</span>
                <span className="text-paper font-semibold">{textContrast}:1 (≥7.0 AAA)</span>
              </div>
              <div className="flex justify-between">
                <span>强调色对比度:</span>
                <span className="text-paper font-semibold">{accentContrast}:1 (≥3.2 达标)</span>
              </div>
              <div className="text-[9px] text-paper-faint pt-1 border-t border-haze/40">
                自动派生: --tone-ink-raised, --tone-paper-muted, --tone-haze...
              </div>
            </div>
          </div>
        )}

        <p className="font-mono text-[10.5px] leading-relaxed text-paper-muted">
          点方案卡或调节颜色，左屏以 240ms 过渡换色——整页元素沿同一条路过渡。
        </p>
      </div>
    </div>
  )
}
