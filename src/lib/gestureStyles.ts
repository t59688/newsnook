import { resetBodyScrollLock } from './bodyScrollLock'

/**
 * 撤销手势识别阶段临时创建的合成层。
 *
 * Android WebView 在原生滚动已经接管后，如果滚动节点或其祖先仍保留一个
 * `translate3d(0, 0, 0)`，偶尔会把后续触摸留在失效的合成滚动层中。
 */
export function clearGestureCompositorStyles(element: HTMLElement): void {
  element.style.transform = ''
  element.style.transition = ''
  element.style.willChange = ''
  delete element.dataset.swipeBackActive
}

/** 标记可纵向滚动的表面，便于在导航/浮层关闭后统一恢复。 */
export const SCROLL_SURFACE_ATTR = 'data-scroll-surface'

/**
 * 恢复单个滚动容器与其手势祖先上的合成层残留。
 */
export function recoverScrollSurface(element: HTMLElement | null | undefined): void {
  if (!element) return
  clearGestureCompositorStyles(element)
  const shell = element.closest<HTMLElement>('.reader-swipe-surface')
  if (shell && shell !== element) clearGestureCompositorStyles(shell)
}

/**
 * 在离开图片/视频等强手势场景后唤醒页面滚动。
 *
 * 清理列表/阅读器上的 transform 合成层残留（Android WebView 触摸序列被打断后
 * 的经典卡死）。关闭整页阅读器时请额外调用 `resetBodyScrollLock()`。
 */
export function recoverAppScrollSurfaces(): void {
  document.documentElement.classList.remove('is-video-fullscreen')

  document.querySelectorAll<HTMLElement>(`[${SCROLL_SURFACE_ATTR}]`).forEach((surface) => {
    recoverScrollSurface(surface)
  })
}

/** 阅读器/列表整页退出：同时复位 body overflow 锁计数。 */
export function recoverAppScrollAfterNavigation(): void {
  resetBodyScrollLock()
  recoverAppScrollSurfaces()
}

export { resetBodyScrollLock }
