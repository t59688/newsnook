import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Languages, Sparkles, WifiOff } from 'lucide-react'
import { SegmentedControl } from './SegmentedControl'

/* 翻译 —— 严格复刻 features/translation 真实架构：
 * 1. 稳定的 TranslationProvider 边界，新增引擎 Reader 零改动
 * 2. 7 种引擎：本地 ML Kit、Bergamot 神经网络、Google、Azure、DeepL、AI、自定义 API
 * 3. 两种落地形态：对比翻译（段落下插展开）vs 全文替换（原位一键替代）
 * 4. 离线缓存持久化与外文标题自动翻译。 */

const EN_PARAS = [
  'Local-first is not just a catchy slogan. It means the articles you saved this morning must remain fully readable on a subway without signal or during a complete cloud outage.',
  'News lists and article bodies are fetched directly from the upstream publishers by your device. No cloud recommendation engine sits in between, and no browsing footprint is uploaded.',
]

const ZH_PARAS = [
  '本地优先不仅是一句响亮的口号。它意味着你今早保存的文章，在没有手机信号的地铁车厢或云端服务彻底故障时，依然能流畅阅读。',
  '新闻列表与正文均由你的设备直接向上游发布方拉取。中间没有任何云端推荐引擎阻隔，也绝不会上传你的任何阅读足迹。',
]

const ENGINES = [
  { name: 'Android 本地翻译', offline: true, desc: 'ML Kit 语言包，零网络，无密钥' },
  { name: 'Bergamot 离线翻译', offline: true, desc: 'Mozilla 离线神经网络翻译' },
  { name: 'DeepL', offline: false, desc: '高精度自然语言语义翻译' },
  { name: 'Google Translate', offline: false, desc: '官方 Cloud Translation API' },
  { name: 'Microsoft Azure', offline: false, desc: '微软认知服务翻译' },
  { name: 'AI 驱动翻译', offline: false, desc: 'OpenAI / Claude / 自定义模型' },
  { name: '自定义 API', offline: false, desc: '支持任意兼容端点' },
]

export function TranslationDemo() {
  const [mode, setMode] = useState<'compare' | 'replace'>('compare')
  const [activeEngine, setActiveEngine] = useState('Android 本地翻译')
  const [targetLang, setTargetLang] = useState('简体中文')
  const [showTranslate, setShowTranslate] = useState(true)

  const curEngine = ENGINES.find((e) => e.name === activeEngine) || ENGINES[0]

  return (
    <div className="overflow-hidden rounded-2xl border border-haze bg-ink">
      {/* 顶栏 */}
      <div className="flex items-center justify-between border-b border-haze/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <Languages size={14} strokeWidth={1.8} className="text-cinnabar" />
          <span className="font-mono text-[10.5px] tracking-[0.16em] text-paper-muted">
            翻译架构 · 7 大引擎
          </span>
          {curEngine.offline && (
            <span className="flex items-center gap-1 rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
              <WifiOff size={10} /> 纯离线引擎
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTranslate((v) => !v)}
          className={`rounded-full border px-3 py-1 font-mono text-[10px] transition-colors ${
            showTranslate
              ? 'border-cinnabar bg-cinnabar/15 text-cinnabar-soft font-semibold'
              : 'border-haze text-paper-muted hover:text-paper'
          }`}
        >
          {showTranslate ? '已开启译文' : '显示纯英文原文'}
        </button>
      </div>

      {/* 翻译正文渲染区 */}
      <div className="space-y-4 px-5 py-4">
        {EN_PARAS.map((en, i) => (
          <div
            key={i}
            className="reader-prose"
            data-article-lang="en"
            style={{ ['--reader-font-size' as string]: '14px' }}
          >
            {/* 原文 */}
            <p className={`!mb-0 text-paper/80 ${mode === 'replace' && showTranslate ? 'hidden' : ''}`}>
              {en}
            </p>

            {/* 对比模式：在段落下方滑出展开 */}
            <AnimatePresence initial={false}>
              {showTranslate && mode === 'compare' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-2 rounded-xl border border-cinnabar/20 bg-cinnabar/10 p-2.5 font-mono text-[13px] text-paper/90"
                  style={{ textIndent: 0 }}
                >
                  <div className="flex items-center justify-between text-[9px] text-cinnabar-soft mb-1 font-mono">
                    <span className="flex items-center gap-1">
                      <Sparkles size={10} /> {curEngine.name} → {targetLang}
                    </span>
                    <span>段落对齐</span>
                  </div>
                  <p className="leading-relaxed">{ZH_PARAS[i]}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 全文替代模式 */}
            {showTranslate && mode === 'replace' && (
              <p className="mt-1 !mb-0 text-[14px] leading-relaxed text-paper" style={{ textIndent: 0 }}>
                {ZH_PARAS[i]}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 控制面板 */}
      <div className="space-y-3.5 border-t border-haze/60 bg-ink-raised/30 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            label="呈现模式"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'compare', label: '段落对比翻译' },
              { value: 'replace', label: '原位全文替代' },
            ]}
          />
          <div className="flex items-center gap-1 font-mono text-[10px] text-paper-muted">
            <span>目标语:</span>
            {['简体中文', 'English', '日本語'].map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setTargetLang(lang)}
                className={`rounded px-1.5 py-0.5 ${
                  targetLang === lang ? 'bg-paper text-ink font-bold' : 'text-paper-faint hover:text-paper'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>

        {/* 7 大引擎切换标签 */}
        <div>
          <div className="font-mono text-[10px] text-paper-faint mb-1.5">可选翻译引擎：</div>
          <div className="flex flex-wrap gap-1.5">
            {ENGINES.map((e) => (
              <button
                key={e.name}
                type="button"
                onClick={() => setActiveEngine(e.name)}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] transition-all ${
                  activeEngine === e.name
                    ? 'bg-paper text-ink font-bold shadow-sm'
                    : 'border border-haze bg-ink text-paper-muted hover:border-paper-faint/50 hover:text-paper'
                }`}
              >
                {activeEngine === e.name && <Check size={10} strokeWidth={2.8} />}
                {e.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between font-mono text-[10px] text-paper-faint border-t border-haze/40 pt-2">
          <span>{curEngine.desc}</span>
          <span>信息流外文标题支持后台自动预译</span>
        </div>
      </div>
    </div>
  )
}
