import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Cpu,
  FlaskConical,
  Gamepad2,
  Globe,
  Newspaper,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react'
import { TabBar } from '../app/TabBar'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface PresetItem {
  id: string
  name: string
  desc: string
  count: number
  icon: typeof Cpu
  tags: string[]
}

const OFFICIAL_PRESETS: PresetItem[] = [
  {
    id: 'builtin-v2-cn',
    name: '中国资讯',
    desc: '国内政经、深度特稿与民生热点追踪',
    count: 18,
    icon: Newspaper,
    tags: ['要闻', '特稿', '民生', '产经'],
  },
  {
    id: 'builtin-v2-world',
    name: '全球视野',
    desc: '跨国主流媒体、地缘政治与国际纵深报道',
    count: 24,
    icon: Globe,
    tags: ['全球', '地缘', '防务', '深度报道'],
  },
  {
    id: 'builtin-v2-biz',
    name: '财经商业',
    desc: '宏观金融、资本市场、商业模式与创投风向',
    count: 16,
    icon: TrendingUp,
    tags: ['宏观', '研报', '股市', '商业快讯'],
  },
  {
    id: 'builtin-v2-tech',
    name: '科技数码',
    desc: '极客公园、少数派、爱范儿与开源硬件动态',
    count: 32,
    icon: Cpu,
    tags: ['数码', '开源', '工作流', '效率工具'],
  },
  {
    id: 'builtin-v2-ai',
    name: 'AI 前沿',
    desc: '大语言模型、端侧推理、具身智能与论文精读',
    count: 22,
    icon: Bot,
    tags: ['大模型', '端侧计算', 'AI论文', '算力'],
  },
  {
    id: 'builtin-v2-science',
    name: '科学知识',
    desc: '物理前沿、生物医学、天文空间与基础科学科普',
    count: 15,
    icon: FlaskConical,
    tags: ['物理', '前沿医学', '天文', '科研进展'],
  },
  {
    id: 'builtin-v2-depth',
    name: '深度人文',
    desc: '非虚构特稿、历史书评、哲学思辨与思想档案',
    count: 14,
    icon: BookOpen,
    tags: ['非虚构', '书评', '社会学', '思想史'],
  },
  {
    id: 'builtin-v2-life',
    name: '文体生活',
    desc: '文化评论、独立游戏、生活方式与体育精选',
    count: 12,
    icon: Gamepad2,
    tags: ['独立游戏', '文艺', '生活方式', '泛生活'],
  },
]

/* 场景预设真机界面 —— 严格复刻 src/screens/settings/PresetListScreen.tsx：
 * 头部返回导航 + 激活预设 Hero 卡（含分类标签流与信源统计）+
 * 8 套官方预设矩阵（点击后选中框弹簧位移，整包切换信源）+ 底栏。 */
export function PresetsScreenDemo() {
  const [activeId, setActiveId] = useState('builtin-v2-tech')

  const active = OFFICIAL_PRESETS.find((p) => p.id === activeId) || OFFICIAL_PRESETS[3]
  const ActiveIcon = active.icon

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
              场景预设
            </span>
          </div>
          <span className="rounded-full bg-cinnabar/15 px-2 py-0.5 font-mono text-[9px] text-cinnabar-soft font-semibold">
            8 大官方快照
          </span>
        </div>
      </header>

      {/* 内容视口 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-3">
        {/* 当前使用中的预设 Hero 卡片 (PresetHeroCard) */}
        <div className="rounded-2xl border border-cinnabar/40 bg-gradient-to-br from-ink-raised via-ink-raised to-cinnabar/[0.06] p-3.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cinnabar/20 text-cinnabar-soft">
                <ActiveIcon size={15} strokeWidth={2} />
              </div>
              <h2 className="font-display text-[15px] font-bold text-paper">
                {active.name}
              </h2>
            </div>
            <span className="inline-flex items-center gap-0.5 rounded-full bg-cinnabar/20 px-2 py-0.5 font-mono text-[9px] font-semibold text-cinnabar-soft">
              <Check size={9} strokeWidth={2.5} />
              使用中
            </span>
          </div>

          <p className="mt-1.5 text-[11px] text-paper-muted leading-relaxed">
            {active.desc}
          </p>

          {/* 标签流 */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1">
            {active.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-haze/80 bg-ink/70 px-1.5 py-0.5 font-mono text-[9px] text-paper-muted"
              >
                {tag}
              </span>
            ))}
            <span className="font-mono text-[9px] text-paper-faint">+4 分类</span>
          </div>

          {/* 底部指标与编辑入口 */}
          <div className="mt-3 flex items-center justify-between border-t border-haze/60 pt-2 font-mono text-[9.5px]">
            <span className="text-paper-faint">{active.count} 个启用信源</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-cinnabar-soft font-semibold hover:opacity-85"
            >
              <SlidersHorizontal size={10} />
              <span>调整信源与分类</span>
              <ChevronRight size={10} />
            </button>
          </div>
        </div>

        {/* 预设列表 */}
        <div className="space-y-1.5">
          <div className="font-mono text-[10px] text-paper-faint px-0.5">
            官方内置预设（点击即整包切换）：
          </div>

          <div className="grid grid-cols-2 gap-2">
            {OFFICIAL_PRESETS.map((p) => {
              const isCur = p.id === activeId
              const Icon = p.icon

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActiveId(p.id)}
                  className={`group relative flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all ${
                    isCur
                      ? 'border-cinnabar bg-cinnabar/15 shadow-sm'
                      : 'border-haze bg-ink-raised/60 hover:border-paper-faint/30 hover:bg-ink-raised'
                  }`}
                >
                  {isCur && (
                    <motion.div
                      layoutId="preset-active-indicator"
                      className="absolute inset-0 rounded-xl border-2 border-cinnabar pointer-events-none"
                      transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                    />
                  )}

                  <div className="flex items-center justify-between w-full pb-1">
                    <div className="flex items-center gap-1.5">
                      <Icon
                        size={14}
                        className={isCur ? 'text-cinnabar-soft' : 'text-paper-muted group-hover:text-paper'}
                      />
                      <span className={`text-[12.5px] font-display ${isCur ? 'font-bold text-paper' : 'text-paper-muted'}`}>
                        {p.name}
                      </span>
                    </div>
                    {isCur ? (
                      <Check size={11} className="text-cinnabar-soft" strokeWidth={3} />
                    ) : (
                      <span className="font-mono text-[8.5px] text-paper-faint">{p.count}源</span>
                    )}
                  </div>
                  <p className="line-clamp-1 font-mono text-[8.5px] text-paper-faint">
                    {p.desc}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <TabBar active="today" />
    </div>
  )
}
