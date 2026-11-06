import { motion } from 'framer-motion'
import { CATEGORIES } from '../../lib/demo'

/* 顶部分类轨 —— 复刻 src/components/CategoryRail.tsx：
 * 选中态为字重变化，朱砂书签指示条在分类项间弹簧滑动。 */
export function CategoryRail({
  active,
  onChange,
  layoutId = 'rail-indicator',
}: {
  active: string
  onChange: (c: string) => void
  layoutId?: string
}) {
  return (
    <div
      className="page-x horizontal-scroll-rail scroll-hidden mask-fade-x relative flex gap-0.5 overflow-x-auto"
      role="tablist"
      aria-label="新闻分类"
    >
      {CATEGORIES.map((category) => {
        const isActive = category === active
        return (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(category)}
            className="relative shrink-0 px-3 py-1.5 text-paper hover:opacity-95"
          >
            <span
              className={`block whitespace-nowrap font-display text-[14px] sm:text-[14.5px] leading-none tracking-[0.012em] transition-colors duration-200 ${
                isActive ? 'font-medium text-paper' : 'font-normal text-paper/75'
              }`}
            >
              {category}
            </span>
            <span className="mx-auto mt-1.5 block h-px w-4 opacity-0" aria-hidden />
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="pointer-events-none absolute bottom-1 left-1/2 h-[2.5px] w-4 -translate-x-1/2 rounded-full bg-cinnabar shadow-[0_1px_5px_rgba(196,92,74,0.4)]"
                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
