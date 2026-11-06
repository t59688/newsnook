import { useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, FileUp, Search } from 'lucide-react'
import { RSS_CATALOG_COUNT } from '../../lib/demo'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

interface SourceItem {
  id: string
  name: string
  category: string
  enabled: boolean
  url: string
  feedsCount: number
}

const INITIAL_SOURCES: SourceItem[] = [
  { id: 's1', name: '晚点 LatePost', category: '商业深度', enabled: true, url: 'latepost.com/feed', feedsCount: 2 },
  { id: 's2', name: '财联社·电报', category: '市场快讯', enabled: true, url: 'cls.cn/telegraph/rss', feedsCount: 1 },
  { id: 's3', name: '量子位', category: 'AI 前沿', enabled: true, url: 'qbitai.com/feed', feedsCount: 2 },
  { id: 's4', name: '少数派 sspai', category: '效率生活', enabled: false, url: 'sspai.com/feed', feedsCount: 1 },
  { id: 's5', name: 'BBC 中文', category: '全球视野', enabled: true, url: 'bbc.com/zhongwen/simp/rss', feedsCount: 3 },
  { id: 's6', name: '中科院物理所', category: '基础科学', enabled: false, url: 'iop.cas.cn/rss', feedsCount: 1 },
  { id: 's7', name: '虎嗅网', category: '商业创新', enabled: true, url: 'huxiu.com/rss/0.xml', feedsCount: 2 },
]

const STORE_CATS = ['全部', '商业深度', 'AI 前沿', '效率生活', '全球视野', '基础科学']

/* 订阅源商店与 OPML 真机界面 —— 严格复刻 src/screens/settings/FeedStoreScreen.tsx：
 * 头部返回导航 + 离线检索输入框 + 34,270 源离线目录库指标 + 分类标签 +
 * 订阅源卡片与弹簧 Toggle 开关 + OPML 树导入导出。 */
export function StoreScreenDemo() {
  const [sources, setSources] = useState(INITIAL_SOURCES)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeCat, setActiveCat] = useState('全部')
  const [opmlExported, setOpmlExported] = useState(false)

  const toggleSource = (id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    )
  }

  const filtered = sources.filter((s) => {
    const matchCat = activeCat === '全部' || s.category === activeCat
    const matchQ = !searchQuery || s.name.includes(searchQuery) || s.category.includes(searchQuery)
    return matchCat && matchQ
  })

  const enabledCount = sources.filter((s) => s.enabled).length

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
              RSS 订阅商店
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpmlExported(true)
              setTimeout(() => setOpmlExported(false), 2200)
            }}
            className="flex items-center gap-1 rounded-full border border-cinnabar/60 bg-cinnabar/10 px-2.5 py-1 font-mono text-[9px] text-cinnabar-soft font-semibold hover:bg-cinnabar/20"
          >
            <FileUp size={10} />
            <span>{opmlExported ? '✓ 已生成标准 OPML' : '导出 OPML 树'}</span>
          </button>
        </div>
      </header>

      {/* 搜索与分类导航 */}
      <div className="border-b border-haze/40 bg-ink-raised/30 p-2.5 space-y-2">
        <div className="relative flex items-center">
          <Search size={13} className="absolute left-2.5 text-paper-faint pointer-events-none" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`搜索 ${RSS_CATALOG_COUNT.toLocaleString()} 个离线收录源…`}
            className="w-full rounded-xl border border-haze bg-ink py-1.5 pl-8 pr-3 font-mono text-[11px] text-paper outline-none focus:border-cinnabar/60"
          />
        </div>

        <div className="horizontal-scroll-rail scroll-hidden mask-fade-x flex gap-1 overflow-x-auto pb-0.5">
          {STORE_CATS.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCat(cat)}
              className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9.5px] transition-colors ${
                activeCat === cat
                  ? 'bg-cinnabar/20 text-cinnabar-soft font-semibold border border-cinnabar/40'
                  : 'text-paper-muted hover:text-paper border border-haze/60 bg-ink-raised/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* 状态统计条 */}
      <div className="flex items-center justify-between border-b border-haze/30 bg-ink-raised/20 px-3.5 py-1 font-mono text-[9.5px]">
        <span className="text-paper-muted">
          已启用 <span className="text-cinnabar-soft font-bold">{enabledCount}</span> / {sources.length} 个信源
        </span>
        <span className="text-paper-faint">
          本地离线数据库 · 零网络探测
        </span>
      </div>

      {/* 订阅源开关列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-1.5">
        {filtered.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between rounded-xl border border-haze/70 bg-ink-raised/40 p-2.5 transition-colors hover:border-paper-faint/30"
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper/5 font-display text-[12px] font-bold text-paper border border-haze">
                {s.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-display text-[13px] font-medium text-paper truncate">
                    {s.name}
                  </span>
                  <span className="rounded bg-ink px-1.5 py-0.2 font-mono text-[8px] text-paper-faint border border-haze/50">
                    {s.category}
                  </span>
                </div>
                <div className="truncate font-mono text-[9px] text-paper-faint mt-0.5">
                  {s.url}
                </div>
              </div>
            </div>

            {/* 真实可点弹簧开关 */}
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              onClick={() => toggleSource(s.id)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${
                s.enabled ? 'bg-cinnabar' : 'bg-paper/20'
              }`}
            >
              <motion.span
                layout
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md ${
                  s.enabled ? 'left-[22px]' : 'left-[2px]'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
