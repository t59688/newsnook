import { useState, useRef } from 'react'
import {
  ArrowLeft,
  Check,
  Contrast,
  Moon,
  Sun,
} from 'lucide-react'
import { SCHEMES, type SchemeKey } from '../../lib/demo'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

/* 外观与排版真机界面 —— 严格复刻 src/screens/settings/AppearanceScreen.tsx & TypographyScreen.tsx：
 * 头部返回导航 + 昼/夜/系统/墨水屏四色模式切换卡 +
 * 6 套纸质传统色方案色板 + 字号/行距排版滑块 + 实时正文样张卡片。 */
export function AppearanceScreenDemo() {
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'eink'>('dark')
  const [scheme, setScheme] = useState<SchemeKey>('ink')
  const [scale, setScale] = useState(1.0)
  const [lineHeight, setLineHeight] = useState(1.85)
  const [serif, setSerif] = useState(true)
  const [switching, setSwitching] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  const triggerTheme = (mode: 'light' | 'dark' | 'eink') => {
    setSwitching(true)
    setThemeMode(mode)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setSwitching(false), 240)
  }

  const curScheme = SCHEMES.find((s) => s.key === scheme) || SCHEMES[0]

  return (
    <div
      data-theme={themeMode === 'eink' ? 'light' : themeMode}
      data-scheme={scheme}
      data-eink={themeMode === 'eink' ? 'true' : undefined}
      className={`relative flex h-full flex-col bg-ink text-paper select-none transition-colors duration-200 ${
        switching ? 'theme-switching' : ''
      }`}
    >
      {/* 沉浸式顶栏 */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
            <span className="font-display text-[14px] font-semibold text-paper">
              外观与排版
            </span>
          </div>
          <span className="rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
            墨问 · 群青 · 不二
          </span>
        </div>
      </header>

      {/* 滚动视口 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3">
        {/* 主题模式切换卡片 (跟随系统 / 昼读 / 夜读 / 墨水屏) */}
        <div className="space-y-1.5">
          <div className="font-mono text-[10px] text-paper-faint px-0.5">主题模式：</div>
          <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
            <button
              type="button"
              onClick={() => triggerTheme('light')}
              className={`flex items-center justify-center gap-1 rounded-xl border p-2 transition-all ${
                themeMode === 'light'
                  ? 'border-cinnabar bg-cinnabar/15 text-cinnabar-soft font-bold shadow-xs'
                  : 'border-haze bg-ink-raised/50 text-paper-muted hover:bg-ink-raised'
              }`}
            >
              <Sun size={12} />
              <span>浅色日读</span>
            </button>
            <button
              type="button"
              onClick={() => triggerTheme('dark')}
              className={`flex items-center justify-center gap-1 rounded-xl border p-2 transition-all ${
                themeMode === 'dark'
                  ? 'border-cinnabar bg-cinnabar/15 text-cinnabar-soft font-bold shadow-xs'
                  : 'border-haze bg-ink-raised/50 text-paper-muted hover:bg-ink-raised'
              }`}
            >
              <Moon size={12} />
              <span>深色夜读</span>
            </button>
            <button
              type="button"
              onClick={() => triggerTheme('eink')}
              className={`flex items-center justify-center gap-1 rounded-xl border p-2 transition-all ${
                themeMode === 'eink'
                  ? 'border-cinnabar bg-cinnabar/15 text-cinnabar-soft font-bold shadow-xs'
                  : 'border-haze bg-ink-raised/50 text-paper-muted hover:bg-ink-raised'
              }`}
            >
              <Contrast size={12} />
              <span>纯黑白墨水屏</span>
            </button>
          </div>
        </div>

        {/* 6 套纸质配色方案卡片 */}
        <div className="space-y-1.5">
          <div className="font-mono text-[10px] text-paper-faint px-0.5">纸色方案：</div>
          <div className="grid grid-cols-3 gap-2">
            {SCHEMES.map((s) => {
              const active = s.key === scheme
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScheme(s.key)}
                  className={`flex flex-col justify-between rounded-xl border p-2 text-left transition-all ${
                    active
                      ? 'border-cinnabar bg-cinnabar/15 shadow-xs'
                      : 'border-haze bg-ink-raised/50 hover:bg-ink-raised'
                  }`}
                >
                  <div className="flex items-center justify-between pb-1">
                    <span className={`text-[11px] font-display ${active ? 'font-bold text-paper' : 'text-paper-muted'}`}>
                      {s.name}
                    </span>
                    {active && <Check size={10} className="text-cinnabar-soft" strokeWidth={3} />}
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className="h-3 w-3 rounded-full border border-black/20"
                      style={{ background: s.light.ink }}
                    />
                    <span
                      className="h-3 w-3 rounded-full border border-black/20"
                      style={{ background: s.light.accent }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* 排版与排印参数微调 */}
        <div className="rounded-xl border border-haze bg-ink-raised/50 p-3 space-y-2.5 font-mono text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-paper-muted">字号缩放 ({(15 * scale).toFixed(0)}px):</span>
            <input
              type="range"
              min={0.85}
              max={1.3}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-28 cursor-pointer accent-cinnabar"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-paper-muted">阅读行距 ({lineHeight.toFixed(2)}):</span>
            <input
              type="range"
              min={1.6}
              max={2.2}
              step={0.1}
              value={lineHeight}
              onChange={(e) => setLineHeight(Number(e.target.value))}
              className="w-28 cursor-pointer accent-cinnabar"
            />
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-haze/40">
            <span className="text-paper-muted">正文字体家族：</span>
            <button
              type="button"
              onClick={() => setSerif(!serif)}
              className="rounded-full border border-haze px-2.5 py-0.5 text-paper hover:border-cinnabar/60"
            >
              {serif ? '思源宋体 (衬线)' : '苹方/思源黑体 (无衬线)'}
            </button>
          </div>
        </div>

        {/* 实时排版渲染样张 */}
        <div className="rounded-xl border border-haze/80 bg-ink-raised/40 p-3.5 space-y-1.5">
          <div className="font-mono text-[9px] text-cinnabar-soft font-semibold flex items-center justify-between">
            <span>{curScheme.name} · 排印效果预览</span>
            <span className="text-paper-faint">{curScheme.caption}</span>
          </div>
          <h2
            className="font-display font-bold text-paper"
            style={{ fontSize: `${15.5 * scale}px`, lineHeight: 1.3 }}
          >
            {scheme === 'ink'
              ? '宣纸墨色与朱砂印泥的古典秩序'
              : scheme === 'pearl'
                ? '工业冷白与瑞士排印的现代秩序'
                : scheme === 'buer'
                  ? '先锋极简社论与荧光高光的设计语言'
                  : '纸墨色彩与版面留白的排版秩序'}
          </h2>
          <p
            className={`text-paper-muted ${serif ? 'font-serif' : 'font-sans'}`}
            style={{ fontSize: `${13 * scale}px`, lineHeight: lineHeight }}
          >
            文字是有分量的。在长文本阅读中，合适的衬线笔触、舒适的字号阶梯与宽松行距能够让眼睛长久专注于思考，而不是在屏幕发光体前疲惫不堪。
          </p>
        </div>
      </div>
    </div>
  )
}
