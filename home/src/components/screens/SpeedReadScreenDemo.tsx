import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, FileDown, ImageDown, LoaderCircle, RefreshCw, ScrollText, Share2, X } from 'lucide-react'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

const SIX_SECTIONS = [
  {
    icon: '📌',
    title: '核心论点',
    text: '中西部县城正从被动的劳动力输出地，转变为承接产业外溢与回流就业的微观重心。',
  },
  {
    icon: '💡',
    title: '时代洞察',
    text: '沿海加工红利放缓与内陆高铁网络完善叠加，使家庭团聚的隐性价值首次压倒沿海微弱的工资溢价。',
  },
  {
    icon: '📊',
    title: '实证证据',
    text: '跟踪 47 位返乡样本，本地就业平均薪资已达沿海同岗位 75%，但生活成本降低 42%，幸福感显著提升。',
  },
  {
    icon: '⚖️',
    title: '结构性张力',
    text: '小家电与电商仓储岗位迅速铺开，但高附加值研发与公共服务配套仍存在滞后脱节。',
  },
  {
    icon: '🔮',
    title: '演进研判',
    text: '未来三年，距离区域中心城市 1 小时车程的县级产业集群将分化出专业化分工优势。',
  },
  {
    icon: '🎯',
    title: '策略切口',
    text: '对创业者而言，下沉市场的技术服务、冷链微仓储与社群零售具备最强的穿透力。',
  },
]

/* AI 智能速读全功能真机界面 —— 严格复刻 src/components/AiSpeedReadPanel.tsx：
 * 原生顶栏（模型指示器/重新生成/关闭）+ 6 维结构化要点流式生成 +
 * 底部操作栏（复制 Markdown / 导出长图 / 系统分享）。 */
export function SpeedReadScreenDemo() {
  const [visibleCount, setVisibleCount] = useState(6)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const regenerate = () => {
    setVisibleCount(0)
    setGenerating(true)
  }

  useEffect(() => {
    if (!generating) return
    let current = 0
    const interval = setInterval(() => {
      current += 1
      setVisibleCount(current)
      if (current >= SIX_SECTIONS.length) {
        clearInterval(interval)
        setGenerating(false)
      }
    }, 380)
    return () => clearInterval(interval)
  }, [generating])

  const handleCopy = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 沉浸式速读抽屉顶栏 (AiSpeedReadPanel) */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-3 py-1.5">
          <div className="flex items-center gap-2">
            <ScrollText size={15} className="text-cinnabar" />
            <span className="font-display text-[14px] font-semibold text-paper">
              AI 深度速读
            </span>
            <span className="rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
              端侧模型
            </span>
          </div>

          <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={regenerate}
            disabled={generating}
            aria-label="重新生成"
            className="flex h-7 items-center gap-1 rounded-full border border-cinnabar/50 bg-cinnabar/10 px-2.5 font-mono text-[9.5px] text-cinnabar-soft font-medium hover:bg-cinnabar/20 disabled:opacity-40"
          >
            <RefreshCw size={11} className={generating ? 'animate-spin' : ''} />
            <span>{generating ? '生成中…' : '重新生成'}</span>
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper"
          >
            <X size={15} />
          </button>
        </div>
        </div>
      </header>

      {/* 篇头信息 */}
      <div className="border-b border-haze/30 bg-ink-raised/30 px-3.5 py-1.5 font-mono text-[9.5px]">
        <div className="text-paper-muted truncate">
          澎湃·特稿 · 回到县城的人们：关于产业转移的十年跟踪观察
        </div>
        <div className="mt-0.5 flex items-center justify-between text-paper-faint">
          <span>全文 8,420 字 → 已提炼为 6 维认知卡片</span>
          <span className="text-cinnabar-soft font-bold">阅读节省 92%</span>
        </div>
      </div>

      {/* 六段结构依次生成呈现 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2.5">
        {SIX_SECTIONS.map((sec, idx) => {
          const isShown = idx < visibleCount
          return (
            <AnimatePresence key={sec.title}>
              {isShown && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  className="rounded-xl border border-haze/70 bg-ink-raised/50 p-2.5 space-y-1 shadow-xs hover:border-paper-faint/30 transition-colors"
                >
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold text-cinnabar-soft">
                    <span>{sec.icon}</span>
                    <span>{sec.title}</span>
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-paper/90 pl-5">
                    {sec.text}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          )
        })}

        {generating && (
          <div className="flex items-center justify-center gap-2 py-3 font-mono text-[10px] text-cinnabar-soft">
            <LoaderCircle size={13} className="animate-spin" />
            <span>端侧神经推理生成第 {visibleCount + 1} 结构块…</span>
          </div>
        )}
      </div>

      {/* 底部功能栏 (复制 / 导出 Markdown / 分享长图) */}
      <footer className="relative z-20 shrink-0 border-t border-haze/40 bg-ink/95 px-3 py-2 backdrop-blur-xl">
        <div className="flex items-center justify-between font-mono text-[9.5px]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-lg border border-haze bg-ink-raised/60 px-2 py-1 text-paper-muted hover:text-paper"
            >
              <Copy size={11} />
              <span>{copied ? '已复制' : '复制 Markdown'}</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-haze bg-ink-raised/60 px-2 py-1 text-paper-muted hover:text-paper"
            >
              <FileDown size={11} />
              <span>导出 .md</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded-lg border border-cinnabar/60 bg-cinnabar/15 px-2.5 py-1 font-bold text-cinnabar-soft hover:bg-cinnabar/25"
            >
              <ImageDown size={11} />
              <span>生成长图</span>
            </button>
            <button
              type="button"
              className="p-1 rounded-lg border border-haze text-paper-muted hover:text-paper"
            >
              <Share2 size={12} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
