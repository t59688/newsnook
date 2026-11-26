import { useState } from 'react'
import { BookOpen, BookmarkPlus, Languages, Moon, Share2, Sun, Volume2, X } from 'lucide-react'
import { READER_ARTICLE } from '../../lib/demo'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

const PAGES = [
  '十年前的冬天，陈礼明从东莞的电子厂回到湖南老家时，县城能提供的岗位只有两种：工地，或者开车。他在两者之间选了后者，每天在县城与乡镇之间跑两百公里，一个月挣四千二。',
  '变化是从第三年开始的。先是食品加工厂搬进了开发区，然后是电子配件厂，再后来连做跨境电商仓储的也来了。到去年冬天，陈礼明在一家做小家电出口的工厂做了组长，月薪六千八，走路十五分钟上班。',
  '我们的跟踪调查试图回答一个朴素的问题：当产业沿着交通线向内陆铺开，人、家庭和县城会因此变成什么样？答案并不总是励志的——但留下已经不再是一个需要道歉的决定。',
]

export function EinkScreenDemo() {
  const [page, setPage] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scale, setScale] = useState(1)
  const [inverted, setInverted] = useState(false)
  const [volumeFeedback, setVolumeFeedback] = useState<string | null>(null)

  const a = READER_ARTICLE
  const fs = (14.5 * scale).toFixed(1)

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
      setVolumeFeedback('音量+ 翻上一页')
    } else {
      setPage((p) => Math.min(PAGES.length - 1, p + 1))
      setVolumeFeedback('音量- 翻下一页')
    }
    setTimeout(() => setVolumeFeedback(null), 1000)
  }

  return (
    <div
      data-eink="1"
      className={`relative flex h-full flex-col select-none transition-colors duration-0 ${
        inverted ? 'bg-black text-white' : 'bg-[#f5f3ec] text-[#111111]'
      }`}
    >
      {/* 墨水屏顶栏（沉浸式无缝顶栏） */}
      <header className="flex flex-col border-b border-black/15 bg-inherit">
        <PhoneStatusBar />
        <div className="flex items-center justify-between px-4 py-1.5 font-mono text-[10px]">
          <span className="font-bold tracking-wider">{a.source}</span>
          <span className="flex items-center gap-1.5 opacity-75">
            <span>第 {page + 1} / {PAGES.length} 页</span>
            <span>·</span>
            <span>整页分页模式</span>
          </span>
        </div>
      </header>

      {/* 分页视口 */}
      <div
        className="relative flex-1 overflow-hidden p-5 cursor-pointer"
        onClick={(e) => handleTap(e.nativeEvent.offsetX, e.currentTarget.clientWidth)}
      >
        {page === 0 && (
          <div className="mb-3">
            <div className="font-mono text-[9px] opacity-70">
              {a.time} · 站内全文
            </div>
            <h2
              className="font-display font-bold mt-1 text-justify"
              style={{ fontSize: `calc(${fs}px * 1.45)`, lineHeight: 1.25 }}
            >
              {a.title}
            </h2>
            <div className="mt-2 h-px w-full bg-current opacity-20" />
          </div>
        )}

        <p
          className="leading-[1.85] text-justify"
          style={{ fontSize: `${fs}px`, textIndent: '2em' }}
        >
          {PAGES[page]}
        </p>

        {/* 底部页码 */}
        <div className="absolute inset-x-5 bottom-2.5 flex items-center justify-between border-t border-current/15 pt-1.5 font-mono text-[9px] opacity-75">
          <span>第 {page + 1} / {PAGES.length} 页</span>
          <span>剩余约 2 分钟</span>
        </div>

        {/* EinkReaderMenu 弹出控制抽屉 */}
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className={`absolute inset-x-0 bottom-0 z-40 border-t-2 p-4 ${
              inverted ? 'border-white/30 bg-[#161616] text-white' : 'border-black/30 bg-[#eae7de] text-black'
            }`}
          >
            <div className="flex items-center justify-between pb-2 border-b border-current/20">
              <span className="font-mono text-[11px] font-bold">墨水屏阅读控制</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="p-1 rounded border border-current"
              >
                <X size={13} />
              </button>
            </div>

            <div className="mt-2.5 flex items-center justify-between font-mono text-[10.5px]">
              <span>字号:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(0.85, s - 0.08))}
                  className="px-2 py-0.5 rounded border border-current font-bold"
                >
                  A -
                </button>
                <span className="w-10 text-center">{fs}px</span>
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.min(1.25, s + 0.08))}
                  className="px-2 py-0.5 rounded border border-current font-bold"
                >
                  A +
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-5 gap-1 pt-2 border-t border-current/15 text-center font-mono text-[9px]">
              <button type="button" className="p-1 rounded border border-current/30 flex flex-col items-center gap-0.5">
                <BookOpen size={12} /><span>目录</span>
              </button>
              <button type="button" className="p-1 rounded border border-current/30 flex flex-col items-center gap-0.5">
                <BookmarkPlus size={12} /><span>稍后读</span>
              </button>
              <button type="button" className="p-1 rounded border border-current/30 flex flex-col items-center gap-0.5">
                <Languages size={12} /><span>翻译</span>
              </button>
              <button
                type="button"
                onClick={() => setInverted(!inverted)}
                className="p-1 rounded border border-current/30 flex flex-col items-center gap-0.5"
              >
                {inverted ? <Sun size={12} /> : <Moon size={12} />}<span>反色</span>
              </button>
              <button type="button" className="p-1 rounded border border-current/30 flex flex-col items-center gap-0.5">
                <Share2 size={12} /><span>短链</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部物理按键翻页模拟条 */}
      <div className="border-t border-black/15 bg-black/5 px-4 py-2 flex items-center justify-between font-mono text-[9.5px]">
        <div className="flex items-center gap-2">
          <Volume2 size={12} />
          <span>音量键翻页：</span>
          <button
            type="button"
            onClick={() => triggerVolume('up')}
            className="rounded border border-current px-2 py-0.2"
          >
            音量+
          </button>
          <button
            type="button"
            onClick={() => triggerVolume('down')}
            className="rounded border border-current px-2 py-0.2"
          >
            音量-
          </button>
        </div>
        {volumeFeedback && (
          <span className="font-bold underline">{volumeFeedback}</span>
        )}
      </div>
    </div>
  )
}
