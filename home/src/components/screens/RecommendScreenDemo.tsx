import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, RotateCcw, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { TabBar } from '../app/TabBar'
import { Cover } from '../app/Cover'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface Candidate {
  id: string
  source: string
  title: string
  time: string
  sim: number
  affinity: number
  recency: number
  reason: string
}

const INITIAL_POOL: Candidate[] = [
  {
    id: 'rec-1',
    source: '量子位',
    title: '开源阵营的「跨会话记忆」之战：模型长程评测',
    time: '1 小时前',
    sim: 0.88,
    affinity: 0.75,
    recency: 0.92,
    reason: '常读信源 · 深度匹配',
  },
  {
    id: 'rec-2',
    source: '晚点 LatePost',
    title: '独家｜字节 AI 硬件团队分拆独立融资',
    time: '23 分钟前',
    sim: 0.82,
    affinity: 0.8,
    recency: 0.95,
    reason: '时效性高 · 商业焦点',
  },
  {
    id: 'rec-3',
    source: '少数派',
    title: '我把整个阅读工作流换成了本地离线优先：对抗信息焦虑',
    time: '昨天',
    sim: 0.65,
    affinity: 0.6,
    recency: 0.85,
    reason: '阅读历史主题相似',
  },
  {
    id: 'rec-4',
    source: '澎湃·特稿',
    title: '回到县城的人们：关于产业转移的十年跟踪观察',
    time: '2 小时前',
    sim: 0.72,
    affinity: 0.85,
    recency: 0.78,
    reason: '深度长文阅读偏好',
  },
]

function getScore(c: Candidate, wSim = 0.55, wAff = 0.2, wRec = 0.25): number {
  return Number((c.sim * wSim + c.affinity * wAff + c.recency * wRec).toFixed(3))
}

/* 本地推荐真机界面 —— 严格复刻 src/lib/recommend.ts 与 docs/local-recommend.md：
 * 端侧 0.55/0.20/0.25 权重模型 + 冷启动阅览阈值仪表 +
 * 条目附带本地归因凭证 + 数据 100% 留在本机 + 底栏。 */
export function RecommendScreenDemo() {
  const [readCount, setReadCount] = useState(4)
  const [items, setItems] = useState(INITIAL_POOL)
  const [wSim, setWSim] = useState(0.55)
  const [wAff, setWAff] = useState(0.2)
  const [wRec, setWRec] = useState(0.25)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isReady = readCount >= 5

  const simulateRead = () => {
    setReadCount((c) => {
      const next = c + 1
      if (next >= 5) {
        setItems((prev) =>
          [...prev].sort((a, b) => getScore(b, wSim, wAff, wRec) - getScore(a, wSim, wAff, wRec)),
        )
      }
      return next
    })
  }

  const reset = () => {
    setReadCount(2)
    setItems(INITIAL_POOL)
  }

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
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
              本地推荐频道
            </span>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[9.5px]">
          <span className="flex items-center gap-1 rounded-full bg-cinnabar/15 px-2 py-0.5 text-cinnabar-soft font-semibold">
            <ShieldCheck size={11} /> 0 数据出机
          </span>
          <button
            type="button"
            onClick={() => setDrawerOpen(!drawerOpen)}
            className="p-1 rounded-full text-paper-muted hover:text-paper"
          >
            <SlidersHorizontal size={13} />
          </button>
        </div>
        </div>
      </header>

      {/* 冷启动阈值与算法就绪度卡片 */}
      <div className="border-b border-haze/30 bg-ink-raised/40 px-3.5 py-2 space-y-1.5 font-mono text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-paper-muted">
            本地阅读足迹：
            <span className="font-bold text-cinnabar-soft text-[11.5px] ml-1">
              {Math.min(readCount, 5)} / 5 篇
            </span>
            <span className="text-paper-faint ml-1">
              ({isReady ? '算法已激活' : '冷启动中'})
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={simulateRead}
              className="rounded-full border border-cinnabar/60 bg-cinnabar/15 px-2 py-0.5 text-cinnabar-soft font-semibold hover:bg-cinnabar/25"
            >
              读一篇
            </button>
            <button type="button" onClick={reset} className="text-paper-faint hover:text-paper">
              <RotateCcw size={11} />
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-1 rounded-full bg-paper/10 overflow-hidden">
          <motion.div
            className="h-full bg-cinnabar rounded-full"
            animate={{ width: `${Math.min(readCount, 5) * 20}%` }}
          />
        </div>
      </div>

      {/* 算法公式调节微型抽屉 */}
      {drawerOpen && (
        <div className="border-b border-cinnabar/30 bg-cinnabar/10 p-3 space-y-2 font-mono text-[9.5px]">
          <div className="font-bold text-cinnabar-soft flex items-center justify-between">
            <span>本地排序公式：0.55相似度 + 0.20偏好 + 0.25时效</span>
            <span className="text-paper-faint">实时重排</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-paper-faint">主题相似 (55%)</span>
              <input
                type="range"
                min={0.2}
                max={0.8}
                step={0.05}
                value={wSim}
                onChange={(e) => setWSim(Number(e.target.value))}
                className="w-full cursor-pointer accent-cinnabar"
              />
            </div>
            <div>
              <span className="text-paper-faint">信源偏好 (20%)</span>
              <input
                type="range"
                min={0.1}
                max={0.5}
                step={0.05}
                value={wAff}
                onChange={(e) => setWAff(Number(e.target.value))}
                className="w-full cursor-pointer accent-cinnabar"
              />
            </div>
            <div>
              <span className="text-paper-faint">发布时效 (25%)</span>
              <input
                type="range"
                min={0.1}
                max={0.5}
                step={0.05}
                value={wRec}
                onChange={(e) => setWRec(Number(e.target.value))}
                className="w-full cursor-pointer accent-cinnabar"
              />
            </div>
          </div>
        </div>
      )}

      {/* 推荐候选流 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        <AnimatePresence>
          {items.map((item) => {
            const score = getScore(item, wSim, wAff, wRec)
            return (
              <motion.div
                key={item.id}
                layout
                className="flex items-center gap-3 rounded-xl border border-haze/70 bg-ink-raised/50 p-2.5 transition-colors hover:border-paper-faint/30"
              >
                <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-ink border border-haze/60">
                  <Cover seed={item.id} label={item.source} className="h-full w-full" aspect="standard" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between font-mono text-[9px]">
                    <span className="text-cinnabar-soft font-semibold">{item.source}</span>
                    <span className="rounded bg-ink px-1.5 py-0.2 text-paper-faint border border-haze/60">
                      得分 {score}
                    </span>
                  </div>
                  <h3 className="truncate font-display text-[12.5px] font-medium text-paper">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-1.5 font-mono text-[8.5px] text-paper-faint">
                    <span>{item.time}</span>
                    <span>·</span>
                    <span className="text-cinnabar-soft font-bold">{item.reason}</span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      <TabBar active="today" />
    </div>
  )
}
