import { useState } from 'react'
import type { MotionValue } from 'framer-motion'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCw, Search, Sparkles } from 'lucide-react'
import { articlesFor, type DemoArticle } from '../../lib/demo'
import { BrandLogo } from './BrandLogo'
import { CategoryRail } from './CategoryRail'
import { ArticleRow } from './ArticleRow'
import { LeadStory } from './LeadStory'
import { TabBar } from './TabBar'
import { PhoneStatusBar } from './PhoneStatusBar'

/* 速闻信息流 —— 严格复刻 FeedScreen.tsx 真实结构：
 * 头部品牌 (BrandLogo + 品牌标语) + CategoryRail + 沉浸式 LeadStory + ArticleRow + 底部 TabBar。 */
export function FeedDemo({
  onOpen,
  layoutId = 'rail-indicator',
  interactive = true,
  contentY,
}: {
  onOpen?: (a: DemoArticle) => void
  layoutId?: string
  interactive?: boolean
  contentY?: MotionValue<number>
}) {
  const [category, setCategory] = useState('推荐')
  const [refreshing, setRefreshing] = useState(false)
  const list = articlesFor(category)
  const [lead, ...rest] = list

  const handleRefresh = () => {
    if (!interactive || refreshing) return
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 800)
  }

  return (
    <div className="ink-grain relative flex h-full flex-col bg-ink">
      <header className="relative z-20 shrink-0 border-b border-haze/30 bg-ink/92 pb-1 backdrop-blur-xl">
        <PhoneStatusBar />
        <div className="page-x flex items-center justify-between gap-2">
          {/* 左侧：有所闻品牌印章与标语（复刻 FeedScreen 结构） */}
          <div className="flex min-w-0 items-center gap-2 py-0.5">
            <BrandLogo size={17} tight className="h-4 w-auto shrink-0" />
            <span className="truncate whitespace-nowrap font-display text-[13px] tracking-[0.03em] text-paper-muted leading-none">
              更大的世界，更好的判断
            </span>
          </div>

          {/* 右侧：离线搜索与直连刷新控制 */}
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="搜索"
              title="本地离线搜索"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-paper-muted transition-all hover:bg-ink-raised hover:text-paper active:scale-95"
            >
              <Search size={14} strokeWidth={1.7} />
            </button>
            <button
              type="button"
              aria-label="刷新"
              onClick={handleRefresh}
              title="直连拉取最新信息流"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-paper-muted transition-all hover:bg-ink-raised hover:text-paper active:scale-95"
            >
              <RotateCw
                size={14}
                strokeWidth={1.7}
                className={refreshing ? 'animate-spin text-cinnabar' : ''}
              />
            </button>
          </div>
        </div>

        <div className="mt-1">
          <CategoryRail
            active={category}
            onChange={(c) => interactive && setCategory(c)}
            layoutId={layoutId}
          />
        </div>

        <div className="h-px w-full overflow-hidden bg-transparent">
          <span className="block h-px w-full origin-left bg-gradient-to-r from-cinnabar/80 via-paper/20 to-transparent" />
        </div>
      </header>

      {/* 直连刷新提示条 */}
      <AnimatePresence>
        {refreshing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 26, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="flex items-center justify-center gap-1.5 bg-cinnabar/15 font-mono text-[9.5px] text-cinnabar-soft"
          >
            <Sparkles size={11} className="animate-spin" />
            <span>直连上游获取最新条目中…</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain bg-ink">
        <motion.div style={contentY ? { y: contentY } : undefined}>
          {lead && <LeadStory article={lead} onOpen={onOpen} />}
          <div className="page-x flex items-center gap-2.5 pt-4 pb-2">
            <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-paper-muted/90">
              {category === '推荐' ? '今日个性化精选' : `${category} · 今日最新`}
            </span>
            <span className="h-px w-8 bg-gradient-to-r from-haze/80 to-transparent" aria-hidden />
          </div>
          <ul className="divide-y divide-haze/35 pb-3">
            {rest.map((a) => (
              <ArticleRow key={a.id} article={a} onOpen={onOpen} />
            ))}
          </ul>
        </motion.div>
      </div>

      <TabBar active="today" />
    </div>
  )
}
