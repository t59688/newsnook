import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDownRight, Play, RotateCcw } from 'lucide-react'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedDemo } from '../components/app/FeedDemo'
import { ReaderDemo } from '../components/app/ReaderDemo'
import { MaskRise } from '../portal/Reveal'
import { PrimaryCta } from '../portal/Cta'
import { BUILTIN_SOURCES_COUNT, type DemoArticle } from '../lib/demo'

const TOUR_ARTICLE: DemoArticle = {
  id: 'lead-auto',
  source: '澎湃·特稿',
  title: '回到县城的人们：一份持续十年的中部就业观察',
  time: '2 小时前',
  category: '深度人文',
  summary: '我们跟踪了 47 位从沿海返乡的务工者。',
}

/** 门户首屏的主视觉是真实可交互的产品界面，不再用说明卡片与界面抢注意力。 */
export function HeroScroll() {
  const reduced = useReducedMotion()
  const [openedArticle, setOpenedArticle] = useState<DemoArticle | null>(null)
  const [autoPlaying, setAutoPlaying] = useState(false)
  const [tapPosition, setTapPosition] = useState<{ x: number; y: number } | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTour = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const startAutoTour = () => {
    clearTour()
    if (autoPlaying) {
      setAutoPlaying(false)
      setOpenedArticle(null)
      setTapPosition(null)
      return
    }
    setAutoPlaying(true)
    setOpenedArticle(null)
    setTapPosition(null)

    timerRef.current = window.setTimeout(() => {
      setTapPosition({ x: 50, y: 160 })
      timerRef.current = window.setTimeout(() => {
        setTapPosition(null)
        setOpenedArticle(TOUR_ARTICLE)
        timerRef.current = window.setTimeout(() => {
          setAutoPlaying(false)
          timerRef.current = null
        }, 3600)
      }, 700)
    }, 900)
  }

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return (
    <section id="top" className="portal-hero relative overflow-hidden">
      <div className="portal-hero-inner page-x mx-auto grid w-full max-w-6xl lg:grid-cols-[1.06fr_0.94fr]">
        <div className="portal-hero-copy relative z-10 min-w-0">
          <p className="portal-overline">
            <span className="portal-overline-mark" aria-hidden="true" />
            NEWSNOOK <span className="portal-overline-divider" aria-hidden="true">/</span> 为阅读而作
          </p>

          <h1 className="portal-hero-title font-display text-paper">
            <span className="block"><MaskRise text="更大的世界，" onMount /></span>
            <span className="block"><MaskRise text="更好的判断。" delay={0.09} onMount /></span>
          </h1>

          <p className="portal-hero-intro text-paper-muted">
            让新闻回到阅读本身。
            <span className="block">订阅你真正关心的来源，安静、完整地读完每一篇。</span>
          </p>
          <p className="portal-hero-desc text-paper-muted">
            有所闻是一款本地优先的新闻与 RSS 阅读器。从发现、全文阅读到翻译和离线收藏，让阅读节奏由你决定。
          </p>

          <div className="portal-hero-actions">
            <PrimaryCta href="#download" className="portal-primary-cta">下载 Android 版</PrimaryCta>
            <button type="button" onClick={startAutoTour} className="portal-tour-button pressable">
              {autoPlaying ? <RotateCcw size={16} strokeWidth={1.7} /> : <Play size={15} strokeWidth={1.7} />}
              {autoPlaying ? '停止演示' : '观看阅读演示'}
            </button>
          </div>

          <dl className="portal-hero-facts">
            <div>
              <dt>精选信源</dt>
              <dd>{BUILTIN_SOURCES_COUNT} <span>个内置来源</span></dd>
            </div>
            <div>
              <dt>阅读方式</dt>
              <dd>全文 <span>· 双语 · 离线</span></dd>
            </div>
            <div>
              <dt>你的选择</dt>
              <dd>本地 <span>优先保存</span></dd>
            </div>
          </dl>
        </div>

        <div className="portal-hero-visual relative min-w-0">
          <div className="portal-hero-visual-frame">
            <div className="portal-device-label" aria-hidden="true">
              <span className="portal-device-index">01 / 03</span>
              <span>从信息流，到全文</span>
            </div>

            <div className="portal-phone-wrap">
              <AnimatePresence>
                {tapPosition && !reduced && (
                  <motion.div
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: [0.8, 1.4, 1.8], opacity: [0.8, 1, 0] }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                    style={{ left: tapPosition.x + '%', top: tapPosition.y }}
                    className="pointer-events-none absolute z-50 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cinnabar bg-cinnabar/20"
                    aria-hidden="true"
                  />
                )}
              </AnimatePresence>

              <PhoneFrame className="portal-hero-phone h-[clamp(540px,77vh,660px)]" time="20:45">
                <div className="relative h-full overflow-hidden">
                  <FeedDemo interactive={!autoPlaying} onOpen={(article) => {
                    clearTour()
                    setAutoPlaying(false)
                    setOpenedArticle(article)
                  }} />
                  <AnimatePresence>
                    {openedArticle && (
                      <motion.div
                        className="absolute inset-0 z-40 overflow-hidden"
                        initial={reduced ? { opacity: 0 } : { y: '100%' }}
                        animate={reduced ? { opacity: 1 } : { y: 0 }}
                        exit={reduced ? { opacity: 0 } : { y: '100%' }}
                        transition={{ duration: reduced ? 0.15 : 0.42, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <ReaderDemo
                          article={{
                            source: openedArticle.source,
                            time: openedArticle.time,
                            title: openedArticle.title,
                            summary: openedArticle.summary,
                          }}
                          onClose={() => setOpenedArticle(null)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </PhoneFrame>
            </div>

            <div className="portal-device-caption">
              <span>可交互的产品演示</span>
              {openedArticle ? (
                <button type="button" onClick={() => setOpenedArticle(null)}>返回信息流</button>
              ) : (
                <span>点击新闻，体验站内全文</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <a href="#feed" className="portal-scroll-cue" aria-label="向下了解产品能力">
        <span>继续探索有所闻</span><ArrowDownRight size={15} strokeWidth={1.6} />
      </a>
    </section>
  )
}
