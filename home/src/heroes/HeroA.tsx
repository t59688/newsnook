import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import { PhoneFrame } from '../components/app/PhoneFrame'
import { FeedDemo } from '../components/app/FeedDemo'
import { MaskRise } from '../portal/Reveal'
import { GhostCta, PrimaryCta } from '../portal/Cta'

/* 方向 A「画面即界面」：首屏就是应用界面本身，标题长在它旁边。
 * 滑动驱动：手机与文字以不同速度分离（首屏景深），背景层动得最慢。 */
export function HeroA() {
  const stage = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end start'] })
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, -90])
  const textY = useTransform(scrollYProgress, [0, 1], [0, 64])
  const veil = useTransform(scrollYProgress, [0, 0.9], [1, 0])

  return (
    <section id="top" ref={stage} className="relative min-h-dvh overflow-hidden pt-14">
      {/* 背景层：极慢的朱砂晕，像纸背透出的印泥 */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-40 top-1/4 h-[36rem] w-[36rem] rounded-full opacity-[0.05]"
        style={{
          background: 'radial-gradient(circle, var(--tone-cinnabar) 0%, transparent 65%)',
          y: useTransform(scrollYProgress, [0, 1], [0, 30]),
        }}
      />
      <div className="page-x mx-auto grid max-w-6xl items-center gap-10 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6 lg:py-10">
        <motion.div style={{ y: textY }} className="relative z-10">
          <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-cinnabar-soft">
            <span className="h-px w-6 bg-cinnabar" aria-hidden />
            本地优先 · 新闻阅读客户端
          </p>
          <h1 className="mt-5 font-display text-[clamp(2.6rem,6.4vw,4.6rem)] leading-[1.18] text-paper">
            <span className="block">
              <MaskRise text="更大的世界，" onMount />
            </span>
            <span className="block">
              <MaskRise text="更好的判断" delay={0.08} onMount className="text-cinnabar-soft" />
            </span>
          </h1>
          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
            className="mt-6 max-w-[34rem] text-[15.5px] leading-[1.9] text-paper-muted"
          >
            有所闻是一台直连原发媒体的阅读器：订阅由你配置，列表与正文由客户端直接向上游取，
            在应用内读完。不登录即可完整使用，云同步只是可选项。
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.62 }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <PrimaryCta href="#download">下载 Android 版</PrimaryCta>
            <GhostCta href="#feed">看看它怎么读新闻</GhostCta>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.9, duration: 0.8 }}
            className="mt-9 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10.5px] tracking-[0.12em] text-paper-faint"
          >
            <span>开源 AGPL-3.0</span>
            <span aria-hidden>·</span>
            <span>轻量版 2–6 MB</span>
            <span aria-hidden>·</span>
            <span>Android / Web</span>
            <span aria-hidden>·</span>
            <span>v1.9.2</span>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 56, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
          style={{ y: phoneY }}
          className="relative mx-auto w-full max-w-[360px] lg:max-w-[380px]"
        >
          <PhoneFrame className="h-[680px] sm:h-[720px]">
            <FeedDemo />
          </PhoneFrame>
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-24 bg-gradient-to-t from-[var(--tone-ink-deep)] to-transparent"
            style={{ opacity: veil }}
          />
        </motion.div>
      </div>
    </section>
  )
}
