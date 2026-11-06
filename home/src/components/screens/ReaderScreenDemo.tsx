import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  Languages,
  MoreHorizontal,
  ScrollText,
  SlidersHorizontal,
  Volume2,
} from 'lucide-react'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

const EN_PARAS = [
  'Local-first is not a slogan. It means the articles you opened this morning must still be readable on a train with zero signal or during a complete cloud outage.',
  'The news list and the article body come straight from the original publisher. No server-side recommendation algorithm decides what you read, and no personal data is ever collected.',
  'When connectivity is restored, only lightweight preferences and secret keys sync silently via Outbox queues—leaving full text and reading footprints strictly on your local device.',
]

const ZH_PARAS = [
  '本地优先并非一句口号。它意味着你今晨打开的文章，在毫无信号的列车车厢或云端完全中断时，依然能够顺畅读完。',
  '新闻列表与正文均由客户端直连上游发布方站点获取。没有任何服务端推荐算法替你筛选内容，也绝不收集你的任何私人数据。',
  '当网络恢复时，仅有轻量级偏好配置与加密密钥经由 Outbox 队列静默同步——而全文内容与阅读足迹严格保留在你的本地设备上。',
]

/* 站内阅读器与翻译真机界面 —— 严格复刻 src/screens/ReaderScreen.tsx：
 * 原生功能顶栏（速读/朗读/收藏/更多）+ ReaderTranslationBar 双模切换 +
 * 原文/译文展开手风琴动画 + 字号/行距动态排版滑块。 */
export function ReaderScreenDemo() {
  const [transMode, setTransMode] = useState<'replace' | 'compare'>('compare')
  const [saved, setSaved] = useState(false)
  const [fontScale, setFontScale] = useState(1.0)
  const [lineHeight, setLineHeight] = useState(1.85)
  const [showTypography, setShowTypography] = useState(false)

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 阅读器原生顶栏 */}
      <header className="relative z-30 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-md">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              aria-label="返回"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-ink-raised hover:text-paper"
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
            <span className="truncate font-mono text-[10px] tracking-[0.12em] text-paper-muted">
              The Verge · 站内全文
            </span>
          </div>

          {/* 顶部工具栏按钮组 */}
          <div className="flex items-center gap-0.5 text-paper-muted">
          <button
            type="button"
            onClick={() => setShowTypography(!showTypography)}
            title="字号与版式"
            className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
              showTypography ? 'bg-cinnabar/20 text-cinnabar-soft' : 'hover:bg-ink-raised hover:text-paper'
            }`}
          >
            <SlidersHorizontal size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title="AI 速读"
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-raised hover:text-paper"
          >
            <ScrollText size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            title="语音朗读"
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-raised hover:text-paper"
          >
            <Volume2 size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setSaved(!saved)}
            title={saved ? '已收藏' : '收藏'}
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-raised hover:text-paper"
          >
            {saved ? (
              <BookmarkCheck size={14} className="text-cinnabar" strokeWidth={2} />
            ) : (
              <BookmarkPlus size={14} strokeWidth={1.8} />
            )}
          </button>
          <button
            type="button"
            title="更多操作"
            className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-ink-raised hover:text-paper"
          >
            <MoreHorizontal size={14} strokeWidth={1.8} />
          </button>
        </div>
        </div>
      </header>

      {/* ReaderTranslationBar 沉浸式翻译状态条 */}
      <div className="flex items-center justify-between border-b border-cinnabar/25 bg-cinnabar/10 px-3.5 py-1.5 font-mono text-[9.5px]">
        <div className="flex items-center gap-1.5 text-cinnabar-soft font-semibold">
          <Languages size={12} />
          <span>Bergamot 离线神经网络 · 译文已就绪</span>
        </div>

        {/* 模式双选药丸 (ReaderTranslationBar) */}
        <div className="flex items-center rounded-lg border border-cinnabar/40 bg-ink/70 p-0.5">
          <button
            type="button"
            onClick={() => setTransMode('compare')}
            className={`rounded px-1.5 py-0.5 transition-colors ${
              transMode === 'compare'
                ? 'bg-cinnabar text-ink font-bold shadow-xs'
                : 'text-cinnabar-soft hover:text-paper'
            }`}
          >
            双语对照
          </button>
          <button
            type="button"
            onClick={() => setTransMode('replace')}
            className={`rounded px-1.5 py-0.5 transition-colors ${
              transMode === 'replace'
                ? 'bg-cinnabar text-ink font-bold shadow-xs'
                : 'text-cinnabar-soft hover:text-paper'
            }`}
          >
            全文替代
          </button>
        </div>
      </div>

      {/* 字号与行距调节控制面板（点击版式按钮展开） */}
      {showTypography && (
        <div className="border-b border-haze/40 bg-ink-raised/60 px-3.5 py-2 font-mono text-[10px] space-y-2 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <span className="text-paper-faint">正文字号微调：</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFontScale((s) => Math.max(0.85, s - 0.05))}
                className="rounded border border-haze px-1.5 py-0.5 hover:text-paper"
              >
                A-
              </button>
              <span className="w-9 text-center font-bold text-cinnabar-soft">
                {(15 * fontScale).toFixed(1)}px
              </span>
              <button
                type="button"
                onClick={() => setFontScale((s) => Math.min(1.3, s + 0.05))}
                className="rounded border border-haze px-1.5 py-0.5 hover:text-paper"
              >
                A+
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-paper-faint">正文排版行距：</span>
            <div className="flex items-center gap-1.5">
              {[1.65, 1.85, 2.1].map((lh) => (
                <button
                  key={lh}
                  type="button"
                  onClick={() => setLineHeight(lh)}
                  className={`rounded px-2 py-0.5 ${
                    lineHeight === lh
                      ? 'bg-cinnabar text-ink font-bold'
                      : 'border border-haze text-paper-muted hover:text-paper'
                  }`}
                >
                  {lh === 1.65 ? '紧凑' : lh === 1.85 ? '标准' : '宽松'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 真实排版正文阅读区 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 space-y-4">
        {/* 文章大标题与刊头 */}
        <div className="space-y-1.5 border-b border-haze/30 pb-3">
          <div className="font-mono text-[9.5px] tracking-[0.14em] text-cinnabar-soft">
            深度报道 · 计算机体系演进
          </div>
          <h1 className="font-display text-[18px] sm:text-[19px] font-bold leading-tight text-paper">
            Local-First Software: You Own Your Data, in spite of the Cloud
          </h1>
          <div className="font-display text-[14px] text-paper-muted pt-0.5">
            本地优先软件架构：如何让你在云端之外真正拥有自己的数据
          </div>
          <div className="flex items-center gap-2 pt-1 font-mono text-[9px] text-paper-faint">
            <span>Martin Kleppmann</span>
            <span>·</span>
            <span>2 小时前</span>
            <span>·</span>
            <span>站内抽取 2,800 词</span>
          </div>
        </div>

        {/* 双语对照段落流（对比翻译展开 / 全文替代收起） */}
        <div className="space-y-4">
          {EN_PARAS.map((en, idx) => {
            const zh = ZH_PARAS[idx]
            return (
              <div key={idx} className="space-y-1.5">
                {/* 译文主体 */}
                <p
                  className="font-serif text-paper leading-relaxed transition-all"
                  style={{
                    fontSize: `${14.5 * fontScale}px`,
                    lineHeight: lineHeight,
                  }}
                >
                  {zh}
                </p>

                {/* 对比模式下的英文原文手风琴展开 */}
                <AnimatePresence>
                  {transMode === 'compare' && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p
                        className="rounded-lg border-l-2 border-cinnabar/50 bg-ink-raised/40 pl-2.5 py-1 font-sans text-[11.5px] italic text-paper-faint leading-normal"
                      >
                        {en}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      </div>

      {/* 底部阅读进度指示条 */}
      <div className="relative h-1 w-full bg-haze/40">
        <div className="h-full w-2/5 bg-cinnabar" />
      </div>
    </div>
  )
}
