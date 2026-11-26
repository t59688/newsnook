import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Reveal } from './Reveal'

/* 功能区块壳：一侧文字（朱砂短线 kicker + 衬线标题 + 说明 + 要点），
 * 另一侧真实界面示意。左右交替，锚线对齐 page-x。
 * layout="centered"：文字居中在上、示意居中在下，用于打破连续分栏的节奏。 */
export function Section({
  id,
  kicker,
  title,
  desc,
  points,
  demo,
  reverse = false,
  wide = false,
  layout = 'split',
}: {
  id: string
  kicker: string
  title: ReactNode
  desc: ReactNode
  points?: string[]
  demo: ReactNode
  reverse?: boolean
  wide?: boolean
  layout?: 'split' | 'centered'
}) {
  const reduced = useReducedMotion()

  if (layout === 'centered') {
    return (
      <section id={id} className="relative py-20 sm:py-28">
        <div className="page-x mx-auto max-w-6xl">
          <Reveal className="mx-auto max-w-[46rem] text-center">
            <p className="flex items-center justify-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-paper-muted">
              <span className="h-px w-6 bg-cinnabar" aria-hidden />
              {kicker}
              <span className="h-px w-6 bg-cinnabar" aria-hidden />
            </p>
            <h2 className="mt-4 font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.3] text-paper">
              {title}
            </h2>
            <p className="mx-auto mt-4 max-w-[38rem] text-[14.5px] leading-[1.9] text-paper-muted">{desc}</p>
          </Reveal>
          <motion.div
            className="mx-auto mt-12 max-w-3xl"
            initial={reduced ? undefined : { opacity: 0, y: 40 }}
            whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px' }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
          >
            {demo}
          </motion.div>
          {points && (
            <Reveal delay={0.15}>
              <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2">
                {points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-[12.5px] text-paper-muted">
                    <span className="h-1 w-1 shrink-0 rounded-full bg-cinnabar" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </Reveal>
          )}
        </div>
      </section>
    )
  }

  return (
    <section id={id} className="relative py-20 sm:py-28">
      <div
        className={`page-x mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14 ${
          wide ? 'lg:max-w-7xl' : ''
        }`}
      >
        <Reveal className={`min-w-0 ${reverse ? 'lg:order-2' : ''}`}>
          <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.22em] text-paper-muted">
            <span className="h-px w-6 bg-cinnabar" aria-hidden />
            {kicker}
          </p>
          <h2 className="mt-4 font-display text-[clamp(1.7rem,3.4vw,2.5rem)] leading-[1.3] text-paper">
            {title}
          </h2>
          <p className="mt-4 max-w-[34rem] text-[14.5px] leading-[1.9] text-paper-muted">{desc}</p>
          {points && (
            <ul className="mt-5 space-y-2">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[13px] leading-[1.7] text-paper-muted">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-cinnabar" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </Reveal>
        <motion.div
          className={`min-w-0 ${reverse ? 'lg:order-1' : ''}`}
          initial={reduced ? undefined : { opacity: 0, y: 40 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10% 0px' }}
          transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        >
          {demo}
        </motion.div>
      </div>
    </section>
  )
}
