import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

import { createLongPressController, type Point } from '../lib/contextActions'

/**
 * 统一长按手势：500ms 触发、滚动位移取消，并吞掉长按释放后浏览器补发的 click。
 * 业务组件只关心“对哪个对象、在哪个触点打开动作菜单”。
 */
export function useLongPressAction<T extends string>(
  onLongPress: (target: T, point: Point) => void,
) {
  const callbackRef = useRef(onLongPress)
  callbackRef.current = onLongPress
  const triggeredTargetRef = useRef<T | null>(null)
  const suppressClearTimerRef = useRef<number | null>(null)
  const controllerRef = useRef<ReturnType<typeof createLongPressController<T, number>> | null>(
    null,
  )

  if (!controllerRef.current) {
    controllerRef.current = createLongPressController<T, number>({
      schedule: (callback, delay) => window.setTimeout(callback, delay),
      cancel: (timer) => window.clearTimeout(timer),
      onLongPress: (target, point) => {
        triggeredTargetRef.current = target
        if (suppressClearTimerRef.current !== null) {
          window.clearTimeout(suppressClearTimerRef.current)
        }
        suppressClearTimerRef.current = window.setTimeout(() => {
          if (triggeredTargetRef.current === target) triggeredTargetRef.current = null
          suppressClearTimerRef.current = null
        }, 900)

        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(10)
          } catch {
            // WebView / 系统策略不允许振动时，菜单本身仍照常打开。
          }
        }
        callbackRef.current(target, point)
      },
    })
  }

  useEffect(
    () => () => {
      controllerRef.current?.cancel()
      if (suppressClearTimerRef.current !== null) {
        window.clearTimeout(suppressClearTimerRef.current)
      }
    },
    [],
  )

  const start = useCallback((target: T, event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    controllerRef.current?.start(target, { x: event.clientX, y: event.clientY })
  }, [])

  const move = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    controllerRef.current?.move({ x: event.clientX, y: event.clientY })
  }, [])

  const cancel = useCallback(() => controllerRef.current?.cancel(), [])

  const consumeClick = useCallback((target: T) => {
    if (triggeredTargetRef.current !== target) return false
    triggeredTargetRef.current = null
    return true
  }, [])

  return { start, move, cancel, consumeClick }
}
