import { animate, stagger } from 'animejs'

function clearInlineMotion(item: HTMLElement) {
  item.style.opacity = ''
  item.style.transform = ''
}

function markRevealed(item: HTMLElement) {
  item.dataset.revealed = '1'
  clearInlineMotion(item)
}

/** 横滑切分类后立即标为已露出，避免重复执行入场动画 */
export function markRevealedAll(root: HTMLElement | null, selector = '[data-reveal]') {
  if (!root) return
  root.querySelectorAll<HTMLElement>(selector).forEach(markRevealed)
}

/** 列表入场：自上而下的墨迹渗开感。只处理尚未露出的节点，避免重复动画把已显示项打回透明。 */
export function revealItems(root: HTMLElement | null, reduced: boolean, selector = '[data-reveal]') {
  if (!root) return
  const items = [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (item) => item.dataset.revealed !== '1',
  )
  if (!items.length) return

  // 立即标记为已处理，防止并发/连续调用重复命中
  items.forEach((item) => {
    item.dataset.revealed = '1'
  })

  if (reduced) {
    items.forEach(clearInlineMotion)
    return
  }

  // 针对首屏前 8 个条目执行精致错落入场，超出部分直接就绪，杜绝长列表并发 JS 动画挤占帧率
  const animatedItems = items.slice(0, 8)
  const instantItems = items.slice(8)
  instantItems.forEach(clearInlineMotion)

  animate(animatedItems, {
    opacity: [0, 1],
    translateY: [16, 0],
    duration: 620,
    delay: stagger(30),
    ease: 'out(3)',
    onComplete: () => {
      animatedItems.forEach((item) => {
        if (item.isConnected) clearInlineMotion(item)
      })
    },
  })

  // 动画被打断或异常时兜底，确保清理 inline 样式
  const settleMs = 680 + animatedItems.length * 30
  window.setTimeout(() => {
    animatedItems.forEach((item) => {
      if (item.isConnected) clearInlineMotion(item)
    })
  }, settleMs)
}

/** Animate only the initial reading viewport, not hundreds of off-screen paragraphs. */
export function readerEntranceBudget<T>(items: readonly T[]): { animated: T[]; immediate: T[] } {
  return { animated: items.slice(0, 8), immediate: items.slice(8) }
}

/** 阅读页：标题先落定，首屏正文随后错落展开；长文其余段落立即可读。 */
export function revealReader(root: HTMLElement | null, reduced: boolean) {
  if (!root) return
  const head = root.querySelector<HTMLElement>('[data-reader-head]')
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-reader-block]')].filter(
    (b) => b.dataset.revealed !== '1',
  )

  if (head) head.dataset.revealed = '1'
  blocks.forEach((block) => {
    block.dataset.revealed = '1'
  })

  if (reduced) {
    if (head) clearInlineMotion(head)
    blocks.forEach(clearInlineMotion)
    return
  }

  if (head) {
    animate(head, {
      opacity: [0, 1],
      translateY: [18, 0],
      duration: 620,
      ease: 'out(3)',
      onComplete: () => {
        if (head.isConnected) clearInlineMotion(head)
      },
    })
  }
  const { animated, immediate } = readerEntranceBudget(blocks)
  immediate.forEach(clearInlineMotion)
  if (animated.length) {
    animate(animated, {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 640,
      delay: stagger(60, { start: 140 }),
      ease: 'out(3)',
      onComplete: () => {
        animated.forEach((block) => {
          if (block.isConnected) clearInlineMotion(block)
        })
      },
    })
  }
}

/** 刷新完成时墨点收束 */
export function inkPulse(target: HTMLElement | null, reduced: boolean) {
  if (!target || reduced) return
  animate(target, {
    scale: [1, 1.9, 0],
    opacity: [0.9, 0.35, 0],
    duration: 720,
    ease: 'out(4)',
  })
}
