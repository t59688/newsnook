import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

/* 区块按内容出场：滚到位置播一次，往回滚不重播。
 * 手感取自应用 --ease-ink（流淌：气压闭门器），主角先到、其余被带出。 */
export function Reveal({
  children,
  delay = 0,
  y = 28,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  if (reduced) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  )
}

/**
 * 大标题从遮罩里升起。
 * 注意：被裁切的内层不能用 whileInView——overflow-hidden 会让 IntersectionObserver
 * 判定它不在视口内。观察外层、动画给内层，靠 variants 传递。
 */
export function MaskRise({
  text,
  className = '',
  delay = 0,
  onMount = false,
}: {
  text: string
  className?: string
  delay?: number
  onMount?: boolean
}) {
  const reduced = useReducedMotion()
  if (reduced) return <span className={className}>{text}</span>

  const v = {
    hidden: { y: '108%', opacity: 0 },
    show: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.85,
        ease: [0.22, 1, 0.36, 1] as const,
        delay,
      },
    },
  }

  if (onMount) {
    return (
      <span className="inline-block overflow-hidden align-top">
        <motion.span
          className={`inline-block ${className}`}
          variants={v}
          initial="hidden"
          animate="show"
        >
          {text}
        </motion.span>
      </span>
    )
  }

  return (
    <motion.span
      className="inline-block overflow-hidden align-top"
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-10% 0px' }}
    >
      <motion.span className={`inline-block ${className}`} variants={v}>
        {text}
      </motion.span>
    </motion.span>
  )
}
