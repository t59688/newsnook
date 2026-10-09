import { driver, type Config, type DriveStep, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import './productTour.css'

import { log } from '../../lib/logger'
import { markProductTourSeen } from '../../lib/storage'
import { PRODUCT_TOUR_STEPS, resolveAvailableSteps } from './steps'
import type { StartProductTourOptions } from './types'

/** 切 Tab 后等待目标元素挂载的时长；超时 driver 会降级为居中卡片，不阻塞流程 */
const WAIT_FOR_ELEMENT_MS = 3000

let activeTour: Driver | null = null
let finalizeActiveTour: (() => void) | null = null

export function isProductTourActive(): boolean {
  return activeTour?.isActive() ?? false
}

/** 外部（如 Android 返回键）请求收起引导；视同跳过，会标记为看过 */
export function stopProductTour(): void {
  const tour = activeTour
  if (!tour) return
  tour.destroy()
  // 转场未完成时 driver 会跳过 onDestroyed，这里确保收尾一定执行（幂等）
  finalizeActiveTour?.()
}

/** 元素存在且实际占位；lg:hidden 等断点下 display:none 的目标按缺席处理 */
function isStepTargetVisible(selector: string): boolean {
  const element = document.querySelector(selector)
  return Boolean(element && element.getClientRects().length > 0)
}

/** 昼读用暖墨压底，夜读维持纯黑，避免浅色纸面上盖出冷灰 */
function overlayConfig(): Pick<Config, 'overlayColor' | 'overlayOpacity'> {
  const light = document.documentElement.dataset.theme === 'light'
  return light
    ? { overlayColor: '#241f18', overlayOpacity: 0.45 }
    : { overlayColor: '#000000', overlayOpacity: 0.62 }
}

/**
 * 启动功能引导。要求调用时首页已挂载（「速闻」步骤按当前可见性收集）。
 * 完成或任意方式跳过（右上角 ×、点遮罩、返回键、Esc）都会标记为看过。
 *
 * @returns 是否真正启动（已在播或无可用步骤时返回 false）
 */
export function startProductTour(options: StartProductTourOptions): boolean {
  if (typeof document === 'undefined') return false
  if (activeTour?.isActive()) return false

  const steps = resolveAvailableSteps(PRODUCT_TOUR_STEPS, isStepTargetVisible)
  if (!steps.length) return false

  const driveSteps: DriveStep[] = steps.map((step) => ({
    element: step.selector ?? undefined,
    popover: {
      title: step.title,
      description: step.description,
      ...(step.side ? { side: step.side } : {}),
      ...(step.align ? { align: step.align } : {}),
    },
  }))

  /** 先把目标步骤所在 Tab 切出来，再让 driver 移动（缺席元素由 waitForElement 等待） */
  const moveWithTab = (targetIndex: number) => {
    const target = steps[targetIndex]
    if (target) options.setTab(target.tab)
    tour.moveTo(targetIndex)
  }

  /**
   * 统一收尾（幂等）：完成与任意跳过路径都标记看过。
   * 不能只依赖 onDestroyed——高亮转场未完成时销毁，driver 会跳过该回调。
   */
  let finished = false
  const finalize = () => {
    if (finished) return
    finished = true
    activeTour = null
    finalizeActiveTour = null
    markProductTourSeen()
    log.app.info('product tour dismissed')
    options.onFinish?.()
  }

  const tour = driver({
    steps: driveSteps,
    animate: options.reduced !== true,
    smoothScroll: options.reduced !== true,
    allowClose: true,
    overlayClickBehavior: 'close',
    disableActiveInteraction: true,
    waitForElement: WAIT_FOR_ELEMENT_MS,
    stagePadding: 6,
    stageRadius: 14,
    popoverOffset: 12,
    popoverClass: 'newsnook-tour',
    showProgress: true,
    progressText: '{{current}} / {{total}}',
    nextBtnText: '下一步',
    prevBtnText: '上一步',
    doneBtnText: '开始使用',
    ...overlayConfig(),
    onNextClick: () => {
      const index = tour.getActiveIndex()
      if (index === undefined) return
      moveWithTab(index + 1)
    },
    onPrevClick: () => {
      const index = tour.getActiveIndex()
      if (index === undefined || index <= 0) return
      moveWithTab(index - 1)
    },
    onDoneClick: () => {
      tour.destroy()
      finalize()
    },
    // 右上角 ×、点遮罩、Esc 都会先进这里；设了该钩子后需自行调用 destroy
    onDestroyStarted: () => {
      tour.destroy()
      finalize()
    },
    onDestroyed: () => {
      finalize()
    },
  })

  activeTour = tour
  finalizeActiveTour = finalize
  tour.drive()
  log.app.info(
    'product tour started',
    steps.map((step) => step.id).join(','),
  )
  return true
}
