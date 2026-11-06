import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, RotateCcw, ShieldCheck } from 'lucide-react'
import { CATEGORIES } from '../../lib/demo'

/* 本地推荐 —— 严格复刻 src/lib/recommend.ts 真实算法：
 * 1. 0.55 内容相似度（Bigram 字符余弦，标题词权重 ×2）
 * 2. 0.20 信源亲和度（当前预设下各信源已读频次归一化）
 * 3. 0.25 新鲜度衰减（指数衰减 τ≈36h）
 * 4. 同源打散：同一信源后续候选得分 ×0.82 逐级降权
 * 5. 5 篇冷启动阈值，纯客户端运行，零云端上报。 */

interface ScoredArticle {
  id: string
  source: string
  title: string
  contentSim: number
  sourceAffinity: number
  recency: number
  penalty: number
}

const INITIAL_CANDIDATES: ScoredArticle[] = [
  {
    id: 'c1',
    source: '量子位',
    title: '开源阵营的「跨会话记忆」之战：模型长程表现评测',
    contentSim: 0.88,
    sourceAffinity: 0.75,
    recency: 0.92,
    penalty: 1.0,
  },
  {
    id: 'c2',
    source: '晚点 LatePost',
    title: '独家｜字节 AI 硬件团队分拆独立融资',
    contentSim: 0.82,
    sourceAffinity: 0.8,
    recency: 0.95,
    penalty: 1.0,
  },
  {
    id: 'c3',
    source: '量子位',
    title: '大模型推理加速新架构：从 KV Cache 到状态空间',
    contentSim: 0.85,
    sourceAffinity: 0.75,
    recency: 0.7,
    penalty: 0.82, // 同源打散！
  },
  {
    id: 'c4',
    source: '少数派',
    title: '我把整个阅读工作流换成了 RSS：对抗信息焦虑',
    contentSim: 0.65,
    sourceAffinity: 0.6,
    recency: 0.85,
    penalty: 1.0,
  },
]

function calcScore(item: ScoredArticle): number {
  const raw = item.contentSim * 0.55 + item.sourceAffinity * 0.2 + item.recency * 0.25
  return Number((raw * item.penalty).toFixed(3))
}

export function RecommendDemo() {
  const [readCount, setReadCount] = useState(3)
  const [candidates, setCandidates] = useState(INITIAL_CANDIDATES)

  const ready = readCount >= 5
  const rail = ready ? CATEGORIES : CATEGORIES.filter((c) => c !== '推荐')

  const readOneMore = () => {
    setReadCount((c) => {
      const next = c + 1
      if (next >= 5) {
        // 增进量子位亲和度与内容相关度，重新排序
        setCandidates((prev) =>
          [...prev]
            .map((item) =>
              item.source === '量子位'
                ? { ...item, sourceAffinity: Math.min(1.0, item.sourceAffinity + 0.1) }
                : item,
            )
            .sort((a, b) => calcScore(b) - calcScore(a)),
        )
      }
      return next
    })
  }

  const reset = () => {
    setReadCount(2)
    setCandidates(INITIAL_CANDIDATES)
  }

  return (
    <div className="space-y-4 rounded-2xl border border-haze bg-ink-raised/50 p-5">
      {/* 头部冷启动状态 */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-haze/60">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
            <span className="h-px w-5 bg-cinnabar" aria-hidden />
            <span>本地推荐冷启动就绪检测</span>
          </div>
          <div className="mt-1 text-[13.5px] text-paper">
            当前预设已读{' '}
            <span className="font-mono font-bold text-cinnabar-soft text-[15px]">
              {Math.min(readCount, 5)}
            </span>
            <span className="text-paper-faint"> / 5 篇阈值</span>
            {ready && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-cinnabar/20 px-2 py-0.5 font-mono text-[10px] text-cinnabar-soft">
                <Check size={11} strokeWidth={2.5} /> 已激活
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={readOneMore}
            className="pressable rounded-full border border-cinnabar/70 bg-cinnabar/15 px-3.5 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25 active:scale-95"
          >
            模拟阅读一篇
          </button>
          <button
            type="button"
            onClick={reset}
            title="重置测试数据"
            className="rounded-full border border-haze p-1.5 text-paper-muted hover:text-paper"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 overflow-hidden rounded-full bg-paper/10">
        <motion.div
          className="h-full bg-cinnabar rounded-full"
          animate={{ width: `${Math.min(readCount, 5) * 20}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>

      {/* 分类轨反应 */}
      <div>
        <div className="text-[11px] font-mono text-paper-muted mb-1.5">
          分类轨实时状态（读满 5 篇后「推荐」亮起首位）：
        </div>
        <div className="horizontal-scroll-rail scroll-hidden mask-fade-x flex gap-1 overflow-x-auto py-1">
          {rail.map((c) => (
            <span
              key={c}
              className={`relative shrink-0 rounded-lg px-3 py-1 font-display text-[13px] ${
                c === '推荐'
                  ? 'bg-cinnabar/20 text-cinnabar-soft font-semibold border border-cinnabar/40'
                  : 'bg-ink/50 text-paper/75'
              }`}
            >
              {c}
              {c === '推荐' && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-cinnabar animate-pulse" />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* 实时本地重排文章池打分公式展示 */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-paper-muted">
          <span>候选池本地打分排序（公式：0.55×内容 + 0.20×信源 + 0.25×新鲜度）:</span>
          <span className="flex items-center gap-1 text-cinnabar-soft">
            <ShieldCheck size={12} /> 数据不出本机
          </span>
        </div>

        <div className="space-y-1.5">
          <AnimatePresence>
            {candidates.map((item, idx) => {
              const score = calcScore(item)
              return (
                <motion.div
                  key={item.id}
                  layout
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-haze/60 bg-ink/70 px-3 py-2 text-[11px]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-cinnabar-soft w-4">
                      #{idx + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-paper">{item.title}</div>
                      <div className="font-mono text-[9.5px] text-paper-faint flex items-center gap-2">
                        <span>{item.source}</span>
                        <span>内容: {item.contentSim}</span>
                        <span>亲和: {item.sourceAffinity}</span>
                        {item.penalty < 1.0 && (
                          <span className="text-cinnabar-soft">同源打散 ×{item.penalty}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 font-mono">
                    <div className="font-bold text-paper text-[12px] tabular-nums">{score}</div>
                    <div className="text-[9px] text-paper-faint">综合得分</div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-haze/60 font-mono text-[10px] text-paper-muted">
        <span>中文 Bigram 字符切分 · 标题词权重 ×2 · 池内 IDF 余弦</span>
        <span>可完全关闭 · 绝不反向污染主新闻轴</span>
      </div>
    </div>
  )
}
