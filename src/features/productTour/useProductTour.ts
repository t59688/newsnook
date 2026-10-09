import { useCallback, useEffect, useRef } from 'react'

import { useReducedMotion } from '../../hooks/useReducedMotion'
import { hasSeenProductTour } from '../../lib/storage'
import { isProductTourActive, startProductTour, stopProductTour } from './ProductTourService'
import type { TourTab } from './types'

/** 启动页撤除后再等一拍，让首页列表入场动画先落定 */
const AUTO_START_DELAY_MS = 750

interface Options {
  /** 处于「速闻」首页且无遮挡层（阅读器 / 设置 / 聚焦源 / 彩蛋 / 深链报错）时为 true */
  ready: boolean
  setTab: (tab: TourTab) => void
  /** 完成或跳过后回调（App 用它回到首页） */
  onFinish?: () => void
}

/**
 * 功能引导的 App 侧接入点：
 * - 首次启动：等 BootstrapRoot 撤除启动页（<html data-boot> 消失）后自动开播；
 * - 「关于」页可随时重看（start），不需要清「看过」标记；
 * - Android 返回键先于其余导航收起引导（stopIfActive）。
 */
export function useProductTour({ ready, setTab, onFinish }: Options) {
  const reduced = useReducedMotion()
  const autoStartedRef = useRef(false)

  const setTabRef = useRef(setTab)
  setTabRef.current = setTab
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const start = useCallback(() => {
    if (isProductTourActive()) return
    // 等两帧：重看入口会先关设置栈、切回「速闻」，待目标屏挂载后再按可见性收集步骤
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        startProductTour({
          setTab: (tab) => setTabRef.current(tab),
          reduced: reducedRef.current,
          onFinish: () => onFinishRef.current?.(),
        })
      })
    })
  }, [])

  const stopIfActive = useCallback(() => {
    if (!isProductTourActive()) return false
    stopProductTour()
    return true
  }, [])

  useEffect(() => {
    if (!ready || autoStartedRef.current) return
    if (hasSeenProductTour()) return

    let cancelled = false
    let timer = 0
    let observer: MutationObserver | null = null

    const scheduleStart = () => {
      timer = window.setTimeout(() => {
        if (cancelled || autoStartedRef.current) return
        autoStartedRef.current = true
        start()
      }, AUTO_START_DELAY_MS)
    }

    const root = document.documentElement
    if (root.dataset.boot === undefined) {
      scheduleStart()
    } else {
      // 启动页仍在台上：等 BootstrapRoot 撤除时移除 data-boot 再开播
      observer = new MutationObserver(() => {
        if (root.dataset.boot !== undefined) return
        observer?.disconnect()
        observer = null
        scheduleStart()
      })
      observer.observe(root, { attributes: true, attributeFilter: ['data-boot'] })
    }

    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      observer?.disconnect()
    }
  }, [ready, start])

  return { start, stopIfActive }
}
