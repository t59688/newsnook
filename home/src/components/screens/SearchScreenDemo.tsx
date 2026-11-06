import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Search, ShieldCheck, X } from 'lucide-react'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

const MOCK_RESULTS = [
  {
    source: '澎湃·特稿',
    title: '回到县城的人们：关于产业转移的十年跟踪观察',
    snippet: '…当产业沿着交通线向内陆铺开，中西部县城承接了大量从沿海迁移的电子与轻工产业…',
    time: '2 小时前',
    tag: '正文匹配',
  },
  {
    source: '晚点 LatePost',
    title: '汽车产业链转移与下沉重塑',
    snippet: '…主机厂的供应商正在向低成本区域进行梯次产业转移…',
    time: '昨天',
    tag: '标题匹配',
  },
  {
    source: '少数派',
    title: '知识工作者的工具转移与数字化归宿',
    snippet: '…我把整个笔记与阅读工作流完成了本地离线迁移…',
    time: '3 天前',
    tag: '已收藏',
  },
]

const SEARCH_SCOPES = ['全部', '正文匹配', '标题匹配', '已收藏']

/* 本地离线搜索真机界面 —— 严格复刻 src/screens/settings/LocalSearchScreen.tsx：
 * 原生顶栏 + 自动打字动效 + 范围筛选胶囊 + 0 次网络请求与 12ms 离线耗时指标 + 高亮匹配卡片。 */
export function SearchScreenDemo() {
  const [query, setQuery] = useState('')
  const [activeScope, setActiveScope] = useState('全部')

  const textToType = '产业转移'

  // 自动打字检索动效
  useEffect(() => {
    let i = 0
    const timer = setInterval(() => {
      if (i < textToType.length) {
        i++
        setQuery(textToType.slice(0, i))
      }
    }, 380)

    return () => clearInterval(timer)
  }, [])

  return (
    <div className="relative flex h-full flex-col bg-ink text-paper select-none">
      {/* 搜索栏与过滤范围 */}
      <header className="relative z-20 shrink-0 border-b border-haze/40 bg-ink/95 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="p-2.5 pt-1 space-y-2">
          <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="返回"
            className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-paper/8 hover:text-paper shrink-0"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>

          <label className="flex min-h-8.5 flex-1 items-center gap-2 rounded-xl border border-cinnabar/60 bg-ink-raised px-3 shadow-inner">
            <Search size={13} className="text-cinnabar shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索离线正文、标题与稍后读…"
              className="flex-1 bg-transparent font-mono text-[11.5px] text-paper outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-paper-faint hover:text-paper"
              >
                <X size={13} />
              </button>
            )}
          </label>
        </div>

        {/* 范围过滤标签轨 */}
        <div className="flex items-center gap-1 overflow-x-auto scroll-hidden pt-0.5">
          {SEARCH_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => setActiveScope(scope)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[9px] transition-colors ${
                activeScope === scope
                  ? 'bg-cinnabar/20 text-cinnabar-soft font-bold border border-cinnabar/40'
                  : 'border border-haze text-paper-faint hover:text-paper'
              }`}
            >
              {scope}
            </button>
          ))}
        </div>

        {/* 亮点胶囊：显示命中数和「0 次网络请求」 */}
        <div className="flex items-center justify-between font-mono text-[9.5px] pt-0.5">
          <span className="flex items-center gap-1 rounded-full bg-cinnabar/15 px-2 py-0.5 text-cinnabar-soft font-semibold">
            <ShieldCheck size={11} /> 0 次网络请求
          </span>
          <span className="text-paper-muted">
            耗时 <span className="text-paper font-bold">12ms</span> · 命中 <span className="text-cinnabar-soft font-bold">14</span> 条
          </span>
        </div>
        </div>
      </header>

      {/* 检索结果列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 space-y-2">
        {MOCK_RESULTS.map((res, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="rounded-xl border border-haze/70 bg-ink-raised/40 p-2.5 space-y-1 hover:border-paper-faint/40 transition-colors"
          >
            <div className="flex items-center justify-between font-mono text-[9px] text-paper-faint">
              <span className="text-cinnabar-soft font-medium">{res.source}</span>
              <span>{res.tag} · {res.time}</span>
            </div>

            <div className="text-[12.5px] font-bold text-paper line-clamp-1">
              {res.title.replace('产业转移', '【产业转移】')}
            </div>

            <div className="text-[10.5px] leading-relaxed text-paper-muted line-clamp-2 font-mono">
              {res.snippet}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
