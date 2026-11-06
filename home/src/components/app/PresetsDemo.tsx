import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, LayoutTemplate, RotateCcw, Sparkles } from 'lucide-react'
import { PRESETS } from '../../lib/demo'

/* 场景预设 —— 严格复刻 src/sources/presets.ts：
 * 8 套官方互斥预设，一键整包替换分类顺序、显隐、选源、综合频道启用与收藏。 */
export function PresetsDemo() {
  const [active, setActive] = useState('科技数码')
  const [savedUserPreset, setSavedUserPreset] = useState(false)

  const curPreset = PRESETS.find((p) => p.name === active) || PRESETS[0]

  return (
    <div className="overflow-hidden rounded-2xl border border-haze bg-ink">
      <div className="flex items-center justify-between border-b border-haze/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <LayoutTemplate size={14} strokeWidth={1.7} className="text-cinnabar" />
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-paper-muted">
            场景预设 · 完整快照切换
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setSavedUserPreset(true)
            setTimeout(() => setSavedUserPreset(false), 2000)
          }}
          className="flex items-center gap-1 rounded-full border border-haze px-2.5 py-0.5 font-mono text-[9.5px] text-paper-muted hover:text-paper"
        >
          <Copy size={11} />
          {savedUserPreset ? '已另存为「我的定制预设」' : '另存为副本'}
        </button>
      </div>

      <div className="grid md:grid-cols-[1.2fr_0.8fr] divide-y md:divide-y-0 md:divide-x divide-haze/50">
        {/* 预设列表 */}
        <ul className="divide-y divide-haze/40 max-h-[360px] overflow-y-auto scroll-hidden">
          {PRESETS.map((p) => {
            const isActive = p.name === active
            return (
              <li key={p.name}>
                <button
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setActive(p.name)}
                  className="relative flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper/5"
                >
                  {isActive && (
                    <motion.span
                      layoutId="preset-bar"
                      className="absolute inset-y-0 left-0 w-[3px] bg-cinnabar"
                      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`text-[13.5px] ${isActive ? 'font-bold text-paper' : 'text-paper-muted'}`}>
                        {p.name}
                      </span>
                      <span className="rounded-full bg-ink-raised px-1.5 py-0.2 font-mono text-[9px] text-paper-faint">
                        {p.count} 个源
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[9.5px] text-paper-faint">
                      {p.desc}
                    </span>
                  </span>
                  {isActive ? (
                    <Check size={15} strokeWidth={2.4} className="shrink-0 text-cinnabar" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-haze/60" aria-hidden />
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        {/* 当前预设生效快照透视 */}
        <div className="p-4 bg-ink-raised/30 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-cinnabar-soft mb-2">
              <Sparkles size={12} />
              <span>整包快照已加载</span>
            </div>
            <div className="font-display text-[15px] font-bold text-paper">{curPreset.name}</div>
            <div className="font-mono text-[10px] text-paper-muted mt-1 leading-relaxed">
              {curPreset.desc}
            </div>

            <div className="mt-3 space-y-1.5 font-mono text-[10px] text-paper-faint border-t border-haze/40 pt-2.5">
              <div className="flex justify-between">
                <span>分类编排:</span>
                <span className="text-paper">独占隔离 / 互斥生效</span>
              </div>
              <div className="flex justify-between">
                <span>综合频道:</span>
                <span className="text-cinnabar-soft font-semibold">自适应混合权重</span>
              </div>
              <div className="flex justify-between">
                <span>信源状态:</span>
                <span className="text-paper">{curPreset.count} 源激活</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-2 border-t border-haze/40 font-mono text-[9.5px] text-paper-faint flex items-center justify-between">
            <span>长按可重命名 / 调整顺序</span>
            <span className="flex items-center gap-1 text-paper-muted">
              <RotateCcw size={10} /> 恢复出厂
            </span>
          </div>
        </div>
      </div>

      <p className="border-t border-haze/60 px-4 py-2 font-mono text-[10px] text-paper-muted">
        通勤切「全球视野」，工作切「科技数码」，睡前切「深度人文」，各场景阅读状态毫不串味。
      </p>
    </div>
  )
}
