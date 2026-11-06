import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedDemo } from '../components/app/FeedDemo'
import { ReaderDemo } from '../components/app/ReaderDemo'
import { Section } from './Section'
import { BUILTIN_SOURCES_COUNT, type DemoArticle } from '../lib/demo'

/* 速闻区块：条目可点——点中的行让阅读器从底部升起（App 的 reader-in 动势），
 * 返回键平滑收回，核心交互闭环在门户里真实可测。 */
export function FeedSection() {
  const reduced = useReducedMotion()
  const [open, setOpen] = useState<DemoArticle | null>(null)

  return (
    <Section
      id="feed"
      kicker="速闻信息流"
      title={
        <>
          {BUILTIN_SOURCES_COUNT} 个内置信源，
          <br />
          直连上游，不经中转。
        </>
      }
      desc="所有新闻列表均由客户端直接向发布方站点拉取：分类轨横滑无缝切换，未读以朱砂点提示，已读自动淡化，稍后读书签与「已预存」离线标识一目了然。点按任意条目试试——站内阅读器会当场升起。"
      points={[
        '网易 / 财联社 / 晚点 / 少数派 / BBC 中文 / MIT TR / Hacker News……8 大领域深度注册',
        '下拉刷新与双击底栏回到顶部，水墨涟漪回弹动画',
        '长按信源筛选 chips 可自定义调整分类、临时暂停抓取',
        '支持自建 RSS/Atom 源与知乎、LINUX DO 社区工作区独立接入',
      ]}
      demo={
        <div className="relative mx-auto w-full max-w-[340px]">
          <PhoneFrame className="h-[600px]" time="09:30">
            <div className="relative h-full">
              <FeedDemo onOpen={(a) => setOpen(a)} />
              <AnimatePresence>
                {open && (
                  <motion.div
                    className="absolute inset-0 z-40 overflow-hidden"
                    initial={reduced ? { opacity: 0 } : { y: '100%' }}
                    animate={reduced ? { opacity: 1 } : { y: 0 }}
                    exit={reduced ? { opacity: 0 } : { y: '100%' }}
                    transition={{ duration: reduced ? 0.15 : 0.38, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <ReaderDemo
                      article={{
                        source: open.source,
                        time: open.time,
                        title: open.title,
                        summary: open.summary,
                      }}
                      onClose={() => setOpen(null)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </PhoneFrame>
        </div>
      }
    />
  )
}
