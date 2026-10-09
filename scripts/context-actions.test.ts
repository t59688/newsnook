import { readAppStyles } from './helpers/readAppStyles'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  createLongPressController,
  resolveContextMenuPosition,
  STANDARD_LONG_PRESS_MS,
} from '../src/lib/contextActions'

type ScheduledTask = { callback: () => void; delay: number; cancelled: boolean }

const scheduled: ScheduledTask[] = []
const schedule = (callback: () => void, delay: number) => {
  const task = { callback, delay, cancelled: false }
  scheduled.push(task)
  return task
}
const cancel = (task: ScheduledTask) => {
  task.cancelled = true
}

const fired: Array<{ id: string; point: { x: number; y: number } }> = []
const controller = createLongPressController<string, ScheduledTask>({
  onLongPress: (id, point) => fired.push({ id, point }),
  schedule,
  cancel,
})

controller.start('source-a', { x: 24, y: 48 })
assert.equal(scheduled[0]?.delay, 500, '长按应遵循 Android / Web 通用的 500ms 阈值')
assert.equal(STANDARD_LONG_PRESS_MS, 500)
scheduled[0]?.callback()
assert.deepEqual(fired, [{ id: 'source-a', point: { x: 24, y: 48 } }])

controller.start('source-b', { x: 10, y: 10 })
controller.move({ x: 16, y: 16 })
assert.equal(scheduled[1]?.cancelled, false, '轻微手指抖动不应取消长按')
controller.move({ x: 21, y: 10 })
assert.equal(scheduled[1]?.cancelled, true, '移动超过 10px 应取消长按，避免滚动时误触')
scheduled[1]?.callback()
assert.equal(fired.length, 1, '已取消的定时任务即使回调被调度也不得触发')

controller.start('source-c', { x: 12, y: 14 })
controller.cancel()
scheduled[2]?.callback()
assert.equal(fired.length, 1, '抬手应取消尚未完成的长按')

assert.deepEqual(
  resolveContextMenuPosition(
    { x: 80, y: 100 },
    { width: 220, height: 140 },
    { width: 390, height: 844 },
  ),
  { left: 88, top: 108, horizontal: 'right', vertical: 'below' },
  '空间充足时菜单应出现在触点右下方',
)

assert.deepEqual(
  resolveContextMenuPosition(
    { x: 360, y: 100 },
    { width: 220, height: 140 },
    { width: 390, height: 844 },
  ),
  { left: 132, top: 108, horizontal: 'left', vertical: 'below' },
  '靠近右边缘时菜单应翻到触点左下方',
)

assert.deepEqual(
  resolveContextMenuPosition(
    { x: 360, y: 810 },
    { width: 220, height: 140 },
    { width: 390, height: 844 },
  ),
  { left: 132, top: 662, horizontal: 'left', vertical: 'above' },
  '底部空间不足时菜单应翻到触点上方且留出安全边距',
)

const categoryRailSource = readFileSync(new URL('../src/components/CategoryRail.tsx', import.meta.url), 'utf8')
const sourceFilterSource = readFileSync(new URL('../src/components/SourceFilterChips.tsx', import.meta.url), 'utf8')
const indexCss = readAppStyles()

assert.match(categoryRailSource, /custom-long-press-target/, '分类长按目标必须禁止系统文本选择')
assert.match(sourceFilterSource, /custom-long-press-target/, '信源长按目标必须禁止系统文本选择')
assert.match(indexCss, /\.custom-long-press-target,[\s\S]*-webkit-user-select:\s*none;[\s\S]*user-select:\s*none;[\s\S]*-webkit-touch-callout:\s*none;/, '长按交互的移动端选择抑制样式必须完整保留')

console.log('context actions: ok')
