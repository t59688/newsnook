import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCw, Search, Sparkles } from 'lucide-react'
import { articlesFor, type DemoArticle } from '../../lib/demo'
import { BrandLogo } from '../app/BrandLogo'
import { CategoryRail } from '../app/CategoryRail'
import { ArticleRow } from '../app/ArticleRow'
import { LeadStory } from '../app/LeadStory'
import { TabBar } from '../app/TabBar'
import { ReaderDemo } from '../app/ReaderDemo'
import { PhoneStatusBar } from '../app/PhoneStatusBar'

/* 速闻信息流全功能真机界面 —— 严格复刻 FeedScreen.tsx：
 * 顶部标语 + CategoryRail + 沉浸式头条 + 条目流 + 底栏。点按任意文章呼出站内阅读器。 */
export function FeedScreenDemo() {
  const [category, setCategory] = useState<string>('推荐')
  const [refreshing, setRefreshing] = useState(false)
  const [openedArticle, setOpenedArticle] = useState<DemoArticle | null>(null)

  const list = articlesFor(category)
  const [lead, ...rest] = list

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 700)
  }

  if (openedArticle) {
    return (
      <div className="relative h-full flex flex-col bg-ink">
        <ReaderDemo
          article={{
            source: openedArticle.source,
            time: openedArticle.time,
            title: openedArticle.title,
            summary: openedArticle.summary,
          }}
          onClose={() => setOpenedArticle(null)}
        />
      </div>
    )
  }

  return (
    <div className="ink-grain relative flex h-full flex-col bg-ink text-paper">
      {/* 头部导航与品牌 */}
      <header className="relative z-20 shrink-0 border-b border-haze/30 bg-ink/94 pb-1 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="page-x flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 py-0.5">
            <BrandLogo size={17} tight className="h-4 w-auto shrink-0" />
            <span className="truncate whitespace-nowrap font-display text-[13px] tracking-[0.03em] text-paper-muted leading-none">
              更大的世界，更好的判断
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="搜索"
              title="本地离线搜索"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-ink-raised hover:text-paper active:scale-95 transition-transform"
            >
              <Search size={14} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              aria-label="刷新"
              title="直连上游拉取"
              className="flex h-7 w-7 items-center justify-center rounded-full text-paper-muted hover:bg-ink-raised hover:text-paper active:scale-95 transition-transform"
            >
              <RotateCw
                size={14}
                strokeWidth={1.8}
                className={refreshing ? 'animate-spin text-cinnabar' : ''}
              />
            </button>
          </div>
        </div>

        {/* 墨砚分类横滑轨 */}
        <div className="mt-1">
          <CategoryRail
            active={category}
            onChange={(c) => setCategory(c)}
            layoutId="feed-screen-indicator"
          />
        </div>

        <div className="h-px w-full overflow-hidden bg-transparent">
          <span className="block h-px w-full origin-left bg-gradient-to-r from-cinnabar/80 via-paper/20 to-transparent" />
        </div>
      </header>

      {/* 直连刷新提示 */}
      <AnimatePresence>
        {refreshing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 26, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-center gap-1.5 bg-cinnabar/15 font-mono text-[9.5px] text-cinnabar-soft"
          >
            <Sparkles size={11} className="animate-spin" />
            <span>直连 153 个信源获取最新条目…</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 新闻信息流列表 */}
      <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain bg-ink">
        <AnimatePresence mode="wait">
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {lead && (
              <LeadStory
                article={lead}
                onOpen={(a) => setOpenedArticle(a)}
              />
            )}

            <div className="page-x flex items-center gap-2.5 pt-4 pb-2">
              <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-paper-muted/90">
                {category === '推荐' ? '今日个性化精选' : `${category} · 今日最新`}
              </span>
              <span className="h-px w-8 bg-gradient-to-r from-haze/80 to-transparent" aria-hidden />
            </div>

            <ul className="divide-y divide-haze/35 pb-4">
              {rest.map((a) => (
                <ArticleRow
                  key={a.id}
                  article={a}
                  onOpen={(art) => setOpenedArticle(art)}
                />
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>

      <TabBar active="today" />
    </div>
  )
}
