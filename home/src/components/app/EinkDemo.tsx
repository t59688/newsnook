import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookmarkPlus,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Languages,
  Moon,
  Share2,
  Sun,
  Volume2,
  X,
} from 'lucide-react'
import { READER_ARTICLE } from '../../lib/demo'

/* 墨水屏分页阅读 —— 严格复刻 features/eink 及 EinkReaderMenu：
 * 1. 彻底压制过渡与阴影，极致黑白灰对比；
 * 2. 点按分区：左 28% 上一页、中间 44% 呼出菜单、右 28% 下一页；
 * 3. EinkReaderMenu 真实底抽屉：字号步进器、进度滑杆、五宫格快捷键；
 * 4. 音量键物理翻页响应指示。 */
const PAGES = [
  [
    '十年前的冬天，陈礼明从东莞的电子厂回到湖南老家时，县城能提供的岗位只有两种：工地，或者开车。他在两者之间选了后者，每天在县城与乡镇之间跑两百公里，一个月挣四千二。',
    '变化是从第三年开始的。先是食品加工厂搬进了开发区，然后是电子配件厂，再后来连做跨境电商仓储的也来了。到去年冬天，陈礼明在一家做小家电出口的工厂做了组长，月薪六千八，走路十五分钟上班。',
    '「不是我们选择了回来，是工作自己走过来了。」他在电话里说。',
  ],
  [
    '我们的跟踪调查试图回答一个朴素的问题：当产业沿着交通线向内陆铺开，人、家庭和县城会因此变成什么样？',
    '在安徽六安，三十四岁的李桂芳把在义乌学的电商运营用回了自家茶厂；在河南周口，曾经的外卖骑手孙磊成了产业园的电工班班长。',
    '答案并不总是励志的——有人错过了沿海最后的红利，有人把孩子留在了原地。',
  ],
  [
    '也有人第一次觉得，留下不是一个需要道歉的决定。县城的房产中介老周说，这两年看房的年轻人明显多了，「他们问的第一句话从『房价多少』变成了『离产业园多远』。」',
    '学校、医院、商超跟着人口回流重新排布。过去空转的乡镇班车，现在一天跑六个来回。',
  ],
  [
    '十年时间，47 个人，三个省，十一个县。我们把他们的故事放在数据旁边，发现两者讲的是同一件事：产业不是抽象的曲线，它最终会落到一个人「要不要回来」的具体决定上。',
  ],
]

export function EinkDemo() {
  const [page, setPage] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [inverted, setInverted] = useState(false) // 昼夜反转
  const [volumeFeedback, setVolumeFeedback] = useState<string | null>(null)

  const a = READER_ARTICLE
  const fs = (15.5 * scale).toFixed(1)

  const handleTap = (x: number, w: number) => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }
    if (x < w * 0.28) {
      setPage((p) => Math.max(0, p - 1))
    } else if (x > w * 0.72) {
      setPage((p) => Math.min(PAGES.length - 1, p + 1))
    } else {
      setMenuOpen(true)
    }
  }

  const triggerVolume = (dir: 'up' | 'down') => {
    if (dir === 'up') {
      setPage((p) => Math.max(0, p - 1))
      setVolumeFeedback('音量+ · 翻上一页')
    } else {
      setPage((p) => Math.min(PAGES.length - 1, p + 1))
      setVolumeFeedback('音量- · 翻下一页')
    }
    setTimeout(() => setVolumeFeedback(null), 1200)
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* 墨水屏设备外框（无倾角、比例端正） */}
      <div
        data-eink="1"
        className={`relative overflow-hidden rounded-[2.2rem] border-[4px] border-paper/30 shadow-2xl transition-colors duration-0 ${
          inverted ? 'bg-black text-white' : 'bg-[#f4f2ec] text-[#111111]'
        }`}
      >
        {/* 顶部纯粹状态条 */}
        <header className="flex select-none items-center justify-between border-b border-black/10 px-6 py-2.5 font-mono text-[11px]">
          <span className="font-semibold tracking-[0.16em]">{a.source}</span>
          <span className="flex items-center gap-2">
            <span>电量 88%</span>
            <span>墨水屏分页模式</span>
          </span>
        </header>

        {/* 真实分页阅读视口 */}
        <div
          className="relative h-[420px] cursor-pointer select-none overflow-hidden px-8 pt-5"
          onClick={(e) => handleTap(e.nativeEvent.offsetX, e.currentTarget.clientWidth)}
        >
          {page === 0 && (
            <div className="mb-4">
              <span className="font-mono text-[10px] tracking-[0.16em] opacity-70">
                {a.time} · 站内全文
              </span>
              <h3
                className="font-display font-bold tracking-tight mt-1"
                style={{ fontSize: `calc(${fs}px * 1.55)`, lineHeight: 1.25 }}
              >
                {a.title}
              </h3>
              <div className="mt-2 h-px w-full bg-black/15" />
            </div>
          )}

          <div className="space-y-4">
            {PAGES[page].map((para, i) => (
              <p
                key={i}
                className="leading-[1.85] text-justify"
                style={{ fontSize: `${fs}px`, textIndent: '2em' }}
              >
                {para}
              </p>
            ))}
          </div>

          {/* 底部页码与阅读预估 */}
          <div className="absolute inset-x-8 bottom-3 flex select-none items-center justify-between border-t border-black/10 pt-2 font-mono text-[10px] opacity-75">
            <span>第 {page + 1} / {PAGES.length} 页</span>
            <span>剩余约 2 分钟</span>
          </div>

          {/* 点按区域辅助半透明提示（仅未开菜单时可见） */}
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-10 flex opacity-15">
            <div className="flex w-[28%] items-center justify-start pl-2 font-mono text-[9px]">
              <ChevronLeft size={14} /> 上一页
            </div>
            <div className="flex w-[44%] items-center justify-center font-mono text-[9px]">
              点此唤起菜单
            </div>
            <div className="flex w-[28%] items-center justify-end pr-2 font-mono text-[9px]">
              下一页 <ChevronRight size={14} />
            </div>
          </div>

          {/* EinkReaderMenu 真实底抽屉 */}
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ y: 220 }}
                animate={{ y: 0 }}
                exit={{ y: 220 }}
                transition={{ duration: 0 }} // Eink 零动效立即切换
                onClick={(e) => e.stopPropagation()}
                className={`absolute inset-x-0 bottom-0 z-40 border-t-2 p-5 ${
                  inverted ? 'border-white/30 bg-[#161616] text-white' : 'border-black/30 bg-[#eae7de] text-black'
                }`}
              >
                <div className="flex items-center justify-between pb-3 border-b border-current/20">
                  <span className="font-mono text-[12px] font-bold tracking-wider">墨水屏阅读控制</span>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    className="p-1 rounded border border-current"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* 字号调节 */}
                <div className="mt-3 flex items-center justify-between font-mono text-[11px]">
                  <span>字号调节</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setScale((s) => Math.max(0.85, s - 0.08))}
                      className="px-2.5 py-1 rounded border border-current font-bold"
                    >
                      A -
                    </button>
                    <span className="w-12 text-center">{fs}px</span>
                    <button
                      type="button"
                      onClick={() => setScale((s) => Math.min(1.3, s + 0.08))}
                      className="px-2.5 py-1 rounded border border-current font-bold"
                    >
                      A +
                    </button>
                  </div>
                </div>

                {/* 翻页滑杆 */}
                <div className="mt-3 flex items-center gap-3 font-mono text-[11px]">
                  <span>进度</span>
                  <input
                    type="range"
                    min={0}
                    max={PAGES.length - 1}
                    value={page}
                    onChange={(e) => setPage(Number(e.target.value))}
                    className="flex-1 cursor-pointer accent-black"
                  />
                  <span>{Math.round(((page + 1) / PAGES.length) * 100)}%</span>
                </div>

                {/* 五宫格快捷操作 */}
                <div className="mt-4 grid grid-cols-5 gap-1.5 pt-2 border-t border-current/15 text-center font-mono text-[10px]">
                  <button type="button" className="p-1.5 rounded border border-current/30 flex flex-col items-center gap-1">
                    <BookOpen size={13} />
                    <span>目录</span>
                  </button>
                  <button type="button" className="p-1.5 rounded border border-current/30 flex flex-col items-center gap-1">
                    <BookmarkPlus size={13} />
                    <span>稍后读</span>
                  </button>
                  <button type="button" className="p-1.5 rounded border border-current/30 flex flex-col items-center gap-1">
                    <Languages size={13} />
                    <span>翻译</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInverted((v) => !v)}
                    className="p-1.5 rounded border border-current/30 flex flex-col items-center gap-1"
                  >
                    {inverted ? <Sun size={13} /> : <Moon size={13} />}
                    <span>反色</span>
                  </button>
                  <button type="button" className="p-1.5 rounded border border-current/30 flex flex-col items-center gap-1">
                    <Share2 size={13} />
                    <span>短链</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 外部物理快捷键模拟器 */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-haze bg-ink-raised/50 p-3">
        <div className="flex items-center gap-2 font-mono text-[11px] text-paper-muted">
          <Volume2 size={14} className="text-cinnabar" />
          <span>硬件按键翻页模拟：</span>
          <button
            type="button"
            onClick={() => triggerVolume('up')}
            className="rounded border border-haze bg-ink px-2.5 py-1 text-paper hover:bg-ink-raised active:scale-95"
          >
            音量 +
          </button>
          <button
            type="button"
            onClick={() => triggerVolume('down')}
            className="rounded border border-haze bg-ink px-2.5 py-1 text-paper hover:bg-ink-raised active:scale-95"
          >
            音量 -
          </button>
        </div>

        {volumeFeedback && (
          <span className="font-mono text-[11px] text-cinnabar-soft font-semibold">
            ✓ {volumeFeedback}
          </span>
        )}

        <div className="font-mono text-[10px] text-paper-faint">
          去动效 · 图片自适应限高 · 滚动与分页位置无损折算
        </div>
      </div>
    </div>
  )
}
