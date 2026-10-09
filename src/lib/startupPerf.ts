/** 启动链路轻量打点：开发期写 logger，正式包只留 mark 便于真机采样 */

import { log } from './logger'

const PREFIX = 'newsnook-boot'

export function bootMark(name: string): void {
  const mark = `${PREFIX}:${name}`
  try {
    performance.mark(mark)
  } catch {
    // 部分 WebView 不支持 performance.mark
  }
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now().toFixed(1)
      : String(Date.now())
  log.boot.info(`${name} @ ${now}ms`)
}

export function bootMeasure(name: string, startMark: string, endMark: string): void {
  try {
    performance.measure(`${PREFIX}:${name}`, `${PREFIX}:${startMark}`, `${PREFIX}:${endMark}`)
  } catch {
    // start/end mark 缺失时忽略
  }
}
