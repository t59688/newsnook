/** Android ViewConfiguration 与主流 Web 手势约定采用的标准长按阈值。 */
export const STANDARD_LONG_PRESS_MS = 500
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10

const CONTEXT_MENU_GAP_PX = 8
const CONTEXT_MENU_EDGE_PX = 12

export interface Point {
  x: number
  y: number
}

interface LongPressControllerOptions<T, Timer> {
  onLongPress: (target: T, point: Point) => void
  schedule: (callback: () => void, delay: number) => Timer
  cancel: (timer: Timer) => void
}

export function createLongPressController<T, Timer>(
  options: LongPressControllerOptions<T, Timer>,
) {
  let active: { target: T; origin: Point; timer: Timer; token: number } | null = null
  let token = 0

  const cancelActive = () => {
    token += 1
    if (active) options.cancel(active.timer)
    active = null
  }

  return {
    start(target: T, point: Point) {
      cancelActive()
      const pressToken = token
      const timer = options.schedule(() => {
        if (!active || active.token !== pressToken) return
        const completed = active
        active = null
        options.onLongPress(completed.target, completed.origin)
      }, STANDARD_LONG_PRESS_MS)
      active = { target, origin: point, timer, token: pressToken }
    },
    move(point: Point) {
      if (!active) return
      if (
        Math.hypot(point.x - active.origin.x, point.y - active.origin.y) >
        LONG_PRESS_MOVE_TOLERANCE_PX
      ) {
        cancelActive()
      }
    },
    cancel: cancelActive,
  }
}

export function resolveContextMenuPosition(
  anchor: Point,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const fitsRight = anchor.x + CONTEXT_MENU_GAP_PX + menu.width <= viewport.width - CONTEXT_MENU_EDGE_PX
  const fitsBelow = anchor.y + CONTEXT_MENU_GAP_PX + menu.height <= viewport.height - CONTEXT_MENU_EDGE_PX
  const horizontal = fitsRight ? 'right' : 'left'
  const vertical = fitsBelow ? 'below' : 'above'

  const preferredLeft = fitsRight
    ? anchor.x + CONTEXT_MENU_GAP_PX
    : anchor.x - CONTEXT_MENU_GAP_PX - menu.width
  const preferredTop = fitsBelow
    ? anchor.y + CONTEXT_MENU_GAP_PX
    : anchor.y - CONTEXT_MENU_GAP_PX - menu.height

  return {
    left: Math.max(
      CONTEXT_MENU_EDGE_PX,
      Math.min(viewport.width - menu.width - CONTEXT_MENU_EDGE_PX, preferredLeft),
    ),
    top: Math.max(
      CONTEXT_MENU_EDGE_PX,
      Math.min(viewport.height - menu.height - CONTEXT_MENU_EDGE_PX, preferredTop),
    ),
    horizontal,
    vertical,
  }
}
