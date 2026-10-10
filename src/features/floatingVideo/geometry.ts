import type { WindowBounds, WindowRect } from './types'

export const WINDOW_BAR_HEIGHT = 44
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const aspect = (ratio: number) => Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9

export function constrainWindow(rect: Pick<WindowRect, 'x' | 'y' | 'width'>, bounds: WindowBounds, ratio: number): WindowRect {
  const maxWidth = Math.max(1, Math.min(640, bounds.width, Math.max(1, bounds.height - WINDOW_BAR_HEIGHT) * aspect(ratio)))
  const width = clamp(rect.width, Math.min(200, maxWidth), maxWidth)
  const height = Math.min(bounds.height, WINDOW_BAR_HEIGHT + width / aspect(ratio))
  return {
    width, height,
    x: clamp(rect.x, bounds.x, bounds.x + Math.max(0, bounds.width - width)),
    y: clamp(rect.y, bounds.y, bounds.y + Math.max(0, bounds.height - height)),
  }
}

export function initialWindow(bounds: WindowBounds, ratio: number): WindowRect {
  const width = clamp(bounds.width * 0.6, 220, 360)
  return constrainWindow({ x: bounds.x + bounds.width - width, y: bounds.y + bounds.height - WINDOW_BAR_HEIGHT - width / aspect(ratio) - 64, width }, bounds, ratio)
}
