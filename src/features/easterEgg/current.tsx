import { useEffect, useEffectEvent, useLayoutEffect } from 'react'

import craneGameUrl from './craneGame.html?url'
import { enterEasterEggScreenChrome, exitEasterEggScreenChrome } from './screenChrome'

const CLOSE_MSG = 'newsnook-easter-egg-close'

/** 本版彩蛋：纸鹤行侘寂版（换版时删除本文件与 craneGame.html） */
export function CurrentEasterEgg({ onClose }: { onClose: () => void }) {
  const handleClose = useEffectEvent(onClose)

  // 布局前进入沉浸态，避免首帧先画出系统栏再闪隐藏
  useLayoutEffect(() => {
    enterEasterEggScreenChrome()
    // Pixel 等机型：首帧 insets/layout 可能把栏又显示出来，再断言一次
    const t = window.setTimeout(() => enterEasterEggScreenChrome(), 50)
    return () => {
      window.clearTimeout(t)
      exitEasterEggScreenChrome()
    }
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (
        data &&
        typeof data === 'object' &&
        'type' in data &&
        (data as { type?: string }).type === CLOSE_MSG
      ) {
        handleClose()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      style={{ marginTop: 'calc(0px - var(--sat))', marginBottom: 'calc(0px - var(--sab))' }}
    >
      <iframe
        title="纸鹤行"
        src={craneGameUrl}
        className="h-full min-h-0 w-full flex-1 border-0 bg-[rgb(232,228,217)]"
        allow="autoplay"
      />
    </div>
  )
}
