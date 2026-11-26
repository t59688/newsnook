import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { GhostCta, PrimaryCta } from '../portal/Cta'

/* 方向 B「满版文字」：品牌字标撑满首屏，滚动时缩进导航（字标收进导航）。
 * 字标让出画面的同时，下一节内容已经进入。 */
export function HeroB() {
  const stage = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end end'] })
  const scale = useTransform(scrollYProgress, [0, 0.55], [1, 0.085])
  const x = useTransform(scrollYProgress, [0, 0.55], ['0%', '-42%'])
  const y = useTransform(scrollYProgress, [0, 0.55], ['0%', '-46%'])
  const opacity = useTransform(scrollYProgress, [0, 0.45], [1, 0])
  const navMark = useTransform(scrollYProgress, [0.42, 0.6], [0, 1])
  const sub = useTransform(scrollYProgress, [0, 0.3], [1, 0])

  return (
    <section id="top" ref={stage} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-dvh flex-col overflow-hidden">
        {/* 字标 */}
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <motion.h1
            aria-label="有所闻"
            className="font-display select-none text-[clamp(4.2rem,21vw,17rem)] leading-[1.05] tracking-[0.02em] text-paper"
            style={{ scale, x, y, opacity, transformOrigin: 'center' }}
          >
            有所闻
          </motion.h1>
          <motion.p
            className="mt-6 font-mono text-[11px] tracking-[0.4em] text-paper-faint"
            style={{ opacity: sub }}
          >
            更大的世界 · 更好的判断
          </motion.p>
          <motion.div
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
            style={{ opacity: sub }}
          >
            <PrimaryCta href="#download">下载 Android 版</PrimaryCta>
            <GhostCta href="#feed">看看它怎么读新闻</GhostCta>
          </motion.div>
        </div>

        {/* 收进导航后的字标 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute left-6 top-5 flex items-center gap-2 sm:left-10"
          style={{ opacity: navMark }}
        >
          <span className="h-[7px] w-[7px] rounded-full bg-cinnabar" />
          <span className="font-display text-[15px] tracking-[0.04em] text-paper">有所闻</span>
        </motion.div>

        {/* 底部：下一节提前进入 */}
        <div className="page-x mx-auto w-full max-w-5xl pb-10">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="grid gap-6 border-t border-haze/50 pt-8 sm:grid-cols-3"
          >
            {[
              ['本地优先', '不登录、断网、云端故障，都不阻止你读完今天的新闻。'],
              ['站内全文', '打开条目就在应用内解析排版，「打开原文」只是兜底。'],
              ['可选云同步', '登录只解决一件事：换设备时不用重新配一遍。'],
            ].map(([t, d]) => (
              <div key={t}>
                <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] text-cinnabar-soft">
                  <span className="h-px w-4 bg-cinnabar" aria-hidden />
                  {t}
                </p>
                <p className="mt-2.5 text-[13.5px] leading-[1.8] text-paper-muted">{d}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}
